// Command registry: view mirror commands, destructive adjustment labels and unique default shortcuts.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RasterDocument } from '../../src/renderer/engine/document';
import type * as CommandsModule from '../../src/renderer/app/commands';
import type * as DocumentsModule from '../../src/renderer/state/documents';
import type * as UiModule from '../../src/renderer/state/ui';

let C: typeof CommandsModule;
let Docs: typeof DocumentsModule;
let Ui: typeof UiModule;

beforeAll(async () => {
  // the renderer modules read the preload bridge from `window` when they load
  vi.stubGlobal('window', globalThis);
  C = await import('../../src/renderer/app/commands');
  const E = await import('../../src/renderer/app/extended');
  Docs = await import('../../src/renderer/state/documents');
  Ui = await import('../../src/renderer/state/ui');
  C.registerCoreCommands();
  E.registerExtendedFeatures();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function openDocument() {
  const doc = RasterDocument.createDefault({ width: 64, height: 48 });
  doc.activeRaster!.pixels.setPixel(10, 10, 200, 40, 20, 255);
  const s = new Docs.DocumentSession(doc);
  Docs.useDocs.getState().add(s);
  return s;
}

describe('commands', () => {
  it('mirror view has horizontal (H) and vertical (Shift+H) commands; no shortcut is shared', () => {
    expect(C.shortcutsFor('view.mirror')).toEqual(['H']);
    expect(C.shortcutsFor('view.mirrorVertical')).toEqual(['Shift+H']);
    const owners = new Map<string, string[]>();
    for (const c of C.allCommands())
      for (const k of C.shortcutsFor(c.id)) owners.set(k, [...(owners.get(k) ?? []), c.id]);
    expect([...owners].filter(([, ids]) => ids.length > 1)).toEqual([]);
  });

  it('mirror commands change the view only, and combine with rotation', () => {
    const s = openDocument();
    const pixel = s.doc.activeRaster!.pixels.getPixel(10, 10);
    s.view = { ...s.view, rotation: 0.5 };
    C.runCommand('view.mirrorVertical');
    expect(s.view.flipY).toBe(true);
    expect(s.view.flipX).toBe(false);
    expect(s.view.rotation).toBeCloseTo(-0.5, 9);
    expect(C.getCommand('view.mirrorVertical')!.checked!()).toBe(true);
    expect(C.getCommand('view.mirror')!.checked!()).toBe(false);
    C.runCommand('view.mirror');
    expect(s.view.flipX).toBe(true);
    expect(s.view.rotation).toBeCloseTo(0.5, 9);
    C.runCommand('view.mirrorVertical');
    C.runCommand('view.mirror');
    expect({ x: s.view.flipX, y: s.view.flipY }).toEqual({ x: false, y: false });
    expect(s.history.canUndo).toBe(false);
    expect(s.doc.activeRaster!.pixels.getPixel(10, 10)).toEqual(pixel);
  });

  it('adjustments are labelled destructive and one-shot ones say what changed and how to undo', () => {
    for (const id of ['adjust.brightness', 'adjust.hue', 'adjust.grayscale', 'adjust.invert'])
      expect(C.getCommand(id)!.label).toContain('(destructive)');
    const s = openDocument();
    const before = s.doc.activeRaster!.pixels.getPixel(10, 10);
    C.runCommand('adjust.invert');
    expect(s.doc.activeRaster!.pixels.getPixel(10, 10)).not.toEqual(before);
    const t = Ui.useUi.getState().toasts.at(-1)!;
    expect(t.text).toBe('Invert colours changed the pixels of “Layer 1”.');
    expect(t.detail).toBe('Undo (Ctrl+Z) reverts it.');
    s.history.undo();
    expect(s.doc.activeRaster!.pixels.getPixel(10, 10)).toEqual(before);
  });
});
