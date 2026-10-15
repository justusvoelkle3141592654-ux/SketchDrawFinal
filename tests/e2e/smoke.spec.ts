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

type HookWindow = Window & {
  __cforge: {
    activeSession: () => {
      doc: {
        width: number;
        height: number;
        selection: unknown;
        layers: { name: string; pixels: { getPixel: (x: number, y: number) => number[] } }[];
      };
      view: { zoom: number };
    };
  };
};

const hasSelection = () =>
  win.evaluate(() => !!(window as unknown as HookWindow).__cforge.activeSession().doc.selection);

test('selection → move with the transform tool → undo restores the pixels', async () => {
  await win.keyboard.press('Control+n');
  await win.click('[data-testid=new-doc-create]');
  await strokeAcrossCanvas();
  const box = (await win.locator('[data-testid=canvas]').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // rectangle selection around the middle of the stroke
  await win.keyboard.press('m');
  await win.mouse.move(cx - 60, cy - 40);
  await win.mouse.down();
  await win.mouse.move(cx + 60, cy + 40, { steps: 6 });
  await win.mouse.up();
  expect(await hasSelection()).toBe(true);
  // move it down by 100 screen px and apply
  await win.keyboard.press('Control+t');
  await expect(win.locator('[data-testid=transform-apply]')).toBeVisible();
  await win.mouse.move(cx, cy);
  await win.mouse.down();
  await win.mouse.move(cx, cy + 100, { steps: 8 });
  await win.mouse.up();
  await win.keyboard.press('Enter');
  const zoom = await win.evaluate(() => (window as unknown as HookWindow).__cforge.activeSession().view.zoom);
  const dy = Math.round(100 / zoom);
  expect(await centreAlpha(0)).toBe(0);
  expect(await centreAlpha(0, dy)).toBeGreaterThan(200);
  // the selection followed the pixels
  expect(await hasSelection()).toBe(true);
  await win.keyboard.press('Control+z');
  expect(await centreAlpha(0)).toBeGreaterThan(200);
  expect(await centreAlpha(0, dy)).toBe(0);
});

test('text tool places raster text on a new layer', async () => {
  await win.keyboard.press('Control+n');
  await win.click('[data-testid=new-doc-create]');
  const box = (await win.locator('[data-testid=canvas]').boundingBox())!;
  await win.keyboard.press('t');
  await win.mouse.click(box.x + box.width / 2 - 100, box.y + box.height / 2);
  await expect(win.locator('[data-testid=text-overlay]')).toBeVisible();
  await win.keyboard.type('Hello');
  await win.click('[data-testid=text-commit]');
  await expect(win.locator('[data-testid=text-overlay]')).toHaveCount(0);
  const names = await win.evaluate(() =>
    (window as unknown as HookWindow).__cforge.activeSession().doc.layers.map((l) => l.name),
  );
  expect(names).toContain('Text: Hello');
  const opaque = await win.evaluate(() => {
    const s = (window as unknown as HookWindow).__cforge.activeSession();
    const l = s.doc.layers.find((x) => x.name === 'Text: Hello')!;
    let n = 0;
    for (let y = 0; y < s.doc.height; y += 2)
      for (let x = 0; x < s.doc.width; x += 2) if (l.pixels.getPixel(x, y)[3] > 128) n++;
    return n;
  });
  expect(opaque).toBeGreaterThan(50);
});
