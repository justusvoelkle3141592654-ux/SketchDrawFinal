// Input routing on the real canvas with synthetic pen and touch Pointer Events: pen-only mode,
// palm contacts before, during and after a pen stroke, pen hover, and the Input & Tablet diagnostics.
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

/**
 * Dispatches synthetic Pointer Events a few ms apart. They carry no coalesced samples. A pointermove
 * with pressure 0 is a hovering pen; pointerout (no related target) is the pen leaving hover range.
 */
async function send(selector: string, steps: Step[]) {
  await win.evaluate(
    async ([sel, list]) => {
      const el = document.querySelector(sel)!;
      const r = el.getBoundingClientRect();
      for (const [type, pointerType, pointerId, dx, dy, pressure = 0.5] of list) {
        const contact = type === 'pointerdown' || (type === 'pointermove' && pressure > 0);
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId,
            pointerType,
            isPrimary: pointerType === 'pen',
            clientX: r.left + r.width / 2 + dx,
            clientY: r.top + r.height / 2 + dy,
            pressure: contact ? pressure : 0,
            tiltX: pointerType === 'pen' ? 25 : 0,
            buttons: contact ? 1 : 0,
            button: type === 'pointermove' ? -1 : 0,
          }),
        );
        await new Promise((res) => setTimeout(res, 8));
      }
    },
    [selector, steps] as const,
  );
}

/** The pen leaves hover range: touch may navigate again in pen-only mode. */
const away: Step = ['pointerout', 'pen', 21, 0, 0];
/** The pen hovers over the canvas (in range, not touching). */
const hover = (dx: number, dy: number): Step => ['pointermove', 'pen', 21, dx, dy, 0];

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
    away,
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

async function newDoc() {
  await win.keyboard.press('Control+n');
  await win.selectOption('[data-testid=new-doc-preset]', 'square');
  await win.click('[data-testid=new-doc-create]');
  await expect(win.locator('[data-testid=new-doc-dialog]')).toHaveCount(0);
}

/** Pen-only stays on from the first test; switch it on when a test runs in a fresh app. */
async function penOnlyOn() {
  await win.keyboard.press('Control+,');
  await win.click('[data-testid=prefs-tab-input]');
  const penOnly = win.locator('[data-testid=pref-penonly]');
  if ((await penOnly.getAttribute('aria-checked')) !== 'true') await penOnly.click();
  await expect(penOnly).toHaveAttribute('aria-checked', 'true');
  await win.keyboard.press('Escape');
  await expect(win.locator('[data-testid=prefs-dialog]')).toHaveCount(0);
}

const canvas = '[data-testid=canvas]';

test('pen-only canvas: palms that land before the pen do not block it, move the view or undo', async () => {
  await newDoc();
  await penOnlyOn();

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
    away,
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
    away,
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
    away,
  ]);
  after = await canvasState();
  expect(after.view).toEqual(before.view);
  expect(after.centreAlpha).toBeGreaterThan(200);
  expect(after.history).toBe(before.history + 1);
});

test('pen-only canvas: palms that settle before the pen lands do not move the view', async () => {
  await newDoc();
  await penOnlyOn();
  const stroke = drag('pen', 21, -200, 200, 0, 0.8);

  // pen out of range: one palm lands and drifts 16 / 8 px, below the 24 px slop, then the pen draws
  let before = await canvasState();
  await send(canvas, [
    ['pointerdown', 'touch', 31, 150, 150],
    ['pointermove', 'touch', 31, 158, 154],
    ['pointermove', 'touch', 31, 166, 158],
    ...stroke,
    ['pointerup', 'touch', 31, 166, 158],
    away,
  ]);
  let after = await canvasState();
  expect(after.view).toEqual(before.view);
  expect(after.centreAlpha).toBeGreaterThan(200);
  expect(after.history).toBe(before.history + 1);

  // pen out of range: two palms 40 px apart settle (one moves ~21 px), then the pen draws
  await newDoc();
  before = await canvasState();
  await send(canvas, [
    ['pointerdown', 'touch', 32, 100, 150],
    ['pointerdown', 'touch', 33, 140, 150],
    ['pointermove', 'touch', 33, 160, 158],
    ['pointermove', 'touch', 32, 95, 148],
    ...stroke,
    ['pointerup', 'touch', 32, 95, 148],
    ['pointerup', 'touch', 33, 160, 158],
    away,
  ]);
  after = await canvasState();
  expect(after.view).toEqual(before.view);
  expect(after.history).toBe(before.history + 1);

  // the pen hovers first: palms are ignored however far they move, and a quick two-palm tap is no undo
  before = after;
  await send(canvas, [
    hover(-250, -40),
    ['pointerdown', 'touch', 34, 150, 150],
    hover(-245, -35),
    ['pointermove', 'touch', 34, 230, 200],
    ['pointerdown', 'touch', 35, 100, 250],
    ['pointerdown', 'touch', 36, 140, 250],
    hover(-240, -30),
    ['pointerup', 'touch', 35, 100, 250],
    ['pointerup', 'touch', 36, 140, 250],
    ['pointermove', 'touch', 34, 300, 120],
    ['pointerup', 'touch', 34, 300, 120],
    away,
  ]);
  after = await canvasState();
  expect(after.view).toEqual(before.view);
  expect(after.history).toBe(before.history);

  // a palm that lands while the pen is away and moves past the slop pans (it looks like a finger);
  // once the pen hovers the contact is a palm and further drift does nothing
  before = after;
  await send(canvas, [
    ['pointerdown', 'touch', 37, 150, 150],
    ['pointermove', 'touch', 37, 190, 150],
    hover(-250, 60),
    ['pointermove', 'touch', 37, 260, 210],
    ...drag('pen', 21, -200, 200, 60, 0.8),
    ['pointermove', 'touch', 37, 300, 240],
    ['pointerup', 'touch', 37, 300, 240],
    away,
  ]);
  after = await canvasState();
  expect(after.view.panX - before.view.panX).toBeCloseTo(40, 5);
  expect(after.view.panY).toBe(before.view.panY);
  expect(after.view.zoom).toBe(before.view.zoom);
  expect(after.history).toBe(before.history + 1);

  // with the pen away, deliberate navigation works: one-finger pan, two-finger pinch, two-finger tap undo
  before = after;
  await send(canvas, drag('touch', 38, -150, 50, 250));
  after = await canvasState();
  expect(after.view.panX - before.view.panX).toBeCloseTo(200, 5);
  before = after;
  await send(canvas, [
    ['pointerdown', 'touch', 39, 100, 150],
    ['pointerdown', 'touch', 40, 140, 150],
    ['pointermove', 'touch', 40, 240, 150],
    ['pointerup', 'touch', 39, 100, 150],
    ['pointerup', 'touch', 40, 240, 150],
  ]);
  after = await canvasState();
  expect(after.view.zoom / before.view.zoom).toBeCloseTo(3.5, 5);
  expect(after.history).toBe(before.history);
  before = after;
  await send(canvas, [
    ['pointerdown', 'touch', 41, 100, 150],
    ['pointerdown', 'touch', 42, 140, 150],
    ['pointerup', 'touch', 41, 100, 150],
    ['pointerup', 'touch', 42, 140, 150],
  ]);
  after = await canvasState();
  expect(after.history).toBe(before.history - 1);

  // a pen that stops reporting without leaving range counts as away after 0.5 s
  await send(canvas, [hover(-250, 0)]);
  await win.waitForTimeout(700);
  before = await canvasState();
  await send(canvas, drag('touch', 43, -150, 50, 250));
  after = await canvasState();
  expect(after.view.panX - before.view.panX).toBeCloseTo(200, 5);
});

test('pen-only canvas: palms stay palms after the pen lifts; cancelled contacts are no tap', async () => {
  await newDoc();
  await penOnlyOn();
  const stroke = drag('pen', 21, -200, 200, 0, 0.8);
  const uiPointer = () =>
    win.evaluate(() => {
      const hooks = (window as unknown as { __cforge: unknown }).__cforge as {
        useUi: { getState: () => { pointer: { x: number; y: number } } };
      };
      const r = document.querySelector('[data-testid=canvas]')!.getBoundingClientRect();
      const p = hooks.useUi.getState().pointer;
      return { dx: p.x - r.width / 2, dy: p.y - r.height / 2 };
    });

  // a palm lands mid-stroke and stays; after the pen lifts and leaves another contact taps quickly:
  // that is not a two-finger tap (undo), and the palm's drift does not move the brush outline
  let before = await canvasState();
  await send(canvas, [...stroke.slice(0, 5), ['pointerdown', 'touch', 34, 150, 150], ...stroke.slice(5)]);
  await send(canvas, [['pointermove', 'touch', 34, 170, 160]]);
  const outline = await uiPointer();
  expect(outline.dx).toBeCloseTo(200, 5);
  expect(outline.dy).toBeCloseTo(0, 5);
  await send(canvas, [
    away,
    ['pointerdown', 'touch', 35, 190, 150],
    ['pointerup', 'touch', 35, 190, 150],
    ['pointerup', 'touch', 34, 170, 160],
  ]);
  let after = await canvasState();
  expect(after.view).toEqual(before.view);
  expect(after.centreAlpha).toBeGreaterThan(200);
  expect(after.history).toBe(before.history + 1);

  // two palms the pen took over; after it lifts one palm lands again: the new contact is a finger
  // (it pans by its own drift) but never pairs with the remaining palm for a pinch / rotate
  await newDoc();
  before = await canvasState();
  await send(canvas, [
    ['pointerdown', 'touch', 37, 100, 150],
    ['pointerdown', 'touch', 38, 140, 150],
    ...stroke,
    away,
    ['pointerup', 'touch', 38, 140, 150],
    ['pointerdown', 'touch', 39, 142, 151],
    ['pointermove', 'touch', 39, 190, 170],
    ['pointermove', 'touch', 37, 90, 160],
    ['pointerup', 'touch', 37, 90, 160],
    ['pointerup', 'touch', 39, 190, 170],
  ]);
  after = await canvasState();
  expect(after.view.zoom).toBe(before.view.zoom);
  expect(after.view.rotation).toBe(before.view.rotation);
  expect(after.view.panX - before.view.panX).toBeCloseTo(48, 5);
  expect(after.view.panY - before.view.panY).toBeCloseTo(19, 5);
  expect(after.history).toBe(before.history + 1);

  // Windows reports a contact it rejects as palm with pointercancel: two cancelled contacts are no undo
  before = after;
  await send(canvas, [
    ['pointerdown', 'touch', 40, 100, 150],
    ['pointerdown', 'touch', 41, 140, 150],
    ['pointercancel', 'touch', 40, 100, 150],
    ['pointercancel', 'touch', 41, 140, 150],
  ]);
  after = await canvasState();
  expect(after.history).toBe(before.history);
});

test('pen-only canvas: a pen the tool refuses does not stop a finger pan', async () => {
  await newDoc();
  await penOnlyOn();
  const lock = (locked: boolean) =>
    win.evaluate((v) => {
      const hooks = (window as unknown as { __cforge: unknown }).__cforge as {
        activeSession: () => { doc: { activeLayer: { locked: boolean } } };
      };
      hooks.activeSession().doc.activeLayer.locked = v;
    }, locked);
  await lock(true);
  // a finger pans; halfway the pen lands on the locked layer (refused) and lifts; the pan goes on
  const before = await canvasState();
  const pan = drag('touch', 44, -150, 50, 250);
  await send(canvas, [
    ...pan.slice(0, 11),
    ['pointerdown', 'pen', 21, -200, 0, 0.8],
    ['pointermove', 'pen', 21, -150, 0, 0.8],
    ['pointerup', 'pen', 21, -150, 0],
    ...pan.slice(11),
    away,
  ]);
  const after = await canvasState();
  await lock(false);
  expect(after.view.panX - before.view.panX).toBeCloseTo(200, 5);
  expect(after.history).toBe(before.history);
  expect(after.tiles).toBe(before.tiles);
});
