// Development runner: Vite dev server for the renderer, esbuild watch for main/preload, then Electron.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..');
const server = await createServer({ configFile: resolve(root, 'vite.config.ts') });
await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5183/';

const builder = spawn(process.execPath, [resolve(root, 'scripts/build-electron.mjs'), '--watch'], {
  stdio: 'inherit',
});
await new Promise((r) => setTimeout(r, 1500));

const electron = spawn(String(electronPath), [root], {
  stdio: 'inherit',
  env: { ...process.env, CFORGE_DEV_SERVER_URL: url },
});
electron.on('exit', async () => {
  builder.kill();
  await server.close();
  process.exit(0);
});
