// Smoke test: new document → draw → add layer → save → close → reopen → export PNG.
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;
let win: Page;
let dir: string;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cforge-e2e-'));
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

async function mockSaveDialog(path: string) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p })) as typeof dialog.showSaveDialog;
  }, path);
}

async function mockOpenDialog(path: string) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [p],
    })) as typeof dialog.showOpenDialog;
  }, path);
}

async function strokeAcrossCanvas(dy = 0) {
  const box = (await win.locator('[data-testid=canvas]').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2 + dy;
  await win.mouse.move(cx - 200, cy);
  await win.mouse.down();
  for (let i = 0; i <= 40; i++) await win.mouse.move(cx - 200 + i * 10, cy);
  await win.mouse.up();
}

/** Alpha of the active document's layer pixel at the document centre (+dy document pixels). */
async function centreAlpha(layerIndex: number, dyDoc = 0): Promise<number> {
  return win.evaluate(
    ([i, dy]) => {
      const hooks = (window as unknown as { __cforge: unknown }).__cforge as {
        activeSession: () => {
          doc: {
            width: number;
            height: number;
            layers: { pixels: { getPixel: (x: number, y: number) => number[] } }[];
          };
        };
      };
      const s = hooks.activeSession();
      const l = s.doc.layers[i];
      return l.pixels.getPixel(Math.floor(s.doc.width / 2), Math.floor(s.doc.height / 2 + dy))[3];
    },
    [layerIndex, dyDoc] as const,
  );
}

test('new → draw → add layer → save → close → reopen → export PNG', async () => {
  await win.click('[data-testid=start-new]');
  await win.selectOption('[data-testid=new-doc-preset]', 'square');
  await win.click('[data-testid=new-doc-create]');
  await expect(win.locator('[data-testid=doc-tab]')).toHaveCount(1);

  await strokeAcrossCanvas();
  expect(await centreAlpha(0)).toBeGreaterThan(200);
  await expect(win.locator('[data-testid=dirty-dot]')).toHaveCount(1);

  await win.click('[data-testid=layer-new]');
  await expect(win.locator('[data-testid=layer-row]')).toHaveCount(2);
  const zoom = await win.evaluate(
    () =>
      (
        (window as unknown as { __cforge: unknown }).__cforge as {
          activeSession: () => { view: { zoom: number } };
        }
      ).activeSession().view.zoom,
  );
  await strokeAcrossCanvas(60);
  expect(await centreAlpha(1, Math.round(60 / zoom))).toBeGreaterThan(200);
  expect(await centreAlpha(1)).toBe(0);

  // undo / redo of the second stroke
  await win.keyboard.press('Control+z');
  expect(await centreAlpha(1, Math.round(60 / zoom))).toBe(0);
  await win.keyboard.press('Control+Shift+z');
  expect(await centreAlpha(1, Math.round(60 / zoom))).toBeGreaterThan(200);

  const docPath = join(dir, 'smoke.cforge');
  await mockSaveDialog(docPath);
  await win.keyboard.press('Control+s');
  await expect(win.locator('[data-testid=dirty-dot]')).toHaveCount(0);
  expect(existsSync(docPath)).toBe(true);

  // close (no prompt because the document is saved)
  await win.keyboard.press('Control+w');
  await expect(win.locator('[data-testid=doc-tab]')).toHaveCount(0);
  await expect(win.locator('[data-testid=start-screen]')).toBeVisible();

  // reopen
  await mockOpenDialog(docPath);
  await win.keyboard.press('Control+o');
  await expect(win.locator('[data-testid=doc-tab]')).toHaveCount(1);
  await expect(win.locator('[data-testid=layer-row]')).toHaveCount(2);
  expect(await centreAlpha(0)).toBeGreaterThan(200);
  expect(await centreAlpha(1, Math.round(60 / zoom))).toBeGreaterThan(200);

  // export PNG
  const pngPath = join(dir, 'smoke-export.png');
  await mockSaveDialog(pngPath);
  await win.keyboard.press('Control+Shift+e');
  await win.click('[data-testid=export-run]');
  await expect.poll(() => existsSync(pngPath)).toBe(true);
  const png = readFileSync(pngPath);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.readUInt32BE(16)).toBe(2048);
  expect(png.readUInt32BE(20)).toBe(2048);
});

test('unsaved changes prompt on close and Cancel keeps the document', async () => {
  await win.keyboard.press('Control+n');
  await win.click('[data-testid=new-doc-create]');
  const before = await win.locator('[data-testid=doc-tab]').count();
  await strokeAcrossCanvas();
  await win.keyboard.press('Control+w');
  await expect(win.locator('[data-testid=confirm-dialog]')).toBeVisible();
  await win.click('[data-testid=confirm-cancel]');
  await expect(win.locator('[data-testid=doc-tab]')).toHaveCount(before);
  await win.keyboard.press('Control+w');
  await win.click('[data-testid=confirm-discard]');
  await expect(win.locator('[data-testid=doc-tab]')).toHaveCount(before - 1);
});
