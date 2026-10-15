import { describe, expect, it } from 'vitest';
import { RasterDocument } from '../../src/renderer/engine/document';
import {
  combineMasks,
  ellipsePolygon,
  featherMask,
  floodRegion,
  growMask,
  invertMask,
  maskBounds,
  maskOutline,
  polygonMask,
  rasterizePolygon,
  rectPolygon,
  selectAllMask,
  selectionEntry,
} from '../../src/renderer/engine/selection';

const doc = () => RasterDocument.createDefault({ width: 300, height: 200 });

describe('polygon rasterisation', () => {
  it('fills an axis-aligned rectangle exactly with partial edge coverage', () => {
    const cov = rasterizePolygon(rectPolygon(10.5, 20, 30, 40), { x: 0, y: 0, w: 50, h: 50 });
    expect(cov[25 * 50 + 20]).toBeCloseTo(1, 5);
    expect(cov[25 * 50 + 10]).toBeCloseTo(0.5, 5); // half-covered column
    expect(cov[25 * 50 + 30]).toBe(0);
    expect(cov[19 * 50 + 20]).toBe(0);
    const total = cov.reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(19.5 * 20, 3);
  });
  it('ellipse area matches πab within 1 %', () => {
    const cov = rasterizePolygon(ellipsePolygon(100, 100, 60, 30), { x: 0, y: 0, w: 200, h: 200 });
    const total = cov.reduce((s, v) => s + v, 0);
    expect(Math.abs(total - Math.PI * 60 * 30) / (Math.PI * 60 * 30)).toBeLessThan(0.01);
  });
  it('handles self-intersecting lasso shapes with non-zero winding', () => {
    const pts = [
      { x: 10, y: 10 },
      { x: 90, y: 90 },
      { x: 90, y: 10 },
      { x: 10, y: 90 },
    ];
    const cov = rasterizePolygon(pts, { x: 0, y: 0, w: 100, h: 100 });
    expect(cov[50 * 100 + 80]).toBeGreaterThan(0.99);
    expect(cov[20 * 100 + 50]).toBe(0);
  });
  it('polygonMask clips to the document', () => {
    const d = doc();
    const m = polygonMask(d, rectPolygon(-50, -50, 400, 400));
    expect(maskBounds(m)).toEqual({ x: 0, y: 0, w: 300, h: 200 });
  });
});

describe('selection combine, invert, feather, grow', () => {
  it('add, subtract and intersect', () => {
    const d = doc();
    const a = polygonMask(d, rectPolygon(0, 0, 100, 100));
    const b = polygonMask(d, rectPolygon(50, 50, 150, 150));
    expect(maskBounds(combineMasks(a, b, 'add')!)).toEqual({ x: 0, y: 0, w: 150, h: 150 });
    const sub = combineMasks(a, b, 'subtract')!;
    expect(sub.getValue(75, 75)).toBe(0);
    expect(sub.getValue(25, 25)).toBe(255);
    expect(maskBounds(combineMasks(a, b, 'intersect')!)).toEqual({ x: 50, y: 50, w: 50, h: 50 });
    expect(combineMasks(a, polygonMask(d, rectPolygon(200, 150, 220, 170)), 'intersect')).toBeNull();
    // inputs untouched
    expect(a.getValue(75, 75)).toBe(255);
  });
  it('invert and select all', () => {
    const d = doc();
    const all = selectAllMask(d);
    expect(maskBounds(all)).toEqual({ x: 0, y: 0, w: 300, h: 200 });
    const inv = invertMask(d, polygonMask(d, rectPolygon(0, 0, 300, 100)))!;
    expect(maskBounds(inv)).toEqual({ x: 0, y: 100, w: 300, h: 100 });
    expect(invertMask(d, all)).toBeNull();
  });
  it('feather softens edges symmetrically', () => {
    const d = doc();
    const m = featherMask(d, polygonMask(d, rectPolygon(100, 0, 300, 200)), 8)!;
    expect(m.getValue(100, 100)).toBeGreaterThan(100);
    expect(m.getValue(100, 100)).toBeLessThan(155);
    expect(m.getValue(80, 100)).toBeLessThan(20);
    expect(m.getValue(130, 100)).toBeGreaterThan(240);
  });
  it('grow and shrink by pixels', () => {
    const d = doc();
    const m = polygonMask(d, rectPolygon(100, 50, 150, 100));
    expect(maskBounds(growMask(d, m, 5)!)).toEqual({ x: 95, y: 45, w: 60, h: 60 });
    expect(maskBounds(growMask(d, m, -5)!)).toEqual({ x: 105, y: 55, w: 40, h: 40 });
  });
  it('outline segments trace the boundary', () => {
    const d = doc();
    const segs = maskOutline(polygonMask(d, rectPolygon(10, 10, 20, 30)), d.width, d.height);
    // four merged edges of the rectangle
    expect(segs.length / 4).toBe(4);
  });
  it('selection history entries swap masks', () => {
    const d = doc();
    const m = selectAllMask(d);
    const e = selectionEntry(d, 'Select all', null, m);
    e.redo();
    expect(d.selection).toBe(m);
    e.undo();
    expect(d.selection).toBeNull();
  });
});

describe('flood fill region', () => {
  it('contiguous vs global with tolerance', () => {
    const w = 10;
    const h = 1;
    const rgba = new Uint8ClampedArray(w * h * 4);
    const set = (x: number, v: number) => rgba.set([v, v, v, 255], x * 4);
    [0, 0, 5, 0, 200, 0, 0, 3, 0, 0].forEach((v, x) => set(x, v));
    const contiguous = floodRegion(rgba, w, h, 0, 0, 0.03, true);
    expect([...contiguous].map((v) => (v ? 1 : 0))).toEqual([1, 1, 1, 1, 0, 0, 0, 0, 0, 0]);
    const global = floodRegion(rgba, w, h, 0, 0, 0.03, false);
    expect([...global].map((v) => (v ? 1 : 0))).toEqual([1, 1, 1, 1, 0, 1, 1, 1, 1, 1]);
    const strict = floodRegion(rgba, w, h, 0, 0, 0, true);
    expect([...strict].map((v) => (v ? 1 : 0))).toEqual([1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
  it('fills a closed shape without leaking', () => {
    const w = 20;
    const h = 20;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w; i++) {
      rgba.set([0, 0, 0, 255], (5 * w + i) * 4);
      rgba.set([0, 0, 0, 255], (15 * w + i) * 4);
    }
    const r = floodRegion(rgba, w, h, 10, 10, 0.1, true);
    let count = 0;
    for (const v of r) if (v) count++;
    expect(count).toBe(w * 9);
  });
});
