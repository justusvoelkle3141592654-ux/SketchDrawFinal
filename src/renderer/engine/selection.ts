// Selection masks: polygon rasterisation with anti-aliasing, flood fill, combine, invert, feather, outline.
import type { Point, Rect } from './geometry';
import type { RasterDocument } from './document';
import { MaskGrid, keyTx, keyTy, tileKey } from './tiles';
import type { HistoryEntry } from './history';

export type CombineMode = 'replace' | 'add' | 'subtract' | 'intersect';

/**
 * Rasterises a closed polygon (non-zero winding) into a coverage buffer covering `bounds`,
 * using 4 sub-scanlines per pixel row and exact horizontal span coverage.
 */
export function rasterizePolygon(points: Point[], bounds: Rect, antialias = true): Float32Array {
  const { x: bx, y: by, w, h } = bounds;
  const cov = new Float32Array(w * h);
  if (points.length < 3 || w <= 0 || h <= 0) return cov;
  const n = points.length;
  const SUB = antialias ? 4 : 1;
  const xs: number[] = [];
  const dirs: number[] = [];
  for (let row = 0; row < h; row++) {
    for (let s = 0; s < SUB; s++) {
      const sy = by + row + (s + 0.5) / SUB;
      xs.length = 0;
      dirs.length = 0;
      for (let i = 0; i < n; i++) {
        const a = points[i];
        const b = points[(i + 1) % n];
        if (a.y === b.y) continue;
        const up = a.y < b.y;
        const y0 = up ? a.y : b.y;
        const y1 = up ? b.y : a.y;
        if (sy < y0 || sy >= y1) continue;
        const t = (sy - a.y) / (b.y - a.y);
        xs.push(a.x + (b.x - a.x) * t);
        dirs.push(up ? 1 : -1);
      }
      if (xs.length < 2) continue;
      // sort crossings with their directions
      const order = xs.map((_, i) => i).sort((p, q) => xs[p] - xs[q]);
      let wind = 0;
      for (let k = 0; k < order.length - 1; k++) {
        wind += dirs[order[k]];
        if (wind === 0) continue;
        const x0 = Math.max(bx, xs[order[k]]);
        const x1 = Math.min(bx + w, xs[order[k + 1]]);
        if (x1 <= x0) continue;
        addSpan(cov, row * w, x0 - bx, x1 - bx, 1 / SUB, antialias);
      }
    }
  }
  if (!antialias) for (let i = 0; i < cov.length; i++) cov[i] = cov[i] >= 0.5 ? 1 : 0;
  return cov;
}

function addSpan(cov: Float32Array, rowOff: number, x0: number, x1: number, weight: number, aa: boolean) {
  if (!aa) {
    const a = Math.round(x0);
    const b = Math.round(x1);
    for (let x = a; x < b; x++) cov[rowOff + x] += weight;
    return;
  }
  const ix0 = Math.floor(x0);
  const ix1 = Math.floor(x1);
  if (ix0 === ix1) {
    cov[rowOff + ix0] += (x1 - x0) * weight;
    return;
  }
  cov[rowOff + ix0] += (ix0 + 1 - x0) * weight;
  for (let x = ix0 + 1; x < ix1; x++) cov[rowOff + x] += weight;
  if (ix1 < Number.MAX_SAFE_INTEGER && x1 > ix1) cov[rowOff + ix1] += (x1 - ix1) * weight;
}

export function ellipsePolygon(cx: number, cy: number, rx: number, ry: number, angle = 0): Point[] {
  const n = Math.max(32, Math.min(720, Math.ceil(Math.max(rx, ry) * 1.2)));
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = Math.cos(t) * rx;
    const y = Math.sin(t) * ry;
    out.push({ x: cx + x * c - y * s, y: cy + x * s + y * c });
  }
  return out;
}

export function rectPolygon(x0: number, y0: number, x1: number, y1: number): Point[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/** Writes a coverage buffer (0..1) for `bounds` into a new mask grid (values 0..255). */
export function coverageToMask(cov: Float32Array, bounds: Rect, tileSize: number): MaskGrid {
  const m = new MaskGrid(tileSize, 0);
  const { x: bx, y: by, w, h } = bounds;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = cov[y * w + x];
      if (v <= 0.002) continue;
      m.setValue(bx + x, by + y, Math.min(255, Math.round(v * 255)));
    }
  }
  return m;
}

export function polygonMask(doc: RasterDocument, points: Point[], antialias = true): MaskGrid {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const bx0 = Math.max(0, Math.floor(x0));
  const by0 = Math.max(0, Math.floor(y0));
  const bx1 = Math.min(doc.width, Math.ceil(x1));
  const by1 = Math.min(doc.height, Math.ceil(y1));
  const bounds = { x: bx0, y: by0, w: Math.max(0, bx1 - bx0), h: Math.max(0, by1 - by0) };
  if (!bounds.w || !bounds.h) return new MaskGrid(doc.tileSize, 0);
  return coverageToMask(rasterizePolygon(points, bounds, antialias), bounds, doc.tileSize);
}

export function selectAllMask(doc: RasterDocument): MaskGrid {
  const m = new MaskGrid(doc.tileSize, 0);
  const ts = doc.tileSize;
  for (let ty = 0; ty * ts < doc.height; ty++) {
    for (let tx = 0; tx * ts < doc.width; tx++) {
      const t = m.getOrCreate(tx, ty);
      const w = Math.min(ts, doc.width - tx * ts);
      const h = Math.min(ts, doc.height - ty * ts);
      if (w === ts && h === ts) t.fill(255);
      else for (let y = 0; y < h; y++) t.fill(255, y * ts, y * ts + w);
    }
  }
  return m;
}

/** Combines `next` into `current` and returns a new mask (inputs are not modified). */
export function combineMasks(current: MaskGrid | null, next: MaskGrid, mode: CombineMode): MaskGrid | null {
  if (mode === 'replace' || (!current && mode === 'add')) return isEmptyMask(next) ? null : next;
  if (!current) return mode === 'intersect' || mode === 'subtract' ? null : next;
  const out = new MaskGrid(next.tileSize, 0);
  const keys = new Set<number>([...current.tiles.keys(), ...next.tiles.keys()]);
  const n = next.tileSize * next.tileSize;
  for (const k of keys) {
    const a = current.tiles.get(k);
    const b = next.tiles.get(k);
    const t = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) {
      const va = a ? a[i] : 0;
      const vb = b ? b[i] : 0;
      let v: number;
      if (mode === 'add') v = va + vb - (va * vb) / 255;
      else if (mode === 'subtract') v = (va * (255 - vb)) / 255;
      else v = (va * vb) / 255;
      t[i] = v;
    }
    out.tiles.set(k, t);
  }
  out.prune();
  return isEmptyMask(out) ? null : out;
}

export function isEmptyMask(m: MaskGrid): boolean {
  for (const t of m.tiles.values()) for (let i = 0; i < t.length; i++) if (t[i]) return false;
  return true;
}

export function invertMask(doc: RasterDocument, m: MaskGrid | null): MaskGrid | null {
  const all = selectAllMask(doc);
  if (!m) return all;
  for (const [k, t] of all.tiles) {
    const src = m.tiles.get(k);
    if (!src) continue;
    for (let i = 0; i < t.length; i++) t[i] = t[i] ? 255 - src[i] : 0;
  }
  all.prune();
  return isEmptyMask(all) ? null : all;
}

/** Reads a mask into a dense document-sized buffer. */
export function maskToDense(doc: RasterDocument, m: MaskGrid): Uint8ClampedArray {
  return m.readRect({ x: 0, y: 0, w: doc.width, h: doc.height });
}

export function denseToMask(doc: RasterDocument, dense: Uint8ClampedArray): MaskGrid {
  const m = new MaskGrid(doc.tileSize, 0);
  m.writeRect({ x: 0, y: 0, w: doc.width, h: doc.height }, dense);
  m.prune();
  return m;
}

/** Mask bounds grown by `margin` and clamped to the document (where filters do their work). */
function workRegion(doc: RasterDocument, m: MaskGrid, margin: number): Rect | null {
  const b = maskBounds(m);
  if (!b) return null;
  const x0 = Math.max(0, b.x - margin);
  const y0 = Math.max(0, b.y - margin);
  const x1 = Math.min(doc.width, b.x + b.w + margin);
  const y1 = Math.min(doc.height, b.y + b.h + margin);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function regionToMask(doc: RasterDocument, region: Rect, data: Uint8ClampedArray): MaskGrid | null {
  const m = new MaskGrid(doc.tileSize, 0);
  m.writeRect(region, data);
  m.prune();
  return isEmptyMask(m) ? null : m;
}

/**
 * Approximate Gaussian feather: three box-blur passes in each direction. Only the selection's
 * bounds plus the blur reach are processed; edges replicate, so the canvas border stays selected.
 */
export function featherMask(doc: RasterDocument, m: MaskGrid, radius: number): MaskGrid | null {
  if (radius <= 0) return m;
  const r = Math.max(1, Math.round(radius / 1.7));
  const region = workRegion(doc, m, 3 * r + 2);
  if (!region) return null;
  const { w, h } = region;
  const a = new Float32Array(m.readRect(region));
  const b = new Float32Array(w * h);
  for (let pass = 0; pass < 3; pass++) {
    boxBlurH(a, b, w, h, r);
    boxBlurV(b, a, w, h, r);
  }
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0; i < out.length; i++) out[i] = a[i];
  return regionToMask(doc, region, out);
}

function boxBlurH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r - 1; x < r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      acc += src[row + Math.min(w - 1, x + r)] - src[row + Math.max(0, x - r - 1)];
      dst[row + x] = acc * k;
    }
  }
}

function boxBlurV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const k = 1 / (2 * r + 1);
  const acc = new Float64Array(w);
  // rows are walked in order (cache friendly) while one accumulator per column runs down
  for (let y = -r - 1; y < r; y++) {
    const row = Math.min(h - 1, Math.max(0, y)) * w;
    for (let x = 0; x < w; x++) acc[x] += src[row + x];
  }
  for (let y = 0; y < h; y++) {
    const add = Math.min(h - 1, y + r) * w;
    const sub = Math.max(0, y - r - 1) * w;
    const out = y * w;
    for (let x = 0; x < w; x++) {
      acc[x] += src[add + x] - src[sub + x];
      dst[out + x] = acc[x] * k;
    }
  }
}

/**
 * Sliding-window maximum/minimum over 2r+1 samples (van Herk / Gil-Werman: constant cost per pixel
 * for any radius). `e` holds the line padded by r replicated samples on each side.
 */
function slidingExtreme(
  e: Uint8Array,
  len: number,
  k: number,
  isMax: boolean,
  g: Uint8Array,
  hh: Uint8Array,
  res: Uint8Array,
  n: number,
) {
  for (let start = 0; start < len; start += k) {
    const end = Math.min(len, start + k);
    let acc = e[start];
    g[start] = acc;
    for (let j = start + 1; j < end; j++) {
      const v = e[j];
      acc = isMax ? (v > acc ? v : acc) : v < acc ? v : acc;
      g[j] = acc;
    }
    acc = e[end - 1];
    hh[end - 1] = acc;
    for (let j = end - 2; j >= start; j--) {
      const v = e[j];
      acc = isMax ? (v > acc ? v : acc) : v < acc ? v : acc;
      hh[j] = acc;
    }
  }
  for (let i = 0; i < n; i++) {
    const a = hh[i];
    const b = g[i + k - 1];
    res[i] = isMax ? (a > b ? a : b) : a < b ? a : b;
  }
}

/** Grows (positive) or shrinks (negative) a selection by `px` pixels with a square min/max filter. */
export function growMask(doc: RasterDocument, m: MaskGrid, px: number): MaskGrid | null {
  if (!px) return m;
  const r = Math.abs(Math.round(px));
  const grow = px > 0;
  const region = workRegion(doc, m, r + 1);
  if (!region) return null;
  const { w, h } = region;
  const src = m.readRect(region);
  const tmp = new Uint8ClampedArray(w * h);
  const out = new Uint8ClampedArray(w * h);
  const k = 2 * r + 1;
  const maxLen = Math.max(w, h) + 2 * r;
  const e = new Uint8Array(maxLen);
  const g = new Uint8Array(maxLen);
  const hh = new Uint8Array(maxLen);
  const res = new Uint8Array(Math.max(w, h));
  // rows
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let j = 0; j < w + 2 * r; j++) e[j] = src[row + Math.min(w - 1, Math.max(0, j - r))];
    slidingExtreme(e, w + 2 * r, k, grow, g, hh, res, w);
    tmp.set(res.subarray(0, w), row);
  }
  // columns
  for (let x = 0; x < w; x++) {
    for (let j = 0; j < h + 2 * r; j++) e[j] = tmp[Math.min(h - 1, Math.max(0, j - r)) * w + x];
    slidingExtreme(e, h + 2 * r, k, grow, g, hh, res, h);
    for (let y = 0; y < h; y++) out[y * w + x] = res[y];
  }
  return regionToMask(doc, region, out);
}

/**
 * Flood fill region of similar colour starting at (x, y) in a straight RGBA buffer.
 * Returns a dense 0/255 mask. `tolerance` is 0..1 of the maximum channel difference.
 */
export function floodRegion(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
  tolerance: number,
  contiguous: boolean,
): Uint8Array {
  const out = new Uint8Array(w * h);
  if (x < 0 || y < 0 || x >= w || y >= h) return out;
  const i0 = (y * w + x) * 4;
  const r0 = rgba[i0];
  const g0 = rgba[i0 + 1];
  const b0 = rgba[i0 + 2];
  const a0 = rgba[i0 + 3];
  const tol = Math.round(tolerance * 255);
  const match = (p: number) => {
    const j = p * 4;
    const a = rgba[j + 3];
    // compare premultiplied-ish: fully transparent pixels match each other regardless of colour
    if (a0 === 0 && a === 0) return true;
    return (
      Math.abs(rgba[j] - r0) <= tol &&
      Math.abs(rgba[j + 1] - g0) <= tol &&
      Math.abs(rgba[j + 2] - b0) <= tol &&
      Math.abs(a - a0) <= tol
    );
  };
  if (!contiguous) {
    for (let p = 0; p < w * h; p++) if (match(p)) out[p] = 255;
    return out;
  }
  const stack: number[] = [y * w + x];
  while (stack.length) {
    const p = stack.pop()!;
    const py = Math.floor(p / w);
    let lx = p - py * w;
    while (lx > 0 && !out[py * w + lx - 1] && match(py * w + lx - 1)) lx--;
    let rx = p - py * w;
    while (rx < w - 1 && !out[py * w + rx + 1] && match(py * w + rx + 1)) rx++;
    for (let xx = lx; xx <= rx; xx++) out[py * w + xx] = 255;
    for (const ny of [py - 1, py + 1]) {
      if (ny < 0 || ny >= h) continue;
      let inSpan = false;
      for (let xx = lx; xx <= rx; xx++) {
        const q = ny * w + xx;
        const ok = !out[q] && match(q);
        if (ok && !inSpan) {
          stack.push(q);
          inSpan = true;
        } else if (!ok) inSpan = false;
      }
    }
  }
  return out;
}

/** Bounding box of non-zero mask values (pixel accurate), or null. */
export function maskBounds(m: MaskGrid): Rect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const ts = m.tileSize;
  for (const [k, t] of m.tiles) {
    const tx = keyTx(k);
    const ty = keyTy(k);
    for (let y = 0; y < ts; y++) {
      for (let x = 0; x < ts; x++) {
        if (!t[y * ts + x]) continue;
        const dx = tx * ts + x;
        const dy = ty * ts + y;
        if (dx < x0) x0 = dx;
        if (dx > x1) x1 = dx;
        if (dy < y0) y0 = dy;
        if (dy > y1) y1 = dy;
      }
    }
  }
  if (!Number.isFinite(x0)) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Outline segments [x0, y0, x1, y1, …] (document coordinates) of the mask at the 50 % threshold.
 * Horizontal and vertical runs are merged. Very large masks are sampled on a coarser grid.
 */
export function maskOutline(m: MaskGrid, w: number, h: number): number[] {
  const segs: number[] = [];
  const b = maskBounds(m);
  if (!b) return segs;
  const area = b.w * b.h;
  const step = area > 16e6 ? 4 : area > 4e6 ? 2 : 1;
  const x0 = Math.max(0, b.x - 1);
  const y0 = Math.max(0, b.y - 1);
  const x1 = Math.min(w, b.x + b.w + 1);
  const y1 = Math.min(h, b.y + b.h + 1);
  const rw = x1 - x0;
  const rh = y1 - y0;
  const dense = m.readRect({ x: x0, y: y0, w: rw, h: rh });
  const inside = (x: number, y: number) =>
    x >= x0 && y >= y0 && x < x1 && y < y1 && dense[(y - y0) * rw + (x - x0)] >= 128;
  for (let y = y0; y <= y1; y += step) {
    let start = -1;
    for (let x = x0; x <= x1; x += step) {
      const edge = x < x1 && inside(x, y - step) !== inside(x, y);
      if (edge && start < 0) start = x;
      if (!edge && start >= 0) {
        segs.push(start, y, x, y);
        start = -1;
      }
    }
  }
  for (let x = x0; x <= x1; x += step) {
    let start = -1;
    for (let y = y0; y <= y1; y += step) {
      const edge = y < y1 && inside(x - step, y) !== inside(x, y);
      if (edge && start < 0) start = y;
      if (!edge && start >= 0) {
        segs.push(x, start, x, y);
        start = -1;
      }
    }
  }
  return segs;
}

/** Undo entry swapping the document selection (masks are treated as immutable values). */
export function selectionEntry(
  doc: RasterDocument,
  label: string,
  before: MaskGrid | null,
  after: MaskGrid | null,
): HistoryEntry {
  const set = (m: MaskGrid | null) => {
    doc.selection = m;
    doc.markSelectionChanged();
  };
  return {
    label,
    bytes: (before?.byteSize ?? 0) + (after?.byteSize ?? 0) + 128,
    undo: () => set(before),
    redo: () => set(after),
  };
}

export { tileKey };
