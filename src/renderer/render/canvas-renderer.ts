// Draws the active document into the on-screen canvas. Composites dirty tile rectangles into a
// document-sized surface (putImageData sub-rects), then draws that surface with one view transform.
import { storeStraight } from '../engine/blend';
import type { CompositeOptions } from '../engine/compositor';
import {
  forEachTileInRect,
  intersectRect,
  isEmptyRect,
  unionRect,
  type Mat2D,
  type Point,
  type Rect,
} from '../engine/geometry';
import { tileKey } from '../engine/tiles';
import { viewMatrix, type Viewport } from '../engine/view';
import type { DocumentSession } from '../state/documents';
import { apply } from '../engine/geometry';

export interface OverlayInfo {
  session: DocumentSession;
  matrix: Mat2D;
  viewport: Viewport;
  dpr: number;
  toScreen: (p: Point) => Point;
  zoom: number;
}

export type OverlayFn = (ctx: CanvasRenderingContext2D, info: OverlayInfo) => void;

/** What the view composites for a session (animation frames); `key` changes force a full recomposite. */
export type DisplayProvider = (session: DocumentSession) => { options: CompositeOptions; key: string } | null;
let displayProvider: DisplayProvider | null = null;
export function setDisplayProvider(fn: DisplayProvider) {
  displayProvider = fn;
}

/** A prepared image shown instead of the live composite (animation playback). */
export interface PlaybackImage {
  sessionId: string;
  image: CanvasImageSource;
}

interface Surface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  dirty: Map<number, Rect>;
  unsub: () => void;
  width: number;
  height: number;
  docId: string;
  displayKey: string;
}

export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;
  private surfaces = new Map<string, Surface>();
  private session: DocumentSession | null = null;
  private raf = 0;
  private needsDraw = true;
  private imageData: ImageData | null = null;
  private acc: Float32Array | null = null;
  private checker: CanvasPattern | null = null;
  viewport: Viewport = { width: 1, height: 1 };
  dpr = 1;
  /** Shown instead of the live composite while an animation plays. */
  playback: PlaybackImage | null = null;
  overlays = new Set<OverlayFn>();
  pixelGrid = true;
  /** Called once per animation frame (tools use it for airbrush timing). */
  onFrame: ((time: number) => void) | null = null;
  stats = { lastCompositeMs: 0, lastDrawMs: 0, pendingTiles: 0 };
  private workspaceColor = '#101215';

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) throw new Error('Canvas 2D is not available.');
    this.ctx = ctx;
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    for (const s of this.surfaces.values()) s.unsub();
    this.surfaces.clear();
  }

  setWorkspaceColor(c: string) {
    this.workspaceColor = c;
    this.checker = null;
    this.requestDraw();
  }

  setSession(s: DocumentSession | null) {
    this.session = s;
    if (s) this.ensureSurface(s);
    this.requestDraw();
  }

  /** Drops surfaces of closed sessions. */
  retainSessions(ids: Set<string>) {
    for (const [id, s] of this.surfaces) {
      if (!ids.has(id)) {
        s.unsub();
        this.surfaces.delete(id);
      }
    }
  }

  resize(width: number, height: number, dpr: number) {
    this.viewport = { width, height };
    this.dpr = dpr;
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.requestDraw();
  }

  requestDraw() {
    this.needsDraw = true;
  }

  /** Forces a full recomposite of the active document (e.g. after switching documents or animation frames). */
  invalidateAll(session: DocumentSession | null = this.session) {
    if (!session) return;
    const surf = this.ensureSurface(session);
    this.markDirty(surf, session, null);
  }

  /**
   * A downscaled copy of the session's current view composite (cheap GPU blit), or null while
   * composite work is still pending or the session has no surface yet.
   */
  snapshot(session: DocumentSession, maxSide: number): HTMLCanvasElement | null {
    const surf = this.surfaces.get(session.id);
    if (!surf || surf.dirty.size) return null;
    const k = Math.min(1, maxSide / Math.max(surf.width, surf.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(surf.width * k));
    c.height = Math.max(1, Math.round(surf.height * k));
    const g = c.getContext('2d')!;
    const bg = session.doc.background;
    g.fillStyle = bg.transparent
      ? '#ffffff'
      : `rgb(${Math.round(bg.color.r * 255)}, ${Math.round(bg.color.g * 255)}, ${Math.round(bg.color.b * 255)})`;
    g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(surf.canvas, 0, 0, c.width, c.height);
    return c;
  }

  /** True while composite work is pending. */
  get busy(): boolean {
    const s = this.session && this.surfaces.get(this.session.id);
    return !!s && s.dirty.size > 0;
  }

  private ensureSurface(session: DocumentSession): Surface {
    let s = this.surfaces.get(session.id);
    const doc = session.doc;
    if (s && (s.width !== doc.width || s.height !== doc.height || s.docId !== doc.id)) {
      s.unsub();
      this.surfaces.delete(session.id);
      s = undefined;
    }
    if (!s) {
      const canvas = document.createElement('canvas');
      canvas.width = doc.width;
      canvas.height = doc.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: false })!;
      const surf: Surface = {
        canvas,
        ctx,
        dirty: new Map(),
        unsub: () => undefined,
        width: doc.width,
        height: doc.height,
        docId: doc.id,
        displayKey: '',
      };
      surf.unsub = doc.onDirty((r) => this.markDirty(surf, session, r));
      this.surfaces.set(session.id, surf);
      this.markDirty(surf, session, null);
      s = surf;
    }
    return s;
  }

  private markDirty(surf: Surface, session: DocumentSession, r: Rect | null) {
    const doc = session.doc;
    const bounds = { x: 0, y: 0, w: doc.width, h: doc.height };
    const clipped = r ? intersectRect(r, bounds) : bounds;
    if (isEmptyRect(clipped)) return;
    forEachTileInRect(clipped, doc.tileSize, (tx, ty, sub) => {
      const k = tileKey(tx, ty);
      surf.dirty.set(k, unionRect(surf.dirty.get(k) ?? null, sub));
    });
    if (session === this.session) this.needsDraw = true;
  }

  private processDirty(session: DocumentSession, surf: Surface, budgetMs: number) {
    const display = displayProvider?.(session) ?? null;
    const key = display?.key ?? '';
    if (key !== surf.displayKey) {
      // a different frame or onion setup: everything must be recomposited
      surf.displayKey = key;
      this.markDirty(surf, session, null);
    }
    if (!surf.dirty.size) return;
    const start = performance.now();
    const ts = session.doc.tileSize;
    if (!this.imageData || this.imageData.width !== ts) {
      this.imageData = new ImageData(ts, ts);
      this.acc = new Float32Array(ts * ts * 4);
    }
    const img = this.imageData;
    const acc = this.acc!;
    const data = img.data;
    for (const [k, r] of surf.dirty) {
      surf.dirty.delete(k);
      session.compositor.compositeRect(r, acc, display?.options);
      const tx = Math.floor(r.x / ts);
      const ty = Math.floor(r.y / ts);
      const ox = r.x - tx * ts;
      const oy = r.y - ty * ts;
      for (let y = 0; y < r.h; y++) {
        let i = y * r.w * 4;
        let j = ((oy + y) * ts + ox) * 4;
        for (let x = 0; x < r.w; x++, i += 4, j += 4) storeStraight(acc, i, data, j);
      }
      surf.ctx.putImageData(img, tx * ts, ty * ts, ox, oy, r.w, r.h);
      this.needsDraw = true;
      if (performance.now() - start > budgetMs) break;
    }
    this.stats.lastCompositeMs = performance.now() - start;
  }

  private loop(time: number) {
    this.raf = requestAnimationFrame(this.loop);
    this.onFrame?.(time);
    const session = this.session;
    if (session) {
      const surf = this.ensureSurface(session);
      this.processDirty(session, surf, 10);
      this.stats.pendingTiles = surf.dirty.size;
    }
    if (this.needsDraw) {
      this.needsDraw = false;
      const t0 = performance.now();
      this.draw();
      this.stats.lastDrawMs = performance.now() - t0;
    }
  }

  private checkerPattern(): CanvasPattern | null {
    if (this.checker) return this.checker;
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const g = c.getContext('2d')!;
    const st = getComputedStyle(document.documentElement);
    g.fillStyle = st.getPropertyValue('--checker-a').trim() || '#3a3f47';
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = st.getPropertyValue('--checker-b').trim() || '#2d3138';
    g.fillRect(0, 0, 8, 8);
    g.fillRect(8, 8, 8, 8);
    this.checker = this.ctx.createPattern(c, 'repeat');
    return this.checker;
  }

  private draw() {
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.workspaceColor;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const session = this.session;
    if (!session) return;
    const surf = this.surfaces.get(session.id);
    if (!surf) return;
    const doc = session.doc;
    const view = session.view;
    const m = viewMatrix(view, this.viewport, doc.width, doc.height);
    const toScreen = (p: Point) => apply(m, p.x, p.y);
    // drop shadow in screen space
    const corners = [
      toScreen({ x: 0, y: 0 }),
      toScreen({ x: doc.width, y: 0 }),
      toScreen({ x: doc.width, y: doc.height }),
      toScreen({ x: 0, y: doc.height }),
    ];
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.beginPath();
    corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
    ctx.closePath();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = doc.background.transparent ? '#808080' : '#ffffff';
    ctx.fill();
    ctx.restore();
    ctx.setTransform(dpr * m[0], dpr * m[1], dpr * m[2], dpr * m[3], dpr * m[4], dpr * m[5]);
    if (doc.background.transparent) {
      const pat = this.checkerPattern();
      if (pat) {
        // constant on-screen checker size regardless of zoom
        pat.setTransform(new DOMMatrix([1 / view.zoom, 0, 0, 1 / view.zoom, 0, 0]));
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, doc.width, doc.height);
      }
    }
    ctx.imageSmoothingEnabled = view.zoom < 2;
    ctx.imageSmoothingQuality = 'high';
    if (this.playback && this.playback.sessionId === session.id) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.playback.image, 0, 0, doc.width, doc.height);
    } else ctx.drawImage(surf.canvas, 0, 0);
    if (this.pixelGrid && view.zoom >= 8) this.drawPixelGrid(m);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const info: OverlayInfo = { session, matrix: m, viewport: this.viewport, dpr, toScreen, zoom: view.zoom };
    for (const o of this.overlays) {
      ctx.save();
      o(ctx, info);
      ctx.restore();
    }
  }

  private drawPixelGrid(m: Mat2D) {
    const session = this.session!;
    const doc = session.doc;
    const ctx = this.ctx;
    const inv = invertSafe(m);
    if (!inv) return;
    // visible document range
    const pts = [
      apply(inv, 0, 0),
      apply(inv, this.viewport.width, 0),
      apply(inv, 0, this.viewport.height),
      apply(inv, this.viewport.width, this.viewport.height),
    ];
    const x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.x))));
    const x1 = Math.min(doc.width, Math.ceil(Math.max(...pts.map((p) => p.x))));
    const y0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.y))));
    const y1 = Math.min(doc.height, Math.ceil(Math.max(...pts.map((p) => p.y))));
    if ((x1 - x0) * (y1 - y0) > 400 * 400) return;
    ctx.save();
    ctx.lineWidth = 1 / session.view.zoom;
    ctx.strokeStyle = 'rgba(128,128,128,0.35)';
    ctx.beginPath();
    for (let x = x0; x <= x1; x++) {
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
    }
    for (let y = y0; y <= y1; y++) {
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function invertSafe(m: Mat2D): Mat2D | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return null;
  const id = 1 / det;
  return [
    m[3] * id,
    -m[1] * id,
    -m[2] * id,
    m[0] * id,
    (m[2] * m[5] - m[3] * m[4]) * id,
    (m[1] * m[4] - m[0] * m[5]) * id,
  ];
}
