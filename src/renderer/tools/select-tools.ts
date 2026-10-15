// Selection tools: rectangle, ellipse, freehand lasso, polygonal lasso and magic wand.
import type { Point } from '../engine/geometry';
import {
  ellipsePolygon,
  floodRegion,
  polygonMask,
  rectPolygon,
  denseToMask,
  type CombineMode,
} from '../engine/selection';
import { commitSelection } from '../app/selection-actions';
import { toolOpts } from '../state/tool-options';
import type { Tool, ToolContext, ToolPointer } from './types';
import { Compositor } from '../engine/compositor';
import { toast } from '../state/ui';
import { frameOptions } from '../app/animation';

/** Modifier keys at pointer-down override the combine mode: Shift add, Alt subtract, both intersect. */
function combineFor(p: ToolPointer): CombineMode {
  if (p.shift && p.alt) return 'intersect';
  if (p.shift) return 'add';
  if (p.alt) return 'subtract';
  return toolOpts().select.combine;
}

function drawPreview(
  c: CanvasRenderingContext2D,
  pts: Point[],
  toScreen: (p: Point) => Point,
  closed: boolean,
) {
  if (pts.length < 2) return;
  c.beginPath();
  pts.forEach((p, i) => {
    const s = toScreen(p);
    if (i) c.lineTo(s.x, s.y);
    else c.moveTo(s.x, s.y);
  });
  if (closed) c.closePath();
  c.lineWidth = 1;
  c.setLineDash([5, 4]);
  c.strokeStyle = 'rgba(0,0,0,0.85)';
  c.stroke();
  c.lineDashOffset = 4.5;
  c.strokeStyle = 'rgba(255,255,255,0.95)';
  c.stroke();
  c.setLineDash([]);
}

type Shape = 'rect' | 'ellipse';

export class MarqueeTool implements Tool {
  private start: Point | null = null;
  private end: Point | null = null;
  private mode: CombineMode = 'replace';
  private moved = false;
  constructor(readonly shape: Shape) {}
  cursor() {
    return 'crosshair';
  }
  private polygon(ctrl: boolean): Point[] {
    const a = this.start!;
    let b = this.end!;
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    if (ctrl) {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * m;
      dy = Math.sign(dy || 1) * m;
      b = { x: a.x + dx, y: a.y + dy };
    }
    const fromCenter = toolOpts().select.fromCenter;
    const x0 = fromCenter ? a.x - dx : Math.min(a.x, b.x);
    const y0 = fromCenter ? a.y - dy : Math.min(a.y, b.y);
    const x1 = fromCenter ? a.x + dx : Math.max(a.x, b.x);
    const y1 = fromCenter ? a.y + dy : Math.max(a.y, b.y);
    const lx = Math.min(x0, x1);
    const ly = Math.min(y0, y1);
    const hx = Math.max(x0, x1);
    const hy = Math.max(y0, y1);
    if (this.shape === 'rect')
      return rectPolygon(Math.round(lx), Math.round(ly), Math.round(hx), Math.round(hy));
    return ellipsePolygon((lx + hx) / 2, (ly + hy) / 2, (hx - lx) / 2, (hy - ly) / 2);
  }
  private ctrl = false;
  down(p: ToolPointer) {
    this.start = { x: p.x, y: p.y };
    this.end = this.start;
    this.mode = combineFor(p);
    this.moved = false;
    this.ctrl = p.ctrl;
    return true;
  }
  move(ps: ToolPointer[], ctx: ToolContext) {
    if (!this.start) return;
    const p = ps[ps.length - 1];
    this.end = { x: p.x, y: p.y };
    this.ctrl = p.ctrl;
    if (Math.hypot(p.x - this.start.x, p.y - this.start.y) * ctx.session.view.zoom > 3) this.moved = true;
    ctx.requestDraw();
  }
  up(p: ToolPointer, ctx: ToolContext) {
    if (!this.start) return;
    this.end = { x: p.x, y: p.y };
    const s = ctx.session;
    if (!this.moved) {
      // a click without dragging deselects (in replace mode)
      if (this.mode === 'replace' && s.doc.selection) commitSelection(s, null, 'replace', 'Deselect', 0);
    } else {
      const poly = this.polygon(p.ctrl || this.ctrl);
      const mask = polygonMask(s.doc, poly, toolOpts().select.antialias);
      commitSelection(
        s,
        mask,
        this.mode,
        this.shape === 'rect' ? 'Rectangle selection' : 'Ellipse selection',
      );
    }
    this.start = this.end = null;
    ctx.requestDraw();
  }
  cancel(ctx: ToolContext) {
    this.start = this.end = null;
    ctx.requestDraw();
  }
  overlay(c: CanvasRenderingContext2D, _i: unknown, ctx: ToolContext) {
    if (!this.start || !this.end || !this.moved) return;
    drawPreview(c, this.polygon(this.ctrl), ctx.toScreen, true);
  }
}

export class LassoTool implements Tool {
  private pts: Point[] = [];
  private mode: CombineMode = 'replace';
  private active = false;
  cursor() {
    return 'crosshair';
  }
  down(p: ToolPointer) {
    this.pts = [{ x: p.x, y: p.y }];
    this.mode = combineFor(p);
    this.active = true;
    return true;
  }
  move(ps: ToolPointer[], ctx: ToolContext) {
    if (!this.active) return;
    for (const p of ps) {
      const last = this.pts[this.pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) * ctx.session.view.zoom >= 1.5)
        this.pts.push({ x: p.x, y: p.y });
    }
    ctx.requestDraw();
  }
  up(_p: ToolPointer, ctx: ToolContext) {
    if (!this.active) return;
    this.active = false;
    const s = ctx.session;
    if (this.pts.length < 3) {
      if (this.mode === 'replace' && s.doc.selection) commitSelection(s, null, 'replace', 'Deselect', 0);
    } else
      commitSelection(
        s,
        polygonMask(s.doc, this.pts, toolOpts().select.antialias),
        this.mode,
        'Lasso selection',
      );
    this.pts = [];
    ctx.requestDraw();
  }
  cancel(ctx: ToolContext) {
    this.active = false;
    this.pts = [];
    ctx.requestDraw();
  }
  overlay(c: CanvasRenderingContext2D, _i: unknown, ctx: ToolContext) {
    if (this.active) drawPreview(c, this.pts, ctx.toScreen, false);
  }
}

/** Click to add points; click the first point, double-click or press Enter to close; Esc cancels; Backspace removes. */
export class PolygonLassoTool implements Tool {
  private pts: Point[] = [];
  private hoverPt: Point | null = null;
  private mode: CombineMode = 'replace';
  cursor() {
    return 'crosshair';
  }
  down(p: ToolPointer, ctx: ToolContext) {
    const pt = { x: p.x, y: p.y };
    if (!this.pts.length) this.mode = combineFor(p);
    if (this.pts.length >= 3) {
      const f = ctx.toScreen(this.pts[0]);
      if (Math.hypot(f.x - p.sx, f.y - p.sy) < 10) {
        this.finish(ctx);
        return false;
      }
    }
    this.pts.push(pt);
    ctx.requestDraw();
    return false; // no drag session needed
  }
  move() {}
  up() {}
  hover(p: ToolPointer, ctx: ToolContext) {
    this.hoverPt = { x: p.x, y: p.y };
    if (this.pts.length) ctx.requestDraw();
  }
  dblclick(_p: ToolPointer, ctx: ToolContext) {
    if (this.pts.length >= 3) this.finish(ctx);
  }
  private finish(ctx: ToolContext) {
    const s = ctx.session;
    if (this.pts.length >= 3)
      commitSelection(
        s,
        polygonMask(s.doc, this.pts, toolOpts().select.antialias),
        this.mode,
        'Polygon selection',
      );
    this.pts = [];
    this.hoverPt = null;
    ctx.requestDraw();
  }
  cancel(ctx: ToolContext) {
    this.pts = [];
    ctx.requestDraw();
  }
  key(e: KeyboardEvent, ctx: ToolContext) {
    if (!this.pts.length) return false;
    if (e.key === 'Enter') {
      this.finish(ctx);
      return true;
    }
    if (e.key === 'Escape') {
      this.cancel(ctx);
      return true;
    }
    if (e.key === 'Backspace') {
      this.pts.pop();
      ctx.requestDraw();
      return true;
    }
    return false;
  }
  deactivate(ctx: ToolContext) {
    this.cancel(ctx);
  }
  overlay(c: CanvasRenderingContext2D, _i: unknown, ctx: ToolContext) {
    if (!this.pts.length) return;
    drawPreview(c, this.hoverPt ? [...this.pts, this.hoverPt] : this.pts, ctx.toScreen, false);
    const f = ctx.toScreen(this.pts[0]);
    c.fillStyle = 'rgba(93,214,200,0.95)';
    c.beginPath();
    c.arc(f.x, f.y, 5, 0, Math.PI * 2);
    c.fill();
  }
}

/** Returns the straight RGBA source used by the wand and fill tools. */
export function sampleSource(ctx: ToolContext, all: boolean): Uint8ClampedArray | null {
  const doc = ctx.session.doc;
  if (all)
    return new Compositor(doc).compositeToRGBA(doc.bounds, {
      ...frameOptions(ctx.session),
      skipBackground: false,
    });
  const l = doc.activeRaster;
  if (!l) return null;
  return l.pixels.readRect(doc.bounds);
}

export class WandTool implements Tool {
  cursor() {
    return 'crosshair';
  }
  down(p: ToolPointer, ctx: ToolContext) {
    const doc = ctx.session.doc;
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return false;
    const o = toolOpts().wand;
    const src = sampleSource(ctx, o.sampleAll);
    if (!src) {
      toast('info', 'Select a paint layer or sample all layers.');
      return false;
    }
    const region = floodRegion(src, doc.width, doc.height, x, y, o.tolerance, o.contiguous);
    commitSelection(
      ctx.session,
      denseToMask(doc, new Uint8ClampedArray(region.buffer)),
      combineFor(p),
      'Magic wand selection',
    );
    ctx.requestDraw();
    return false;
  }
  move() {}
  up() {}
  cancel() {}
}
