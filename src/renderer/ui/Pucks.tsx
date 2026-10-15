// On-canvas pucks. Size puck: drag horizontally for size, vertically for opacity.
// Navigation puck: drag the centre to pan, the ring to rotate, the zoom strip to zoom.
import { useEffect, useRef } from 'react';
import { useUi } from '../state/ui';
import { useBrushes } from '../state/brushes';
import { activeSession, useDocs } from '../state/documents';
import { adjustActiveBrush, tooltipFor } from '../app/commands';
import { canvasViewport, requestRedraw } from '../app/actions';
import { rotateAt, zoomAt } from '../engine/view';
import { Icon } from './icons';
import { usePrefs } from '../state/preferences';
import { useColors } from '../state/colors';
import { rgbToCss } from '../engine/color';

function useDragOutside(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [open, onClose, ref]);
}

export function SizePuck() {
  const puck = useUi((s) => s.sizePuck);
  const tool = useUi((s) => s.tool);
  const brush = useBrushes((s) =>
    s.brushes.find((b) => b.id === (tool === 'eraser' ? s.activeEraserId : s.activeBrushId)),
  );
  const fg = useColors((s) => s.fg);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => useUi.setState({ sizePuck: { ...useUi.getState().sizePuck, open: false } });
  useDragOutside(puck.open, close, ref);
  if (!puck.open || !brush) return null;
  const start = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    const d0 = brush.diameter;
    const o0 = brush.opacity;
    let axis: 'x' | 'y' | null = null;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!axis && Math.hypot(dx, dy) > 4) axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      if (axis === 'x')
        adjustActiveBrush(
          (b) => void (b.diameter = Math.min(1000, Math.max(0.5, d0 * Math.pow(2, dx / 90)))),
        );
      if (axis === 'y')
        adjustActiveBrush((b) => void (b.opacity = Math.min(1, Math.max(0.01, o0 - dy / 220))));
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  const preview = Math.min(70, Math.max(2, brush.diameter * (activeSession()?.view.zoom ?? 1)));
  return (
    <div
      className="puck size-puck"
      ref={ref}
      style={{ left: puck.x - 54, top: puck.y - 54 }}
      role="slider"
      aria-label={`Brush size ${Math.round(brush.diameter)} px and opacity ${Math.round(brush.opacity * 100)} %. Drag left/right for size, up/down for opacity. Arrow keys also work.`}
      aria-valuenow={Math.round(brush.diameter)}
      tabIndex={0}
      onPointerDown={start}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight')
          adjustActiveBrush((b) => void (b.diameter = Math.min(1000, b.diameter * 1.1)));
        else if (e.key === 'ArrowLeft')
          adjustActiveBrush((b) => void (b.diameter = Math.max(0.5, b.diameter / 1.1)));
        else if (e.key === 'ArrowUp')
          adjustActiveBrush((b) => void (b.opacity = Math.min(1, b.opacity + 0.05)));
        else if (e.key === 'ArrowDown')
          adjustActiveBrush((b) => void (b.opacity = Math.max(0.01, b.opacity - 0.05)));
        else return;
        e.preventDefault();
      }}
      data-testid="size-puck"
    >
      <span
        className="puck-dot"
        style={{ width: preview, height: preview, background: rgbToCss(fg, brush.opacity) }}
      />
      <span className="puck-label">
        {Math.round(brush.diameter * 10) / 10} px · {Math.round(brush.opacity * 100)} %
      </span>
      <span className="puck-hint">↔ size · ↕ opacity</span>
    </div>
  );
}

export function NavPuck() {
  const puck = useUi((s) => s.navPuck);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => useUi.setState({ navPuck: { ...useUi.getState().navPuck, open: false } });
  useDragOutside(puck.open, close, ref);
  if (!puck.open) return null;
  const startPan = (e: React.PointerEvent) => {
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    let lx = e.clientX;
    let ly = e.clientY;
    const move = (ev: PointerEvent) => {
      const s = activeSession();
      if (!s) return;
      s.view = { ...s.view, panX: s.view.panX + ev.clientX - lx, panY: s.view.panY + ev.clientY - ly };
      lx = ev.clientX;
      ly = ev.clientY;
      requestRedraw();
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      useDocs.getState().bump();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  const startRotate = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const s0 = activeSession();
    if (!s0) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const a0 = Math.atan2(e.clientY - cy, e.clientX - cx);
    const rot0 = s0.view.rotation;
    const move = (ev: PointerEvent) => {
      const s = activeSession();
      if (!s) return;
      let rot = rot0 + Math.atan2(ev.clientY - cy, ev.clientX - cx) - a0;
      if (ev.shiftKey) rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12);
      const c = { x: canvasViewport.width / 2, y: canvasViewport.height / 2 };
      s.view = rotateAt(s.view, canvasViewport, s.doc.width, s.doc.height, rot, c);
      requestRedraw();
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      useDocs.getState().bump();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  const startZoom = (e: React.PointerEvent) => {
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const s0 = activeSession();
    if (!s0) return;
    const z0 = s0.view.zoom;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      const s = activeSession();
      if (!s) return;
      const c = { x: canvasViewport.width / 2, y: canvasViewport.height / 2 };
      s.view = zoomAt(
        s.view,
        canvasViewport,
        s.doc.width,
        s.doc.height,
        z0 * Math.pow(2, (sy - ev.clientY) / 80),
        c,
      );
      requestRedraw();
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      useDocs.getState().bump();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  return (
    <div
      className="puck nav-puck"
      ref={ref}
      style={{ left: puck.x - 64, top: puck.y - 64 }}
      aria-label="Navigation puck"
      role="group"
      data-testid="nav-puck"
    >
      <div
        className="nav-ring"
        onPointerDown={startRotate}
        aria-label="Drag the ring to rotate the view (Shift snaps to 15°)"
        data-tip="Ring: rotate (Shift snaps)"
      >
        <div className="nav-center" onPointerDown={startPan} aria-label="Drag to pan" data-tip="Centre: pan">
          <Icon name="pan" size={20} />
        </div>
      </div>
      <div
        className="nav-zoom"
        onPointerDown={startZoom}
        aria-label="Drag up or down to zoom"
        data-tip="Drag up/down: zoom"
      >
        <Icon name="zoom" size={16} />
      </div>
    </div>
  );
}

export function openSizePuckAtPointer() {
  const ui = useUi.getState();
  const el = document.querySelector('.canvas');
  const r = el?.getBoundingClientRect();
  const x = r ? (ui.pointer.inside ? r.left + ui.pointer.x : r.left + r.width / 2) : window.innerWidth / 2;
  const y = r ? (ui.pointer.inside ? r.top + ui.pointer.y : r.top + r.height / 2) : window.innerHeight / 2;
  useUi.setState({ sizePuck: { open: !ui.sizePuck.open, x, y }, navPuck: { ...ui.navPuck, open: false } });
}

export function openNavPuckAtPointer() {
  const ui = useUi.getState();
  const el = document.querySelector('.canvas');
  const r = el?.getBoundingClientRect();
  const x = r ? (ui.pointer.inside ? r.left + ui.pointer.x : r.left + r.width / 2) : window.innerWidth / 2;
  const y = r ? (ui.pointer.inside ? r.top + ui.pointer.y : r.top + r.height / 2) : window.innerHeight / 2;
  useUi.setState({ navPuck: { open: !ui.navPuck.open, x, y }, sizePuck: { ...ui.sizePuck, open: false } });
}

export function openOrbitAtPointer() {
  const ui = useUi.getState();
  const el = document.querySelector('.canvas');
  const r = el?.getBoundingClientRect();
  const x = r ? (ui.pointer.inside ? r.left + ui.pointer.x : r.left + 140) : 140;
  const y = r ? (ui.pointer.inside ? r.top + ui.pointer.y : r.bottom - 140) : window.innerHeight - 140;
  useUi.setState({
    orbit: {
      open: !ui.orbit.open,
      x: Math.max(120, Math.min(window.innerWidth - 120, x)),
      y: Math.max(120, Math.min(window.innerHeight - 120, y)),
      viaGesture: false,
    },
  });
}

/** Persistent mini pucks in the canvas corner (discoverability; click to summon). */
export function PuckDock() {
  const leftHanded = usePrefs((s) => s.prefs.leftHanded);
  return (
    <div className={`puck-dock ${leftHanded ? 'is-left' : ''}`}>
      <button
        type="button"
        className="puck-mini"
        aria-label="Brush size and opacity puck"
        data-tip={tooltipFor('puck.size')}
        onClick={openSizePuckAtPointer}
        data-testid="puck-size-btn"
      >
        <Icon name="puck" size={18} />
      </button>
      <button
        type="button"
        className="puck-mini"
        aria-label="Navigation puck"
        data-tip={tooltipFor('puck.nav')}
        onClick={openNavPuckAtPointer}
        data-testid="puck-nav-btn"
      >
        <Icon name="pan" size={18} />
      </button>
    </div>
  );
}
