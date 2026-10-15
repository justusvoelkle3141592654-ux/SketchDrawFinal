// Window chrome: title/document tabs, command bar, tool rail, status bar and start screen.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDocs, useActiveSession } from '../state/documents';
import { useUi, type ToolId } from '../state/ui';
import { usePrefs } from '../state/preferences';
import { useColors } from '../state/colors';
import { useBrushes } from '../state/brushes';
import { getCommand, runCommand, shortcutsFor, tooltipFor, useCommandState } from '../app/commands';
import { closeSession, openNewDocumentDialog, openDocumentDialog, openRecent } from '../app/file-actions';
import { forge, isMac } from '../platform';
import { AppMark, Icon } from './icons';
import { IconButton } from './controls/controls';
import { rgbToCss } from '../engine/color';
import type { RecentEntry } from '../../shared/ipc';
import { setZoom } from '../app/actions';
import { animationOf, currentFrame, frames } from '../app/animation';
import { timelapseSettings, useTimelapse } from '../app/timelapse';

function CommandButton({ id, size }: { id: string; size?: number }) {
  useCommandState();
  const c = getCommand(id);
  if (!c) return null;
  const enabled = c.enabled ? c.enabled() : true;
  const checked = c.checked ? c.checked() : undefined;
  return (
    <IconButton
      icon={c.icon ?? 'more'}
      label={c.label}
      tip={c.hint ? `${tooltipFor(id)} — ${c.hint}` : tooltipFor(id)}
      onClick={() => runCommand(id)}
      disabled={!enabled}
      pressed={checked}
      size={size}
      testId={`cmd-${id}`}
    />
  );
}

export function TitleBar() {
  const sessions = useDocs((s) => s.sessions);
  const activeId = useDocs((s) => s.activeId);
  useDocs((s) => s.rev);
  const setActive = useDocs((s) => s.setActive);
  return (
    <header className={`titlebar ${isMac ? 'is-mac' : ''}`} aria-label="Documents">
      <div className="titlebar-mark" aria-hidden="true">
        <AppMark size={18} />
        <span className="titlebar-name">Canvas Forge</span>
      </div>
      <div className="doc-tabs-row">
        <div className="doc-tabs" role="tablist" aria-label="Open documents">
          {sessions.map((s) => (
            <div
              key={s.id}
              role="tab"
              aria-selected={s.id === activeId}
              aria-label={`${s.displayName}${s.dirty ? ', unsaved changes' : ''}`}
              tabIndex={s.id === activeId ? 0 : -1}
              className={`doc-tab ${s.id === activeId ? 'is-active' : ''}`}
              onClick={() => setActive(s.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setActive(s.id);
                if (e.key === 'Delete') void closeSession(s);
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  const i = sessions.indexOf(s);
                  const next =
                    sessions[(i + (e.key === 'ArrowRight' ? 1 : -1) + sessions.length) % sessions.length];
                  setActive(next.id);
                  requestAnimationFrame(() =>
                    document.querySelector<HTMLElement>(`[data-doc-tab="${next.id}"]`)?.focus(),
                  );
                }
              }}
              onAuxClick={(e) => e.button === 1 && void closeSession(s)}
              data-tip={`${s.filePath ?? 'Not saved yet'} — Ctrl+W or Delete closes`}
              data-doc-tab={s.id}
              data-testid="doc-tab"
            >
              <span className="doc-tab-name">{s.displayName}</span>
              {s.dirty ? <span className="doc-tab-dirty" aria-hidden="true" data-testid="dirty-dot" /> : null}
              {/* pointer shortcut; keyboard users close with Ctrl+W or Delete on the tab */}
              <span
                className="doc-tab-close"
                aria-hidden="true"
                onClick={(e) => {
                  e.stopPropagation();
                  void closeSession(s);
                }}
              >
                <Icon name="close" size={12} />
              </span>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="doc-tab-new"
          aria-label="New document"
          data-tip={tooltipFor('file.new')}
          onClick={() => openNewDocumentDialog()}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
      <div className="titlebar-drag" />
      <div className="titlebar-overlay-space" />
    </header>
  );
}

/** Command bar groups; when the window is narrow, low-priority groups move into the "More" menu. */
const GROUPS: { label: string; ids: string[]; priority: number }[] = [
  { label: 'Menu', ids: ['app.commands'], priority: 100 },
  {
    label: 'Document',
    ids: ['file.new', 'file.open', 'file.save', 'file.import', 'file.export'],
    priority: 90,
  },
  { label: 'History', ids: ['edit.undo', 'edit.redo'], priority: 85 },
  {
    label: 'Navigate',
    ids: [
      'view.fit',
      'view.actual',
      'view.rotateLeft',
      'view.rotateRight',
      'view.resetRotation',
      'view.mirror',
    ],
    priority: 60,
  },
  {
    label: 'Select & transform',
    ids: ['select.all', 'select.none', 'select.invert', 'tool.transform', 'tool.crop'],
    priority: 70,
  },
  {
    label: 'Assist',
    ids: ['assist.symmetry', 'assist.ruler', 'assist.ellipse', 'assist.perspective', 'assist.grid'],
    priority: 50,
  },
  { label: 'Drawing modes', ids: ['mode.stabilizer', 'mode.predictive'], priority: 40 },
  {
    label: 'Panels',
    ids: [
      'panel.colour',
      'panel.palettes',
      'panel.brushes',
      'panel.layers',
      'panel.animation',
      'panel.reference',
    ],
    priority: 30,
  },
  { label: 'Focus', ids: ['view.focus', 'app.preferences'], priority: 80 },
];

const MORE_WIDTH = 48;

export function CommandBar() {
  useCommandState();
  const nav = useRef<HTMLElement>(null);
  const widths = useRef(new Map<string, number>());
  const [hidden, setHidden] = useState<string[]>([]);
  const [more, setMore] = useState<{ x: number; y: number } | null>(null);
  const groups = GROUPS.map((g) => ({ ...g, ids: g.ids.filter((id) => getCommand(id)) })).filter(
    (g) => g.ids.length,
  );

  const recompute = () => {
    const el = nav.current;
    if (!el) return;
    for (const child of el.querySelectorAll<HTMLElement>('[data-group]'))
      widths.current.set(child.dataset.group!, child.offsetWidth);
    if (groups.some((g) => !widths.current.has(g.label))) return;
    const style = getComputedStyle(el);
    const avail = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    let total = groups.reduce((sum, g) => sum + widths.current.get(g.label)!, 0);
    const next: string[] = [];
    const byPriority = [...groups].sort((a, b) => a.priority - b.priority);
    for (const g of byPriority) {
      if (total + (next.length ? MORE_WIDTH : 0) <= avail) break;
      if (g.priority >= 100) break;
      next.push(g.label);
      total -= widths.current.get(g.label)!;
    }
    if (next.join('|') !== hidden.join('|')) setHidden(next);
  };

  useLayoutEffect(recompute);
  useEffect(() => {
    const el = nav.current;
    if (!el) return;
    const ro = new ResizeObserver(() => recompute());
    ro.observe(el);
    return () => ro.disconnect();
  });

  const visible = groups.filter((g) => !hidden.includes(g.label));
  const overflow = groups.filter((g) => hidden.includes(g.label));
  return (
    <nav className="commandbar" aria-label="Commands" ref={nav}>
      {visible.map((g, i) => (
        <div key={g.label} className="cmd-group" role="group" aria-label={g.label} data-group={g.label}>
          {i > 0 ? <span className="cmd-sep" aria-hidden="true" /> : null}
          {g.ids.map((id) => (
            <CommandButton key={id} id={id} />
          ))}
        </div>
      ))}
      {overflow.length ? (
        <div className="cmd-group cmd-more">
          <span className="cmd-sep" aria-hidden="true" />
          <IconButton
            icon="more"
            label="More commands"
            tip={`More: ${overflow.map((g) => g.label).join(', ')}`}
            pressed={!!more}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMore(more ? null : { x: r.right, y: r.bottom + 4 });
            }}
            testId="cmd-more"
          />
        </div>
      ) : null}
      {more && overflow.length ? (
        <MoreMenu groups={overflow} x={more.x} y={more.y} onClose={() => setMore(null)} />
      ) : null}
    </nav>
  );
}

function MoreMenu(props: {
  groups: { label: string; ids: string[] }[];
  x: number;
  y: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[role^=menuitem]:not(:disabled)')?.focus();
    const down = (e: PointerEvent) => {
      if (
        !ref.current?.contains(e.target as Node) &&
        !(e.target as HTMLElement).closest('[data-testid=cmd-more]')
      )
        props.onClose();
    };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      ref={ref}
      className="menu more-menu"
      role="menu"
      aria-label="More commands"
      style={{ right: Math.max(8, window.innerWidth - props.x), top: props.y }}
      onKeyDown={(e) => {
        const items = [
          ...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role^=menuitem]:not(:disabled)'),
        ];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        } else if (e.key === 'Escape' || e.key === 'Tab') {
          e.preventDefault();
          props.onClose();
          document.querySelector<HTMLElement>('[data-testid=cmd-more]')?.focus();
        }
        e.stopPropagation();
      }}
    >
      {props.groups.map((g) => (
        <div key={g.label} role="group" aria-label={g.label}>
          <div className="menu-heading" aria-hidden="true">
            {g.label}
          </div>
          {g.ids.map((id) => {
            const c = getCommand(id)!;
            const checked = c.checked ? c.checked() : undefined;
            const enabled = c.enabled ? c.enabled() : true;
            return (
              <button
                key={id}
                type="button"
                role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                aria-checked={checked}
                disabled={!enabled}
                className="menu-item more-menu-item"
                onClick={() => {
                  props.onClose();
                  runCommand(id);
                }}
              >
                <Icon name={c.icon ?? 'more'} size={16} />
                <span>{c.label}</span>
                {checked ? <Icon name="check" size={14} /> : null}
                {shortcutsFor(id)[0] ? <kbd>{shortcutsFor(id)[0]}</kbd> : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

interface RailGroupDef {
  id: string;
  label: string;
  tools: ToolId[];
}
type RailEntry = ToolId | RailGroupDef;

/** Related tools share one rail button with a flyout, so the rail fits short (768 px) screens. */
const RAIL: RailEntry[][] = [
  ['brush', 'eraser', 'eyedropper'],
  ['fill', 'gradient'],
  [
    {
      id: 'select',
      label: 'Selection tools',
      tools: ['select-rect', 'select-ellipse', 'select-lasso', 'select-polygon', 'select-wand'],
    },
  ],
  ['transform', 'crop'],
  [{ id: 'shapes', label: 'Shape tools', tools: ['line', 'rect', 'ellipse', 'polygon', 'polyline'] }, 'text'],
  [{ id: 'nav', label: 'Navigation tools', tools: ['pan', 'zoom', 'rotate'] }],
];

const lastInGroup = new Map<string, ToolId>();

function RailGroup({ group }: { group: RailGroupDef }) {
  useCommandState();
  const tool = useUi((s) => s.tool);
  const leftHanded = usePrefs((s) => s.prefs.leftHanded);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const opened = useRef(false);
  if (group.tools.includes(tool)) lastInGroup.set(group.id, tool);
  const current = lastInGroup.get(group.id) ?? group.tools[0];
  const cmd = getCommand(`tool.${current}`);
  const active = group.tools.includes(tool);
  const open = () => {
    const r = btn.current!.getBoundingClientRect();
    setMenu({ x: leftHanded ? r.left - 4 : r.right + 4, y: r.top });
  };
  const close = (refocus = true) => {
    setMenu(null);
    if (refocus) btn.current?.focus();
  };
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`icon-btn rail-group-btn ${active ? 'is-on' : ''}`}
        aria-label={`${group.label}: ${cmd?.label ?? current}`}
        aria-pressed={active}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        data-tip={`${tooltipFor(`tool.${current}`)} — right-click, hold or press → for all ${group.label.toLowerCase()}`}
        data-testid={`rail-group-${group.id}`}
        onClick={() => {
          if (opened.current) {
            opened.current = false;
            return;
          }
          runCommand(`tool.${current}`);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          open();
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          hold.current = setTimeout(() => {
            opened.current = true;
            open();
          }, 380);
        }}
        onPointerUp={() => hold.current && clearTimeout(hold.current)}
        onPointerLeave={() => hold.current && clearTimeout(hold.current)}
        onKeyDown={(e) => {
          if (e.key === (leftHanded ? 'ArrowLeft' : 'ArrowRight') || (e.altKey && e.key === 'ArrowDown')) {
            e.preventDefault();
            open();
          }
        }}
      >
        <Icon name={cmd?.icon ?? 'more'} size={19} />
        <span className="rail-group-mark" aria-hidden="true" />
      </button>
      {menu ? (
        <ToolFlyout
          group={group}
          current={tool}
          x={menu.x}
          y={menu.y}
          alignRight={leftHanded}
          onPick={(id) => {
            lastInGroup.set(group.id, id);
            runCommand(`tool.${id}`);
            close();
          }}
          onClose={close}
        />
      ) : null}
    </>
  );
}

function ToolFlyout(props: {
  group: RailGroupDef;
  current: ToolId;
  x: number;
  y: number;
  alignRight: boolean;
  onPick: (id: ToolId) => void;
  onClose: (refocus?: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const items = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]') ?? [])];
    (items().find((b) => b.getAttribute('aria-checked') === 'true') ?? items()[0])?.focus();
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) props.onClose(false);
    };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      ref={ref}
      className="menu tool-flyout"
      role="menu"
      aria-label={props.group.label}
      style={
        props.alignRight
          ? { right: window.innerWidth - props.x, top: props.y }
          : { left: props.x, top: props.y }
      }
      onKeyDown={(e) => {
        const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]')];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        } else if (
          e.key === 'Escape' ||
          e.key === 'Tab' ||
          e.key === (props.alignRight ? 'ArrowRight' : 'ArrowLeft')
        ) {
          e.preventDefault();
          props.onClose();
        }
        e.stopPropagation();
      }}
      data-testid={`flyout-${props.group.id}`}
    >
      {props.group.tools.map((id) => {
        const c = getCommand(`tool.${id}`);
        if (!c) return null;
        const keys = shortcutsFor(c.id);
        return (
          <button
            key={id}
            type="button"
            role="menuitemradio"
            aria-checked={props.current === id}
            className={`menu-item tool-flyout-item ${props.current === id ? 'is-on' : ''}`}
            onClick={() => props.onPick(id)}
          >
            <Icon name={c.icon ?? 'more'} size={16} />
            <span>{c.label}</span>
            {keys.length ? <kbd>{keys[0]}</kbd> : null}
          </button>
        );
      })}
    </div>
  );
}

export function ToolRail() {
  useCommandState();
  const fg = useColors((s) => s.fg);
  const bg = useColors((s) => s.bg);
  return (
    <aside className="tool-rail" aria-label="Tools">
      <div className="rail-tools" role="toolbar" aria-orientation="vertical" aria-label="Drawing tools">
        {RAIL.map((group, gi) => (
          <div className="rail-group" key={gi}>
            {group.map((entry) =>
              typeof entry === 'string' ? (
                getCommand(`tool.${entry}`) ? (
                  <CommandButton key={entry} id={`tool.${entry}`} size={19} />
                ) : null
              ) : (
                <RailGroup key={entry.id} group={entry} />
              ),
            )}
          </div>
        ))}
      </div>
      <div className="rail-colors">
        <button
          type="button"
          className="swatch-fg"
          style={{ background: rgbToCss(fg) }}
          aria-label="Foreground colour — open colour panel"
          data-tip="Foreground colour (F6 opens the colour panel)"
          onClick={() => useUi.getState().togglePanel('colour', true)}
          data-testid="rail-fg"
        />
        <button
          type="button"
          className="swatch-bg"
          style={{ background: rgbToCss(bg) }}
          aria-label="Background colour — swap colours"
          data-tip={tooltipFor('colour.swap')}
          onClick={() => runCommand('colour.swap')}
        />
      </div>
    </aside>
  );
}

export function StatusBar() {
  const s = useActiveSession();
  useTimelapse((t) => t.rev);
  const tool = useUi((x) => x.tool);
  const fg = useColors((x) => x.fg);
  const brushes = useBrushes((x) => x.brushes);
  const activeBrushId = useBrushes((x) => x.activeBrushId);
  const activeEraserId = useBrushes((x) => x.activeEraserId);
  const prefs = usePrefs((x) => x.prefs);
  const brush = brushes.find((b) => b.id === (tool === 'eraser' ? activeEraserId : activeBrushId));
  const [zoomText, setZoomText] = useState('');
  useEffect(() => {
    if (s) setZoomText(`${Math.round(s.view.zoom * 1000) / 10}`);
  }, [s, s?.view.zoom]);
  if (!s) {
    return (
      <footer className="statusbar" aria-label="Status">
        <span className="status-item">No document open</span>
      </footer>
    );
  }
  const deg = Math.round((s.view.rotation * 180) / Math.PI);
  const animation = animationOf(s);
  const recording = timelapseSettings(s).recording;
  return (
    <footer className="statusbar" aria-label="Status">
      <span className="status-item" data-tip="Active brush">
        <Icon name="brush" size={13} /> {brush?.name ?? '—'} ·{' '}
        {brush ? `${Math.round(brush.diameter * 10) / 10} px` : ''} ·{' '}
        {brush ? `${Math.round(brush.opacity * 100)} %` : ''}
      </span>
      <span className="status-item" data-tip="Foreground colour">
        <span className="status-swatch" style={{ background: rgbToCss(fg) }} />
      </span>
      <span className="status-item">
        <label htmlFor="status-zoom" className="sr-only">
          Zoom
        </label>
        <input
          id="status-zoom"
          className="status-zoom"
          value={zoomText}
          aria-label="Zoom percent"
          onChange={(e) => setZoomText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const v = Number(zoomText.replace('%', '').replace(',', '.'));
              if (Number.isFinite(v) && v > 0) setZoom(v / 100);
              (e.target as HTMLInputElement).blur();
            }
          }}
          onBlur={() => setZoomText(`${Math.round(s.view.zoom * 1000) / 10}`)}
          data-testid="status-zoom"
        />
        %
      </span>
      <span className="status-item" data-tip="View rotation">
        <Icon name="rotate" size={13} /> {deg}°{s.view.flipX ? ' · mirrored' : ''}
      </span>
      <span className="status-item" data-tip="Document size">
        {s.doc.width} × {s.doc.height} px · {s.doc.dpi} dpi
      </span>
      <span className="status-spacer" />
      {animation.enabled ? (
        <button
          type="button"
          className="status-item status-chip status-btn"
          data-tip="Animation: current frame (opens the Animation panel)"
          onClick={() => useUi.getState().togglePanel('animation', true)}
        >
          <Icon name="animation" size={13} /> Frame {Math.max(1, currentFrame(s) + 1)} / {frames(s).length}
        </button>
      ) : null}
      {recording ? (
        <button
          type="button"
          className="status-item status-chip status-rec status-btn"
          data-tip="Recording a time-lapse (click to replay or stop)"
          onClick={() => useUi.getState().openDialog('timelapse')}
          data-testid="status-rec"
        >
          <span className="rec-dot" aria-hidden="true" /> REC
        </button>
      ) : null}
      {prefs.stabilizer.mode !== 'off' ? (
        <span className="status-item status-chip">
          Stabiliser {Math.round(prefs.stabilizer.amount * 100)}
        </span>
      ) : null}
      {prefs.predictive.enabled ? <span className="status-item status-chip">Predictive</span> : null}
      <span
        className={`status-item ${s.dirty ? 'status-unsaved' : 'status-saved'}`}
        data-testid="save-status"
      >
        {s.dirty ? 'Unsaved changes' : s.filePath ? 'Saved' : 'Not saved'}
      </span>
    </footer>
  );
}

export function StartScreen() {
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  useEffect(() => {
    void forge.listRecent().then(setRecent);
  }, []);
  return (
    <div className="start-screen" data-testid="start-screen">
      <div className="start-card">
        <div className="start-brand">
          <AppMark size={44} />
          <div>
            <h1>Canvas Forge</h1>
            <p>A tablet-native digital sketchbook with deep brush control and a calm, modern workspace.</p>
          </div>
        </div>
        <div className="start-actions">
          <button
            type="button"
            className="start-action"
            onClick={() => openNewDocumentDialog()}
            data-testid="start-new"
          >
            <Icon name="new" size={22} />
            <span>
              <strong>New canvas</strong>
              <small>{tooltipFor('file.new')}</small>
            </span>
          </button>
          <button type="button" className="start-action" onClick={() => void openDocumentDialog()}>
            <Icon name="open" size={22} />
            <span>
              <strong>Open…</strong>
              <small>.cforge, PNG, JPEG, WebP</small>
            </span>
          </button>
        </div>
        <div className="start-recent">
          <h2>Recent</h2>
          {recent.length === 0 ? <p className="muted">Documents you save or open will appear here.</p> : null}
          <ul>
            {recent.map((r) => (
              <li key={r.path}>
                <button
                  type="button"
                  className="recent-item"
                  disabled={!r.exists}
                  onClick={() => void openRecent(r.path)}
                  data-tip={r.exists ? r.path : 'File not found'}
                >
                  <Icon name="image" size={16} />
                  <span className="recent-name">{r.name}</span>
                  <span className="recent-path">{r.exists ? r.path : 'Missing — moved or deleted'}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Small control that stays visible in Focus Canvas to restore the workspace. */
export function FocusRestore() {
  const focus = useUi((s) => s.focusMode);
  if (!focus) return null;
  return (
    <button
      type="button"
      className="focus-restore"
      aria-label="Show workspace"
      data-tip={`${tooltipFor('view.focus')} — show panels again`}
      onClick={() => useUi.getState().setFocusMode(false)}
      data-testid="focus-restore"
    >
      <Icon name="focus" size={16} />
    </button>
  );
}
