// Pixel operations used by tools and commands: extract/clear/paste, transforms, fill, gradient,
// adjustments and whole-document changes (resize, canvas size, rotate, flip). All edits are recorded.
import type { RGB } from './color';
import { rgbToHsl, hslToRgb } from './color';
import type { RasterDocument } from './document';
import { forEachTileInRect, intersectRect, isEmptyRect, type Point, type Rect } from './geometry';
import { TileDiffRecorder, type HistoryEntry } from './history';
import { allRasterLayers, type RasterLayer } from './layers';
import { MaskGrid, TileGrid, keyTx, keyTy, tileKey } from './tiles';

export interface PixelBlock {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Straight RGBA8. */
  data: Uint8ClampedArray;
}

/** Copies the pixels of a grid inside `rect`, multiplied by selection coverage when given. */
export function extractBlock(grid: TileGrid, rect: Rect, selection: MaskGrid | null): PixelBlock {
  const data = grid.readRect(rect);
  if (selection) {
    const sel = selection.readRect(rect);
    for (let p = 0; p < sel.length; p++) data[p * 4 + 3] = (data[p * 4 + 3] * sel[p]) / 255;
  }
  return { ...rect, data };
}

/** Non-transparent bounds of a block (or null when empty). */
export function trimBlock(b: PixelBlock): PixelBlock | null {
  let x0 = b.w;
  let y0 = b.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++)
      if (b.data[(y * b.w + x) * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    data.set(b.data.subarray(((y0 + y) * b.w + x0) * 4, ((y0 + y) * b.w + x0 + w) * 4), y * w * 4);
  return { x: b.x + x0, y: b.y + y0, w, h, data };
}

/** Removes pixels inside `rect` (weighted by the selection when given). */
export function clearBlock(
  grid: TileGrid,
  recorder: TileDiffRecorder,
  rect: Rect,
  selection: MaskGrid | null,
): void {
  const ts = grid.tileSize;
  forEachTileInRect(rect, ts, (tx, ty, sub) => {
    const t = grid.get(tx, ty);
    if (!t) return;
    const st = selection ? selection.get(tx, ty) : undefined;
    if (selection && !st) return;
    recorder.capture(tileKey(tx, ty), sub.x - tx * ts, sub.y - ty * ts, sub.w, sub.h);
    for (let y = sub.y; y < sub.y + sub.h; y++) {
      for (let x = sub.x; x < sub.x + sub.w; x++) {
        const p = (y - ty * ts) * ts + (x - tx * ts);
        const k = st ? st[p] / 255 : 1;
        t[p * 4 + 3] = t[p * 4 + 3] * (1 - k);
      }
    }
  });
}

/** Source-over of a straight RGBA block onto the grid (opacity 0..1). */
export function pasteBlock(
  grid: TileGrid,
  recorder: TileDiffRecorder,
  b: PixelBlock,
  clip: Rect,
  opacity = 1,
  alphaLock = false,
): Rect | null {
  const r = intersectRect({ x: b.x, y: b.y, w: b.w, h: b.h }, clip);
  if (isEmptyRect(r)) return null;
  const ts = grid.tileSize;
  forEachTileInRect(r, ts, (tx, ty, sub) => {
    let t = grid.get(tx, ty);
    if (!t && alphaLock) return;
    recorder.capture(tileKey(tx, ty), sub.x - tx * ts, sub.y - ty * ts, sub.w, sub.h);
    if (!t) t = grid.getOrCreate(tx, ty);
    for (let y = sub.y; y < sub.y + sub.h; y++) {
      for (let x = sub.x; x < sub.x + sub.w; x++) {
        const s = ((y - b.y) * b.w + (x - b.x)) * 4;
        const sa = (b.data[s + 3] / 255) * opacity;
        if (sa <= 0) continue;
        const d = ((y - ty * ts) * ts + (x - tx * ts)) * 4;
        blendStraight(t, d, b.data[s], b.data[s + 1], b.data[s + 2], sa, alphaLock);
      }
    }
  });
  return r;
}

/** Normal blend of a straight colour with alpha `sa` into a straight RGBA8 pixel. */
function blendStraight(
  t: Uint8ClampedArray,
  d: number,
  r: number,
  g: number,
  b: number,
  sa: number,
  alphaLock: boolean,
) {
  const da = t[d + 3] / 255;
  if (alphaLock) {
    if (da <= 0) return;
    t[d] = t[d] + (r - t[d]) * sa;
    t[d + 1] = t[d + 1] + (g - t[d + 1]) * sa;
    t[d + 2] = t[d + 2] + (b - t[d + 2]) * sa;
    return;
  }
  const na = sa + da * (1 - sa);
  if (na <= 0) return;
  const k = (da * (1 - sa)) / na;
  const ks = sa / na;
  t[d] = r * ks + t[d] * k;
  t[d + 1] = g * ks + t[d + 1] * k;
  t[d + 2] = b * ks + t[d + 2] * k;
  t[d + 3] = na * 255;
}

// --------------------------------------------------------------------------------- transforms

/** 3×3 projective matrix (row-major) mapping block-local pixel coordinates to document coordinates. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export function mat3FromAffine(a: number, b: number, c: number, d: number, e: number, f: number): Mat3 {
  // x' = a·x + c·y + e, y' = b·x + d·y + f
  return [a, c, e, b, d, f, 0, 0, 1];
}

export function mat3Apply(m: Mat3, x: number, y: number): Point {
  const w = m[6] * x + m[7] * y + m[8];
  return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w };
}

export function mat3Invert(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const k = 1 / det;
  return [
    A * k,
    -(b * i - c * h) * k,
    (b * f - c * e) * k,
    B * k,
    (a * i - c * g) * k,
    -(a * f - c * d) * k,
    C * k,
    -(a * h - b * g) * k,
    (a * e - b * d) * k,
  ];
}

/** Homography mapping the four `src` points onto the four `dst` points. */
export function homography(src: Point[], dst: Point[]): Mat3 | null {
  const A: number[][] = [];
  const bvec: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    bvec.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    bvec.push(v);
  }
  const sol = solve(A, bvec);
  if (!sol) return null;
  return [sol[0], sol[1], sol[2], sol[3], sol[4], sol[5], sol[6], sol[7], 1];
}

function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Box-downsamples a block by an integer factor (premultiplied averaging). */
function downsample(b: PixelBlock, f: number): PixelBlock {
  const w = Math.max(1, Math.floor(b.w / f));
  const h = Math.max(1, Math.floor(b.h / f));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let bl = 0;
      let a = 0;
      for (let yy = 0; yy < f; yy++)
        for (let xx = 0; xx < f; xx++) {
          const sx = Math.min(b.w - 1, x * f + xx);
          const sy = Math.min(b.h - 1, y * f + yy);
          const i = (sy * b.w + sx) * 4;
          const al = b.data[i + 3];
          r += b.data[i] * al;
          g += b.data[i + 1] * al;
          bl += b.data[i + 2] * al;
          a += al;
        }
      const j = (y * w + x) * 4;
      if (a) {
        data[j] = r / a;
        data[j + 1] = g / a;
        data[j + 2] = bl / a;
        data[j + 3] = a / (f * f);
      }
    }
  return { x: b.x, y: b.y, w, h, data };
}

/** Destination bounds of a block under a projective map. */
export function transformedBounds(b: { w: number; h: number }, m: Mat3): Rect {
  const pts = [mat3Apply(m, 0, 0), mat3Apply(m, b.w, 0), mat3Apply(m, b.w, b.h), mat3Apply(m, 0, b.h)];
  const x0 = Math.floor(Math.min(...pts.map((p) => p.x)));
  const y0 = Math.floor(Math.min(...pts.map((p) => p.y)));
  const x1 = Math.ceil(Math.max(...pts.map((p) => p.x)));
  const y1 = Math.ceil(Math.max(...pts.map((p) => p.y)));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Resamples `block` (local coordinates 0..w × 0..h) through `m` onto the grid using bilinear filtering
 * in premultiplied space (box prefilter for strong downscales). Integer translations copy exactly.
 */
export function drawTransformedBlock(
  grid: TileGrid,
  recorder: TileDiffRecorder,
  block: PixelBlock,
  m: Mat3,
  clip: Rect,
  opacity = 1,
): Rect | null {
  const isTranslate =
    m[0] === 1 &&
    m[1] === 0 &&
    m[3] === 0 &&
    m[4] === 1 &&
    m[6] === 0 &&
    m[7] === 0 &&
    m[8] === 1 &&
    Number.isInteger(m[2]) &&
    Number.isInteger(m[5]);
  if (isTranslate) return pasteBlock(grid, recorder, { ...block, x: m[2], y: m[5] }, clip, opacity);
  // estimate scale at the centre for prefiltering
  const c = mat3Apply(m, block.w / 2, block.h / 2);
  const cx = mat3Apply(m, block.w / 2 + 1, block.h / 2);
  const cy = mat3Apply(m, block.w / 2, block.h / 2 + 1);
  const scale = Math.min(Math.hypot(cx.x - c.x, cx.y - c.y), Math.hypot(cy.x - c.x, cy.y - c.y));
  let src = block;
  let mm = m;
  if (scale < 0.5) {
    const f = Math.min(16, Math.floor(1 / scale));
    src = downsample(block, f);
    // local coordinates of the downsampled block are scaled by f
    const sx = block.w / src.w;
    const sy = block.h / src.h;
    mm = [m[0] * sx, m[1] * sy, m[2], m[3] * sx, m[4] * sy, m[5], m[6] * sx, m[7] * sy, m[8]];
  }
  const inv = mat3Invert(mm);
  if (!inv) return null;
  const r = intersectRect(transformedBounds(src, mm), clip);
  if (isEmptyRect(r)) return null;
  const ts = grid.tileSize;
  const sw = src.w;
  const sh = src.h;
  const sd = src.data;
  const sample = (fx: number, fy: number, out: Float32Array) => {
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const ax = fx - x0;
    const ay = fy - y0;
    out[0] = out[1] = out[2] = out[3] = 0;
    for (let k = 0; k < 4; k++) {
      const xx = x0 + (k & 1);
      const yy = y0 + (k >> 1);
      if (xx < 0 || yy < 0 || xx >= sw || yy >= sh) continue;
      const wgt = (k & 1 ? ax : 1 - ax) * (k >> 1 ? ay : 1 - ay);
      const i = (yy * sw + xx) * 4;
      const a = (sd[i + 3] / 255) * wgt;
      out[0] += sd[i] * a;
      out[1] += sd[i + 1] * a;
      out[2] += sd[i + 2] * a;
      out[3] += a;
    }
  };
  const px = new Float32Array(4);
  forEachTileInRect(r, ts, (tx, ty, sub) => {
    let tile: Uint8ClampedArray | undefined;
    let captured = false;
    for (let y = sub.y; y < sub.y + sub.h; y++) {
      for (let x = sub.x; x < sub.x + sub.w; x++) {
        const p = mat3Apply(inv, x + 0.5, y + 0.5);
        sample(p.x - 0.5, p.y - 0.5, px);
        const a = px[3] * opacity;
        if (a <= 1 / 512) continue;
        if (!captured) {
          recorder.capture(tileKey(tx, ty), sub.x - tx * ts, sub.y - ty * ts, sub.w, sub.h);
          tile = grid.getOrCreate(tx, ty);
          captured = true;
        }
        const d = ((y - ty * ts) * ts + (x - tx * ts)) * 4;
        blendStraight(tile!, d, px[0] / px[3], px[1] / px[3], px[2] / px[3], a, false);
      }
    }
  });
  return r;
}

// --------------------------------------------------------------------------------- fill

/** Fills coverage (dense document-sized 0..255) with a colour, respecting selection and alpha lock. */
/**
 * Resamples a mask stored in the alpha channel of `block` with a content matrix `m` whose local
 * origin lies (dx, dy) before the mask block's origin, i.e. draws with m · T(dx, dy).
 */
export function transformMaskBlock(
  block: PixelBlock,
  dx: number,
  dy: number,
  m: Mat3,
  clip: Rect,
  tileSize: number,
): MaskGrid {
  const t: Mat3 = [
    m[0],
    m[1],
    m[0] * dx + m[1] * dy + m[2],
    m[3],
    m[4],
    m[3] * dx + m[4] * dy + m[5],
    m[6],
    m[7],
    m[6] * dx + m[7] * dy + m[8],
  ];
  const tmp = new TileGrid(tileSize);
  drawTransformedBlock(tmp, new TileDiffRecorder(tmp), block, t, clip);
  const mask = new MaskGrid(tileSize, 0);
  const n = tileSize * tileSize;
  for (const [k, tile] of tmp.tiles) {
    const out = mask.getOrCreate(keyTx(k), keyTy(k));
    for (let p = 0; p < n; p++) out[p] = tile[p * 4 + 3];
  }
  mask.prune();
  return mask;
}

export function fillCoverage(
  doc: RasterDocument,
  layer: RasterLayer,
  recorder: TileDiffRecorder,
  coverage: Uint8Array | Uint8ClampedArray,
  color: RGB,
  opacity: number,
): Rect | null {
  const w = doc.width;
  const h = doc.height;
  const ts = doc.tileSize;
  const sel = doc.selection;
  let any: Rect | null = null;
  const cr = color.r * 255;
  const cg = color.g * 255;
  const cb = color.b * 255;
  forEachTileInRect({ x: 0, y: 0, w, h }, ts, (tx, ty, sub) => {
    // skip tiles without coverage quickly
    let has = false;
    for (let y = sub.y; y < sub.y + sub.h && !has; y++)
      for (let x = sub.x; x < sub.x + sub.w; x++)
        if (coverage[y * w + x]) {
          has = true;
          break;
        }
    if (!has) return;
    const st = sel ? sel.get(tx, ty) : undefined;
    if (sel && !st) return;
    let t = layer.pixels.get(tx, ty);
    if (!t && layer.alphaLock) return;
    recorder.capture(tileKey(tx, ty), sub.x - tx * ts, sub.y - ty * ts, sub.w, sub.h);
    if (!t) t = layer.pixels.getOrCreate(tx, ty);
    for (let y = sub.y; y < sub.y + sub.h; y++) {
      for (let x = sub.x; x < sub.x + sub.w; x++) {
        let a = coverage[y * w + x] / 255;
        if (!a) continue;
        if (st) a *= st[(y - ty * ts) * ts + (x - tx * ts)] / 255;
        a *= opacity;
        if (a <= 0) continue;
        blendStraight(t, ((y - ty * ts) * ts + (x - tx * ts)) * 4, cr, cg, cb, a, layer.alphaLock);
      }
    }
    any = any ? { x: 0, y: 0, w, h } : { x: sub.x, y: sub.y, w: sub.w, h: sub.h };
  });
  return any;
}

/** Expands a 0/255 region by one pixel with half coverage to soften flood-fill edges against anti-aliased lines. */
export function softenRegion(region: Uint8Array, w: number, h: number, grow: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(region);
  if (grow <= 0) return out;
  for (let it = 0; it < grow; it++) {
    const prev = new Uint8ClampedArray(out);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (prev[i] === 255) continue;
        let n = 0;
        if (x > 0 && prev[i - 1] === 255) n++;
        if (x < w - 1 && prev[i + 1] === 255) n++;
        if (y > 0 && prev[i - w] === 255) n++;
        if (y < h - 1 && prev[i + w] === 255) n++;
        if (n) out[i] = 255;
      }
  }
  return out;
}

// --------------------------------------------------------------------------------- gradient

export interface GradientSpec {
  kind: 'linear' | 'radial';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  from: RGB;
  to: RGB;
  fromAlpha: number;
  toAlpha: number;
}

/** Renders a dithered gradient over the selection (or the whole layer) with normal blending. */
export function drawGradient(
  doc: RasterDocument,
  layer: RasterLayer,
  recorder: TileDiffRecorder,
  g: GradientSpec,
  opacity: number,
): void {
  const ts = doc.tileSize;
  const sel = doc.selection;
  const dx = g.x1 - g.x0;
  const dy = g.y1 - g.y0;
  const len2 = dx * dx + dy * dy || 1;
  const radius = Math.sqrt(len2);
  let seed = 1234567;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };
  forEachTileInRect(doc.bounds, ts, (tx, ty, sub) => {
    const st = sel ? sel.get(tx, ty) : undefined;
    if (sel && !st) return;
    let t = layer.pixels.get(tx, ty);
    if (!t && layer.alphaLock) return;
    recorder.capture(tileKey(tx, ty), sub.x - tx * ts, sub.y - ty * ts, sub.w, sub.h);
    if (!t) t = layer.pixels.getOrCreate(tx, ty);
    for (let y = sub.y; y < sub.y + sub.h; y++) {
      for (let x = sub.x; x < sub.x + sub.w; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        let u =
          g.kind === 'linear'
            ? ((px - g.x0) * dx + (py - g.y0) * dy) / len2
            : Math.hypot(px - g.x0, py - g.y0) / radius;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const n = noise() / 255; // ±0.5 LSB dither against banding
        const r = (g.from.r + (g.to.r - g.from.r) * u + n) * 255;
        const gg = (g.from.g + (g.to.g - g.from.g) * u + n) * 255;
        const b = (g.from.b + (g.to.b - g.from.b) * u + n) * 255;
        let a = (g.fromAlpha + (g.toAlpha - g.fromAlpha) * u) * opacity;
        if (st) a *= st[(y - ty * ts) * ts + (x - tx * ts)] / 255;
        if (a <= 0) continue;
        blendStraight(
          t,
          ((y - ty * ts) * ts + (x - tx * ts)) * 4,
          r,
          gg,
          b,
          Math.min(1, a + n * 0.5),
          layer.alphaLock,
        );
      }
    }
  });
}

// --------------------------------------------------------------------------------- adjustments

export type Adjustment =
  | { kind: 'brightness-contrast'; brightness: number; contrast: number }
  | { kind: 'hue-saturation'; hue: number; saturation: number; lightness: number }
  | { kind: 'grayscale' }
  | { kind: 'invert' };

/** Applies a destructive colour adjustment to a raster layer (inside the selection if any). */
export function applyAdjustment(
  doc: RasterDocument,
  layer: RasterLayer,
  recorder: TileDiffRecorder,
  adj: Adjustment,
): void {
  const sel = doc.selection;
  const ts = doc.tileSize;
  const lut = new Uint8ClampedArray(256);
  if (adj.kind === 'brightness-contrast') {
    // brightness −1..1 shifts, contrast −1..1 scales around mid grey
    const c = adj.contrast >= 0 ? 1 + adj.contrast * 3 : 1 + adj.contrast;
    for (let i = 0; i < 256; i++) lut[i] = ((i / 255 - 0.5) * c + 0.5 + adj.brightness * 0.5) * 255;
  }
  for (const [k, t] of layer.pixels.tiles) {
    const tx = keyTx(k);
    const ty = keyTy(k);
    const st = sel ? sel.get(tx, ty) : undefined;
    if (sel && !st) continue;
    recorder.captureTile(k);
    for (let p = 0; p < ts * ts; p++) {
      const i = p * 4;
      if (!t[i + 3]) continue;
      const k2 = st ? st[p] / 255 : 1;
      if (!k2) continue;
      let r = t[i];
      let g = t[i + 1];
      let b = t[i + 2];
      switch (adj.kind) {
        case 'brightness-contrast':
          r = lut[r];
          g = lut[g];
          b = lut[b];
          break;
        case 'grayscale': {
          const l = 0.3 * r + 0.59 * g + 0.11 * b;
          r = g = b = l;
          break;
        }
        case 'invert':
          r = 255 - r;
          g = 255 - g;
          b = 255 - b;
          break;
        case 'hue-saturation': {
          const hsl = rgbToHsl({ r: r / 255, g: g / 255, b: b / 255 });
          hsl.h = (((hsl.h + adj.hue) % 1) + 1) % 1;
          hsl.s = Math.min(1, Math.max(0, hsl.s * (1 + adj.saturation)));
          hsl.l = adj.lightness >= 0 ? hsl.l + (1 - hsl.l) * adj.lightness : hsl.l * (1 + adj.lightness);
          const o = hslToRgb(hsl);
          r = o.r * 255;
          g = o.g * 255;
          b = o.b * 255;
          break;
        }
      }
      t[i] = t[i] + (r - t[i]) * k2;
      t[i + 1] = t[i + 1] + (g - t[i + 1]) * k2;
      t[i + 2] = t[i + 2] + (b - t[i + 2]) * k2;
    }
  }
}

// --------------------------------------------------------------------------------- document operations

interface DocState {
  width: number;
  height: number;
  grids: Map<RasterLayer, { pixels: TileGrid; mask: MaskGrid | null }>;
  selection: MaskGrid | null;
}

function captureDocState(doc: RasterDocument): DocState {
  const grids = new Map<RasterLayer, { pixels: TileGrid; mask: MaskGrid | null }>();
  for (const l of allRasterLayers(doc.layers)) grids.set(l, { pixels: l.pixels, mask: l.mask });
  return { width: doc.width, height: doc.height, grids, selection: doc.selection };
}

function restoreDocState(doc: RasterDocument, s: DocState) {
  doc.width = s.width;
  doc.height = s.height;
  for (const [l, g] of s.grids) {
    l.pixels = g.pixels;
    l.mask = g.mask;
  }
  doc.selection = s.selection;
  doc.markSelectionChanged();
  doc.markStructureChanged();
  doc.markPixelsChanged(null);
}

/** Runs a whole-document operation that replaces grids (never mutates the old ones) and returns its undo entry. */
export function documentOperation(doc: RasterDocument, label: string, op: () => void): HistoryEntry {
  const before = captureDocState(doc);
  op();
  const after = captureDocState(doc);
  restoreDocState(doc, after);
  let bytes = 0;
  for (const g of after.grids.values()) bytes += g.pixels.byteSize + (g.mask?.byteSize ?? 0);
  return {
    label,
    bytes,
    undo: () => restoreDocState(doc, before),
    redo: () => restoreDocState(doc, after),
  };
}

/** Maps every pixel of a grid through an integer coordinate transform into a new grid. */
function remapGrid<T extends TileGrid | MaskGrid>(
  src: T,
  map: (x: number, y: number) => [number, number] | null,
  srcBounds: Rect,
): T {
  const isMask = src instanceof MaskGrid;
  const out = (
    isMask ? new MaskGrid(src.tileSize, (src as MaskGrid).defaultValue) : new TileGrid(src.tileSize)
  ) as T;
  const ts = src.tileSize;
  const ch = isMask ? 1 : 4;
  for (const [k, t] of src.tiles) {
    const tx = keyTx(k);
    const ty = keyTy(k);
    for (let y = 0; y < ts; y++) {
      const sy = ty * ts + y;
      if (sy < srcBounds.y || sy >= srcBounds.y + srcBounds.h) continue;
      for (let x = 0; x < ts; x++) {
        const sx = tx * ts + x;
        if (sx < srcBounds.x || sx >= srcBounds.x + srcBounds.w) continue;
        const i = (y * ts + x) * ch;
        if (!isMask && !t[i + 3]) continue;
        if (isMask && t[i] === (src as MaskGrid).defaultValue) continue;
        const d = map(sx, sy);
        if (!d) continue;
        if (isMask) (out as MaskGrid).setValue(d[0], d[1], t[i]);
        else (out as TileGrid).setPixel(d[0], d[1], t[i], t[i + 1], t[i + 2], t[i + 3]);
      }
    }
  }
  return out;
}

export function rotateDocument(doc: RasterDocument, quarterTurns: 1 | 2 | 3): HistoryEntry {
  return documentOperation(
    doc,
    quarterTurns === 2
      ? 'Rotate canvas 180°'
      : quarterTurns === 1
        ? 'Rotate canvas 90° clockwise'
        : 'Rotate canvas 90° counter-clockwise',
    () => {
      const w = doc.width;
      const h = doc.height;
      const map = (x: number, y: number): [number, number] =>
        quarterTurns === 1 ? [h - 1 - y, x] : quarterTurns === 2 ? [w - 1 - x, h - 1 - y] : [y, w - 1 - x];
      const bounds = { x: 0, y: 0, w, h };
      for (const l of allRasterLayers(doc.layers)) {
        l.pixels = remapGrid(l.pixels, map, bounds);
        if (l.mask) l.mask = remapGrid(l.mask, map, bounds);
      }
      if (doc.selection) doc.selection = remapGrid(doc.selection, map, bounds);
      if (quarterTurns !== 2) {
        doc.width = h;
        doc.height = w;
      }
    },
  );
}

export function flipDocument(doc: RasterDocument, axis: 'h' | 'v'): HistoryEntry {
  return documentOperation(doc, axis === 'h' ? 'Flip canvas horizontally' : 'Flip canvas vertically', () => {
    const w = doc.width;
    const h = doc.height;
    const map = (x: number, y: number): [number, number] => (axis === 'h' ? [w - 1 - x, y] : [x, h - 1 - y]);
    const bounds = { x: 0, y: 0, w, h };
    for (const l of allRasterLayers(doc.layers)) {
      l.pixels = remapGrid(l.pixels, map, bounds);
      if (l.mask) l.mask = remapGrid(l.mask, map, bounds);
    }
    if (doc.selection) doc.selection = remapGrid(doc.selection, map, bounds);
  });
}

/** Changes the canvas size; content is offset by (dx, dy) and cropped to the new bounds. */
export function resizeCanvas(
  doc: RasterDocument,
  newW: number,
  newH: number,
  dx: number,
  dy: number,
  label = 'Canvas size',
): HistoryEntry {
  return documentOperation(doc, label, () => {
    const bounds = { x: 0, y: 0, w: doc.width, h: doc.height };
    const map = (x: number, y: number): [number, number] | null => {
      const nx = x + dx;
      const ny = y + dy;
      return nx < 0 || ny < 0 || nx >= newW || ny >= newH ? null : [nx, ny];
    };
    for (const l of allRasterLayers(doc.layers)) {
      l.pixels = remapGrid(l.pixels, map, bounds);
      if (l.mask) l.mask = remapGrid(l.mask, map, bounds);
    }
    doc.selection = doc.selection ? remapGrid(doc.selection, map, bounds) : null;
    doc.width = newW;
    doc.height = newH;
  });
}

/** Resamples every layer to a new image size (premultiplied bilinear, box prefilter when shrinking). */
export function resizeImage(doc: RasterDocument, newW: number, newH: number): HistoryEntry {
  return documentOperation(doc, 'Image size', () => {
    const sx = newW / doc.width;
    const sy = newH / doc.height;
    const m = mat3FromAffine(sx, 0, 0, sy, 0, 0);
    const clip = { x: 0, y: 0, w: newW, h: newH };
    for (const l of allRasterLayers(doc.layers)) {
      const block = extractBlock(l.pixels, doc.bounds, null);
      const out = new TileGrid(doc.tileSize);
      drawTransformedBlock(out, new TileDiffRecorder(out), block, m, clip, 1);
      l.pixels = out;
      if (l.mask) {
        // masks: nearest-neighbour is adequate and keeps them binary-ish
        const src = l.mask;
        const mk = new MaskGrid(doc.tileSize, 255);
        for (let y = 0; y < newH; y++)
          for (let x = 0; x < newW; x++) {
            const v = src.getValue(
              Math.min(doc.width - 1, Math.floor(x / sx)),
              Math.min(doc.height - 1, Math.floor(y / sy)),
            );
            if (v !== 255) mk.setValue(x, y, v);
          }
        l.mask = mk;
      }
    }
    doc.selection = null;
    doc.width = newW;
    doc.height = newH;
  });
}

/** Flips or rotates the content of one layer around the document centre. */
export function flipLayer(doc: RasterDocument, layer: RasterLayer, axis: 'h' | 'v'): HistoryEntry {
  const w = doc.width;
  const h = doc.height;
  const before = { pixels: layer.pixels, mask: layer.mask };
  const map = (x: number, y: number): [number, number] => (axis === 'h' ? [w - 1 - x, y] : [x, h - 1 - y]);
  const after = {
    pixels: remapGrid(layer.pixels, map, { x: 0, y: 0, w, h }),
    mask: layer.mask ? remapGrid(layer.mask, map, { x: 0, y: 0, w, h }) : null,
  };
  const set = (s: typeof before) => {
    layer.pixels = s.pixels;
    layer.mask = s.mask;
    doc.markPixelsChanged(null);
  };
  set(after);
  return {
    label: axis === 'h' ? 'Flip layer horizontally' : 'Flip layer vertically',
    bytes: after.pixels.byteSize,
    undo: () => set(before),
    redo: () => set(after),
  };
}
