// Android (Capacitor) overrides of the platform API. There are no native save dialogs in the
// WebView, so documents and exports go to a fixed folder in the shared Documents directory, where
// other apps (Files, Drive, gallery pickers) can reach them. Recovery snapshots stay in app storage.
import { Directory, Encoding, Filesystem, type FileInfo } from '@capacitor/filesystem';
import type {
  ForgeApi,
  OpenedFile,
  RecentEntry,
  RecoveryEntry,
  RecoveryMeta,
  SaveResult,
} from '../shared/ipc';

const ROOT = 'Canvas Forge';
const EXPORTS = `${ROOT}/Exports`;
const RECOVERY = 'recovery';

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(data: string): Uint8Array {
  const s = atob(data);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** File names may not carry folders or characters the shared storage rejects. */
function safeName(name: string): string {
  const cleaned = [...name].map((c) => (c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? '_' : c)).join('');
  return cleaned.trim() || 'Untitled';
}

let permissionAsked = false;
/** Android 10 and older need the storage permission for the shared Documents folder. */
async function ensurePermission(): Promise<void> {
  if (permissionAsked) return;
  permissionAsked = true;
  try {
    const p = await Filesystem.checkPermissions();
    if (p.publicStorage !== 'granted') await Filesystem.requestPermissions();
  } catch {
    // not needed on this Android version
  }
}

/**
 * The entries of a folder, or [] when it does not exist yet. Each level is found by listing its parent:
 * Capacitor logs every failed native call as a console error even when the rejection is handled, so
 * missing paths are never probed directly.
 */
async function filesIn(path: string, directory: Directory): Promise<FileInfo[]> {
  let current = '';
  try {
    for (const part of path.split('/')) {
      const r = await Filesystem.readdir({ path: current, directory });
      if (!r.files.some((f) => f.type === 'directory' && f.name === part)) return [];
      current = current ? `${current}/${part}` : part;
    }
    return (await Filesystem.readdir({ path: current, directory })).files;
  } catch {
    return [];
  }
}

/** "name.ext", or "name (2).ext" … when the file already exists. */
async function freePath(folder: string, name: string): Promise<string> {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const taken = new Set((await filesIn(folder, Directory.Documents)).map((f) => f.name));
  for (let n = 1; ; n++) {
    const candidate = `${n === 1 ? base : `${base} (${n})`}${ext}`;
    if (!taken.has(candidate)) return `${folder}/${candidate}`;
  }
}

async function write(path: string, bytes: Uint8Array): Promise<SaveResult> {
  try {
    await ensurePermission();
    await Filesystem.writeFile({
      path,
      data: toBase64(bytes),
      directory: Directory.Documents,
      recursive: true,
    });
    return { ok: true, path, name: path.slice(path.lastIndexOf('/') + 1) };
  } catch (e) {
    return { ok: false, canceled: false, error: (e as Error).message };
  }
}

async function readDocument(path: string): Promise<OpenedFile | { error: string }> {
  if (!path.startsWith(`${ROOT}/`) || path.includes('..'))
    return { error: 'This file is not in the Canvas Forge folder.' };
  try {
    const r = await Filesystem.readFile({ path, directory: Directory.Documents });
    const bytes =
      typeof r.data === 'string' ? fromBase64(r.data) : new Uint8Array(await r.data.arrayBuffer());
    return { path, name: path.slice(path.lastIndexOf('/') + 1), bytes };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** The parts of the platform API that differ from the browser fallback (file pickers, storage, clipboard). */
export function createAndroidPlatform(version: string): Partial<ForgeApi> {
  return {
    appInfo: async () => ({
      version,
      platform: 'android',
      electron: '-',
      chrome: navigator.userAgent,
      node: '-',
      userDataPath: `Documents/${ROOT}`,
    }),
    // Files opened through the system picker cannot be written back; saving them asks for a name.
    openRecent: (path) => readDocument(path),
    saveDocument: async (req) => {
      if (!req.saveAs && req.path?.startsWith(`${ROOT}/`)) return write(req.path, req.bytes);
      const suggested = req.suggestedName.replace(/\.cforge$/i, '');
      const answer = window.prompt(`Save in Documents/${ROOT} as`, suggested);
      if (answer === null) return { ok: false, canceled: true };
      return write(await freePath(ROOT, `${safeName(answer)}.cforge`), req.bytes);
    },
    exportImage: async (req) =>
      write(
        await freePath(
          EXPORTS,
          `${safeName(req.suggestedName)}.${req.format === 'jpeg' ? 'jpg' : req.format}`,
        ),
        req.bytes,
      ),
    exportSequence: async (req) => {
      const folder = (await freePath(EXPORTS, safeName(req.suggestedFolderName))).replace(/\/$/, '');
      for (const f of req.files) {
        const r = await write(`${folder}/${safeName(f.name)}`, f.bytes);
        if (!r.ok) return r;
      }
      return { ok: true, path: folder, name: folder.slice(folder.lastIndexOf('/') + 1) };
    },
    exportBrushPack: async (name, bytes) =>
      write(await freePath(EXPORTS, `${safeName(name)}.cforge-brushpack`), bytes),
    // The documents in the Canvas Forge folder, newest first.
    listRecent: async () =>
      (await filesIn(ROOT, Directory.Documents))
        .filter((f) => f.type === 'file' && f.name.toLowerCase().endsWith('.cforge'))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 30)
        .map<RecentEntry>((f) => ({
          path: `${ROOT}/${f.name}`,
          name: f.name,
          openedAt: f.mtime,
          exists: true,
        })),
    clearRecent: async () => undefined,
    recoveryWrite: async (meta: RecoveryMeta, bytes) => {
      try {
        const entry: RecoveryEntry = { ...meta, sizeBytes: bytes.length };
        await Filesystem.writeFile({
          path: `${RECOVERY}/${meta.id}.cforge`,
          data: toBase64(bytes),
          directory: Directory.Data,
          recursive: true,
        });
        await Filesystem.writeFile({
          path: `${RECOVERY}/${meta.id}.json`,
          data: JSON.stringify(entry),
          encoding: Encoding.UTF8,
          directory: Directory.Data,
          recursive: true,
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    recoveryList: async () => {
      try {
        const out: RecoveryEntry[] = [];
        for (const f of (await filesIn(RECOVERY, Directory.Data)).filter((x) => x.name.endsWith('.json'))) {
          const m = await Filesystem.readFile({
            path: `${RECOVERY}/${f.name}`,
            directory: Directory.Data,
            encoding: Encoding.UTF8,
          });
          if (typeof m.data === 'string') out.push(JSON.parse(m.data) as RecoveryEntry);
        }
        return out;
      } catch {
        return [];
      }
    },
    recoveryRead: async (id) => {
      try {
        const r = await Filesystem.readFile({
          path: `${RECOVERY}/${safeName(id)}.cforge`,
          directory: Directory.Data,
        });
        return typeof r.data === 'string' ? fromBase64(r.data) : new Uint8Array(await r.data.arrayBuffer());
      } catch {
        return null;
      }
    },
    recoveryDelete: async (id) => {
      const present = new Set((await filesIn(RECOVERY, Directory.Data)).map((f) => f.name));
      for (const ext of ['cforge', 'json']) {
        const name = `${safeName(id)}.${ext}`;
        if (present.has(name))
          await Filesystem.deleteFile({ path: `${RECOVERY}/${name}`, directory: Directory.Data }).catch(
            () => undefined,
          );
      }
    },
    confirmClose: () => undefined,
  };
}
