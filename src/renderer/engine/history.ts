// Undo/redo history with a memory budget.
import type { RasterDocument } from './document';
import { findLayer, type GroupLayer, type LayerNode, type RasterLayer } from './layers';
import { keyTx, keyTy, type MaskGrid, type TileGrid } from './tiles';
import type { Rect } from './geometry';

export interface HistoryEntry {
  label: string;
  /** Approximate retained bytes. */
  readonly bytes: number;
  undo(): void;
  redo(): void;
}

export const DEFAULT_HISTORY_BUDGET = 768 * 1024 * 1024;
export const MAX_HISTORY_ENTRIES = 300;

let entrySerial = 0;

export class History {
  private entries: { id: number; entry: HistoryEntry }[] = [];
  /** Number of applied entries (entries[0..index-1] are applied). */
  private index = 0;
  private listeners = new Set<() => void>();
  budgetBytes = DEFAULT_HISTORY_BUDGET;
  maxEntries = MAX_HISTORY_ENTRIES;

  /** Records an entry whose effect has already been applied. Clears redo. */
  push(entry: HistoryEntry): void {
    this.entries.length = this.index;
    this.entries.push({ id: ++entrySerial, entry });
    this.index = this.entries.length;
    this.prune();
    this.emit();
  }

  /** Applies `entry.redo()` and records it. */
  execute(entry: HistoryEntry): void {
    entry.redo();
    this.push(entry);
  }

  undo(): boolean {
    if (this.index === 0) return false;
    this.index--;
    this.entries[this.index].entry.undo();
    this.emit();
    return true;
  }

  redo(): boolean {
    if (this.index >= this.entries.length) return false;
    this.entries[this.index].entry.redo();
    this.index++;
    this.emit();
    return true;
  }

  get canUndo(): boolean {
    return this.index > 0;
  }
  get canRedo(): boolean {
    return this.index < this.entries.length;
  }
  get undoLabel(): string | null {
    return this.index > 0 ? this.entries[this.index - 1].entry.label : null;
  }
  get redoLabel(): string | null {
    return this.index < this.entries.length ? this.entries[this.index].entry.label : null;
  }
  /** Identity of the current state, used for "unsaved changes" tracking. 0 = initial state. */
  get stateId(): number {
    return this.index > 0 ? this.entries[this.index - 1].id : 0;
  }
  get length(): number {
    return this.entries.length;
  }
  get position(): number {
    return this.index;
  }
  get totalBytes(): number {
    return this.entries.reduce((s, e) => s + e.entry.bytes, 0);
  }
  labels(): { label: string; applied: boolean }[] {
    return this.entries.map((e, i) => ({ label: e.entry.label, applied: i < this.index }));
  }

  clear(): void {
    this.entries = [];
    this.index = 0;
    this.emit();
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Drops the oldest entries while over budget, always keeping the most recent entry. */
  private prune(): void {
    let total = this.totalBytes;
    while (this.entries.length > 1 && (total > this.budgetBytes || this.entries.length > this.maxEntries)) {
      const removed = this.entries.shift()!;
      total -= removed.entry.bytes;
      this.index = Math.max(0, this.index - 1);
    }
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}

// ---------------------------------------------------------------------------------------------
// Tile diff: stores only the touched sub-rectangle of each tile and swaps it on undo/redo.

interface TilePatch {
  tx: number;
  ty: number;
  /** Tile-local rect. */
  x: number;
  y: number;
  w: number;
  h: number;
  existedBefore: boolean;
  /** Holds the "other" state: before-state while applied, after-state while undone. */
  data: Uint8ClampedArray;
  /** Union of rects actually requested (used to crop promoted full-tile captures). */
  used: [number, number, number, number];
}

type Grid = TileGrid | MaskGrid;

function channels(g: Grid): number {
  return 'defaultValue' in g ? 1 : 4;
}

/** Collects before-states while an operation mutates tiles, then becomes a history entry. */
export class TileDiffRecorder {
  private patches = new Map<number, TilePatch>();
  constructor(private readonly grid: Grid) {}

  /** Must be called before mutating tile-local rect [x, y, w, h] of tile (tx, ty). */
  capture(key: number, x: number, y: number, w: number, h: number): void {
    this.grid.version++;
    const tx = keyTx(key);
    const ty = keyTy(key);
    const existing = this.patches.get(key);
    const ch = channels(this.grid);
    const ts = this.grid.tileSize;
    const tile = this.grid.get(tx, ty);
    if (!existing) {
      this.patches.set(key, {
        tx,
        ty,
        x,
        y,
        w,
        h,
        used: [x, y, x + w, y + h],
        existedBefore: !!tile,
        data: readTileRect(
          tile,
          ts,
          ch,
          x,
          y,
          w,
          h,
          'defaultValue' in this.grid ? this.grid.defaultValue : 0,
        ),
      });
      return;
    }
    const x0r = Math.min(existing.used[0], x);
    const y0r = Math.min(existing.used[1], y);
    const x1r = Math.max(existing.used[2], x + w);
    const y1r = Math.max(existing.used[3], y + h);
    existing.used = [x0r, y0r, x1r, y1r];
    if (
      x >= existing.x &&
      y >= existing.y &&
      x + w <= existing.x + existing.w &&
      y + h <= existing.y + existing.h
    )
      return;
    // Growing repeatedly (e.g. many small dabs) would copy over and over: promote straight to the
    // full tile once. Newly covered pixels are still unmodified, so they are read from the tile.
    const x0 = 0;
    const y0 = 0;
    const nw = ts;
    const nh = ts;
    const def = 'defaultValue' in this.grid ? this.grid.defaultValue : 0;
    const merged = readTileRect(tile, ts, ch, x0, y0, nw, nh, def);
    // overlay the earlier captured (original) data
    for (let row = 0; row < existing.h; row++) {
      const src = row * existing.w * ch;
      const dst = ((existing.y - y0 + row) * nw + (existing.x - x0)) * ch;
      merged.set(existing.data.subarray(src, src + existing.w * ch), dst);
    }
    existing.x = x0;
    existing.y = y0;
    existing.w = nw;
    existing.h = nh;
    existing.data = merged;
  }

  /** Captures the full tile (used when the touched area is unknown in advance). */
  captureTile(key: number): void {
    this.capture(key, 0, 0, this.grid.tileSize, this.grid.tileSize);
  }

  get isEmpty(): boolean {
    return this.patches.size === 0;
  }

  /** Finishes recording. `onChange` is called after undo/redo with the affected document rect. */
  toEntry(label: string, onChange: (rect: Rect) => void): HistoryEntry | null {
    if (!this.patches.size) return null;
    // crop promoted captures back to the area that was really touched
    const ch = channels(this.grid);
    for (const p of this.patches.values()) {
      const [ux0, uy0, ux1, uy1] = p.used;
      if (ux0 === p.x && uy0 === p.y && ux1 === p.x + p.w && uy1 === p.y + p.h) continue;
      const cw = ux1 - ux0;
      const chh = uy1 - uy0;
      const cropped = new Uint8ClampedArray(cw * chh * ch);
      for (let row = 0; row < chh; row++) {
        const src = ((uy0 - p.y + row) * p.w + (ux0 - p.x)) * ch;
        cropped.set(p.data.subarray(src, src + cw * ch), row * cw * ch);
      }
      p.x = ux0;
      p.y = uy0;
      p.w = cw;
      p.h = chh;
      p.data = cropped;
    }
    return new TileDiffEntry(label, this.grid, [...this.patches.values()], onChange);
  }
}

function readTileRect(
  tile: Uint8ClampedArray | undefined,
  ts: number,
  ch: number,
  x: number,
  y: number,
  w: number,
  h: number,
  def: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * ch);
  if (!tile) {
    if (def) out.fill(def);
    return out;
  }
  for (let row = 0; row < h; row++) {
    const src = ((y + row) * ts + x) * ch;
    out.set(tile.subarray(src, src + w * ch), row * w * ch);
  }
  return out;
}

class TileDiffEntry implements HistoryEntry {
  readonly bytes: number;
  private applied = true;
  constructor(
    readonly label: string,
    private readonly grid: Grid,
    private readonly patches: TilePatch[],
    private readonly onChange: (rect: Rect) => void,
  ) {
    this.bytes = patches.reduce((s, p) => s + p.data.byteLength + 64, 256);
  }

  private swap(): void {
    const ch = channels(this.grid);
    const ts = this.grid.tileSize;
    let bounds: Rect | null = null;
    for (const p of this.patches) {
      const goingToBefore = this.applied;
      let tile = this.grid.get(p.tx, p.ty);
      if (!tile) tile = this.grid.getOrCreate(p.tx, p.ty);
      const current = new Uint8ClampedArray(p.w * p.h * ch);
      for (let row = 0; row < p.h; row++) {
        const off = ((p.y + row) * ts + p.x) * ch;
        current.set(tile.subarray(off, off + p.w * ch), row * p.w * ch);
        tile.set(p.data.subarray(row * p.w * ch, (row + 1) * p.w * ch), off);
      }
      p.data = current;
      if (goingToBefore && !p.existedBefore) this.grid.set(p.tx, p.ty, null);
      const r = { x: p.tx * ts + p.x, y: p.ty * ts + p.y, w: p.w, h: p.h };
      bounds = bounds
        ? {
            x: Math.min(bounds.x, r.x),
            y: Math.min(bounds.y, r.y),
            w: Math.max(bounds.x + bounds.w, r.x + r.w) - Math.min(bounds.x, r.x),
            h: Math.max(bounds.y + bounds.h, r.y + r.h) - Math.min(bounds.y, r.y),
          }
        : r;
    }
    this.applied = !this.applied;
    this.grid.version++;
    if (bounds) this.onChange(bounds);
  }

  undo(): void {
    if (this.applied) this.swap();
  }
  redo(): void {
    if (!this.applied) this.swap();
  }
}

// ---------------------------------------------------------------------------------------------
// Structural snapshots for layer tree operations (add, delete, reorder, properties, grouping).

interface NodeSnapshot {
  node: LayerNode;
  props: Record<string, unknown>;
  children: NodeSnapshot[] | null;
}

const SNAPSHOT_PROPS = [
  'name',
  'visible',
  'opacity',
  'blendMode',
  'locked',
  'label',
  'maskEnabled',
  'editMask',
  'alphaLock',
  'clip',
  'expanded',
  'passThrough',
  'mask',
] as const;

function snapNode(n: LayerNode): NodeSnapshot {
  const props: Record<string, unknown> = {};
  for (const k of SNAPSHOT_PROPS) if (k in n) props[k] = (n as unknown as Record<string, unknown>)[k];
  return { node: n, props, children: n.kind === 'group' ? n.children.map(snapNode) : null };
}

function restoreNode(s: NodeSnapshot): LayerNode {
  Object.assign(s.node, s.props);
  if (s.node.kind === 'group' && s.children) (s.node as GroupLayer).children = s.children.map(restoreNode);
  return s.node;
}

export interface StructureState {
  roots: NodeSnapshot[];
  activeLayerId: string;
}

export function snapshotStructure(doc: RasterDocument): StructureState {
  return { roots: doc.layers.map(snapNode), activeLayerId: doc.activeLayerId };
}

export function restoreStructure(doc: RasterDocument, s: StructureState): void {
  doc.layers = s.roots.map(restoreNode);
  doc.activeLayerId = findLayer(doc.layers, s.activeLayerId)
    ? s.activeLayerId
    : (doc.layers[doc.layers.length - 1]?.id ?? '');
  doc.markStructureChanged();
}

/** Entry restoring the layer tree before/after a structural change. Pixel data is shared, not copied. */
export function structureEntry(
  doc: RasterDocument,
  label: string,
  before: StructureState,
  after: StructureState,
  extraBytes = 0,
): HistoryEntry {
  return {
    label,
    bytes: 1024 + extraBytes,
    undo: () => restoreStructure(doc, before),
    redo: () => restoreStructure(doc, after),
  };
}

/** Groups several entries into one undo step. */
export function compoundEntry(label: string, parts: HistoryEntry[]): HistoryEntry {
  return {
    label,
    bytes: parts.reduce((s, p) => s + p.bytes, 0),
    undo: () => {
      for (let i = parts.length - 1; i >= 0; i--) parts[i].undo();
    },
    redo: () => {
      for (const p of parts) p.redo();
    },
  };
}

/** Swaps entire pixel grids (used by whole-document operations such as resize or rotate). */
export function gridSwapEntry(
  doc: RasterDocument,
  label: string,
  layer: RasterLayer,
  before: { pixels: TileGrid; mask: MaskGrid | null },
  after: { pixels: TileGrid; mask: MaskGrid | null },
): HistoryEntry {
  return {
    label,
    bytes:
      before.pixels.byteSize +
      after.pixels.byteSize +
      (before.mask?.byteSize ?? 0) +
      (after.mask?.byteSize ?? 0),
    undo: () => {
      layer.pixels = before.pixels;
      layer.mask = before.mask;
      doc.markPixelsChanged(null);
    },
    redo: () => {
      layer.pixels = after.pixels;
      layer.mask = after.mask;
      doc.markPixelsChanged(null);
    },
  };
}
