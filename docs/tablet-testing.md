# Manual tablet, pen and touch test checklist

Canvas Forge reads pens through **Windows Ink**, which Chromium (inside Electron) exposes as Pointer Events. There is no vendor SDK (Wintab) integration. Devices that only provide a Wintab driver must have "Windows Ink" enabled in their driver control panel.

## Tested status

| Device | Status |
|---|---|
| Mouse (X11 under Xvfb, Linux build host) | Automated E2E: drawing, undo/redo, save/open/export (`tests/e2e/smoke.spec.ts`) |
| Synthetic pen samples (pressure, tilt, twist, coalesced batches) | Unit tests of normalisation-independent pipeline parts (`tests/unit/pipeline.test.ts`, `engine.test.ts`) |
| Pointer normalisation, pressure curve and dead zone, coalesced-events fallback, canvas routing | Unit tests (`tests/unit/input.test.ts`) |
| Synthetic pen and touch events in the running app (pen-only canvas, palms during a pen stroke, palms resting before the pen, diagnostics) | Automated E2E (`tests/e2e/input.spec.ts`) — synthetic events, not real hardware |
| Wacom (Intuos/Cintiq/One) | **Not tested** — no hardware available |
| Huion | **Not tested** |
| XP-Pen | **Not tested** |
| Microsoft Surface Pen | **Not tested** |
| Touchscreen (finger) | **Not tested** on hardware |
| Windows 11 itself | **Not tested** — the Windows build was cross-compiled on Linux |

Fill in the table below on real hardware and keep the results in this file.

## Preparation

1. Install the Windows build with `installer/Canvas Forge Setup <version>.exe` (see `installer/README.md`).
2. Open **Preferences → Input & Tablet** (Ctrl+, then the "Input & Tablet" tab). Keep it open in a second step to read the diagnostics.
3. Note driver name/version, Windows version, display scaling (100/125/150/200 %), and whether Windows Ink is on.

## Checklist

| # | Step | Expected | Result |
|---|---|---|---|
| 1 | Hover the pen over the **test area** without touching | Pointer type `pen`, buttons 0, raw pressure 0 | |
| 2 | Press lightly, then firmly | Raw pressure rises smoothly 0 → 1; normalised pressure follows the curve | |
| 3 | Tilt the pen in all directions | Tilt X/Y change sign and range up to about ±60° (device dependent) | |
| 4 | Rotate an art pen (if supported) | Twist changes 0–359° | |
| 5 | Press the barrel button(s) | Buttons value changes; with default mapping the barrel opens **Orbit** on the canvas | |
| 6 | Flip to the eraser end and draw | "(eraser)" shown; drawing on the canvas erases with the active eraser | |
| 7 | Draw a slow stroke with the **Studio Ink** brush | Width follows pressure, no gaps, no wobble at the start | |
| 8 | Draw very fast zig-zags | Continuous line, no straight shortcuts across the canvas, sample rate in diagnostics ≥ 100 Hz typically | |
| 9 | Lift the pen mid-stroke and put it down elsewhere | Two separate strokes; nothing connects them | |
| 10 | Move the pen out of the window while drawing, release outside | Stroke ends at the window edge; next stroke starts fresh | |
| 11 | Change the **pressure curve** to *Soft* and *Firm* | Preview stroke and real strokes become heavier / lighter accordingly | |
| 12 | Raise **Pressure threshold** to 10 % | Very light touches no longer paint | |
| 13 | Disable **Pressure** | Strokes use the fixed pressure value | |
| 14 | Disable **Tilt** with a tilt-sensitive brush (Graphite Soft) | Tilt no longer changes the size | |
| 15 | Turn on **Pen-only canvas**, touch the canvas with a finger | Finger pans instead of painting; panels still respond to touch | |
| 16 | Two-finger drag / pinch / twist on the canvas | Pans, zooms around the fingers, rotates the view | |
| 17 | Quick two-finger tap | Undo | |
| 18 | Start a stroke with one finger and add a second finger quickly | The short finger stroke is discarded; navigation starts | |
| 19 | Rest the palm while drawing with pen-only off | Note any unwanted marks (palm rejection then depends on the driver/Windows) | |
| 19a | Pen-only on: rest the palm on the screen first, then draw with the pen | The palm may move the view until the pen touches down; then the pen draws and the palm no longer pans, zooms or undoes | |
| 19b | Pen-only on: tap two palms on the screen while drawing | No undo, no view change; the stroke continues | |
| 20 | Repeat 7–8 at 125 %, 150 % and 200 % display scaling | Stroke stays under the pen tip; brush outline matches | |
| 21 | Move the window between monitors with different scaling | Canvas stays sharp; cursor alignment stays correct | |
| 22 | Hold Space and drag with the pen | Pans | |
| 23 | Right-click / barrel with the mouse | Orbit opens; release over a segment runs it | |

## Known limitations

* Pressure on mice is simulated (fixed value).
* Tangential pressure (airbrush wheel) and contact size are shown in diagnostics but not mapped to brush dynamics.
* Hover-only pen events are used for the brush outline; some drivers do not report hover.
