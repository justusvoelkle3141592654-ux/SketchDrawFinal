// Input routing on the real canvas with synthetic pen and touch Pointer Events: pen-only mode,
// palm contacts before and during a pen stroke, and the Input & Tablet diagnostics.
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;
let win: Page;
let dir: string;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cforge-input-'));
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

/** [event type, pointer type, pointer id, dx and dy from the target's centre, pressure] */
type Step = [string, string, number, number, number, number?];

/** Dispatches synthetic Pointer Events a few ms apart. They carry no coalesced samples. */
async function send(selector: string, steps: Step[]) {
  await win.evaluate(
    async ([sel, list]) => {
      const el = document.querySelector(sel)!;
      const r = el.getBoundingClientRect();
      for (const [type, pointerType, pointerId, dx, dy, pressure = 0.5] of list) {
        const up = type === 'pointerup';
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId,
            pointerType,
            isPrimary: pointerType === 'pen',
            clientX: r.left + r.width / 2 + dx,
            clientY: r.top + r.height / 2 + dy,
            pressure: up ? 0 : pressure,
            tiltX: pointerType === 'pen' ? 25 : 0,
            buttons: up ? 0 : 1,
            button: type === 'pointermove' ? -1 : 0,
          }),
        );
        await new Promise((res) => setTimeout(res, 8));
      }
    },
    [selector, steps] as const,
  );
}

function drag(pointerType: string, id: number, x0: number, x1: number, dy: number, pressure = 0.5): Step[] {
  const steps: Step[] = [['pointerdown', pointerType, id, x0, dy, pressure]];
  for (let i = 1; i <= 20; i++)
    steps.push(['pointermove', pointerType, id, x0 + ((x1 - x0) * i) / 20, dy, pressure]);
  steps.push(['pointerup', pointerType, id, x1, dy]);
  return steps;
}

interface CanvasState {
  view: { zoom: number; panX: number; panY: number; rotation: number };
  history: number;
  tiles: number;
  centreAlpha: number;
}

async function canvasState(): Promise<CanvasState> {
  return win.evaluate(() => {
    const hooks = (window as unknown as { __cforge: unknown }).__cforge as {
      activeSession: () => {
        view: CanvasState['view'];
        history: { position: number };
        doc: {
          width: number;
          height: number;
          layers: {
            pixels: { tileCount: number; getPixel: (x: number, y: number) => number[] };
          }[];
        };
      };
    };
    const s = hooks.activeSession();
    const px = s.doc.layers[0].pixels;
    const { zoom, panX, panY, rotation } = s.view;
    return {
      view: { zoom, panX, panY, rotation },
      history: s.history.position,
      tiles: px.tileCount,
      centreAlpha: px.getPixel(Math.floor(s.doc.width / 2), Math.floor(s.doc.height / 2))[3],
    };
  });
}

test('pen-only canvas: the pen paints, palm contacts do not move the view, a finger pans', async () => {
  await win.click('[data-testid=start-new]');
  await win.selectOption('[data-testid=new-doc-preset]', 'square');
  await win.click('[data-testid=new-doc-create]');
  await expect(win.locator('[data-testid=doc-tab]')).toHaveCount(1);

  // switch pen-only on; a pen sample over the test pad shows raw and normalised values
  await win.keyboard.press('Control+,');
  await win.click('[data-testid=prefs-tab-input]');
  await win.click('[data-testid=pref-penonly]');
  await expect(win.locator('[data-testid=pref-penonly]')).toHaveAttribute('aria-checked', 'true');
  await send('.test-pad', [['pointermove', 'pen', 21, 0, 0, 0.6]]);
  const row = (k: string) => win.locator('[data-testid=diagnostics] .diag-row', { hasText: k });
  await expect(row('Pointer type')).toContainText('pen');
  await expect(row('Raw pressure')).toContainText('0.600');
  // default 2 % threshold: (0.6 − 0.02) / 0.98
  await expect(row('Normalised pressure')).toContainText('0.592');
  await expect(row('Tilt X / Y')).toContainText('25.0°');
  await expect(row('Coalesced samples')).toHaveText(/Coalesced samples\s*1$/);
  await win.keyboard.press('Escape');
  await expect(win.locator('[data-testid=prefs-dialog]')).toHaveCount(0);

  // pen stroke through the centre; two palm contacts land and spread while it is drawn
  const start = await canvasState();
  const stroke = drag('pen', 21, -200, 200, 0, 0.8);
  const palmDown: Step[] = [
    ['pointerdown', 'touch', 12, 100, 150],
    ['pointerdown', 'touch', 13, 140, 150],
    ['pointermove', 'touch', 12, 40, 200],
    ['pointermove', 'touch', 13, 220, 100],
  ];
  const palmUp: Step[] = [
    ['pointerup', 'touch', 12, 40, 200],
    ['pointerup', 'touch', 13, 220, 100],
  ];
  await send('[data-testid=canvas]', [
    ...stroke.slice(0, 8),
    ...palmDown,
    ...stroke.slice(8, -1),
    ...palmUp,
    ...stroke.slice(-1),
  ]);
  const drawn = await canvasState();
  expect(drawn.view).toEqual(start.view);
  expect(drawn.centreAlpha).toBeGreaterThan(200);
  expect(drawn.history).toBe(start.history + 1);

  // a finger drag below the stroke pans the view and paints nothing
  await send('[data-testid=canvas]', drag('touch', 14, -150, 50, 250));
  const panned = await canvasState();
  expect(panned.view.panX - drawn.view.panX).toBeCloseTo(200, 0);
  expect(panned.view.zoom).toBe(drawn.view.zoom);
  expect(panned.history).toBe(drawn.history);
  expect(panned.tiles).toBe(drawn.tiles);
});

test('pen-only canvas: palms that land before the pen do not block it, move the view or undo', async () => {
  const newDoc = async () => {
    await win.keyboard.press('Control+n');
    await win.selectOption('[data-testid=new-doc-preset]', 'square');
    await win.click('[data-testid=new-doc-create]');
    await expect(win.locator('[data-testid=new-doc-dialog]')).toHaveCount(0);
  };
  await newDoc();
  // pen-only stays on from the test above; switch it on when this test runs in a fresh app
  await win.keyboard.press('Control+,');
  await win.click('[data-testid=prefs-tab-input]');
  const penOnly = win.locator('[data-testid=pref-penonly]');
  if ((await penOnly.getAttribute('aria-checked')) !== 'true') await penOnly.click();
  await expect(penOnly).toHaveAttribute('aria-checked', 'true');
  await win.keyboard.press('Escape');
  await expect(win.locator('[data-testid=prefs-dialog]')).toHaveCount(0);
  const canvas = '[data-testid=canvas]';

  // one palm rests first (a finger pan in pen-only mode), then the pen draws while the palm drifts
  let before = await canvasState();
  let stroke = drag('pen', 21, -200, 200, 0, 0.8);
  await send(canvas, [
    ['pointerdown', 'touch', 31, 150, 150],
    ...stroke.slice(0, 6),
    ['pointermove', 'touch', 31, 165, 160],
    ...stroke.slice(6, 14),
    ['pointermove', 'touch', 31, 180, 170],
    ...stroke.slice(14),
    ['pointerup', 'touch', 31, 180, 170],
  ]);
  let after = await canvasState();
  expect(after.view).toEqual(before.view);
  expect(after.centreAlpha).toBeGreaterThan(200);
  expect(after.history).toBe(before.history + 1);

  // two palms rest first (a pan / pinch / rotate gesture), then the pen draws while they spread
  await newDoc();
  before = await canvasState();
  await send(canvas, [
    ['pointerdown', 'touch', 32, 100, 150],
    ['pointerdown', 'touch', 33, 140, 150],
    ...stroke.slice(0, 6),
    ['pointermove', 'touch', 32, 40, 200],
    ['pointermove', 'touch', 33, 220, 100],
    ...stroke.slice(6, -1),
    ['pointerup', 'touch', 32, 40, 200],
    ['pointerup', 'touch', 33, 220, 100],
    ...stroke.slice(-1),
  ]);
  after = await canvasState();
  expect(after.view).toEqual(before.view);
  expect(after.centreAlpha).toBeGreaterThan(200);
  expect(after.history).toBe(before.history + 1);

  // a quick two-palm tap under the pen is not the two-finger undo: the stroke above stays
  before = after;
  stroke = drag('pen', 21, -200, 200, 120, 0.8);
  await send(canvas, [
    ['pointerdown', 'touch', 34, 100, 250],
    ['pointerdown', 'touch', 35, 140, 250],
    ...stroke.slice(0, 3),
    ['pointerup', 'touch', 34, 100, 250],
    ['pointerup', 'touch', 35, 140, 250],
    ...stroke.slice(3),
  ]);
  after = await canvasState();
  expect(after.view).toEqual(before.view);
  expect(after.centreAlpha).toBeGreaterThan(200);
  expect(after.history).toBe(before.history + 1);
});
