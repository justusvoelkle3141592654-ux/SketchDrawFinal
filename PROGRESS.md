# Progress log

Build host for all results below: Linux x86_64 cloud VM (4 vCPU, Xeon 2.8 GHz), Node 22.22.0, npm 10.9.4, Xvfb. No Windows machine, no pen or touch hardware.

---

## Milestone 0 — product shell ✅ / Milestone 1 — usable drawing core ✅

### Completed

* Tooling: Electron 43.7.7, React 19.3, TypeScript 5.9 (strict), Vite 8 (renderer), esbuild (main/preload bundles), Zustand 5, ESLint 10 + typescript-eslint, Prettier, Vitest 4, Playwright 1.56 (Electron E2E).
* Secure Electron shell: context isolation, sandboxed preload, no Node in the renderer, validated IPC, build-time CSP, blocked navigation/new windows/permissions, path-grant model for writes, single instance + file open from the command line, window-state persistence, hidden title bar with native window-controls overlay.
* Workspace shell with original visual system (graphite surfaces, teal→violet accent, original SVG icon set and app icon): document tabs with unsaved markers, grouped command bar, tool rail, dockable/floating/resizable/collapsible panels with layout persistence and reset, status bar, start screen with recent files, Focus Canvas with restore control, Orbit radial menu, size/opacity puck and navigation puck, tooltips with shortcuts, toasts, accessible modal dialogs, compact/roomy density, dark/light theme, left-handed layout, command registry, customisable shortcuts, persisted preferences.
* Engine: sparse 256² tiles, straight-RGBA storage with premultiplied float compositing, 9 blend modes + erase, groups (pass-through/isolated), clipping, layer masks, dirty-rect compositor with fast path, float stroke buffer, dab rasteriser (round LUT tips, generated/image tips with mips, procedural textures), dynamics, stabiliser, Catmull–Rom interpolation, spacing resampler, predictive stroke, symmetry transforms, undo/redo with tile diffs and a memory budget.
* Drawing core: pressure brush + eraser, mouse fallback pressure, pen eraser tip, Shift+click lines, brush outline cursor, eyedropper with loupe, pan/zoom/rotate tools, wheel/touchpad/gesture navigation, Space/Alt hold modes, pixel grid ≥ 800 %, mirror view.
* Layers panel: add, group, rename, visibility, drag & drop reorder (incl. into groups), opacity (one undo step per drag), blend mode, duplicate, delete, merge down/visible, flatten copy, clear, alpha lock, clip, lock, masks, colour labels, thumbnails, active indication.
* Documents: New Canvas dialog (presets, custom size, DPI, orientation swap, transparent/white/colour background, memory estimate and warning), multiple tabs, save/discard/cancel confirmation, recent files, recovery snapshots + recovery dialog, `.cforge` save/open (ZIP, versioned manifest, atomic write with validation, readable errors, warnings for damaged tiles), import PNG/JPEG/WebP as layer (fit or full size), open images as documents, export PNG (own lossless encoder)/JPEG/WebP with quality, scale and transparency options and a name template, drag & drop of documents/images/brush packs.
* Already present from Milestone 2 scope: colour editor (hue ring + SV square, HSV/RGB sliders, hex, alpha, recents, harmonies), palettes panel (built-in + user palettes, GIMP `.gpl` import, palette from canvas), brush library (37 original presets in 6 categories, stamps rendered by the engine, favourites, search, categories, drag order, rename, duplicate, delete, pack import/export with collision dialog, restore factory), Preferences (general, Input & Tablet with ≥5-point curve editor, presets, preview, dead zone, button mappings, diagnostics; strokes; Orbit; shortcuts editor; files & memory).

### Files

`package.json`, `.npmrc`, `tsconfig*.json`, `eslint.config.js`, `.prettierrc.json`, `vite.config.ts`, `vitest*.config.ts`, `playwright.config.ts`, `electron-builder.yml`, `scripts/*`, `src/main/*`, `src/preload/*`, `src/shared/*`, `src/renderer/**`, `tests/unit/*`, `tests/e2e/smoke.spec.ts`, `tests/perf/engine.perf.ts`, `build/icon.*`, `docs/*`, `README.md`, `USER_GUIDE.md`, `RELEASE_NOTES.md`, `THIRD_PARTY_NOTICES.md`, `PLAN.md`, `reference/ui/*`.

### Commands run and results

| Command | Result |
|---|---|
| `npm run lint` | 0 errors, 0 warnings |
| `npm run typecheck` | passes (renderer, main/preload/e2e, tests) |
| `npm test` | 7 files, 62 tests passed |
| `npm run test:e2e` | 2 Electron tests passed under Xvfb: (1) new → draw → add layer → draw → undo/redo → save → close → reopen (layers and pixels verified) → export PNG (header and 2048×2048 size verified); (2) unsaved-changes prompt: Cancel keeps, Don't save closes |
| `npm run perf` | see `docs/performance.md` (measured engine timings) |
| `npx prettier --check .` | clean |
| Manual (Xvfb screenshots) | start screen, New Canvas dialog, drawing with the default brush render correctly |

### Risks / open points

* Windows build not yet produced or launched (planned in the packaging step; no Windows host here).
* No pen/touch hardware: tablet paths verified by unit tests on synthetic samples only.
* Round Bristle (60 px mixing brush) costs ~12 ms per 4-sample event on the build VM.

### Next concrete action

Milestone 2: full Brush Lab (all sections, live test area, tip import, save/clone/reset), remaining daily-workflow polish (Orbit configuration UI checks, auto-hide panels), then Milestone 3 selection/transform/fill/shapes/text.
