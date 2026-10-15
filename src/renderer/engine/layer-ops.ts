// Layer tree operations. Each returns a HistoryEntry that has already been applied.
import { blendInto, loadPremul, modeIndex, storeStraight } from './blend';
import { Compositor } from './compositor';
import type { RasterDocument } from './document';
import { forEachTileInRect, type Rect } from './geometry';
import {
  compoundEntry,
  snapshotStructure,
  structureEntry,
  TileDiffRecorder,
  type HistoryEntry,
} from './history';
import {
  cloneLayer,
  createGroupLayer,
  createRasterLayer,
  findLayer,
  forEachLayer,
  isDescendant,
  layerByteSize,
  type GroupLayer,
  type LayerNode,
  type RasterLayer,
} from './layers';
import { MaskGrid, TileGrid, keyTx, keyTy, tileKey } from './tiles';

function nextLayerName(doc: RasterDocument, base = 'Layer'): string {
  let max = 0;
  forEachLayer(doc.layers, (n) => {
    const m = new RegExp(`^${base} (\\d+)$`).exec(n.name);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return `${base} ${max + 1}`;
}

/** Runs a structural mutation and returns its undo entry. */
export function structural(
  doc: RasterDocument,
  label: string,
  mutate: () => void,
  extraBytes = 0,
): HistoryEntry {
  const before = snapshotStructure(doc);
  mutate();
  doc.markStructureChanged();
  const after = snapshotStructure(doc);
  return structureEntry(doc, label, before, after, extraBytes);
}

/** Inserts `node` above the active layer (inside the active layer's parent). */
function insertAboveActive(doc: RasterDocument, node: LayerNode) {
  const loc = findLayer(doc.layers, doc.activeLayerId);
  if (!loc) doc.layers.push(node);
  else if (loc.node.kind === 'group' && loc.node.expanded) loc.node.children.push(node);
  else loc.siblings.splice(loc.index + 1, 0, node);
  doc.activeLayerId = node.id;
}

export function addRasterLayer(
  doc: RasterDocument,
  name?: string,
): { entry: HistoryEntry; layer: RasterLayer } {
  const layer = createRasterLayer(name ?? nextLayerName(doc), doc.tileSize);
  const entry = structural(doc, 'New layer', () => insertAboveActive(doc, layer));
  return { entry, layer };
}

export function addLayerWithPixels(
  doc: RasterDocument,
  name: string,
  pixels: TileGrid,
): { entry: HistoryEntry; layer: RasterLayer } {
  const layer = createRasterLayer(name, doc.tileSize);
  layer.pixels = pixels;
  const entry = structural(doc, `Add ${name}`, () => insertAboveActive(doc, layer), pixels.byteSize);
  doc.markPixelsChanged(null);
  return { entry, layer };
}

export function addGroup(doc: RasterDocument): HistoryEntry {
  const g = createGroupLayer(nextLayerName(doc, 'Group'));
  return structural(doc, 'New group', () => insertAboveActive(doc, g));
}

/** Moves the active layer into a new group. */
export function groupActive(doc: RasterDocument): HistoryEntry | null {
  const loc = findLayer(doc.layers, doc.activeLayerId);
  if (!loc) return null;
  const g = createGroupLayer(nextLayerName(doc, 'Group'));
  return structural(doc, 'Group layer', () => {
    loc.siblings.splice(loc.index, 1, g);
    g.children.push(loc.node);
    doc.activeLayerId = loc.node.id;
  });
}

export function deleteLayer(doc: RasterDocument, id: string): HistoryEntry | null {
  const loc = findLayer(doc.layers, id);
  if (!loc) return null;
  let total = 0;
  forEachLayer(doc.layers, () => total++);
  const removedCount = loc.node.kind === 'group' ? 1 + countNodes(loc.node.children) : 1;
  if (total - removedCount < 1) return null; // always keep one layer
  return structural(
    doc,
    `Delete ${loc.node.name}`,
    () => {
      loc.siblings.splice(loc.index, 1);
      const neighbour =
        loc.siblings[Math.min(loc.index, loc.siblings.length - 1)] ?? loc.parent ?? firstRaster(doc.layers);
      doc.activeLayerId = neighbour?.id ?? '';
    },
    layerByteSize(loc.node),
  );
}

function countNodes(list: LayerNode[]): number {
  let n = 0;
  forEachLayer(list, () => n++);
  return n;
}

function firstRaster(list: LayerNode[]): LayerNode | null {
  let found: LayerNode | null = null;
  forEachLayer(list, (n) => {
    if (!found && n.kind === 'raster') found = n;
  });
  return found;
}

export function duplicateLayer(doc: RasterDocument, id: string): HistoryEntry | null {
  const loc = findLayer(doc.layers, id);
  if (!loc) return null;
  const copy = cloneLayer(loc.node, ' copy');
  const entry = structural(
    doc,
    `Duplicate ${loc.node.name}`,
    () => {
      loc.siblings.splice(loc.index + 1, 0, copy);
      doc.activeLayerId = copy.id;
    },
    layerByteSize(copy),
  );
  doc.markPixelsChanged(null);
  return entry;
}

/**
 * Moves a node to `parentId` (null = root) at `index` (in bottom→top order of the target list).
 * Refuses to move a group into itself.
 */
export function moveLayer(
  doc: RasterDocument,
  id: string,
  parentId: string | null,
  index: number,
): HistoryEntry | null {
  const loc = findLayer(doc.layers, id);
  if (!loc) return null;
  let target: LayerNode[];
  if (parentId) {
    const p = findLayer(doc.layers, parentId);
    if (!p || p.node.kind !== 'group') return null;
    if (loc.node.kind === 'group' && (p.node.id === loc.node.id || isDescendant(loc.node, p.node.id)))
      return null;
    target = p.node.children;
  } else target = doc.layers;
  return structural(doc, `Move ${loc.node.name}`, () => {
    loc.siblings.splice(loc.index, 1);
    let i = index;
    if (target === loc.siblings && loc.index < index) i -= 1;
    target.splice(Math.max(0, Math.min(target.length, i)), 0, loc.node);
  });
}

/** Moves the node one step up (+1) or down (−1) within its siblings. */
export function nudgeLayer(doc: RasterDocument, id: string, dir: 1 | -1): HistoryEntry | null {
  const loc = findLayer(doc.layers, id);
  if (!loc) return null;
  const j = loc.index + dir;
  if (j < 0 || j >= loc.siblings.length) return null;
  return structural(doc, dir > 0 ? 'Move layer up' : 'Move layer down', () => {
    const [n] = loc.siblings.splice(loc.index, 1);
    loc.siblings.splice(j, 0, n);
  });
}

export type LayerProps = Partial<
  Pick<
    RasterLayer,
    | 'name'
    | 'visible'
    | 'opacity'
    | 'blendMode'
    | 'locked'
    | 'label'
    | 'alphaLock'
    | 'clip'
    | 'maskEnabled'
    | 'editMask'
  > &
    Pick<GroupLayer, 'expanded' | 'passThrough'>
>;

export function setLayerProps(
  doc: RasterDocument,
  id: string,
  props: LayerProps,
  label = 'Layer properties',
): HistoryEntry | null {
  const node = doc.getLayer(id);
  if (!node) return null;
  return structural(doc, label, () => Object.assign(node, props));
}

/** Composites the given layers (no background) into a new sparse grid. */
export function compositeToGrid(
  doc: RasterDocument,
  roots: LayerNode[],
  isVisible?: (n: LayerNode) => boolean,
): TileGrid {
  const comp = new Compositor(doc);
  const out = new TileGrid(doc.tileSize);
  const keys = new Set<number>();
  forEachLayer(roots, (n) => {
    if (n.kind === 'raster') for (const k of n.pixels.tiles.keys()) keys.add(k);
  });
  const ts = doc.tileSize;
  const acc = new Float32Array(ts * ts * 4);
  for (const k of keys) {
    const tx = keyTx(k);
    const ty = keyTy(k);
    const r: Rect = { x: tx * ts, y: ty * ts, w: ts, h: ts };
    comp.compositeRect(r, acc, { roots, skipBackground: true, isVisible });
    const tile = new Uint8ClampedArray(ts * ts * 4);
    let any = false;
    for (let i = 0; i < ts * ts * 4; i += 4) {
      storeStraight(acc, i, tile, i);
      if (tile[i + 3]) any = true;
    }
    if (any) out.set(tx, ty, tile);
  }
  return out;
}

/** True when list[i] is clipped to a layer below it (the first node of a list never clips). */
function isClipped(list: LayerNode[], i: number): boolean {
  if (i <= 0 || i >= list.length) return false;
  const n = list[i];
  return n.kind === 'raster' && n.clip;
}

/** Which nodes of a sibling list the compositor draws: visible ones whose clipping base is visible too. */
function drawnFlags(list: LayerNode[]): boolean[] {
  const out: boolean[] = [];
  let baseShown = false;
  for (let i = 0; i < list.length; i++) {
    const shown: boolean = list[i].visible && (!isClipped(list, i) || baseShown);
    if (!isClipped(list, i)) baseShown = shown;
    out.push(shown);
  }
  return out;
}

/** Why the node cannot be merged down (user-facing), or null when it can. */
export function mergeDownProblem(doc: RasterDocument, id: string): string | null {
  const loc = findLayer(doc.layers, id);
  const upper = loc?.node;
  const lower = loc && loc.index > 0 ? loc.siblings[loc.index - 1] : undefined;
  if (!loc || upper?.kind !== 'raster' || lower?.kind !== 'raster')
    return 'Merge down needs a paint layer directly below the active paint layer.';
  if (!upper.visible || !lower.visible) return 'Show both layers before merging down.';
  if (lower.locked) return `"${lower.name}" is locked.`;
  // A single layer cannot reproduce these clipping set-ups, so the result would differ from the canvas.
  if (!upper.clip && isClipped(loc.siblings, loc.index - 1))
    return `Merging into the clipped layer "${lower.name}" would clip "${upper.name}" too.`;
  if (!upper.clip && isClipped(loc.siblings, loc.index + 1))
    return `Layers are clipped to "${upper.name}". Merge or release them first.`;
  return null;
}

/**
 * Merges a paint layer into the paint layer below so the canvas looks the same: the upper layer's
 * opacity, blend mode, mask and clipping are applied and alpha lock is ignored (it only restricts
 * painting). The lower layer keeps its blend mode and clipping; layers clipped to it stay clipped to
 * the result. Its opacity and enabled mask are baked into the pixels, except when the upper layer is
 * clipped to it: then they apply to both layers on screen and stay as they are.
 */
export function mergeDown(doc: RasterDocument, id: string): HistoryEntry | null {
  if (mergeDownProblem(doc, id)) return null;
  const loc = findLayer(doc.layers, id)!;
  const upper = loc.node as RasterLayer;
  const lower = loc.siblings[loc.index - 1] as RasterLayer;
  // Clipped upper over a base: source-atop on the lower pixels. When both are clipped to the
  // same base further down, plain "over" keeps the shared clip exact.
  const atop = upper.clip && !isClipped(loc.siblings, loc.index - 1);
  const lowerMask = !atop && lower.mask && lower.maskEnabled ? lower.mask : null;
  const bake = !atop && (lower.opacity < 1 || !!lowerMask);
  const upperMask = upper.mask && upper.maskEnabled ? upper.mask : null;
  const keys = new Set(upper.pixels.tiles.keys());
  if (bake) for (const k of lower.pixels.tiles.keys()) keys.add(k);
  const recorder = new TileDiffRecorder(lower.pixels);
  const px = new Float32Array(4);
  const src = new Float32Array(4);
  const m = modeIndex(upper.blendMode);
  const n = doc.tileSize * doc.tileSize;
  for (const k of keys) {
    const tx = keyTx(k);
    const ty = keyTy(k);
    const ut = upper.pixels.get(tx, ty);
    if (atop && !lower.pixels.get(tx, ty)) continue; // nothing to clip to
    recorder.captureTile(k);
    const dst = lower.pixels.getOrCreate(tx, ty);
    const lmt = lowerMask?.get(tx, ty);
    const ldef = lowerMask ? lowerMask.defaultValue / 255 : 1;
    const umt = upperMask?.get(tx, ty);
    const udef = upperMask ? upperMask.defaultValue / 255 : 1;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const ua = ut ? ut[i + 3] : 0;
      if (!bake && !ua) continue;
      loadPremul(dst, i, px, 0);
      if (bake) {
        const lk = lower.opacity * (lmt ? lmt[p] / 255 : ldef);
        px[0] *= lk;
        px[1] *= lk;
        px[2] *= lk;
        px[3] *= lk;
      }
      const uk = ua ? upper.opacity * (umt ? umt[p] / 255 : udef) : 0;
      if (uk > 0) {
        loadPremul(ut!, i, src, 0);
        blendInto(px, 0, src[0] * uk, src[1] * uk, src[2] * uk, src[3] * uk, m, atop);
      }
      storeStraight(px, 0, dst, i);
    }
  }
  const pixelEntry = recorder.toEntry('merge pixels', (r) => doc.markPixelsChanged(r));
  const structEntry = structural(
    doc,
    'remove merged',
    () => {
      loc.siblings.splice(loc.index, 1);
      if (bake) lower.opacity = 1;
      if (lowerMask) {
        lower.mask = null;
        lower.editMask = false;
      }
      doc.activeLayerId = lower.id;
    },
    layerByteSize(upper) + (lowerMask?.byteSize ?? 0),
  );
  doc.markPixelsChanged(null);
  return compoundEntry(`Merge ${upper.name} down`, pixelEntry ? [pixelEntry, structEntry] : [structEntry]);
}

/** Counts the nodes the compositor draws (groups and their drawn children). */
function countDrawn(list: LayerNode[]): number {
  const shown = drawnFlags(list);
  let c = 0;
  list.forEach((n, i) => {
    if (shown[i]) c += 1 + (n.kind === 'group' ? countDrawn(n.children) : 0);
  });
  return c;
}

/** Strips drawn content from a node: returns it if it is not drawn, a pruned group, or null. */
function keepUndrawn(n: LayerNode, drawn: boolean): LayerNode | null {
  if (!drawn) return n;
  if (n.kind !== 'group') return null;
  const shown = drawnFlags(n.children);
  n.children = n.children.map((c, i) => keepUndrawn(c, shown[i])).filter((c): c is LayerNode => c !== null);
  return n.children.length ? n : null;
}

/**
 * Replaces everything the canvas shows with one 'Merged' layer. Hidden layers (also inside visible
 * groups, which are kept to hold them) and layers clipped to a hidden base stay untouched.
 */
export function mergeVisible(doc: RasterDocument): HistoryEntry | null {
  if (countDrawn(doc.layers) < 2) return null;
  const grid = compositeToGrid(doc, doc.layers);
  const merged = createRasterLayer('Merged', doc.tileSize);
  merged.pixels = grid;
  const entry = structural(
    doc,
    'Merge visible',
    () => {
      const shown = drawnFlags(doc.layers);
      const first = shown.indexOf(true);
      const kept: LayerNode[] = [];
      let at = 0;
      doc.layers.forEach((n, i) => {
        const k = keepUndrawn(n, shown[i]);
        if (k) kept.push(k);
        // the merged layer takes the place of the lowest drawn node (above what is left of it)
        if (i === first) at = kept.length;
      });
      kept.splice(at, 0, merged);
      doc.layers = kept;
      doc.activeLayerId = merged.id;
    },
    grid.byteSize,
  );
  doc.markPixelsChanged(null);
  return entry;
}

export function flattenCopy(doc: RasterDocument): HistoryEntry {
  const grid = compositeToGrid(doc, doc.layers);
  const layer = createRasterLayer('Flattened copy', doc.tileSize);
  layer.pixels = grid;
  const entry = structural(
    doc,
    'Flatten copy',
    () => {
      doc.layers.push(layer);
      doc.activeLayerId = layer.id;
    },
    grid.byteSize,
  );
  doc.markPixelsChanged(null);
  return entry;
}

/** Clears pixels of a raster layer (inside the selection if one exists). */
export function clearLayer(doc: RasterDocument, id: string): HistoryEntry | null {
  const layer = doc.getLayer(id);
  if (!layer || layer.kind !== 'raster') return null;
  const grid = layer.editMask && layer.mask ? layer.mask : layer.pixels;
  const recorder = new TileDiffRecorder(grid);
  const sel = doc.selection;
  const ts = doc.tileSize;
  const isMask = grid instanceof MaskGrid;
  for (const [k, t] of grid.tiles) {
    const tx = keyTx(k);
    const ty = keyTy(k);
    if (!sel) {
      recorder.captureTile(k);
      if (isMask) t.fill(255);
      else t.fill(0);
      continue;
    }
    const st = sel.get(tx, ty);
    if (!st) continue;
    recorder.captureTile(k);
    for (let p = 0; p < ts * ts; p++) {
      const s = st[p] / 255;
      if (!s) continue;
      if (isMask) t[p] = t[p] + (255 - t[p]) * s;
      else t[p * 4 + 3] = t[p * 4 + 3] * (1 - s);
    }
  }
  const entry = recorder.toEntry(sel ? 'Clear selection' : 'Clear layer', (r) => doc.markPixelsChanged(r));
  doc.markPixelsChanged(null);
  return entry;
}

export function addMask(doc: RasterDocument, id: string, fromSelection: boolean): HistoryEntry | null {
  const layer = doc.getLayer(id);
  if (!layer || layer.kind !== 'raster' || layer.mask) return null;
  const mask = new MaskGrid(doc.tileSize, 255);
  if (fromSelection && doc.selection) {
    // outside the selection becomes hidden
    forEachTileInRect(doc.bounds, doc.tileSize, (tx, ty) => {
      const st = doc.selection!.get(tx, ty);
      const t = mask.getOrCreate(tx, ty);
      if (!st) t.fill(0);
      else t.set(st);
    });
    mask.prune();
  }
  const entry = structural(doc, 'Add layer mask', () => {
    layer.mask = mask;
    layer.maskEnabled = true;
    layer.editMask = true;
  });
  doc.markPixelsChanged(null);
  return entry;
}

export function deleteMask(doc: RasterDocument, id: string): HistoryEntry | null {
  const layer = doc.getLayer(id);
  if (!layer || layer.kind !== 'raster' || !layer.mask) return null;
  const entry = structural(doc, 'Delete layer mask', () => {
    layer.mask = null;
    layer.editMask = false;
  });
  doc.markPixelsChanged(null);
  return entry;
}

/** Bakes the mask into the pixels and removes it. */
export function applyMask(doc: RasterDocument, id: string): HistoryEntry | null {
  const layer = doc.getLayer(id);
  if (!layer || layer.kind !== 'raster' || !layer.mask) return null;
  const mask = layer.mask;
  const recorder = new TileDiffRecorder(layer.pixels);
  for (const [k, t] of layer.pixels.tiles) {
    const mt = mask.get(keyTx(k), keyTy(k));
    if (!mt) continue;
    recorder.captureTile(k);
    for (let p = 0; p < mt.length; p++) t[p * 4 + 3] = (t[p * 4 + 3] * mt[p]) / 255;
  }
  const pix = recorder.toEntry('apply mask pixels', (r) => doc.markPixelsChanged(r));
  const st = structural(doc, 'remove mask', () => {
    layer.mask = null;
    layer.editMask = false;
  });
  doc.markPixelsChanged(null);
  return compoundEntry('Apply layer mask', pix ? [pix, st] : [st]);
}

export { tileKey };
