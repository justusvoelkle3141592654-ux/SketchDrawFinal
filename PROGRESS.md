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

---

## Milestone 2 — daily art workflow ✅

### Completed

* Brush Lab (`Ctrl+B`): sections for tip, stroke, dynamics (editable curves), texture, colour and mixing; live stamp preview; name/category/engine; dirty state; save, save as new, reset to saved or to factory; greyscale tip and texture import from images; test area with white/grey/black/transparent backgrounds, pen/mouse drawing and replayable test strokes.
* Everything else in the milestone (colour editor, palettes, eyedropper, 37-preset library, pucks, brush packs, tablet preferences and diagnostics, stabiliser, predictive stroke, Orbit, Focus Canvas, left-handed mode) was already delivered with M0/M1 (see above).

### Verification

* `npm run lint`, `npm run typecheck`, `npm test` (62 tests), `npm run test:e2e` (2 tests) passed before the Brush Lab commit `42c3c58`.
* Xvfb screenshots checked: Brush Lab tip and dynamics tabs with replayed test strokes, Preferences → Input & Tablet, the Orbit ring, and eight presets drawn side by side on the canvas.

---

## Milestone 3 — edit, selection and layer power ✅

### Completed

* Selections: rectangle, ellipse, freehand lasso, polygonal lasso, magic wand (tolerance, contiguous, active layer or all layers); replace/add/subtract/intersect via tool options or Shift/Alt; anti-aliasing; feather (radius prompt); expand/contract; select all, deselect, invert; animated outline (stripe pattern that stays visible on diagonal edges); selections are undoable steps and are stored in `.cforge`.
* Clipboard: cut, copy, copy merged, paste as floating pixels (transform frame, Enter/Esc), paste as new layer; PNG on the system clipboard; fill selection with the foreground colour (`Shift+Backspace`); selection-aware clear.
* Transform tool: move, scale (Shift ratio, Alt centre), stretch, rotate (handle or outside), free corner distortion with a projective (homography) resample, arrow-key nudge, numeric X/Y/W/H/angle entry, flip and 90° buttons, Enter/Esc, Apply/Cancel; resampling in premultiplied space with a box prefilter for strong reductions; the selection follows the transformed pixels; thin content stays movable.
* Image operations: crop tool (frame, handles, Free/1:1/Original, frame may extend beyond the canvas), crop to selection, canvas size with anchor, image size with proportional scaling, rotate canvas 90°/180°, flip canvas, flip layer — all single undo steps.
* Painting tools: flood fill (tolerance, expand, opacity, contiguous, sample all layers), linear/radial gradient (foreground→background or →transparent, dithered), line, rectangle, ellipse, regular polygon, polyline — outlines with the active brush, optional fill, Ctrl constraints, grid snapping, symmetry applied to brush outlines.
* Raster text tool: in-place editor on the canvas, font/size/bold/italic/alignment, places a new layer named after the text.
* Adjustments on the active layer (inside the selection): brightness/contrast and hue/saturation/lightness with live, revertible preview; greyscale; invert.
* Guides: draggable handles for ruler ends (15° snap), ellipse centre/radii (now drawn on the canvas), vanishing points (shared horizon), symmetry centre; grid size and shape snapping in the tool options.
* Contextual tool-options strip for every tool; command search (`Ctrl+K`, ☰ button) listing every command by group with shortcuts; numeric prompt dialog.
* Already present from earlier milestones: groups, thumbnails, colour labels, blend modes, alpha lock, clipping, masks, merge down/visible, flatten copy.

### Files

New: `src/renderer/engine/selection.ts`, `src/renderer/engine/pixel-ops.ts`, `src/renderer/state/tool-options.ts`, `src/renderer/app/{selection-actions,clipboard,prompt,adjust-actions}.ts`, `src/renderer/tools/{select-tools,transform-tool,paint-tools,text-tool,assist-handles}.ts`, `src/renderer/ui/{ToolOptionsBar,TextOverlay,CommandPalette}.tsx`, `src/renderer/ui/dialogs/ImageDialogs.tsx`, `tests/unit/{selection,pixelops}.test.ts`.
Changed: `App.tsx`, `extended.ts`, `registry.ts`, `CanvasView.tsx`, `Overlays.tsx`, `Chrome.tsx`, `DialogHost.tsx`, `assist-overlay.ts`, `app.css`, `tests/e2e/smoke.spec.ts`, `USER_GUIDE.md`.

### Commands run and results

| Command | Result |
|---|---|
| `npm run lint` | 0 errors, 0 warnings |
| `npm run typecheck` | passes |
| `npm test` | 9 files, 89 tests passed (27 new: polygon rasterisation and anti-aliasing, combine modes, feather, grow/shrink, flood fill, outline, extract/trim/clear, exact integer moves with undo, scaling, rotation without dark fringes, homography corners, selection-weighted clear, mask transform, fill with alpha lock, gradient, adjustments, rotate/flip/canvas size/image size with undo) |
| `npm run test:e2e` | 4 Electron tests passed under Xvfb (2 new: rectangle selection → `Ctrl+T` move → Enter → pixels moved and selection kept → undo restores; text tool places a "Text: Hello" layer with opaque glyph pixels) |
| Manual (Xvfb scripts + screenshots) | rect/ellipse/lasso/polygon/wand selections, transform with numeric angle, fill, gradient, all shape tools, text editing, hue/saturation and brightness preview + cancel, image size, canvas size, crop with a new frame, rotate canvas + undo, copy/paste as layer, floating paste + Esc, expand selection prompt, command search running "Rotate canvas 90° clockwise" — history labels and document sizes checked after each step; no console errors |

### Known limitations

* Text is rasterised when placed; it cannot be edited as text afterwards.
* Adjustments are destructive (no adjustment layers); the preview recomputes the whole layer, which takes noticeably longer on very large layers.
* Fill, wand and feather work on full-document buffers (memory grows with document size).
* Pasting an image copied in another application is implemented (system clipboard PNG) but was only exercised with Canvas Forge's own copies here.

### Next concrete action

Milestone 4: reference-image panel, workspace layouts, accessibility audit (contrast, focus order, names, target sizes), performance profiling of fill/selection/adjustments, error surfaces.

---

## Milestone 4 — polished desktop app ✅

### Completed

* Reference-image panel: add from file, clipboard or drag & drop; up to 12 per document, stored unchanged in the `.cforge` file (`resources/references/*`, `features.references`); pan, wheel zoom, fit, keyboard zoom/pan; view-only flip and greyscale; colour picking (toggle, Alt+click, or eyedropper tool); add/remove are undoable document changes; commands in the command search.
* Error surfaces: error boundaries around every panel (inline message + *Try again*), around dialogs (dialog closes with a notice) and around the workspace (continue or reload); uncaught errors and rejected promises become rate-limited error notices; the main process offers *Reload* when the renderer crashes and *Wait/Reload* when it hangs (prompt withdrawn automatically when it responds again).
* Accessibility: axe-core audit of 17 UI states (start screen, dialogs, workspace with all panels, preferences tabs, Brush Lab, command search, tool options, light theme, roomy density) — all fixed to zero violations; fixes included valid tab/list semantics (document tabs, brush list, layer list, palette swatches — no nested interactive controls), landmark labels, heading order, text contrast (secondary text and light-theme accent tokens raised to ≥ 4.5:1), minimum 24 px pointer targets, a page heading. Keyboard: `Tab` no longer toggles Focus Canvas unless the canvas has focus, so the whole interface is reachable; a recorded Tab walk visits title bar → command bar → tool rail → tool options → pucks → Orbit → panels → status bar with a visible focus ring on every stop; roving tab stops plus arrow keys in brush/layer/palette lists; global shortcuts ignore keys a focused control already handled.
* Small windows and scaling: related rail tools are grouped with flyouts (selection, shapes, navigation), so the rail fits 1366 × 768 and 125 % scaling; command-bar groups that do not fit move by priority into a *More commands* menu; the tool-options strip wraps instead of scrolling. Checked at 100 % (1366 × 768 and the 1024 × 640 minimum), 125 % (1093 × 600 DIP), 150 % and 200 % (1280 × 720 DIP): no clipped controls, and the canvas backing store matches the device pixel ratio (e.g. 944 × 612 CSS px → 1888 × 1224 px at 200 %).
* Performance profiling of selection, fill, transform and adjustment operations on 3000 × 2000 (see `docs/performance.md`), with three optimisations: feather 589 → 165 ms, expand 672 → 117 ms, hue/saturation 699 → 124 ms.
* Already present from earlier milestones: docking/floating panels with layout reset, status bar, compact/roomy density, preferences, full screen, mirror view, canvas grid/pixel grid, clipboard paste, drag & drop, autosave/recovery, recent files (missing files shown disabled), export name templates, readable errors for invalid or newer files, history memory budget and document memory estimate.

### Commands run and results

| Command | Result |
|---|---|
| `npm run lint` | 0 errors, 0 warnings |
| `npm run typecheck` | passes |
| `npm test` | 9 files, 92 tests passed (new: grow/shrink equal a direct min/max filter incl. canvas border, select-all stays complete when contracted/feathered, hue/saturation shift and desaturation) |
| `npm run test:e2e` | 5 Electron tests passed under Xvfb (new: accessibility test running axe-core in dark/light, compact/roomy, dialogs, a tool flyout and the overflow menu, plus choosing the magic wand from the flyout) |
| `npm run perf` | numbers in `docs/performance.md` |
| `npx prettier --check .` | clean |
| Manual (Xvfb scripts) | reference panel: clipboard paste of a copied canvas, colour pick, save → close → reopen keeps the reference, remove + undo; error probes (a panel forced to throw shows its message while the canvas and other panels keep working; uncaught error and rejected promise show notices); brush list click/arrow keys/F2 rename/favourite/double-click Brush Lab/drag reorder; layer select/arrow keys/eye/rename; palette swatch keyboard pick; flyouts by right-click and keyboard; overflow menu at 1093 px width |

### Known limitations

* Crash and hang dialogs in the main process were not triggered in a real crash here (only the renderer-side error paths were exercised).
* The accessibility audit is automated (axe-core) plus keyboard walks; it was not checked with a screen reader.
* Windows display scaling was emulated with Chromium's `--force-device-scale-factor` on Linux, not on a Windows machine.

### Next concrete action

Milestone 5: flipbook animation (frames, exposure, playback, onion skin), PNG-sequence and GIF export, time-lapse; then Windows packaging.

---

## Milestone 5 — animation and interoperability ✅ (PSD/TIFF not implemented)

### Completed

* Flipbook: every top-level layer or group is a frame (bottom = first); frame strip with thumbnails, current-frame highlight, keyboard navigation (`,` `.` and arrows); new / duplicate / delete / move earlier / move later; per-frame exposure (1–48 ticks); frame rate 1–60 fps; loop; held background and foreground layers; the current frame follows the active layer (and vice versa); status-bar frame indicator; settings saved in `features.animation` and undoable.
* Onion skin: configurable frames before/after (0–5), opacity with linear fade, red/blue tint; rendered by the compositor underneath the current frame (new per-node display style), never included in exports, picking, copy merged, fill/wand sampling or file previews (all of these use the current frame).
* Playback: frames are pre-rendered (cached by content signature, ≤ 2048 px and a 480 MB budget) and shown at the frame rate with exposures; a click on the canvas stops on the visible frame.
* Export: animated GIF via gifenc (per-frame palette, delays from exposure and fps, loop flag, optional one-colour transparency) and PNG sequence (one PNG per tick, so exposures survive) at 10–100 % size.
* Time-lapse: optional recording per document; after edits settle, a 720 px WebP snapshot of the already composited view is taken (≥ 1.2 s apart, no extra compositing work); stored in the `.cforge` file; thinned out beyond 1800 frames; REC indicator; replay dialog with scrubbing and speed; GIF and PNG-sequence export; delete recording.
* Also fixed while testing: `Ctrl`/`Alt` shortcuts with Enter, Space or arrows now work while a button has focus; toasts live in a labelled region; tooltips are exposed as the focused element's description.

### Not implemented

* PSD import/export and TIFF export (optional in the brief; not started, so nothing is claimed).
* Video (MP4/WebM) export.

### Commands run and results

| Command | Result |
|---|---|
| `npm run lint` | 0 errors, 0 warnings |
| `npm run typecheck` | passes |
| `npm test` | 10 files, 98 tests passed (new: frame layout with held layers, active layer → frame incl. groups, exposures/timeline/looping, onion order/opacity/tint, compositor onion rendering, settings sanitising) |
| `npm run test:e2e` | 7 Electron tests passed under Xvfb (new: flipbook — two frames, exposure ×2, playback shows both frames and stops on click, GIF parsed block by block = 2 frames 1080 × 1350 with loop extension, PNG sequence = 3 files, save → reopen keeps frames and exposure; time-lapse — recording after edits, REC marker, replay dialog; accessibility test now includes the animation panel and both dialogs) |
| `npx prettier --check .` | clean |
| Manual (Xvfb screenshots) | onion skin view (previous red, next blue), playback, export dialog, time-lapse replay dialog with 7 recorded frames and GIF export (720 × 405) |

### Known limitations

* Thumbnails in the frame strip are approximations (Normal blending, masks ignored).
* Exporting very long or very large PNG sequences sends all files to the main process at once (memory heavy).
* GIF transparency is one bit: soft edges become hard.

### Next concrete action

Package the Windows build (NSIS installer + portable `.exe`) and launch-test the unpacked Linux build.

---

## Packaging

| Command | Result |
|---|---|
| `npm run package:win` | succeeded (1 min 48 s) on the Linux build host with Wine 9.0 installed (needed by electron-builder for the NSIS uninstaller stub and for setting the executable's icon/version resources). Output: `release/Canvas Forge Setup 0.1.0.exe` (NSIS installer, 105 303 641 bytes, SHA-256 `5dddbfd4…8b5cc8`), `release/Canvas Forge 0.1.0 Portable.exe` (105 033 389 bytes, SHA-256 `df77f516…1b0bad`), `release/win-unpacked/Canvas Forge.exe`. |
| PE inspection | x64 app executable; Canvas Forge icon (16–256 px) and product name in the resources; **no Authenticode signature** (certificate table empty — no code-signing certificate configured), so Windows SmartScreen will warn. |
| `npm run package:linux-dir` | succeeded; `release/linux-unpacked/canvas-forge` launched under Xvfb with Playwright: packaged app (`app.asar`, `isPackaged = true`), new document, a stroke (7 177 painted pixels), save to `.cforge` — no page errors. |
| Windows build under Wine 9 | the processes start, but no window appeared within 90 s — inconclusive (Wine is not Windows). **The `.exe` has not been launched on Windows 11.** |

Also changed: the main window now shows itself after 4 s even if the first paint is never reported.

