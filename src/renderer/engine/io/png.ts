// Lossless PNG encoder/decoder for straight RGBA8 (avoids the premultiplication loss of canvas.toBlob).
import { unzlibSync, zlibSync } from 'fflate';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array, start = 0, end = data.length, seed = 0xffffffff): number {
  let c = seed;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return c;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = crc32(out, 4, 8 + data.length) ^ 0xffffffff;
  dv.setUint32(8 + data.length, crc >>> 0);
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export interface PngEncodeOptions {
  dpi?: number;
  level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /** Drop the alpha channel (RGB PNG) when every pixel is opaque. */
  autoOpaque?: boolean;
}

/** Encodes straight RGBA8 pixels. */
export function encodePng(
  width: number,
  height: number,
  rgba: Uint8Array | Uint8ClampedArray,
  opts: PngEncodeOptions = {},
): Uint8Array {
  let opaque = false;
  if (opts.autoOpaque) {
    opaque = true;
    for (let i = 3; i < rgba.length; i += 4)
      if (rgba[i] !== 255) {
        opaque = false;
        break;
      }
  }
  const bpp = opaque ? 3 : 4;
  const stride = width * bpp;
  const raw = new Uint8Array((stride + 1) * height);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  const cand = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const src = y * width * 4;
    if (opaque) {
      for (let x = 0; x < width; x++) {
        cur[x * 3] = rgba[src + x * 4];
        cur[x * 3 + 1] = rgba[src + x * 4 + 1];
        cur[x * 3 + 2] = rgba[src + x * 4 + 2];
      }
    } else {
      cur.set(rgba.subarray(src, src + stride));
    }
    // choose the filter with the smallest sum of absolute values (standard heuristic)
    let best = 0;
    let bestSum = Infinity;
    let bestRow: Uint8Array | null = null;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0;
        const b = y > 0 ? prev[i] : 0;
        const c = i >= bpp && y > 0 ? prev[i - bpp] : 0;
        let v: number;
        switch (f) {
          case 0:
            v = cur[i];
            break;
          case 1:
            v = cur[i] - a;
            break;
          case 2:
            v = cur[i] - b;
            break;
          case 3:
            v = cur[i] - ((a + b) >> 1);
            break;
          default:
            v = cur[i] - paeth(a, b, c);
        }
        v &= 0xff;
        cand[i] = v;
        sum += v < 128 ? v : 256 - v;
        if (sum >= bestSum) break;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = f;
        bestRow = cand.slice();
      }
    }
    const off = y * (stride + 1);
    raw[off] = best;
    raw.set(bestRow!, off + 1);
    prev.set(cur);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  const parts = [new Uint8Array(SIGNATURE), chunk('IHDR', ihdr)];
  if (opts.dpi && opts.dpi > 0) {
    const phys = new Uint8Array(9);
    const ppm = Math.round(opts.dpi / 0.0254);
    new DataView(phys.buffer).setUint32(0, ppm);
    new DataView(phys.buffer).setUint32(4, ppm);
    phys[8] = 1;
    parts.push(chunk('pHYs', phys));
  }
  parts.push(chunk('tEXt', new TextEncoder().encode('Software\0Canvas Forge')));
  parts.push(chunk('IDAT', zlibSync(raw, { level: opts.level ?? 6 })));
  parts.push(chunk('IEND', new Uint8Array(0)));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export interface DecodedImage {
  width: number;
  height: number;
  /** Straight RGBA8. */
  data: Uint8ClampedArray;
  dpi?: number;
}

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && SIGNATURE.every((v, i) => bytes[i] === v);
}

/**
 * Decodes non-interlaced PNGs (all colour types, 1–16 bit). Returns null for interlaced images
 * so callers can fall back to the browser decoder. Throws on corrupt data.
 */
export function decodePng(bytes: Uint8Array): DecodedImage | null {
  if (!isPng(bytes)) throw new Error('Not a PNG file.');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 8;
  let ctype = 6;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  let dpi: number | undefined;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= bytes.length) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (pos + 12 + len > bytes.length) throw new Error('PNG data is truncated.');
    if (type === 'IHDR') {
      width = dv.getUint32(pos + 8);
      height = dv.getUint32(pos + 12);
      depth = data[8];
      ctype = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = data.slice();
    else if (type === 'tRNS') trns = data.slice();
    else if (type === 'pHYs' && data[8] === 1)
      dpi = Math.round(new DataView(data.buffer, data.byteOffset).getUint32(0) * 0.0254);
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!width || !height) throw new Error('PNG header is missing.');
  if (width > 32768 || height > 32768) throw new Error('PNG dimensions are too large.');
  if (interlace) return null;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype as 0 | 2 | 3 | 4 | 6];
  if (!channels) throw new Error(`Unsupported PNG colour type ${ctype}.`);
  const total = idat.reduce((s, c) => s + c.length, 0);
  const z = new Uint8Array(total);
  let o = 0;
  for (const c of idat) {
    z.set(c, o);
    o += c.length;
  }
  const raw = unzlibSync(z);
  const bitsPP = channels * depth;
  const bpp = Math.max(1, bitsPP >> 3);
  const stride = Math.ceil((width * bitsPP) / 8);
  if (raw.length < (stride + 1) * height) throw new Error('PNG image data is truncated.');
  const lines = new Uint8Array(stride * height);
  const prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = lines.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      switch (f) {
        case 0:
          break;
        case 1:
          v += a;
          break;
        case 2:
          v += b;
          break;
        case 3:
          v += (a + b) >> 1;
          break;
        case 4:
          v += paeth(a, b, c);
          break;
        default:
          throw new Error(`Invalid PNG filter ${f}.`);
      }
      out[i] = v & 0xff;
    }
    prev.set(out);
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  const sample = (row: number, idx: number): number => {
    // idx = sample index within the row
    const base = row * stride;
    if (depth === 8) return lines[base + idx];
    if (depth === 16) return lines[base + idx * 2];
    const perByte = 8 / depth;
    const byte = lines[base + Math.floor(idx / perByte)];
    const shift = 8 - depth * ((idx % perByte) + 1);
    return (byte >> shift) & ((1 << depth) - 1);
  };
  const scale = depth < 8 && ctype !== 3 ? 255 / ((1 << depth) - 1) : 1;
  const trnsGray = trns && ctype === 0 ? (trns[0] << 8) | trns[1] : -1;
  const trnsRGB =
    trns && ctype === 2
      ? [(trns[0] << 8) | trns[1], (trns[2] << 8) | trns[3], (trns[4] << 8) | trns[5]]
      : null;
  const raw16 = (row: number, idx: number) =>
    depth === 16
      ? (lines[row * stride + idx * 2] << 8) | lines[row * stride + idx * 2 + 1]
      : sample(row, idx);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const j = (y * width + x) * 4;
      switch (ctype) {
        case 0: {
          const g = sample(y, x) * scale;
          rgba[j] = rgba[j + 1] = rgba[j + 2] = g;
          rgba[j + 3] = trnsGray >= 0 && raw16(y, x) === trnsGray ? 0 : 255;
          break;
        }
        case 2: {
          rgba[j] = sample(y, x * 3);
          rgba[j + 1] = sample(y, x * 3 + 1);
          rgba[j + 2] = sample(y, x * 3 + 2);
          rgba[j + 3] =
            trnsRGB &&
            raw16(y, x * 3) === trnsRGB[0] &&
            raw16(y, x * 3 + 1) === trnsRGB[1] &&
            raw16(y, x * 3 + 2) === trnsRGB[2]
              ? 0
              : 255;
          break;
        }
        case 3: {
          const idx = sample(y, x);
          if (!palette || idx * 3 + 2 >= palette.length) throw new Error('PNG palette index out of range.');
          rgba[j] = palette[idx * 3];
          rgba[j + 1] = palette[idx * 3 + 1];
          rgba[j + 2] = palette[idx * 3 + 2];
          rgba[j + 3] = trns && idx < trns.length ? trns[idx] : 255;
          break;
        }
        case 4: {
          const g = sample(y, x * 2) * scale;
          rgba[j] = rgba[j + 1] = rgba[j + 2] = g;
          rgba[j + 3] = sample(y, x * 2 + 1) * scale;
          break;
        }
        default: {
          rgba[j] = sample(y, x * 4);
          rgba[j + 1] = sample(y, x * 4 + 1);
          rgba[j + 2] = sample(y, x * 4 + 2);
          rgba[j + 3] = sample(y, x * 4 + 3);
        }
      }
    }
  }
  return { width, height, data: rgba, dpi };
}
