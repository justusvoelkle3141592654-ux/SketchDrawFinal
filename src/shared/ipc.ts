// IPC contract shared by main, preload and renderer. Keep this file free of runtime dependencies.

export const IPC = {
  openDocument: 'file:open-document',
  openRecent: 'file:open-recent',
  importImage: 'file:import-image',
  saveDocument: 'file:save-document',
  exportImage: 'file:export-image',
  exportSequence: 'file:export-sequence',
  importBrushPack: 'file:import-brushpack',
  exportBrushPack: 'file:export-brushpack',
  importPalette: 'file:import-palette',
  grantDroppedPath: 'file:grant-dropped',
  readGrantedFile: 'file:read-granted',
  listRecent: 'recent:list',
  clearRecent: 'recent:clear',
  loadAppData: 'appdata:load',
  saveAppData: 'appdata:save',
  recoveryWrite: 'recovery:write',
  recoveryList: 'recovery:list',
  recoveryRead: 'recovery:read',
  recoveryDelete: 'recovery:delete',
  clipboardReadImage: 'clipboard:read-image',
  clipboardWriteImage: 'clipboard:write-image',
  windowConfirmClose: 'window:confirm-close',
  windowToggleFullScreen: 'window:toggle-fullscreen',
  windowSetTitle: 'window:set-title',
  windowSetOverlay: 'window:set-overlay',
  appInfo: 'app:info',
  openExternalDocs: 'app:open-docs-folder',
  // main → renderer events
  evtCloseRequested: 'evt:close-requested',
  evtOpenPath: 'evt:open-path',
  evtFullScreen: 'evt:fullscreen',
} as const;

export type AppDataKind = 'preferences' | 'brushes' | 'palettes' | 'workspace';
export const APP_DATA_KINDS: readonly AppDataKind[] = ['preferences', 'brushes', 'palettes', 'workspace'];

export interface OpenedFile {
  path: string;
  name: string;
  bytes: Uint8Array;
}

export type SaveResult =
  | { ok: true; path: string; name: string }
  | { ok: false; canceled: true }
  | { ok: false; canceled: false; error: string };

export interface SaveDocumentRequest {
  /** Existing .cforge path granted by a dialog, recents, a drop or the OS; otherwise or saveAs → dialog. */
  path?: string;
  suggestedName: string;
  bytes: Uint8Array;
  saveAs: boolean;
}

export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'gif';

export interface ExportImageRequest {
  suggestedName: string;
  format: ImageFormat;
  bytes: Uint8Array;
}

export interface ExportSequenceRequest {
  suggestedFolderName: string;
  files: { name: string; bytes: Uint8Array }[];
}

export interface RecentEntry {
  path: string;
  name: string;
  openedAt: number;
  exists: boolean;
}

export interface RecoveryMeta {
  id: string;
  title: string;
  originalPath: string | null;
  savedAt: number;
  width: number;
  height: number;
}

export interface RecoveryEntry extends RecoveryMeta {
  sizeBytes: number;
}

export interface AppInfo {
  version: string;
  platform: string;
  electron: string;
  chrome: string;
  node: string;
  userDataPath: string;
}

export interface ForgeApi {
  appInfo(): Promise<AppInfo>;
  openDocument(): Promise<OpenedFile | { error: string } | null>;
  openRecent(path: string): Promise<OpenedFile | { error: string }>;
  importImage(): Promise<OpenedFile | { error: string } | null>;
  saveDocument(req: SaveDocumentRequest): Promise<SaveResult>;
  exportImage(req: ExportImageRequest): Promise<SaveResult>;
  exportSequence(req: ExportSequenceRequest): Promise<SaveResult>;
  importBrushPack(): Promise<OpenedFile | { error: string } | null>;
  exportBrushPack(suggestedName: string, bytes: Uint8Array): Promise<SaveResult>;
  importPalette(): Promise<OpenedFile | { error: string } | null>;
  /**
   * Lets the app save back to a dropped .cforge file. Returns its absolute path, or null. The
   * preload reads the path from the File itself, so the page cannot grant an arbitrary path.
   */
  grantDroppedFile(file: File): Promise<string | null>;
  listRecent(): Promise<RecentEntry[]>;
  clearRecent(): Promise<void>;
  loadAppData(kind: AppDataKind): Promise<unknown>;
  saveAppData(kind: AppDataKind, data: unknown): Promise<{ ok: boolean; error?: string }>;
  recoveryWrite(meta: RecoveryMeta, bytes: Uint8Array): Promise<{ ok: boolean; error?: string }>;
  recoveryList(): Promise<RecoveryEntry[]>;
  recoveryRead(id: string): Promise<Uint8Array | null>;
  recoveryDelete(id: string): Promise<void>;
  clipboardReadImage(): Promise<Uint8Array | null>;
  clipboardWriteImage(png: Uint8Array): Promise<void>;
  confirmClose(): void;
  toggleFullScreen(): Promise<boolean>;
  setTitle(title: string): void;
  setTitleBarOverlay(colors: { color: string; symbolColor: string }): void;
  onCloseRequested(cb: () => void): () => void;
  onOpenPath(cb: (file: OpenedFile | { error: string }) => void): () => void;
  onFullScreenChanged(cb: (fullScreen: boolean) => void): () => void;
}

export const DOCUMENT_EXTENSION = 'cforge';
export const BRUSHPACK_EXTENSION = 'cforge-brushpack';
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024 * 1024 - 1;
