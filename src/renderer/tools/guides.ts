// Drawing guides: strokes that start near a ruler or ellipse follow it; perspective guides lock strokes
// toward the vanishing point that best matches the initial direction.
import type { Point } from '../engine/geometry';
import type { DocumentSession } from '../state/documents';

export type GuideSnapper = (x: number, y: number) => Point;

const SNAP_SCREEN_PX = 40;

export function projectOnLine(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  return { x: a.x + dx * t, y: a.y + dy * t };
}

export function distanceToLine(p: Point, a: Point, b: Point): number {
  const q = projectOnLine(p, a, b);
  return Math.hypot(p.x - q.x, p.y - q.y);
}

export function projectOnEllipse(
  p: Point,
  e: { cx: number; cy: number; rx: number; ry: number; angle: number },
): Point {
  const c = Math.cos(-e.angle);
  const s = Math.sin(-e.angle);
  const lx = (p.x - e.cx) * c - (p.y - e.cy) * s;
  const ly = (p.x - e.cx) * s + (p.y - e.cy) * c;
  const t = Math.atan2(ly / Math.max(1e-6, e.ry), lx / Math.max(1e-6, e.rx));
  const ex = e.rx * Math.cos(t);
  const ey = e.ry * Math.sin(t);
  const c2 = Math.cos(e.angle);
  const s2 = Math.sin(e.angle);
  return { x: e.cx + ex * c2 - ey * s2, y: e.cy + ex * s2 + ey * c2 };
}

export function createGuideSnapper(
  session: DocumentSession,
  start: Point,
  _sx: number,
  _sy: number,
): GuideSnapper | null {
  const a = session.assist;
  const tol = SNAP_SCREEN_PX / session.view.zoom;
  if (a.ruler.enabled && distanceToLine(start, a.ruler.a, a.ruler.b) < tol) {
    return (x, y) => projectOnLine({ x, y }, a.ruler.a, a.ruler.b);
  }
  if (a.ellipse.enabled) {
    const q = projectOnEllipse(start, a.ellipse);
    if (Math.hypot(q.x - start.x, q.y - start.y) < tol)
      return (x, y) => projectOnEllipse({ x, y }, a.ellipse);
  }
  if (a.perspective.enabled) {
    const vps = a.perspective.vps.slice(0, a.perspective.mode);
    let locked: { a: Point; b: Point } | null = null;
    const lockDist = 6 / session.view.zoom;
    return (x, y) => {
      if (!locked) {
        const d = Math.hypot(x - start.x, y - start.y);
        if (d < lockDist) return { x: start.x, y: start.y };
        const dir = Math.atan2(y - start.y, x - start.x);
        // candidate directions: toward each VP; for 1-point also horizontal and vertical
        const candidates: { a: Point; b: Point }[] = vps.map((vp) => ({ a: start, b: vp }));
        if (a.perspective.mode < 3) {
          candidates.push({ a: start, b: { x: start.x, y: start.y + 100 } });
        }
        if (a.perspective.mode === 1) candidates.push({ a: start, b: { x: start.x + 100, y: start.y } });
        let best = candidates[0];
        let bestErr = Infinity;
        for (const c of candidates) {
          const ang = Math.atan2(c.b.y - c.a.y, c.b.x - c.a.x);
          let err = Math.abs(((dir - ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          err = Math.min(err, Math.PI - err); // lines work in both directions
          if (err < bestErr) {
            bestErr = err;
            best = c;
          }
        }
        locked = best;
      }
      return projectOnLine({ x, y }, locked.a, locked.b);
    };
  }
  return null;
}
