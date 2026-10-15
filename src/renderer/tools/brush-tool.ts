// Brush and eraser tool: drives the stroke engine from pointer samples.
import { StrokeEngine } from '../engine/stroke/stroke-engine';
import type { StrokeSample } from '../engine/stroke/pipeline';
import { cloneBrush, type BrushPreset } from '../engine/brush/schema';
import { isEffectivelyVisible } from '../engine/layers';
import { useBrushes } from '../state/brushes';
import { useColors } from '../state/colors';
import { getPrefs } from '../state/preferences';
import { toast, useUi } from '../state/ui';
import { symmetryTransforms } from './symmetry';
import { createGuideSnapper, type GuideSnapper } from './guides';
import type { Tool, ToolContext, ToolPointer } from './types';
import type { Point } from '../engine/geometry';

export function currentBrush(eraser: boolean): BrushPreset | undefined {
  const s = useBrushes.getState();
  return s.get(eraser ? s.activeEraserId : s.activeBrushId) ?? s.brushes[0];
}

/** Checks the active layer can be painted; shows a toast otherwise. */
export function paintableLayer(ctx: ToolContext) {
  const doc = ctx.session.doc;
  const layer = doc.activeLayer;
  if (!layer) {
    toast('warning', 'Select a layer first.');
    return null;
  }
  if (layer.kind !== 'raster') {
    toast('warning', 'Groups cannot be painted on. Select a paint layer inside the group.');
    return null;
  }
  if (layer.locked) {
    toast('warning', `"${layer.name}" is locked.`);
    return null;
  }
  if (!isEffectivelyVisible(doc.layers, layer.id)) {
    toast('warning', `"${layer.name}" is hidden. Show it to paint on it.`);
    return null;
  }
  return layer;
}

function toSample(p: ToolPointer): StrokeSample {
  return {
    x: p.x,
    y: p.y,
    pressure: p.pressure,
    tiltX: p.tiltX,
    tiltY: p.tiltY,
    twist: p.twist,
    time: p.time,
  };
}

export class BrushTool implements Tool {
  private engine: StrokeEngine | null = null;
  private lastEnd: Point | null = null;
  private snapper: GuideSnapper | null = null;
  hoverPoint: Point | null = null;

  constructor(readonly eraser: boolean) {}

  cursor(): string {
    return getPrefs().showBrushOutline ? 'none' : 'crosshair';
  }

  down(p: ToolPointer, ctx: ToolContext): boolean {
    const layer = paintableLayer(ctx);
    if (!layer) return false;
    const penEraser = p.eraser;
    const preset = currentBrush(this.eraser || penEraser);
    if (!preset) return false;
    const brush: BrushPreset = cloneBrush(preset);
    const colors = useColors.getState();
    brush.opacity *= colors.fgAlpha;
    const prefs = getPrefs();
    const stab =
      brush.stroke.stabilizer === 'inherit'
        ? prefs.stabilizer
        : { mode: brush.stroke.stabilizer, amount: brush.stroke.stabilizerAmount };
    const session = ctx.session;
    this.engine = new StrokeEngine(session.doc, layer, session.compositor, {
      brush,
      color: colors.fg,
      zoom: session.view.zoom,
      stabilizer: stab.mode,
      stabilizerAmount: stab.amount,
      predictive: prefs.predictive.enabled ? prefs.predictive.strength : 0,
      symmetry: symmetryTransforms(session.assist.symmetry),
      selection: session.doc.selection,
      forceErase: this.eraser || penEraser,
    });
    session.usedBrushIds.add(preset.id);
    this.snapper = createGuideSnapper(session, { x: p.x, y: p.y }, p.sx, p.sy);
    const start = this.snap(p);
    if (p.shift && this.lastEnd) {
      // Shift+click: straight line from the end of the previous stroke
      this.engine.begin({ ...toSample(p), x: this.lastEnd.x, y: this.lastEnd.y });
      this.engine.addSamples([start]);
    } else {
      this.engine.begin(start);
    }
    useUi.getState().setDrawing(true);
    return true;
  }

  private snap(p: ToolPointer): StrokeSample {
    const s = toSample(p);
    if (!this.snapper) return s;
    const q = this.snapper(s.x, s.y);
    return { ...s, x: q.x, y: q.y };
  }

  move(ps: ToolPointer[], ctx: ToolContext): void {
    if (!this.engine) return;
    this.engine.addSamples(ps.map((p) => this.snap(p)));
    const last = ps[ps.length - 1];
    this.hoverPoint = { x: last.sx, y: last.sy };
    ctx.requestDraw();
  }

  frame(time: number): void {
    this.engine?.tick(time);
  }

  up(p: ToolPointer, ctx: ToolContext): void {
    if (!this.engine) return;
    const engine = this.engine;
    this.engine = null;
    const entry = engine.end();
    if (entry) ctx.session.history.push(entry);
    const s = this.snap(p);
    this.lastEnd = { x: s.x, y: s.y };
    this.snapper = null;
    if (!this.eraser && !p.eraser) useColors.getState().pushRecent(useColors.getState().fg);
    useUi.getState().setDrawing(false);
  }

  cancel(ctx: ToolContext): void {
    // A lost/cancelled pointer commits what was drawn so far; nothing connects to later strokes.
    if (!this.engine) return;
    const engine = this.engine;
    this.engine = null;
    this.snapper = null;
    this.lastEnd = null;
    const entry = engine.end();
    if (entry) ctx.session.history.push(entry);
    useUi.getState().setDrawing(false);
  }

  abort(): void {
    if (!this.engine) return;
    this.engine.cancel();
    this.engine = null;
    this.snapper = null;
    useUi.getState().setDrawing(false);
  }

  hover(p: ToolPointer, ctx: ToolContext): void {
    this.hoverPoint = { x: p.sx, y: p.sy };
    ctx.requestDraw();
  }

  overlay(c: CanvasRenderingContext2D, info: { zoom: number }, _ctx: ToolContext): void {
    const ui = useUi.getState();
    if (!getPrefs().showBrushOutline || !ui.pointer.inside) return;
    const brush = currentBrush(this.eraser);
    if (!brush) return;
    const r = Math.max(0.5, (brush.diameter / 2) * info.zoom);
    const { x, y } = ui.pointer;
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(0,0,0,0.55)';
    c.beginPath();
    c.arc(x, y, r + 0.5, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.beginPath();
    c.arc(x, y, Math.max(0.5, r - 0.5), 0, Math.PI * 2);
    c.stroke();
    if (r < 4) {
      c.strokeStyle = 'rgba(255,255,255,0.9)';
      c.beginPath();
      c.moveTo(x - 6, y);
      c.lineTo(x - 2, y);
      c.moveTo(x + 2, y);
      c.lineTo(x + 6, y);
      c.moveTo(x, y - 6);
      c.lineTo(x, y - 2);
      c.moveTo(x, y + 2);
      c.lineTo(x, y + 6);
      c.stroke();
    }
  }
}
