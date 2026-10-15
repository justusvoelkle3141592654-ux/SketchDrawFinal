import { describe, expect, it } from 'vitest';
import { RasterDocument } from '../../src/renderer/engine/document';
import { TileDiffRecorder } from '../../src/renderer/engine/history';
import {
  applyAdjustment,
  clearBlock,
  drawGradient,
  drawTransformedBlock,
  extractBlock,
  fillCoverage,
  flipDocument,
  homography,
  mat3Apply,
  mat3FromAffine,
  resizeCanvas,
  resizeImage,
  rotateDocument,
  transformMaskBlock,
  trimBlock,
} from '../../src/renderer/engine/pixel-ops';
import { polygonMask } from '../../src/renderer/engine/selection';
import { rectPolygon } from '../../src/renderer/engine/selection';
import type { TileGrid } from '../../src/renderer/engine/tiles';

function snap(g: TileGrid) {
  const m = new Map<number, string>();
  for (const [k, t] of g.tiles) m.set(k, Buffer.from(t).toString('base64'));
  return m;
}

function docWithSquare() {
  const doc = RasterDocument.createDefault({ width: 400, height: 300 });
  const l = doc.activeRaster!;
  for (let y = 100; y < 150; y++) for (let x = 50; x < 120; x++) l.pixels.setPixel(x, y, 200, 40, 10, 255);
  return { doc, l };
}

describe('extract, clear and transformed paste', () => {
  it('extract + trim returns the content bounds', () => {
    const { doc, l } = docWithSquare();
    const b = trimBlock(extractBlock(l.pixels, doc.bounds, null))!;
    expect([b.x, b.y, b.w, b.h]).toEqual([50, 100, 70, 50]);
  });
  it('integer translation copies pixels exactly and is undoable', () => {
    const { doc, l } = docWithSquare();
    const before = snap(l.pixels);
    const rec = new TileDiffRecorder(l.pixels);
    const block = trimBlock(extractBlock(l.pixels, doc.bounds, null))!;
    clearBlock(l.pixels, rec, { x: block.x, y: block.y, w: block.w, h: block.h }, null);
    drawTransformedBlock(l.pixels, rec, block, mat3FromAffine(1, 0, 0, 1, 200, 120), doc.bounds);
    expect(l.pixels.getPixel(55, 105)[3]).toBe(0);
    expect(l.pixels.getPixel(205, 125)).toEqual([200, 40, 10, 255]);
    const e = rec.toEntry('move', () => undefined)!;
    e.undo();
    expect(snap(l.pixels)).toEqual(before);
  });
  it('scaling up 2× keeps interior colour and alpha', () => {
    const { doc, l } = docWithSquare();
    const rec = new TileDiffRecorder(l.pixels);
    const block = trimBlock(extractBlock(l.pixels, doc.bounds, null))!;
    clearBlock(l.pixels, rec, block, null);
    drawTransformedBlock(l.pixels, rec, block, mat3FromAffine(2, 0, 0, 2, 100, 50), doc.bounds);
    expect(l.pixels.getPixel(170, 100)).toEqual([200, 40, 10, 255]);
    expect(l.pixels.getPixel(100 + 141, 100)[3]).toBe(0);
  });
  it('rotation keeps edge colour without dark fringes', () => {
    const { doc, l } = docWithSquare();
    const rec = new TileDiffRecorder(l.pixels);
    const block = trimBlock(extractBlock(l.pixels, doc.bounds, null))!;
    clearBlock(l.pixels, rec, block, null);
    const a = Math.PI / 7;
    drawTransformedBlock(
      l.pixels,
      rec,
      block,
      mat3FromAffine(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 200, 100),
      doc.bounds,
    );
    let semi = 0;
    for (const [, t] of l.pixels.tiles)
      for (let i = 0; i < t.length; i += 4)
        if (t[i + 3] > 0 && t[i + 3] < 255) {
          semi++;
          // straight colour of anti-aliased edge pixels stays the source colour
          expect(Math.abs(t[i] - 200)).toBeLessThanOrEqual(2);
          expect(Math.abs(t[i + 1] - 40)).toBeLessThanOrEqual(2);
        }
    expect(semi).toBeGreaterThan(50);
  });
  it('homography maps corners exactly', () => {
    const src = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ];
    const dst = [
      { x: 10, y: 20 },
      { x: 130, y: 5 },
      { x: 120, y: 90 },
      { x: 0, y: 70 },
    ];
    const H = homography(src, dst)!;
    src.forEach((p, i) => {
      const q = mat3Apply(H, p.x, p.y);
      expect(q.x).toBeCloseTo(dst[i].x, 6);
      expect(q.y).toBeCloseTo(dst[i].y, 6);
    });
  });
  it('selection-weighted clear only affects the selection', () => {
    const { doc, l } = docWithSquare();
    const sel = polygonMask(doc, rectPolygon(50, 100, 85, 150));
    clearBlock(l.pixels, new TileDiffRecorder(l.pixels), doc.bounds, sel);
    expect(l.pixels.getPixel(60, 120)[3]).toBe(0);
    expect(l.pixels.getPixel(100, 120)[3]).toBe(255);
  });
});

describe('selection follows a transform', () => {
  it('moves the mask with the content matrix, honouring the mask offset', () => {
    // mask covers (40..60, 30..50); content block starts at (45, 35): offset dx = -5, dy = -5
    const w = 20;
    const h = 20;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data[i * 4 + 3] = 255;
    const m = mat3FromAffine(1, 0, 0, 1, 45 + 100, 35 + 50); // content moved by (+100, +50)
    const mask = transformMaskBlock(
      { x: 0, y: 0, w, h, data },
      -5,
      -5,
      m,
      { x: 0, y: 0, w: 400, h: 300 },
      64,
    );
    expect(mask.getValue(140, 80)).toBe(255);
    expect(mask.getValue(159, 99)).toBe(255);
    expect(mask.getValue(139, 80)).toBe(0);
    expect(mask.getValue(160, 99)).toBe(0);
    expect(mask.getValue(45, 40)).toBe(0);
  });
  it('clips the moved mask to the canvas', () => {
    const data = new Uint8ClampedArray(10 * 10 * 4).fill(255);
    const mask = transformMaskBlock(
      { x: 0, y: 0, w: 10, h: 10, data },
      0,
      0,
      mat3FromAffine(1, 0, 0, 1, 395, 295),
      { x: 0, y: 0, w: 400, h: 300 },
      64,
    );
    expect(mask.getValue(399, 299)).toBe(255);
    expect(mask.getValue(400, 299)).toBe(0);
  });
});

describe('fill, gradient and adjustments', () => {
  it('fillCoverage fills with the colour and respects alpha lock', () => {
    const { doc, l } = docWithSquare();
    const cov = new Uint8Array(doc.width * doc.height);
    for (let y = 0; y < 300; y++) for (let x = 0; x < 100; x++) cov[y * doc.width + x] = 255;
    l.alphaLock = true;
    fillCoverage(doc, l, new TileDiffRecorder(l.pixels), cov, { r: 0, g: 0, b: 1 }, 1);
    expect(l.pixels.getPixel(60, 120)).toEqual([0, 0, 255, 255]);
    expect(l.pixels.getPixel(10, 10)[3]).toBe(0);
    l.alphaLock = false;
    fillCoverage(doc, l, new TileDiffRecorder(l.pixels), cov, { r: 0, g: 1, b: 0 }, 1);
    expect(l.pixels.getPixel(10, 10)).toEqual([0, 255, 0, 255]);
  });
  it('linear gradient runs from the start to the end colour', () => {
    const doc = RasterDocument.createDefault({ width: 256, height: 10 });
    const l = doc.activeRaster!;
    drawGradient(
      doc,
      l,
      new TileDiffRecorder(l.pixels),
      {
        kind: 'linear',
        x0: 0,
        y0: 5,
        x1: 256,
        y1: 5,
        from: { r: 0, g: 0, b: 0 },
        to: { r: 1, g: 1, b: 1 },
        fromAlpha: 1,
        toAlpha: 1,
      },
      1,
    );
    expect(l.pixels.getPixel(0, 5)[0]).toBeLessThanOrEqual(2);
    expect(l.pixels.getPixel(255, 5)[0]).toBeGreaterThanOrEqual(253);
    expect(Math.abs(l.pixels.getPixel(128, 5)[0] - 128)).toBeLessThanOrEqual(2);
  });
  it('invert and grayscale adjustments', () => {
    const { doc, l } = docWithSquare();
    applyAdjustment(doc, l, new TileDiffRecorder(l.pixels), { kind: 'invert' });
    expect(l.pixels.getPixel(60, 120)).toEqual([55, 215, 245, 255]);
    applyAdjustment(doc, l, new TileDiffRecorder(l.pixels), { kind: 'grayscale' });
    const p = l.pixels.getPixel(60, 120);
    expect(p[0]).toBe(p[1]);
    expect(p[1]).toBe(p[2]);
  });
});

describe('document operations', () => {
  it('rotate 90° swaps dimensions and moves pixels; undo restores', () => {
    const { doc, l } = docWithSquare();
    const before = snap(l.pixels);
    const e = rotateDocument(doc, 1);
    expect([doc.width, doc.height]).toEqual([300, 400]);
    // (50,100) → (h-1-y, x) = (199, 50)
    expect(l.pixels.getPixel(199, 50)[3]).toBe(255);
    e.undo();
    expect([doc.width, doc.height]).toEqual([400, 300]);
    expect(snap(l.pixels)).toEqual(before);
    e.redo();
    expect(doc.width).toBe(300);
  });
  it('flip horizontally mirrors pixels', () => {
    const { doc, l } = docWithSquare();
    flipDocument(doc, 'h');
    expect(l.pixels.getPixel(399 - 50, 100)[3]).toBe(255);
    expect(l.pixels.getPixel(50, 100)[3]).toBe(0);
  });
  it('canvas size offsets and crops', () => {
    const { doc, l } = docWithSquare();
    resizeCanvas(doc, 100, 100, -40, -90);
    expect([doc.width, doc.height]).toEqual([100, 100]);
    expect(l.pixels.getPixel(10, 10)[3]).toBe(255);
    expect(l.pixels.contentBounds()).toEqual({ x: 10, y: 10, w: 70, h: 50 });
  });
  it('image size resamples content proportionally', () => {
    const { doc, l } = docWithSquare();
    resizeImage(doc, 200, 150);
    expect([doc.width, doc.height]).toEqual([200, 150]);
    const b = l.pixels.contentBounds()!;
    expect(Math.abs(b.x - 25)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.w - 35)).toBeLessThanOrEqual(2);
    expect(l.pixels.getPixel(40, 60)).toEqual([200, 40, 10, 255]);
  });
});
