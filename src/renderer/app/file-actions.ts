// New / open / save / close / import / export, with confirmations and readable errors.
import type { OpenedFile } from '../../shared/ipc';
import { RasterDocument, type DocumentBackground } from '../engine/document';
import { deserializeDocument, serializeDocument, CforgeError } from '../engine/io/cforge';
import { addLayerWithPixels } from '../engine/layer-ops';
import { TileGrid } from '../engine/tiles';
import { createRasterLayer } from '../engine/layers';
import { forge } from '../platform';
import { activeSession, DocumentSession, useDocs } from '../state/documents';
import { confirmDialog, toast, useUi } from '../state/ui';
import { useBrushes } from '../state/brushes';
import { decodeImageBytes, encodeImage, resizeRGBA } from './image-codec';
import { usePrefs } from '../state/preferences';
import { Compositor } from '../engine/compositor';
import { validateBrush } from '../engine/brush/schema';

export const APP_VERSION = '0.1.0';

export interface NewDocumentOptions {
  width: number;
  height: number;
  dpi: number;
  background: DocumentBackground;
  title?: string;
}

let untitledCounter = 0;

export function newDocument(opts: NewDocumentOptions): DocumentSession {
  untitledCounter++;
  const title = opts.title ?? (untitledCounter === 1 ? 'Untitled' : `Untitled ${untitledCounter}`);
  const doc = RasterDocument.createDefault({
    width: opts.width,
    height: opts.height,
    dpi: opts.dpi,
    background: opts.background,
    title,
  });
  const s = new DocumentSession(doc, title);
  applyHistoryBudget(s);
  useDocs.getState().add(s);
  return s;
}

export function applyHistoryBudget(s: DocumentSession) {
  s.history.budgetBytes = usePrefs.getState().prefs.historyBudgetMB * 1024 * 1024;
}

/** Restores features stored with a document (assist settings etc.). */
function applyFeatures(s: DocumentSession, features: Record<string, unknown>) {
  s.features = features;
  const assist = features.assist as Partial<DocumentSession['assist']> | undefined;
  if (assist && typeof assist === 'object') {
    s.assist = { ...s.assist, ...assist } as DocumentSession['assist'];
  }
}

export async function openFile(file: OpenedFile): Promise<DocumentSession | null> {
  const existing = useDocs.getState().sessions.find((x) => x.filePath && x.filePath === file.path);
  if (existing) {
    useDocs.getState().setActive(existing.id);
    toast('info', `${existing.displayName} is already open.`);
    return existing;
  }
  if (/\.cforge$/i.test(file.name)) {
    try {
      const loaded = deserializeDocument(file.bytes);
      const s = new DocumentSession(loaded.doc, file.name);
      s.filePath = file.path;
      if (loaded.view) {
        s.view = { ...s.view, ...loaded.view };
        s.viewInitialized = true;
      }
      applyFeatures(s, loaded.features);
      s.resources = loaded.resources;
      // Make brushes stored in the document available if the library lacks them.
      const lib = useBrushes.getState();
      for (const b of loaded.brushes) if (!lib.get(b.id)) lib.add({ ...validateBrush(b), factory: false });
      applyHistoryBudget(s);
      useDocs.getState().add(s);
      if (loaded.warnings.length)
        toast('warning', `Opened with ${loaded.warnings.length} warning(s).`, loaded.warnings.join('\n'));
      return s;
    } catch (e) {
      toast(
        'error',
        `Could not open ${file.name}`,
        e instanceof CforgeError ? e.message : String((e as Error).message ?? e),
      );
      return null;
    }
  }
  // Image file → new document
  try {
    const img = await decodeImageBytes(file.bytes, file.name);
    const doc = new RasterDocument({
      width: img.width,
      height: img.height,
      dpi: img.dpi ?? 144,
      background: { transparent: true, color: { r: 1, g: 1, b: 1 } },
      title: file.name,
    });
    const grid = new TileGrid(doc.tileSize);
    grid.writeRect({ x: 0, y: 0, w: img.width, h: img.height }, img.data);
    const layer = createRasterLayer(file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Image', doc.tileSize);
    layer.pixels = grid;
    doc.layers = [layer];
    doc.activeLayerId = layer.id;
    const s = new DocumentSession(doc, file.name.replace(/\.[^.]+$/, ''));
    s.unsavedOrigin = true;
    applyHistoryBudget(s);
    useDocs.getState().add(s);
    return s;
  } catch (e) {
    toast('error', `Could not open ${file.name}`, (e as Error).message);
    return null;
  }
}

export async function openDocumentDialog(): Promise<void> {
  const r = await forge.openDocument();
  if (!r) return;
  if ('error' in r) {
    toast('error', 'Could not open the file', r.error);
    return;
  }
  await openFile(r);
}

export async function openRecent(path: string): Promise<void> {
  const r = await forge.openRecent(path);
  if ('error' in r) {
    toast('error', 'Could not open the recent file', r.error);
    return;
  }
  await openFile(r);
}

export function featuresFor(s: DocumentSession): Record<string, unknown> {
  return { ...s.features, assist: s.assist };
}

function brushesUsed(s: DocumentSession) {
  const lib = useBrushes.getState();
  return [...s.usedBrushIds].map((id) => lib.get(id)).filter((b): b is NonNullable<typeof b> => !!b);
}

export async function serializeSession(s: DocumentSession, skipPreviews = false): Promise<Uint8Array> {
  return serializeDocument(s.doc, {
    appVersion: APP_VERSION,
    view: s.view,
    brushes: brushesUsed(s),
    features: featuresFor(s),
    resources: s.resources,
    skipPreviews,
  });
}

let saving = false;

/** Saves the session. Returns true when saved. */
export async function saveSession(
  s: DocumentSession | null = activeSession(),
  saveAs = false,
): Promise<boolean> {
  if (!s) return false;
  if (saving) return false;
  saving = true;
  const stateAtSave = s.history.stateId;
  try {
    const bytes = await serializeSession(s);
    const r = await forge.saveDocument({
      path: s.filePath ?? undefined,
      suggestedName: `${s.displayName}.cforge`,
      bytes,
      saveAs: saveAs || !s.filePath,
    });
    if (!r.ok) {
      if (!r.canceled)
        toast('error', 'The document could not be saved. The previous file was left unchanged.', r.error);
      return false;
    }
    s.markSaved(r.path, r.name);
    // edits made while saving keep the document dirty
    s.savedStateId = stateAtSave;
    s.doc.title = s.displayName;
    void forge.recoveryDelete(s.recoveryId);
    useDocs.getState().bump();
    toast('success', `Saved ${r.name}`);
    return true;
  } catch (e) {
    toast('error', 'The document could not be saved.', (e as Error).message);
    return false;
  } finally {
    saving = false;
  }
}

/** Asks about unsaved changes. Returns false when the user cancels. */
export async function confirmDiscard(s: DocumentSession): Promise<boolean> {
  if (!s.dirty) return true;
  useDocs.getState().setActive(s.id);
  const choice = await confirmDialog({
    title: 'Save changes?',
    message: `"${s.displayName}" has unsaved changes. Do you want to save them before closing?`,
    buttons: [
      { id: 'save', label: 'Save', kind: 'primary' },
      { id: 'discard', label: "Don't save", kind: 'danger' },
      { id: 'cancel', label: 'Cancel' },
    ],
    cancelId: 'cancel',
  });
  if (choice === 'cancel') return false;
  if (choice === 'save') return saveSession(s);
  return true;
}

export async function closeSession(s: DocumentSession | null = activeSession()): Promise<boolean> {
  if (!s) return true;
  if (!(await confirmDiscard(s))) return false;
  void forge.recoveryDelete(s.recoveryId);
  useDocs.getState().remove(s.id);
  return true;
}

export async function closeAllAndQuit(): Promise<void> {
  for (const s of [...useDocs.getState().sessions]) {
    if (!(await confirmDiscard(s))) return;
  }
  for (const s of useDocs.getState().sessions)
    await forge.recoveryDelete(s.recoveryId).catch(() => undefined);
  forge.confirmClose();
}

// ------------------------------------------------------------------------------------- import

export async function placeImageBytes(s: DocumentSession, bytes: Uint8Array, name: string): Promise<void> {
  let img;
  try {
    img = await decodeImageBytes(bytes, name);
  } catch (e) {
    toast('error', `Could not import ${name}`, (e as Error).message);
    return;
  }
  const doc = s.doc;
  let { width, height, data } = img;
  if (width > doc.width || height > doc.height) {
    const choice = await confirmDialog({
      title: 'Image is larger than the canvas',
      message: `${name} is ${width}×${height} px; the canvas is ${doc.width}×${doc.height} px. Scale it to fit, or place it at full size (parts outside the canvas are cropped)?`,
      buttons: [
        { id: 'fit', label: 'Scale to fit', kind: 'primary' },
        { id: 'full', label: 'Full size' },
        { id: 'cancel', label: 'Cancel' },
      ],
      cancelId: 'cancel',
    });
    if (choice === 'cancel') return;
    if (choice === 'fit') {
      const k = Math.min(doc.width / width, doc.height / height);
      const nw = Math.max(1, Math.round(width * k));
      const nh = Math.max(1, Math.round(height * k));
      data = resizeRGBA(data, width, height, nw, nh);
      width = nw;
      height = nh;
    }
  }
  const x0 = Math.round((doc.width - width) / 2);
  const y0 = Math.round((doc.height - height) / 2);
  const grid = new TileGrid(doc.tileSize);
  // crop to the canvas
  const cx0 = Math.max(0, x0);
  const cy0 = Math.max(0, y0);
  const cx1 = Math.min(doc.width, x0 + width);
  const cy1 = Math.min(doc.height, y0 + height);
  const cw = cx1 - cx0;
  const ch = cy1 - cy0;
  if (cw <= 0 || ch <= 0) return;
  const cropped = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const src = ((cy0 - y0 + y) * width + (cx0 - x0)) * 4;
    cropped.set(data.subarray(src, src + cw * 4), y * cw * 4);
  }
  grid.writeRect({ x: cx0, y: cy0, w: cw, h: ch }, cropped);
  const { entry } = addLayerWithPixels(doc, name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Image', grid);
  s.history.push(entry);
  toast('success', `Placed ${name} as a new layer.`);
}

export async function importImageDialog(): Promise<void> {
  const s = activeSession();
  if (!s) return;
  const r = await forge.importImage();
  if (!r) return;
  if ('error' in r) {
    toast('error', 'Could not import the image', r.error);
    return;
  }
  await placeImageBytes(s, r.bytes, r.name);
}

// ------------------------------------------------------------------------------------- export

export interface ExportOptions {
  format: 'png' | 'jpeg' | 'webp';
  quality: number;
  scale: number;
  transparent: boolean;
}

export function expandNameTemplate(template: string, s: DocumentSession, w: number, h: number): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const out = (template || '{name}')
    .replace(/\{name\}/g, s.displayName)
    .replace(/\{date\}/g, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
    .replace(/\{time\}/g, `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`)
    .replace(/\{w\}/g, String(w))
    .replace(/\{h\}/g, String(h));
  return out.replace(/[<>:"/\\|?*]/g, '_').trim() || s.displayName;
}

export async function exportImage(s: DocumentSession, opts: ExportOptions): Promise<boolean> {
  const doc = s.doc;
  const comp = new Compositor(doc);
  const skipBackground = opts.transparent && opts.format !== 'jpeg';
  let data = comp.compositeToRGBA(doc.bounds, { skipBackground });
  let w = doc.width;
  let h = doc.height;
  if (opts.scale !== 1) {
    const nw = Math.max(1, Math.round(w * opts.scale));
    const nh = Math.max(1, Math.round(h * opts.scale));
    data = resizeRGBA(data, w, h, nw, nh);
    w = nw;
    h = nh;
  }
  try {
    const bytes = await encodeImage(
      w,
      h,
      data,
      opts.format,
      opts.quality,
      doc.dpi,
      doc.background.transparent ? { r: 1, g: 1, b: 1 } : doc.background.color,
    );
    const name = expandNameTemplate(usePrefs.getState().prefs.exportNameTemplate, s, w, h);
    const r = await forge.exportImage({ suggestedName: name, format: opts.format, bytes });
    if (!r.ok) {
      if (!r.canceled) toast('error', 'Export failed', r.error);
      return false;
    }
    toast('success', `Exported ${r.name}`);
    return true;
  } catch (e) {
    toast('error', 'Export failed', (e as Error).message);
    return false;
  }
}

export function openNewDocumentDialog() {
  useUi.getState().openDialog('new-document');
}
