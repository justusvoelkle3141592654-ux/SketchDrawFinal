// Dockable / floating panels with resize, collapse and layout persistence.
import { useRef, type ReactNode } from 'react';
import { useUi, PANEL_TITLES, type PanelId } from '../state/ui';
import { usePrefs } from '../state/preferences';
import { Icon } from './icons';
import { LayersPanel } from './panels/LayersPanel';
import { ColourPanel } from './panels/ColourPanel';
import { BrushesPanel } from './panels/BrushesPanel';
import { PalettesPanel } from './panels/PalettesPanel';
import { AnimationPanel } from './panels/AnimationPanel';
import { ReferencePanel } from './panels/ReferencePanel';

const CONTENT: Record<PanelId, () => ReactNode> = {
  colour: () => <ColourPanel />,
  palettes: () => <PalettesPanel />,
  brushes: () => <BrushesPanel />,
  layers: () => <LayersPanel />,
  animation: () => <AnimationPanel />,
  reference: () => <ReferencePanel />,
};

function PanelHeader({
  id,
  floating,
  onDragStart,
}: {
  id: PanelId;
  floating: boolean;
  onDragStart: (e: React.PointerEvent) => void;
}) {
  const ui = useUi.getState();
  const p = useUi((s) => s.layout.panels[id]);
  return (
    <header
      className="panel-head"
      onPointerDown={onDragStart}
      onDoubleClick={() => ui.setLayout((l) => void (l.panels[id].collapsed = !l.panels[id].collapsed))}
    >
      <h2 className="panel-title" id={`panel-title-${id}`}>
        {PANEL_TITLES[id]}
      </h2>
      <div className="panel-head-actions" onPointerDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="mini-btn"
          aria-label={p.collapsed ? `Expand ${PANEL_TITLES[id]}` : `Collapse ${PANEL_TITLES[id]}`}
          data-tip={p.collapsed ? 'Expand' : 'Collapse'}
          onClick={() => ui.setLayout((l) => void (l.panels[id].collapsed = !l.panels[id].collapsed))}
        >
          <Icon name={p.collapsed ? 'expand' : 'collapse'} size={14} />
        </button>
        <button
          type="button"
          className="mini-btn"
          aria-label={floating ? `Dock ${PANEL_TITLES[id]}` : `Float ${PANEL_TITLES[id]}`}
          data-tip={floating ? 'Dock to the side' : 'Float (or drag the title out of the dock)'}
          onClick={() =>
            ui.setLayout((l) => {
              const ps = l.panels[id];
              ps.floating = !ps.floating;
              if (ps.floating) {
                ps.x = Math.max(80, window.innerWidth - l.dockWidth - ps.w - 40);
                ps.y = 120;
              }
            })
          }
        >
          <Icon name={floating ? 'dock' : 'float'} size={14} />
        </button>
        <button
          type="button"
          className="mini-btn"
          aria-label={`Hide ${PANEL_TITLES[id]}`}
          data-tip="Hide panel"
          onClick={() => ui.togglePanel(id, false)}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    </header>
  );
}

function DockedPanel({ id, weight }: { id: PanelId; weight: number }) {
  const collapsed = useUi((s) => s.layout.panels[id].collapsed);
  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 40) return;
      cleanup();
      // tear the panel out of the dock under the pointer
      useUi.getState().setLayout((l) => {
        const p = l.panels[id];
        p.floating = true;
        p.x = Math.max(0, ev.clientX - p.w / 2);
        p.y = Math.max(40, ev.clientY - 14);
      });
    };
    const up = () => cleanup();
    const cleanup = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };
  return (
    <section
      className={`panel is-docked ${collapsed ? 'is-collapsed' : ''}`}
      style={{ flexGrow: collapsed ? 0 : weight }}
      aria-labelledby={`panel-title-${id}`}
      data-testid={`panel-${id}`}
    >
      <PanelHeader id={id} floating={false} onDragStart={startDrag} />
      {!collapsed ? <div className="panel-body">{CONTENT[id]()}</div> : null}
    </section>
  );
}

function Splitter({ above, below }: { above: PanelId; below: PanelId }) {
  const onDown = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    const a = el.previousElementSibling as HTMLElement | null;
    const b = el.nextElementSibling as HTMLElement | null;
    if (!a || !b) return;
    el.setPointerCapture(e.pointerId);
    const ha = a.getBoundingClientRect().height;
    const hb = b.getBoundingClientRect().height;
    const layout = useUi.getState().layout;
    const wa = layout.panels[above].dockWeight;
    const wb = layout.panels[below].dockWeight;
    const total = wa + wb;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      const d = ev.clientY - sy;
      const na = Math.max(60, ha + d);
      const nb = Math.max(60, hb - d);
      useUi.getState().setLayout((l) => {
        l.panels[above].dockWeight = (total * na) / (na + nb);
        l.panels[below].dockWeight = (total * nb) / (na + nb);
      });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  return (
    <div
      className="dock-splitter"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize panels"
      onPointerDown={onDown}
    />
  );
}

export function PanelDock() {
  const layout = useUi((s) => s.layout);
  const leftHanded = usePrefs((s) => s.prefs.leftHanded);
  const docked = layout.order.filter((id) => layout.panels[id].visible && !layout.panels[id].floating);
  const widthRef = useRef<HTMLDivElement>(null);
  if (!docked.length) return null;
  const startResize = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const sx = e.clientX;
    const w0 = layout.dockWidth;
    const move = (ev: PointerEvent) => {
      const d = leftHanded ? ev.clientX - sx : sx - ev.clientX;
      useUi.getState().setLayout((l) => void (l.dockWidth = Math.min(560, Math.max(220, w0 + d))));
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  return (
    <div className="dock" style={{ width: layout.dockWidth }} ref={widthRef} aria-label="Panels">
      <div
        className="dock-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel dock"
        onPointerDown={startResize}
      />
      <div className="dock-stack">
        {docked.map((id, i) => (
          <DockFragment key={id} id={id} next={docked[i + 1]} weight={layout.panels[id].dockWeight} />
        ))}
      </div>
    </div>
  );
}

function DockFragment({ id, next, weight }: { id: PanelId; next?: PanelId; weight: number }) {
  return (
    <>
      <DockedPanel id={id} weight={weight} />
      {next ? <Splitter above={id} below={next} /> : null}
    </>
  );
}

export function FloatingPanels() {
  const layout = useUi((s) => s.layout);
  const floating = layout.order.filter((id) => layout.panels[id].visible && layout.panels[id].floating);
  return (
    <>
      {floating.map((id) => (
        <FloatingPanel key={id} id={id} />
      ))}
    </>
  );
}

function FloatingPanel({ id }: { id: PanelId }) {
  const p = useUi((s) => s.layout.panels[id]);
  const leftHanded = usePrefs((s) => s.prefs.leftHanded);
  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    const x0 = p.x;
    const y0 = p.y;
    const move = (ev: PointerEvent) => {
      useUi.getState().setLayout((l) => {
        const ps = l.panels[id];
        ps.x = Math.min(window.innerWidth - 80, Math.max(-ps.w + 80, x0 + ev.clientX - sx));
        ps.y = Math.min(window.innerHeight - 40, Math.max(36, y0 + ev.clientY - sy));
      });
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      // drop near the dock edge to dock again
      const nearDock = leftHanded ? ev.clientX < 48 : ev.clientX > window.innerWidth - 48;
      if (nearDock) useUi.getState().setLayout((l) => void (l.panels[id].floating = false));
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  const startResize = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    const w0 = p.w;
    const h0 = p.h;
    const move = (ev: PointerEvent) =>
      useUi.getState().setLayout((l) => {
        l.panels[id].w = Math.min(900, Math.max(220, w0 + ev.clientX - sx));
        l.panels[id].h = Math.min(window.innerHeight - 60, Math.max(140, h0 + ev.clientY - sy));
      });
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  return (
    <section
      className={`panel is-floating ${p.collapsed ? 'is-collapsed' : ''}`}
      style={{ left: p.x, top: p.y, width: p.w, height: p.collapsed ? undefined : p.h }}
      aria-labelledby={`panel-title-${id}`}
      data-testid={`panel-${id}`}
    >
      <PanelHeader id={id} floating onDragStart={startDrag} />
      {!p.collapsed ? (
        <>
          <div className="panel-body">{CONTENT[id]()}</div>
          <div className="panel-resize" aria-hidden="true" onPointerDown={startResize} />
        </>
      ) : null}
    </section>
  );
}
