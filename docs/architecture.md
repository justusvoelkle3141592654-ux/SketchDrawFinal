# Canvas Forge — Architecture

## Processes

| Process | Code | Responsibilities |
|---|---|---|
| Main (Node) | `src/main/` | Window lifecycle, native dialogs, all file IO (atomic writes, validation), app data (`preferences.json`, `brushes.json`, `palettes.json`, `workspace.json`, `recent.json`, `window-state.json`, `recovery/`), clipboard images, single-instance + file-open handling. |
| Preload (sandboxed) | `src/preload/preload.ts` | Exposes `window.forge` (typed in `src/shared/ipc.ts`) through `contextBridge`. Nothing else crosses the boundary. |
| Renderer | `src/renderer/` | React UI, Zustand stores, pixel engine, view renderer, input pipeline, tools. |

Security settings: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`, navigation and new windows blocked, all permission requests denied, production CSP injected at build time (`vite.config.ts`). The main process validates every IPC argument and accepts IPC only from the main window's top frame while it shows the app's own page (the built `dist/renderer/index.html`, loaded with a `pathToFileURL`-encoded URL so install folders with `%`, `#`, spaces or non-ASCII characters work, or the Vite dev-server origin in development); calls from any other window, frame or page are rejected (`invoke`) or ignored (`send`). The URL check lives in the Electron-free `src/main/ipc-guard.ts`.

Path grants: the renderer can re-read or save without a dialog only paths the user chose in a native dialog, paths in the recent list, `.cforge` files the user dropped onto the window (the preload reads the path from the dropped `File` with `webUtils.getPathForFile`, so page script cannot grant an arbitrary path) and files opened by the OS. Saving without a dialog writes only to a granted `.cforge`; images, palettes and brush packs opened through a dialog are never overwritten. A recovery snapshot keeps its original path only if it was a granted `.cforge` when written, and only such paths are re-granted on recovery.

## Renderer layout

```
src/renderer/
  engine/          DOM-free engine (unit-tested in Node)
    geometry.ts    rects, affine matrices
    view.ts        view state, document↔screen transform, zoom/rotate around an anchor
    color.ts       RGB/HSV/HSL/hex, luminance, harmonies, jitter
    curve.ts       monotone cubic response curves + LUT
    tiles.ts       TileGrid (RGBA8), MaskGrid (8-bit), FloatTileGrid (stroke buffer)
    blend.ts       blend modes on premultiplied floats
    layers.ts      layer tree model
    document.ts    RasterDocument (size, DPI, background, layers, selection, dirty notifications)
    compositor.ts  rect compositing incl. groups, clipping, masks, live stroke preview
    history.ts     undo/redo with memory budget, tile diffs, structural snapshots
    layer-ops.ts   add/delete/move/duplicate/merge/flatten/clear/mask operations
    selection.ts   selection masks: polygon rasteriser (anti-aliased), combine modes, feather, grow/shrink, flood fill, outline
    pixel-ops.ts   extract/clear/paste blocks, affine + projective resampling, fill, gradient, adjustments, canvas/image size, rotate/flip
    animation.ts   flipbook model: frames, held layers, exposures, timeline, onion-skin composite options
    brush/         schema + validation/migration, 37 presets, tips & textures, dab rasteriser, dynamics
    stroke/        pipeline (stabiliser, interpolation, resampling), predictive stroke, stroke engine
    io/            .cforge container, PNG codec, brush packs
  state/           Zustand stores: documents, ui, input, preferences, brushes, colours
  render/          CanvasRenderer (composite surface + view transform + overlays)
  input/           pointer normalisation (pressure curve, tilt, buttons, fallbacks)
  tools/           tool controllers (brush/eraser, eyedropper, navigation, guides, symmetry, selection,
                   transform, crop, fill, gradient, shapes, text)
  app/             commands, shortcuts, file actions, document actions, clipboard, selection and adjustment
                   actions, references, animation (playback/export), time-lapse, App root
  ui/              components, panels, dialogs, icons
```

Heavy pixel data lives in mutable engine objects (`DocumentSession` → `RasterDocument`). Stores hold revision counters (`useDocs.rev`, history change events) that trigger React re-renders, so React never diffs pixel data.

## Pixel storage and compositing policy

* Layers are sparse grids of 256×256 tiles (tile size is stored per document; 256 or 512 are accepted when loading).
* **Storage is straight (non-premultiplied) RGBA, 8 bits per channel**, identical to PNG and `ImageData`. This makes `.cforge` tiles and PNG export bit-exact round trips.
* **All blending math is done in premultiplied float** (`blend.ts`): pixels are converted on load, blended, and stored back as straight RGBA. Resampling (thumbnails, previews, image placement scaling) averages in premultiplied space, which prevents dark fringes around semi-transparent edges.
* Blend modes follow the W3C *Compositing and Blending Level 1* formulas: `co = cs·(1−αb) + cb·(1−αs) + αs·αb·B(Cb, Cs)`, `αo = αs + αb − αs·αb`. Separable: Normal, Multiply, Screen, Overlay, Add (linear dodge, clamped), Darken, Lighten. Non-separable: Colour, Luminosity (Rec. 601 luma 0.3/0.59/0.11, `SetLum` + `ClipColor`). Alpha lock uses source-atop semantics. The eraser uses destination-out.
* Groups are either *pass-through* (children blend into the parent stack; group opacity interpolates) or *isolated* (children composite into a transparent buffer that is then blended with the group's mode and opacity).
* Clipping: consecutive layers with `clip` set are clipped to the nearest non-clipping layer below; they blend onto the base with alpha lock, and the result blends with the base's mode and opacity.
* Layer masks are 8-bit tiles (missing tiles = 255, fully revealed) multiplied into the layer's alpha.
* Colour space: sRGB values are used as-is. There is no ICC colour management and no linear-light blending. 8 bits per channel.

Unit tests covering this policy: `tests/unit/blend.test.ts`, `tests/unit/engine.test.ts` (compositor, clipping, masks, seams), `tests/unit/io.test.ts` (PNG/`.cforge` exactness).

## Rendering

`CanvasRenderer` keeps one document-sized composite surface per open document. Document changes call `doc.invalidate(rect)`; the renderer splits the rect at tile boundaries and keeps one dirty sub-rectangle per tile. Each animation frame it recomposites dirty sub-rects (time budget 10 ms per frame, the rest continues next frame) and uploads them with `putImageData(…, dirtyX, dirtyY, dirtyW, dirtyH)`. The visible canvas then draws the surface with a single affine transform (pan, zoom 6.25 %–6400 %, rotation, mirror). Because the view draws one surface, tile seams cannot appear in the view. Overlays (brush outline, eyedropper loupe, symmetry axes, guides, grid, selection outline, transform handles) are drawn on top in screen space. The pixel grid appears from 800 %.

The compositor has a fast path for plain raster layers: 8-bit tiles are blended directly into the float accumulator with inlined source-over (no intermediate buffer). Layers being painted use the general path, which adds the live stroke buffer.

### Animation frames and onion skin

With animation on, every top-level layer node is a frame. A display provider registered by `app/animation.ts` tells the renderer what to composite: the held background, the onion-skin frames (each with a `NodeStyle` — extra opacity and a tint mixed in premultiplied space), the current frame and the held foreground, in that order (`CompositeOptions.roots` / `nodeStyle`). The provider also returns a key; when the key changes (another frame, other onion settings), the renderer recomposites the whole surface. Picking, copy merged, fill/wand sampling, image export and file previews use the same frame options without onion skins. Playback does not composite live: frames are rendered once into canvases (cached by a content signature), and the renderer draws the prepared frame instead of the surface.

### Time-lapse

When recording, edits (history changes) schedule a snapshot after they settle (≥ 1.2 s apart). The snapshot is a GPU downscale of the already composited surface (`CanvasRenderer.snapshot`, 720 px long side) encoded as WebP, so it adds no compositing work. Frames are kept as document resources and saved in the `.cforge` file.

## Errors

Panels, dialogs and the workspace are wrapped in React error boundaries (a failing panel shows a message with *Try again*; a failing dialog closes with a notice; the workspace offers continue/reload). Uncaught errors and rejected promises become error notices. The main process offers to reload a crashed renderer and to wait/reload a hung one.

## Stroke pipeline

1. **Input** (`CanvasView.tsx`, `input/normalize.ts`): Pointer Events with pointer capture, `getCoalescedEvents()` when available, `touch-action: none` on the canvas only. Pressure goes through dead zone + monotone cubic curve; mouse and pressure-less devices use a configurable fixed pressure; missing tilt is 0.
2. **Document coordinates**: the inverse of the view matrix (DPR-independent CSS pixels → document pixels, including rotation and mirror).
3. **Guides**: ruler/ellipse snapping if the stroke starts near them; perspective locks to the best-matching vanishing direction.
4. **Stabiliser** (`stroke/pipeline.ts`): `off`, `smooth` (time-based exponential smoothing; catches up to the pen on lift) or `lazy` (pulled string, radius in screen pixels).
5. **Interpolation**: optional Catmull–Rom between samples (one-sample delay, flushed at the end).
6. **Resampling**: dabs every `spacing × current diameter` along the path; leftover distance carries over between segments so spacing is independent of event rate (tested).
7. **Dynamics** (`brush/dynamics.ts`): inputs pressure, speed, tilt, tilt direction, stroke direction, pen rotation, random, fade → outputs size, opacity, flow, angle, scatter, hue, saturation, luminance, texture strength, each through its own curve and amount.
8. **Dabs** (`brush/dab.ts`): round tips use an analytic per-row span and a cached radial coverage LUT; generated/user tips are mip-mapped grey images sampled bilinearly; paper/canvas grain multiplies coverage.
9. **Accumulation**: normal brushes paint into a premultiplied float **stroke buffer** (`buildup` = flow accumulates up to the per-dab opacity ceiling, `max` = even coverage). The compositor shows `layer ⊕ buffer·opacity` live. On pen-up the buffer is committed once with the brush blend mode. Smudge/blender/mixing brushes paint directly into the layer (with undo capture).
10. **History**: a `TileDiffRecorder` captures the before-state of the touched sub-rectangle of each tile; the entry swaps data on undo/redo. Only one copy per touched area is retained.

Predictive stroke (optional) replaces the finished path before commit: near-straight strokes become exact lines, others are smoothed with endpoint-anchored Gaussian smoothing; pressure and tilt are carried by arc length.

Cancelled or lost pointers commit what was drawn and reset the stroke state, so no line can connect two separate strokes. A touch stroke that becomes a two-finger gesture within 350 ms is discarded instead.

## History and memory

`History` keeps applied/undone entries with approximate byte sizes. When the sum exceeds the budget (preference, default 768 MB) or 300 entries, the oldest entries are dropped (the newest is always kept). Structural changes (layer add/delete/move/properties) store snapshots of the tree with shared pixel grids, so they are cheap.

## Persistence

See `docs/file-format.md` for `.cforge` and `.cforge-brushpack`. Saves are atomic: the main process writes `.<name>.tmp-<random>` next to the target, fsyncs, re-reads and compares, validates the ZIP structure and JSON, then renames over the target (retrying briefly on Windows sharing violations). On any error the temporary file is removed and the original is untouched.

Recovery snapshots are written by the renderer on an interval (preference) for documents with unsaved changes, into the app data `recovery/` folder, and deleted after a successful save or a normal close.
