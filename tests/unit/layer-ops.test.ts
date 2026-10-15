import { describe, expect, it } from 'vitest';
import { RasterDocument } from '../../src/renderer/engine/document';
import { Compositor } from '../../src/renderer/engine/compositor';
import { History } from '../../src/renderer/engine/history';
import {
  clearLayer,
  flattenCopy,
  groupActive,
  mergeDown,
  mergeDownProblem,
  mergeVisible,
  moveLayer,
} from '../../src/renderer/engine/layer-ops';
import {
  createGroupLayer,
  createRasterLayer,
  type GroupLayer,
  type LayerNode,
  type RasterLayer,
} from '../../src/renderer/engine/layers';
import { MaskGrid, type TileGrid } from '../../src/renderer/engine/tiles';

const TS = 8; // small tiles so every test spans several tiles, including missing ones

function makeDoc(...layers: LayerNode[]): RasterDocument {
  const doc = new RasterDocument({ width: 16, height: 16, tileSize: TS });
  doc.layers.push(...layers);
  doc.activeLayerId = layers[layers.length - 1].id;
  return doc;
}

function raster(name: string, props: Partial<RasterLayer> = {}): RasterLayer {
  return Object.assign(createRasterLayer(name, TS), props);
}

function group(name: string, children: LayerNode[], props: Partial<GroupLayer> = {}): GroupLayer {
  return Object.assign(createGroupLayer(name), { children }, props);
}

type RGBA = [number, number, number, number];
function fill(l: RasterLayer, x0: number, y0: number, x1: number, y1: number, rgba: RGBA) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) l.pixels.setPixel(x, y, ...rgba);
}

function render(doc: RasterDocument, skipBackground = false): Uint8ClampedArray {
  return new Compositor(doc).compositeToRGBA(doc.bounds, { skipBackground });
}

function maxDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

function snapshot(grid: TileGrid | MaskGrid): Map<number, string> {
  const m = new Map<number, string>();
  for (const [k, t] of grid.tiles) m.set(k, Buffer.from(t).toString('base64'));
  return m;
}

type Tree = (string | [string, Tree])[];
function tree(list: LayerNode[]): Tree {
  return list.map((n) => (n.kind === 'group' ? [n.name, tree(n.children)] : n.name));
}

/** Opaque grey backdrop so blend results are fully visible on screen. */
const paper = () => {
  const p = raster('Paper');
  fill(p, 0, 0, 16, 16, [200, 200, 200, 255]);
  return p;
};

describe('merge down', () => {
  it("applies the upper layer's opacity, blend mode and mask; one undo step", () => {
    const lower = raster('Lower');
    fill(lower, 0, 0, 12, 12, [255, 0, 0, 255]);
    const upper = raster('Upper', { blendMode: 'multiply', opacity: 0.5 });
    fill(upper, 4, 4, 12, 12, [0, 0, 255, 255]);
    upper.mask = new MaskGrid(TS, 255);
    for (let x = 4; x < 12; x++) upper.mask.setValue(x, 5, 0);
    const doc = makeDoc(paper(), lower, upper);
    const before = render(doc);
    const lowerBefore = snapshot(lower.pixels);
    const history = new History();
    const e = mergeDown(doc, upper.id)!;
    expect(e).not.toBeNull();
    history.push(e);
    expect(maxDiff(render(doc), before)).toBeLessThanOrEqual(1);
    expect(tree(doc.layers)).toEqual(['Paper', 'Lower']);
    expect(doc.activeLayerId).toBe(lower.id);
    // red × blue at 50 % → half-dark red; the masked row keeps plain red
    expect(lower.pixels.getPixel(6, 6)).toEqual([128, 0, 0, 255]);
    expect(lower.pixels.getPixel(6, 5)).toEqual([255, 0, 0, 255]);
    history.undo();
    expect(tree(doc.layers)).toEqual(['Paper', 'Lower', 'Upper']);
    expect(snapshot(lower.pixels)).toEqual(lowerBefore);
    expect(maxDiff(render(doc), before)).toBe(0);
    history.redo();
    expect(tree(doc.layers)).toEqual(['Paper', 'Lower']);
    expect(maxDiff(render(doc), before)).toBeLessThanOrEqual(1);
  });

  it("bakes the lower layer's opacity and mask so the canvas is unchanged", () => {
    const lower = raster('Lower', { opacity: 0.5 });
    fill(lower, 0, 0, 10, 16, [255, 0, 0, 255]);
    const mask = new MaskGrid(TS, 255);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 16; x++) mask.setValue(x, y, y < 4 ? 0 : 128);
    lower.mask = mask;
    const upper = raster('Upper');
    fill(upper, 6, 0, 16, 16, [0, 0, 255, 200]);
    const doc = makeDoc(paper(), lower, upper);
    const before = render(doc);
    const e = mergeDown(doc, upper.id)!;
    expect(maxDiff(render(doc), before)).toBeLessThanOrEqual(2);
    expect(lower.opacity).toBe(1);
    expect(lower.mask).toBeNull();
    // upper content outside the lower layer is merged at full strength
    expect(lower.pixels.getPixel(14, 2)).toEqual([0, 0, 255, 200]);
    e.undo();
    expect(lower.opacity).toBe(0.5);
    expect(lower.mask).toBe(mask);
    expect(maxDiff(render(doc), before)).toBe(0);
  });

  it('keeps a disabled lower mask untouched', () => {
    const lower = raster('Lower', { maskEnabled: false });
    fill(lower, 0, 0, 16, 16, [0, 255, 0, 255]);
    lower.mask = new MaskGrid(TS, 0);
    const upper = raster('Upper');
    fill(upper, 0, 0, 4, 4, [0, 0, 255, 255]);
    const doc = makeDoc(lower, upper);
    const before = render(doc);
    mergeDown(doc, upper.id);
    expect(lower.mask).not.toBeNull();
    expect(lower.maskEnabled).toBe(false);
    expect(maxDiff(render(doc), before)).toBe(0);
  });

  it('clips the upper layer to the lower one and keeps further clipped layers', () => {
    const lower = raster('Lower', { opacity: 0.75 });
    fill(lower, 2, 2, 10, 10, [0, 255, 0, 255]);
    const lowerMask = new MaskGrid(TS, 255);
    for (let y = 0; y < 16; y++) lowerMask.setValue(3, y, 0);
    lower.mask = lowerMask;
    const upper = raster('Upper', { clip: true, opacity: 0.5 });
    fill(upper, 0, 0, 16, 16, [0, 0, 255, 255]);
    upper.mask = new MaskGrid(TS, 255);
    for (let x = 0; x < 16; x++) upper.mask.setValue(x, 5, 0);
    const shade = raster('Shade', { clip: true, blendMode: 'multiply' });
    fill(shade, 0, 6, 16, 9, [0, 0, 0, 255]);
    const doc = makeDoc(paper(), lower, upper, shade);
    const before = render(doc);
    mergeDown(doc, upper.id);
    expect(maxDiff(render(doc), before)).toBeLessThanOrEqual(2);
    // nothing spills outside the lower layer's pixels
    expect(lower.pixels.getPixel(12, 12)[3]).toBe(0);
    expect(lower.pixels.getPixel(0, 0)[3]).toBe(0);
    // opacity and mask still apply to both, so they stay editable
    expect(lower.opacity).toBe(0.75);
    expect(lower.mask).toBe(lowerMask);
    expect(tree(doc.layers)).toEqual(['Paper', 'Lower', 'Shade']);
    expect(shade.clip).toBe(true);
  });

  it('keeps a clipped merge exact on a semi-transparent lower layer with a blend mode', () => {
    const lower = raster('Lower', { blendMode: 'screen', opacity: 0.6 });
    fill(lower, 0, 0, 12, 12, [40, 160, 220, 128]);
    const upper = raster('Upper', { clip: true, blendMode: 'overlay', opacity: 0.8 });
    fill(upper, 4, 4, 16, 16, [230, 30, 90, 200]);
    const doc = makeDoc(paper(), lower, upper);
    const before = render(doc);
    mergeDown(doc, upper.id);
    expect(maxDiff(render(doc), before)).toBeLessThanOrEqual(2);
    expect(lower.blendMode).toBe('screen');
    expect(lower.opacity).toBe(0.6);
  });

  it('merges two layers clipped to the same base and keeps the result clipped', () => {
    const base = raster('Base');
    fill(base, 0, 0, 12, 12, [255, 255, 0, 255]);
    const lower = raster('Lower', { clip: true, opacity: 0.5 });
    fill(lower, 0, 0, 6, 12, [255, 0, 0, 255]);
    const upper = raster('Upper', { clip: true });
    fill(upper, 4, 0, 16, 16, [0, 0, 255, 128]);
    const doc = makeDoc(base, lower, upper);
    const before = render(doc);
    mergeDown(doc, upper.id);
    expect(maxDiff(render(doc), before)).toBeLessThanOrEqual(2);
    expect(lower.clip).toBe(true);
    expect(lower.opacity).toBe(1);
    // the upper pixels outside the lower layer survive (the shared base still clips them)
    expect(lower.pixels.getPixel(10, 2)[3]).toBeGreaterThan(0);
  });

  it("ignores the lower layer's alpha lock", () => {
    const lower = raster('Lower', { alphaLock: true });
    fill(lower, 0, 0, 4, 4, [255, 0, 0, 255]);
    const upper = raster('Upper');
    fill(upper, 2, 2, 12, 12, [0, 0, 255, 255]);
    const doc = makeDoc(lower, upper);
    const before = render(doc);
    mergeDown(doc, upper.id);
    expect(lower.pixels.getPixel(8, 8)).toEqual([0, 0, 255, 255]);
    expect(lower.alphaLock).toBe(true);
    expect(maxDiff(render(doc), before)).toBe(0);
  });

  it('refuses set-ups whose result would differ from the canvas, and leaves the document alone', () => {
    const cases: [string, () => { doc: RasterDocument; id: string }][] = [
      [
        'bottom layer',
        () => {
          const a = raster('A');
          return { doc: makeDoc(a, raster('B')), id: a.id };
        },
      ],
      [
        'group below',
        () => {
          const a = raster('A');
          return { doc: makeDoc(group('G', [raster('C')]), a), id: a.id };
        },
      ],
      [
        'group as upper',
        () => {
          const g = group('G', [raster('C')]);
          return { doc: makeDoc(raster('A'), g), id: g.id };
        },
      ],
      [
        'hidden upper',
        () => {
          const a = raster('A', { visible: false });
          return { doc: makeDoc(raster('B'), a), id: a.id };
        },
      ],
      [
        'hidden lower',
        () => {
          const a = raster('A');
          return { doc: makeDoc(raster('B', { visible: false }), a), id: a.id };
        },
      ],
      [
        'locked lower',
        () => {
          const a = raster('A');
          return { doc: makeDoc(raster('B', { locked: true }), a), id: a.id };
        },
      ],
      [
        'unclipped upper on a clipped lower',
        () => {
          const a = raster('A');
          return { doc: makeDoc(raster('Base'), raster('B', { clip: true }), a), id: a.id };
        },
      ],
      [
        'layers clipped to the upper',
        () => {
          const a = raster('A');
          return { doc: makeDoc(raster('B'), a, raster('C', { clip: true })), id: a.id };
        },
      ],
    ];
    for (const [name, make] of cases) {
      const { doc, id } = make();
      const shape = tree(doc.layers);
      const version = doc.structureVersion;
      expect(mergeDownProblem(doc, id), name).toBeTruthy();
      expect(mergeDown(doc, id), name).toBeNull();
      expect(tree(doc.layers), name).toEqual(shape);
      expect(doc.structureVersion, name).toBe(version);
    }
  });
});

describe('merge visible', () => {
  it('keeps hidden layers, also those inside visible groups', () => {
    const a = raster('A');
    fill(a, 0, 0, 8, 8, [255, 0, 0, 255]);
    const h = raster('H', { visible: false });
    fill(h, 0, 0, 16, 16, [0, 255, 0, 255]);
    const b = raster('B');
    fill(b, 4, 4, 12, 12, [0, 0, 255, 128]);
    const g = group('G', [h, b]);
    const t = raster('T', { visible: false });
    fill(t, 0, 0, 16, 16, [255, 255, 0, 255]);
    const c = raster('C', { opacity: 0.5 });
    fill(c, 8, 8, 16, 16, [0, 0, 0, 255]);
    const doc = makeDoc(a, g, t, c);
    const before = render(doc);
    const hPixels = snapshot(h.pixels);
    const history = new History();
    history.push(mergeVisible(doc)!);
    expect(maxDiff(render(doc), before)).toBeLessThanOrEqual(1);
    expect(tree(doc.layers)).toEqual(['Merged', ['G', ['H']], 'T']);
    expect(snapshot(h.pixels)).toEqual(hPixels);
    expect(doc.activeLayer?.name).toBe('Merged');
    history.undo();
    expect(tree(doc.layers)).toEqual(['A', ['G', ['H', 'B']], 'T', 'C']);
    expect(maxDiff(render(doc), before)).toBe(0);
    history.redo();
    expect(tree(doc.layers)).toEqual(['Merged', ['G', ['H']], 'T']);
  });

  it('works when the only visible node is a single group', () => {
    const x = raster('X', { visible: false });
    fill(x, 0, 0, 16, 16, [9, 9, 9, 255]);
    const a = raster('a');
    fill(a, 0, 0, 10, 10, [255, 0, 0, 255]);
    const b = raster('b', { blendMode: 'multiply' });
    fill(b, 5, 5, 15, 15, [0, 128, 255, 255]);
    const doc = makeDoc(x, group('G', [a, b], { passThrough: false, opacity: 0.6 }));
    const before = render(doc);
    expect(mergeVisible(doc)).not.toBeNull();
    expect(tree(doc.layers)).toEqual(['X', 'Merged']);
    expect(maxDiff(render(doc), before)).toBeLessThanOrEqual(1);

    const single = raster('only');
    fill(single, 0, 0, 4, 4, [1, 2, 3, 255]);
    const doc2 = makeDoc(group('G', [single]));
    expect(mergeVisible(doc2)).not.toBeNull();
    expect(tree(doc2.layers)).toEqual(['Merged']);
    expect(doc2.layers[0].kind === 'raster' && doc2.layers[0].pixels.getPixel(1, 1)).toEqual([1, 2, 3, 255]);
  });

  it('keeps layers clipped to a hidden base with their base', () => {
    const h = raster('H', { visible: false });
    fill(h, 0, 0, 16, 16, [0, 255, 0, 255]);
    const c = raster('C', { clip: true });
    fill(c, 0, 0, 16, 16, [255, 0, 255, 255]);
    const v1 = raster('V1');
    fill(v1, 0, 0, 8, 8, [255, 0, 0, 255]);
    const v2 = raster('V2');
    fill(v2, 8, 8, 16, 16, [0, 0, 255, 255]);
    const doc = makeDoc(h, c, v1, v2);
    const before = render(doc);
    expect(mergeVisible(doc)).not.toBeNull();
    expect(tree(doc.layers)).toEqual(['H', 'C', 'Merged']);
    expect(c.clip).toBe(true);
    expect(maxDiff(render(doc), before)).toBe(0);
  });

  it('refuses when fewer than two layers are drawn', () => {
    expect(mergeVisible(makeDoc(raster('A')))).toBeNull();
    expect(mergeVisible(makeDoc(raster('A'), raster('B', { visible: false })))).toBeNull();
    expect(mergeVisible(makeDoc(group('G', [raster('A', { visible: false })])))).toBeNull();
  });
});

describe('flatten copy', () => {
  it('adds the visible composite as a new top layer and keeps the originals', () => {
    const a = raster('A', { opacity: 0.5 });
    fill(a, 0, 0, 12, 12, [255, 0, 0, 255]);
    const hidden = raster('Hidden', { visible: false });
    fill(hidden, 0, 0, 16, 16, [0, 255, 0, 255]);
    const m = raster('M', { blendMode: 'multiply' });
    fill(m, 4, 4, 16, 16, [0, 0, 255, 255]);
    const doc = makeDoc(a, hidden, group('G', [m]));
    const expected = render(doc, true);
    const e = flattenCopy(doc);
    expect(tree(doc.layers)).toEqual(['A', 'Hidden', ['G', ['M']], 'Flattened copy']);
    const copy = doc.activeRaster!;
    expect(copy.name).toBe('Flattened copy');
    expect([...copy.pixels.readRect(doc.bounds)]).toEqual([...expected]);
    e.undo();
    expect(tree(doc.layers)).toEqual(['A', 'Hidden', ['G', ['M']]]);
  });
});

describe('move and group', () => {
  it('moves a layer within its list and into a group, undoably', () => {
    const [a, b, c] = [raster('A'), raster('B'), raster('C')];
    const g = group('G', []);
    const doc = makeDoc(a, b, c, g);
    moveLayer(doc, a.id, null, 3);
    expect(tree(doc.layers)).toEqual(['B', 'C', 'A', ['G', []]]);
    moveLayer(doc, g.id, null, 0);
    expect(tree(doc.layers)).toEqual([['G', []], 'B', 'C', 'A']);
    const e = moveLayer(doc, c.id, g.id, 0)!;
    expect(tree(doc.layers)).toEqual([['G', ['C']], 'B', 'A']);
    e.undo();
    expect(tree(doc.layers)).toEqual([['G', []], 'B', 'C', 'A']);
    e.redo();
    expect(tree(doc.layers)).toEqual([['G', ['C']], 'B', 'A']);
  });

  it('refuses to move a group into itself, a descendant or a paint layer', () => {
    const inner = group('Inner', []);
    const outer = group('Outer', [inner]);
    const a = raster('A');
    const doc = makeDoc(a, outer);
    expect(moveLayer(doc, outer.id, outer.id, 0)).toBeNull();
    expect(moveLayer(doc, outer.id, inner.id, 0)).toBeNull();
    expect(moveLayer(doc, outer.id, a.id, 0)).toBeNull();
    expect(tree(doc.layers)).toEqual(['A', ['Outer', [['Inner', []]]]]);
  });

  it('wraps the active layer in a new group in place', () => {
    const [a, b, c] = [raster('A'), raster('B'), raster('C')];
    const doc = makeDoc(a, b, c);
    doc.activeLayerId = b.id;
    const e = groupActive(doc)!;
    expect(tree(doc.layers)).toEqual(['A', ['Group 1', ['B']], 'C']);
    expect(doc.activeLayerId).toBe(b.id);
    e.undo();
    expect(tree(doc.layers)).toEqual(['A', 'B', 'C']);
  });
});

describe('clear layer', () => {
  it('clears all pixels without a selection and undo restores them', () => {
    const a = raster('A');
    fill(a, 0, 0, 16, 16, [10, 20, 30, 255]);
    const doc = makeDoc(a);
    const before = snapshot(a.pixels);
    const e = clearLayer(doc, a.id)!;
    expect(a.pixels.getPixel(3, 3)[3]).toBe(0);
    expect(a.pixels.getPixel(12, 12)[3]).toBe(0);
    e.undo();
    expect(snapshot(a.pixels)).toEqual(before);
  });

  it('clears only inside the selection, respecting partial coverage', () => {
    const a = raster('A');
    fill(a, 0, 0, 16, 16, [10, 20, 30, 255]);
    const doc = makeDoc(a);
    doc.selection = new MaskGrid(TS, 0);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 8; x++) doc.selection.setValue(x, y, 255);
      doc.selection.setValue(8, y, 128);
    }
    const before = snapshot(a.pixels);
    const e = clearLayer(doc, a.id)!;
    expect(a.pixels.getPixel(2, 2)[3]).toBe(0);
    expect(a.pixels.getPixel(8, 2)[3]).toBe(127);
    expect(a.pixels.getPixel(12, 2)).toEqual([10, 20, 30, 255]);
    e.undo();
    expect(snapshot(a.pixels)).toEqual(before);
  });

  it('resets the mask to reveal when the mask is being edited', () => {
    const a = raster('A', { editMask: true });
    fill(a, 0, 0, 16, 16, [10, 20, 30, 255]);
    a.mask = new MaskGrid(TS, 255);
    a.mask.setValue(5, 5, 0);
    const doc = makeDoc(a);
    const pixels = snapshot(a.pixels);
    const e = clearLayer(doc, a.id)!;
    expect(a.mask.getValue(5, 5)).toBe(255);
    expect(snapshot(a.pixels)).toEqual(pixels);
    e.undo();
    expect(a.mask.getValue(5, 5)).toBe(0);
  });

  it('ignores group layers', () => {
    const g = group('G', [raster('A')]);
    expect(clearLayer(makeDoc(g), g.id)).toBeNull();
  });
});
