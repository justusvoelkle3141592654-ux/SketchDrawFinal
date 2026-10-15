# Canvas Forge — User Guide

## The workspace

| Area | Purpose |
|---|---|
| Title bar | Open documents as tabs. A teal dot marks unsaved changes. Middle-click or × closes a tab (you are asked about unsaved changes). |
| Command bar | Document, history, navigation, selection/transform, assists, drawing modes, panel toggles and Focus Canvas. Hover any button for its name and shortcut. |
| Tool rail (left) | Drawing, fill, selection, transform, shape, text and navigation tools, plus foreground/background colours. |
| Canvas | Your document. The canvas always takes most of the window. |
| Panels (right) | Colour, Brushes, Layers (visible by default), Palettes, Animation and Reference. Drag a panel title out of the dock to float it, drop it near the screen edge to dock it again, drag the dividers to resize. |
| Orbit (lower left) | Radial quick menu — see below. |
| Pucks | Size/opacity puck and navigation puck (buttons next to Orbit, or `S` / `Shift+S` at the pointer). |
| Status bar | Active brush, colour, zoom (type a value and press Enter), rotation, size and save status. |

**Focus Canvas** (`Tab` while the canvas has focus, or the frame button): hides everything except the canvas. The small button in the top-right corner, `Tab` or `Esc` brings the workspace back.

**Left-handed layout** (Preferences → General): moves the tool rail and Orbit to the right and panels to the left. Text and shortcuts stay the same.

## Creating and saving

* **New** (`Ctrl+N`): choose a preset or custom size, resolution and background (white, transparent or a colour). The dialog estimates memory and warns about very large canvases.
* **Open** (`Ctrl+O`): `.cforge` documents, or PNG/JPEG/WebP images (opened as a new document).
* **Save** (`Ctrl+S`) / **Save as** (`Ctrl+Shift+S`): `.cforge` keeps all layers, groups, masks, blend modes and settings. Saving is atomic — if something goes wrong, the previous file stays intact.
* **Import image as layer** (`Ctrl+Shift+O`) or drag images onto the window. Larger images can be scaled to fit or placed at full size.
* **Export** (`Ctrl+Shift+E`): PNG (lossless, keeps transparency), JPEG or WebP with quality and scale options. The file name template is set in Preferences → Files & memory.
* **Recent files** appear on the start screen.
* **Recovery**: while you work, recovery snapshots of unsaved documents are written every few minutes (configurable). If Canvas Forge closes unexpectedly, it offers to recover them on the next start.

## Drawing

* `B` brush, `E` eraser, `I` eyedropper (hold `Alt` while painting for a quick pick; `Ctrl` samples only the active layer).
* `[` / `]` change brush size, `Shift+[` / `Shift+]` change opacity, or use the size puck (`S`): drag left/right for size, up/down for opacity.
* Hold `Shift` and click to draw a straight line from the end of the previous stroke.
* `X` swaps foreground/background colours, `D` resets them to black/white.
* **Stabiliser** (`Shift+P`, configurable in Preferences → Strokes): *Smooth* removes jitter and catches up when you lift the pen; *Pulled string* trails the pen by a fixed distance.
* **Predictive stroke** (`P`): after you lift the pen, almost straight strokes become clean lines and curves are smoothed.

## Navigating

* Mouse wheel zooms at the pointer; two-finger touchpad scroll pans; `Alt`+wheel rotates.
* Hold `Space` and drag to pan, `Space+Shift` to rotate, `Space+Ctrl` to zoom.
* Touch: two fingers pan, pinch to zoom, twist to rotate; a quick two-finger tap undoes.
* `Ctrl+0` fit, `Ctrl+1` 100 %, `Ctrl+=` / `Ctrl+-` zoom steps, `Ctrl+Alt+[` / `]` rotate 15°, `Shift+R` reset rotation, `H` mirror the view (pixels are not changed).
* Navigation puck (`Shift+S`): drag the centre to pan, the ring to rotate (Shift snaps to 15°), the small pill to zoom.
* From 800 % a pixel grid is shown (can be turned off).

## Layers

* New layer `Ctrl+Shift+N`, duplicate `Ctrl+J`, merge down `Ctrl+E`, group `Ctrl+G`, delete `Ctrl+Shift+Delete`, clear `Delete`.
* Click the eye to hide/show; double-click a name (or `F2`) to rename; drag rows to reorder or drop onto the middle of a group to move into it.
* Blend mode and opacity apply to the active layer. Toggles: lock transparency (`/`), clip to the layer below (`Ctrl+Alt+G`), lock layer, and for groups "isolated" blending.
* Layer masks: add from the toolbar (uses the selection when there is one). Click the mask chip to paint on the mask (white reveals, black hides; the eraser hides); Shift+click disables the mask.
* Right-click a layer for more: merge visible, flatten to new layer, apply/delete mask, colour labels.

## Orbit

Orbit is Canvas Forge's radial quick menu with eight configurable segments (Preferences → Orbit).

* Click the Orbit hub in the lower corner, press `` ` ``, or right-click / press the pen barrel button on the canvas.
* When opened with a press, move toward a segment and release — like a marking menu. Release near the centre to keep it open and click instead.

## Preferences (`Ctrl+,`)

* **General & workspace**: theme (graphite dark / light), density (compact or roomy for touch), left-handed layout, hide panels while drawing, brush outline, pixel grid.
* **Input & Tablet**: pressure, tilt, barrel buttons, eraser tip and touch gestures on/off; pen-only canvas (fingers never paint); pressure curve with draggable points (double-click adds, right-click removes; Soft/Linear/Firm presets) and a live preview stroke; pressure threshold; fixed pressure for mice; button mappings; live diagnostics with a test area.
* **Strokes**: stabiliser and predictive stroke defaults.
* **Orbit**: segment commands.
* **Keyboard shortcuts**: search, click *Change* and press new keys (Backspace clears, Esc cancels); conflicts are moved automatically.
* **Files & memory**: recovery interval, export name template, undo memory budget, clear recent files.
