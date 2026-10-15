// Open, recovery and re-save of everything a document carries (renderer state without a browser).
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  // platform.ts reads window.forge; without it the in-memory browser fallback is used
  (globalThis as unknown as { window: object }).window = {};
});

import {
  openRecovered,
  paletteFor,
  serializeSession,
  sessionFromCforge,
} from '../../src/renderer/app/file-actions';
import { deserializeDocument, serializeDocumentSync } from '../../src/renderer/engine/io/cforge';
import { RasterDocument } from '../../src/renderer/engine/document';
import { FACTORY_BRUSHES } from '../../src/renderer/engine/brush/presets';
import { cloneBrush } from '../../src/renderer/engine/brush/schema';
import { defaultAssist, useDocs } from '../../src/renderer/state/documents';
import { useBrushes } from '../../src/renderer/state/brushes';
import { BUILTIN_PALETTES, useColors } from '../../src/renderer/state/colors';

const customBrush = {
  ...cloneBrush(FACTORY_BRUSHES[2]),
  id: 'u.doc-brush',
  name: 'Doc brush',
  factory: false,
};
const docPalette = { id: 'Pdoc1', name: 'Doc palette', colors: ['#102030', '#A0B0C0'] };
const assist = defaultAssist(320, 200);
assist.guides = { x: [40, 80], y: [25], snap: false };
assist.grid = { visible: true, size: 32, snap: true };
const resources = {
  'references/r1.png': new Uint8Array([137, 80, 78, 71, 1]),
  'timelapse/000001.webp': new Uint8Array([9, 8, 7]),
};
const references = [{ id: 'r1', name: 'ref.png', file: 'references/r1.png', width: 1, height: 1 }];

function savedFile(withExtras = true): Uint8Array {
  const doc = RasterDocument.createDefault({ width: 320, height: 200 });
  doc.activeRaster!.pixels.setPixel(5, 6, 10, 20, 30, 255);
  if (!withExtras) return serializeDocumentSync(doc, { appVersion: 'test', skipPreviews: true });
  return serializeDocumentSync(doc, {
    appVersion: 'test',
    skipPreviews: true,
    brushes: [FACTORY_BRUSHES[0], customBrush],
    palette: docPalette,
    features: { assist, references, timelapse: { recording: false, interval: 1200 } },
    resources,
  });
}

const paletteCount = (id: string) => useColors.getState().palettes.filter((p) => p.id === id).length;

beforeAll(async () => {
  // no stored app data in this environment: both libraries start from their defaults
  await useBrushes.getState().load();
  await useColors.getState().load();
});

describe('opening a .cforge document', () => {
  it('restores features, assists, guides, resources, stored brushes and the palette', () => {
    const active = useColors.getState().activePaletteId;
    const { session: s, warnings } = sessionFromCforge(savedFile(), 'art.cforge');
    expect(warnings).toEqual([]);
    expect(s.doc.activeRaster!.pixels.getPixel(5, 6)).toEqual([10, 20, 30, 255]);
    expect(s.assist.guides).toEqual({ x: [40, 80], y: [25], snap: false });
    expect(s.assist.grid).toEqual({ visible: true, size: 32, snap: true });
    expect(s.features.references).toEqual(references);
    expect(s.resources).toEqual(resources);
    expect([...s.usedBrushIds].sort()).toEqual([FACTORY_BRUSHES[0].id, customBrush.id].sort());
    expect(useBrushes.getState().get(customBrush.id)?.name).toBe('Doc brush');
    // the palette joins the library once; the active palette stays as it was
    expect(paletteCount(docPalette.id)).toBe(1);
    expect(useColors.getState().activePaletteId).toBe(active);
    expect(paletteFor(s)).toEqual(docPalette);
  });

  it('keeps stored brushes, palette, assists and resources when re-saved without painting', async () => {
    const { session: s } = sessionFromCforge(savedFile(), 'art.cforge');
    const back = deserializeDocument(await serializeSession(s, true));
    expect(back.brushes.map((b) => b.id).sort()).toEqual([FACTORY_BRUSHES[0].id, customBrush.id].sort());
    expect(back.palette).toEqual(docPalette);
    expect(back.resources).toEqual(resources);
    expect((back.features.assist as typeof assist).guides).toEqual(assist.guides);
    expect(back.features.references).toEqual(references);
  });

  it('keeps stored copies of brushes and palettes that left the library', async () => {
    const { session: s } = sessionFromCforge(savedFile(), 'art.cforge');
    useBrushes.getState().remove(customBrush.id);
    useColors.getState().deletePalette(docPalette.id);
    const back = deserializeDocument(await serializeSession(s, true));
    expect(back.brushes.find((b) => b.id === customBrush.id)?.name).toBe('Doc brush');
    expect(back.palette).toEqual(docPalette);
  });

  it('never duplicates or overwrites a library palette with the same id', () => {
    sessionFromCforge(savedFile(), 'a.cforge');
    useColors.getState().updatePalette(docPalette.id, (p) => p.colors.push('#FFFFFF'));
    const { session: s } = sessionFromCforge(savedFile(), 'b.cforge');
    expect(paletteCount(docPalette.id)).toBe(1);
    const lib = useColors.getState().palettes.find((p) => p.id === docPalette.id)!;
    expect(lib.colors).toEqual([...docPalette.colors, '#FFFFFF']);
    // the document refers to the user's current version of that palette
    expect(paletteFor(s)?.colors).toEqual(lib.colors);
  });

  it('opens older documents without palette data; saving stores the active palette', () => {
    const { session: s, warnings } = sessionFromCforge(savedFile(false), 'old.cforge');
    expect(warnings).toEqual([]);
    expect([s.paletteId, s.usedBrushIds.size]).toEqual([null, 0]);
    const active = useColors.getState().activePaletteId;
    expect(paletteFor(s)?.id).toBe(active);
  });
});

describe('recovering an autosave snapshot', () => {
  it('restores through the same path as opening, as an unsaved document without a path', async () => {
    // a snapshot is what autosave writes: serializeSession without previews
    const { session: original } = sessionFromCforge(savedFile(), 'art.cforge');
    const snapshot = await serializeSession(original, true);
    const s = openRecovered(snapshot, 'art');
    expect(useDocs.getState().activeId).toBe(s.id);
    expect([s.fileName, s.filePath, s.dirty]).toEqual(['art (recovered)', null, true]);
    expect(s.assist.guides).toEqual(assist.guides);
    expect(s.resources).toEqual(resources);
    expect(s.features.references).toEqual(references);
    expect(s.storedBrushes.get(customBrush.id)?.name).toBe('Doc brush');
    expect(s.usedBrushIds.has(customBrush.id)).toBe(true);
    expect(s.paletteId).toBe(docPalette.id);
    const back = deserializeDocument(await serializeSession(s, true));
    expect(back.brushes.map((b) => b.id)).toContain(customBrush.id);
    expect(back.palette?.id).toBe(docPalette.id);
  });

  it('a palette picked while the document is active becomes its palette reference', () => {
    const other = openRecovered(savedFile(), 'other');
    const s = openRecovered(savedFile(), 'art');
    const picked = BUILTIN_PALETTES[3].id;
    useColors.getState().setActivePalette(picked);
    expect(paletteFor(s)?.id).toBe(picked);
    expect(other.paletteId).toBe(docPalette.id);
  });
});
