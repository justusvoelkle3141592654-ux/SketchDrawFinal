// Access to the preload API. A browser fallback keeps the renderer usable (and testable) without Electron.
import type { AppDataKind, ForgeApi, OpenedFile, RecoveryEntry, SaveResult } from '../shared/ipc';

function pickFile(accept: string): Promise<OpenedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      resolve({ path: f.name, name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    };
    input.click();
  });
}

function download(name: string, bytes: Uint8Array): SaveResult {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { ok: true, path: name, name };
}

const memoryRecovery = new Map<string, { entry: RecoveryEntry; bytes: Uint8Array }>();

const browserFallback: ForgeApi = {
  appInfo: async () => ({
    version: 'web',
    platform: 'browser',
    electron: '-',
    chrome: navigator.userAgent,
    node: '-',
    userDataPath: '(browser storage)',
  }),
  openDocument: () => pickFile('.cforge,.png,.jpg,.jpeg,.webp'),
  openRecent: async () => ({ error: 'Recent files are only available in the desktop app.' }),
  importImage: () => pickFile('.png,.jpg,.jpeg,.webp'),
  saveDocument: async (req) =>
    download(
      req.suggestedName.endsWith('.cforge') ? req.suggestedName : `${req.suggestedName}.cforge`,
      req.bytes,
    ),
  exportImage: async (req) =>
    download(`${req.suggestedName}.${req.format === 'jpeg' ? 'jpg' : req.format}`, req.bytes),
  exportSequence: async (req) => {
    for (const f of req.files) download(f.name, f.bytes);
    return { ok: true, path: req.suggestedFolderName, name: req.suggestedFolderName };
  },
  importBrushPack: () => pickFile('.cforge-brushpack'),
  exportBrushPack: async (name, bytes) => download(`${name}.cforge-brushpack`, bytes),
  importPalette: () => pickFile('.gpl,.json'),
  getPathForFile: () => '',
  grantDroppedPath: async () => false,
  listRecent: async () => [],
  clearRecent: async () => undefined,
  loadAppData: async (kind: AppDataKind) => {
    try {
      const v = localStorage.getItem(`cforge.${kind}`);
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  },
  saveAppData: async (kind: AppDataKind, data: unknown) => {
    try {
      localStorage.setItem(`cforge.${kind}`, JSON.stringify(data));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  },
  recoveryWrite: async (meta, bytes) => {
    memoryRecovery.set(meta.id, { entry: { ...meta, sizeBytes: bytes.length }, bytes });
    return { ok: true };
  },
  recoveryList: async () => [...memoryRecovery.values()].map((v) => v.entry),
  recoveryRead: async (id) => memoryRecovery.get(id)?.bytes ?? null,
  recoveryDelete: async (id) => {
    memoryRecovery.delete(id);
  },
  clipboardReadImage: async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const t = it.types.find((x) => x.startsWith('image/'));
        if (t) return new Uint8Array(await (await it.getType(t)).arrayBuffer());
      }
    } catch {
      // clipboard permission denied
    }
    return null;
  },
  clipboardWriteImage: async (png) => {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': new Blob([png as BlobPart], { type: 'image/png' }) }),
      ]);
    } catch {
      // ignore
    }
  },
  confirmClose: () => window.close(),
  toggleFullScreen: async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
    return !!document.fullscreenElement;
  },
  setTitle: (t) => {
    document.title = t;
  },
  setTitleBarOverlay: () => undefined,
  onCloseRequested: () => () => undefined,
  onOpenPath: () => () => undefined,
  onFullScreenChanged: (cb) => {
    const h = () => cb(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  },
};

export const forge: ForgeApi = window.forge ?? browserFallback;
export const isDesktop = !!window.forge;
export const isMac = /Mac/.test(navigator.platform);
