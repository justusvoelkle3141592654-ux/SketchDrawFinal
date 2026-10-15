// Blend modes on premultiplied float RGBA (W3C Compositing and Blending Level 1 formulas).

export type BlendMode =
  'normal' | 'multiply' | 'screen' | 'overlay' | 'add' | 'darken' | 'lighten' | 'color' | 'luminosity';

/** Internal-only mode for erasers. */
export type PaintBlendMode = BlendMode | 'erase';

export const BLEND_MODES: { id: BlendMode; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'screen', label: 'Screen' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'add', label: 'Add' },
  { id: 'darken', label: 'Darken' },
  { id: 'lighten', label: 'Lighten' },
  { id: 'color', label: 'Colour' },
  { id: 'luminosity', label: 'Luminosity' },
];

const MODE_INDEX: Record<PaintBlendMode, number> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  add: 4,
  darken: 5,
  lighten: 6,
  color: 7,
  luminosity: 8,
  erase: 9,
};

export const M_NORMAL = 0;
export const M_ERASE = 9;

export function modeIndex(mode: PaintBlendMode): number {
  return MODE_INDEX[mode] ?? 0;
}

export function isBlendMode(v: unknown): v is BlendMode {
  return typeof v === 'string' && v in MODE_INDEX && v !== 'erase';
}

function sepBlend(m: number, cb: number, cs: number): number {
  switch (m) {
    case 1:
      return cb * cs;
    case 2:
      return cb + cs - cb * cs;
    case 3:
      return cb <= 0.5 ? 2 * cs * cb : 1 - 2 * (1 - cs) * (1 - cb);
    case 4: {
      const v = cb + cs;
      return v > 1 ? 1 : v;
    }
    case 5:
      return cb < cs ? cb : cs;
    case 6:
      return cb > cs ? cb : cs;
    default:
      return cs;
  }
}

const lum = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;

// Non-separable helpers write into this scratch triple to avoid allocations.
const tmp = new Float32Array(3);

function setLum(r: number, g: number, b: number, l: number): void {
  const d = l - lum(r, g, b);
  let cr = r + d;
  let cg = g + d;
  let cb = b + d;
  const L = lum(cr, cg, cb);
  const n = Math.min(cr, cg, cb);
  const x = Math.max(cr, cg, cb);
  if (n < 0) {
    const k = L / (L - n || 1);
    cr = L + (cr - L) * k;
    cg = L + (cg - L) * k;
    cb = L + (cb - L) * k;
  }
  if (x > 1) {
    const k = (1 - L) / (x - L || 1);
    cr = L + (cr - L) * k;
    cg = L + (cg - L) * k;
    cb = L + (cb - L) * k;
  }
  tmp[0] = cr;
  tmp[1] = cg;
  tmp[2] = cb;
}

/**
 * Blends a premultiplied source pixel into dst[i..i+3] (premultiplied float).
 * alphaLock keeps the destination alpha (source-atop semantics).
 */
export function blendInto(
  dst: Float32Array,
  i: number,
  sr: number,
  sg: number,
  sb: number,
  sa: number,
  m: number,
  alphaLock = false,
): void {
  if (sa <= 0) return;
  const dr = dst[i];
  const dg = dst[i + 1];
  const db = dst[i + 2];
  const da = dst[i + 3];
  if (m === M_ERASE) {
    const k = 1 - sa;
    dst[i] = dr * k;
    dst[i + 1] = dg * k;
    dst[i + 2] = db * k;
    dst[i + 3] = da * k;
    return;
  }
  if (m === M_NORMAL || da <= 0) {
    if (alphaLock) {
      if (da <= 0) return;
      // source-atop: co = cs·Da + cb·(1 − Sa)
      dst[i] = sr * da + dr * (1 - sa);
      dst[i + 1] = sg * da + dg * (1 - sa);
      dst[i + 2] = sb * da + db * (1 - sa);
      return;
    }
    const k = 1 - sa;
    dst[i] = sr + dr * k;
    dst[i + 1] = sg + dg * k;
    dst[i + 2] = sb + db * k;
    dst[i + 3] = sa + da * k;
    return;
  }
  const isa = 1 / sa;
  const ida = 1 / da;
  const csr = sr * isa;
  const csg = sg * isa;
  const csb = sb * isa;
  const cbr = dr * ida;
  const cbg = dg * ida;
  const cbb = db * ida;
  let br: number;
  let bg: number;
  let bb: number;
  if (m === 7) {
    setLum(csr, csg, csb, lum(cbr, cbg, cbb));
    br = tmp[0];
    bg = tmp[1];
    bb = tmp[2];
  } else if (m === 8) {
    setLum(cbr, cbg, cbb, lum(csr, csg, csb));
    br = tmp[0];
    bg = tmp[1];
    bb = tmp[2];
  } else {
    br = sepBlend(m, cbr, csr);
    bg = sepBlend(m, cbg, csg);
    bb = sepBlend(m, cbb, csb);
  }
  const sada = sa * da;
  if (alphaLock) {
    dst[i] = dr * (1 - sa) + sada * br;
    dst[i + 1] = dg * (1 - sa) + sada * bg;
    dst[i + 2] = db * (1 - sa) + sada * bb;
    return;
  }
  dst[i] = sr * (1 - da) + dr * (1 - sa) + sada * br;
  dst[i + 1] = sg * (1 - da) + dg * (1 - sa) + sada * bg;
  dst[i + 2] = sb * (1 - da) + db * (1 - sa) + sada * bb;
  dst[i + 3] = sa + da - sada;
}

const INV255 = 1 / 255;

/** Converts straight RGBA8 at u8[j] to premultiplied float in f[i]. */
export function loadPremul(u8: Uint8ClampedArray, j: number, f: Float32Array, i: number): void {
  const a = u8[j + 3] * INV255;
  f[i] = u8[j] * INV255 * a;
  f[i + 1] = u8[j + 1] * INV255 * a;
  f[i + 2] = u8[j + 2] * INV255 * a;
  f[i + 3] = a;
}

/** Converts premultiplied float f[i] to straight RGBA8 at u8[j] (Uint8ClampedArray rounds and clamps). */
export function storeStraight(f: Float32Array, i: number, u8: Uint8ClampedArray, j: number): void {
  const a = f[i + 3];
  if (a <= 1 / 510) {
    u8[j] = 0;
    u8[j + 1] = 0;
    u8[j + 2] = 0;
    u8[j + 3] = 0;
    return;
  }
  const k = 255 / (a > 1 ? 1 : a);
  u8[j] = f[i] * k;
  u8[j + 1] = f[i + 1] * k;
  u8[j + 2] = f[i + 2] * k;
  u8[j + 3] = a * 255;
}
