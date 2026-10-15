// Direct manipulation of guide handles (ruler ends, ellipse centre/radii, vanishing points, symmetry centre).
import type { Point } from '../engine/geometry';
import type { DocumentSession } from '../state/documents';

export interface AssistDrag {
  move: (doc: Point, shift: boolean) => void;
}

const HIT = 12;

/** Returns a drag controller when the screen point hits an assist handle. */
export function hitAssistHandle(
  s: DocumentSession,
  screen: Point,
  toScreen: (p: Point) => Point,
): AssistDrag | null {
  const a = s.assist;
  const near = (p: Point) => {
    const q = toScreen(p);
    return Math.hypot(q.x - screen.x, q.y - screen.y) < HIT;
  };
  if (a.ruler.enabled) {
    if (near(a.ruler.a)) return { move: (p, shift) => (a.ruler.a = shift ? snapAngle(a.ruler.b, p) : p) };
    if (near(a.ruler.b)) return { move: (p, shift) => (a.ruler.b = shift ? snapAngle(a.ruler.a, p) : p) };
  }
  if (a.ellipse.enabled) {
    const e = a.ellipse;
    const c = { x: e.cx, y: e.cy };
    const rxH = { x: e.cx + Math.cos(e.angle) * e.rx, y: e.cy + Math.sin(e.angle) * e.rx };
    const ryH = { x: e.cx - Math.sin(e.angle) * e.ry, y: e.cy + Math.cos(e.angle) * e.ry };
    if (near(c)) return { move: (p) => ((e.cx = p.x), (e.cy = p.y)) };
    if (near(rxH))
      return {
        move: (p) => {
          e.rx = Math.max(2, Math.hypot(p.x - e.cx, p.y - e.cy));
          e.angle = Math.atan2(p.y - e.cy, p.x - e.cx);
        },
      };
    if (near(ryH)) return { move: (p) => (e.ry = Math.max(2, Math.hypot(p.x - e.cx, p.y - e.cy))) };
  }
  if (a.perspective.enabled) {
    const vps = a.perspective.vps.slice(0, a.perspective.mode);
    for (let i = 0; i < vps.length; i++) {
      if (near(vps[i]))
        return {
          move: (p, shift) => {
            a.perspective.vps[i] = p;
            // keep the first two vanishing points on a shared horizon unless Shift is held
            if (i < 2 && a.perspective.mode >= 2 && !shift) {
              a.perspective.horizonY = p.y;
              a.perspective.vps[1 - i] = { ...a.perspective.vps[1 - i], y: p.y };
            }
          },
        };
    }
  }
  if (a.symmetry.mode !== 'off' && near({ x: a.symmetry.cx, y: a.symmetry.cy })) {
    return { move: (p) => ((a.symmetry.cx = p.x), (a.symmetry.cy = p.y)) };
  }
  return null;
}

function snapAngle(origin: Point, p: Point): Point {
  const ang = Math.round(Math.atan2(p.y - origin.y, p.x - origin.x) / (Math.PI / 12)) * (Math.PI / 12);
  const d = Math.hypot(p.x - origin.x, p.y - origin.y);
  return { x: origin.x + Math.cos(ang) * d, y: origin.y + Math.sin(ang) * d };
}
