// Reference images kept with a document: bytes in `resources/references/*`, metadata in
// `features.references`. Adding or removing one is an undoable document change; the artwork's
// pixels are never touched.
import { decodeImageBytes } from './image-codec';
import { activeSession, useDocs, type DocumentSession } from '../state/documents';
import { toast, useUi } from '../state/ui';
import { uid } from '../engine/random';
import { forge } from '../platform';

export interface ReferenceMeta {
  id: string;
  name: string;
  file: string;
  width: number;
  height: number;
}

export const MAX_REFERENCES = 12;
export const MAX_REFERENCE_BYTES = 64 * 1024 * 1024;

export function referencesOf(s: DocumentSession): ReferenceMeta[] {
  const raw = s.features.references;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is ReferenceMeta =>
      !!r &&
      typeof r === 'object' &&
      typeof (r as ReferenceMeta).id === 'string' &&
      typeof (r as ReferenceMeta).name === 'string' &&
      typeof (r as ReferenceMeta).file === 'string' &&
      s.resources[(r as ReferenceMeta).file] instanceof Uint8Array,
  );
}

function imageExtension(b: Uint8Array): 'png' | 'jpg' | 'webp' | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (
    b.length > 12 &&
    String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF' &&
    String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WEBP'
  )
    return 'webp';
  return null;
}

export interface DecodedReference {
  canvas: HTMLCanvasElement;
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const decoded = new WeakMap<Uint8Array, Promise<DecodedReference>>();

/** Decodes (once per byte array) into straight RGBA plus a canvas for drawing. */
export function decodeReference(bytes: Uint8Array, name: string): Promise<DecodedReference> {
  let p = decoded.get(bytes);
  if (!p) {
    p = decodeImageBytes(bytes, name).then((img) => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const data = new Uint8ClampedArray(img.data);
      canvas
        .getContext('2d')!
        .putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
      return { canvas, data, width: img.width, height: img.height };
    });
    decoded.set(bytes, p);
  }
  return p;
}

function setRefs(s: DocumentSession, list: ReferenceMeta[]) {
  s.features = { ...s.features, references: list };
  useDocs.getState().bump();
}

/** Adds an image as a reference of the document. Returns the new id, or null if it was rejected. */
export async function addReference(
  s: DocumentSession,
  bytes: Uint8Array,
  name: string,
): Promise<string | null> {
  const list = referencesOf(s);
  if (list.length >= MAX_REFERENCES) {
    toast('warning', `A document can hold up to ${MAX_REFERENCES} reference images.`);
    return null;
  }
  if (bytes.length > MAX_REFERENCE_BYTES) {
    toast('warning', `${name} is larger than ${MAX_REFERENCE_BYTES / 1024 / 1024} MB.`);
    return null;
  }
  const ext = imageExtension(bytes);
  if (!ext) {
    toast('error', `${name} is not a PNG, JPEG or WebP image.`);
    return null;
  }
  let img: DecodedReference;
  try {
    img = await decodeReference(bytes, name);
  } catch (e) {
    toast('error', `Could not read ${name}`, (e as Error).message);
    return null;
  }
  const id = uid('ref')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
  const meta: ReferenceMeta = {
    id,
    name: name.slice(0, 120) || 'Reference',
    file: `references/${id}.${ext}`,
    width: img.width,
    height: img.height,
  };
  const apply = () => {
    s.resources[meta.file] = bytes;
    setRefs(s, [...referencesOf(s), meta]);
  };
  const revert = () => {
    setRefs(
      s,
      referencesOf(s).filter((r) => r.id !== id),
    );
    delete s.resources[meta.file];
  };
  apply();
  s.history.push({ label: 'Add reference image', bytes: bytes.length, undo: revert, redo: apply });
  return id;
}

export function removeReference(s: DocumentSession, id: string): void {
  const before = referencesOf(s);
  const meta = before.find((r) => r.id === id);
  if (!meta) return;
  const bytes = s.resources[meta.file];
  const apply = () => {
    setRefs(
      s,
      referencesOf(s).filter((r) => r.id !== id),
    );
    delete s.resources[meta.file];
  };
  const revert = () => {
    s.resources[meta.file] = bytes;
    const now = referencesOf(s);
    const index = Math.min(before.indexOf(meta), now.length);
    setRefs(s, [...now.slice(0, index), meta, ...now.slice(index)]);
  };
  apply();
  s.history.push({ label: 'Remove reference image', bytes: bytes.length, undo: revert, redo: apply });
}

function showPanel() {
  useUi.getState().togglePanel('reference', true);
}

export async function addReferenceFromDialog(): Promise<void> {
  const s = activeSession();
  if (!s) return;
  const r = await forge.importImage();
  if (!r) return;
  if ('error' in r) return toast('error', 'Could not open the image', r.error);
  showPanel();
  await addReference(s, r.bytes, r.name);
}

export async function addReferenceFromClipboard(): Promise<void> {
  const s = activeSession();
  if (!s) return;
  const png = await forge.clipboardReadImage().catch(() => null);
  if (!png) return toast('info', 'The clipboard has no image.');
  showPanel();
  await addReference(s, png, 'Clipboard image.png');
}
