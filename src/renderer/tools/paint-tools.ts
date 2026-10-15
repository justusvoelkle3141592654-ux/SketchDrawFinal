// Fill, gradient, shape and crop tools.
import { create } from 'zustand';
import type { Point } from '../engine/geometry';
import { compoundEntry, TileDiffRecorder, type HistoryEntry } from '../engine/history';
import { drawGradient, fillCoverage, resizeCanvas, softenRegion } from '../engine/pixel-ops';
import { floodRegion, rasterizePolygon, ellipsePolygon, rectPolygon } from '../engine/selection';
import { StrokeEngine } from '../engine/stroke/stroke-engine';
import type { StrokeSample } from '../engine/stroke/pipeline';
import { cloneBrush } from '../engine/brush/schema';
import { useColors } from '../state/colors';
import { toolOpts } from '../state/tool-options';
import { toast, useUi } from '../state/ui';
import { useDocs } from '../state/documents';
import { currentBrush, paintableLayer } from './brush-tool';
import { sampleSource } from './select-tools';
import { symmetryTransforms } from './symmetry';
import type { Tool, ToolContext, ToolPointer } from './types';
import { requestRedraw } from '../app/actions';

// ------------------------------------------------------------------------------------- fill

export class FillTool implements Tool {
  cursor() {
    return 'cell';
  }
  down(p: ToolPointer, ctx: ToolContext) {
    const layer = paintableLayer(ctx);
    if (!layer) return false;
    const doc = ctx.session.doc;
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return false;
    const o = toolOpts().fill;
    const src = sampleSource(ctx, o.sampleAll);
    if (!src) return false;
    const region = floodRegion(src, doc.width, doc.height, x, y, o.tolerance, o.contiguous);
    const coverage = softenRegion(region, doc.width, doc.height, o.grow);
    const colors = useColors.getState();
    const rec = new TileDiffRecorder(layer.pixels);
    fillCoverage(doc, layer, rec, coverage, colors.fg, o.opacity * colors.fgAlpha);
    const e = rec.toEntry('Fill', (r) => doc.markPixelsChanged(r));
    if (e) ctx.session.history.push(e);
    doc.markPixelsChanged(null);
    colors.pushRecent(colors.fg);
    return false;
  }
  move() {}
  up() {}
  cancel() {}
}

// ------------------------------------------------------------------------------------- gradient

export class GradientTool implements Tool {
  private a: Point | null = null;
  private b: Point | null = null;
  cursor() {
    return 'crosshair';
  }
  down(p: ToolPointer, ctx: ToolContext) {
    if (!paintableLayer(ctx)) return false;
    this.a = { x: p.x, y: p.y };
    this.b = this.a;
    return true;
  }
  move(ps: ToolPointer[], ctx: ToolContext) {
    if (!this.a) return;
    const p = ps[ps.length - 1];
    let b = { x: p.x, y: p.y };
    if (p.shift) {
      // snap angle to 45°
      const ang = Math.round(Math.atan2(b.y - this.a.y, b.x - this.a.x) / (Math.PI / 4)) * (Math.PI / 4);
      const d = Math.hypot(b.x - this.a.x, b.y - this.a.y);
      b = { x: this.a.x + Math.cos(ang) * d, y: this.a.y + Math.sin(ang) * d };
    }
    this.b = b;
    ctx.requestDraw();
  }
  up(_p: ToolPointer, ctx: ToolContext) {
    const a = this.a;
    const b = this.b;
    this.a = this.b = null;
    if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) < 1) {
      ctx.requestDraw();
      return;
    }
    const layer = paintableLayer(ctx);
    if (!layer) return;
    const o = toolOpts().gradient;
    const c = useColors.getState();
    const doc = ctx.session.doc;
    const rec = new TileDiffRecorder(layer.pixels);
    drawGradient(
      doc,
      layer,
      rec,
      {
        kind: o.kind,
        x0: a.x,
        y0: a.y,
        x1: b.x,
        y1: b.y,
        from: c.fg,
        to: o.toTransparent ? c.fg : c.bg,
        fromAlpha: 1,
        toAlpha: o.toTransparent ? 0 : 1,
      },
      o.opacity * c.fgAlpha,
    );
    const e = rec.toEntry('Gradient', (r) => doc.markPixelsChanged(r));
    if (e) ctx.session.history.push(e);
    doc.markPixelsChanged(null);
    ctx.requestDraw();
  }
  cancel(ctx: ToolContext) {
    this.a = this.b = null;
    ctx.requestDraw();
  }
  overlay(c: CanvasRenderingContext2D, _i: unknown, ctx: ToolContext) {
    if (!this.a || !this.b) return;
    const a = ctx.toScreen(this.a);
    const b = ctx.toScreen(this.b);
    c.lineWidth = 2;
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.stroke();
    c.lineWidth = 1;
    c.strokeStyle = '#fff';
    c.stroke();
    for (const [p, filled] of [
      [a, true],
      [b, false],
    ] as const) {
      c.beginPath();
      c.arc(p.x, p.y, 5, 0, Math.PI * 2);
      c.fillStyle = filled ? '#fff' : 'rgba(0,0,0,0.6)';
      c.fill();
      c.strokeStyle = filled ? 'rgba(0,0,0,0.7)' : '#fff';
      c.stroke();
    }
    if (toolOpts().gradient.kind === 'radial') {
      c.setLineDash([4, 4]);
      c.beginPath();
      c.arc(a.x, a.y, Math.hypot(b.x - a.x, b.y - a.y), 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
    }
  }
}

// ------------------------------------------------------------------------------------- shapes

export type ShapeKind = 'line' | 'rect' | 'ellipse' | 'polygon' | 'polyline';
const SHAPE_LABELS: Record<ShapeKind, string> = {
  line: 'Line',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  polygon: 'Polygon',
  polyline: 'Polyline',
};

function regularPolygon(c: Point, r: number, sides: number, rot: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2;
    out.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
  }
  return out;
}

/** Densifies a polyline into stroke samples (constant pressure) so the brush engine can render it. */
function pathSamples(pts: Point[], closed: boolean): StrokeSample[] {
  const path = closed ? [...pts, pts[0]] : pts;
  const out: StrokeSample[] = [];
  let t = 0;
  for (let i = 0; i < path.length; i++) {
    out.push({ x: path[i].x, y: path[i].y, pressure: 1, tiltX: 0, tiltY: 0, twist: 0, time: t });
    if (i < path.length - 1)
      t += Math.max(1, Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y) / 4);
  }
  return out;
}

export function renderShape(ctx: ToolContext, kind: ShapeKind, pts: Point[], closed: boolean) {
  const layer = paintableLayer(ctx);
  if (!layer) return;
  const doc = ctx.session.doc;
  const o = toolOpts().shape;
  const colors = useColors.getState();
  const entries: HistoryEntry[] = [];
  const canFill =
    closed && kind !== 'line' && kind !== 'polyline' && (o.mode === 'fill' || o.mode === 'both');
  if (canFill) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    const bx = Math.max(0, Math.floor(x0));
    const by = Math.max(0, Math.floor(y0));
    const bw = Math.min(doc.width, Math.ceil(x1)) - bx;
    const bh = Math.min(doc.height, Math.ceil(y1)) - by;
    if (bw > 0 && bh > 0) {
      const cov = rasterizePolygon(pts, { x: bx, y: by, w: bw, h: bh }, true);
      const dense = new Uint8ClampedArray(doc.width * doc.height);
      for (let y = 0; y < bh; y++)
        for (let x = 0; x < bw; x++) dense[(by + y) * doc.width + bx + x] = cov[y * bw + x] * 255;
      const rec = new TileDiffRecorder(layer.pixels);
      fillCoverage(doc, layer, rec, dense, colors.fg, colors.fgAlpha);
      const e = rec.toEntry('Fill shape', (r) => doc.markPixelsChanged(r));
      if (e) entries.push(e);
    }
  }
  if (o.mode !== 'fill' || !closed || kind === 'line' || kind === 'polyline') {
    const brush = cloneBrush(currentBrush(false)!);
    brush.opacity *= colors.fgAlpha;
    brush.stroke.stabilizer = 'off';
    brush.stroke.smoothInterpolation = false;
    brush.stroke.airbrushRate = 0;
    const eng = new StrokeEngine(doc, layer, ctx.session.compositor, {
      brush,
      color: colors.fg,
      zoom: ctx.session.view.zoom,
      stabilizer: 'off',
      stabilizerAmount: 0,
      predictive: 0,
      symmetry: symmetryTransforms(ctx.session.assist.symmetry),
      selection: doc.selection,
      forceErase: false,
    });
    const samples = pathSamples(pts, closed);
    eng.begin(samples[0]);
    eng.addSamples(samples.slice(1));
    const e = eng.end();
    if (e) entries.push(e);
  }
  if (entries.length) ctx.session.history.push(compoundEntry(SHAPE_LABELS[kind], entries));
  doc.markPixelsChanged(null);
  useColors.getState().pushRecent(colors.fg);
}

function snapGrid(ctx: ToolContext, p: Point): Point {
  const g = ctx.session.assist.grid;
  if (!g.snap || !g.visible) return p;
  return { x: Math.round(p.x / g.size) * g.size, y: Math.round(p.y / g.size) * g.size };
}

export class ShapeTool implements Tool {
  private a: Point | null = null;
  private b: Point | null = null;
  private ctrl = false;
  private pts: Point[] = [];
  private hoverPt: Point | null = null;
  constructor(readonly kind: ShapeKind) {}
  cursor() {
    return 'crosshair';
  }
  private shape(): { pts: Point[]; closed: boolean } | null {
    if (this.kind === 'polyline')
      return this.pts.length
        ? { pts: this.hoverPt ? [...this.pts, this.hoverPt] : this.pts, closed: false }
        : null;
    if (!this.a || !this.b) return null;
    const a = this.a;
    let b = this.b;
    const o = toolOpts().shape;
    if (this.kind === 'line') {
      if (this.ctrl) {
        const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 12)) * (Math.PI / 12);
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        b = { x: a.x + Math.cos(ang) * d, y: a.y + Math.sin(ang) * d };
      }
      return { pts: [a, b], closed: false };
    }
    if (this.kind === 'polygon') {
      const r = Math.hypot(b.x - a.x, b.y - a.y);
      let rot = Math.atan2(b.y - a.y, b.x - a.x);
      if (this.ctrl) rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12);
      return { pts: regularPolygon(a, r, Math.max(3, Math.round(o.sides)), rot), closed: true };
    }
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    if (this.ctrl) {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * m;
      dy = Math.sign(dy || 1) * m;
    }
    const x0 = o.fromCenter ? a.x - dx : Math.min(a.x, a.x + dx);
    const y0 = o.fromCenter ? a.y - dy : Math.min(a.y, a.y + dy);
    const x1 = o.fromCenter ? a.x + dx : Math.max(a.x, a.x + dx);
    const y1 = o.fromCenter ? a.y + dy : Math.max(a.y, a.y + dy);
    const lx = Math.min(x0, x1);
    const ly = Math.min(y0, y1);
    const hx = Math.max(x0, x1);
    const hy = Math.max(y0, y1);
    if (this.kind === 'rect') return { pts: rectPolygon(lx, ly, hx, hy), closed: true };
    return { pts: ellipsePolygon((lx + hx) / 2, (ly + hy) / 2, (hx - lx) / 2, (hy - ly) / 2), closed: true };
  }
  down(p: ToolPointer, ctx: ToolContext) {
    const pt = snapGrid(ctx, { x: p.x, y: p.y });
    if (this.kind === 'polyline') {
      if (!paintableLayer(ctx)) return false;
      if (this.pts.length >= 2) {
        const f = ctx.toScreen(this.pts[0]);
        if (Math.hypot(f.x - p.sx, f.y - p.sy) < 10) {
          // clicking the first point closes the polyline
          this.finishPolyline(ctx, true);
          return false;
        }
      }
      this.pts.push(pt);
      ctx.requestDraw();
      return false;
    }
    if (!paintableLayer(ctx)) return false;
    this.a = pt;
    this.b = pt;
    this.ctrl = p.ctrl;
    return true;
  }
  move(ps: ToolPointer[], ctx: ToolContext) {
    if (!this.a) return;
    const p = ps[ps.length - 1];
    this.b = snapGrid(ctx, { x: p.x, y: p.y });
    this.ctrl = p.ctrl;
    ctx.requestDraw();
  }
  up(p: ToolPointer, ctx: ToolContext) {
    if (!this.a) return;
    this.b = snapGrid(ctx, { x: p.x, y: p.y });
    this.ctrl = p.ctrl;
    const s = this.shape();
    const big = this.b && Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y) * ctx.session.view.zoom > 2;
    this.a = this.b = null;
    if (s && big) renderShape(ctx, this.kind, s.pts, s.closed);
    ctx.requestDraw();
  }
  hover(p: ToolPointer, ctx: ToolContext) {
    if (this.kind === 'polyline' && this.pts.length) {
      this.hoverPt = snapGrid(ctx, { x: p.x, y: p.y });
      ctx.requestDraw();
    }
  }
  dblclick(_p: ToolPointer, ctx: ToolContext) {
    if (this.kind === 'polyline') this.finishPolyline(ctx, false);
  }
  private finishPolyline(ctx: ToolContext, closed: boolean) {
    const pts = this.pts;
    this.pts = [];
    this.hoverPt = null;
    if (pts.length >= 2) renderShape(ctx, 'polyline', pts, closed);
    ctx.requestDraw();
  }
  key(e: KeyboardEvent, ctx: ToolContext) {
    if (this.kind !== 'polyline' || !this.pts.length) return false;
    if (e.key === 'Enter') {
      this.finishPolyline(ctx, false);
      return true;
    }
    if (e.key === 'Escape') {
      this.pts = [];
      this.hoverPt = null;
      ctx.requestDraw();
      return true;
    }
    if (e.key === 'Backspace') {
      this.pts.pop();
      ctx.requestDraw();
      return true;
    }
    return false;
  }
  cancel(ctx: ToolContext) {
    this.a = this.b = null;
    ctx.requestDraw();
  }
  deactivate(ctx: ToolContext) {
    if (this.pts.length >= 2) this.finishPolyline(ctx, false);
    this.pts = [];
  }
  overlay(c: CanvasRenderingContext2D, _i: unknown, ctx: ToolContext) {
    const s = this.shape();
    if (!s || s.pts.length < 2) return;
    c.beginPath();
    s.pts.forEach((p, i) => {
      const q = ctx.toScreen(p);
      if (i) c.lineTo(q.x, q.y);
      else c.moveTo(q.x, q.y);
    });
    if (s.closed) c.closePath();
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(0,0,0,0.5)';
    c.stroke();
    c.lineWidth = 1.5;
    c.strokeStyle = 'rgba(93,214,200,0.95)';
    c.stroke();
  }
}

// ------------------------------------------------------------------------------------- crop

export class CropTool implements Tool {
  rect: { x: number; y: number; w: number; h: number } | null = null;
  /** False while the frame is the untouched whole canvas: dragging inside it then draws a new frame. */
  private custom = false;
  private drag: {
    mode: 'new' | 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
    start: Point;
    r0: { x: number; y: number; w: number; h: number };
  } | null = null;
  cursor() {
    return 'crosshair';
  }
  private ensure(ctx: ToolContext) {
    if (!this.rect) {
      const d = ctx.session.doc;
      this.rect = { x: 0, y: 0, w: d.width, h: d.height };
    }
  }
  private hitMode(p: ToolPointer, ctx: ToolContext): NonNullable<CropTool['drag']>['mode'] {
    const r = this.rect!;
    const tl = ctx.toScreen({ x: r.x, y: r.y });
    const br = ctx.toScreen({ x: r.x + r.w, y: r.y + r.h });
    const near = (a: number, b: number) => Math.abs(a - b) < 10;
    const minX = Math.min(tl.x, br.x);
    const maxX = Math.max(tl.x, br.x);
    const minY = Math.min(tl.y, br.y);
    const maxY = Math.max(tl.y, br.y);
    const n = near(p.sy, minY);
    const s = near(p.sy, maxY);
    const w = near(p.sx, minX);
    const e = near(p.sx, maxX);
    if (n && w) return 'nw';
    if (n && e) return 'ne';
    if (s && w) return 'sw';
    if (s && e) return 'se';
    if (n && p.sx > minX && p.sx < maxX) return 'n';
    if (s && p.sx > minX && p.sx < maxX) return 's';
    if (w && p.sy > minY && p.sy < maxY) return 'w';
    if (e && p.sy > minY && p.sy < maxY) return 'e';
    if (p.sx > minX && p.sx < maxX && p.sy > minY && p.sy < maxY) return 'move';
    return 'new';
  }
  down(p: ToolPointer, ctx: ToolContext) {
    this.ensure(ctx);
    let mode = this.hitMode(p, ctx);
    if (mode === 'move' && !this.custom) mode = 'new';
    this.custom = true;
    this.drag = { mode, start: { x: p.x, y: p.y }, r0: { ...this.rect! } };
    if (mode === 'new') this.rect = { x: p.x, y: p.y, w: 0, h: 0 };
    return true;
  }
  move(ps: ToolPointer[], ctx: ToolContext) {
    const d = this.drag;
    if (!d) return;
    const p = ps[ps.length - 1];
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    let { x, y, w, h } = d.r0;
    switch (d.mode) {
      case 'new':
        x = Math.min(d.start.x, p.x);
        y = Math.min(d.start.y, p.y);
        w = Math.abs(dx);
        h = Math.abs(dy);
        break;
      case 'move':
        x += dx;
        y += dy;
        break;
      default:
        if (d.mode.includes('n')) {
          y += dy;
          h -= dy;
        }
        if (d.mode.includes('s')) h += dy;
        if (d.mode.includes('w')) {
          x += dx;
          w -= dx;
        }
        if (d.mode.includes('e')) w += dx;
    }
    const ratio = toolOpts().crop.ratio;
    if (ratio !== 'free' && d.mode !== 'move') {
      const doc = ctx.session.doc;
      const k = ratio === 'square' ? 1 : doc.width / doc.height;
      h = w / k;
    }
    this.rect = {
      x: Math.round(x),
      y: Math.round(y),
      w: Math.max(1, Math.round(w)),
      h: Math.max(1, Math.round(h)),
    };
    useCropState.setState({ rect: this.rect });
    ctx.requestDraw();
  }
  up() {
    this.drag = null;
  }
  cancel(ctx: ToolContext) {
    this.drag = null;
    ctx.requestDraw();
  }
  apply(ctx: ToolContext) {
    const r = this.rect;
    if (!r || r.w < 1 || r.h < 1) return;
    const doc = ctx.session.doc;
    if (r.x === 0 && r.y === 0 && r.w === doc.width && r.h === doc.height) {
      toast('info', 'The crop covers the whole canvas.');
      return;
    }
    if (r.w > 16384 || r.h > 16384) return toast('warning', 'The cropped canvas would exceed 16 384 px.');
    const e = resizeCanvas(doc, r.w, r.h, -r.x, -r.y, 'Crop');
    ctx.session.history.push(e);
    ctx.session.assist.symmetry.cx = r.w / 2;
    ctx.session.assist.symmetry.cy = r.h / 2;
    this.rect = null;
    this.custom = false;
    useCropState.setState({ rect: null });
    useUi.getState().restorePreviousTool();
    useDocs.getState().bump();
    requestRedraw();
  }
  reset(ctx: ToolContext) {
    this.rect = null;
    this.custom = false;
    useCropState.setState({ rect: null });
    ctx.requestDraw();
  }
  key(e: KeyboardEvent, ctx: ToolContext) {
    if (e.key === 'Enter') {
      this.apply(ctx);
      return true;
    }
    if (e.key === 'Escape') {
      this.reset(ctx);
      return true;
    }
    return false;
  }
  deactivate(ctx: ToolContext) {
    this.reset(ctx);
  }
  overlay(
    c: CanvasRenderingContext2D,
    info: { viewport: { width: number; height: number } },
    ctx: ToolContext,
  ) {
    this.ensure(ctx);
    const r = this.rect!;
    const q = [
      ctx.toScreen({ x: r.x, y: r.y }),
      ctx.toScreen({ x: r.x + r.w, y: r.y }),
      ctx.toScreen({ x: r.x + r.w, y: r.y + r.h }),
      ctx.toScreen({ x: r.x, y: r.y + r.h }),
    ];
    // dim outside the crop
    c.fillStyle = 'rgba(0,0,0,0.5)';
    c.beginPath();
    c.rect(0, 0, info.viewport.width, info.viewport.height);
    c.moveTo(q[0].x, q[0].y);
    q.slice(1).forEach((p) => c.lineTo(p.x, p.y));
    c.closePath();
    c.fill('evenodd');
    c.strokeStyle = '#fff';
    c.lineWidth = 1;
    c.beginPath();
    q.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.closePath();
    c.stroke();
    // rule of thirds
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    for (const t of [1 / 3, 2 / 3]) {
      const a = ctx.toScreen({ x: r.x + r.w * t, y: r.y });
      const b = ctx.toScreen({ x: r.x + r.w * t, y: r.y + r.h });
      const cc = ctx.toScreen({ x: r.x, y: r.y + r.h * t });
      const d = ctx.toScreen({ x: r.x + r.w, y: r.y + r.h * t });
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.moveTo(cc.x, cc.y);
      c.lineTo(d.x, d.y);
      c.stroke();
    }
    c.fillStyle = '#fff';
    for (const p of q) c.fillRect(p.x - 4, p.y - 4, 8, 8);
  }
}

export const useCropState = create<{ rect: { x: number; y: number; w: number; h: number } | null }>(() => ({
  rect: null,
}));
