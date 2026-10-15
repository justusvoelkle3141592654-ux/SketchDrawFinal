// Native .cforge container: ZIP with manifest.json, document.json, raw tile data, previews and resources.
import { strFromU8, strToU8, unzipSync, zipSync, zip as zipAsync, type Zippable } from 'fflate';
import { CFORGE_FORMAT_ID, CFORGE_FORMAT_VERSION, parseManifest } from '../../../shared/cforge-validate';
import { isBlendMode, storeStraight } from '../blend';
import { parseHex, rgbToHex } from '../color';
import { RasterDocument, MAX_DOCUMENT_SIDE } from '../document';
import type { GroupLayer, LabelColor, LayerNode, RasterLayer } from '../layers';
import { LABEL_COLORS } from '../layers';
import { MaskGrid, TileGrid, keyTx, keyTy } from '../tiles';
import { Compositor, type CompositeOptions } from '../compositor';
import { encodePng } from './png';
import type { ViewState } from '../view';
import { validateBrush, type BrushPreset } from '../brush/schema';

/** A palette referenced by the document, stored with its colours so it can be restored anywhere. */
export interface PaletteRef {
  id: string;
  name: string;
  colors: string[]; // #RRGGBB
}

export interface DocumentExtras {
  view?: ViewState;
  /** Brush presets referenced by the document (for reproducibility). */
  brushes?: BrushPreset[];
  /** The palette in use with the document. */
  palette?: PaletteRef | null;
  /** Opaque JSON for features stored with the document (animation, guides, time-lapse metadata). */
  features?: Record<string, unknown>;
  /** Additional binary resources (e.g. time-lapse frames). */
  resources?: Record<string, Uint8Array>;
}

interface LayerJsonBase {
  kind: 'raster' | 'group';
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: string;
  locked: boolean;
  label: string;
}
interface RasterJson extends LayerJsonBase {
  kind: 'raster';
  alphaLock: boolean;
  clip: boolean;
  maskEnabled: boolean;
  editMask: boolean;
  tiles: [number, number][];
  mask: { tiles: [number, number][] } | null;
}
interface GroupJson extends LayerJsonBase {
  kind: 'group';
  expanded: boolean;
  passThrough: boolean;
  children: (RasterJson | GroupJson)[];
}

interface DocumentJson {
  width: number;
  height: number;
  dpi: number;
  tileSize: number;
  background: { transparent: boolean; color: string };
  title: string;
  created: string;
  modified: string;
  activeLayerId: string;
  layers: (RasterJson | GroupJson)[];
  selection: { tiles: [number, number][] } | null;
  view: ViewState | null;
  features: Record<string, unknown>;
  /** Absent in files written before palette references were stored. */
  palette?: PaletteRef | null;
}

const tileName = (tx: number, ty: number) => `${tx}_${ty}`;
/** Deflate level for raw tile data: level 3 is several times faster than 6 with similar size on artwork. */
const TILE_LEVEL = 3;

function layerToJson(n: LayerNode, files: Zippable): RasterJson | GroupJson {
  const base = {
    id: n.id,
    name: n.name,
    visible: n.visible,
    opacity: n.opacity,
    blendMode: n.blendMode,
    locked: n.locked,
    label: n.label,
  };
  if (n.kind === 'group') {
    return {
      ...base,
      kind: 'group',
      expanded: n.expanded,
      passThrough: n.passThrough,
      children: n.children.map((c) => layerToJson(c, files)),
    };
  }
  const tiles: [number, number][] = [];
  for (const [k, t] of n.pixels.tiles) {
    let empty = true;
    for (let i = 3; i < t.length; i += 4)
      if (t[i] !== 0) {
        empty = false;
        break;
      }
    if (empty) continue;
    const tx = keyTx(k);
    const ty = keyTy(k);
    tiles.push([tx, ty]);
    files[`layers/${n.id}/${tileName(tx, ty)}.rgba`] = [
      new Uint8Array(t.buffer, t.byteOffset, t.byteLength),
      { level: TILE_LEVEL },
    ];
  }
  let mask: RasterJson['mask'] = null;
  if (n.mask) {
    const mt: [number, number][] = [];
    for (const [k, t] of n.mask.tiles) {
      const tx = keyTx(k);
      const ty = keyTy(k);
      mt.push([tx, ty]);
      files[`masks/${n.id}/${tileName(tx, ty)}.a8`] = [
        new Uint8Array(t.buffer, t.byteOffset, t.byteLength),
        { level: 6 },
      ];
    }
    mask = { tiles: mt };
  }
  return {
    ...base,
    kind: 'raster',
    alphaLock: n.alphaLock,
    clip: n.clip,
    maskEnabled: n.maskEnabled,
    editMask: n.editMask,
    tiles,
    mask,
  };
}

/** Box-filtered downscale of a composite (premultiplied averaging to avoid dark fringes). */
export function renderPreview(
  doc: RasterDocument,
  maxSide: number,
  options?: CompositeOptions,
): { width: number; height: number; data: Uint8ClampedArray } {
  const comp = new Compositor(doc);
  const full = comp.compositeToRGBA(doc.bounds, options);
  return downscale({ width: doc.width, height: doc.height, data: full }, maxSide);
}

export function downscale(
  src: { width: number; height: number; data: Uint8ClampedArray },
  maxSide: number,
): { width: number; height: number; data: Uint8ClampedArray } {
  const full = src.data;
  const doc = { width: src.width, height: src.height };
  const k = Math.min(1, maxSide / Math.max(doc.width, doc.height));
  const w = Math.max(1, Math.round(doc.width * k));
  const h = Math.max(1, Math.round(doc.height * k));
  if (k === 1) return { width: w, height: h, data: full };
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor((y / h) * doc.height);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) / h) * doc.height));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor((x / w) * doc.width);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) / w) * doc.width));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      // sample at most 4×4 points per output pixel to bound cost on huge documents
      const stepY = Math.max(1, Math.floor((sy1 - sy0) / 4));
      const stepX = Math.max(1, Math.floor((sx1 - sx0) / 4));
      for (let sy = sy0; sy < sy1; sy += stepY) {
        for (let sx = sx0; sx < sx1; sx += stepX) {
          const i = (sy * doc.width + sx) * 4;
          const al = full[i + 3] / 255;
          r += full[i] * al;
          g += full[i + 1] * al;
          b += full[i + 2] * al;
          a += al;
          n++;
        }
      }
      const j = (y * w + x) * 4;
      if (a > 0) {
        out[j] = r / a;
        out[j + 1] = g / a;
        out[j + 2] = b / a;
        out[j + 3] = (a / n) * 255;
      }
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * Preview composite: documents up to 2048 px are composited fully and box-filtered; larger documents
 * are composited per tile and sampled, which keeps saving fast on huge canvases.
 */
function previewSource(
  doc: RasterDocument,
  maxSide: number,
  options?: CompositeOptions,
): { width: number; height: number; data: Uint8ClampedArray } {
  if (Math.max(doc.width, doc.height) <= 2048) return renderPreview(doc, maxSide, options);
  const comp = new Compositor(doc);
  const k = Math.min(1, maxSide / Math.max(doc.width, doc.height));
  const w = Math.max(1, Math.round(doc.width * k));
  const h = Math.max(1, Math.round(doc.height * k));
  const out = new Uint8ClampedArray(w * h * 4);
  const ts = doc.tileSize;
  const acc = new Float32Array(ts * ts * 4);
  const tmp = new Uint8ClampedArray(4);
  const sums = new Float32Array(w * h * 5);
  for (let ty = 0; ty * ts < doc.height; ty++) {
    for (let tx = 0; tx * ts < doc.width; tx++) {
      const r = {
        x: tx * ts,
        y: ty * ts,
        w: Math.min(ts, doc.width - tx * ts),
        h: Math.min(ts, doc.height - ty * ts),
      };
      comp.compositeRect(r, acc, options);
      // 2×2 samples per output pixel inside this tile
      const step = Math.max(1, Math.floor(1 / k / 2));
      for (let y = 0; y < r.h; y += step) {
        const oy = Math.min(h - 1, Math.floor((r.y + y) * k));
        for (let x = 0; x < r.w; x += step) {
          const ox = Math.min(w - 1, Math.floor((r.x + x) * k));
          const i = (y * r.w + x) * 4;
          const o = (oy * w + ox) * 5;
          sums[o] += acc[i];
          sums[o + 1] += acc[i + 1];
          sums[o + 2] += acc[i + 2];
          sums[o + 3] += acc[i + 3];
          sums[o + 4] += 1;
        }
      }
    }
  }
  const f = new Float32Array(4);
  for (let p = 0; p < w * h; p++) {
    const n = sums[p * 5 + 4] || 1;
    f[0] = sums[p * 5] / n;
    f[1] = sums[p * 5 + 1] / n;
    f[2] = sums[p * 5 + 2] / n;
    f[3] = sums[p * 5 + 3] / n;
    storeStraight(f, 0, tmp, 0);
    out.set(tmp, p * 4);
  }
  return { width: w, height: h, data: out };
}

export interface SerializeOptions extends DocumentExtras {
  appVersion: string;
  /** Skip preview/thumbnail generation (faster autosave). */
  skipPreviews?: boolean;
  /** What the preview shows (e.g. only the current animation frame). */
  previewOptions?: CompositeOptions;
}

export function buildCforgeFiles(doc: RasterDocument, opts: SerializeOptions): Zippable {
  const files: Zippable = {};
  const selectionTiles: [number, number][] = [];
  if (doc.selection) {
    for (const [k, t] of doc.selection.tiles) {
      const tx = keyTx(k);
      const ty = keyTy(k);
      selectionTiles.push([tx, ty]);
      files[`selection/${tileName(tx, ty)}.a8`] = [
        new Uint8Array(t.buffer, t.byteOffset, t.byteLength),
        { level: 6 },
      ];
    }
  }
  const json: DocumentJson = {
    width: doc.width,
    height: doc.height,
    dpi: doc.dpi,
    tileSize: doc.tileSize,
    background: { transparent: doc.background.transparent, color: rgbToHex(doc.background.color) },
    title: doc.title,
    created: doc.created,
    modified: doc.modified,
    activeLayerId: doc.activeLayerId,
    layers: doc.layers.map((l) => layerToJson(l, files)),
    selection: doc.selection ? { tiles: selectionTiles } : null,
    view: opts.view ?? null,
    features: opts.features ?? {},
    palette: opts.palette ?? null,
  };
  const now = new Date().toISOString();
  files['manifest.json'] = strToU8(
    JSON.stringify(
      {
        format: CFORGE_FORMAT_ID,
        formatVersion: CFORGE_FORMAT_VERSION,
        appVersion: opts.appVersion,
        created: doc.created,
        modified: now,
        document: 'document.json',
        preview: opts.skipPreviews ? null : 'preview.png',
        thumbnail: opts.skipPreviews ? null : 'thumbnail.png',
        tileEncoding: 'raw-rgba8-straight',
      },
      null,
      2,
    ),
  );
  files['document.json'] = strToU8(JSON.stringify(json, null, 1));
  if (opts.brushes?.length) files['resources/brushes.json'] = strToU8(JSON.stringify(opts.brushes));
  for (const [name, data] of Object.entries(opts.resources ?? {})) {
    if (/^[\w./-]{1,120}$/.test(name) && !name.includes('..'))
      files[`resources/${name}`] = [data, { level: 0 }];
  }
  if (!opts.skipPreviews) {
    // one composite at a bounded resolution feeds both previews
    const prev = previewSource(doc, 1024, opts.previewOptions);
    files['preview.png'] = [encodePng(prev.width, prev.height, prev.data, { level: 6 }), { level: 0 }];
    const thumb = downscale(prev, 256);
    files['thumbnail.png'] = [encodePng(thumb.width, thumb.height, thumb.data, { level: 6 }), { level: 0 }];
  }
  return files;
}

export function serializeDocumentSync(doc: RasterDocument, opts: SerializeOptions): Uint8Array {
  return zipSync(buildCforgeFiles(doc, opts));
}

/** Compresses in fflate's worker pool where available. */
export function serializeDocument(doc: RasterDocument, opts: SerializeOptions): Promise<Uint8Array> {
  const files = buildCforgeFiles(doc, opts);
  return new Promise((resolve, reject) => {
    try {
      zipAsync(files, (err, data) => (err ? reject(err) : resolve(data)));
    } catch {
      // environments without Worker support
      resolve(zipSync(files));
    }
  });
}

// ------------------------------------------------------------------------------------- reading

export interface LoadedDocument {
  doc: RasterDocument;
  view: ViewState | null;
  brushes: BrushPreset[];
  palette: PaletteRef | null;
  features: Record<string, unknown>;
  resources: Record<string, Uint8Array>;
  warnings: string[];
}

export class CforgeError extends Error {}

const LABELS = LABEL_COLORS.map((l) => l.id);

/** Validates a stored palette reference; colours are normalised to #RRGGBB, invalid ones dropped. */
function readPaletteRef(v: unknown): PaletteRef | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  if (typeof p.id !== 'string' || !p.id || p.id.length > 64) return null;
  const colors: string[] = [];
  for (const c of Array.isArray(p.colors) ? p.colors : []) {
    const rgb = typeof c === 'string' ? parseHex(c) : null;
    if (rgb) colors.push(rgbToHex(rgb));
    if (colors.length >= 512) break;
  }
  return { id: p.id, name: typeof p.name === 'string' ? p.name.slice(0, 80) : 'Palette', colors };
}

export function deserializeDocument(bytes: Uint8Array): LoadedDocument {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (e) {
    throw new CforgeError(`The file is damaged or not a Canvas Forge document (${(e as Error).message}).`);
  }
  const mBytes = entries['manifest.json'];
  if (!mBytes) throw new CforgeError('The file is not a Canvas Forge document (manifest.json is missing).');
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(strFromU8(mBytes));
  } catch {
    throw new CforgeError('manifest.json is not valid JSON.');
  }
  const m = parseManifest(manifestJson);
  if (!m.ok) throw new CforgeError(m.error);
  const dBytes = entries[m.manifest.document];
  if (!dBytes) throw new CforgeError('document.json is missing.');
  let json: DocumentJson;
  try {
    json = JSON.parse(strFromU8(dBytes)) as DocumentJson;
  } catch {
    throw new CforgeError('document.json is not valid JSON.');
  }
  const warnings: string[] = [];
  const intIn = (v: unknown, lo: number, hi: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
  if (!intIn(json.width, 1, MAX_DOCUMENT_SIDE) || !intIn(json.height, 1, MAX_DOCUMENT_SIDE)) {
    throw new CforgeError('The document dimensions are missing or invalid.');
  }
  const tileSize =
    json.tileSize === 512 ? 512 : json.tileSize === 256 || json.tileSize === undefined ? 256 : -1;
  if (tileSize < 0) throw new CforgeError(`Unsupported tile size ${String(json.tileSize)}.`);
  const bgColor = parseHex(json.background?.color ?? '#FFFFFF') ?? { r: 1, g: 1, b: 1, a: 1 };
  const doc = new RasterDocument({
    width: json.width,
    height: json.height,
    dpi: typeof json.dpi === 'number' && json.dpi > 0 && json.dpi < 10000 ? json.dpi : 144,
    tileSize,
    background: {
      transparent: !!json.background?.transparent,
      color: { r: bgColor.r, g: bgColor.g, b: bgColor.b },
    },
    title: typeof json.title === 'string' ? json.title.slice(0, 200) : 'Untitled',
  });
  if (typeof json.created === 'string') doc.created = json.created;
  if (typeof json.modified === 'string') doc.modified = json.modified;
  const pixelBytes = tileSize * tileSize * 4;
  const maskBytes = tileSize * tileSize;
  const ids = new Set<string>();
  const readLayer = (lj: RasterJson | GroupJson, depth: number): LayerNode | null => {
    if (!lj || typeof lj !== 'object' || depth > 32) return null;
    let id = typeof lj.id === 'string' && /^[\w-]{1,64}$/.test(lj.id) ? lj.id : '';
    if (!id || ids.has(id)) {
      warnings.push('A layer had a missing or duplicate id and was given a new one.');
      id = `L${ids.size}x${Math.random().toString(36).slice(2, 8)}`;
    }
    ids.add(id);
    const common = {
      id,
      name: typeof lj.name === 'string' ? lj.name.slice(0, 120) : 'Layer',
      visible: lj.visible !== false,
      opacity: typeof lj.opacity === 'number' ? Math.min(1, Math.max(0, lj.opacity)) : 1,
      blendMode: isBlendMode(lj.blendMode) ? lj.blendMode : 'normal',
      locked: !!lj.locked,
      label: (LABELS.includes(lj.label as LabelColor) ? lj.label : 'none') as LabelColor,
    };
    if (lj.blendMode && !isBlendMode(lj.blendMode))
      warnings.push(`Unknown blend mode "${lj.blendMode}" was replaced by Normal.`);
    if (lj.kind === 'group') {
      const g: GroupLayer = {
        ...common,
        kind: 'group',
        expanded: lj.expanded !== false,
        passThrough: lj.passThrough !== false,
        children: Array.isArray(lj.children)
          ? lj.children.map((c) => readLayer(c, depth + 1)).filter((c): c is LayerNode => !!c)
          : [],
      };
      return g;
    }
    const pixels = new TileGrid(tileSize);
    for (const t of Array.isArray(lj.tiles) ? lj.tiles : []) {
      if (!Array.isArray(t) || !Number.isInteger(t[0]) || !Number.isInteger(t[1])) continue;
      const data = entries[`layers/${lj.id}/${tileName(t[0], t[1])}.rgba`];
      if (!data || data.length !== pixelBytes) {
        warnings.push(
          `Pixel data for layer "${common.name}" tile ${t[0]},${t[1]} is missing or damaged; it was left empty.`,
        );
        continue;
      }
      pixels.set(
        t[0],
        t[1],
        new Uint8ClampedArray(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
      );
    }
    let mask: MaskGrid | null = null;
    if (lj.mask && Array.isArray(lj.mask.tiles)) {
      mask = new MaskGrid(tileSize, 255);
      for (const t of lj.mask.tiles) {
        const data = entries[`masks/${lj.id}/${tileName(t[0], t[1])}.a8`];
        if (!data || data.length !== maskBytes) {
          warnings.push(`Mask data for layer "${common.name}" is incomplete.`);
          continue;
        }
        mask.set(
          t[0],
          t[1],
          new Uint8ClampedArray(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
        );
      }
    }
    const r: RasterLayer = {
      ...common,
      kind: 'raster',
      pixels,
      mask,
      maskEnabled: lj.maskEnabled !== false,
      editMask: !!lj.editMask && !!mask,
      alphaLock: !!lj.alphaLock,
      clip: !!lj.clip,
    };
    return r;
  };
  doc.layers = (Array.isArray(json.layers) ? json.layers : [])
    .map((l) => readLayer(l, 0))
    .filter((l): l is LayerNode => !!l);
  if (!doc.layers.length) {
    warnings.push('The document had no layers; an empty layer was added.');
    const fresh = RasterDocument.createDefault({ width: doc.width, height: doc.height, tileSize });
    doc.layers = fresh.layers;
  }
  doc.activeLayerId =
    typeof json.activeLayerId === 'string' && doc.getLayer(json.activeLayerId)
      ? json.activeLayerId
      : doc.layers[doc.layers.length - 1].id;
  if (json.selection && Array.isArray(json.selection.tiles)) {
    const sel = new MaskGrid(tileSize, 0);
    for (const t of json.selection.tiles) {
      const data = entries[`selection/${tileName(t[0], t[1])}.a8`];
      if (data && data.length === maskBytes)
        sel.set(
          t[0],
          t[1],
          new Uint8ClampedArray(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
        );
    }
    doc.selection = sel.tiles.size ? sel : null;
  }
  let brushes: BrushPreset[] = [];
  const bBytes = entries['resources/brushes.json'];
  if (bBytes) {
    try {
      const arr = JSON.parse(strFromU8(bBytes));
      if (Array.isArray(arr)) {
        brushes = arr.flatMap((b) => {
          try {
            return [validateBrush(b)];
          } catch {
            warnings.push('A brush stored in the document could not be read.');
            return [];
          }
        });
      }
    } catch {
      warnings.push('Stored brush data could not be read.');
    }
  }
  const palette = readPaletteRef(json.palette);
  if (json.palette && !palette) warnings.push('The palette stored in the document could not be read.');
  const resources: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(entries)) {
    if (name.startsWith('resources/') && name !== 'resources/brushes.json')
      resources[name.slice('resources/'.length)] = data;
  }
  return {
    doc,
    view: json.view && typeof json.view === 'object' ? json.view : null,
    brushes,
    palette,
    features: json.features && typeof json.features === 'object' ? json.features : {},
    resources,
    warnings: [...new Set(warnings)],
  };
}
