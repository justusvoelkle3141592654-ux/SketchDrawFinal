# File formats

## `.cforge` document (format version 1)

A `.cforge` file is a standard ZIP archive (deflate). It can be inspected with any ZIP tool.

```
manifest.json            format id, version, app version, timestamps, entry names
document.json            document description (dimensions, background, layer tree, features)
layers/<layerId>/<tx>_<ty>.rgba    raw tile pixels
masks/<layerId>/<tx>_<ty>.a8       raw layer-mask tiles
selection/<tx>_<ty>.a8             raw selection tiles (optional)
preview.png              composite preview, longest side ≤ 1024 px (optional)
thumbnail.png            composite thumbnail, longest side ≤ 256 px (optional)
resources/brushes.json   brush presets used in the document (optional)
resources/references/<id>.png|jpg|webp   reference images, stored unchanged (optional)
resources/<name>         additional resources (e.g. time-lapse frames) (optional)
```

### manifest.json

```json
{
  "format": "canvas-forge",
  "formatVersion": 1,
  "appVersion": "0.1.0",
  "created": "2026-10-15T09:00:00.000Z",
  "modified": "2026-10-15T09:30:00.000Z",
  "document": "document.json",
  "preview": "preview.png",
  "thumbnail": "thumbnail.png",
  "tileEncoding": "raw-rgba8-straight"
}
```

* `format` must be `canvas-forge`.
* A reader refuses files whose `formatVersion` is newer than it supports, with a readable message, and never modifies them.

### document.json

| Field | Type | Notes |
|---|---|---|
| `width`, `height` | integer | 1–16 384 |
| `dpi` | number | metadata only |
| `tileSize` | 256 \| 512 | edge length of tiles |
| `background` | `{ transparent: boolean, color: "#RRGGBB" }` | |
| `title`, `created`, `modified` | string | |
| `activeLayerId` | string | |
| `layers` | Layer[] | **bottom → top** |
| `selection` | `{ tiles: [tx, ty][] }` \| null | |
| `view` | `{ zoom, rotation, panX, panY, flipX, flipY }` \| null | last view |
| `features` | object | assists (symmetry, ruler, ellipse, perspective, grid), reference images, animation, time-lapse settings |

`features.references` lists the reference images shown in the Reference panel: `[{ "id": "ref…", "name": "photo.jpg", "file": "references/ref….jpg", "width": 1200, "height": 800 }]`. Entries whose resource file is missing are ignored. Reference images are never composited into the artwork or exports.

Raster layer:

```json
{ "kind": "raster", "id": "L…", "name": "Ink", "visible": true, "opacity": 1, "blendMode": "normal",
  "locked": false, "label": "none", "alphaLock": false, "clip": false,
  "maskEnabled": true, "editMask": false,
  "tiles": [[0, 0], [1, 0]], "mask": { "tiles": [[0, 0]] } }
```

Group layer: `{ "kind": "group", …common fields…, "expanded": true, "passThrough": true, "children": [ … ] }`.

`blendMode` is one of `normal, multiply, screen, overlay, add, darken, lighten, color, luminosity`. Unknown values are read as `normal` and reported as a warning.

### Tile data

* `.rgba`: `tileSize × tileSize × 4` bytes, row-major, **straight (non-premultiplied) RGBA, 8 bits per channel**. Tile `(tx, ty)` covers document pixels `[tx·tileSize, (tx+1)·tileSize) × [ty·tileSize, (ty+1)·tileSize)`. Fully transparent tiles are omitted.
* `.a8`: `tileSize × tileSize` bytes. Layer masks: missing tiles mean 255 (revealed). Selection: missing tiles mean 0 (not selected).

A tile with missing or wrong-sized data is left empty and reported as a warning instead of failing the whole document.

### Integrity

The main process validates a document before replacing the target file: the ZIP must fully decompress, `manifest.json` and the referenced document JSON must parse, and the format version must be supported. Saving is atomic (see `docs/architecture.md`).

## `.cforge-brushpack` (pack format version 1)

ZIP archive:

```
manifest.json   { "format": "canvas-forge-brushpack", "formatVersion": 1, "name": "…", "appVersion": "…", "created": "…", "brushCount": n }
brushes.json    [ BrushPreset, … ]
```

`BrushPreset` follows the versioned schema in `src/renderer/engine/brush/schema.ts` (`schemaVersion` 1). On import every preset is validated: unknown enum values fall back to defaults, numbers are clamped to their documented ranges, curves are normalised, and presets from a newer schema version are rejected individually with a message. When imported ids already exist, the user chooses *Keep both*, *Replace mine*, *Skip duplicates* or *Cancel*.

Main preset fields: `engine` (stamp, airbrush, ink, marker, texture, eraser, smudge, blender, composite), `tip` (round / generated / image, hardness, aspect, angle, antialias), `diameter`, `minDiameter`, `opacity`, `flow`, `count`, `countJitter`, `scatter`, `rotationJitter`, `colorJitter`, `colorMode` + `fixedColor`, `texture` (source, scale, contrast, strength, movement, invert), `dynamics[]` (input, output, amount, curve points), `stroke` (spacing, accumulate, blend mode, stabiliser override, airbrush rate, interpolation), `mixing` (mode, pickup, persistence, dilution, strength), `seed`, `fixedSeed`, metadata (`name`, `category`, `tags`, `author`, `created`, `modified`).

Canvas Forge does not read or write proprietary brush formats of other applications.
