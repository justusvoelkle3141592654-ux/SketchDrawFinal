// IPC handlers. Every argument coming from the renderer is validated here.
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage } from 'electron';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join } from 'node:path';
import {
  APP_DATA_KINDS,
  BRUSHPACK_EXTENSION,
  DOCUMENT_EXTENSION,
  IPC,
  type AppDataKind,
  type ExportImageRequest,
  type ExportSequenceRequest,
  type OpenedFile,
  type RecoveryMeta,
  type SaveDocumentRequest,
  type SaveResult,
} from '../shared/ipc';
import { validateCforgeBytes } from '../shared/cforge-validate';
import { atomicWrite, describeFsError, fileExists } from './files';
import * as data from './appdata';
import { isDocumentPath, PathGrants } from './ipc-guard';

const MAX_READ_BYTES = 1536 * 1024 * 1024;
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp'];

/** Paths the renderer may write to: chosen in a native dialog, listed in recents, or dropped by the user. */
const grants = new PathGrants();
const grant = (p: string) => grants.grant(p);
const isGranted = (p: string) => grants.has(p);

/** Decides whether an IPC message comes from the app's own page in the main window. */
export type SenderCheck = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => boolean;

function isBytes(v: unknown): v is Uint8Array {
  return v instanceof Uint8Array;
}
function isShortString(v: unknown, max = 260): v is string {
  return typeof v === 'string' && v.length <= max;
}
function safeFileName(name: string, fallback: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*]/g, '_').trim();
  return cleaned.length ? cleaned.slice(0, 120) : fallback;
}
function windowOf(e: Electron.IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(e.sender) ?? undefined;
}

export async function readDocumentFile(path: string): Promise<OpenedFile | { error: string }> {
  try {
    const s = await stat(path);
    if (!s.isFile()) return { error: 'The selected item is not a file.' };
    if (s.size > MAX_READ_BYTES) return { error: 'The file is too large to open.' };
    const bytes = new Uint8Array(await readFile(path));
    grant(path);
    if (extname(path).toLowerCase() === `.${DOCUMENT_EXTENSION}`)
      await data.pushRecent(path).catch(() => undefined);
    return { path, name: basename(path), bytes };
  } catch (e) {
    return { error: describeFsError(e) };
  }
}

async function showOpen(
  win: BrowserWindow | undefined,
  title: string,
  filters: Electron.FileFilter[],
): Promise<string | null> {
  const opts: Electron.OpenDialogOptions = { title, filters, properties: ['openFile'] };
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
}

async function showSave(
  win: BrowserWindow | undefined,
  title: string,
  defaultName: string,
  filters: Electron.FileFilter[],
): Promise<string | null> {
  const opts: Electron.SaveDialogOptions = {
    title,
    defaultPath: join(app.getPath('documents'), defaultName),
    filters,
    properties: ['showOverwriteConfirmation', 'createDirectory'],
  };
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (r.canceled || !r.filePath) return null;
  return r.filePath;
}

function ensureExt(path: string, ext: string, alternatives: string[] = []): string {
  const current = extname(path).toLowerCase().slice(1);
  if (current === ext || alternatives.includes(current)) return path;
  return `${path}.${ext}`;
}

export function registerIpc(isTrusted: SenderCheck): void {
  // Every channel goes through these wrappers, so no other window, frame or page reaches a
  // handler: an untrusted invoke() is rejected, an untrusted send() is dropped.
  const handle = (channel: string, listener: Parameters<typeof ipcMain.handle>[1]) =>
    ipcMain.handle(channel, (e, ...args) => {
      if (!isTrusted(e)) throw new Error('IPC call rejected: untrusted sender.');
      return listener(e, ...args);
    });
  const on = (channel: string, listener: Parameters<typeof ipcMain.on>[1]) =>
    ipcMain.on(channel, (e, ...args) => {
      if (isTrusted(e)) listener(e, ...args);
    });

  handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    userDataPath: app.getPath('userData'),
  }));

  handle(IPC.openDocument, async (e) => {
    const path = await showOpen(windowOf(e), 'Open', [
      { name: 'Canvas Forge document or image', extensions: [DOCUMENT_EXTENSION, ...IMAGE_EXTS] },
      { name: 'Canvas Forge document', extensions: [DOCUMENT_EXTENSION] },
      { name: 'Images', extensions: IMAGE_EXTS },
    ]);
    if (!path) return null;
    return readDocumentFile(path);
  });

  handle(IPC.openRecent, async (_e, path: unknown) => {
    if (!isShortString(path, 4096) || !isAbsolute(path)) return { error: 'Invalid path.' };
    if (!(await data.isRecent(path)) && !isGranted(path))
      return { error: 'This file is not in the recent list.' };
    if (!(await fileExists(path)))
      return { error: 'The file no longer exists. It may have been moved or deleted.' };
    return readDocumentFile(path);
  });

  handle(IPC.importImage, async (e) => {
    const path = await showOpen(windowOf(e), 'Import image as layer', [
      { name: 'Images', extensions: IMAGE_EXTS },
    ]);
    if (!path) return null;
    return readDocumentFile(path);
  });

  handle(IPC.saveDocument, async (e, req: SaveDocumentRequest): Promise<SaveResult> => {
    if (!req || !isBytes(req.bytes) || !isShortString(req.suggestedName) || typeof req.saveAs !== 'boolean') {
      return { ok: false, canceled: false, error: 'Invalid save request.' };
    }
    let target: string;
    // without a dialog only over a granted .cforge, never over an image or palette opened earlier
    if (!req.saveAs && isDocumentPath(req.path) && isGranted(req.path)) {
      target = req.path;
    } else {
      const chosen = await showSave(
        windowOf(e),
        'Save document',
        safeFileName(req.suggestedName, 'Untitled'),
        [{ name: 'Canvas Forge document', extensions: [DOCUMENT_EXTENSION] }],
      );
      if (!chosen) return { ok: false, canceled: true };
      target = ensureExt(chosen, DOCUMENT_EXTENSION);
    }
    try {
      await atomicWrite(target, req.bytes, (written) => {
        const v = validateCforgeBytes(written);
        return v.ok ? null : v.error;
      });
      grant(target);
      await data.pushRecent(target).catch(() => undefined);
      return { ok: true, path: target, name: basename(target) };
    } catch (err) {
      return { ok: false, canceled: false, error: describeFsError(err) };
    }
  });

  handle(IPC.exportImage, async (e, req: ExportImageRequest): Promise<SaveResult> => {
    const formats: Record<string, Electron.FileFilter> = {
      png: { name: 'PNG image', extensions: ['png'] },
      jpeg: { name: 'JPEG image', extensions: ['jpg', 'jpeg'] },
      webp: { name: 'WebP image', extensions: ['webp'] },
      gif: { name: 'Animated GIF', extensions: ['gif'] },
    };
    if (!req || !isBytes(req.bytes) || !isShortString(req.suggestedName) || !(req.format in formats)) {
      return { ok: false, canceled: false, error: 'Invalid export request.' };
    }
    const filter = formats[req.format];
    const chosen = await showSave(windowOf(e), 'Export image', safeFileName(req.suggestedName, 'Untitled'), [
      filter,
    ]);
    if (!chosen) return { ok: false, canceled: true };
    const target = ensureExt(chosen, filter.extensions[0], filter.extensions);
    try {
      await atomicWrite(target, req.bytes);
      return { ok: true, path: target, name: basename(target) };
    } catch (err) {
      return { ok: false, canceled: false, error: describeFsError(err) };
    }
  });

  handle(IPC.exportSequence, async (e, req: ExportSequenceRequest): Promise<SaveResult> => {
    if (
      !req ||
      !Array.isArray(req.files) ||
      req.files.length === 0 ||
      req.files.length > 10000 ||
      !req.files.every((f) => f && isShortString(f.name, 120) && isBytes(f.bytes))
    ) {
      return { ok: false, canceled: false, error: 'Invalid export request.' };
    }
    const win = windowOf(e);
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose a folder for the image sequence',
      properties: ['openDirectory', 'createDirectory'],
    };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    const folder = join(r.filePaths[0], safeFileName(String(req.suggestedFolderName ?? ''), 'sequence'));
    try {
      await mkdir(folder, { recursive: true });
      for (const f of req.files) {
        await atomicWrite(join(folder, safeFileName(f.name, 'frame.png')), f.bytes);
      }
      return { ok: true, path: folder, name: basename(folder) };
    } catch (err) {
      return { ok: false, canceled: false, error: describeFsError(err) };
    }
  });

  handle(IPC.importBrushPack, async (e) => {
    const path = await showOpen(windowOf(e), 'Import brush pack', [
      { name: 'Canvas Forge brush pack', extensions: [BRUSHPACK_EXTENSION] },
    ]);
    if (!path) return null;
    return readDocumentFile(path);
  });

  handle(IPC.exportBrushPack, async (e, req: { suggestedName: unknown; bytes: unknown }) => {
    if (!req || !isShortString(req.suggestedName) || !isBytes(req.bytes)) {
      return { ok: false, canceled: false, error: 'Invalid export request.' };
    }
    const chosen = await showSave(
      windowOf(e),
      'Export brush pack',
      safeFileName(req.suggestedName, 'Brushes'),
      [{ name: 'Canvas Forge brush pack', extensions: [BRUSHPACK_EXTENSION] }],
    );
    if (!chosen) return { ok: false, canceled: true };
    const target = ensureExt(chosen, BRUSHPACK_EXTENSION);
    try {
      await atomicWrite(target, req.bytes);
      return { ok: true, path: target, name: basename(target) };
    } catch (err) {
      return { ok: false, canceled: false, error: describeFsError(err) };
    }
  });

  handle(IPC.importPalette, async (e) => {
    const path = await showOpen(windowOf(e), 'Import palette', [
      { name: 'Palettes (GIMP .gpl, Canvas Forge .json)', extensions: ['gpl', 'json'] },
    ]);
    if (!path) return null;
    return readDocumentFile(path);
  });

  // Reached only through the preload's grantDroppedFile, which takes the path from a dropped File.
  handle(IPC.grantDroppedPath, async (_e, path: unknown) => {
    if (!isShortString(path, 4096) || !isAbsolute(path)) return false;
    if (extname(path).toLowerCase() !== `.${DOCUMENT_EXTENSION}`) return false;
    if (!(await fileExists(path))) return false;
    grant(path);
    await data.pushRecent(path).catch(() => undefined);
    return true;
  });

  handle(IPC.listRecent, () => data.listRecent());
  handle(IPC.clearRecent, () => data.clearRecent());

  handle(IPC.loadAppData, (_e, kind: unknown) => {
    if (!APP_DATA_KINDS.includes(kind as AppDataKind)) return null;
    return data.loadAppData(kind as AppDataKind);
  });
  handle(IPC.saveAppData, async (_e, kind: unknown, value: unknown) => {
    if (!APP_DATA_KINDS.includes(kind as AppDataKind)) return { ok: false, error: 'Unknown data kind.' };
    try {
      await data.saveAppData(kind as AppDataKind, value);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: describeFsError(err) };
    }
  });

  handle(IPC.recoveryWrite, async (_e, meta: RecoveryMeta, bytes: unknown) => {
    if (!meta || !data.isValidRecoveryId(meta.id) || !isShortString(meta.title) || !isBytes(bytes)) {
      return { ok: false, error: 'Invalid recovery request.' };
    }
    try {
      await data.writeRecovery(
        {
          id: meta.id,
          title: meta.title,
          // kept only if it is a granted .cforge; recoveryRead re-grants it, possibly after a restart
          originalPath: grants.recoveryPath(meta.originalPath),
          savedAt: Number(meta.savedAt) || Date.now(),
          width: Number(meta.width) || 0,
          height: Number(meta.height) || 0,
        },
        bytes,
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: describeFsError(err) };
    }
  });
  handle(IPC.recoveryList, () => data.listRecovery());
  handle(IPC.recoveryRead, async (_e, id: unknown) => {
    if (!data.isValidRecoveryId(id)) return null;
    const entries = await data.listRecovery();
    const original = entries.find((r) => r.id === id)?.originalPath;
    // recoveryWrite stored this path only if it was granted then; the .cforge check also covers
    // snapshots written by older versions, which stored any path
    if (isDocumentPath(original)) grant(original);
    return data.readRecovery(id);
  });
  handle(IPC.recoveryDelete, (_e, id: unknown) => {
    if (!data.isValidRecoveryId(id)) return;
    return data.deleteRecovery(id);
  });

  handle(IPC.clipboardReadImage, () => {
    const img = clipboard.readImage();
    if (img.isEmpty()) return null;
    return new Uint8Array(img.toPNG());
  });
  handle(IPC.clipboardWriteImage, (_e, png: unknown) => {
    if (!isBytes(png)) return;
    const img = nativeImage.createFromBuffer(Buffer.from(png));
    if (!img.isEmpty()) clipboard.writeImage(img);
  });

  handle(IPC.windowToggleFullScreen, (e) => {
    const win = windowOf(e);
    if (!win) return false;
    win.setFullScreen(!win.isFullScreen());
    return win.isFullScreen();
  });
  on(IPC.windowSetTitle, (e, title: unknown) => {
    if (!isShortString(title, 300)) return;
    BrowserWindow.fromWebContents(e.sender)?.setTitle(title);
  });
  on(IPC.windowSetOverlay, (e, colors: { color?: unknown; symbolColor?: unknown }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const hex = /^#[0-9a-fA-F]{6}$/;
    if (!win || process.platform === 'darwin') return;
    if (!colors || typeof colors.color !== 'string' || typeof colors.symbolColor !== 'string') return;
    if (!hex.test(colors.color) || !hex.test(colors.symbolColor)) return;
    try {
      win.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor });
    } catch {
      // overlay unsupported on this platform/window
    }
  });
}

export function grantPath(path: string): void {
  grant(path);
}
