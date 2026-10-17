// Emulator check for the Android app: installs the (debuggable) APK, opens a new canvas inside the
// WebView, draws a stroke with a real touch gesture and checks that it reached the layer, without page
// errors or crashes. Screenshots and the log go to <output-dir> for the CI artifact.
// Usage: node scripts/android-smoke.mjs <apk> <output-dir>
import { _android as android } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [apk, out] = process.argv.slice(2);
const pkg = 'app.canvasforge';
mkdirSync(out, { recursive: true });

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

let device;
let failed = false;
try {
  adb('install', '-r', apk);
  adb('logcat', '-c');
  [device] = await android.devices();
  if (!device) throw new Error('No Android device found.');
  console.log('Device:', device.model(), device.serial());
  await device.shell(`am start -W -n ${pkg}/.MainActivity`);

  const webview = await device.webView({ pkg }, { timeout: 90_000 });
  const page = await webview.page();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`);
  });

  await page.waitForSelector('[data-ready=true]', { timeout: 60_000 });
  console.log('WebView:', await page.evaluate(() => navigator.userAgent));
  await page.click('[data-testid=start-new]');
  await page.click('[data-testid=new-doc-create]');
  await page.waitForSelector('[data-testid=doc-tab]');
  await page.waitForTimeout(1000);
  writeFileSync(join(out, '1-new-canvas.png'), await device.screenshot());

  // A finger stroke across the middle of the screen, which is inside the canvas area.
  const size = /(\d+)x(\d+)/.exec(adb('shell', 'wm', 'size').trim().split('\n').pop());
  const [w, h] = [Number(size[1]), Number(size[2])];
  const y = Math.round(h * 0.55);
  adb(
    'shell',
    'input',
    'swipe',
    String(Math.round(w * 0.25)),
    String(y),
    String(Math.round(w * 0.55)),
    String(y),
    '600',
  );
  await page.waitForTimeout(1500);
  writeFileSync(join(out, '2-after-stroke.png'), await device.screenshot());

  const painted = await page.evaluate(() => {
    const s = globalThis.__cforge.activeSession();
    const layer = s.doc.activeLayer;
    let n = 0;
    for (let yy = 0; yy < s.doc.height; yy += 4)
      for (let xx = 0; xx < s.doc.width; xx += 4) if (layer.pixels.getPixel(xx, yy)[3] > 0) n++;
    return { layer: layer.name, sampledPixels: n };
  });
  console.log('Painted:', JSON.stringify(painted));
  if (painted.sampledPixels === 0) throw new Error('The touch stroke left no pixels on the layer.');
  if (errors.length) throw new Error(`Errors in the page:\n${errors.join('\n')}`);
  const running = (await device.shell(`pidof ${pkg}`)).toString().trim();
  if (!running) throw new Error('The app is no longer running.');
  console.log('OK: the app started, a canvas was created and a touch stroke was painted.');
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  try {
    if (device) writeFileSync(join(out, 'final.png'), await device.screenshot());
    writeFileSync(join(out, 'logcat.txt'), adb('logcat', '-d'));
    if (adb('logcat', '-d').includes('FATAL EXCEPTION')) {
      failed = true;
      console.error('The log contains a FATAL EXCEPTION (see logcat.txt).');
    }
  } catch (e) {
    console.error('Could not collect diagnostics:', e.message);
  }
  await device?.close();
}
process.exit(failed ? 1 : 0);
