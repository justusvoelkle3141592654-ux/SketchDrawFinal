import { describe, expect, it } from 'vitest';
import {
  docToScreen,
  screenToDoc,
  zoomAt,
  rotateAt,
  fitView,
  nextZoomStep,
  MAX_ZOOM,
  MIN_ZOOM,
  type ViewState,
} from '../../src/renderer/engine/view';
import {
  forEachTileInRect,
  invert,
  multiply,
  rotate,
  translate,
  apply,
} from '../../src/renderer/engine/geometry';

const vp = { width: 1200, height: 800 };

describe('view transform', () => {
  const views: ViewState[] = [
    { zoom: 1, rotation: 0, panX: 0, panY: 0, flipX: false, flipY: false },
    { zoom: 2.5, rotation: 0.7, panX: 33, panY: -12, flipX: true, flipY: false },
    { zoom: 0.0625, rotation: -2.1, panX: -400, panY: 200, flipX: false, flipY: true },
    { zoom: 64, rotation: Math.PI, panX: 5, panY: 5, flipX: true, flipY: true },
  ];
  it('screenToDoc inverts docToScreen for zoom, rotation, pan and mirror', () => {
    for (const v of views) {
      for (const p of [
        { x: 0, y: 0 },
        { x: 1999.5, y: 3.25 },
        { x: -40, y: 870 },
      ]) {
        const s = docToScreen(v, vp, 2000, 1500, p);
        const back = screenToDoc(v, vp, 2000, 1500, s);
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);
      }
    }
  });
  it('the document centre sits at the viewport centre without pan', () => {
    const s = docToScreen(views[0], vp, 2000, 1500, { x: 1000, y: 750 });
    expect(s).toEqual({ x: 600, y: 400 });
  });
  it('zoomAt keeps the anchor point fixed', () => {
    const v = views[1];
    const anchor = { x: 321, y: 654 };
    const before = screenToDoc(v, vp, 2000, 1500, anchor);
    const z = zoomAt(v, vp, 2000, 1500, 7, anchor);
    const after = screenToDoc(z, vp, 2000, 1500, anchor);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(z.zoom).toBe(7);
  });
  it('rotateAt keeps the anchor point fixed', () => {
    const anchor = { x: 100, y: 100 };
    const before = screenToDoc(views[0], vp, 800, 600, anchor);
    const r = rotateAt(views[0], vp, 800, 600, 1.2, anchor);
    const after = screenToDoc(r, vp, 800, 600, anchor);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
  it('clamps zoom to 6.25 %–6400 %', () => {
    expect(zoomAt(views[0], vp, 10, 10, 1000, { x: 0, y: 0 }).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(views[0], vp, 10, 10, 0.0001, { x: 0, y: 0 }).zoom).toBe(MIN_ZOOM);
    expect(MIN_ZOOM).toBe(0.0625);
    expect(MAX_ZOOM).toBe(64);
  });
  it('fits the document inside the viewport', () => {
    const f = fitView(vp, 4000, 1000, 0);
    expect(f.zoom).toBeCloseTo(0.3, 6);
  });
  it('zoom steps move monotonically', () => {
    expect(nextZoomStep(1, 1)).toBe(1.5);
    expect(nextZoomStep(1, -1)).toBe(0.75);
    expect(nextZoomStep(64, 1)).toBe(64);
  });
});

describe('geometry', () => {
  it('matrix inverse', () => {
    const m = multiply(translate(10, -4), rotate(0.3));
    const p = apply(multiply(m, invert(m)), 7, 9);
    expect(p.x).toBeCloseTo(7, 9);
    expect(p.y).toBeCloseTo(9, 9);
  });
  it('splits rects into tile-aligned sub-rects that exactly cover the input', () => {
    const subs: { tx: number; ty: number; x: number; y: number; w: number; h: number }[] = [];
    forEachTileInRect({ x: 250, y: -10, w: 300, h: 20 }, 256, (tx, ty, s) => subs.push({ tx, ty, ...s }));
    expect(subs).toEqual([
      { tx: 0, ty: -1, x: 250, y: -10, w: 6, h: 10 },
      { tx: 1, ty: -1, x: 256, y: -10, w: 256, h: 10 },
      { tx: 2, ty: -1, x: 512, y: -10, w: 38, h: 10 },
      { tx: 0, ty: 0, x: 250, y: 0, w: 6, h: 10 },
      { tx: 1, ty: 0, x: 256, y: 0, w: 256, h: 10 },
      { tx: 2, ty: 0, x: 512, y: 0, w: 38, h: 10 },
    ]);
    expect(subs.reduce((s, r) => s + r.w * r.h, 0)).toBe(300 * 20);
  });
});
