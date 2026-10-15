// Small previews of layer stacks drawn straight from tiles (cost scales with the painted area).
import { forEachLayer, type LayerNode, type RasterLayer } from '../engine/layers';

/** Visible raster layers of a node, bottom → top. */
export function visibleRasters(node: LayerNode): RasterLayer[] {
  const out: RasterLayer[] = [];
  if (!node.visible) return out;
  if (node.kind === 'raster') return [node];
  const walk = (list: LayerNode[]) => {
    for (const n of list) {
      if (!n.visible) continue;
      if (n.kind === 'raster') out.push(n);
      else walk(n.children);
    }
  };
  walk(node.children);
  return out;
}

/** Version key of everything a node's preview depends on. */
export function nodeVersion(node: LayerNode): string {
  const parts: string[] = [];
  forEachLayer([node], (n) => {
    parts.push(`${n.id}${n.visible ? 1 : 0}${n.opacity}`);
    if (n.kind === 'raster') parts.push(String(n.pixels.version));
  });
  return parts.join(':');
}

/**
 * Draws an approximate preview of `layers` (box-filtered, Normal blending, masks ignored) into
 * `canvas`, fitted into maxW × maxH.
 */
export function drawStackThumbnail(
  canvas: HTMLCanvasElement,
  layers: RasterLayer[],
  docW: number,
  docH: number,
  maxW: number,
  maxH: number,
) {
  const k = Math.min(maxW / docW, maxH / docH);
  const w = Math.max(1, Math.round(docW * k));
  const h = Math.max(1, Math.round(docH * k));
  canvas.width = w;
  canvas.height = h;
  const out = new Float32Array(w * h * 4); // premultiplied 0..1
  const acc = new Float32Array(w * h * 4);
  const cnt = new Float32Array(w * h);
  const sx = w / docW;
  const sy = h / docH;
  for (const layer of layers) {
    acc.fill(0);
    cnt.fill(0);
    const grid = layer.pixels;
    const ts = grid.tileSize;
    const step = Math.max(1, Math.floor(1 / k / 4));
    // samples per output pixel (constant over the canvas) for averaging empty areas correctly
    for (const [key, tile] of grid.tiles) {
      const tx = (key % 8192) - 4096;
      const ty = Math.floor(key / 8192) - 4096;
      for (let y = 0; y < ts; y += step) {
        const dy = ty * ts + y;
        if (dy < 0 || dy >= docH) continue;
        const oy = Math.min(h - 1, Math.floor(dy * sy));
        for (let x = 0; x < ts; x += step) {
          const dx = tx * ts + x;
          if (dx < 0 || dx >= docW) continue;
          const i = (y * ts + x) * 4;
          const p = oy * w + Math.min(w - 1, Math.floor(dx * sx));
          cnt[p]++;
          const a = tile[i + 3];
          if (!a) continue;
          const o = p * 4;
          acc[o] += (tile[i] * a) / 65025;
          acc[o + 1] += (tile[i + 1] * a) / 65025;
          acc[o + 2] += (tile[i + 2] * a) / 65025;
          acc[o + 3] += a / 255;
        }
      }
    }
    const samples = Math.max(1, Math.ceil(1 / k / step) ** 2);
    const op = layer.opacity;
    for (let p = 0; p < w * h; p++) {
      const n = Math.max(samples, cnt[p]);
      const a = (acc[p * 4 + 3] / n) * op;
      if (a <= 0) continue;
      const kk = 1 - a;
      const o = p * 4;
      out[o] = (acc[o] / n) * op + out[o] * kk;
      out[o + 1] = (acc[o + 1] / n) * op + out[o + 1] * kk;
      out[o + 2] = (acc[o + 2] / n) * op + out[o + 2] * kk;
      out[o + 3] = a + out[o + 3] * kk;
    }
  }
  const img = new ImageData(w, h);
  for (let p = 0; p < w * h; p++) {
    const a = out[p * 4 + 3];
    if (a <= 0) continue;
    img.data[p * 4] = (out[p * 4] / a) * 255;
    img.data[p * 4 + 1] = (out[p * 4 + 1] / a) * 255;
    img.data[p * 4 + 2] = (out[p * 4 + 2] / a) * 255;
    img.data[p * 4 + 3] = a * 255;
  }
  canvas.getContext('2d')!.putImageData(img, 0, 0);
}
