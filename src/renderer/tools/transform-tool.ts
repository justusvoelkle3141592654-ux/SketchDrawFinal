// Transform tool: move, scale (constrained/free), rotate, flip, free distort (perspective) with numeric entry.
// The selected pixels (or the whole layer) float above the canvas until Enter applies or Esc cancels.
import { create } from 'zustand';
import type { Point } from '../engine/geometry';
import { compoundEntry, TileDiffRecorder, type HistoryEntry } from '../engine/history';
import type { RasterLayer } from '../engine/layers';
import {
  clearBlock,
  drawTransformedBlock,
  extractBlock,
  homography,
  mat3FromAffine,
  transformMaskBlock,
  trimBlock,
  type Mat3,
  type PixelBlock,
} from '../engine/pixel-ops';
import { isEmptyMask, maskBounds, selectionEntry } from '../engine/selection';
import type { DocumentSession } from '../state/documents';
import { useDocs } from '../state/documents';
import { toast, useUi } from '../state/ui';
import { isEffectivelyVisible } from '../engine/layers';
import type { Tool, ToolContext, ToolPointer } from './types';

type Quad = [Point, Point, Point, Point]; // TL, TR, BR, BL in document coordinates

interface Floating {
  session: DocumentSession;
  layer: RasterLayer;
  block: PixelBlock;
  image: HTMLCanvasElement;
  recorder: TileDiffRecorder;
  start: Quad;
  quad: Quad;
  free: boolean;
  label: string;
  /** Selection mask (alpha channel) in its own bounds; it follows the content on commit. */
  selection: { block: PixelBlock; dx: number; dy: number } | null;
}

/** Observable summary for the options bar. */
export const useTransformState = create<{
  active: boolean;
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
  free: boolean;
  rev: number;
}>(() => ({
  active: false,
  cx: 0,
  cy: 0,
  w: 0,
  h: 0,
  angle: 0,
  free: false,
  rev: 0,
}));

let floating: Floating | null = null;

const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const len = (a: Point) => Math.hypot(a.x, a.y);
const norm = (a: Point): Point => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
const center = (q: Quad): Point => ({
  x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4,
  y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4,
});
const rotateAround = (p: Point, c: Point, a: number): Point => {
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  return { x: c.x + (p.x - c.x) * cs - (p.y - c.y) * sn, y: c.y + (p.x - c.x) * sn + (p.y - c.y) * cs };
};

function publish() {
  const f = floating;
  if (!f) {
    useTransformState.setState({ active: false, rev: useTransformState.getState().rev + 1 });
    return;
  }
  const q = f.quad;
  const c = center(q);
  useTransformState.setState({
    active: true,
    cx: c.x,
    cy: c.y,
    w: len(sub(q[1], q[0])),
    h: len(sub(q[3], q[0])),
    angle: (Math.atan2(q[1].y - q[0].y, q[1].x - q[0].x) * 180) / Math.PI,
    free: f.free,
    rev: useTransformState.getState().rev + 1,
  });
}

function blockToCanvas(b: PixelBlock): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, b.w);
  c.height = Math.max(1, b.h);
  c.getContext('2d')!.putImageData(new ImageData(b.data as Uint8ClampedArray<ArrayBuffer>, b.w, b.h), 0, 0);
  return c;
}

function rectQuad(x: number, y: number, w: number, h: number): Quad {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

export function isTransforming(s?: DocumentSession | null): boolean {
  return !!floating && (!s || floating.session === s);
}

function targetLayer(s: DocumentSession): RasterLayer | null {
  const l = s.doc.activeRaster;
  if (!l) {
    toast('info', 'Select a paint layer to transform.');
    return null;
  }
  if (l.locked) {
    toast('warning', `"${l.name}" is locked.`);
    return null;
  }
  if (!isEffectivelyVisible(s.doc.layers, l.id)) {
    toast('warning', `"${l.name}" is hidden.`);
    return null;
  }
  return l;
}

/** Floats the selection (or the whole layer) of the active layer. Returns false if there is nothing to move. */
export function beginTransform(s: DocumentSession): boolean {
  if (floating) return true;
  const layer = targetLayer(s);
  if (!layer) return false;
  const doc = s.doc;
  const sel = doc.selection;
  const area = sel ? maskBounds(sel) : doc.bounds;
  if (!area) return false;
  const raw = extractBlock(layer.pixels, area, sel);
  const block = trimBlock(raw);
  if (!block) {
    toast('info', sel ? 'The selection is empty on this layer.' : 'This layer is empty.');
    return false;
  }
  let selection: Floating['selection'] = null;
  if (sel) {
    const m = sel.readRect(area);
    const data = new Uint8ClampedArray(area.w * area.h * 4);
    for (let i = 0; i < m.length; i++) {
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 255;
      data[i * 4 + 3] = m[i];
    }
    selection = {
      block: { x: 0, y: 0, w: area.w, h: area.h, data },
      dx: area.x - block.x,
      dy: area.y - block.y,
    };
  }
  const recorder = new TileDiffRecorder(layer.pixels);
  clearBlock(layer.pixels, recorder, { x: block.x, y: block.y, w: block.w, h: block.h }, sel);
  doc.markPixelsChanged({ x: block.x, y: block.y, w: block.w, h: block.h });
  const quad = rectQuad(block.x, block.y, block.w, block.h);
  floating = {
    session: s,
    layer,
    block: { ...block, x: 0, y: 0 },
    image: blockToCanvas(block),
    recorder,
    start: quad,
    quad: [...quad] as Quad,
    free: false,
    label: sel ? 'Transform selection' : 'Transform layer',
    selection,
  };
  publish();
  return true;
}

/** Floats external pixels (paste) on the active layer at (x, y). */
export function beginPasteTransform(s: DocumentSession, block: PixelBlock, label = 'Paste'): boolean {
  if (floating) commitTransform();
  const layer = targetLayer(s);
  if (!layer) return false;
  const quad = rectQuad(block.x, block.y, block.w, block.h);
  floating = {
    session: s,
    layer,
    block: { ...block, x: 0, y: 0 },
    image: blockToCanvas(block),
    recorder: new TileDiffRecorder(layer.pixels),
    start: quad,
    quad: [...quad] as Quad,
    free: false,
    label,
    selection: null,
  };
  useUi.getState().setTool('transform');
  publish();
  return true;
}

function currentMatrix(f: Floating): Mat3 | null {
  const q = f.quad;
  const w = f.block.w;
  const h = f.block.h;
  // affine when the quad is a parallelogram
  const d = sub(add(q[0], q[2]), add(q[1], q[3]));
  if (!f.free || len(d) < 1e-6) {
    const ux = sub(q[1], q[0]);
    const vy = sub(q[3], q[0]);
    return mat3FromAffine(ux.x / w, ux.y / w, vy.x / h, vy.y / h, q[0].x, q[0].y);
  }
  return homography(
    [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ],
    q,
  );
}

export function commitTransform(): void {
  const f = floating;
  if (!f) return;
  floating = null;
  const doc = f.session.doc;
  const m = currentMatrix(f);
  if (m) drawTransformedBlock(f.layer.pixels, f.recorder, f.block, m, doc.bounds);
  const parts: HistoryEntry[] = [];
  const pix = f.recorder.toEntry(f.label, (r) => doc.markPixelsChanged(r));
  if (pix) parts.push(pix);
  if (f.selection && m) {
    const moved = transformMaskBlock(
      f.selection.block,
      f.selection.dx,
      f.selection.dy,
      m,
      doc.bounds,
      doc.tileSize,
    );
    const e = selectionEntry(doc, f.label, doc.selection, isEmptyMask(moved) ? null : moved);
    e.redo();
    parts.push(e);
  }
  if (parts.length) f.session.history.push(parts.length === 1 ? parts[0] : compoundEntry(f.label, parts));
  doc.markPixelsChanged(null);
  publish();
  useDocs.getState().bump();
}

export function cancelTransform(): void {
  const f = floating;
  if (!f) return;
  floating = null;
  const entry = f.recorder.toEntry('cancel', (r) => f.session.doc.markPixelsChanged(r));
  entry?.undo();
  f.session.doc.markPixelsChanged(null);
  publish();
}

/** Applies numeric values from the options bar (resets free distortion). */
export function setTransformNumeric(v: { cx?: number; cy?: number; w?: number; h?: number; angle?: number }) {
  const f = floating;
  if (!f) return;
  const st = useTransformState.getState();
  const cx = v.cx ?? st.cx;
  const cy = v.cy ?? st.cy;
  const w = Math.max(1, v.w ?? st.w);
  const h = Math.max(1, v.h ?? st.h);
  const a = ((v.angle ?? st.angle) * Math.PI) / 180;
  const base = rectQuad(cx - w / 2, cy - h / 2, w, h);
  // keep flips: detect mirrored quad by the sign of the cross product
  const u = sub(f.quad[1], f.quad[0]);
  const vv = sub(f.quad[3], f.quad[0]);
  const mirrored = u.x * vv.y - u.y * vv.x < 0;
  let q = base.map((p) => rotateAround(p, { x: cx, y: cy }, a)) as Quad;
  if (mirrored) q = [q[1], q[0], q[3], q[2]];
  f.quad = q;
  f.free = false;
  publish();
}

export function flipTransform(axis: 'h' | 'v') {
  const f = floating;
  if (!f) return;
  const q = f.quad;
  f.quad = axis === 'h' ? [q[1], q[0], q[3], q[2]] : [q[3], q[2], q[1], q[0]];
  publish();
}

export function rotateTransform(deg: number) {
  const f = floating;
  if (!f) return;
  const c = center(f.quad);
  f.quad = f.quad.map((p) => rotateAround(p, c, (deg * Math.PI) / 180)) as Quad;
  publish();
}

type Handle =
  { kind: 'corner'; i: number } | { kind: 'edge'; i: number } | { kind: 'rotate' } | { kind: 'move' };

function pointInQuad(p: Point, q: Quad): boolean {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const a = q[i];
    const b = q[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-9) + a.x)
      inside = !inside;
  }
  return inside;
}

export class TransformTool implements Tool {
  private drag: { handle: Handle; start: Point; startQuad: Quad; angle0: number } | null = null;
  private hoverHandle: Handle | null = null;

  cursor() {
    if (!this.hoverHandle) return 'default';
    if (this.hoverHandle.kind === 'move') return 'move';
    if (this.hoverHandle.kind === 'rotate') return 'alias';
    return 'crosshair';
  }

  private screenQuad(ctx: ToolContext): Quad | null {
    if (!floating) return null;
    return floating.quad.map((p) => ctx.toScreen(p)) as Quad;
  }

  private hit(sx: number, sy: number, ctx: ToolContext): Handle | null {
    const q = this.screenQuad(ctx);
    if (!q) return null;
    for (let i = 0; i < 4; i++) if (Math.hypot(q[i].x - sx, q[i].y - sy) < 10) return { kind: 'corner', i };
    // thin or tiny content: edge handles would cover the middle, so moving wins inside a padded frame
    const c0 = center(q);
    if (Math.min(len(sub(q[1], q[0])), len(sub(q[3], q[0]))) < 28) {
      const padded = q.map((p) => add(p, mul(norm(sub(p, c0)), 8))) as Quad;
      if (pointInQuad({ x: sx, y: sy }, padded)) return { kind: 'move' };
    }
    for (let i = 0; i < 4; i++) {
      const m = mul(add(q[i], q[(i + 1) % 4]), 0.5);
      if (Math.hypot(m.x - sx, m.y - sy) < 9) return { kind: 'edge', i };
    }
    const top = mul(add(q[0], q[1]), 0.5);
    const c = center(q);
    const out = add(top, mul(norm(sub(top, c)), 26));
    if (Math.hypot(out.x - sx, out.y - sy) < 11) return { kind: 'rotate' };
    if (pointInQuad({ x: sx, y: sy }, q)) return { kind: 'move' };
    return { kind: 'rotate' }; // dragging outside rotates
  }

  down(p: ToolPointer, ctx: ToolContext) {
    if (!floating || floating.session !== ctx.session) {
      if (floating) commitTransform();
      if (!beginTransform(ctx.session)) return false;
      ctx.requestDraw();
    }
    const handle = this.hit(p.sx, p.sy, ctx) ?? { kind: 'move' };
    const c = center(floating!.quad);
    this.drag = {
      handle,
      start: { x: p.x, y: p.y },
      startQuad: [...floating!.quad] as Quad,
      angle0: Math.atan2(p.y - c.y, p.x - c.x),
    };
    return true;
  }

  move(ps: ToolPointer[], ctx: ToolContext) {
    const f = floating;
    const d = this.drag;
    if (!f || !d) return;
    const p = ps[ps.length - 1];
    const cur = { x: p.x, y: p.y };
    const q0 = d.startQuad;
    const c0 = center(q0);
    let q: Quad = [...q0] as Quad;
    switch (d.handle.kind) {
      case 'move': {
        const delta = sub(cur, d.start);
        q = q0.map((pt) => add(pt, delta)) as Quad;
        break;
      }
      case 'rotate': {
        let a = Math.atan2(cur.y - c0.y, cur.x - c0.x) - d.angle0;
        if (p.shift) {
          const base = Math.atan2(q0[1].y - q0[0].y, q0[1].x - q0[0].x);
          const step = Math.PI / 12;
          a = Math.round((base + a) / step) * step - base;
        }
        q = q0.map((pt) => rotateAround(pt, c0, a)) as Quad;
        break;
      }
      case 'corner': {
        const i = d.handle.i;
        if (p.ctrl) {
          // free distort: move just this corner (perspective)
          q[i] = cur;
          f.free = true;
          break;
        }
        const u = norm(sub(q0[1], q0[0]));
        const v = norm(sub(q0[3], q0[0]));
        const origin = p.alt ? c0 : q0[(i + 2) % 4];
        const a0 = sub(q0[i], origin);
        const a1 = sub(cur, origin);
        let sx = dot(a0, u) !== 0 ? dot(a1, u) / dot(a0, u) : 1;
        let sy = dot(a0, v) !== 0 ? dot(a1, v) / dot(a0, v) : 1;
        if (p.shift) {
          const s = Math.max(Math.abs(sx), Math.abs(sy));
          sx = Math.sign(sx || 1) * s;
          sy = Math.sign(sy || 1) * s;
        }
        q = q0.map((pt) => {
          const r = sub(pt, origin);
          return add(origin, add(mul(u, dot(r, u) * sx), mul(v, dot(r, v) * sy)));
        }) as Quad;
        break;
      }
      case 'edge': {
        const i = d.handle.i; // edge from corner i to i+1
        const horizontal = i === 0 || i === 2;
        const axis = horizontal ? norm(sub(q0[3], q0[0])) : norm(sub(q0[1], q0[0]));
        const mid = mul(add(q0[i], q0[(i + 1) % 4]), 0.5);
        const opp = mul(add(q0[(i + 2) % 4], q0[(i + 3) % 4]), 0.5);
        const origin = p.alt ? c0 : opp;
        const a0 = dot(sub(mid, origin), axis);
        const a1 = dot(sub(cur, origin), axis);
        const s = a0 !== 0 ? a1 / a0 : 1;
        q = q0.map((pt) => {
          const r = sub(pt, origin);
          const along = dot(r, axis);
          return add(pt, mul(axis, along * (s - 1)));
        }) as Quad;
        break;
      }
    }
    f.quad = q;
    publish();
    ctx.requestDraw();
  }

  up() {
    this.drag = null;
  }

  cancel(ctx: ToolContext) {
    this.drag = null;
    ctx.requestDraw();
  }

  hover(p: ToolPointer, ctx: ToolContext) {
    this.hoverHandle = floating ? this.hit(p.sx, p.sy, ctx) : null;
    ctx.requestDraw();
  }

  key(e: KeyboardEvent, ctx: ToolContext) {
    if (!floating) return false;
    if (e.key === 'Enter') {
      commitTransform();
      ctx.requestDraw();
      return true;
    }
    if (e.key === 'Escape') {
      cancelTransform();
      ctx.requestDraw();
      return true;
    }
    const step = e.shiftKey ? 10 : 1;
    const arrows: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    if (arrows[e.key]) {
      floating.quad = floating.quad.map((pt) => add(pt, arrows[e.key])) as Quad;
      publish();
      ctx.requestDraw();
      return true;
    }
    return false;
  }

  deactivate() {
    commitTransform();
  }

  overlay(c: CanvasRenderingContext2D, info: { dpr: number; matrix: number[] }, ctx: ToolContext) {
    const f = floating;
    if (!f || f.session !== ctx.session) return;
    const m = currentMatrix(f);
    if (!m) return;
    const vm = info.matrix;
    c.save();
    c.globalAlpha = f.layer.opacity;
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    if (!f.free) {
      // view ∘ affine
      const a = m[0];
      const b = m[3];
      const cc = m[1];
      const d = m[4];
      const e = m[2];
      const ff = m[5];
      const A = vm[0] * a + vm[2] * b;
      const B = vm[1] * a + vm[3] * b;
      const C = vm[0] * cc + vm[2] * d;
      const D = vm[1] * cc + vm[3] * d;
      const E = vm[0] * e + vm[2] * ff + vm[4];
      const F = vm[1] * e + vm[3] * ff + vm[5];
      c.setTransform(info.dpr * A, info.dpr * B, info.dpr * C, info.dpr * D, info.dpr * E, info.dpr * F);
      c.drawImage(f.image, 0, 0);
    } else {
      drawPerspective(c, f, m, ctx, info.dpr);
    }
    c.restore();
    // frame and handles (screen space)
    const q = f.quad.map((p) => ctx.toScreen(p));
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(93,214,200,0.95)';
    c.beginPath();
    q.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.closePath();
    c.stroke();
    const top = mul(add(q[0], q[1]), 0.5);
    const cen = center(q as Quad);
    const rot = add(top, mul(norm(sub(top, cen)), 26));
    c.beginPath();
    c.moveTo(top.x, top.y);
    c.lineTo(rot.x, rot.y);
    c.stroke();
    const handle = (p: Point, round = false) => {
      c.fillStyle = '#fff';
      c.strokeStyle = 'rgba(0,0,0,0.75)';
      c.beginPath();
      if (round) c.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
      else c.rect(p.x - 4.5, p.y - 4.5, 9, 9);
      c.fill();
      c.stroke();
    };
    q.forEach((p) => handle(p));
    for (let i = 0; i < 4; i++) handle(mul(add(q[i], q[(i + 1) % 4]), 0.5));
    handle(rot, true);
  }
}

/** Perspective preview: the image is split into a grid of triangles, each drawn with an affine map. */
function drawPerspective(c: CanvasRenderingContext2D, f: Floating, m: Mat3, ctx: ToolContext, dpr: number) {
  const N = 10;
  const w = f.block.w;
  const h = f.block.h;
  const proj = (x: number, y: number) => {
    const ww = m[6] * x + m[7] * y + m[8];
    return ctx.toScreen({ x: (m[0] * x + m[1] * y + m[2]) / ww, y: (m[3] * x + m[4] * y + m[5]) / ww });
  };
  const tri = (s0: Point, s1: Point, s2: Point) => {
    const d0 = proj(s0.x, s0.y);
    const d1 = proj(s1.x, s1.y);
    const d2 = proj(s2.x, s2.y);
    // affine map from source triangle to destination triangle
    const den = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
    if (Math.abs(den) < 1e-9) return;
    const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / den;
    const b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / den;
    const cc = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / den;
    const d = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / den;
    const e = d0.x - a * s0.x - cc * s0.y;
    const ff = d0.y - b * s0.x - d * s0.y;
    c.save();
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.beginPath();
    // expand the clip slightly to hide seams between triangles
    const cx = (d0.x + d1.x + d2.x) / 3;
    const cy = (d0.y + d1.y + d2.y) / 3;
    const grow = (p: Point) => ({ x: p.x + Math.sign(p.x - cx) * 0.6, y: p.y + Math.sign(p.y - cy) * 0.6 });
    const g0 = grow(d0);
    const g1 = grow(d1);
    const g2 = grow(d2);
    c.moveTo(g0.x, g0.y);
    c.lineTo(g1.x, g1.y);
    c.lineTo(g2.x, g2.y);
    c.closePath();
    c.clip();
    c.setTransform(dpr * a, dpr * b, dpr * cc, dpr * d, dpr * e, dpr * ff);
    c.drawImage(f.image, 0, 0);
    c.restore();
  };
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x0 = (i / N) * w;
      const x1 = ((i + 1) / N) * w;
      const y0 = (j / N) * h;
      const y1 = ((j + 1) / N) * h;
      tri({ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 });
      tri({ x: x0, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 });
    }
}
