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
