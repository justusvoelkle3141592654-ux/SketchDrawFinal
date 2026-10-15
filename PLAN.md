# Canvas Forge — Implementation Plan

Canvas Forge is an original, offline, tablet-first raster drawing application for Windows 11, built with Electron, React, TypeScript and a custom tiled CPU pixel engine.

## 1. Starting point

- Repository state at start: empty git repository on branch `claude/sharp-johnson-52e6be`, no commits, no existing code.
- Build host: Linux x86_64 cloud container (Node 22.22, npm 10.9, Xvfb available, no Wine, no Windows machine, no pen/touch hardware).
- Consequence: Windows packages are cross-built on Linux. The packaged Windows `.exe` cannot be launched here; that is recorded as untested until run on Windows.

## 2. Reference analysis (`reference/ui/`)

The five screenshots show a mature drawing application. Functional observations used for the workflow (not for visuals):

| File | Functional takeaway |
|---|---|
| `01-custom-colors-panel.png` | Palette panel with two modes: swatch collections (category column + grid, prev/next collection) and image-derived palettes. Current colour shown as a large swatch. |
| `02-brush-palette.png` | Narrow two-column brush rail with large tool glyphs, a header with "properties" and "library" buttons; brushes differ strongly in stroke character (pencil, ink, airbrush, textured, bristle). |
| `03-radial-quick-menu.jpg` | Corner radial quick menu holding undo/redo, colour, brush, selection and puck access. |
| `04-workspace-mac.webp` | Single-row command bar, brush rail on the left, two on-canvas pucks, layer panel right (blend mode + opacity), radial menu lower-left; canvas dominates. |
| `05-workspace-windows.jpg` | Same workflow on Windows: colour editor and layer editor docked right, tool rail left, toolbar with document list. |

Canvas Forge keeps the workflow ideas (dominant canvas, slim rails, pucks, radial quick access, docked editors) but uses its own name, dark graphite visual system, teal-to-violet accent, original SVG icon set, its own radial control ("Orbit", a full pie ring around a hub rather than a corner quarter ring), and its own brush names and procedural brush data.

## 3. Architecture

```
Electron main process (Node)          Preload (sandboxed)            Renderer (React + engine)
- window, titlebar overlay            - contextBridge API "forge"    - React UI (workspace, panels, dialogs)
- native dialogs                      - typed, validated IPC calls   - Zustand stores
- file IO (atomic write, validate)                                   - Pixel engine (pure TS, no DOM in core)
- preferences / brushes / recents                                    - Canvas 2D view renderer
- recovery store, clipboard                                          - Pointer/tablet input pipeline
```

- **Security:** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, CSP, navigation and new windows blocked, permission requests denied. The preload exposes a small API; main validates every argument. Write access is only granted to paths obtained from native dialogs, the recent-files list, or the app's own data directory.
- **Engine (renderer, `src/renderer/engine`)** is DOM-free TypeScript so it runs under Vitest in Node: tiles, layers, compositing, brush rasteriser, stroke pipeline, history, selection, file format, PNG codec.
- **State:** Zustand stores split into `documents` (sessions + revisions), `history` (exposed through sessions), `ui`, `input`, `preferences`, plus `brushes` and `colour`. Heavy pixel data lives in mutable engine objects outside React state; stores hold revision counters that trigger re-render.

## 4. Project tree (target)

```
src/main/            main.ts, ipc.ts, files.ts (atomic IO), store.ts (prefs/brushes/recents), recovery.ts
src/preload/         preload.ts
src/shared/          ipc contract types, validation helpers, constants
src/renderer/
  engine/            math, color, tiles, layers, document, compositing, brush/*, stroke/*, history, selection, io/*
  state/             zustand stores
  input/             pointer normalisation, pressure curve, gestures
  render/            view renderer (composite canvas + overlays)
  tools/             tool controllers (brush, eraser, fill, select, transform, shapes, text …)
  ui/                components, panels, dialogs, icons
  styles/            tokens + component CSS
tests/unit/          Vitest suites for engine modules
tests/e2e/           Playwright + Electron smoke test
docs/                architecture, tablet-testing, performance, file-format
build/               original icon sources and generated .ico/.png
reference/ui/        third-party reference screenshots (research only, never packaged)
```

## 5. Milestone order

0. Product shell: tooling, secure Electron, docs skeletons, workspace shell, panels, tabs, command registry, shortcuts, tooltips, theme, density, persisted preferences.
1. Usable drawing core: new-document dialog, tabs + unsaved handling, tiled document, hard-round pressure brush, eraser, mouse fallback, pan/zoom/rotate, undo/redo, layers panel, `.cforge` save/open (atomic), import PNG/JPEG/WebP, export PNG/JPEG/WebP, smoke test.
2. Daily art workflow: colour editor, palettes, eyedropper, brush library with 36 presets, pucks, Brush Lab, brush packs, tablet preferences + diagnostics, stabiliser, predictive stroke, Orbit, Focus Canvas, left-handed mode.
3. Edit/selection/layer power: selections, clipboard, transform, crop/resize/rotate, guides, symmetry, shapes, fill, gradient, text, groups, masks, clipping, merges, adjustments.
4. Polish: docking/floating, layouts, preferences, full screen, reference-image panel, autosave/recovery, accessibility audit, performance profiling.
5. Animation and interoperability: flipbook, onion skin, PNG sequence/GIF export, time-lapse; PSD/TIFF only if time allows (optional).

Each milestone ends with lint, typecheck, unit tests, a build, an update to `PROGRESS.md`, and a commit + push.

## 6. Graphics strategy

- **Tiles:** each raster layer is a sparse map of 256×256 tiles (tile size stored per document; 256 or 512). Pixels are straight (non-premultiplied) RGBA8 — identical to PNG and `ImageData`, so file and clipboard round trips are lossless. Masks and selections are 8-bit single-channel tiles.
- **Compositing math** converts to premultiplied float per pixel, blends, and converts back. All resampling (transform, resize, rotate) interpolates in premultiplied space to avoid dark fringes. Blend modes: Normal, Multiply, Screen, Overlay, Add, Darken, Lighten, Colour, Luminosity (+ Erase for the eraser).
- **Strokes** paint into a temporary premultiplied Float32 stroke buffer (sparse tiles). The active layer is displayed as `layer ⊕ strokeBuffer·opacity`; on pointer-up the buffer is committed once. This gives flow build-up within a stroke, per-stroke opacity caps, 8-bit-safe low-flow airbrushing and cheap cancel. Smudge/blender brushes paint directly into the layer with copy-on-write snapshots.
- **Dirty rectangles:** every dab marks a document rectangle dirty. The compositor recomposites only those rectangles (split at tile boundaries) into a document-sized composite canvas with `putImageData` sub-rects. During a stroke, "below" and (when blend modes allow) "above" stacks are cached per tile, so cost does not scale with layer count.
- **View:** the visible `<canvas>` draws the composite canvas with one affine transform (pan, zoom 6.25 %–6400 %, arbitrary rotation, mirror). One composite surface avoids tile seams. Pixel grid appears from 800 %. Overlays (selection, guides, cursor, transform handles) are drawn on top.
- **WebGL/WebGPU:** not used initially. Canvas 2D `drawImage` already runs on the GPU for the view; the CPU engine keeps results deterministic and unit-testable. Revisit only with profiling evidence.
- **Large documents:** memory is estimated in the New Document dialog (layers × w × h × 4 bytes + composite + history budget). Risky sizes show a warning; the composite surface is capped by Chromium's canvas limits (dimension ≤ 16 384 px enforced), never silently downsampled.

## 7. Tablet-input strategy

- Pointer Events on the canvas with `touch-action: none`, pointer capture per stroke, `getCoalescedEvents()` when present.
- A normaliser converts each sample to `{x, y, pressure, tiltX, tiltY, altitude, azimuth, twist, tangentialPressure, width, height, pointerType, buttons, timestamp}`; missing values fall back (mouse pressure = configurable constant, neutral tilt).
- Pressure curve: monotone cubic spline through ≥5 user-editable points, plus dead-zone threshold. Barrel/eraser buttons mapped via preferences.
- Only one active drawing pointer; other pointers are ignored during a stroke; `pointercancel`/`lostpointercapture` commit the stroke so far and reset state, so no line can connect two separate strokes.
- Pen-only mode: touch never paints; two-finger pan/pinch/rotate stays available.
- Honest status: Windows Ink devices arrive in Chromium as Pointer Events. No vendor SDK (Wintab) integration; no hardware testing possible in this environment. `docs/tablet-testing.md` contains the manual checklist.

## 8. Persistence strategy

- **Documents:** `.cforge` = ZIP (fflate) with `manifest.json`, `document.json`, raw deflated tile data per layer/mask, `preview.png`, `thumbnail.png`, `resources/brushes.json`. Versioned with migrations; newer versions refuse to open with a readable message. Spec in `docs/file-format.md`.
- **Atomic save:** renderer produces bytes → main writes `<name>.cforge.tmp-<random>` in the target directory, fsyncs, re-reads and validates the ZIP + manifest, then renames over the target (with retry on Windows sharing violations). On failure the original stays untouched and the temp file is removed.
- **App data** (userData): `preferences.json`, `brushes.json` (user presets), `palettes.json`, `recent.json`, `recovery/` — all written atomically by main.
- **Autosave/recovery:** debounced background snapshot of dirty documents into `recovery/`; offered on next launch; deleted after a successful save or clean close.

## 9. Risks

| Risk | Mitigation |
|---|---|
| CPU compositing too slow on large brushes / many layers | dirty sub-rects, stroke caches, sparse tiles; profile and document; WebGL path later only if measured need |
| No Windows host to launch the `.exe` | Cross-build with electron-builder; launch-test the Linux build of the same code; mark Windows launch as untested |
| No pen hardware | Unit-test the normalisation and curves with synthetic samples; manual checklist for real hardware |
| 8-bit precision for low-flow strokes | float stroke buffer; commit once per stroke |
| Canvas `getImageData` premultiplies (lossy semi-transparent pixels) | own PNG encoder for export; raw tiles in `.cforge`; own PNG decoder where practical |
| Scope is very large | strict milestone order, vertical slices, honest Implemented/Partial/Not implemented table |

## 10. Accepted trade-offs

- 8 bits per channel RGBA, sRGB, no colour management (documented).
- CPU raster engine; GPU used for the view transform only.
- The Windows `.exe` is unsigned (no code-signing certificate). Its icon and version resources are set with rcedit, which on a Linux build host needs Wine.
- PSD/TIFF are optional and only added if fidelity can be verified.
- Electron E2E runs on Linux under Xvfb with mouse input; pen paths are covered by unit tests on synthetic samples.
