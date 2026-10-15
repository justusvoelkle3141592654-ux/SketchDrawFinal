// Dab rasteriser: writes one brush dab into the float stroke buffer or directly into layer tiles.
import { forEachTileInRect, intersectRect, isEmptyRect, type Rect } from '../geometry';
import type { FloatTileGrid, MaskGrid, TileGrid } from '../tiles';
import { tileKey } from '../tiles';
import type { TileDiffRecorder } from '../history';
import { mipLevelFor, sampleMip, type MipImage } from './tips';

export interface DabTexture {
  data: Float32Array;
  size: number;
  scale: number;
  contrast: number;
  strength: number;
  invert: boolean;
  offX: number;
  offY: number;
}

export interface Dab {
  x: number;
  y: number;
  /** Half the diameter, in document pixels. */
  radius: number;
  aspect: number;
  /** Radians. */
  angle: number;
  hardness: number;
  antialias: boolean;
  tip: MipImage | null;
  /** Per-dab coverage multiplier (flow and flow dynamics). */
  alpha: number;
  /** Opacity ceiling for this dab (opacity dynamics). */
  ceil: number;
  r: number;
  g: number;
  b: number;
  texture: DabTexture | null;
}

export function dabBounds(d: Dab): Rect {
  const rx = Math.max(d.radius, 0.5);
  const ry = Math.max(d.radius * d.aspect, 0.5);
  const c = Math.cos(d.angle);
  const s = Math.sin(d.angle);
  // the image tip fills the unit square, so use the bounding square for image tips
  const k = d.tip ? Math.SQRT2 : 1;
  const hx = Math.sqrt((rx * c) ** 2 + (ry * s) ** 2) * k + 1;
  const hy = Math.sqrt((rx * s) ** 2 + (ry * c) ** 2) * k + 1;
  const x0 = Math.floor(d.x - hx);
  const y0 = Math.floor(d.y - hy);
  return { x: x0, y: y0, w: Math.ceil(d.x + hx) - x0, h: Math.ceil(d.y + hy) - y0 };
}

/**
 * Coverage evaluator for a dab. Returns a closure over precomputed values; called per pixel centre.
 * Exported for tests and for the Brush Lab stamp preview.
 */
export function makeCoverage(d: Dab): (px: number, py: number) => number {
  const rx = Math.max(d.radius, 0.5);
  const ry = Math.max(d.radius * d.aspect, 0.5);
  // very thin brushes fade instead of aliasing
  const thin = Math.min(1, d.radius / 0.5) * Math.min(1, (d.radius * d.aspect) / 0.5);
  const c = Math.cos(d.angle);
  const s = Math.sin(d.angle);
  const irx = 1 / rx;
  const iry = 1 / ry;
  if (d.tip) {
    const tip = d.tip;
    const level = mipLevelFor(tip, Math.max(rx, ry) * 2);
    return (px, py) => {
      const dx = px - d.x;
      const dy = py - d.y;
      const u = (dx * c + dy * s) * irx;
      const v = (-dx * s + dy * c) * iry;
      if (u <= -1 || u >= 1 || v <= -1 || v >= 1) return 0;
      return sampleMip(tip, level, u * 0.5 + 0.5, v * 0.5 + 0.5) * thin;
    };
  }
  if (!d.antialias) {
    return (px, py) => {
      const dx = px - d.x;
      const dy = py - d.y;
      const u = (dx * c + dy * s) * irx;
      const v = (-dx * s + dy * c) * iry;
      return u * u + v * v <= 1 ? 1 : 0;
    };
  }
  const aa = 1 / Math.min(rx, ry);
  const outer = 1 + aa * 0.5;
  const inner = Math.min(Math.max(d.hardness, 0), 1 - aa * 0.5);
  const span = outer - inner;
  const hardEdge = d.hardness >= 0.999;
  return (px, py) => {
    const dx = px - d.x;
    const dy = py - d.y;
    const u = (dx * c + dy * s) * irx;
    const v = (-dx * s + dy * c) * iry;
    const dd = u * u + v * v;
    if (dd >= outer * outer) return 0;
    const dist = Math.sqrt(dd);
    if (dist <= inner) return thin;
    const t = (dist - inner) / span;
    // linear 1 px ramp for hard tips, smooth falloff for soft tips
    return (hardEdge ? 1 - t : 1 - t * t * (3 - 2 * t)) * thin;
  };
}

function textureFactor(tex: DabTexture, px: number, py: number): number {
  const s = tex.size;
  let fx = (px + tex.offX) / tex.scale - 0.5;
  let fy = (py + tex.offY) / tex.scale - 0.5;
  fx = ((fx % s) + s) % s;
  fy = ((fy % s) + s) % s;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const ax = fx - x0;
  const ay = fy - y0;
  const x1 = (x0 + 1) % s;
  const y1 = (y0 + 1) % s;
  const d = tex.data;
  const a = d[y0 * s + x0] + (d[y0 * s + x1] - d[y0 * s + x0]) * ax;
  const b = d[y1 * s + x0] + (d[y1 * s + x1] - d[y1 * s + x0]) * ax;
  let t = a + (b - a) * ay;
  if (tex.invert) t = 1 - t;
  t = (t - 0.5) * tex.contrast + 0.5;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return 1 - tex.strength * (1 - t);
}

interface RadialLut {
  lut: Float32Array;
  outer2: number;
  scale: number;
}
const lutCache = new Map<number, RadialLut>();

/** Coverage LUT indexed by normalised squared distance (round anti-aliased tips), cached per quantised shape. */
function radialLut(d: Dab): RadialLut {
  const rx = Math.max(d.radius, 0.5);
  const ry = Math.max(d.radius * d.aspect, 0.5);
  const key =
    Math.round(rx * 16) * 1e7 +
    Math.round(ry * 16) * 1e2 +
    Math.round(Math.min(1, Math.max(0, d.hardness)) * 99);
  const hit = lutCache.get(key);
  if (hit) return hit;
  // enough entries to resolve the 1 px edge ramp at this size
  const LUT_SIZE = Math.min(4096, Math.max(128, Math.ceil(Math.max(rx, ry) * 12)));
  const thin = Math.min(1, d.radius / 0.5) * Math.min(1, (d.radius * d.aspect) / 0.5);
  const aa = 1 / Math.min(rx, ry);
  const outer = 1 + aa * 0.5;
  const inner = Math.min(Math.max(d.hardness, 0), 1 - aa * 0.5);
  const span = outer - inner;
  const hardEdge = d.hardness >= 0.999;
  const outer2 = outer * outer;
  const lut = new Float32Array(LUT_SIZE + 1);
  for (let k = 0; k <= LUT_SIZE; k++) {
    const dist = Math.sqrt((k / LUT_SIZE) * outer2);
    let v: number;
    if (dist <= inner) v = 1;
    else if (dist >= outer) v = 0;
    else {
      const t = (dist - inner) / span;
      v = hardEdge ? 1 - t : 1 - t * t * (3 - 2 * t);
    }
    lut[k] = v * thin;
  }
  const out = { lut, outer2, scale: LUT_SIZE / outer2 };
  if (lutCache.size > 512) lutCache.clear();
  lutCache.set(key, out);
  return out;
}

/**
 * Accumulates a dab into the premultiplied stroke buffer.
 * buildup: dst += (colour·ceil − dst)·coverage·alpha while dst.a < ceil
 * max:     dst = colour·target where target = coverage·alpha·ceil exceeds dst.a
 * Returns the touched document rect (clipped to `clip`) or null.
 */
export function stampDab(
  buf: FloatTileGrid,
  d: Dab,
  mode: 'buildup' | 'max',
  clip: Rect,
  selection: MaskGrid | null,
): Rect | null {
  const r = intersectRect(dabBounds(d), clip);
  if (isEmptyRect(r) || d.alpha <= 0 || d.ceil <= 0) return null;
  const ts = buf.tileSize;
  const tex = d.texture && d.texture.strength > 0 ? d.texture : null;
  const cr = d.r;
  const cg = d.g;
  const cb = d.b;
  const ceil = d.ceil;
  const alpha = d.alpha;
  const buildup = mode === 'buildup';
  // Round anti-aliased tips use an analytic row span + LUT; other tips use the generic coverage closure.
  const fast = !d.tip && d.antialias;
  const cov = fast ? null : makeCoverage(d);
  const rx = Math.max(d.radius, 0.5);
  const ry = Math.max(d.radius * d.aspect, 0.5);
  const c = Math.cos(d.angle);
  const s = Math.sin(d.angle);
  const A = (c * c) / (rx * rx) + (s * s) / (ry * ry);
  const Bk = 2 * c * s * (1 / (rx * rx) - 1 / (ry * ry));
  const Ck = (s * s) / (rx * rx) + (c * c) / (ry * ry);
  const L = fast ? radialLut(d) : null;
  let touched = false;
  forEachTileInRect(r, ts, (tx, ty, sub) => {
    let tile: Float32Array | null = null;
    const selTile = selection ? selection.get(tx, ty) : undefined;
    if (selection && !selTile && selection.defaultValue === 0) return;
    let bx0 = ts;
    let by0 = ts;
    let bx1 = -1;
    let by1 = -1;
    const ox = tx * ts;
    const oy = ty * ts;
    for (let y = sub.y; y < sub.y + sub.h; y++) {
      const ly = y - oy;
      let xs = sub.x;
      let xe = sub.x + sub.w;
      const dy = y + 0.5 - d.y;
      if (L) {
        // solve A·dx² + B·dx + C ≤ outer² for the covered span of this row
        const B = Bk * dy;
        const C = Ck * dy * dy - L.outer2;
        const disc = B * B - 4 * A * C;
        if (disc <= 0) continue;
        const sq = Math.sqrt(disc);
        const dx0 = (-B - sq) / (2 * A);
        const dx1 = (-B + sq) / (2 * A);
        xs = Math.max(xs, Math.floor(d.x + dx0 - 0.5));
        xe = Math.min(xe, Math.ceil(d.x + dx1 + 0.5));
      }
      for (let x = xs; x < xe; x++) {
        let a: number;
        if (L) {
          const dx = x + 0.5 - d.x;
          const dd = A * dx * dx + Bk * dx * dy + Ck * dy * dy;
          if (dd >= L.outer2) continue;
          a = L.lut[(dd * L.scale) | 0];
        } else {
          a = cov!(x + 0.5, y + 0.5);
        }
        if (a <= 0) continue;
        const lx = x - ox;
        if (selTile) {
          a *= selTile[ly * ts + lx] / 255;
          if (a <= 0) continue;
        }
        if (tex) a *= textureFactor(tex, x, y);
        a *= alpha;
        if (a <= 1e-5) continue;
        if (!tile) tile = buf.getOrCreate(tx, ty);
        const i = (ly * ts + lx) * 4;
        const da = tile[i + 3];
        if (buildup) {
          if (da >= ceil) continue;
          const k = a > 1 ? 1 : a;
          tile[i] += (cr * ceil - tile[i]) * k;
          tile[i + 1] += (cg * ceil - tile[i + 1]) * k;
          tile[i + 2] += (cb * ceil - tile[i + 2]) * k;
          tile[i + 3] = da + (ceil - da) * k;
        } else {
          let ta = a * ceil;
          if (ta > 1) ta = 1;
          if (ta <= da) continue;
          tile[i] = cr * ta;
          tile[i + 1] = cg * ta;
          tile[i + 2] = cb * ta;
          tile[i + 3] = ta;
        }
        if (lx < bx0) bx0 = lx;
        if (lx > bx1) bx1 = lx;
        if (ly < by0) by0 = ly;
        if (ly > by1) by1 = ly;
      }
    }
    if (bx1 >= 0) {
      buf.markBounds(tx, ty, bx0, by0, bx1 + 1, by1 + 1);
      touched = true;
    }
  });
  return touched ? r : null;
}

// ------------------------------------------------------------------------------- direct painting

export interface CarriedColor {
  r: number;
  g: number;
  b: number;
  a: number; // premultiplied
}

/** Coverage-weighted average premultiplied colour of the layer under a dab. */
export function sampleUnderDab(grid: TileGrid, d: Dab, clip: Rect): CarriedColor | null {
  const r = intersectRect(dabBounds(d), clip);
  if (isEmptyRect(r)) return null;
  const cov = makeCoverage({ ...d, texture: null });
  const ts = grid.tileSize;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let sa = 0;
  let wsum = 0;
  // sample on a sparse grid for big dabs to bound cost
  const step = Math.max(1, Math.floor(Math.max(r.w, r.h) / 48));
  for (let y = r.y; y < r.y + r.h; y += step) {
    for (let x = r.x; x < r.x + r.w; x += step) {
      const w = cov(x + 0.5, y + 0.5);
      if (w <= 0) continue;
      const tx = Math.floor(x / ts);
      const ty = Math.floor(y / ts);
      const t = grid.get(tx, ty);
      wsum += w;
      if (!t) continue;
      const i = ((y - ty * ts) * ts + (x - tx * ts)) * 4;
      const a = t[i + 3] / 255;
      sr += (t[i] / 255) * a * w;
      sg += (t[i + 1] / 255) * a * w;
      sb += (t[i + 2] / 255) * a * w;
      sa += a * w;
    }
  }
  if (wsum <= 0) return null;
  return { r: sr / wsum, g: sg / wsum, b: sb / wsum, a: sa / wsum };
}

/**
 * Paints a premultiplied colour directly into layer tiles: dst += (colour − dst)·coverage·strength.
 * Captures before-states through the recorder. alphaLock keeps destination alpha.
 */
export function paintDirect(
  grid: TileGrid,
  recorder: TileDiffRecorder,
  d: Dab,
  color: CarriedColor,
  strength: number,
  clip: Rect,
  selection: MaskGrid | null,
  alphaLock: boolean,
): Rect | null {
  const r = intersectRect(dabBounds(d), clip);
  if (isEmptyRect(r) || strength <= 0) return null;
  const cov = makeCoverage(d);
  const ts = grid.tileSize;
  const tex = d.texture && d.texture.strength > 0 ? d.texture : null;
  let touched = false;
  forEachTileInRect(r, ts, (tx, ty, sub) => {
    const selTile = selection ? selection.get(tx, ty) : undefined;
    if (selection && !selTile && selection.defaultValue === 0) return;
    let tile = grid.get(tx, ty);
    if (!tile && (alphaLock || color.a <= 0.0001)) return;
    recorder.capture(tileKey(tx, ty), sub.x - tx * ts, sub.y - ty * ts, sub.w, sub.h);
    if (!tile) tile = grid.getOrCreate(tx, ty);
    const ox = tx * ts;
    const oy = ty * ts;
    for (let y = sub.y; y < sub.y + sub.h; y++) {
      const ly = y - oy;
      for (let x = sub.x; x < sub.x + sub.w; x++) {
        let k = cov(x + 0.5, y + 0.5);
        if (k <= 0) continue;
        const lx = x - ox;
        if (selTile) k *= selTile[ly * ts + lx] / 255;
        if (tex) k *= textureFactor(tex, x, y);
        k *= strength * d.alpha;
        if (k <= 1e-4) continue;
        if (k > 1) k = 1;
        const i = (ly * ts + lx) * 4;
        const a0 = tile[i + 3] / 255;
        let pr = (tile[i] / 255) * a0;
        let pg = (tile[i + 1] / 255) * a0;
        let pb = (tile[i + 2] / 255) * a0;
        let pa = a0;
        pr += (color.r - pr) * k;
        pg += (color.g - pg) * k;
        pb += (color.b - pb) * k;
        pa += (color.a - pa) * k;
        if (alphaLock && pa > 0) {
          const s = a0 / pa;
          pr *= s;
          pg *= s;
          pb *= s;
          pa = a0;
        }
        if (pa <= 1 / 510) {
          tile[i] = tile[i + 1] = tile[i + 2] = tile[i + 3] = 0;
        } else {
          const inv = 255 / pa;
          tile[i] = pr * inv;
          tile[i + 1] = pg * inv;
          tile[i + 2] = pb * inv;
          tile[i + 3] = pa * 255;
        }
      }
    }
    touched = true;
  });
  return touched ? r : null;
}
