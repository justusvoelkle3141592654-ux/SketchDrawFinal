# Performance notes

All numbers below were **measured**, not estimated, with `npm run perf` (Vitest, Node 22, V8) on the build host: a cloud VM with 4 vCPUs reported as "Intel Xeon Processor @ 2.80 GHz", Linux, no GPU. They measure the engine only (no React, no screen drawing). Frame rates on real Windows machines with pens have **not** been measured; do not read these figures as FPS.

## Strategy

* Sparse 256×256 tiles; empty tiles cost nothing.
* Strokes paint into a float stroke buffer; the screen shows `layer ⊕ buffer` via dirty-rect recomposition, and the layer is written once on pen-up.
* Dirty rectangles are tracked per tile; only those sub-rectangles are recomposited and uploaded (`putImageData` with a dirty rect). Compositing work is time-sliced (10 ms per frame), so opening a large document never freezes input.
* Plain raster layers blend straight from 8-bit tiles into the float accumulator with an inlined source-over (no intermediate buffer).
* Round tips use an analytic per-row span plus a cached radial coverage lookup table (no square root per pixel).
* Undo stores only the touched sub-rectangle of each tile; repeated growth is promoted to one full-tile copy and cropped when the stroke ends.
* `.cforge` saving runs the ZIP compression in fflate's worker pool (`zip` async API) in the app; tile data uses deflate level 3.

## Measured results (3000 × 2000 document)

Stroke: a 2800 px long sine-shaped stroke, pressure 0.3→1→0.3, fed as 150 events of 4 samples.

| Brush | Diameter | Dabs | Engine time | ≈ per 4-sample event | Commit on pen-up |
|---|---|---|---|---|---|
| Studio Ink | 8 px | 14 655 | 205 ms | 1.4 ms | 35 ms |
| Hard Round | 40 px | 2 163 | 255 ms | 1.7 ms | 33 ms |
| Hard Round | 150 px | 578 | 490 ms | 3.3 ms | 66 ms |
| Soft Air | 300 px | 142 | 567 ms | 3.8 ms | 61 ms |
| Rough Charcoal (textured, generated tip) | 40 px | 1 355 | 442 ms | 3.0 ms | 16 ms |
| Round Bristle (direct mixing) | 60 px | 2 219 | 1 772 ms | 11.8 ms | 7 ms |
| Finger Smudge (direct) | 40 px | 2 655 | 536 ms | 3.6 ms | 4 ms |
| Water Blend (direct) | 60 px | 709 | 337 ms | 2.3 ms | 4 ms |

Compositing (every tile fully painted — worst case):

| Layers | Full document | Per 256² tile |
|---|---|---|
| 1 | 152 ms | 1.6 ms |
| 5 | 503 ms | 5.2 ms |
| 10 | 852 ms | 8.9 ms |

A typical dirty rectangle of one dab (44 × 44 px) over 10 layers recomposites in **0.31 ms**.

Before the compositor fast path and LUT/undo optimisations, the same measurements were: full composite 1 layer 740 ms, 10 layers 6 935 ms; dirty 44 × 44 rect over 10 layers 1.86 ms; Round Bristle 957 µs/dab.

Save/open (3 layers, 96 tiles each filled with noisy data — the worst case for compression): synchronous serialisation including previews 5.7 s producing 18.6 MB; deserialisation 0.97 s. In the app, compression runs on worker threads; only tile referencing and the preview composite run on the main thread. Real artwork compresses much faster than this noise pattern.

## Selection, fill, transform and adjustments (3000 × 2000)

Median of three runs of `npm run perf` (min–max in brackets). The test layer holds a large anti-aliased ellipse; the "different colour" row fills every pixel with noise. Run-to-run variation on this VM is up to about ±40 %.

| Operation | Median | Range |
|---|---|---|
| Flood region for fill / magic wand (contiguous, 12 % tolerance) | 70 ms | 66–111 ms |
| Fill coverage with 1 px expansion | 93 ms | 68–93 ms |
| Anti-aliased ellipse selection mask | 122 ms | 111–192 ms |
| Feather selection by 8 px | 165 ms | 159–171 ms |
| Expand selection by 4 px | 117 ms | 111–172 ms |
| Selection outline segments (marching ants, computed once per selection change) | 82 ms | 81–125 ms |
| Transform commit: 1000 × 1000 block rotated 20° and scaled 1.2× | 217 ms | 197–244 ms |
| Brightness/contrast on the layer | 71 ms | 60–95 ms |
| Hue/saturation on the layer | 124 ms | 82–125 ms |
| Hue/saturation, every pixel a different colour | 247 ms | 226–251 ms |
| Image size 3000 × 2000 → 1500 × 1000 | 191 ms | 166–205 ms |

Optimisations made after the first measurement (single run before → median after): feather 589 → 165 ms and expand 672 → 117 ms (work restricted to the selection's bounds plus the filter reach; expand/contract uses a van Herk/Gil-Werman sliding min/max whose cost does not grow with the radius); hue/saturation 699 → 124 ms (per-colour result cache, allocation-free conversion of cached colours). The adjustment dialogs debounce their live preview by 50 ms and revert the previous preview before applying new values.

## Interpretation and limits

* With pens reporting ~133–240 Hz and coalesced batches of a few samples, the per-event engine cost of the round, textured and smudge brushes above stays in the low milliseconds on this VM. **Round Bristle** (a 60 px generated-tip mixing brush) is the heaviest built-in preset at ~12 ms per 4-sample event here; on slower machines it may lag behind very fast strokes.
* Opening a document with many fully painted layers takes a few hundred milliseconds of time-sliced compositing before the first complete frame.
* History memory: each undo step stores the touched area of each tile once (straight RGBA8). The default budget is 768 MB (Preferences → Files & memory); the oldest steps are discarded beyond it.
* Memory per document is roughly `layers × width × height × 4` bytes for painted areas, plus a document-sized composite surface (`width × height × 4`). The New Canvas dialog shows an estimate and warns above 1.5 GB or 60 megapixels; documents are limited to 16 384 px per side (Chromium canvas limits). Artwork is never downsampled silently.

## Reproducing

```
npm run perf
```
