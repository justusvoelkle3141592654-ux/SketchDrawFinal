// Image decode/encode helpers (browser APIs + the engine's lossless PNG codec).
import { decodePng, encodePng, isPng, type DecodedImage } from '../engine/io/png';

export async function decodeImageBytes(bytes: Uint8Array, name = ''): Promise<DecodedImage> {
  if (isPng(bytes)) {
    try {
      const d = decodePng(bytes);
      if (d) return d;
    } catch {
      // fall through to the browser decoder, which is more forgiving
    }
  }
  const type = /\.jpe?g$/i.test(name)
    ? 'image/jpeg'
    : /\.webp$/i.test(name)
      ? 'image/webp'
      : isPng(bytes)
        ? 'image/png'
        : '';
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(new Blob([bytes as BlobPart], type ? { type } : undefined), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
  } catch {
    throw new Error(
      `"${name || 'The file'}" could not be decoded. It may be damaged or in an unsupported format.`,
    );
  }
  if (bmp.width > 16384 || bmp.height > 16384) {
    bmp.close();
    throw new Error('The image is larger than 16 384 pixels on one side.');
  }
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const id = ctx.getImageData(0, 0, c.width, c.height);
  return { width: c.width, height: c.height, data: id.data };
}

/** Encodes straight RGBA as PNG (lossless), JPEG or WebP. JPEG is flattened onto `matte`. */
export async function encodeImage(
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
  format: 'png' | 'jpeg' | 'webp',
  quality: number,
  dpi: number,
  matte: { r: number; g: number; b: number } = { r: 1, g: 1, b: 1 },
): Promise<Uint8Array> {
  if (format === 'png') return encodePng(width, height, rgba, { dpi, autoOpaque: true });
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  let data = rgba;
  if (format === 'jpeg') {
    data = new Uint8ClampedArray(rgba.length);
    const mr = matte.r * 255;
    const mg = matte.g * 255;
    const mb = matte.b * 255;
    for (let i = 0; i < rgba.length; i += 4) {
      const a = rgba[i + 3] / 255;
      data[i] = rgba[i] * a + mr * (1 - a);
      data[i + 1] = rgba[i + 1] * a + mg * (1 - a);
      data[i + 2] = rgba[i + 2] * a + mb * (1 - a);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) =>
    c.toBlob(resolve, format === 'jpeg' ? 'image/jpeg' : 'image/webp', quality),
  );
  if (!blob) throw new Error(`The ${format.toUpperCase()} encoder is not available.`);
  return new Uint8Array(await blob.arrayBuffer());
}

/** Scales straight RGBA with premultiplied bilinear/box filtering. */
export function resizeRGBA(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 4);
  const sx = sw / dw;
  const sy = sh / dh;
  if (sx > 1 || sy > 1) {
    // box filter for downscaling
    for (let y = 0; y < dh; y++) {
      const y0 = Math.floor(y * sy);
      const y1 = Math.max(y0 + 1, Math.min(sh, Math.floor((y + 1) * sy)));
      for (let x = 0; x < dw; x++) {
        const x0 = Math.floor(x * sx);
        const x1 = Math.max(x0 + 1, Math.min(sw, Math.floor((x + 1) * sx)));
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let n = 0;
        for (let yy = y0; yy < y1; yy++)
          for (let xx = x0; xx < x1; xx++) {
            const i = (yy * sw + xx) * 4;
            const al = src[i + 3];
            r += src[i] * al;
            g += src[i + 1] * al;
            b += src[i + 2] * al;
            a += al;
            n++;
          }
        const j = (y * dw + x) * 4;
        if (a > 0) {
          out[j] = r / a;
          out[j + 1] = g / a;
          out[j + 2] = b / a;
          out[j + 3] = a / n;
        }
      }
    }
    return out;
  }
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ay = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const ax = fx - x0;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      const acc = (xx: number, yy: number, w: number) => {
        const i = (yy * sw + xx) * 4;
        const al = (src[i + 3] / 255) * w;
        r += src[i] * al;
        g += src[i + 1] * al;
        b += src[i + 2] * al;
        a += al;
      };
      acc(x0, y0, (1 - ax) * (1 - ay));
      acc(x1, y0, ax * (1 - ay));
      acc(x0, y1, (1 - ax) * ay);
      acc(x1, y1, ax * ay);
      const j = (y * dw + x) * 4;
      if (a > 0) {
        out[j] = r / a;
        out[j + 1] = g / a;
        out[j + 2] = b / a;
        out[j + 3] = a * 255;
      }
    }
  }
  return out;
}
