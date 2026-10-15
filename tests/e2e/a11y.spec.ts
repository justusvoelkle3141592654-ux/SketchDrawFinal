// Accessibility regression test: axe-core (WCAG 2.x A/AA + best practices) on the main UI states.
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

type HookWindow = Window & {
  __cforge: { useUi: { getState: () => { tool: string } }; runCommand: (id: string) => void };
};

let app: ElectronApplication;
let win: Page;
let dir: string;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cforge-a11y-'));
  app = await electron.launch({
    args: ['.', '--no-sandbox'],
    env: { ...process.env, CFORGE_USER_DATA_DIR: join(dir, 'userdata'), CFORGE_ALLOW_MULTI_INSTANCE: '1' },
  });
  win = await app.firstWindow();
  await win.waitForSelector('[data-ready=true]');
  // evaluated through the debugger protocol, so the page's CSP does not apply
  await win.evaluate(axeSource);
});

test.afterAll(async () => {
  const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()));
  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => undefined);
  await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

async function violations(): Promise<string[]> {
  return win.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            ctx: Document,
            o: object,
          ) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }>;
        };
      }
    ).axe;
    const r = await axe.run(document, {
      resultTypes: ['violations'],
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
      },
    });
    return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  });
}

test('main UI states have no axe violations (dark and light, compact and roomy)', async () => {
  expect(await violations()).toEqual([]);
  await win.keyboard.press('Control+n');
  await win.waitForSelector('[data-testid=new-doc-dialog]');
  expect(await violations()).toEqual([]);
  await win.click('[data-testid=new-doc-create]');
  await win.waitForTimeout(300);
  expect(await violations()).toEqual([]);
  await win.keyboard.press('Control+,');
  await win.waitForTimeout(200);
  expect(await violations()).toEqual([]);
  await win.keyboard.press('Escape');
  await win.keyboard.press('Control+b');
  await win.waitForTimeout(300);
  expect(await violations()).toEqual([]);
  await win.keyboard.press('Escape');
  // tool flyout (right-click) and the command-bar overflow menu
  await win.click('[data-testid=rail-group-select]', { button: 'right' });
  await win.waitForSelector('[data-testid=flyout-select]');
  expect(await violations()).toEqual([]);
  await win.click('[data-testid=flyout-select] >> text=Magic wand');
  expect(await win.evaluate(() => (window as unknown as HookWindow).__cforge.useUi.getState().tool)).toBe(
    'select-wand',
  );
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 700));
  await expect(win.locator('[data-testid=cmd-more]')).toBeVisible();
  await win.click('[data-testid=cmd-more]');
  await win.waitForSelector('.more-menu');
  expect(await violations()).toEqual([]);
  await win.keyboard.press('Escape');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  // animation panel with two frames, the export dialog and the time-lapse dialog
  await win.evaluate(() => (window as unknown as HookWindow).__cforge.runCommand('anim.toggle'));
  await win.keyboard.press('Control+Alt+n');
  await win.waitForSelector('[data-testid=frame-card]');
  expect(await violations()).toEqual([]);
  await win.evaluate(() => (window as unknown as HookWindow).__cforge.runCommand('anim.export'));
  await win.waitForSelector('[data-testid=animation-export-dialog]');
  expect(await violations()).toEqual([]);
  await win.keyboard.press('Escape');
  await win.evaluate(() => (window as unknown as HookWindow).__cforge.runCommand('timelapse.view'));
  await win.waitForSelector('[data-testid=timelapse-dialog]');
  expect(await violations()).toEqual([]);
  await win.keyboard.press('Escape');
  await win.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  expect(await violations()).toEqual([]);
  await win.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.density = 'roomy';
  });
  expect(await violations()).toEqual([]);
});
