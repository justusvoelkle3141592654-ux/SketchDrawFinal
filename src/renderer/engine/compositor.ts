// Recomposites document rectangles from the layer tree, including a live stroke preview.
import { blendInto, modeIndex, storeStraight, type PaintBlendMode } from './blend';
import type { RasterDocument } from './document';
import { forEachTileInRect, type Rect } from './geometry';
import type { GroupLayer, LayerNode, RasterLayer } from './layers';
import type { FloatTileGrid } from './tiles';

const INV255 = 1 / 255;

export interface StrokePreview {
  layerId: string;
  target: 'pixels' | 'mask';
  buffer: FloatTileGrid;
  opacity: number;
  mode: PaintBlendMode;
  /** Alpha-lock for this stroke (layer alpha lock is applied in addition). */
  alphaLock: boolean;
}

/** Display override for one node (animation onion skins): extra opacity and an optional tint. */
export interface NodeStyle {
  opacity: number;
  tint: { r: number; g: number; b: number } | null;
  /** 0..1 mix toward the tint colour, alpha preserved. */
  tintAmount: number;
}

export interface CompositeOptions {
  /** Return false to hide a node (used by animation frames / onion skin). */
  isVisible?: (node: LayerNode) => boolean;
  /** Per-node display style (onion skins); nodes with a style are composited as Normal. */
  nodeStyle?: (node: LayerNode) => NodeStyle | null;
  /** Ignore the document background (export with transparency, onion skin). */
  skipBackground?: boolean;
  /** Composite only these root nodes instead of document.layers. */
  roots?: LayerNode[];
}

/** Scratch buffers per recursion depth, sized for one tile. */
class ScratchPool {
  private pool: Float32Array[] = [];
  constructor(private readonly size: number) {}
  get(depth: number): Float32Array {
    let b = this.pool[depth];
    if (!b) {
      b = new Float32Array(this.size);
      this.pool[depth] = b;
    }
    return b;
  }
}

export class Compositor {
  preview: StrokePreview | null = null;
  private readonly pool: ScratchPool;
  private readonly maskScratch: Float32Array;

  constructor(private readonly doc: RasterDocument) {
    this.pool = new ScratchPool(doc.tileSize * doc.tileSize * 4);
    this.maskScratch = new Float32Array(doc.tileSize * doc.tileSize);
  }

  /**
   * Composites `r` (must lie within one tile) into `acc` (premultiplied float, r.w*r.h*4).
   */
  compositeRect(r: Rect, acc: Float32Array, opts: CompositeOptions = {}): void {
    const n = r.w * r.h * 4;
    const bg = this.doc.background;
    if (!bg.transparent && !opts.skipBackground) {
      for (let i = 0; i < n; i += 4) {
        acc[i] = bg.color.r;
        acc[i + 1] = bg.color.g;
        acc[i + 2] = bg.color.b;
        acc[i + 3] = 1;
      }
    } else {
      acc.fill(0, 0, n);
    }
    this.compositeList(opts.roots ?? this.doc.layers, r, acc, 1, opts);
  }

  /**
   * Composites a document rect of any size into straight RGBA8 (row stride = r.w).
   */
  compositeToRGBA(r: Rect, opts: CompositeOptions = {}): Uint8ClampedArray {
    const out = new Uint8ClampedArray(r.w * r.h * 4);
    const ts = this.doc.tileSize;
    const acc = new Float32Array(ts * ts * 4);
    forEachTileInRect(r, ts, (_tx, _ty, sub) => {
      this.compositeRect(sub, acc, opts);
      for (let y = 0; y < sub.h; y++) {
        let i = y * sub.w * 4;
        let j = ((sub.y - r.y + y) * r.w + (sub.x - r.x)) * 4;
        for (let x = 0; x < sub.w; x++, i += 4, j += 4) storeStraight(acc, i, out, j);
      }
    });
    return out;
  }

  private visible(node: LayerNode, opts: CompositeOptions): boolean {
    if (!node.visible) return false;
    return opts.isVisible ? opts.isVisible(node) : true;
  }

  private compositeList(
    nodes: LayerNode[],
    r: Rect,
    acc: Float32Array,
    depth: number,
    opts: CompositeOptions,
  ): void {
    let i = 0;
    while (i < nodes.length) {
      const base = nodes[i];
      let j = i + 1;
      while (j < nodes.length && nodes[j].kind === 'raster' && (nodes[j] as RasterLayer).clip) j++;
      if (this.visible(base, opts)) {
        const clipped = j > i + 1 ? nodes.slice(i + 1, j) : null;
        this.compositeNode(base, clipped, r, acc, depth, opts);
      }
      i = j;
    }
  }

  private compositeNode(
    node: LayerNode,
    clipped: LayerNode[] | null,
    r: Rect,
    acc: Float32Array,
    depth: number,
    opts: CompositeOptions,
  ): void {
    const n = r.w * r.h * 4;
    const style = opts.nodeStyle?.(node);
    if (style) {
      const content = this.pool.get(depth);
      if (!this.nodeContent(node, r, content, depth, opts)) return;
      const o = node.opacity * style.opacity;
      const t = style.tint;
      const k = t ? style.tintAmount : 0;
      for (let i = 0; i < n; i += 4) {
        const ca = content[i + 3];
        if (ca <= 0) continue;
        const a = ca * o;
        const kk = 1 - a;
        // premultiplied: mixing toward the tint keeps alpha, so the tint is scaled by coverage
        const cr = t ? content[i] + (t.r * ca - content[i]) * k : content[i];
        const cg = t ? content[i + 1] + (t.g * ca - content[i + 1]) * k : content[i + 1];
        const cb = t ? content[i + 2] + (t.b * ca - content[i + 2]) * k : content[i + 2];
        acc[i] = cr * o + acc[i] * kk;
        acc[i + 1] = cg * o + acc[i + 1] * kk;
        acc[i + 2] = cb * o + acc[i + 2] * kk;
        acc[i + 3] = a + acc[i + 3] * kk;
      }
      return;
    }
    if (node.kind === 'group' && node.passThrough && !clipped) {
      if (node.opacity >= 1) {
        this.compositeList(node.children, r, acc, depth + 1, opts);
        return;
      }
      const tmp = this.pool.get(depth);
      tmp.set(acc.subarray(0, n));
      this.compositeList(node.children, r, tmp, depth + 1, opts);
      const o = node.opacity;
      for (let i = 0; i < n; i++) acc[i] += (tmp[i] - acc[i]) * o;
      return;
    }
    if (node.kind === 'raster' && !clipped && !(this.preview && this.preview.layerId === node.id)) {
      this.blendRasterDirect(node, r, acc);
      return;
    }
    const content = this.pool.get(depth);
    const has = this.nodeContent(node, r, content, depth, opts);
    if (!has) return;
    if (clipped) {
      const cbuf = this.pool.get(depth + 1);
      for (const c of clipped) {
        if (!this.visible(c, opts)) continue;
        if (!this.nodeContent(c, r, cbuf, depth + 2, opts)) continue;
        const m = modeIndex(c.blendMode);
        const o = c.opacity;
        for (let i = 0; i < n; i += 4) {
          const a = cbuf[i + 3] * o;
          if (a > 0) blendInto(content, i, cbuf[i] * o, cbuf[i + 1] * o, cbuf[i + 2] * o, a, m, true);
        }
      }
    }
    const m = modeIndex(node.blendMode);
    const o = node.opacity;
    for (let i = 0; i < n; i += 4) {
      const a = content[i + 3] * o;
      if (a <= 0) continue;
      if (m === 0) {
        const k = 1 - a;
        acc[i] = content[i] * o + acc[i] * k;
        acc[i + 1] = content[i + 1] * o + acc[i + 1] * k;
        acc[i + 2] = content[i + 2] * o + acc[i + 2] * k;
        acc[i + 3] = a + acc[i + 3] * k;
      } else blendInto(acc, i, content[i] * o, content[i + 1] * o, content[i + 2] * o, a, m, false);
    }
  }

  /**
   * Fast path: blends a raster layer (with optional mask) straight from its 8-bit tile into `acc`,
   * without an intermediate float buffer. Normal mode is fully inlined.
   */
  private blendRasterDirect(layer: RasterLayer, r: Rect, acc: Float32Array): void {
    const ts = this.doc.tileSize;
    const tx = Math.floor(r.x / ts);
    const ty = Math.floor(r.y / ts);
    const tile = layer.pixels.get(tx, ty);
    if (!tile) return;
    const mask = layer.mask && layer.maskEnabled ? layer.mask : null;
    const mt = mask ? mask.get(tx, ty) : undefined;
    const mdef = mask ? mask.defaultValue * INV255 : 1;
    if (mask && !mt && mdef <= 0) return;
    const o = layer.opacity;
    if (o <= 0) return;
    const m = modeIndex(layer.blendMode);
    const ox = r.x - tx * ts;
    const oy = r.y - ty * ts;
    for (let y = 0; y < r.h; y++) {
      const rowT = (oy + y) * ts + ox;
      let j = rowT * 4;
      let i = y * r.w * 4;
      for (let x = 0; x < r.w; x++, i += 4, j += 4) {
        const a8 = tile[j + 3];
        if (a8 === 0) continue;
        let a = a8 * INV255 * o;
        if (mask) a *= mt ? mt[rowT + x] * INV255 : mdef;
        if (a <= 0) continue;
        const ca = a * INV255;
        if (m === 0) {
          const k = 1 - a;
          acc[i] = tile[j] * ca + acc[i] * k;
          acc[i + 1] = tile[j + 1] * ca + acc[i + 1] * k;
          acc[i + 2] = tile[j + 2] * ca + acc[i + 2] * k;
          acc[i + 3] = a + acc[i + 3] * k;
        } else {
          blendInto(acc, i, tile[j] * ca, tile[j + 1] * ca, tile[j + 2] * ca, a, m, false);
        }
      }
    }
  }

  /** Fills `out` with the node's own premultiplied content for rect r. Returns false when empty. */
  private nodeContent(
    node: LayerNode,
    r: Rect,
    out: Float32Array,
    depth: number,
    opts: CompositeOptions,
  ): boolean {
    const n = r.w * r.h * 4;
    if (node.kind === 'group') {
      out.fill(0, 0, n);
      this.compositeList((node as GroupLayer).children, r, out, depth + 1, opts);
      return true;
    }
    return this.rasterContent(node, r, out);
  }

  rasterContent(layer: RasterLayer, r: Rect, out: Float32Array): boolean {
    const ts = this.doc.tileSize;
    const tx = Math.floor(r.x / ts);
    const ty = Math.floor(r.y / ts);
    const tile = layer.pixels.get(tx, ty);
    const pv = this.preview && this.preview.layerId === layer.id ? this.preview : null;
    const strokeTile = pv ? pv.buffer.get(tx, ty) : undefined;
    const n = r.w * r.h * 4;
    if (!tile && !(strokeTile && pv?.target === 'pixels')) return false;
    if (tile) {
      for (let y = 0; y < r.h; y++) {
        let j = ((r.y - ty * ts + y) * ts + (r.x - tx * ts)) * 4;
        let i = y * r.w * 4;
        for (let x = 0; x < r.w; x++, i += 4, j += 4) {
          const a = tile[j + 3] * INV255;
          const ca = a * INV255;
          out[i] = tile[j] * ca;
          out[i + 1] = tile[j + 1] * ca;
          out[i + 2] = tile[j + 2] * ca;
          out[i + 3] = a;
        }
      }
    } else {
      out.fill(0, 0, n);
    }
    if (pv && strokeTile && pv.target === 'pixels') {
      const m = modeIndex(pv.mode);
      const o = pv.opacity;
      const lock = pv.alphaLock || layer.alphaLock;
      for (let y = 0; y < r.h; y++) {
        let j = ((r.y - ty * ts + y) * ts + (r.x - tx * ts)) * 4;
        let i = y * r.w * 4;
        for (let x = 0; x < r.w; x++, i += 4, j += 4) {
          const sa = strokeTile[j + 3] * o;
          if (sa > 0)
            blendInto(out, i, strokeTile[j] * o, strokeTile[j + 1] * o, strokeTile[j + 2] * o, sa, m, lock);
        }
      }
    }
    if (layer.mask && layer.maskEnabled) {
      const mask = layer.mask;
      const mt = mask.get(tx, ty);
      const ms = this.maskScratch;
      const def = mask.defaultValue / 255;
      for (let y = 0; y < r.h; y++) {
        const row = (r.y - ty * ts + y) * ts + (r.x - tx * ts);
        for (let x = 0; x < r.w; x++) ms[y * r.w + x] = mt ? mt[row + x] / 255 : def;
      }
      if (pv && strokeTile && pv.target === 'mask')
        applyStrokeToMaskValues(ms, r, ts, tx, ty, strokeTile, pv);
      for (let p = 0, i = 0; p < r.w * r.h; p++, i += 4) {
        const k = ms[p];
        if (k >= 1) continue;
        out[i] *= k;
        out[i + 1] *= k;
        out[i + 2] *= k;
        out[i + 3] *= k;
      }
    }
    return true;
  }
}

/** Mask painting: paints the stroke's grey value (luminance) into mask values (0..1); erase paints black. */
export function applyStrokeToMaskValues(
  ms: Float32Array,
  r: Rect,
  ts: number,
  tx: number,
  ty: number,
  strokeTile: Float32Array,
  pv: StrokePreview,
): void {
  const o = pv.opacity;
  const erase = pv.mode === 'erase';
  for (let y = 0; y < r.h; y++) {
    let j = ((r.y - ty * ts + y) * ts + (r.x - tx * ts)) * 4;
    for (let x = 0; x < r.w; x++, j += 4) {
      const sa = strokeTile[j + 3] * o;
      if (sa <= 0) continue;
      const a = strokeTile[j + 3];
      const grey = erase
        ? 0
        : (0.3 * strokeTile[j] + 0.59 * strokeTile[j + 1] + 0.11 * strokeTile[j + 2]) / a;
      const p = y * r.w + x;
      ms[p] = ms[p] * (1 - sa) + grey * sa;
    }
  }
}
