// IPC hardening: only the main window's own page may call the main process, the page cannot grant
// itself a path, and a recovery snapshot cannot carry in a path the user never chose.
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ForgeApi } from '../../src/shared/ipc';

type ForgeWindow = Window & { forge: ForgeApi & { grantDroppedPath?: unknown } };

let app: ElectronApplication;
let win: Page;
let dir: string;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cforge-ipc-'));
  app = await electron.launch({
    args: ['.', '--no-sandbox'],
    env: { ...process.env, CFORGE_USER_DATA_DIR: join(dir, 'userdata'), CFORGE_ALLOW_MULTI_INSTANCE: '1' },
  });
  win = await app.firstWindow();
  await win.waitForSelector('[data-ready=true]');
});

test.afterAll(async () => {
  const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()));
  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => undefined);
  await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test('the main window page can use the API (invoke and send)', async () => {
  const version = await win.evaluate(() =>
    (window as unknown as ForgeWindow).forge.appInfo().then((i) => i.version),
  );
  expect(version).toBeTruthy();
  await win.evaluate(() => (window as unknown as ForgeWindow).forge.setTitle('IPC title check'));
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()))
    .toBe('IPC title check');
});

test('the page cannot grant itself a path', async () => {
  const victim = join(dir, 'victim.cforge');
  writeFileSync(victim, 'not yours');
  const r = await win.evaluate(async (p) => {
    const forge = (window as unknown as ForgeWindow).forge;
    return {
      stringGrant: typeof forge.grantDroppedPath,
      // a File made by the page has no path on disk
      fileGrant: await forge.grantDroppedFile(new File([new Uint8Array([1])], 'victim.cforge')),
      open: await forge.openRecent(p),
    };
  }, victim);
  expect(r.stringGrant).toBe('undefined');
  expect(r.fileGrant).toBeNull();
  expect(r.open).toEqual({ error: 'This file is not in the recent list.' });
});

test('recovery snapshots keep only granted original paths', async () => {
  const victim = join(dir, 'victim.cforge');
  const chosen = join(dir, 'chosen.cforge');
  writeFileSync(victim, 'not yours');
  writeFileSync(chosen, 'picked in the open dialog');
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [p],
    })) as typeof dialog.showOpenDialog;
  }, chosen);
  const r = await win.evaluate(
    async ([victimPath, chosenPath]) => {
      const forge = (window as unknown as ForgeWindow).forge;
      await forge.openDocument(); // grants chosenPath
      const meta = (id: string, originalPath: string) => ({
        id,
        title: id,
        originalPath,
        savedAt: Date.now(),
        width: 1,
        height: 1,
      });
      await forge.recoveryWrite(meta('sec-victim', victimPath), new Uint8Array([1]));
      await forge.recoveryWrite(meta('sec-chosen', chosenPath), new Uint8Array([1]));
      const list = await forge.recoveryList();
      await forge.recoveryRead('sec-victim');
      const open = await forge.openRecent(victimPath);
      await forge.recoveryDelete('sec-victim');
      await forge.recoveryDelete('sec-chosen');
      return { paths: Object.fromEntries(list.map((e) => [e.id, e.originalPath])), open };
    },
    [victim, chosen],
  );
  expect(r.paths).toMatchObject({ 'sec-victim': null, 'sec-chosen': chosen });
  expect(r.open).toEqual({ error: 'This file is not in the recent list.' });
});

test('IPC from another window is rejected', async () => {
  const r = await app.evaluate(async ({ app: a, BrowserWindow }) => {
    const other = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: `${a.getAppPath()}/dist/preload/preload.js`,
        contextIsolation: true,
        sandbox: true,
      },
    });
    try {
      await other.loadFile(`${a.getAppPath()}/dist/renderer/index.html`);
      return await other.webContents.executeJavaScript(
        'window.forge ? window.forge.appInfo().then(() => "allowed", (e) => String(e)) : "no api"',
      );
    } finally {
      other.destroy();
    }
  });
  expect(r).toContain('untrusted sender');
});

// Runs last: it navigates the main window away from the app.
test('IPC from the main window is rejected once it shows another page', async () => {
  const page = join(dir, 'other.html');
  writeFileSync(page, '<!doctype html><title>other</title>');
  const r = await app.evaluate(async ({ BrowserWindow }, p) => {
    const main = BrowserWindow.getAllWindows()[0];
    await main.webContents.loadFile(p);
    return main.webContents.executeJavaScript(
      'window.forge ? window.forge.appInfo().then(() => "allowed", (e) => String(e)) : "no api"',
    );
  }, page);
  expect(r).toContain('untrusted sender');
});
