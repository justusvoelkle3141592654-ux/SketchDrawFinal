// Canvas Forge — Electron main process.
import { app, BrowserWindow, ipcMain, screen, session, shell } from 'electron';
import { extname, join, resolve } from 'node:path';
import { IPC, DOCUMENT_EXTENSION } from '../shared/ipc';
import { registerIpc, readDocumentFile } from './ipc';
import { loadWindowState, saveWindowState, type WindowState } from './appdata';

// Optional override, used by tests and portable setups.
if (process.env.CFORGE_USER_DATA_DIR) {
  app.setPath('userData', resolve(process.env.CFORGE_USER_DATA_DIR));
}

const devServerUrl = process.env.CFORGE_DEV_SERVER_URL;
let mainWindow: BrowserWindow | null = null;
let allowClose = false;
const pendingOpenPaths: string[] = [];

function documentArgs(argv: string[]): string[] {
  return argv.filter((a) => {
    const ext = extname(a).toLowerCase().slice(1);
    return [DOCUMENT_EXTENSION, 'png', 'jpg', 'jpeg', 'webp'].includes(ext) && !a.startsWith('--');
  });
}

async function sendOpenPath(path: string) {
  if (!mainWindow) {
    pendingOpenPaths.push(path);
    return;
  }
  const result = await readDocumentFile(path);
  mainWindow.webContents.send(IPC.evtOpenPath, result);
}

function clampToDisplay(state: WindowState | null): WindowState {
  const fallback: WindowState = { width: 1440, height: 900, maximized: false };
  if (!state) return fallback;
  const area = screen.getDisplayMatching({
    x: state.x ?? 0,
    y: state.y ?? 0,
    width: state.width,
    height: state.height,
  }).workArea;
  const width = Math.min(Math.max(state.width, 1024), area.width);
  const height = Math.min(Math.max(state.height, 640), area.height);
  const visible =
    state.x !== undefined &&
    state.y !== undefined &&
    state.x < area.x + area.width - 100 &&
    state.y < area.y + area.height - 100 &&
    state.x + width > area.x + 100 &&
    state.y >= area.y - 10;
  return visible
    ? { x: state.x, y: state.y, width, height, maximized: state.maximized }
    : { width, height, maximized: state.maximized };
}

async function createWindow() {
  const state = clampToDisplay(await loadWindowState());
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#15171a',
    title: 'Canvas Forge',
    titleBarStyle: 'hidden',
    titleBarOverlay: isMac ? undefined : { color: '#17191d', symbolColor: '#c8ccd4', height: 38 },
    trafficLightPosition: isMac ? { x: 12, y: 12 } : undefined,
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  if (state.maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.on('close', (e) => {
    if (!mainWindow) return;
    const b = mainWindow.getNormalBounds();
    void saveWindowState({ ...b, maximized: mainWindow.isMaximized() }).catch(() => undefined);
    if (!allowClose) {
      e.preventDefault();
      mainWindow.webContents.send(IPC.evtCloseRequested);
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.on('enter-full-screen', () => mainWindow?.webContents.send(IPC.evtFullScreen, true));
  mainWindow.on('leave-full-screen', () => mainWindow?.webContents.send(IPC.evtFullScreen, false));

  const wc = mainWindow.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.once('did-finish-load', () => {
    for (const p of pendingOpenPaths.splice(0)) void sendOpenPath(p);
  });

  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

const gotLock = process.env.CFORGE_ALLOW_MULTI_INSTANCE ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    for (const p of documentArgs(argv.slice(1))) void sendOpenPath(p);
  });

  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    registerIpc();
    ipcMain.on(IPC.windowConfirmClose, () => {
      allowClose = true;
      mainWindow?.close();
    });
    pendingOpenPaths.push(...documentArgs(process.argv.slice(app.isPackaged ? 1 : 2)));
    await createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        allowClose = false;
        void createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (ev) => ev.preventDefault());
});
