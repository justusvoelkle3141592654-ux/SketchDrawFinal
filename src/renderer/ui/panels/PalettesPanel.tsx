// Palettes: built-in and user swatch sets, add/remove colours, import GIMP palettes, extract from the canvas.
import { useState } from 'react';
import { useColors, parseGpl } from '../../state/colors';
import { parseHex, rgbToHex } from '../../engine/color';
import { forge } from '../../platform';
import { activeSession } from '../../state/documents';
import { confirmDialog, toast } from '../../state/ui';
import { Icon } from '../icons';
import { IconButton } from '../controls/controls';
import { extractPalette } from '../../engine/palette-extract';
import { Compositor } from '../../engine/compositor';
import { frameOptions } from '../../app/animation';

export function PalettesPanel() {
  const palettes = useColors((s) => s.palettes);
  const activeId = useColors((s) => s.activePaletteId);
  const fg = useColors((s) => s.fg);
  const store = useColors.getState();
  const [renaming, setRenaming] = useState(false);
  const idx = Math.max(
    0,
    palettes.findIndex((p) => p.id === activeId),
  );
  const pal = palettes[idx];
  const step = (d: number) =>
    store.setActivePalette(palettes[(idx + d + palettes.length) % palettes.length].id);
  const editable = !pal.builtIn;

  const newPalette = () =>
    store.addPalette({
      name: `My palette ${palettes.filter((p) => !p.builtIn).length + 1}`,
      colors: [rgbToHex(fg)],
    });

  const addColor = () => {
    if (!editable) {
      const id = store.addPalette({ name: `${pal.name} (custom)`, colors: [...pal.colors, rgbToHex(fg)] });
      toast('info', 'Built-in palettes are read-only, so a custom copy was created.');
      return id;
    }
    store.updatePalette(pal.id, (p) => {
      const h = rgbToHex(fg);
      if (!p.colors.includes(h)) p.colors.push(h);
    });
  };

  const importPalette = async () => {
    const f = await forge.importPalette();
    if (!f) return;
    if ('error' in f) return toast('error', 'Could not read the palette.', f.error);
    const text = new TextDecoder().decode(f.bytes);
    let parsed: { name: string; colors: string[] } | null = parseGpl(text);
    if (!parsed) {
      try {
        const j = JSON.parse(text) as { name?: unknown; colors?: unknown };
        const colors = Array.isArray(j.colors)
          ? j.colors.filter((c): c is string => typeof c === 'string' && !!parseHex(c))
          : [];
        if (colors.length) parsed = { name: typeof j.name === 'string' ? j.name : f.name, colors };
      } catch {
        parsed = null;
      }
    }
    if (!parsed)
      return toast('error', `${f.name} is not a GIMP palette (.gpl) or Canvas Forge palette (.json).`);
    store.addPalette({
      name: parsed.name.slice(0, 80),
      colors: parsed.colors.map((c) => rgbToHex(parseHex(c)!)),
    });
    toast('success', `Imported ${parsed.colors.length} colours.`);
  };

  const fromCanvas = () => {
    const s = activeSession();
    if (!s) return toast('info', 'Open a document first.');
    const comp = new Compositor(s.doc);
    const data = comp.compositeToRGBA(s.doc.bounds, frameOptions(s));
    const colors = extractPalette(data, s.doc.width, s.doc.height, 12);
    if (!colors.length) return toast('info', 'The canvas has no visible colours yet.');
    store.addPalette({ name: `${s.displayName} colours`, colors: colors.map(rgbToHex) });
    toast('success', `Created a palette with ${colors.length} colours from the canvas.`);
  };

  return (
    <div className="palettes-panel">
      <div className="palette-nav">
        <IconButton icon="chevronLeft" label="Previous palette" onClick={() => step(-1)} size={16} />
        {renaming && editable ? (
          <input
            className="palette-name-input"
            autoFocus
            defaultValue={pal.name}
            aria-label="Palette name"
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
            onBlur={(e) => {
              const v = e.target.value.trim().slice(0, 80);
              if (v) store.updatePalette(pal.id, (p) => void (p.name = v));
              setRenaming(false);
            }}
          />
        ) : (
          <select
            className="palette-select"
            value={pal.id}
            aria-label="Palette"
            onChange={(e) => store.setActivePalette(e.target.value)}
            onDoubleClick={() => setRenaming(true)}
          >
            {palettes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.builtIn ? '' : ' •'}
              </option>
            ))}
          </select>
        )}
        <IconButton icon="chevronRight" label="Next palette" onClick={() => step(1)} size={16} />
      </div>
      <div
        className="palette-grid"
        role="group"
        aria-label={`${pal.name} colours. Arrow keys move between swatches.`}
        onKeyDown={(e) => {
          if (!e.key.startsWith('Arrow')) return;
          const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.palette-swatch')];
          const i = items.indexOf(document.activeElement as HTMLButtonElement);
          if (i < 0) return;
          e.preventDefault();
          // up/down jump one visual row
          const cols = Math.max(1, items.filter((x) => x.offsetTop === items[0].offsetTop).length);
          const d =
            e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? cols : -cols;
          items[Math.min(items.length - 1, Math.max(0, i + d))]?.focus();
        }}
      >
        {pal.colors.map((h, i) => (
          <button
            key={`${h}-${i}`}
            type="button"
            tabIndex={i === Math.max(0, pal.colors.indexOf(rgbToHex(fg))) ? 0 : -1}
            aria-pressed={h === rgbToHex(fg)}
            className={`palette-swatch ${h === rgbToHex(fg) ? 'is-on' : ''}`}
            style={{ background: h }}
            aria-label={h}
            data-tip={`${h} — click: foreground, Alt+click: background${editable ? ', right-click: remove' : ''}`}
            onClick={(e) => {
              const c = parseHex(h)!;
              if (e.altKey) store.setBg(c);
              else store.setFg(c, true);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (editable) store.updatePalette(pal.id, (p) => void p.colors.splice(i, 1));
            }}
          />
        ))}
        <button
          type="button"
          className="palette-add"
          aria-label="Add current colour to palette"
          data-tip="Add the foreground colour"
          onClick={addColor}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
      <div className="panel-toolbar">
        <IconButton icon="new" label="New palette" tip="New palette" onClick={newPalette} />
        <IconButton
          icon="image"
          label="Palette from canvas"
          tip="Create a palette from the colours in the active document"
          onClick={fromCanvas}
        />
        <IconButton
          icon="import"
          label="Import palette"
          tip="Import a GIMP .gpl or Canvas Forge .json palette"
          onClick={() => void importPalette()}
        />
        <IconButton
          icon="text"
          label="Rename palette"
          tip={editable ? 'Rename palette' : 'Built-in palettes cannot be renamed'}
          disabled={!editable}
          onClick={() => setRenaming(true)}
        />
        <IconButton
          icon="trash"
          label="Delete palette"
          tip={editable ? 'Delete palette' : 'Built-in palettes cannot be deleted'}
          disabled={!editable}
          onClick={async () => {
            const r = await confirmDialog({
              title: 'Delete palette?',
              message: `Delete "${pal.name}" and its ${pal.colors.length} colours?`,
              buttons: [
                { id: 'delete', label: 'Delete', kind: 'danger' },
                { id: 'cancel', label: 'Cancel' },
              ],
              cancelId: 'cancel',
            });
            if (r === 'delete') store.deletePalette(pal.id);
          }}
        />
      </div>
    </div>
  );
}
