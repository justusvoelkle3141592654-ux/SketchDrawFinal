import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { decodePng, encodePng } from '../../src/renderer/engine/io/png';
import { deserializeDocument, serializeDocumentSync, CforgeError } from '../../src/renderer/engine/io/cforge';
import { RasterDocument } from '../../src/renderer/engine/document';
import { createGroupLayer, createRasterLayer, type RasterLayer } from '../../src/renderer/engine/layers';
import { MaskGrid } from '../../src/renderer/engine/tiles';
import { validateCforgeBytes } from '../../src/shared/cforge-validate';
import { FACTORY_BRUSHES } from '../../src/renderer/engine/brush/presets';

describe('PNG codec', () => {
  it('round-trips straight RGBA exactly, including semi-transparent pixels', () => {
    const w = 37;
    const h = 23;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i++) data[i] = (i * 97 + (i >> 3) * 13) & 255;
    const png = encodePng(w, h, data, { dpi: 300 });
    const back = decodePng(png)!;
    expect(back.width).toBe(w);
    expect(back.height).toBe(h);
    expect(back.dpi).toBe(300);
    expect(Buffer.from(back.data).equals(Buffer.from(data))).toBe(true);
  });
  it('writes RGB when opaque and decodes it back', () => {
    const data = new Uint8ClampedArray(8 * 8 * 4).map((_, i) => (i % 4 === 3 ? 255 : i));
    const png = encodePng(8, 8, data, { autoOpaque: true });
    expect(png[25]).toBe(2); // colour type RGB
    expect(Buffer.from(decodePng(png)!.data).equals(Buffer.from(data))).toBe(true);
  });
  it('rejects non-PNG data', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow();
  });
});

function makeDoc() {
  const doc = RasterDocument.createDefault({
    width: 520,
    height: 300,
    dpi: 300,
    background: { transparent: true, color: { r: 0.2, g: 0.3, b: 0.4 } },
  });
  const l1 = doc.activeRaster!;
  l1.name = 'Ink';
  for (let x = 0; x < 520; x += 3)
    l1.pixels.setPixel(x, (x * 7) % 300, x & 255, 128, 255 - (x & 255), (x * 5) & 255);
  l1.opacity = 0.75;
  l1.blendMode = 'multiply';
  l1.label = 'teal';
  const g = createGroupLayer('Group A');
  g.passThrough = false;
  g.opacity = 0.6;
  const l2 = createRasterLayer('Clipped', doc.tileSize);
  l2.clip = true;
  l2.alphaLock = true;
  l2.pixels.setPixel(400, 200, 1, 2, 3, 4);
  l2.mask = new MaskGrid(doc.tileSize, 255);
  l2.mask.setValue(400, 200, 17);
  const l3 = createRasterLayer('Base', doc.tileSize);
  l3.visible = false;
  g.children.push(l3, l2);
  doc.layers.push(g);
  doc.activeLayerId = l2.id;
  doc.selection = new MaskGrid(doc.tileSize, 0);
  doc.selection.setValue(10, 10, 200);
  return doc;
}

describe('.cforge format', () => {
  it('round-trips dimensions, layer tree, properties, pixels, masks and selection', () => {
    const doc = makeDoc();
    const bytes = serializeDocumentSync(doc, {
      appVersion: 'test',
      brushes: [FACTORY_BRUSHES[0]],
      features: { animation: { fps: 12 } },
    });
    expect(validateCforgeBytes(bytes).ok).toBe(true);
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        'manifest.json',
        'document.json',
        'preview.png',
        'thumbnail.png',
        'resources/brushes.json',
      ]),
    );
    const { doc: back, warnings, brushes, features } = deserializeDocument(bytes);
    expect(warnings).toEqual([]);
    expect([back.width, back.height, back.dpi, back.background.transparent]).toEqual([520, 300, 300, true]);
    expect(back.layers.length).toBe(2);
    const l1 = back.layers[0] as RasterLayer;
    expect([l1.name, l1.opacity, l1.blendMode, l1.label]).toEqual(['Ink', 0.75, 'multiply', 'teal']);
    const orig = doc.layers[0] as RasterLayer;
    for (const [k, t] of orig.pixels.tiles)
      expect(Buffer.from(l1.pixels.tiles.get(k)!).equals(Buffer.from(t))).toBe(true);
    const g = back.layers[1];
    expect(g.kind).toBe('group');
    if (g.kind !== 'group') return;
    expect([g.name, g.passThrough, g.opacity]).toEqual(['Group A', false, 0.6]);
    const l2 = g.children[1] as RasterLayer;
    expect([l2.clip, l2.alphaLock, l2.mask?.getValue(400, 200), l2.mask?.getValue(0, 0)]).toEqual([
      true,
      true,
      17,
      255,
    ]);
    expect(l2.pixels.getPixel(400, 200)).toEqual([1, 2, 3, 4]);
    expect(g.children[0].visible).toBe(false);
    expect(back.activeLayerId).toBe(l2.id);
    expect(back.selection?.getValue(10, 10)).toBe(200);
    expect(brushes[0].id).toBe(FACTORY_BRUSHES[0].id);
    expect(features).toEqual({ animation: { fps: 12 } });
  });

  it('refuses documents from a newer format version with a readable message', () => {
    const bytes = zipSync({
      'manifest.json': strToU8(
        JSON.stringify({ format: 'canvas-forge', formatVersion: 99, document: 'document.json' }),
      ),
      'document.json': strToU8('{}'),
    });
    expect(() => deserializeDocument(bytes)).toThrow(/newer Canvas Forge/);
    expect(validateCforgeBytes(bytes).ok).toBe(false);
  });

  it('rejects damaged files', () => {
    const bytes = serializeDocumentSync(makeDoc(), { appVersion: 'test', skipPreviews: true });
    const truncated = bytes.slice(0, Math.floor(bytes.length / 2));
    expect(() => deserializeDocument(truncated)).toThrow(CforgeError);
    expect(validateCforgeBytes(truncated).ok).toBe(false);
    expect(() => deserializeDocument(strToU8('hello'))).toThrow(CforgeError);
  });

  it('loads documents with missing tile data, reporting a warning', () => {
    const bytes = serializeDocumentSync(makeDoc(), { appVersion: 'test', skipPreviews: true });
    const files = unzipSync(bytes);
    const tileFile = Object.keys(files).find((n) => n.startsWith('layers/'))!;
    delete files[tileFile];
    const { warnings } = deserializeDocument(zipSync(files));
    expect(warnings.length).toBeGreaterThan(0);
  });
});
