// Searchable list of every command, grouped like a menu. Opened with Ctrl+K or the menu button.
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { allCommands, runCommand, shortcutsFor, type Command } from '../app/commands';
import { Icon } from './icons';

export const usePalette = create<{ open: boolean }>(() => ({ open: false }));
export const openPalette = () => usePalette.setState({ open: true });

const GROUP_ORDER = [
  'Document',
  'Edit',
  'Select',
  'Image',
  'Adjust',
  'Layers',
  'Tools',
  'Brush',
  'Colour',
  'Assist',
  'Drawing modes',
  'View',
  'Panels',
  'App',
];

function matches(c: Command, q: string): boolean {
  if (!q) return true;
  const hay = `${c.label} ${c.group} ${c.hint ?? ''} ${c.id}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

export function CommandPalette() {
  const open = usePalette((s) => s.open);
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const items = useMemo(() => {
    if (!open) return [];
    const order = (g: string) => {
      const i = GROUP_ORDER.indexOf(g);
      return i < 0 ? GROUP_ORDER.length : i;
    };
    return allCommands()
      .filter((c) => c.id !== 'app.commands' && matches(c, q))
      .sort((a, b) => order(a.group) - order(b.group) || a.group.localeCompare(b.group));
  }, [open, q]);
  useEffect(() => {
    if (open) {
      setQ('');
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);
  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  if (!open) return null;
  const close = () => usePalette.setState({ open: false });
  const run = (c: Command | undefined) => {
    if (!c || (c.enabled && !c.enabled())) return;
    close();
    // let the palette unmount (and focus return) before the command opens its own UI
    setTimeout(() => runCommand(c.id), 0);
  };
  let lastGroup = '';
  return (
    <div className="scrim palette-scrim" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Commands"
        data-testid="command-palette"
      >
        <div className="palette-search">
          <Icon name="menu" size={16} />
          <input
            ref={inputRef}
            value={q}
            placeholder="Search commands…"
            aria-label="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[index] ? `palette-${items[index].id}` : undefined}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(items.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                run(items[index]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
              }
              e.stopPropagation();
            }}
            data-testid="palette-input"
          />
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={listRef} aria-label="Commands">
          {items.length === 0 ? <div className="palette-empty">No matching command.</div> : null}
          {items.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            const enabled = c.enabled ? c.enabled() : true;
            const checked = c.checked ? c.checked() : undefined;
            const keys = shortcutsFor(c.id);
            return (
              <div key={c.id} role="presentation">
                {header ? (
                  <div className="palette-group" role="presentation">
                    {header}
                  </div>
                ) : null}
                <div
                  id={`palette-${c.id}`}
                  role="option"
                  aria-selected={i === index}
                  aria-disabled={!enabled}
                  className={`palette-item ${i === index ? 'is-active' : ''} ${enabled ? '' : 'is-disabled'}`}
                  onPointerMove={() => i !== index && setIndex(i)}
                  onClick={() => run(c)}
                  data-testid={`palette-item-${c.id}`}
                >
                  <span className="palette-icon">{c.icon ? <Icon name={c.icon} size={15} /> : null}</span>
                  <span className="palette-label">
                    {c.label}
                    {checked ? <span className="palette-on"> · on</span> : null}
                  </span>
                  {keys.length ? <kbd className="palette-keys">{keys.join('  ')}</kbd> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
