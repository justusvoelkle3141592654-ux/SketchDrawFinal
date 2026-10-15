// Renders build/icon.svg to PNG sizes with Chromium (Playwright) and packs a Windows .ico (ImageMagick).
// Usage: node scripts/render-icons.mjs   (requires Playwright's Chromium and ImageMagick `convert`)
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const svg = readFileSync(resolve(root, 'build/icon.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
for (const s of sizes) {
  await page.setViewportSize({ width: s, height: s });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace('width="512" height="512"', `width="${s}" height="${s}"`)}</body></html>`,
  );
  await page.screenshot({
    path: resolve(root, `build/icon-${s}.png`),
    omitBackground: true,
    clip: { x: 0, y: 0, width: s, height: s },
  });
}
await browser.close();
execFileSync('cp', [resolve(root, 'build/icon-512.png'), resolve(root, 'build/icon.png')]);
execFileSync(
  'convert',
  [16, 24, 32, 48, 64, 128, 256]
    .map((s) => resolve(root, `build/icon-${s}.png`))
    .concat(resolve(root, 'build/icon.ico')),
);
for (const s of sizes) execFileSync('rm', [resolve(root, `build/icon-${s}.png`)]);
console.log('icons written');
