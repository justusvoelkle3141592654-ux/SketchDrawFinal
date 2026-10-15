// Runs the Electron E2E suite. On Linux without a display it wraps Playwright in xvfb-run.
import { spawnSync } from 'node:child_process';

const args = ['playwright', 'test', ...process.argv.slice(2)];
const needsXvfb = process.platform === 'linux' && !process.env.DISPLAY;
const cmd = needsXvfb ? 'xvfb-run' : 'npx';
const full = needsXvfb ? ['-a', '-s', '-screen 0 1440x900x24', 'npx', ...args] : args;
const r = spawnSync(cmd, full, { stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(r.status ?? 1);
