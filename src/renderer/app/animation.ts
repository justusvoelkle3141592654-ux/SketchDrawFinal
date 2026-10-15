// Animation controller: settings (undoable), frame operations, the frame view shown on the canvas,
// playback from prepared frame images, and PNG-sequence / animated GIF export.
import { create } from 'zustand';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import {
  currentFrameIndex,
  defaultAnimation,
  exposureOf,
  frameAtTick,
  frameCompositeOptions,
  frameLayout,
  frameViewKey,
  MAX_EXPOSURE,
  sanitizeAnimation,
  timeline,
  type AnimationSettings,
} from '../engine/animation';
import { Compositor, type CompositeOptions } from '../engine/compositor';
import { structural } from '../engine/layer-ops';
import { cloneLayer, createRasterLayer, forEachLayer, layerByteSize, type LayerNode } from '../engine/layers';
import type { HistoryEntry } from '../engine/history';
import { encodePng } from '../engine/io/png';
import { setDisplayProvider, type CanvasRenderer } from '../render/canvas-renderer';
import { activeSession, useDocs, type DocumentSession } from '../state/documents';
import { confirmDialog, toast } from '../state/ui';
import { forge } from '../platform';
import { requestRedraw } from './actions';

// ------------------------------------------------------------------------------------- settings

/** Settings objects that were already validated (document features come from files). */
const checked = new WeakSet<object>();

export function animationOf(s: DocumentSession): AnimationSettings {
  const raw = s.features.animation;
  if (raw && typeof raw === 'object' && checked.has(raw)) return raw as AnimationSettings;
  const a = sanitizeAnimation(raw);
  checked.add(a);
  s.features = { ...s.features, animation: a };
  return a;
}

function storeSettings(s: DocumentSession, a: AnimationSettings) {
  const copy = structuredClone(a);
  checked.add(copy);
  s.features = { ...s.features, animation: copy };
  useDocs.getState().bump();
  requestRedraw();
}

let lastEdit: {
  s: DocumentSession;
  label: string;
  stateId: number;
  at: number;
  after: AnimationSettings;
} | null = null;

/** Changes animation settings as one undo step; quick repeats of the same change merge into it. */
export function updateAnimation(s: DocumentSession, label: string, fn: (a: AnimationSettings) => void) {
  const before = structuredClone(animationOf(s));
  const after = structuredClone(before);
  fn(after);
  if (JSON.stringify(after) === JSON.stringify(before)) return;
  storeSettings(s, after);
  const now = Date.now();
  if (
    lastEdit &&
    lastEdit.s === s &&
    lastEdit.label === label &&
    lastEdit.stateId === s.history.stateId &&
    now - lastEdit.at < 1500
  ) {
    // merge into the previous entry: it keeps its "before", the new values become its "after"
    Object.assign(lastEdit.after, structuredClone(after));
    lastEdit.at = now;
    return;
  }
  const keep = structuredClone(after);
  const entry: HistoryEntry = {
    label,
    bytes: 512,
    undo: () => storeSettings(s, before),
    redo: () => storeSettings(s, keep),
  };
  s.history.push(entry);
  lastEdit = { s, label, stateId: s.history.stateId, at: now, after: keep };
}

// ---------------------------------------------------------------------------------- frame access

export function frames(s: DocumentSession): LayerNode[] {
  return frameLayout(s.doc, animationOf(s)).frames;
}

export function currentFrame(s: DocumentSession): number {
  return currentFrameIndex(s.doc, animationOf(s));
}

/** Topmost paint layer inside a node (frames may be groups). */
function paintTarget(node: LayerNode): LayerNode {
  if (node.kind !== 'group') return node;
  let found: LayerNode | null = null;
  forEachLayer(node.children, (n) => {
    if (n.kind === 'raster') found = n;
  });
  return found ?? node;
}

export function goToFrame(s: DocumentSession, index: number) {
  const list = frames(s);
  if (!list.length) return;
  const i = Math.max(0, Math.min(list.length - 1, index));
  s.doc.activeLayerId = paintTarget(list[i]).id;
  useDocs.getState().bump();
  requestRedraw();
}

export function stepFrame(s: DocumentSession, dir: 1 | -1) {
  const list = frames(s);
  if (!list.length) return;
  const a = animationOf(s);
  let i = currentFrame(s) + dir;
  if (i < 0) i = a.loop ? list.length - 1 : 0;
  if (i >= list.length) i = a.loop ? 0 : list.length - 1;
  goToFrame(s, i);
}

/** Composite options for what a frame really shows (no onion skins): picking, export, previews. */
export function frameOptions(s: DocumentSession, index = currentFrame(s)): CompositeOptions | undefined {
  const a = animationOf(s);
  if (!a.enabled || index < 0) return undefined;
  return frameCompositeOptions(s.doc, a, index, false);
}

setDisplayProvider((s) => {
  const a = animationOf(s);
  if (!a.enabled) return null;
  const i = currentFrameIndex(s.doc, a);
  if (i < 0) return null;
  return { options: frameCompositeOptions(s.doc, a, i, true), key: frameViewKey(s.doc, a, i, true) };
});

// ------------------------------------------------------------------------------ frame operations

export function setAnimationEnabled(s: DocumentSession, on: boolean) {
  updateAnimation(s, on ? 'Turn on animation' : 'Turn off animation', (a) => void (a.enabled = on));
}

function insertFrame(s: DocumentSession, node: LayerNode, label: string, bytes = 0) {
  const doc = s.doc;
  const list = frames(s);
  const cur = list[currentFrame(s)];
  const e = structural(
    doc,
    label,
    () => {
      const at = cur ? doc.layers.indexOf(cur) + 1 : doc.layers.length;
      doc.layers.splice(at, 0, node);
      doc.activeLayerId = paintTarget(node).id;
    },
    bytes,
  );
  s.history.push(e);
  doc.markPixelsChanged(null);
  useDocs.getState().bump();
  requestRedraw();
}

export function addFrame(s: DocumentSession) {
  const n = frames(s).length + 1;
  insertFrame(s, createRasterLayer(`Frame ${n}`, s.doc.tileSize), 'New frame');
}

export function duplicateFrame(s: DocumentSession) {
  const cur = frames(s)[currentFrame(s)];
  if (!cur) return;
  const copy = cloneLayer(cur, ' copy');
  insertFrame(s, copy, 'Duplicate frame', layerByteSize(copy));
  const e = exposureOf(animationOf(s), cur);
  if (e > 1) updateAnimation(s, 'Frame exposure', (a) => void (a.exposures[copy.id] = e));
}

export async function deleteFrame(s: DocumentSession) {
  const list = frames(s);
  const i = currentFrame(s);
  const cur = list[i];
  if (!cur) return;
  if (s.doc.layers.length <= 1) return toast('info', 'A document keeps at least one frame.');
  const r = await confirmDialog({
    title: 'Delete frame?',
    message: `"${cur.name}" and everything on it will be removed. Undo restores it.`,
    buttons: [
      { id: 'delete', label: 'Delete frame', kind: 'danger' },
      { id: 'cancel', label: 'Cancel' },
    ],
    cancelId: 'cancel',
  });
  if (r !== 'delete') return;
  const doc = s.doc;
  const e = structural(
    doc,
    'Delete frame',
    () => {
      const at = doc.layers.indexOf(cur);
      doc.layers.splice(at, 1);
      const next = doc.layers[Math.min(at, doc.layers.length - 1)];
      doc.activeLayerId = next ? paintTarget(next).id : '';
    },
    layerByteSize(cur),
  );
  s.history.push(e);
  doc.markPixelsChanged(null);
  useDocs.getState().bump();
  requestRedraw();
}

/** Moves the current frame one step earlier (−1) or later (+1) in the timeline. */
export function moveFrame(s: DocumentSession, dir: 1 | -1) {
  const list = frames(s);
  const i = currentFrame(s);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const doc = s.doc;
  const a = doc.layers.indexOf(list[i]);
  const b = doc.layers.indexOf(list[j]);
  const e = structural(doc, dir > 0 ? 'Move frame later' : 'Move frame earlier', () => {
    [doc.layers[a], doc.layers[b]] = [doc.layers[b], doc.layers[a]];
  });
  s.history.push(e);
  useDocs.getState().bump();
  requestRedraw();
}

export function setExposure(s: DocumentSession, index: number, value: number) {
  const f = frames(s)[index];
  if (!f) return;
  const v = Math.max(1, Math.min(MAX_EXPOSURE, Math.round(value)));
  updateAnimation(s, 'Frame exposure', (a) => {
    if (v === 1) delete a.exposures[f.id];
    else a.exposures[f.id] = v;
  });
}

// ---------------------------------------------------------------------------------- frame images

/** Straight RGBA of one frame (held layers included, no onion skins), with or without background. */
export function renderFrame(s: DocumentSession, index: number, background: boolean): Uint8ClampedArray {
  const opts = frameCompositeOptions(s.doc, animationOf(s), index, false);
  return new Compositor(s.doc).compositeToRGBA(s.doc.bounds, { ...opts, skipBackground: !background });
}

/** Scales straight RGBA with the browser's high-quality resampling. */
function scaleRGBA(data: Uint8ClampedArray, w: number, h: number, tw: number, th: number): Uint8ClampedArray {
  if (tw === w && th === h) return data;
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  src.getContext('2d')!.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  const dst = document.createElement('canvas');
  dst.width = tw;
  dst.height = th;
  const g = dst.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, tw, th);
  return g.getImageData(0, 0, tw, th).data;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// -------------------------------------------------------------------------------------- playback

interface PlaybackState {
  playing: boolean;
  /** 0..1 while frames are being prepared, otherwise null. */
  preparing: number | null;
  /** Index of the frame on screen during playback. */
  frame: number;
}

export const usePlayback = create<PlaybackState>(() => ({ playing: false, preparing: null, frame: 0 }));

let rendererRef: CanvasRenderer | null = null;
export function attachRenderer(r: CanvasRenderer | null) {
  rendererRef = r;
}

const frameCache = new WeakMap<DocumentSession, Map<string, { sig: string; image: HTMLCanvasElement }>>();
let raf = 0;
let playToken = 0;

/** Content signature of a frame (layer versions and visible properties). */
function frameSig(s: DocumentSession, index: number): string {
  const opts = frameCompositeOptions(s.doc, animationOf(s), index, false);
  const parts: string[] = [`${s.doc.width}x${s.doc.height}`, JSON.stringify(s.doc.background)];
  forEachLayer(opts.roots ?? [], (n) => {
    parts.push(`${n.id}:${n.visible}:${n.opacity}:${n.blendMode}`);
    if (n.kind === 'raster')
      parts.push(`${n.pixels.version}:${n.mask?.version ?? '-'}:${n.maskEnabled}:${n.clip}`);
  });
  return parts.join('|');
}

/** Frames are prepared at most 2048 px on the long side and within a memory budget. */
function playbackSize(s: DocumentSession, count: number) {
  const { width, height } = s.doc;
  const budget = 480 * 1024 * 1024;
  let k = Math.min(1, 2048 / Math.max(width, height));
  k = Math.min(k, Math.sqrt(budget / Math.max(1, count * width * height * 4)));
  return { w: Math.max(1, Math.round(width * k)), h: Math.max(1, Math.round(height * k)) };
}

async function prepareFrames(s: DocumentSession, token: number): Promise<HTMLCanvasElement[] | null> {
  const list = frames(s);
  let cache = frameCache.get(s);
  if (!cache) {
    cache = new Map();
    frameCache.set(s, cache);
  }
  const { w, h } = playbackSize(s, list.length);
  const out: HTMLCanvasElement[] = [];
  for (let i = 0; i < list.length; i++) {
    if (token !== playToken) return null;
    const sig = `${frameSig(s, i)}@${w}x${h}`;
    let c = cache.get(list[i].id);
    if (!c || c.sig !== sig) {
      const data = scaleRGBA(renderFrame(s, i, true), s.doc.width, s.doc.height, w, h);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas
        .getContext('2d')!
        .putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
      c = { sig, image: canvas };
      cache.set(list[i].id, c);
      usePlayback.setState({ preparing: (i + 1) / list.length });
      await tick();
    }
    out.push(c.image);
  }
  return out;
}

export async function play(s: DocumentSession) {
  if (usePlayback.getState().playing) return;
  const a = animationOf(s);
  const list = frames(s);
  if (!a.enabled || list.length < 2) return toast('info', 'Add at least two frames to play the animation.');
  const token = ++playToken;
  usePlayback.setState({ playing: true, preparing: 0, frame: currentFrame(s) });
  const images = await prepareFrames(s, token);
  if (!images || token !== playToken) return;
  usePlayback.setState({ preparing: null });
  const start = performance.now();
  const startTick = timeline(list, a)[Math.max(0, currentFrame(s))]?.start ?? 0;
  const total = timeline(list, a).reduce((t, e) => t + e.length, 0);
  const step = () => {
    if (token !== playToken) return;
    const t = startTick + ((performance.now() - start) / 1000) * a.fps;
    if (!a.loop && t >= total) {
      stop(true);
      return;
    }
    const i = frameAtTick(list, a, t);
    if (rendererRef) {
      rendererRef.playback = { sessionId: s.id, image: images[i] };
      rendererRef.requestDraw();
    }
    if (usePlayback.getState().frame !== i) usePlayback.setState({ frame: i });
    raf = requestAnimationFrame(step);
  };
  step();
}

/** Stops playback; `land` makes the frame that was showing the current frame. */
export function stop(land = false) {
  playToken++;
  cancelAnimationFrame(raf);
  const st = usePlayback.getState();
  if (rendererRef) {
    rendererRef.playback = null;
    rendererRef.requestDraw();
  }
  usePlayback.setState({ playing: false, preparing: null });
  const s = activeSession();
  if (land && s && st.playing) goToFrame(s, st.frame);
}

export function togglePlay() {
  const s = activeSession();
  if (!s) return;
  if (usePlayback.getState().playing) stop(true);
  else void play(s);
}

// ---------------------------------------------------------------------------------------- export

export interface AnimationExportOptions {
  format: 'gif' | 'png-sequence';
  /** 0.1 .. 1 of the document size. */
  scale: number;
  /** Keep transparency (PNG always can; GIF uses one transparent palette entry). */
  transparent: boolean;
}

function exportName(s: DocumentSession) {
  return s.displayName.replace(/[\\/:*?"<>|]+/g, '_') || 'Animation';
}

export async function exportAnimation(
  s: DocumentSession,
  o: AnimationExportOptions,
  onProgress?: (p: number) => void,
) {
  const list = frames(s);
  const a = animationOf(s);
  if (!list.length) return;
  const w = Math.max(1, Math.round(s.doc.width * o.scale));
  const h = Math.max(1, Math.round(s.doc.height * o.scale));
  const withBackground = !o.transparent;
  if (o.format === 'png-sequence') {
    // one file per timeline tick, so exposures are kept when the sequence is played at the fps
    const files: { name: string; bytes: Uint8Array }[] = [];
    const tl = timeline(list, a);
    const total = tl.reduce((t, e) => t + e.length, 0);
    const digits = Math.max(4, String(total).length);
    for (let i = 0; i < list.length; i++) {
      const data = scaleRGBA(renderFrame(s, i, withBackground), s.doc.width, s.doc.height, w, h);
      const png = encodePng(w, h, data, { level: 6 });
      for (let k = 0; k < tl[i].length; k++)
        files.push({
          name: `${exportName(s)}_${String(tl[i].start + k + 1).padStart(digits, '0')}.png`,
          bytes: png,
        });
      onProgress?.((i + 1) / list.length);
      await tick();
    }
    const r = await forge.exportSequence({ suggestedFolderName: `${exportName(s)} frames`, files });
    if (r.ok) toast('success', `Exported ${files.length} PNG frames`, r.path);
    else if (!r.canceled) toast('error', 'Could not export the frames', r.error);
    return;
  }
  const gif = GIFEncoder();
  for (let i = 0; i < list.length; i++) {
    const data = scaleRGBA(renderFrame(s, i, withBackground), s.doc.width, s.doc.height, w, h);
    const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const palette = o.transparent
      ? quantize(rgba, 256, { format: 'rgba4444', oneBitAlpha: true })
      : quantize(rgba, 256);
    const index = applyPalette(rgba, palette, o.transparent ? 'rgba4444' : 'rgb565');
    const transparentIndex = o.transparent ? palette.findIndex((c) => c.length > 3 && c[3] === 0) : -1;
    gif.writeFrame(index, w, h, {
      palette,
      delay: Math.round((exposureOf(a, list[i]) * 1000) / a.fps),
      repeat: a.loop ? 0 : -1,
      transparent: transparentIndex >= 0,
      transparentIndex: Math.max(0, transparentIndex),
      dispose: o.transparent ? 2 : -1,
    });
    onProgress?.((i + 1) / list.length);
    await tick();
  }
  gif.finish();
  const r = await forge.exportImage({
    suggestedName: `${exportName(s)}.gif`,
    format: 'gif',
    bytes: gif.bytes(),
  });
  if (r.ok) toast('success', 'Exported animated GIF', r.path);
  else if (!r.canceled) toast('error', 'Could not export the GIF', r.error);
}

export { defaultAnimation };
