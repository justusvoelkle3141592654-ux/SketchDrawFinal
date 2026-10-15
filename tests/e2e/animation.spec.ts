// Flipbook animation and time-lapse: frames, exposure, playback, GIF / PNG-sequence export, persistence.
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;
let win: Page;
let dir: string;

type HookWindow = Window & {
  __cforge: {
    runCommand: (id: string) => void;
    activeSession: () => {
      doc: {
        layers: { name: string }[];
        activeLayerId: string;
        getLayer: (id: string) => { name: string } | undefined;
      };
      features: {
        animation?: { enabled: boolean; exposures: Record<string, number> };
        timelapse?: { recording: boolean };
      };
      resources: Record<string, Uint8Array>;
    };
  };
};

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cforge-anim-'));
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

/** Walks the GIF block structure and counts frames (image descriptors). */
function gifInfo(bytes: Buffer) {
  expect(bytes.subarray(0, 6).toString()).toBe('GIF89a');
  const width = bytes.readUInt16LE(6);
  const height = bytes.readUInt16LE(8);
  let p = 13;
  if (bytes[10] & 0x80) p += 3 * (1 << ((bytes[10] & 7) + 1));
  let frames = 0;
  let loops = false;
  const skipSubBlocks = () => {
    while (bytes[p] !== 0) p += bytes[p] + 1;
    p++;
  };
  while (p < bytes.length) {
    const b = bytes[p++];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = bytes[p++];
      if (label === 0xff && bytes.subarray(p + 1, p + 12).toString() === 'NETSCAPE2.0') loops = true;
      skipSubBlocks();
    } else if (b === 0x2c) {
      frames++;
      const packed = bytes[p + 8];
      p += 9;
      if (packed & 0x80) p += 3 * (1 << ((packed & 7) + 1));
      p++; // LZW minimum code size
      skipSubBlocks();
    } else throw new Error(`unexpected GIF block 0x${b.toString(16)}`);
  }
  return { width, height, frames, loops };
}

async function stroke(dx: number) {
  const box = (await win.locator('[data-testid=canvas]').boundingBox())!;
  const x = box.x + box.width / 2 + dx;
  const y = box.y + box.height / 2;
  await win.mouse.move(x, y - 80);
  await win.mouse.down();
  for (let i = 0; i <= 16; i++) await win.mouse.move(x, y - 80 + i * 10);
  await win.mouse.up();
}

const session = () =>
  win.evaluate(() => {
    const s = (window as unknown as HookWindow).__cforge.activeSession();
    return {
      frames: s.doc.layers.map((l) => l.name),
      active: s.doc.getLayer(s.doc.activeLayerId)?.name,
      animation: s.features.animation,
      timelapse: Object.keys(s.resources).filter((k) => k.startsWith('timelapse/')).length,
    };
  });

test('flipbook: frames, exposure, playback, GIF and PNG-sequence export, save and reopen', async () => {
  await win.keyboard.press('Control+n');
  await win.selectOption('[data-testid=new-doc-preset]', 'social');
  await win.click('[data-testid=new-doc-create]');
  await win.evaluate(() => (window as unknown as HookWindow).__cforge.runCommand('anim.toggle'));
  await expect(win.locator('[data-testid=frame-card]')).toHaveCount(1);
  for (let i = 0; i < 10; i++) await win.keyboard.press(']');
  await stroke(-100);
  await win.keyboard.press('Control+Alt+n');
  await stroke(100);
  await expect(win.locator('[data-testid=frame-card]')).toHaveCount(2);
  expect((await session()).active).toBe('Frame 2');
  await win.keyboard.press(',');
  expect((await session()).active).toBe('Layer 1');
  // hold frame 1 for two ticks
  await win.click('[aria-label="Longer exposure"]');
  await expect(win.locator('[data-testid=anim-exposure]')).toHaveText('×2');

  // playback cycles through both frames; touching the canvas stops it
  await win.keyboard.press('Control+Enter');
  await expect(win.locator('[data-testid=anim-play]')).toHaveAttribute('aria-pressed', 'true');
  const seen = new Set<string | null>();
  for (let i = 0; i < 20 && seen.size < 2; i++) {
    seen.add(await win.locator('[data-testid=frame-card][aria-current=true]').getAttribute('aria-label'));
    await win.waitForTimeout(60);
  }
  expect(seen.size).toBe(2);
  const box = (await win.locator('[data-testid=canvas]').boundingBox())!;
  await win.mouse.click(box.x + 20, box.y + box.height - 20);
  await expect(win.locator('[data-testid=anim-play]')).toHaveAttribute('aria-pressed', 'false');

  // animated GIF
  const gifPath = join(dir, 'flip.gif');
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p })) as typeof dialog.showSaveDialog;
  }, gifPath);
  await win.evaluate(() => (window as unknown as HookWindow).__cforge.runCommand('anim.export'));
  await win.click('[data-testid=animation-export-run]');
  await expect.poll(() => existsSync(gifPath), { timeout: 15000 }).toBe(true);
  const gif = gifInfo(readFileSync(gifPath));
  expect(gif).toEqual({ width: 1080, height: 1350, frames: 2, loops: true });

  // PNG sequence: one file per tick (frame 1 held for two ticks)
  const seqRoot = join(dir, 'seq');
  mkdirSync(seqRoot);
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [p],
    })) as typeof dialog.showOpenDialog;
  }, seqRoot);
  await win.evaluate(() => (window as unknown as HookWindow).__cforge.runCommand('anim.export'));
  await win.click('[data-testid=animation-export-dialog] [role=radio]:has-text("PNG sequence")');
  await win.click('[data-testid=animation-export-run]');
  const listPngs = () =>
    existsSync(seqRoot)
      ? readdirSync(seqRoot, { recursive: true }).filter((f) => String(f).endsWith('.png'))
      : [];
  await expect.poll(() => listPngs().length, { timeout: 15000 }).toBe(3);

  // save, close, reopen: frames and exposure survive
  const docPath = join(dir, 'flip.cforge');
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p })) as typeof dialog.showSaveDialog;
  }, docPath);
  await win.keyboard.press('Control+s');
  await expect(win.locator('[data-testid=dirty-dot]')).toHaveCount(0);
  await win.keyboard.press('Control+w');
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [p],
    })) as typeof dialog.showOpenDialog;
  }, docPath);
  await win.keyboard.press('Control+o');
  await expect(win.locator('[data-testid=frame-card]')).toHaveCount(2);
  const after = await session();
  expect(after.animation?.enabled).toBe(true);
  expect(Object.values(after.animation?.exposures ?? {})).toEqual([2]);
});

test('time-lapse records snapshots after edits and keeps them in the document', async () => {
  await win.keyboard.press('Control+n');
  await win.click('[data-testid=new-doc-create]');
  await win.evaluate(() => (window as unknown as HookWindow).__cforge.runCommand('timelapse.record'));
  await expect(win.locator('[data-testid=status-rec]')).toBeVisible();
  await stroke(-50);
  await win.waitForTimeout(1500);
  await stroke(50);
  await expect.poll(async () => (await session()).timelapse, { timeout: 8000 }).toBeGreaterThanOrEqual(2);
  await win.click('[data-testid=status-rec]');
  await expect(win.locator('[data-testid=timelapse-dialog]')).toBeVisible();
  await expect(win.locator('.timelapse-count')).toContainText('/');
  await win.keyboard.press('Escape');
});
