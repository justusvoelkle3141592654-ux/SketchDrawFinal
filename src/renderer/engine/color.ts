// Colour conversions. All channels are 0..1 unless noted. sRGB, no colour management.

export interface RGB {
  r: number;
  g: number;
  b: number;
}
export interface RGBA extends RGB {
  a: number;
}
export interface HSV {
  h: number; // 0..1 (turns)
  s: number;
  v: number;
}
export interface HSL {
  h: number;
  s: number;
  l: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-9) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return { h, s: max <= 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const hh = (((h % 1) + 1) % 1) * 6;
  const i = Math.floor(hh);
  const f = hh - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  switch (i % 6) {
    case 0:
      return { r: v, g: t, b: p };
    case 1:
      return { r: q, g: v, b: p };
    case 2:
      return { r: p, g: v, b: t };
    case 3:
      return { r: p, g: q, b: v };
    case 4:
      return { r: t, g: p, b: v };
    default:
      return { r: v, g: p, b: q };
  }
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-9) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const { h } = rgbToHsv({ r, g, b });
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  if (s <= 0) return { r: l, g: l, b: l };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const hh = ((h % 1) + 1) % 1;
  return { r: hue(hh + 1 / 3), g: hue(hh), b: hue(hh - 1 / 3) };
}

const hex2 = (v: number) =>
  Math.round(clamp01(v) * 255)
    .toString(16)
    .padStart(2, '0');

export function rgbToHex({ r, g, b }: RGB): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();
}

/** Parses #RGB, #RRGGBB or #RRGGBBAA (with or without #). Returns null when invalid. */
export function parseHex(input: string): RGBA | null {
  let s = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s))
    s = s
      .split('')
      .map((c) => c + c)
      .join('');
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(s)) return null;
  const n = (i: number) => parseInt(s.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), a: s.length === 8 ? n(6) : 1 };
}

/** Rec. 601 luma, also used by the Colour and Luminosity blend modes (W3C compositing spec). */
export function luminance({ r, g, b }: RGB): number {
  return 0.3 * r + 0.59 * g + 0.11 * b;
}

export function rgbEquals(a: RGB, b: RGB): boolean {
  return (
    Math.round(a.r * 255) === Math.round(b.r * 255) &&
    Math.round(a.g * 255) === Math.round(b.g * 255) &&
    Math.round(a.b * 255) === Math.round(b.b * 255)
  );
}

export function rgbToCss({ r, g, b }: RGB, a = 1): string {
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
}

export type HarmonyKind = 'complementary' | 'analogous' | 'triadic' | 'split' | 'tetradic';

export function harmony(base: RGB, kind: HarmonyKind): RGB[] {
  const hsv = rgbToHsv(base);
  const offsets: Record<HarmonyKind, number[]> = {
    complementary: [0, 0.5],
    analogous: [-1 / 12, 0, 1 / 12],
    triadic: [0, 1 / 3, 2 / 3],
    split: [0, 5 / 12, 7 / 12],
    tetradic: [0, 0.25, 0.5, 0.75],
  };
  return offsets[kind].map((o) => hsvToRgb({ ...hsv, h: (((hsv.h + o) % 1) + 1) % 1 }));
}

/** Shifts hue (turns), saturation and luminance (−1..1). Used for colour jitter dynamics. */
export function jitterColor(c: RGB, dh: number, ds: number, dl: number): RGB {
  if (dh === 0 && ds === 0 && dl === 0) return c;
  const hsl = rgbToHsl(c);
  return hslToRgb({ h: hsl.h + dh, s: clamp01(hsl.s + ds), l: clamp01(hsl.l + dl) });
}
