import { describe, expect, it } from 'vitest';
import { RasterDocument } from '../../src/renderer/engine/document';
import { createGroupLayer, createRasterLayer } from '../../src/renderer/engine/layers';
import { Compositor } from '../../src/renderer/engine/compositor';
import {
  currentFrameIndex,
  defaultAnimation,
  frameAtTick,
  frameCompositeOptions,
  frameLayout,
  sanitizeAnimation,
  timeline,
} from '../../src/renderer/engine/animation';

/** Document with `n` top-level raster frames, each with one opaque pixel at (i, 0). */
function flipbook(n: number) {
  const doc = RasterDocument.createDefault({ width: 32, height: 32 });
  doc.layers.length = 0;
  for (let i = 0; i < n; i++) {
    const l = createRasterLayer(`F${i + 1}`, doc.tileSize);
    l.pixels.setPixel(i, 0, 255, 0, 0, 255);
    doc.layers.push(l);
  }
  doc.activeLayerId = doc.layers[0].id;
  return doc;
}

describe('animation model', () => {
  it('splits held background and foreground from the frames', () => {
    const doc = flipbook(4);
    const a = { ...defaultAnimation(), holdBackground: true, holdForeground: true };
    const l = frameLayout(doc, a);
    expect(l.background?.name).toBe('F1');
    expect(l.foreground?.name).toBe('F4');
    expect(l.frames.map((f) => f.name)).toEqual(['F2', 'F3']);
    // never hold both when that would leave no frame
    const two = frameLayout(flipbook(2), a);
    expect(two.frames.length).toBe(1);
  });

  it('follows the active layer, including layers inside a group frame', () => {
    const doc = flipbook(3);
    const g = createGroupLayer('G');
    const inner = createRasterLayer('inner', doc.tileSize);
    g.children.push(inner);
    doc.layers.push(g);
    const a = defaultAnimation();
    doc.activeLayerId = doc.layers[1].id;
    expect(currentFrameIndex(doc, a)).toBe(1);
    doc.activeLayerId = inner.id;
    expect(currentFrameIndex(doc, a)).toBe(3);
  });

  it('timeline uses exposures; ticks loop or clamp', () => {
    const doc = flipbook(3);
    const a = defaultAnimation();
    a.exposures[doc.layers[1].id] = 3;
    const tl = timeline(doc.layers, a);
    expect(tl).toEqual([
      { start: 0, length: 1 },
      { start: 1, length: 3 },
      { start: 4, length: 1 },
    ]);
    expect([0, 1, 2, 3, 4, 5].map((t) => frameAtTick(doc.layers, a, t))).toEqual([0, 1, 1, 1, 2, 0]);
    expect(frameAtTick(doc.layers, { ...a, loop: false }, 99)).toBe(2);
  });

  it('frame view shows the current frame above fading, tinted onion skins', () => {
    const doc = flipbook(5);
    const a = defaultAnimation();
    a.onion = { enabled: true, before: 2, after: 1, opacity: 0.6, tint: true };
    const o = frameCompositeOptions(doc, a, 2, true);
    expect(o.roots!.map((n) => n.name)).toEqual(['F1', 'F2', 'F4', 'F3']);
    const near = o.nodeStyle!(doc.layers[1])!;
    const far = o.nodeStyle!(doc.layers[0])!;
    expect(near.opacity).toBeCloseTo(0.6);
    expect(far.opacity).toBeCloseTo(0.3);
    expect(o.nodeStyle!(doc.layers[2])).toBeNull();
    // without onion only the current frame is shown
    expect(frameCompositeOptions(doc, a, 2, false).roots!.map((n) => n.name)).toEqual(['F3']);
  });

  it('compositor applies onion opacity and tint and hides other frames', () => {
    const doc = flipbook(3);
    doc.background.transparent = true;
    const a = defaultAnimation();
    a.onion = { enabled: true, before: 1, after: 1, opacity: 0.5, tint: true };
    const px = new Compositor(doc).compositeToRGBA(
      { x: 0, y: 0, w: 3, h: 1 },
      frameCompositeOptions(doc, a, 1, true),
    );
    // current frame (pixel x=1) is untouched red
    expect(Array.from(px.subarray(4, 8))).toEqual([255, 0, 0, 255]);
    // previous frame at x=0: half opacity, tinted toward the warm onion colour
    expect(px[3]).toBe(128);
    // next frame at x=2: half opacity, tinted toward blue
    expect(px[11]).toBe(128);
    expect(px[10]).toBeGreaterThan(150);
    // a frame outside the onion range is hidden
    const far = new Compositor(doc).compositeToRGBA(
      { x: 0, y: 0, w: 3, h: 1 },
      frameCompositeOptions(doc, a, 0, false),
    );
    expect(far[7]).toBe(0);
    expect(far[11]).toBe(0);
  });

  it('sanitises settings from files', () => {
    const a = sanitizeAnimation({
      enabled: true,
      fps: 500,
      onion: { before: 9, opacity: -1 },
      exposures: { x: 3, y: 0, z: 'a' },
    });
    expect(a.enabled).toBe(true);
    expect(a.fps).toBe(60);
    expect(a.onion.before).toBe(5);
    expect(a.onion.opacity).toBe(0.05);
    expect(a.exposures).toEqual({ x: 3 });
    expect(sanitizeAnimation('nonsense')).toEqual(defaultAnimation());
  });
});
