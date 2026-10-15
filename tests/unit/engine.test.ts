import { describe, expect, it } from 'vitest';
import { RasterDocument } from '../../src/renderer/engine/document';
import { Compositor } from '../../src/renderer/engine/compositor';
import { History } from '../../src/renderer/engine/history';
import { StrokeEngine, mirrorX, type StrokeSettings } from '../../src/renderer/engine/stroke/stroke-engine';
import { FACTORY_BRUSHES } from '../../src/renderer/engine/brush/presets';
import { cloneBrush, createBrush, type BrushPreset } from '../../src/renderer/engine/brush/schema';
import { createGroupLayer, createRasterLayer, type RasterLayer } from '../../src/renderer/engine/layers';
import type { TileGrid } from '../../src/renderer/engine/tiles';
import { MaskGrid } from '../../src/renderer/engine/tiles';
import type { StrokeSample } from '../../src/renderer/engine/stroke/pipeline';
import type { Rect } from '../../src/renderer/engine/geometry';

const S = (x: number, y: number, time: number, pressure = 1): StrokeSample => ({
  x,
  y,
  pressure,
  tiltX: 0,
  tiltY: 0,
  twist: 0,
  time,
});

function settings(brush: BrushPreset, extra: Partial<StrokeSettings> = {}): StrokeSettings {
  return {
    brush,
    color: { r: 1, g: 0, b: 0 },
    zoom: 1,
    stabilizer: 'off',
    stabilizerAmount: 0,
    predictive: 0,
    symmetry: [],
    selection: null,
    forceErase: false,
    seed: 42,
    ...extra,
  };
}

function hardBrush(diameter = 10): BrushPreset {
  return createBrush({
    id: 'test.hard',
    name: 'Hard',
    tip: { shape: 'round', hardness: 1, aspect: 1, angle: 0, antialias: true },
    diameter,
    minDiameter: 1,
    dynamics: [],
    stroke: {
      spacing: 0.1,
      accumulate: 'max',
      blendMode: 'normal',
      stabilizer: 'off',
      stabilizerAmount: 0,
      airbrushRate: 0,
      smoothInterpolation: false,
    },
  });
}

function snapshot(grid: TileGrid): Map<number, string> {
  const m = new Map<number, string>();
  for (const [k, t] of grid.tiles) m.set(k, Buffer.from(t).toString('base64'));
  return m;
}

function drawLine(
  doc: RasterDocument,
  layer: RasterLayer,
  brush: BrushPreset,
  pts: [number, number][],
  extra: Partial<StrokeSettings> = {},
) {
  const comp = new Compositor(doc);
  const eng = new StrokeEngine(doc, layer, comp, settings(brush, extra));
  eng.begin(S(pts[0][0], pts[0][1], 0));
  eng.addSamples(pts.slice(1).map((p, i) => S(p[0], p[1], (i + 1) * 8)));
  return eng.end();
}

describe('stroke engine', () => {
  it('paints an opaque, anti-aliased line and invalidates only nearby regions', () => {
    const doc = RasterDocument.createDefault({ width: 600, height: 400 });
    const layer = doc.activeRaster!;
    const dirty: (Rect | null)[] = [];
    doc.onDirty((r) => dirty.push(r));
    const comp = new Compositor(doc);
    const eng = new StrokeEngine(doc, layer, comp, settings(hardBrush(10)));
    eng.begin(S(50, 200.5, 0));
    eng.addSamples([S(300, 200.5, 16)]);
    // live preview: layer untouched, compositor shows the stroke
    expect(layer.pixels.tileCount).toBe(0);
    const out = comp.compositeToRGBA({ x: 150, y: 200, w: 1, h: 1 });
    expect([...out]).toEqual([255, 0, 0, 255]);
    const partialDirty = dirty.filter((r): r is Rect => !!r);
    expect(partialDirty.length).toBeGreaterThan(0);
    for (const r of partialDirty) expect(r.h).toBeLessThanOrEqual(14);
    const entry = eng.end();
    expect(entry).not.toBeNull();
    expect(layer.pixels.getPixel(150, 200)).toEqual([255, 0, 0, 255]);
    expect(layer.pixels.getPixel(150, 210)).toEqual([0, 0, 0, 0]);
    const edge = layer.pixels.getPixel(150, 205)[3];
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
    // no colour fringe: edge pixels keep the pure stroke colour
    expect(layer.pixels.getPixel(150, 205).slice(0, 3)).toEqual([255, 0, 0]);
  });

  it('undo restores the exact previous pixels, redo restores the stroke', () => {
    const doc = RasterDocument.createDefault({ width: 700, height: 700 });
    const layer = doc.activeRaster!;
    const history = new History();
    const e1 = drawLine(doc, layer, hardBrush(20), [
      [10, 10],
      [600, 650],
      [100, 690],
    ]);
    history.push(e1!);
    const after1 = snapshot(layer.pixels);
    const e2 = drawLine(doc, layer, cloneBrush(FACTORY_BRUSHES.find((b) => b.id === 'cf.soft-air')!), [
      [300, 10],
      [320, 600],
    ]);
    history.push(e2!);
    const after2 = snapshot(layer.pixels);
    expect(after2).not.toEqual(after1);
    history.undo();
    expect(snapshot(layer.pixels)).toEqual(after1);
    history.undo();
    expect(layer.pixels.tileCount).toBe(0);
    history.redo();
    expect(snapshot(layer.pixels)).toEqual(after1);
    history.redo();
    expect(snapshot(layer.pixels)).toEqual(after2);
  });

  it('eraser removes pixels and is undoable', () => {
    const doc = RasterDocument.createDefault({ width: 300, height: 300 });
    const layer = doc.activeRaster!;
    drawLine(doc, layer, hardBrush(30), [
      [20, 150],
      [280, 150],
    ]);
    const before = snapshot(layer.pixels);
    const eraser = cloneBrush(FACTORY_BRUSHES.find((b) => b.id === 'cf.hard-eraser')!);
    eraser.diameter = 40;
    eraser.dynamics = [];
    eraser.minDiameter = 1;
    const e = drawLine(doc, layer, eraser, [
      [150, 100],
      [150, 200],
    ]);
    expect(layer.pixels.getPixel(150, 150)[3]).toBe(0);
    e!.undo();
    expect(snapshot(layer.pixels)).toEqual(before);
  });

  it('respects the selection mask', () => {
    const doc = RasterDocument.createDefault({ width: 300, height: 300 });
    const layer = doc.activeRaster!;
    const sel = new MaskGrid(doc.tileSize, 0);
    for (let y = 0; y < 300; y++) for (let x = 0; x < 150; x++) sel.setValue(x, y, 255);
    drawLine(
      doc,
      layer,
      hardBrush(10),
      [
        [20, 150],
        [280, 150],
      ],
      { selection: sel },
    );
    expect(layer.pixels.getPixel(100, 150)[3]).toBe(255);
    expect(layer.pixels.getPixel(200, 150)[3]).toBe(0);
  });

  it('respects alpha lock', () => {
    const doc = RasterDocument.createDefault({ width: 300, height: 300 });
    const layer = doc.activeRaster!;
    drawLine(doc, layer, hardBrush(10), [
      [20, 150],
      [150, 150],
    ]);
    layer.alphaLock = true;
    drawLine(
      doc,
      layer,
      hardBrush(30),
      [
        [20, 150],
        [280, 150],
      ],
      { color: { r: 0, g: 0, b: 1 } },
    );
    expect(layer.pixels.getPixel(100, 150)).toEqual([0, 0, 255, 255]);
    expect(layer.pixels.getPixel(220, 150)[3]).toBe(0);
  });

  it('mirror symmetry paints the mirrored dab', () => {
    const doc = RasterDocument.createDefault({ width: 400, height: 200 });
    const layer = doc.activeRaster!;
    drawLine(
      doc,
      layer,
      hardBrush(8),
      [
        [50, 100],
        [60, 100],
      ],
      { symmetry: [mirrorX(200)] },
    );
    expect(layer.pixels.getPixel(55, 100)[3]).toBe(255);
    expect(layer.pixels.getPixel(344, 100)[3]).toBe(255);
  });

  it('every factory brush paints something on a 400×300 canvas', () => {
    for (const preset of FACTORY_BRUSHES) {
      const doc = RasterDocument.createDefault({ width: 400, height: 300 });
      const layer = doc.activeRaster!;
      const b = cloneBrush(preset);
      if (b.engine === 'eraser' || b.engine === 'smudge' || b.engine === 'blender') {
        // give erasers/blenders something to work on
        drawLine(
          doc,
          layer,
          hardBrush(60),
          [
            [20, 150],
            [380, 150],
          ],
          { color: { r: 0, g: 0.5, b: 1 } },
        );
      }
      const before = snapshot(layer.pixels);
      const pts: [number, number][] = [];
      for (let i = 0; i <= 40; i++) pts.push([30 + i * 8, 150 + Math.sin(i / 4) * 30]);
      const entry = drawLine(doc, layer, b, pts);
      expect(entry, preset.name).not.toBeNull();
      expect(snapshot(layer.pixels), preset.name).not.toEqual(before);
    }
  });

  it('cancel leaves the layer untouched', () => {
    const doc = RasterDocument.createDefault({ width: 300, height: 300 });
    const layer = doc.activeRaster!;
    const comp = new Compositor(doc);
    const eng = new StrokeEngine(doc, layer, comp, settings(hardBrush(10)));
    eng.begin(S(10, 10, 0));
    eng.addSamples([S(200, 200, 10)]);
    eng.cancel();
    expect(layer.pixels.tileCount).toBe(0);
    expect(comp.preview).toBeNull();
  });
});

describe('compositor', () => {
  it('composites layer opacity, blend modes, hidden layers and background', () => {
    const doc = RasterDocument.createDefault({
      width: 10,
      height: 10,
      background: { transparent: false, color: { r: 1, g: 1, b: 1 } },
    });
    const l1 = doc.activeRaster!;
    l1.pixels.setPixel(1, 1, 255, 0, 0, 255);
    l1.opacity = 0.5;
    const comp = new Compositor(doc);
    expect([...comp.compositeToRGBA({ x: 1, y: 1, w: 1, h: 1 })]).toEqual([255, 128, 128, 255]);
    l1.visible = false;
    expect([...comp.compositeToRGBA({ x: 1, y: 1, w: 1, h: 1 })]).toEqual([255, 255, 255, 255]);
    l1.visible = true;
    l1.opacity = 1;
    l1.blendMode = 'multiply';
    const l2 = createRasterLayer('top', doc.tileSize);
    l2.pixels.setPixel(1, 1, 0, 0, 255, 255);
    l2.blendMode = 'screen';
    doc.layers.push(l2);
    expect([...comp.compositeToRGBA({ x: 1, y: 1, w: 1, h: 1 })]).toEqual([255, 0, 255, 255]);
  });

  it('clipping masks only show where the base layer has alpha', () => {
    const doc = RasterDocument.createDefault({
      width: 10,
      height: 10,
      background: { transparent: true, color: { r: 1, g: 1, b: 1 } },
    });
    const base = doc.activeRaster!;
    base.pixels.setPixel(2, 2, 0, 255, 0, 255);
    const clip = createRasterLayer('clip', doc.tileSize);
    clip.clip = true;
    clip.pixels.setPixel(2, 2, 0, 0, 255, 255);
    clip.pixels.setPixel(5, 5, 0, 0, 255, 255);
    doc.layers.push(clip);
    const comp = new Compositor(doc);
    expect([...comp.compositeToRGBA({ x: 2, y: 2, w: 1, h: 1 })]).toEqual([0, 0, 255, 255]);
    expect([...comp.compositeToRGBA({ x: 5, y: 5, w: 1, h: 1 })]).toEqual([0, 0, 0, 0]);
  });

  it('groups composite their children and respect group opacity', () => {
    const doc = RasterDocument.createDefault({
      width: 10,
      height: 10,
      background: { transparent: true, color: { r: 1, g: 1, b: 1 } },
    });
    const g = createGroupLayer('g');
    g.passThrough = false;
    g.opacity = 0.5;
    const inner = createRasterLayer('inner', doc.tileSize);
    inner.pixels.setPixel(3, 3, 255, 255, 0, 255);
    g.children.push(inner);
    doc.layers.push(g);
    const comp = new Compositor(doc);
    expect([...comp.compositeToRGBA({ x: 3, y: 3, w: 1, h: 1 })]).toEqual([255, 255, 0, 128]);
  });

  it('layer masks hide content', () => {
    const doc = RasterDocument.createDefault({
      width: 10,
      height: 10,
      background: { transparent: true, color: { r: 1, g: 1, b: 1 } },
    });
    const l = doc.activeRaster!;
    l.pixels.setPixel(4, 4, 10, 20, 30, 255);
    l.mask = new MaskGrid(doc.tileSize, 255);
    l.mask.setValue(4, 4, 0);
    const comp = new Compositor(doc);
    expect([...comp.compositeToRGBA({ x: 4, y: 4, w: 1, h: 1 })]).toEqual([0, 0, 0, 0]);
    l.maskEnabled = false;
    expect([...comp.compositeToRGBA({ x: 4, y: 4, w: 1, h: 1 })]).toEqual([10, 20, 30, 255]);
  });

  it('tile seams: a stroke crossing tile borders is continuous', () => {
    const doc = RasterDocument.createDefault({ width: 600, height: 600 });
    const layer = doc.activeRaster!;
    drawLine(doc, layer, hardBrush(12), [
      [100, 256],
      [500, 256],
    ]);
    for (let x = 240; x < 270; x++) expect(layer.pixels.getPixel(x, 256)[3], `x=${x}`).toBe(255);
    for (let y = 250; y < 262; y++) {
      const a = layer.pixels.getPixel(255, y)[3];
      const b = layer.pixels.getPixel(256, y)[3];
      expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
    }
  });
});
