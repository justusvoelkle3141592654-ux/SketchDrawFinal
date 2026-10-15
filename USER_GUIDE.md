# Canvas Forge — User Guide

## The workspace

| Area | Purpose |
|---|---|
| Title bar | Open documents as tabs. A teal dot marks unsaved changes. Middle-click or × closes a tab (you are asked about unsaved changes). |
| Command bar | Command search (☰), document, history, navigation, selection/transform, assists, drawing modes, panel toggles and Focus Canvas. Hover any button for its name and shortcut. |
| Tool options | A slim strip at the top of the canvas with the settings of the active tool (brush size, selection mode, tolerance, transform values, text font…). |
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

## Brushes and the Brush Lab

* The **Brushes** panel lists 37 original presets in six categories (Sketch, Ink, Paint, Markers, Texture, Effects) plus your own. Search, filter by category or favourites (star) and drag to reorder. Each row has rename (`F2`) and delete buttons; the panel toolbar duplicates the active brush, imports and exports packs and restores the factory set.
* **Brush Lab** (`Ctrl+B` or the brush name in the tool options): edit every setting of the active brush in sections — tip, stroke, dynamics (with editable curves), texture, colour and mixing. A test area (white, grey, black or transparent background) lets you draw with pen or mouse or replay standard test strokes. *Save* updates the brush, *Save as new* keeps the original, *Reset* returns to the last saved or to the factory settings. Tips and textures can be imported from greyscale images.
* Brush packs (`.cforge-brushpack`) can be exported and imported from the Brushes panel toolbar or by dragging the file onto the window. If a pack contains brushes you already have, you choose *Keep both* or *Replace mine*.

## Selections

* Tools: rectangle `M`, ellipse `Shift+M`, lasso `L`, polygonal lasso `Shift+L` (click corners; click the first point, double-click or press Enter to close; Backspace removes the last point), magic wand `W`.
* Hold `Shift` to add, `Alt` to subtract, `Shift+Alt` to intersect — or choose the mode in the tool options. `Ctrl` makes a square/circle. A click without dragging deselects.
* Tool options: feather, anti-alias, draw from centre; for the wand tolerance, contiguous and *All layers*.
* `Ctrl+A` select all, `Ctrl+D` deselect, `Ctrl+Shift+I` invert, `Ctrl+Alt+D` feather; *Expand/Contract selection* are in the command search.
* Painting, fills, gradients, adjustments, *Clear* (`Delete`) and copy all respect the selection.

## Cut, copy and paste

* `Ctrl+X` cut, `Ctrl+C` copy (active layer), `Ctrl+Shift+C` copy merged (all visible layers).
* `Ctrl+V` pastes as floating pixels on the active layer — position them with the transform frame and press Enter (Esc cancels). `Ctrl+Shift+V` pastes as a new layer.
* Copied pixels also go to the system clipboard as PNG; images copied in other applications can be pasted.
* `Shift+Backspace` fills the selection (or the layer) with the foreground colour.

## Transform

* `Ctrl+T` (or `V`, then drag) floats the selection — or the whole active layer — inside a frame.
* Drag inside to move (arrow keys nudge by 1 px, with Shift by 10 px), drag a corner to scale (`Shift` keeps proportions, `Alt` scales from the centre), drag an edge to stretch, drag the knob above the frame or anywhere outside to rotate. `Ctrl`+drag a corner distorts freely (perspective).
* The tool options show position, size and angle for exact numbers, plus flip and 90° rotation buttons.
* `Enter` or *Apply* commits, `Esc` or *Cancel* restores. A selection moves together with its pixels.

## Fill, gradient, shapes and text

* **Fill** `G`: click to fill an area of similar colour. Options: tolerance, expand (closes small gaps at line-art edges), opacity, contiguous, sample all layers.
* **Gradient** `Shift+G`: drag from start to end. Linear or radial; foreground → background or foreground → transparent. `Shift` snaps the angle.
* **Shapes**: line `U`, rectangle `Shift+U`, ellipse, polygon and polyline (in the tool rail). Outlines are drawn with the active brush; rectangles, ellipses and polygons can also be filled. `Ctrl` makes squares and circles or snaps lines to 15°. With the grid visible and *Snap shapes* on, points snap to the grid.
* **Text** `T`: click on the canvas and type. Choose font, size, bold, italic and alignment in the tool options. `Ctrl+Enter` or *Place text* turns it into a new raster layer named after the text; `Esc` cancels.

## Image and adjustments

* Command search or shortcuts: rotate the canvas 90°/180°, flip the canvas, crop to selection, **Image size** (`Ctrl+Alt+I`, resamples every layer) and **Canvas size** (`Ctrl+Alt+C`, adds or removes space around the artwork with an anchor).
* **Crop** `C`: drag a frame (or drag the whole-canvas frame's handles), choose Free / 1:1 / Original ratio, press Enter or *Crop*. Esc resets the frame.
* Layer flips are in the command search (*Flip layer horizontally/vertically*).
* Adjustments change the pixels of the active layer, inside the selection if there is one: **Brightness / contrast** (`Ctrl+Alt+B`) and **Hue / saturation** (`Ctrl+U`) with a live preview, **Greyscale** (`Ctrl+Shift+U`) and **Invert** (`Ctrl+I`). Everything can be undone.

## Drawing assists

* **Symmetry** (`Shift+Y` cycles off → vertical → horizontal → four-way → radial → kaleidoscope). Drag the centre point to move it; the tool options set the mode and the number of segments.
* **Ruler**, **ellipse** and **perspective** guides (command bar): strokes that start near a guide follow it. Drag the guide handles on the canvas — ruler ends (`Shift` snaps to 15°), ellipse centre and radius handles, vanishing points (1-, 2- or 3-point; the first two share a horizon unless `Shift` is held).
* **Grid** (`Ctrl+'`): size in the tool options; *Snap shapes* makes shape tools snap to it.

## Command search

`Ctrl+K` or the ☰ button lists every command grouped like a menu, with its shortcut. Type to filter, use the arrow keys and Enter to run.

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
