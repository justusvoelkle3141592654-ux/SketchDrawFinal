# Canvas Forge

**A tablet-native digital sketchbook with deep brush control and a calm, modern workspace.**

Canvas Forge is an offline raster drawing and painting application for Windows 11, built with Electron, React and TypeScript on an original tiled pixel engine. No account, no telemetry, no network access; artwork stays on your computer.

> Status and verified results: see [PROGRESS.md](PROGRESS.md). User documentation: [USER_GUIDE.md](USER_GUIDE.md).

## Requirements

* Node.js 22 and npm 10
* Windows 10/11 x64 to run the packaged app (development also works on Linux and macOS)

## Commands

| Command | What it does |
|---|---|
| `npm install` | Installs dependencies. The project-local `.npmrc` sets `legacy-peer-deps=true` (works around an npm 10 crash while resolving Vitest's optional peers). If `node_modules/electron/dist` is missing afterwards, run `node node_modules/electron/install.js`. |
| `npm run dev` | Vite dev server + esbuild watch + Electron |
| `npm run build` | Production build into `dist/` |
| `npm start` | Build and launch Electron |
| `npm run lint` | ESLint (zero warnings allowed) |
| `npm run typecheck` | TypeScript for renderer, main/preload and tests |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Build, then Electron + Playwright smoke test (uses `xvfb-run` automatically on Linux without a display) |
| `npm run perf` | Engine benchmarks (prints timings) |
| `npm run package:win` | Windows NSIS installer + portable `.exe` into `release/` (on Linux this needs Wine, including 32-bit support, for the NSIS uninstaller stub and the executable's icon/version resources; on Windows no extra tools are needed) |
| `npm run package:linux-dir` | Unpacked Linux build (used to launch-test the packaged app on Linux) |

`scripts/render-icons.mjs` regenerates `build/icon.png` and `build/icon.ico` from `build/icon.svg` (needs Playwright's Chromium and ImageMagick).

## Project layout

```
src/main/       Electron main process (windows, dialogs, atomic file IO, app data, recovery)
src/preload/    sandboxed preload exposing the typed `window.forge` API
src/shared/     IPC contract and .cforge validation shared by main and renderer
src/renderer/   React UI, Zustand stores, pixel engine, tools
tests/unit/     engine unit tests
tests/e2e/      Electron smoke test
tests/perf/     engine benchmarks
docs/           architecture, file format, performance, tablet testing
build/          original icon sources and generated icons
reference/ui/   third-party reference screenshots (research only, never packaged)
```

## Documentation

* [PLAN.md](PLAN.md) — architecture plan, milestones, risks, trade-offs
* [docs/architecture.md](docs/architecture.md) — processes, engine, compositing and colour policy
* [docs/file-format.md](docs/file-format.md) — `.cforge` and `.cforge-brushpack`
* [docs/performance.md](docs/performance.md) — measured engine performance
* [docs/tablet-testing.md](docs/tablet-testing.md) — manual hardware checklist and tested status
* [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) — licences

## Originality

The name Canvas Forge, its icon, interface design, icon set, brush presets, textures and palettes are original. The application is not affiliated with, or a reproduction of, any other drawing product. The screenshots in `reference/ui/` were used only to study general workflow.
