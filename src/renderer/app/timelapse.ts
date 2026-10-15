// Time-lapse: while recording, a small WebP snapshot of the canvas is kept after edits (throttled,
// taken from the already composited view, so drawing is not slowed down). Frames are stored in the
// document as `resources/timelapse/NNNNNN.webp`.
import { create } from 'zustand';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import type { CanvasRenderer } from '../render/canvas-renderer';
import { activeSession, useDocs, type DocumentSession } from '../state/documents';
import { toast } from '../state/ui';
import { forge } from '../platform';
import { encodePng } from '../engine/io/png';

const PREFIX = 'timelapse/';
export const TIMELAPSE_MAX_SIDE = 720;
/** Above this many frames every second frame is dropped (the whole session stays covered). */
export const TIMELAPSE_MAX_FRAMES = 1800;
const MIN_INTERVAL_MS = 1200;
const SETTLE_MS = 450;

interface TimelapseSettings {
  recording: boolean;
  /** Minimum time between captures; doubles whenever frames are thinned out. */
  interval: number;
}

export const useTimelapse = create<{ rev: number }>(() => ({ rev: 0 }));
const bump = () => useTimelapse.setState({ rev: useTimelapse.getState().rev + 1 });

export function timelapseSettings(s: DocumentSession): TimelapseSettings {
  const raw = s.features.timelapse as Partial<TimelapseSettings> | undefined;
  return {
    recording: raw?.recording === true,
    interval:
      typeof raw?.interval === 'number' && Number.isFinite(raw.interval)
        ? Math.min(60_000, Math.max(MIN_INTERVAL_MS, raw.interval))
        : MIN_INTERVAL_MS,
  };
}

function storeSettings(s: DocumentSession, t: TimelapseSettings) {
  s.features = { ...s.features, timelapse: t };
}

/** Frame resource names in recording order. */
export function timelapseFrames(s: DocumentSession): string[] {
  return Object.keys(s.resources)
    .filter((k) => k.startsWith(PREFIX) && k.endsWith('.webp'))
    .sort();
}

let renderer: CanvasRenderer | null = null;
export function attachTimelapseRenderer(r: CanvasRenderer | null) {
  renderer = r;
}

const watched = new WeakMap<DocumentSession, () => void>();
const lastCapture = new WeakMap<DocumentSession, number>();
const pending = new WeakMap<DocumentSession, ReturnType<typeof setTimeout>>();

function nextName(s: DocumentSession): string {
  const list = timelapseFrames(s);
  const last = list.length ? Number(list[list.length - 1].slice(PREFIX.length, -5)) : 0;
  return `${PREFIX}${String(last + 1).padStart(6, '0')}.webp`;
}

async function capture(s: DocumentSession, attempt = 0): Promise<void> {
  if (!timelapseSettings(s).recording || activeSession() !== s || !renderer) return;
  const snap = renderer.snapshot(s, TIMELAPSE_MAX_SIDE);
  if (!snap) {
    // the view is still compositing; try again shortly
    if (attempt < 20) schedule(s, 150, attempt + 1);
    return;
  }
  const blob = await new Promise<Blob | null>((r) => snap.toBlob(r, 'image/webp', 0.82));
  if (!blob) return;
  s.resources[nextName(s)] = new Uint8Array(await blob.arrayBuffer());
  lastCapture.set(s, Date.now());
  thinOut(s);
  bump();
}

function thinOut(s: DocumentSession) {
  const list = timelapseFrames(s);
  if (list.length <= TIMELAPSE_MAX_FRAMES) return;
  // drop every second frame and record half as often from now on
  list.forEach((name, i) => {
    if (i % 2 === 1) delete s.resources[name];
  });
  const t = timelapseSettings(s);
  storeSettings(s, { ...t, interval: Math.min(60_000, t.interval * 2) });
}

function schedule(s: DocumentSession, delay: number, attempt = 0) {
  const old = pending.get(s);
  if (old) clearTimeout(old);
  pending.set(
    s,
    setTimeout(() => {
      pending.delete(s);
      void capture(s, attempt);
    }, delay),
  );
}

/** Called for every history change of the session: captures after edits settle. */
function onEdit(s: DocumentSession) {
  const t = timelapseSettings(s);
  if (!t.recording) return;
  const since = Date.now() - (lastCapture.get(s) ?? 0);
  schedule(s, Math.max(SETTLE_MS, t.interval - since));
}

/** Makes sure a session's edits are observed (idempotent). */
export function watchTimelapse(s: DocumentSession) {
  if (watched.has(s)) return;
  watched.set(
    s,
    s.history.onChange(() => onEdit(s)),
  );
}

// observe every open document (sessions loaded from a file may already be recording)
useDocs.subscribe((st) => {
  for (const s of st.sessions) watchTimelapse(s);
});

export function setRecording(s: DocumentSession, on: boolean) {
  watchTimelapse(s);
  storeSettings(s, { ...timelapseSettings(s), recording: on });
  // settings live in the document; treat the change like an edit that needs saving
  s.unsavedOrigin = true;
  useDocs.getState().bump();
  bump();
  if (on) {
    toast('info', 'Recording a time-lapse of this document. Snapshots are saved with the document.');
    schedule(s, 50);
  }
}

export function toggleRecording() {
  const s = activeSession();
  if (s) setRecording(s, !timelapseSettings(s).recording);
}

export function clearTimelapse(s: DocumentSession) {
  for (const name of timelapseFrames(s)) delete s.resources[name];
  storeSettings(s, { ...timelapseSettings(s), interval: MIN_INTERVAL_MS });
  s.unsavedOrigin = true;
  useDocs.getState().bump();
  bump();
}

export async function decodeFrame(bytes: Uint8Array): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/webp' }));
}

function frameRGBA(bmp: ImageBitmap, w: number, h: number): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}

export interface TimelapseExportOptions {
  format: 'gif' | 'png-sequence';
  /** Frames per second of the result. */
  fps: number;
  /** Long side of the result in pixels (≤ the recorded size). */
  maxSide: number;
}

export async function exportTimelapse(
  s: DocumentSession,
  o: TimelapseExportOptions,
  onProgress?: (p: number) => void,
) {
  const names = timelapseFrames(s);
  if (!names.length) return toast('info', 'This document has no time-lapse frames yet.');
  const first = await decodeFrame(s.resources[names[0]]);
  const k = Math.min(1, o.maxSide / Math.max(first.width, first.height));
  const w = Math.max(1, Math.round(first.width * k));
  const h = Math.max(1, Math.round(first.height * k));
  first.close();
  const base = s.displayName.replace(/[\\/:*?"<>|]+/g, '_') || 'Time-lapse';
  if (o.format === 'png-sequence') {
    const files: { name: string; bytes: Uint8Array }[] = [];
    for (let i = 0; i < names.length; i++) {
      const bmp = await decodeFrame(s.resources[names[i]]);
      files.push({
        name: `${base}_timelapse_${String(i + 1).padStart(5, '0')}.png`,
        bytes: encodePng(w, h, frameRGBA(bmp, w, h), { level: 6 }),
      });
      bmp.close();
      onProgress?.((i + 1) / names.length);
    }
    const r = await forge.exportSequence({ suggestedFolderName: `${base} time-lapse`, files });
    if (r.ok) toast('success', `Exported ${files.length} time-lapse frames`, r.path);
    else if (!r.canceled) toast('error', 'Could not export the time-lapse', r.error);
    return;
  }
  const gif = GIFEncoder();
  const delay = Math.round(1000 / o.fps);
  for (let i = 0; i < names.length; i++) {
    const bmp = await decodeFrame(s.resources[names[i]]);
    const data = frameRGBA(bmp, w, h);
    bmp.close();
    const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const palette = quantize(rgba, 256);
    // hold the finished picture a little longer at the end
    gif.writeFrame(applyPalette(rgba, palette), w, h, {
      palette,
      delay: i === names.length - 1 ? 2000 : delay,
      repeat: 0,
    });
    onProgress?.((i + 1) / names.length);
    if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0));
  }
  gif.finish();
  const r = await forge.exportImage({
    suggestedName: `${base} time-lapse.gif`,
    format: 'gif',
    bytes: gif.bytes(),
  });
  if (r.ok) toast('success', 'Exported the time-lapse as GIF', r.path);
  else if (!r.canceled) toast('error', 'Could not export the time-lapse', r.error);
}
