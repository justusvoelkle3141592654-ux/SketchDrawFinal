// Window chrome: title/document tabs, command bar, tool rail, status bar and start screen.
import { useEffect, useState } from 'react';
import { useDocs, useActiveSession } from '../state/documents';
import { useUi } from '../state/ui';
import { usePrefs } from '../state/preferences';
import { useColors } from '../state/colors';
import { useBrushes } from '../state/brushes';
import { getCommand, runCommand, tooltipFor, useCommandState } from '../app/commands';
import { closeSession, openNewDocumentDialog, openDocumentDialog, openRecent } from '../app/file-actions';
import { forge, isMac } from '../platform';
import { AppMark, Icon } from './icons';
import { IconButton } from './controls/controls';
import { rgbToCss } from '../engine/color';
import type { RecentEntry } from '../../shared/ipc';
import { setZoom } from '../app/actions';

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
    <header className={`titlebar ${isMac ? 'is-mac' : ''}`}>
      <div className="titlebar-mark" aria-hidden="true">
        <AppMark size={18} />
        <span className="titlebar-name">Canvas Forge</span>
      </div>
      <div className="doc-tabs" role="tablist" aria-label="Open documents">
        {sessions.map((s) => (
          <div
            key={s.id}
            role="tab"
            aria-selected={s.id === activeId}
            tabIndex={0}
            className={`doc-tab ${s.id === activeId ? 'is-active' : ''}`}
            onClick={() => setActive(s.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setActive(s.id);
            }}
            onAuxClick={(e) => e.button === 1 && void closeSession(s)}
            data-tip={s.filePath ?? 'Not saved yet'}
            data-testid="doc-tab"
          >
            <span className="doc-tab-name">{s.displayName}</span>
            {s.dirty ? (
              <span className="doc-tab-dirty" aria-label="Unsaved changes" data-testid="dirty-dot" />
            ) : null}
            <button
              type="button"
              className="doc-tab-close"
              aria-label={`Close ${s.displayName}`}
              onClick={(e) => {
                e.stopPropagation();
                void closeSession(s);
              }}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
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

const GROUPS: { label: string; ids: string[] }[] = [
  { label: 'Document', ids: ['file.new', 'file.open', 'file.save', 'file.import', 'file.export'] },
  { label: 'History', ids: ['edit.undo', 'edit.redo'] },
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
  },
  {
    label: 'Select & transform',
    ids: ['select.all', 'select.none', 'select.invert', 'tool.transform', 'tool.crop'],
  },
  {
    label: 'Assist',
    ids: ['assist.symmetry', 'assist.ruler', 'assist.ellipse', 'assist.perspective', 'assist.grid'],
  },
  { label: 'Drawing modes', ids: ['mode.stabilizer', 'mode.predictive'] },
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
  },
  { label: 'Focus', ids: ['view.focus', 'app.preferences'] },
];

export function CommandBar() {
  useCommandState();
  return (
    <nav className="commandbar" aria-label="Commands">
      {GROUPS.map((g, i) => {
        const ids = g.ids.filter((id) => getCommand(id));
        if (!ids.length) return null;
        return (
          <div key={g.label} className="cmd-group" role="group" aria-label={g.label}>
            {i > 0 ? <span className="cmd-sep" aria-hidden="true" /> : null}
            {ids.map((id) => (
              <CommandButton key={id} id={id} />
            ))}
          </div>
        );
      })}
    </nav>
  );
}

const RAIL: string[][] = [
  ['tool.brush', 'tool.eraser', 'tool.eyedropper'],
  ['tool.fill', 'tool.gradient'],
  ['tool.select-rect', 'tool.select-ellipse', 'tool.select-lasso', 'tool.select-polygon', 'tool.select-wand'],
  ['tool.transform', 'tool.crop'],
  ['tool.line', 'tool.rect', 'tool.ellipse', 'tool.polygon', 'tool.polyline', 'tool.text'],
  ['tool.pan', 'tool.zoom', 'tool.rotate'],
];

export function ToolRail() {
  useCommandState();
  const fg = useColors((s) => s.fg);
  const bg = useColors((s) => s.bg);
  return (
    <aside className="tool-rail" aria-label="Tools">
      <div className="rail-tools" role="toolbar" aria-orientation="vertical" aria-label="Drawing tools">
        {RAIL.map((group, gi) => (
          <div className="rail-group" key={gi}>
            {group
              .filter((id) => getCommand(id))
              .map((id) => (
                <CommandButton key={id} id={id} size={19} />
              ))}
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
      <footer className="statusbar">
        <span className="status-item">No document open</span>
      </footer>
    );
  }
  const deg = Math.round((s.view.rotation * 180) / Math.PI);
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
