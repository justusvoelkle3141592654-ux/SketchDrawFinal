// Sandboxed preload: exposes a small, typed API. No Node primitives reach the renderer.
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AppDataKind,
  ExportImageRequest,
  ExportSequenceRequest,
  ForgeApi,
  OpenedFile,
  RecoveryMeta,
  SaveDocumentRequest,
} from '../shared/ipc';
import { IPC } from '../shared/ipc';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: ForgeApi = {
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  openDocument: () => ipcRenderer.invoke(IPC.openDocument),
  openRecent: (path: string) => ipcRenderer.invoke(IPC.openRecent, path),
  importImage: () => ipcRenderer.invoke(IPC.importImage),
  saveDocument: (req: SaveDocumentRequest) => ipcRenderer.invoke(IPC.saveDocument, req),
  exportImage: (req: ExportImageRequest) => ipcRenderer.invoke(IPC.exportImage, req),
  exportSequence: (req: ExportSequenceRequest) => ipcRenderer.invoke(IPC.exportSequence, req),
  importBrushPack: () => ipcRenderer.invoke(IPC.importBrushPack),
  exportBrushPack: (suggestedName: string, bytes: Uint8Array) =>
    ipcRenderer.invoke(IPC.exportBrushPack, { suggestedName, bytes }),
  importPalette: () => ipcRenderer.invoke(IPC.importPalette),
  grantDroppedFile: async (file: File) => {
    // the path comes from the dropped File here, so the page cannot ask for an arbitrary one
    let path: string;
    try {
      path = webUtils.getPathForFile(file);
    } catch {
      return null;
    }
    if (!path) return null;
    return (await ipcRenderer.invoke(IPC.grantDroppedPath, path)) === true ? path : null;
  },
  listRecent: () => ipcRenderer.invoke(IPC.listRecent),
  clearRecent: () => ipcRenderer.invoke(IPC.clearRecent),
  loadAppData: (kind: AppDataKind) => ipcRenderer.invoke(IPC.loadAppData, kind),
  saveAppData: (kind: AppDataKind, data: unknown) => ipcRenderer.invoke(IPC.saveAppData, kind, data),
  recoveryWrite: (meta: RecoveryMeta, bytes: Uint8Array) =>
    ipcRenderer.invoke(IPC.recoveryWrite, meta, bytes),
  recoveryList: () => ipcRenderer.invoke(IPC.recoveryList),
  recoveryRead: (id: string) => ipcRenderer.invoke(IPC.recoveryRead, id),
  recoveryDelete: (id: string) => ipcRenderer.invoke(IPC.recoveryDelete, id),
  clipboardReadImage: () => ipcRenderer.invoke(IPC.clipboardReadImage),
  clipboardWriteImage: (png: Uint8Array) => ipcRenderer.invoke(IPC.clipboardWriteImage, png),
  confirmClose: () => ipcRenderer.send(IPC.windowConfirmClose),
  toggleFullScreen: () => ipcRenderer.invoke(IPC.windowToggleFullScreen),
  setTitle: (title: string) => ipcRenderer.send(IPC.windowSetTitle, title),
  setTitleBarOverlay: (colors) => ipcRenderer.send(IPC.windowSetOverlay, colors),
  onCloseRequested: (cb: () => void) => subscribe<void>(IPC.evtCloseRequested, () => cb()),
  onOpenPath: (cb: (file: OpenedFile | { error: string }) => void) => subscribe(IPC.evtOpenPath, cb),
  onFullScreenChanged: (cb: (fs: boolean) => void) => subscribe(IPC.evtFullScreen, cb),
};

contextBridge.exposeInMainWorld('forge', api);
