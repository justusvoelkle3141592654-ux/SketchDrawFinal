// Engine micro-benchmarks (run with: npm run perf). Prints timings; asserts nothing about speed.
import { test } from 'vitest';
import { RasterDocument } from '../../src/renderer/engine/document';
import { Compositor } from '../../src/renderer/engine/compositor';
import { StrokeEngine } from '../../src/renderer/engine/stroke/stroke-engine';
import { FACTORY_BRUSHES } from '../../src/renderer/engine/brush/presets';
import { cloneBrush } from '../../src/renderer/engine/brush/schema';
import { createRasterLayer } from '../../src/renderer/engine/layers';
import { serializeDocumentSync, deserializeDocument } from '../../src/renderer/engine/io/cforge';
import type { StrokeSample } from '../../src/renderer/engine/stroke/pipeline';
import { TileDiffRecorder } from '../../src/renderer/engine/history';
import {
  applyAdjustment,
  drawTransformedBlock,
  extractBlock,
  fillCoverage,
  mat3FromAffine,
  resizeImage,
  softenRegion,
  type Adjustment,
} from '../../src/renderer/engine/pixel-ops';
import {
  ellipsePolygon,
  featherMask,
  floodRegion,
  growMask,
  maskOutline,
  polygonMask,
  rasterizePolygon,
} from '../../src/renderer/engine/selection';

const W = 3000;
const H = 2000;

function path(n: number): StrokeSample[] {
  const out: StrokeSample[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({
      x: 100 + t * 2800,
      y: 1000 + Math.sin(t * 12) * 700,
      pressure: 0.3 + 0.7 * Math.sin(t * Math.PI),
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      time: i * 4,
    });
  }
  return out;
}

function timeStroke(name: string, diameter: number) {
  const doc = RasterDocument.createDefault({ width: W, height: H });
  const layer = doc.activeRaster!;
  const brush = cloneBrush(FACTORY_BRUSHES.find((b) => b.name === name)!);
  brush.diameter = diameter;
  const comp = new Compositor(doc);
  const pts = path(600);
  if (brush.engine === 'smudge' || brush.engine === 'blender') {
    // smudging needs paint to move: fill the area under the path first
    for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 12; tx++) layer.pixels.getOrCreate(tx, ty).fill(160);
  }
  let dabs = 0;
  doc.onDirty(() => dabs++);
  const t0 = performance.now();
  const eng = new StrokeEngine(doc, layer, comp, {
    brush,
    color: { r: 0, g: 0, b: 0 },
    zoom: 1,
    stabilizer: 'off',
    stabilizerAmount: 0,
    predictive: 0,
    symmetry: [],
    selection: null,
    forceErase: false,
    seed: 1,
  });
  eng.begin(pts[0]);
  // feed in batches like pointer events (≈ 4 samples per event)
  for (let i = 1; i < pts.length; i += 4) eng.addSamples(pts.slice(i, i + 4));
  const t1 = performance.now();
  eng.end();
  const t2 = performance.now();
  const ms = t1 - t0;
  console.log(
    `${name.padEnd(16)} Ø${String(diameter).padStart(4)}px: ${dabs} dabs in ${ms.toFixed(1)} ms (${((ms / Math.max(1, dabs)) * 1000).toFixed(1)} µs/dab, ${(ms / 150).toFixed(2)} ms per 4-sample event), commit ${(t2 - t1).toFixed(1)} ms`,
  );
}

test('stroke throughput on a 3000×2000 document', () => {
  timeStroke('Studio Ink', 8);
  timeStroke('Hard Round', 40);
  timeStroke('Hard Round', 150);
  timeStroke('Soft Air', 300);
  timeStroke('Rough Charcoal', 40);
  timeStroke('Round Bristle', 60);
  timeStroke('Finger Smudge', 40);
  timeStroke('Water Blend', 60);
});

test('compositing a 3000×2000 document', () => {
  for (const layers of [1, 5, 10]) {
    const doc = RasterDocument.createDefault({ width: W, height: H });
    for (let i = 1; i < layers; i++) doc.layers.push(createRasterLayer(`L${i}`, doc.tileSize));
    // fill every layer fully so no tile is skipped
    for (const l of doc.layers) {
      if (l.kind !== 'raster') continue;
      for (let ty = 0; ty < Math.ceil(H / 256); ty++)
        for (let tx = 0; tx < Math.ceil(W / 256); tx++) l.pixels.getOrCreate(tx, ty).fill(128);
    }
    const comp = new Compositor(doc);
    const acc = new Float32Array(256 * 256 * 4);
    const t0 = performance.now();
    let tiles = 0;
    for (let ty = 0; ty < Math.ceil(H / 256); ty++)
      for (let tx = 0; tx < Math.ceil(W / 256); tx++) {
        const r = {
          x: tx * 256,
          y: ty * 256,
          w: Math.min(256, W - tx * 256),
          h: Math.min(256, H - ty * 256),
        };
        comp.compositeRect(r, acc);
        tiles++;
      }
    const ms = performance.now() - t0;
    console.log(
      `full composite, ${String(layers).padStart(2)} fully painted layers: ${ms.toFixed(0)} ms for ${tiles} tiles (${(ms / tiles).toFixed(2)} ms/tile)`,
    );
  }
  // typical dirty rect of a 40 px dab across 10 layers
  const doc = RasterDocument.createDefault({ width: W, height: H });
  for (let i = 1; i < 10; i++) doc.layers.push(createRasterLayer(`L${i}`, doc.tileSize));
  for (const l of doc.layers) if (l.kind === 'raster') l.pixels.getOrCreate(2, 2).fill(100);
  const comp = new Compositor(doc);
  const acc = new Float32Array(256 * 256 * 4);
  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) comp.compositeRect({ x: 520, y: 520, w: 44, h: 44 }, acc);
  console.log(
    `dirty 44×44 rect over 10 layers: ${((performance.now() - t0) / 1000).toFixed(3)} ms per recomposite`,
  );
});

test('save / open a 3000×2000 document with 3 painted layers', () => {
  const doc = RasterDocument.createDefault({ width: W, height: H });
  doc.layers.push(createRasterLayer('B', doc.tileSize), createRasterLayer('C', doc.tileSize));
  let seed = 1;
  for (const l of doc.layers) {
    if (l.kind !== 'raster') continue;
    for (let ty = 0; ty < 8; ty++)
      for (let tx = 0; tx < 12; tx++) {
        const t = l.pixels.getOrCreate(tx, ty);
        for (let i = 0; i < t.length; i++)
          t[i] = (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 7 === 0 ? 255 : (i * 31) & 255;
      }
  }
  const t0 = performance.now();
  const bytes = serializeDocumentSync(doc, { appVersion: 'bench' });
  const t1 = performance.now();
  deserializeDocument(bytes);
  const t2 = performance.now();
  console.log(
    `serialise (sync, with previews): ${(t1 - t0).toFixed(0)} ms → ${(bytes.length / 1048576).toFixed(1)} MB; deserialise: ${(t2 - t1).toFixed(0)} ms`,
  );
});

// ------------------------------------------------------------------ selection, fill, transform, adjustments

function paintedDoc() {
  const doc = RasterDocument.createDefault({ width: W, height: H });
  const layer = doc.activeRaster!;
  // a filled ellipse with an outline, like line art with a coloured area
  const rec = new TileDiffRecorder(layer.pixels);
  const cov = rasterizePolygon(ellipsePolygon(1500, 1000, 1100, 700), { x: 0, y: 0, w: W, h: H }, true);
  const dense = new Uint8ClampedArray(W * H);
  for (let i = 0; i < dense.length; i++) dense[i] = cov[i] * 255;
  fillCoverage(doc, layer, rec, dense, { r: 0.8, g: 0.4, b: 0.2 }, 1);
  return { doc, layer };
}

function ms(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

test('selection, fill, transform and adjustment operations on a 3000×2000 document', () => {
  const { doc, layer } = paintedDoc();
  const rows: string[] = [];
  const src = layer.pixels.readRect(doc.bounds);
  let region: Uint8Array = new Uint8Array(0);
  rows.push(
    `flood region (contiguous, 12 %): ${ms(() => (region = floodRegion(src, W, H, 1500, 1000, 0.12, true))).toFixed(0)} ms`,
  );
  rows.push(`fill coverage soften (expand 1 px): ${ms(() => softenRegion(region, W, H, 1)).toFixed(0)} ms`);
  let mask = polygonMask(doc, ellipsePolygon(1500, 1000, 900, 600), true);
  rows.push(
    `ellipse selection mask (anti-aliased): ${ms(() => (mask = polygonMask(doc, ellipsePolygon(1500, 1000, 900, 600), true))).toFixed(0)} ms`,
  );
  rows.push(`feather selection 8 px: ${ms(() => featherMask(doc, mask, 8)).toFixed(0)} ms`);
  rows.push(`expand selection 4 px: ${ms(() => growMask(doc, mask, 4)).toFixed(0)} ms`);
  rows.push(`selection outline (marching ants segments): ${ms(() => maskOutline(mask, W, H)).toFixed(0)} ms`);
  const block = extractBlock(layer.pixels, { x: 500, y: 400, w: 1000, h: 1000 }, null);
  rows.push(
    `transform 1000×1000 block, rotate 20° + scale 1.2: ${ms(() => {
      const a = (20 * Math.PI) / 180;
      const m = mat3FromAffine(
        1.2 * Math.cos(a),
        1.2 * Math.sin(a),
        -1.2 * Math.sin(a),
        1.2 * Math.cos(a),
        800,
        300,
      );
      const out = createRasterLayer('t', doc.tileSize);
      drawTransformedBlock(out.pixels, new TileDiffRecorder(out.pixels), block, m, doc.bounds);
    }).toFixed(0)} ms`,
  );
  for (const adj of [
    { kind: 'brightness-contrast', brightness: 0.2, contrast: 0.3 },
    { kind: 'hue-saturation', hue: 0.1, saturation: 0.2, lightness: 0 },
  ] as Adjustment[]) {
    rows.push(
      `${adj.kind} on the layer: ${ms(() => applyAdjustment(doc, layer, new TileDiffRecorder(layer.pixels), adj)).toFixed(0)} ms`,
    );
  }
  // worst case for the colour cache: every pixel a different colour
  const noisy = RasterDocument.createDefault({ width: W, height: H });
  const nl = noisy.activeRaster!;
  let seed = 1;
  for (let ty = 0; ty < Math.ceil(H / 256); ty++)
    for (let tx = 0; tx < Math.ceil(W / 256); tx++) {
      const t = nl.pixels.getOrCreate(tx, ty);
      for (let i = 0; i < t.length; i++)
        t[i] = (i & 3) === 3 ? 255 : (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24;
    }
  rows.push(
    `hue-saturation, every pixel a different colour: ${ms(() =>
      applyAdjustment(noisy, nl, new TileDiffRecorder(nl.pixels), {
        kind: 'hue-saturation',
        hue: 0.1,
        saturation: 0.2,
        lightness: 0,
      }),
    ).toFixed(0)} ms`,
  );
  rows.push(`image size 3000×2000 → 1500×1000: ${ms(() => resizeImage(doc, 1500, 1000)).toFixed(0)} ms`);
  console.log(`\n${rows.join('\n')}`);
});
