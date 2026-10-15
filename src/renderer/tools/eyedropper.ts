// Eyedropper: samples the composite (or the active layer with Ctrl) into the foreground colour.
import type { RGB } from '../engine/color';
import { rgbToCss } from '../engine/color';
import { useColors } from '../state/colors';
import { useUi } from '../state/ui';
import type { Tool, ToolContext, ToolPointer } from './types';
import { frameOptions } from '../app/animation';

export function sampleColor(
  ctx: ToolContext,
  x: number,
  y: number,
  layerOnly: boolean,
): { rgb: RGB; a: number } | null {
  const doc = ctx.session.doc;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= doc.width || iy >= doc.height) return null;
  if (layerOnly) {
    const l = doc.activeRaster;
    if (!l) return null;
    const [r, g, b, a] = l.pixels.getPixel(ix, iy);
    if (!a) return null;
    return { rgb: { r: r / 255, g: g / 255, b: b / 255 }, a: a / 255 };
  }
  // what is visible: the current animation frame without onion skins
  const px = ctx.session.compositor.compositeToRGBA({ x: ix, y: iy, w: 1, h: 1 }, frameOptions(ctx.session));
  if (!px[3]) return null;
  return { rgb: { r: px[0] / 255, g: px[1] / 255, b: px[2] / 255 }, a: px[3] / 255 };
}

export class EyedropperTool implements Tool {
  private active = false;
  private before: RGB | null = null;
  private loupe: { x: number; y: number; color: RGB } | null = null;

  cursor() {
    return 'crosshair';
  }

  private pick(p: ToolPointer, ctx: ToolContext) {
    const c = sampleColor(ctx, p.x, p.y, p.ctrl);
    if (c) {
      useColors.getState().setFg(c.rgb);
      this.loupe = { x: p.sx, y: p.sy, color: c.rgb };
    }
    ctx.requestDraw();
  }

  down(p: ToolPointer, ctx: ToolContext) {
    this.active = true;
    this.before = useColors.getState().fg;
    this.pick(p, ctx);
    return true;
  }
  move(ps: ToolPointer[], ctx: ToolContext) {
    if (this.active) this.pick(ps[ps.length - 1], ctx);
  }
  up(_p: ToolPointer, ctx: ToolContext) {
    this.active = false;
    this.loupe = null;
    useColors.getState().pushRecent(useColors.getState().fg);
    ctx.requestDraw();
  }
  cancel(ctx: ToolContext) {
    if (this.before) useColors.getState().setFg(this.before);
    this.active = false;
    this.loupe = null;
    ctx.requestDraw();
  }
  overlay(c: CanvasRenderingContext2D) {
    if (!this.loupe || !this.before) return;
    const { x, y, color } = this.loupe;
    const R = 34;
    c.lineWidth = 10;
    c.beginPath();
    c.strokeStyle = rgbToCss(color);
    c.arc(x, y, R, Math.PI, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.strokeStyle = rgbToCss(this.before);
    c.arc(x, y, R, 0, Math.PI);
    c.stroke();
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(0,0,0,0.5)';
    c.beginPath();
    c.arc(x, y, R + 5.5, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(x, y, R - 5.5, 0, Math.PI * 2);
    c.stroke();
  }
}

/** Temporary eyedropper (Alt while painting, barrel button): restores the tool afterwards. */
export function isEyedropperActive() {
  return useUi.getState().tool === 'eyedropper';
}
