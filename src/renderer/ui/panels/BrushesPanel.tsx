// Brush library: categories, favourites, search, stamps, quick size/opacity, ordering and pack import/export.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useBrushes } from '../../state/brushes';
import { useUi } from '../../state/ui';
import { usePrefs } from '../../state/preferences';
import { BRUSH_CATEGORIES, type BrushPreset, type BrushCategory } from '../../engine/brush/schema';
import { thumbnailAsync } from '../brush-preview';
import { Icon } from '../icons';
import { IconButton, Slider } from '../controls/controls';
import { tooltipFor } from '../../app/commands';
import { exportBrushPack, importBrushPack } from '../../app/brush-actions';
import { confirmDialog, toast } from '../../state/ui';

type Filter = 'All' | 'Favourites' | BrushCategory;

function Stamp({ brush, theme }: { brush: BrushPreset; theme: 'dark' | 'light' }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void thumbnailAsync(brush, 150, 40, theme).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [brush, theme]);
  return (
    <span className="brush-stamp">
      {url ? <img src={url} alt="" draggable={false} /> : <span className="stamp-loading" />}
    </span>
  );
}

export function BrushesPanel() {
  const brushes = useBrushes((s) => s.brushes);
  const favorites = useBrushes((s) => s.favorites);
  const activeBrushId = useBrushes((s) => s.activeBrushId);
  const activeEraserId = useBrushes((s) => s.activeEraserId);
  const tool = useUi((s) => s.tool);
  const theme = usePrefs((s) => s.prefs.theme);
  const store = useBrushes.getState();
  const [filter, setFilter] = useState<Filter>('All');
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<{ id: string; after: boolean } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeId = tool === 'eraser' ? activeEraserId : activeBrushId;
  const active = brushes.find((b) => b.id === activeId);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return brushes.filter((b) => {
      if (filter === 'Favourites' && !favorites.includes(b.id)) return false;
      if (filter !== 'All' && filter !== 'Favourites' && b.category !== filter) return false;
      if (
        q &&
        !(
          b.name.toLowerCase().includes(q) ||
          b.tags.some((t) => t.includes(q)) ||
          b.category.toLowerCase().includes(q)
        )
      )
        return false;
      return true;
    });
  }, [brushes, favorites, filter, query]);

  const choose = (b: BrushPreset) => {
    store.setActive(b.id);
    const ui = useUi.getState();
    if (b.engine === 'eraser') ui.setTool('eraser');
    else if (ui.tool !== 'brush') ui.setTool('brush');
  };

  const startDrag = (id: string, e: React.PointerEvent) => {
    if (e.button !== 0 || filter !== 'All' || query) return;
    if ((e.target as HTMLElement).closest('.brush-actions, input')) return;
    // window listeners instead of pointer capture, so clicks still reach the row's buttons
    const el = window;
    const sy = e.clientY;
    let dragging = false;
    let target: { id: string; after: boolean } | null = null;
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientY - sy) < 6) return;
      dragging = true;
      const under = document
        .elementsFromPoint(ev.clientX, ev.clientY)
        .find((x) => (x as HTMLElement).dataset?.brushId) as HTMLElement | undefined;
      if (!under) return;
      const r = under.getBoundingClientRect();
      target = { id: under.dataset.brushId!, after: ev.clientY > r.top + r.height / 2 };
      setDragOver(target);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDragOver(null);
      if (dragging && target && target.id !== id) {
        const all = useBrushes.getState().brushes;
        const from = all.findIndex((b) => b.id === id);
        let to = all.findIndex((b) => b.id === target!.id) + (target.after ? 1 : 0);
        if (from < to) to -= 1;
        store.move(id, to);
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const remove = async (b: BrushPreset) => {
    const r = await confirmDialog({
      title: 'Delete brush?',
      message: b.factory
        ? `"${b.name}" is a factory brush. You can bring it back with "Restore factory brushes".`
        : `Delete "${b.name}"? This cannot be undone.`,
      buttons: [
        { id: 'delete', label: 'Delete', kind: 'danger' },
        { id: 'cancel', label: 'Cancel' },
      ],
      cancelId: 'cancel',
    });
    if (r === 'delete') store.remove(b.id);
  };

  return (
    <div className="brushes-panel">
      <div className="panel-toolbar">
        <IconButton
          icon="settings"
          label="Brush Lab"
          tip="Open Brush Lab (Ctrl+B) to edit the active brush"
          onClick={() => useUi.getState().openDialog('brush-lab', { id: activeId })}
          testId="open-brush-lab"
        />
        <IconButton
          icon="plus"
          label="New brush"
          tip="Create a new brush in Brush Lab"
          onClick={() => useUi.getState().openDialog('brush-lab', { create: true })}
        />
        <IconButton
          icon="duplicate"
          label="Duplicate brush"
          tip="Duplicate the active brush"
          onClick={() =>
            active && store.duplicate(active.id) && toast('success', `Duplicated ${active.name}`)
          }
        />
        <IconButton
          icon="import"
          label="Import brush pack"
          tip="Import a .cforge-brushpack"
          onClick={() => void importBrushPack()}
        />
        <IconButton
          icon="export"
          label="Export brush pack"
          tip="Export the shown brushes as a .cforge-brushpack"
          onClick={() => void exportBrushPack(list, filter)}
        />
        <IconButton
          icon="reset"
          label="Restore factory brushes"
          tip="Restore all factory brushes to their original settings (your own brushes are kept)"
          onClick={async () => {
            const r = await confirmDialog({
              title: 'Restore factory brushes?',
              message: 'All factory brushes return to their original settings. Your own brushes are kept.',
              buttons: [
                { id: 'ok', label: 'Restore', kind: 'primary' },
                { id: 'cancel', label: 'Cancel' },
              ],
              cancelId: 'cancel',
            });
            if (r === 'ok') store.restoreFactory();
          }}
        />
      </div>
      {active ? (
        <div className="brush-quick">
          <Slider
            label="Size"
            value={active.diameter}
            min={0.5}
            max={1000}
            step={0.1}
            decimals={1}
            unit="px"
            curve="pow"
            onChange={(v) => store.update(active.id, (b) => void (b.diameter = v))}
            hint={`${tooltipFor('brush.sizeDown')} / ${tooltipFor('brush.sizeUp')}`}
            testId="brush-size"
          />
          <Slider
            label="Opacity"
            value={active.opacity}
            min={0.01}
            max={1}
            step={0.01}
            displayScale={100}
            unit="%"
            onChange={(v) => store.update(active.id, (b) => void (b.opacity = v))}
            testId="brush-opacity"
          />
        </div>
      ) : null}
      <div className="brush-filters">
        <input
          className="search"
          type="search"
          placeholder="Search brushes"
          aria-label="Search brushes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="chips" role="tablist" aria-label="Brush categories">
          {(['All', 'Favourites', ...BRUSH_CATEGORIES] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              className={`chip ${filter === f ? 'is-on' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'Favourites' ? <Icon name="starFilled" size={11} /> : null}
              {f}
            </button>
          ))}
        </div>
      </div>
      <div
        className="brush-list"
        role="list"
        aria-label="Brushes"
        ref={listRef}
        data-testid="brush-list"
        onKeyDown={(e) => {
          // arrow keys move between brushes (and choose them); Tab leaves the list
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('.brush-main') ?? [])];
          const i = items.indexOf(document.activeElement as HTMLButtonElement);
          if (i < 0) return;
          e.preventDefault();
          const next = items[Math.min(items.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
          next.focus();
          next.click();
        }}
      >
        {list.length === 0 ? <p className="panel-empty">No brushes match.</p> : null}
        {list.map((b, index) => {
          const fav = favorites.includes(b.id);
          // one tab stop for the whole list: the active brush (or the first one when it is filtered out)
          const tabStop = b.id === activeId || (index === 0 && !list.some((x) => x.id === activeId));
          const tab = tabStop ? 0 : -1;
          const meta = `${b.category} · ${Math.round(b.diameter * 10) / 10}px`;
          const body = (
            <>
              <Stamp brush={b} theme={theme} />
              <span className="brush-text">
                {renaming === b.id ? (
                  <input
                    autoFocus
                    className="layer-name-input"
                    defaultValue={b.name}
                    aria-label="Brush name"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    onBlur={(e) => {
                      const v = e.target.value.trim().slice(0, 80);
                      if (v && v !== b.name) store.update(b.id, (x) => void (x.name = v));
                      setRenaming(null);
                    }}
                  />
                ) : (
                  <span className="brush-name">{b.name}</span>
                )}
                <span className="brush-meta">{meta}</span>
              </span>
            </>
          );
          return (
            <div
              key={b.id}
              role="listitem"
              data-brush-id={b.id}
              className={`brush-item ${b.id === activeId ? 'is-active' : ''} ${dragOver?.id === b.id ? (dragOver.after ? 'drop-below' : 'drop-above') : ''}`}
              onPointerDown={(e) => startDrag(b.id, e)}
              data-testid="brush-item"
            >
              {renaming === b.id ? (
                <div className="brush-main">{body}</div>
              ) : (
                <button
                  type="button"
                  className="brush-main"
                  tabIndex={tab}
                  aria-pressed={b.id === activeId}
                  aria-label={`${b.name}, ${meta}`}
                  data-tip="Click to use · double-click for Brush Lab · F2 rename · Delete removes"
                  onClick={() => choose(b)}
                  onDoubleClick={() => useUi.getState().openDialog('brush-lab', { id: b.id })}
                  onKeyDown={(e) => {
                    if (e.key === 'F2') {
                      e.preventDefault();
                      setRenaming(b.id);
                    }
                    if (e.key === 'Delete') {
                      e.preventDefault();
                      e.stopPropagation();
                      void remove(b);
                    }
                  }}
                >
                  {body}
                </button>
              )}
              <div className="brush-actions">
                <button
                  type="button"
                  tabIndex={tab}
                  className={`mini-btn ${fav ? 'is-fav' : ''}`}
                  aria-label={fav ? `Remove ${b.name} from favourites` : `Add ${b.name} to favourites`}
                  aria-pressed={fav}
                  data-tip="Favourite"
                  onClick={() => store.toggleFavorite(b.id)}
                >
                  <Icon name={fav ? 'starFilled' : 'star'} size={14} />
                </button>
                <button
                  type="button"
                  tabIndex={tab}
                  className="mini-btn"
                  aria-label={`Rename ${b.name}`}
                  data-tip="Rename (F2)"
                  onClick={() => setRenaming(b.id)}
                >
                  <Icon name="text" size={14} />
                </button>
                <button
                  type="button"
                  tabIndex={tab}
                  className="mini-btn"
                  aria-label={`Delete ${b.name}`}
                  data-tip="Delete brush"
                  onClick={() => void remove(b)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
