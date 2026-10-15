// Sparse tile storage. Missing tiles are fully transparent (pixels) or the grid's default value (masks).
import { forEachTileInRect, type Rect } from './geometry';

export const DEFAULT_TILE_SIZE = 256;
export const tileKey = (tx: number, ty: number) => (ty + 4096) * 8192 + (tx + 4096);
export const keyTx = (key: number) => (key % 8192) - 4096;
export const keyTy = (key: number) => Math.floor(key / 8192) - 4096;

/** Straight (non-premultiplied) RGBA8 tiles. */
export class TileGrid {
  readonly tiles = new Map<number, Uint8ClampedArray>();
  /** Incremented whenever pixel content changes through recorded edits (drives thumbnails). */
  version = 0;
  constructor(readonly tileSize: number = DEFAULT_TILE_SIZE) {}

  get(tx: number, ty: number): Uint8ClampedArray | undefined {
    return this.tiles.get(tileKey(tx, ty));
  }

  getOrCreate(tx: number, ty: number): Uint8ClampedArray {
    const k = tileKey(tx, ty);
    let t = this.tiles.get(k);
    if (!t) {
      t = new Uint8ClampedArray(this.tileSize * this.tileSize * 4);
      this.tiles.set(k, t);
    }
    return t;
  }

  set(tx: number, ty: number, data: Uint8ClampedArray | null): void {
    const k = tileKey(tx, ty);
    if (data) this.tiles.set(k, data);
    else this.tiles.delete(k);
  }

  get tileCount(): number {
    return this.tiles.size;
  }

  get byteSize(): number {
    return this.tiles.size * this.tileSize * this.tileSize * 4;
  }

  clone(): TileGrid {
    const g = new TileGrid(this.tileSize);
    for (const [k, t] of this.tiles) g.tiles.set(k, t.slice());
    return g;
  }

  clear(): void {
    this.tiles.clear();
  }

  /** Returns straight RGBA 0..255 at a document pixel. */
  getPixel(x: number, y: number): [number, number, number, number] {
    const ts = this.tileSize;
    const tx = Math.floor(x / ts);
    const ty = Math.floor(y / ts);
    const t = this.get(tx, ty);
    if (!t) return [0, 0, 0, 0];
    const i = ((y - ty * ts) * ts + (x - tx * ts)) * 4;
    return [t[i], t[i + 1], t[i + 2], t[i + 3]];
  }

  setPixel(x: number, y: number, r: number, g: number, b: number, a: number): void {
    const ts = this.tileSize;
    const tx = Math.floor(x / ts);
    const ty = Math.floor(y / ts);
    const t = this.getOrCreate(tx, ty);
    const i = ((y - ty * ts) * ts + (x - tx * ts)) * 4;
    t[i] = r;
    t[i + 1] = g;
    t[i + 2] = b;
    t[i + 3] = a;
  }

  /** Bounding box of tiles that contain any non-transparent pixel (tile granularity is enough for most callers). */
  contentBounds(): Rect | null {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const ts = this.tileSize;
    for (const [k, t] of this.tiles) {
      if (isTileTransparent(t)) continue;
      const tx = keyTx(k);
      const ty = keyTy(k);
      // refine inside the tile
      let minX = ts;
      let minY = ts;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < ts; y++) {
        const row = y * ts * 4;
        for (let x = 0; x < ts; x++) {
          if (t[row + x * 4 + 3] !== 0) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      x0 = Math.min(x0, tx * ts + minX);
      y0 = Math.min(y0, ty * ts + minY);
      x1 = Math.max(x1, tx * ts + maxX + 1);
      y1 = Math.max(y1, ty * ts + maxY + 1);
    }
    if (!Number.isFinite(x0)) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** Removes tiles that are completely transparent. */
  prune(): void {
    for (const [k, t] of this.tiles) if (isTileTransparent(t)) this.tiles.delete(k);
  }

  /** Copies a document rect into a new straight RGBA buffer (row-major, w*h*4). */
  readRect(r: Rect): Uint8ClampedArray {
    const out = new Uint8ClampedArray(r.w * r.h * 4);
    const ts = this.tileSize;
    forEachTileInRect(r, ts, (tx, ty, sub) => {
      const t = this.get(tx, ty);
      if (!t) return;
      for (let y = sub.y; y < sub.y + sub.h; y++) {
        const src = ((y - ty * ts) * ts + (sub.x - tx * ts)) * 4;
        const dst = ((y - r.y) * r.w + (sub.x - r.x)) * 4;
        out.set(t.subarray(src, src + sub.w * 4), dst);
      }
    });
    return out;
  }

  /** Writes a straight RGBA buffer into a document rect, creating tiles as needed. */
  writeRect(r: Rect, data: Uint8ClampedArray, skipTransparentTiles = true): void {
    const ts = this.tileSize;
    forEachTileInRect(r, ts, (tx, ty, sub) => {
      let t = this.get(tx, ty);
      if (!t) {
        if (skipTransparentTiles) {
          let any = false;
          for (let y = sub.y; y < sub.y + sub.h && !any; y++) {
            const src = ((y - r.y) * r.w + (sub.x - r.x)) * 4;
            for (let i = 3; i < sub.w * 4; i += 4)
              if (data[src + i] !== 0) {
                any = true;
                break;
              }
          }
          if (!any) return;
        }
        t = this.getOrCreate(tx, ty);
      }
      for (let y = sub.y; y < sub.y + sub.h; y++) {
        const src = ((y - r.y) * r.w + (sub.x - r.x)) * 4;
        const dst = ((y - ty * ts) * ts + (sub.x - tx * ts)) * 4;
        t.set(data.subarray(src, src + sub.w * 4), dst);
      }
    });
  }
}

export function isTileTransparent(t: Uint8ClampedArray): boolean {
  for (let i = 3; i < t.length; i += 4) if (t[i] !== 0) return false;
  return true;
}

/** Single-channel 8-bit tiles (layer masks, selections). */
export class MaskGrid {
  readonly tiles = new Map<number, Uint8ClampedArray>();
  version = 0;
  constructor(
    readonly tileSize: number = DEFAULT_TILE_SIZE,
    /** Value of missing tiles: 255 = reveal (layer mask), 0 = unselected (selection). */
    readonly defaultValue: number = 255,
  ) {}

  get(tx: number, ty: number): Uint8ClampedArray | undefined {
    return this.tiles.get(tileKey(tx, ty));
  }

  getOrCreate(tx: number, ty: number): Uint8ClampedArray {
    const k = tileKey(tx, ty);
    let t = this.tiles.get(k);
    if (!t) {
      t = new Uint8ClampedArray(this.tileSize * this.tileSize);
      if (this.defaultValue !== 0) t.fill(this.defaultValue);
      this.tiles.set(k, t);
    }
    return t;
  }

  set(tx: number, ty: number, data: Uint8ClampedArray | null): void {
    const k = tileKey(tx, ty);
    if (data) this.tiles.set(k, data);
    else this.tiles.delete(k);
  }

  getValue(x: number, y: number): number {
    const ts = this.tileSize;
    const tx = Math.floor(x / ts);
    const ty = Math.floor(y / ts);
    const t = this.get(tx, ty);
    if (!t) return this.defaultValue;
    return t[(y - ty * ts) * ts + (x - tx * ts)];
  }

  setValue(x: number, y: number, v: number): void {
    const ts = this.tileSize;
    const tx = Math.floor(x / ts);
    const ty = Math.floor(y / ts);
    this.getOrCreate(tx, ty)[(y - ty * ts) * ts + (x - tx * ts)] = v;
  }

  clone(): MaskGrid {
    const g = new MaskGrid(this.tileSize, this.defaultValue);
    for (const [k, t] of this.tiles) g.tiles.set(k, t.slice());
    return g;
  }

  get byteSize(): number {
    return this.tiles.size * this.tileSize * this.tileSize;
  }

  readRect(r: Rect): Uint8ClampedArray {
    const out = new Uint8ClampedArray(r.w * r.h);
    if (this.defaultValue !== 0) out.fill(this.defaultValue);
    const ts = this.tileSize;
    forEachTileInRect(r, ts, (tx, ty, sub) => {
      const t = this.get(tx, ty);
      if (!t) return;
      for (let y = sub.y; y < sub.y + sub.h; y++) {
        const src = (y - ty * ts) * ts + (sub.x - tx * ts);
        out.set(t.subarray(src, src + sub.w), (y - r.y) * r.w + (sub.x - r.x));
      }
    });
    return out;
  }

  writeRect(r: Rect, data: Uint8ClampedArray): void {
    const ts = this.tileSize;
    forEachTileInRect(r, ts, (tx, ty, sub) => {
      const t = this.getOrCreate(tx, ty);
      for (let y = sub.y; y < sub.y + sub.h; y++) {
        const src = (y - r.y) * r.w + (sub.x - r.x);
        t.set(data.subarray(src, src + sub.w), (y - ty * ts) * ts + (sub.x - tx * ts));
      }
    });
  }

  /** Drops tiles whose every value equals the default. */
  prune(): void {
    for (const [k, t] of this.tiles) {
      let uniform = true;
      for (let i = 0; i < t.length; i++)
        if (t[i] !== this.defaultValue) {
          uniform = false;
          break;
        }
      if (uniform) this.tiles.delete(k);
    }
  }
}

/** Premultiplied float RGBA tiles used as the temporary stroke buffer. Tracks per-tile dirty bounds. */
export class FloatTileGrid {
  readonly tiles = new Map<number, Float32Array>();
  /** Per-tile touched bounds in tile-local pixels: [x0, y0, x1, y1) */
  readonly bounds = new Map<number, [number, number, number, number]>();
  constructor(readonly tileSize: number = DEFAULT_TILE_SIZE) {}

  get(tx: number, ty: number): Float32Array | undefined {
    return this.tiles.get(tileKey(tx, ty));
  }

  getOrCreate(tx: number, ty: number): Float32Array {
    const k = tileKey(tx, ty);
    let t = this.tiles.get(k);
    if (!t) {
      t = new Float32Array(this.tileSize * this.tileSize * 4);
      this.tiles.set(k, t);
    }
    return t;
  }

  markBounds(tx: number, ty: number, x0: number, y0: number, x1: number, y1: number): void {
    const k = tileKey(tx, ty);
    const b = this.bounds.get(k);
    if (!b) this.bounds.set(k, [x0, y0, x1, y1]);
    else {
      if (x0 < b[0]) b[0] = x0;
      if (y0 < b[1]) b[1] = y0;
      if (x1 > b[2]) b[2] = x1;
      if (y1 > b[3]) b[3] = y1;
    }
  }

  clear(): void {
    this.tiles.clear();
    this.bounds.clear();
  }

  get isEmpty(): boolean {
    return this.tiles.size === 0;
  }
}
