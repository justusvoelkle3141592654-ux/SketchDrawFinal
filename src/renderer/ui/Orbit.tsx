// Orbit: Canvas Forge's radial quick-access ring. A hub sits in the lower corner; the full ring opens
// around the hub or under the pointer (right-click / pen barrel), and works as a marking menu.
import { useEffect, useRef, useState } from 'react';
import { useUi } from '../state/ui';
import { usePrefs } from '../state/preferences';
import { useColors } from '../state/colors';
import { getCommand, runCommand, tooltipFor, useCommandState } from '../app/commands';
import { Icon } from './icons';
import { rgbToCss } from '../engine/color';
import { useBrushes } from '../state/brushes';

const R_OUT = 112;
const R_IN = 44;

function segmentAt(dx: number, dy: number, n: number): number | null {
  const d = Math.hypot(dx, dy);
  if (d < R_IN * 0.75) return null;
  let a = Math.atan2(dy, dx) + Math.PI / 2 + Math.PI / n;
  a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.floor(a / ((Math.PI * 2) / n)) % n;
}

function arcPath(i: number, n: number): string {
  const span = (Math.PI * 2) / n;
  const a0 = -Math.PI / 2 - span / 2 + i * span + 0.02;
  const a1 = a0 + span - 0.04;
  const p = (r: number, a: number) => `${R_OUT + Math.cos(a) * r},${R_OUT + Math.sin(a) * r}`;
  return `M${p(R_IN, a0)} L${p(R_OUT - 2, a0)} A${R_OUT - 2},${R_OUT - 2} 0 0 1 ${p(R_OUT - 2, a1)} L${p(R_IN, a1)} A${R_IN},${R_IN} 0 0 0 ${p(R_IN, a0)} Z`;
}

export function Orbit() {
  useCommandState();
  const orbit = useUi((s) => s.orbit);
  const slots = usePrefs((s) => s.prefs.orbitSlots);
  const leftHanded = usePrefs((s) => s.prefs.leftHanded);
  const fg = useColors((s) => s.fg);
  const brushId = useBrushes((s) => s.activeBrushId);
  const brush = useBrushes((s) => s.brushes.find((b) => b.id === brushId));
  const [hover, setHover] = useState<number | null>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const n = slots.length;
  const close = () => {
    setHover(null);
    useUi.setState({ orbit: { ...useUi.getState().orbit, open: false } });
  };

  // Marking-menu behaviour while opened from a pointer press: release over a segment runs it.
  useEffect(() => {
    if (!orbit.open) return;
    let downInside = false;
    const move = (e: PointerEvent) => {
      setHover(segmentAt(e.clientX - orbit.x, e.clientY - orbit.y, n));
    };
    const up = (e: PointerEvent) => {
      if (!orbit.viaGesture) return;
      const seg = segmentAt(e.clientX - orbit.x, e.clientY - orbit.y, n);
      const dist = Math.hypot(e.clientX - orbit.x, e.clientY - orbit.y);
      if (seg !== null && dist < R_OUT * 1.6) {
        close();
        runCommand(slots[seg]);
      } else {
        // released near the centre: keep it open as a click menu
        useUi.setState({ orbit: { ...useUi.getState().orbit, viaGesture: false } });
      }
    };
    const down = (e: PointerEvent) => {
      downInside = !!ringRef.current?.contains(e.target as Node);
      if (!downInside) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [orbit.open, orbit.x, orbit.y, orbit.viaGesture, n, slots]);

  useEffect(() => {
    if (orbit.open && !orbit.viaGesture) ringRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, [orbit.open, orbit.viaGesture]);

  const openAtHub = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    // keep the ring on screen
    const x = Math.min(window.innerWidth - R_OUT - 8, Math.max(R_OUT + 8, cx));
    const y = Math.min(window.innerHeight - R_OUT - 8, Math.max(R_OUT + 8, cy));
    useUi.setState({ orbit: { open: true, x, y, viaGesture: false } });
  };

  return (
    <>
      <button
        type="button"
        className={`orbit-hub ${leftHanded ? 'is-right' : ''}`}
        aria-label="Open Orbit quick menu"
        aria-expanded={orbit.open}
        data-tip="Orbit quick menu (right-click or pen barrel on the canvas, or the ` key)"
        onClick={openAtHub}
        data-testid="orbit-hub"
      >
        <span className="orbit-hub-color" style={{ background: rgbToCss(fg) }} />
        <Icon name="orbit" size={22} />
        <span className="orbit-hub-size">{brush ? Math.round(brush.diameter) : ''}</span>
      </button>
      {orbit.open ? (
        <div
          className="orbit-ring"
          ref={ringRef}
          style={{ left: orbit.x - R_OUT, top: orbit.y - R_OUT, width: R_OUT * 2, height: R_OUT * 2 }}
          role="menu"
          aria-label="Orbit quick menu"
          data-testid="orbit-ring"
        >
          <svg width={R_OUT * 2} height={R_OUT * 2} aria-hidden="true" className="orbit-svg">
            {slots.map((_, i) => (
              <path key={i} d={arcPath(i, n)} className={`orbit-seg ${hover === i ? 'is-hover' : ''}`} />
            ))}
          </svg>
          {slots.map((id, i) => {
            const c = getCommand(id);
            const span = (Math.PI * 2) / n;
            const a = -Math.PI / 2 + i * span;
            const r = (R_IN + R_OUT) / 2;
            const checked = c?.checked?.();
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                className={`orbit-item ${hover === i ? 'is-hover' : ''} ${checked ? 'is-on' : ''}`}
                style={{ left: R_OUT + Math.cos(a) * r - 20, top: R_OUT + Math.sin(a) * r - 20 }}
                aria-label={c ? tooltipFor(id) : 'Empty segment'}
                data-tip={c ? tooltipFor(id) : undefined}
                onClick={() => {
                  close();
                  if (c) runCommand(id);
                }}
                onPointerEnter={() => setHover(i)}
              >
                <Icon name={c?.icon ?? 'more'} size={19} />
              </button>
            );
          })}
          <button type="button" className="orbit-center" aria-label="Close Orbit" onClick={close}>
            <span className="orbit-center-swatch" style={{ background: rgbToCss(fg) }} />
            <span className="orbit-center-label">
              {hover !== null ? getCommand(slots[hover])?.label : brush?.name}
            </span>
          </button>
        </div>
      ) : null}
    </>
  );
}
