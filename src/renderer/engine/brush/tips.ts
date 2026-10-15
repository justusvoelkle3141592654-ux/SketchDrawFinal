// Brush tip images (procedurally generated or user supplied) with mip levels, and paper/canvas textures.
import { mulberry32 } from '../random';
import type { BrushTexture, BrushTip, TipGenerator, TextureSource } from './schema';

/** Grey image (0..1) with box-filtered mip levels for minification. */
export interface MipImage {
  levels: Float32Array[];
  sizes: number[]; // square images
}

function buildMips(base: Float32Array, size: number): MipImage {
  const levels = [base];
  const sizes = [size];
  let cur = base;
  let s = size;
  while (s > 4) {
    const ns = s >> 1;
    const next = new Float32Array(ns * ns);
    for (let y = 0; y < ns; y++) {
      for (let x = 0; x < ns; x++) {
        const i = y * 2 * s + x * 2;
        next[y * ns + x] = (cur[i] + cur[i + 1] + cur[i + s] + cur[i + s + 1]) * 0.25;
      }
    }
    levels.push(next);
    sizes.push(ns);
    cur = next;
    s = ns;
  }
  return { levels, sizes };
}

/** Bilinear sample at normalised u, v in [0, 1] on a chosen level, clamped to edge (zero outside). */
export function sampleMip(img: MipImage, level: number, u: number, v: number): number {
  const l = level < img.levels.length ? level : img.levels.length - 1;
  const s = img.sizes[l];
  const data = img.levels[l];
  const fx = u * s - 0.5;
  const fy = v * s - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const ax = fx - x0;
  const ay = fy - y0;
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const okx0 = x0 >= 0 && x0 < s;
  const okx1 = x1 >= 0 && x1 < s;
  const oky0 = y0 >= 0 && y0 < s;
  const oky1 = y1 >= 0 && y1 < s;
  const r0 = y0 * s;
  const r1 = y1 * s;
  const p00 = okx0 && oky0 ? data[r0 + x0] : 0;
  const p10 = okx1 && oky0 ? data[r0 + x1] : 0;
  const p01 = okx0 && oky1 ? data[r1 + x0] : 0;
  const p11 = okx1 && oky1 ? data[r1 + x1] : 0;
  const a = p00 + (p10 - p00) * ax;
  const b = p01 + (p11 - p01) * ax;
  return a + (b - a) * ay;
}

/** Picks the mip level whose resolution best matches a dab of `diameterPx`. */
export function mipLevelFor(img: MipImage, diameterPx: number): number {
  let l = 0;
  while (l < img.sizes.length - 1 && img.sizes[l + 1] >= diameterPx * 1.25) l++;
  return l;
}

const TIP_SIZE = 256;

function gaussianBlob(
  buf: Float32Array,
  size: number,
  cx: number,
  cy: number,
  r: number,
  intensity: number,
  stretchX = 1,
  stretchY = 1,
) {
  const px = (cx * 0.5 + 0.5) * size;
  const py = (cy * 0.5 + 0.5) * size;
  const rp = r * 0.5 * size;
  const ex = rp * stretchX * 2.2;
  const ey = rp * stretchY * 2.2;
  const x0 = Math.max(0, Math.floor(px - ex));
  const x1 = Math.min(size - 1, Math.ceil(px + ex));
  const y0 = Math.max(0, Math.floor(py - ey));
  const y1 = Math.min(size - 1, Math.ceil(py + ey));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - px) / (rp * stretchX);
      const dy = (y + 0.5 - py) / (rp * stretchY);
      const d2 = dx * dx + dy * dy;
      if (d2 > 4.5) continue;
      const v = Math.exp(-d2 * 1.6) * intensity;
      const i = y * size + x;
      buf[i] = Math.max(buf[i], v);
    }
  }
}

function disk(u: number, v: number): number {
  return Math.sqrt(u * u + v * v);
}

/** Procedural tip images. Deterministic for a given generator and seed. */
export function generateTip(gen: TipGenerator, seed: number): Float32Array {
  const size = TIP_SIZE;
  const buf = new Float32Array(size * size);
  const rnd = mulberry32(seed * 7919 + gen.length * 104729);
  switch (gen) {
    case 'bristle': {
      const n = 70;
      for (let k = 0; k < n; k++) {
        const a = rnd() * Math.PI * 2;
        const rr = Math.sqrt(rnd()) * 0.86;
        gaussianBlob(buf, size, Math.cos(a) * rr, Math.sin(a) * rr, 0.05 + rnd() * 0.06, 0.45 + rnd() * 0.55);
      }
      break;
    }
    case 'flat': {
      const n = 60;
      for (let k = 0; k < n; k++) {
        const x = (rnd() * 2 - 1) * 0.9;
        const y = (rnd() * 2 - 1) * 0.16;
        gaussianBlob(buf, size, x, y, 0.035 + rnd() * 0.04, 0.5 + rnd() * 0.5, 1, 2.2);
      }
      break;
    }
    case 'fan': {
      const n = 46;
      for (let k = 0; k < n; k++) {
        const t = (k / (n - 1)) * 2 - 1;
        const ang = t * 1.05;
        const rr = 0.72 + (rnd() - 0.5) * 0.12;
        gaussianBlob(
          buf,
          size,
          Math.sin(ang) * rr,
          0.55 - Math.cos(ang) * rr * 0.95,
          0.03 + rnd() * 0.025,
          0.55 + rnd() * 0.45,
        );
      }
      break;
    }
    case 'splatter': {
      const n = 26;
      for (let k = 0; k < n; k++) {
        const a = rnd() * Math.PI * 2;
        const rr = Math.pow(rnd(), 0.7) * 0.85;
        gaussianBlob(
          buf,
          size,
          Math.cos(a) * rr,
          Math.sin(a) * rr,
          0.02 + Math.pow(rnd(), 3) * 0.16,
          0.7 + rnd() * 0.3,
        );
      }
      break;
    }
    case 'chalk':
    case 'charcoal':
    case 'pencil': {
      const noise = makeValueNoise(size, gen === 'pencil' ? 64 : 32, seed + 11);
      const fine = makeValueNoise(size, 128, seed + 23);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const u = ((x + 0.5) / size) * 2 - 1;
          const v = ((y + 0.5) / size) * 2 - 1;
          const i = y * size + x;
          const edgeNoise = (noise[i] - 0.5) * (gen === 'charcoal' ? 0.45 : 0.25);
          const d = disk(u, v) + edgeNoise;
          let a: number;
          if (gen === 'pencil') {
            a = d < 0.75 ? 1 : d < 1 ? 1 - (d - 0.75) / 0.25 : 0;
            a *= 0.55 + fine[i] * 0.45;
          } else if (gen === 'chalk') {
            a = d < 0.85 ? 1 : d < 1 ? 1 - (d - 0.85) / 0.15 : 0;
            a *= fine[i] > 0.42 ? 0.9 + fine[i] * 0.1 : fine[i] * 0.6;
          } else {
            a = d < 0.6 ? 1 : d < 1 ? 1 - (d - 0.6) / 0.4 : 0;
            a *= 0.35 + noise[i] * 0.35 + fine[i] * 0.3;
          }
          buf[i] = a < 0 ? 0 : a > 1 ? 1 : a;
        }
      }
      break;
    }
  }
  return buf;
}

/** Tileable value noise in 0..1 (period = size). `cells` lattice cells per side. */
export function makeValueNoise(size: number, cells: number, seed: number): Float32Array {
  const rnd = mulberry32(seed);
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rnd();
  const out = new Float32Array(size * size);
  const cs = size / cells;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    const gy = y / cs;
    const y0 = Math.floor(gy);
    const ty = smooth(gy - y0);
    const ya = y0 % cells;
    const yb = (y0 + 1) % cells;
    for (let x = 0; x < size; x++) {
      const gx = x / cs;
      const x0 = Math.floor(gx);
      const tx = smooth(gx - x0);
      const xa = x0 % cells;
      const xb = (x0 + 1) % cells;
      const a = lattice[ya * cells + xa] + (lattice[ya * cells + xb] - lattice[ya * cells + xa]) * tx;
      const b = lattice[yb * cells + xa] + (lattice[yb * cells + xb] - lattice[yb * cells + xa]) * tx;
      out[y * size + x] = a + (b - a) * ty;
    }
  }
  return out;
}

function fractal(size: number, seed: number, octaves: number[], weights: number[]): Float32Array {
  const out = new Float32Array(size * size);
  let total = 0;
  octaves.forEach((cells, k) => {
    const n = makeValueNoise(size, cells, seed + k * 101);
    const w = weights[k];
    total += w;
    for (let i = 0; i < out.length; i++) out[i] += n[i] * w;
  });
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return normalize01(out);
}

function normalize01(a: Float32Array): Float32Array {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of a) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const k = hi - lo > 1e-6 ? 1 / (hi - lo) : 0;
  for (let i = 0; i < a.length; i++) a[i] = (a[i] - lo) * k;
  return a;
}

export const TEXTURE_SIZE = 256;

/** Tileable grain textures, 0..1. */
export function generateTexture(source: Exclude<TextureSource, 'image'>, seed = 7): Float32Array {
  const s = TEXTURE_SIZE;
  switch (source) {
    case 'paper':
      return fractal(s, seed, [8, 32, 64, 128], [0.2, 0.3, 0.3, 0.2]);
    case 'grain': {
      const rnd = mulberry32(seed + 3);
      const out = new Float32Array(s * s);
      for (let i = 0; i < out.length; i++) out[i] = rnd();
      const fine = makeValueNoise(s, 128, seed + 5);
      for (let i = 0; i < out.length; i++) out[i] = out[i] * 0.6 + fine[i] * 0.4;
      return normalize01(out);
    }
    case 'canvas': {
      const out = new Float32Array(s * s);
      const n = makeValueNoise(s, 64, seed + 9);
      const period = 8; // 256 / 8 = 32 threads per tile → seamless
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const wx = Math.sin(((x + 0.5) / period) * Math.PI * 2);
          const wy = Math.sin(((y + 0.5) / period) * Math.PI * 2);
          const cell = (Math.floor(x / period) + Math.floor(y / period)) % 2 === 0;
          const thread = cell ? Math.abs(wx) : Math.abs(wy);
          out[y * s + x] = thread * 0.7 + n[y * s + x] * 0.3;
        }
      }
      return normalize01(out);
    }
    case 'speckle': {
      const out = new Float32Array(s * s).fill(1);
      const rnd = mulberry32(seed + 13);
      for (let k = 0; k < 900; k++) {
        const cx = rnd() * s;
        const cy = rnd() * s;
        const r = 0.6 + rnd() * 1.8;
        for (let dy = -3; dy <= 3; dy++)
          for (let dx = -3; dx <= 3; dx++) {
            const d = Math.hypot(dx, dy) / r;
            if (d > 1.4) continue;
            const x = (Math.floor(cx) + dx + s) % s;
            const y = (Math.floor(cy) + dy + s) % s;
            out[y * s + x] = Math.min(out[y * s + x], Math.min(1, d * 0.8));
          }
      }
      return out;
    }
    case 'fiber': {
      const out = new Float32Array(s * s);
      const a = makeValueNoise(s, 16, seed + 17);
      const rnd = mulberry32(seed + 19);
      // anisotropic streaks: average along x with random offsets
      const row = new Float32Array(s);
      for (let y = 0; y < s; y++) {
        const off = Math.floor(rnd() * s);
        for (let x = 0; x < s; x++) row[x] = a[((y * 7) % s) * s + ((x + off) % s)];
        for (let x = 0; x < s; x++) out[y * s + x] = row[x] * 0.5 + rnd() * 0.5;
      }
      // smooth along x so fibres read as strands
      const tmp = out.slice();
      for (let y = 0; y < s; y++)
        for (let x = 0; x < s; x++) {
          let sum = 0;
          for (let k = -4; k <= 4; k++) sum += tmp[y * s + ((x + k + s) % s)];
          out[y * s + x] = sum / 9;
        }
      return normalize01(out);
    }
  }
}

export function decodeGreyImage(img: { width: number; height: number; data: string }): Float32Array {
  const bin = atob(img.data);
  const out = new Float32Array(img.width * img.height);
  for (let i = 0; i < out.length && i < bin.length; i++) out[i] = bin.charCodeAt(i) / 255;
  return out;
}

export function encodeGreyImage(
  width: number,
  height: number,
  grey: Uint8Array | Uint8ClampedArray,
): { width: number; height: number; data: string } {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < grey.length; i += chunk) s += String.fromCharCode(...grey.subarray(i, i + chunk));
  return { width, height, data: btoa(s) };
}

/** Resamples an arbitrary grey image into a centred square of power-of-two size (for mips). */
function toSquare(src: Float32Array, w: number, h: number, size: number): Float32Array {
  const out = new Float32Array(size * size);
  const scale = Math.max(w, h) / size;
  const ox = (size - w / scale) / 2;
  const oy = (size - h / scale) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = (x + 0.5 - ox) * scale - 0.5;
      const sy = (y + 0.5 - oy) * scale - 0.5;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const ax = sx - x0;
      const ay = sy - y0;
      const g = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : src[yy * w + xx]);
      const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * ax;
      const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * ax;
      out[y * size + x] = a + (b - a) * ay;
    }
  }
  return out;
}

const tipCache = new Map<string, MipImage>();
const textureCache = new Map<string, { data: Float32Array; size: number }>();

/** Returns the tip image for non-round tips (cached). */
export function getTipImage(tip: BrushTip): MipImage | null {
  if (tip.shape === 'round') return null;
  if (tip.shape === 'generated') {
    const key = `g:${tip.generator}:${tip.generatorSeed ?? 1}:${tip.invert ? 1 : 0}`;
    let m = tipCache.get(key);
    if (!m) {
      const base = generateTip(tip.generator ?? 'bristle', tip.generatorSeed ?? 1);
      if (tip.invert) for (let i = 0; i < base.length; i++) base[i] = 1 - base[i];
      m = buildMips(base, TIP_SIZE);
      tipCache.set(key, m);
    }
    return m;
  }
  if (!tip.image) return null;
  const key = `i:${tip.image.width}x${tip.image.height}:${tip.image.data.length}:${tip.image.data.slice(0, 64)}:${tip.image.data.slice(-64)}:${tip.invert ? 1 : 0}`;
  let m = tipCache.get(key);
  if (!m) {
    const grey = decodeGreyImage(tip.image);
    const sq = toSquare(grey, tip.image.width, tip.image.height, TIP_SIZE);
    if (tip.invert) for (let i = 0; i < sq.length; i++) sq[i] = 1 - sq[i];
    m = buildMips(sq, TIP_SIZE);
    tipCache.set(key, m);
  }
  return m;
}

export function getTexture(tex: BrushTexture): { data: Float32Array; size: number } {
  if (tex.source === 'image' && tex.image) {
    const key = `i:${tex.image.width}x${tex.image.height}:${tex.image.data.length}:${tex.image.data.slice(0, 64)}`;
    let t = textureCache.get(key);
    if (!t) {
      const grey = decodeGreyImage(tex.image);
      const sz = 256;
      t = { data: toSquare(grey, tex.image.width, tex.image.height, sz), size: sz };
      textureCache.set(key, t);
    }
    return t;
  }
  const src = tex.source === 'image' ? 'paper' : tex.source;
  let t = textureCache.get(src);
  if (!t) {
    t = { data: generateTexture(src), size: TEXTURE_SIZE };
    textureCache.set(src, t);
  }
  return t;
}
