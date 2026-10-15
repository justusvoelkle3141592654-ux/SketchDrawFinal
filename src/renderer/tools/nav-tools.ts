// Pan, zoom and rotate view tools (also used for Space/gesture navigation).
import { rotateAt, zoomAt } from '../engine/view';
import type { Tool, ToolContext, ToolPointer } from './types';

export class PanTool implements Tool {
  private last: { x: number; y: number } | null = null;
  cursor() {
    return this.last ? 'grabbing' : 'grab';
  }
  down(p: ToolPointer) {
    this.last = { x: p.sx, y: p.sy };
    return true;
  }
  move(ps: ToolPointer[], ctx: ToolContext) {
    if (!this.last) return;
    const p = ps[ps.length - 1];
    const v = ctx.session.view;
    ctx.session.view = { ...v, panX: v.panX + p.sx - this.last.x, panY: v.panY + p.sy - this.last.y };
    this.last = { x: p.sx, y: p.sy };
    ctx.requestDraw();
  }
  up() {
    this.last = null;
  }
  cancel() {
    this.last = null;
  }
}

export class ZoomTool implements Tool {
  private start: { x: number; y: number; zoom: number } | null = null;
  private moved = false;
  cursor() {
    return 'zoom-in';
  }
  down(p: ToolPointer, ctx: ToolContext) {
    this.start = { x: p.sx, y: p.sy, zoom: ctx.session.view.zoom };
    this.moved = false;
    return true;
  }
  move(ps: ToolPointer[], ctx: ToolContext) {
    if (!this.start) return;
    const p = ps[ps.length - 1];
    const dx = p.sx - this.start.x;
    if (Math.abs(dx) > 3) this.moved = true;
    if (!this.moved) return;
    const doc = ctx.session.doc;
    const z = this.start.zoom * Math.pow(2, dx / 120);
    ctx.session.view = zoomAt(ctx.session.view, ctx.renderer.viewport, doc.width, doc.height, z, this.start);
    ctx.requestDraw();
  }
  up(p: ToolPointer, ctx: ToolContext) {
    if (this.start && !this.moved) {
      const doc = ctx.session.doc;
      const factor = p.alt ? 0.5 : 2;
      ctx.session.view = zoomAt(
        ctx.session.view,
        ctx.renderer.viewport,
        doc.width,
        doc.height,
        ctx.session.view.zoom * factor,
        { x: p.sx, y: p.sy },
      );
      ctx.requestDraw();
    }
    this.start = null;
  }
  cancel() {
    this.start = null;
  }
}

export class RotateTool implements Tool {
  private start: { angle: number; rotation: number } | null = null;
  cursor() {
    return 'grab';
  }
  private angleOf(p: ToolPointer, ctx: ToolContext) {
    const vp = ctx.renderer.viewport;
    return Math.atan2(p.sy - vp.height / 2, p.sx - vp.width / 2);
  }
  down(p: ToolPointer, ctx: ToolContext) {
    this.start = { angle: this.angleOf(p, ctx), rotation: ctx.session.view.rotation };
    return true;
  }
  move(ps: ToolPointer[], ctx: ToolContext) {
    if (!this.start) return;
    const p = ps[ps.length - 1];
    let r = this.start.rotation + this.angleOf(p, ctx) - this.start.angle;
    if (p.shift) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12);
    const vp = ctx.renderer.viewport;
    const doc = ctx.session.doc;
    ctx.session.view = rotateAt(ctx.session.view, vp, doc.width, doc.height, r, {
      x: vp.width / 2,
      y: vp.height / 2,
    });
    ctx.requestDraw();
  }
  up() {
    this.start = null;
  }
  cancel() {
    this.start = null;
  }
}
