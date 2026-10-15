// Bundles the Electron main process and the sandboxed preload script with esbuild.
import { build, context } from 'esbuild';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const watch = process.argv.includes('--watch');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  sourcemap: watch ? 'inline' : false,
  external: ['electron'],
  logLevel: 'info',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
};

const targets = [
  {
    ...common,
    entryPoints: [resolve(root, 'src/main/main.ts')],
    outfile: resolve(root, 'dist/main/main.js'),
    format: 'cjs',
  },
  // Sandboxed preloads must be a single CommonJS file that only requires 'electron'.
  {
    ...common,
    entryPoints: [resolve(root, 'src/preload/preload.ts')],
    outfile: resolve(root, 'dist/preload/preload.js'),
    format: 'cjs',
  },
];

mkdirSync(resolve(root, 'dist/main'), { recursive: true });
// dist/main is CommonJS even though the repository root is an ES module package.
writeFileSync(resolve(root, 'dist/main/package.json'), '{ "type": "commonjs" }\n');
mkdirSync(resolve(root, 'dist/preload'), { recursive: true });
writeFileSync(resolve(root, 'dist/preload/package.json'), '{ "type": "commonjs" }\n');

if (watch) {
  for (const t of targets) {
    const ctx = await context(t);
    await ctx.watch();
  }
} else {
  await Promise.all(targets.map((t) => build(t)));
}
