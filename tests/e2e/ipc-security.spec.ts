// IPC hardening: only the main window's own page may call the main process, the page cannot grant
// itself a path (a real drop can), and a recovery snapshot cannot carry in a path the user never chose.
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
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

async function strokeAcrossCanvas(page: Page) {
  const box = (await page.locator('[data-testid=canvas]').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 200, cy);
  await page.mouse.down();
  for (let i = 0; i <= 40; i++) await page.mouse.move(cx - 200 + i * 10, cy);
  await page.mouse.up();
}

async function mockSaveDialog(target: ElectronApplication, path: string) {
  await target.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p })) as typeof dialog.showSaveDialog;
  }, path);
}

/** Replaces the save dialog with one that is always canceled and counts how often it is shown. */
async function countSaveDialogs() {
  await app.evaluate(({ dialog }) => {
    const g = globalThis as { saveDialogCalls?: number };
    g.saveDialogCalls = 0;
    dialog.showSaveDialog = (async () => {
      g.saveDialogCalls = (g.saveDialogCalls ?? 0) + 1;
      return { canceled: true, filePath: '' };
    }) as typeof dialog.showSaveDialog;
  });
}
const saveDialogCalls = () =>
  app.evaluate(() => (globalThis as { saveDialogCalls?: number }).saveDialogCalls);

test('a granted image is neither overwritten without a dialog nor kept by a recovery snapshot', async () => {
  const image = join(dir, 'photo.png');
  writeFileSync(image, 'picked in the import dialog');
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [p],
    })) as typeof dialog.showOpenDialog;
  }, image);
  await countSaveDialogs();
  const r = await win.evaluate(async (imagePath) => {
    const forge = (window as unknown as ForgeWindow).forge;
    await forge.importImage(); // grants imagePath
    const meta = {
      id: 'sec-image',
      title: 'x',
      originalPath: imagePath,
      savedAt: Date.now(),
      width: 1,
      height: 1,
    };
    await forge.recoveryWrite(meta, new Uint8Array([1]));
    const list = await forge.recoveryList();
    await forge.recoveryDelete('sec-image');
    const save = await forge.saveDocument({
      path: imagePath,
      suggestedName: 'x',
      bytes: new Uint8Array([1]),
      saveAs: false,
    });
    return { original: list.find((e) => e.id === 'sec-image')?.originalPath, save };
  }, image);
  expect(r.original).toBeNull();
  // the save asked for a target instead of writing over the image
  expect(r.save).toEqual({ ok: false, canceled: true });
  expect(await saveDialogCalls()).toBe(1);
  expect(readFileSync(image, 'utf8')).toBe('picked in the import dialog');
});

test('a dropped .cforge file is granted and Ctrl+S saves back to it without a dialog', async () => {
  // a real document, saved through the dialog, then copied so the copy holds no grant yet
  const saved = join(dir, 'saved.cforge');
  const dropped = join(dir, 'dropped.cforge');
  await win.keyboard.press('Control+n');
  await win.click('[data-testid=new-doc-create]');
  await strokeAcrossCanvas(win);
  await mockSaveDialog(app, saved);
  await win.keyboard.press('Control+s');
  await expect(win.locator('[data-testid=dirty-dot]')).toHaveCount(0);
  await win.keyboard.press('Control+w');
  await expect(win.locator('[data-testid=doc-tab]')).toHaveCount(0);
  copyFileSync(saved, dropped);
  const old = new Date('2001-01-01T00:00:00Z');
  utimesSync(dropped, old, old);
  const before = readFileSync(dropped);

  // any save dialog from here on would mean the drop grant did not work
  await countSaveDialogs();

  // a File backed by the file on disk, as a real drop delivers it
  await win.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'e2e-drop-source';
    input.hidden = true;
    document.body.append(input);
  });
  await win.locator('#e2e-drop-source').setInputFiles(dropped);
  await win.evaluate(() => {
    const file = (document.getElementById('e2e-drop-source') as HTMLInputElement).files![0];
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    window.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }));
  });
  await expect(win.locator('[data-testid=doc-tab]')).toHaveCount(1);
  await expect(win.locator('.doc-tab-name')).toHaveText('dropped');

  await strokeAcrossCanvas(win);
  await expect(win.locator('[data-testid=dirty-dot]')).toHaveCount(1);
  await win.keyboard.press('Control+s');
  await expect(win.locator('[data-testid=dirty-dot]')).toHaveCount(0);
  expect(statSync(dropped).mtimeMs).toBeGreaterThan(old.getTime());
  expect(readFileSync(dropped).equals(before)).toBe(false);
  expect(await saveDialogCalls()).toBe(0);

  // the preload reads the path from the native File
  const granted = await win.evaluate(() => {
    const input = document.getElementById('e2e-drop-source') as HTMLInputElement;
    const path = (window as unknown as ForgeWindow).forge.grantDroppedFile(input.files![0]);
    input.remove();
    return path;
  });
  expect(granted).toBe(dropped);
  await win.keyboard.press('Control+w');
  await expect(win.locator('[data-testid=doc-tab]')).toHaveCount(0);
});

test("IPC works when the app folder contains '%', '#', spaces and non-ASCII characters", async () => {
  // Electron's loadFile() leaves '%' unencoded, which once made every IPC call fail from such a folder
  const appDir = join(dir, '50%off #1 Ünï cöde');
  mkdirSync(appDir);
  cpSync('package.json', join(appDir, 'package.json'));
  cpSync('dist', join(appDir, 'dist'), { recursive: true });
  cpSync('build/icon.png', join(appDir, 'build/icon.png'));
  const other = await electron.launch({
    args: [appDir, '--no-sandbox'],
    env: {
      ...process.env,
      CFORGE_USER_DATA_DIR: join(dir, 'userdata-special'),
      CFORGE_ALLOW_MULTI_INSTANCE: '1',
      // empty counts as unset: the built page loads and stays trusted
      CFORGE_DEV_SERVER_URL: '',
    },
  });
  try {
    const page = await other.firstWindow();
    await page.waitForSelector('[data-ready=true]');
    const r = await page.evaluate(async () => {
      const forge = (window as unknown as ForgeWindow).forge;
      return {
        href: location.href,
        version: await forge.appInfo().then((i) => i.version),
        recent: await forge.listRecent(),
      };
    });
    expect(r.href).toContain('50%25off%20%231%20');
    expect(r.version).toBeTruthy();
    expect(r.recent).toEqual([]);

    const target = join(dir, 'from-special-folder.cforge');
    await mockSaveDialog(other, target);
    await page.keyboard.press('Control+n');
    await page.click('[data-testid=new-doc-create]');
    await strokeAcrossCanvas(page);
    await page.keyboard.press('Control+s');
    await expect(page.locator('[data-testid=dirty-dot]')).toHaveCount(0);
    expect(existsSync(target)).toBe(true);
  } finally {
    const exited = new Promise<void>((resolve) => other.process().once('exit', () => resolve()));
    await other.evaluate(({ app: a }) => a.exit(0)).catch(() => undefined);
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  }
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
