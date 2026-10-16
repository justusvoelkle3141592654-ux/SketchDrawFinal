// Canvas Forge — Electron main process.
import { app, BrowserWindow, dialog, ipcMain, screen, session, shell } from 'electron';
import { extname, join, resolve } from 'node:path';
import { IPC, DOCUMENT_EXTENSION } from '../shared/ipc';
import { registerIpc, readDocumentFile } from './ipc';
import { loadWindowState, saveWindowState, type WindowState } from './appdata';

// Optional override, used by tests and portable setups.
if (process.env.CFORGE_USER_DATA_DIR) {
  app.setPath('userData', resolve(process.env.CFORGE_USER_DATA_DIR));
}

const devServerUrl = process.env.CFORGE_DEV_SERVER_URL;
// Fits the work area of 1366 × 768 at 125 % scaling (about 1093 × 566 DIP with the taskbar).
const MIN_WIDTH = 1024;
const MIN_HEIGHT = 540;
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

function clampToDisplay(saved: WindowState | null): WindowState {
  // the first-launch size is clamped too, so it never exceeds a small work area
  const state: WindowState = saved ?? { width: 1440, height: 900, maximized: false };
  const area = screen.getDisplayMatching({
    x: state.x ?? 0,
    y: state.y ?? 0,
    width: state.width,
    height: state.height,
  }).workArea;
  const width = Math.min(Math.max(state.width, MIN_WIDTH), area.width);
  const height = Math.min(Math.max(state.height, MIN_HEIGHT), area.height);
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
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
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
  // never stay invisible if the first paint is slow or never reported
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
  }, 4000);

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

  // Error surfaces for a crashed or hanging renderer. Recovery snapshots written before the
  // problem are offered again after a reload.
  wc.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit' || !mainWindow) return;
    void dialog
      .showMessageBox(mainWindow, {
        type: 'error',
        title: 'Canvas Forge',
        message: 'The drawing view stopped unexpectedly.',
        detail: `Reason: ${details.reason}. After reloading, Canvas Forge offers the recovery snapshots it wrote before the problem.`,
        buttons: ['Reload', 'Quit'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      .then((r) => {
        if (r.response === 0) wc.reload();
        else {
          allowClose = true;
          app.quit();
        }
      });
  });
  let hangPrompt: AbortController | null = null;
  wc.on('unresponsive', () => {
    if (!mainWindow || hangPrompt) return;
    hangPrompt = new AbortController();
    void dialog
      .showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Canvas Forge',
        message: 'Canvas Forge is not responding.',
        detail:
          'A large operation may still be running. Wait, or reload the drawing view — changes after the last recovery snapshot would be lost.',
        buttons: ['Wait', 'Reload'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        signal: hangPrompt.signal,
      })
      .then((r) => {
        hangPrompt = null;
        if (r.response === 1) {
          wc.forcefullyCrashRenderer();
          wc.reload();
        }
      })
      .catch(() => (hangPrompt = null));
  });
  wc.on('responsive', () => {
    hangPrompt?.abort();
    hangPrompt = null;
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
