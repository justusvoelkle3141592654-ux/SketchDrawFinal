// Predictive stroke: after pen-up, a nearly straight stroke becomes a clean line and other strokes are
// smoothed. Pressure, tilt and timing are carried over by arc length so dynamics stay intact.
import type { StrokeSample } from './pipeline';
import { lerpSample } from './pipeline';

/** Returns the replacement path, or null when the original should be kept. */
export function predictPath(path: StrokeSample[], strength: number, zoom: number): StrokeSample[] | null {
  if (path.length < 3 || strength <= 0) return null;
  const pts = dedupe(path);
  if (pts.length < 3) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const chord = Math.hypot(last.x - first.x, last.y - first.y);
  const screenChord = chord * zoom;
  if (screenChord < 24) return null;

  // straight line detection: maximum deviation relative to chord length
  let maxDev = 0;
  const ux = (last.x - first.x) / chord;
  const uy = (last.y - first.y) / chord;
  for (const p of pts) {
    const dev = Math.abs((p.x - first.x) * uy - (p.y - first.y) * ux);
    if (dev > maxDev) maxDev = dev;
  }
  const tolerance = 0.025 + strength * 0.035;
  const lengths = cumulative(pts);
  const total = lengths[lengths.length - 1];
  if (maxDev / chord < tolerance && total < chord * 1.15) {
    return pts.map((p, i) => {
      const t = lengths[i] / total;
      return { ...p, x: first.x + (last.x - first.x) * t, y: first.y + (last.y - first.y) * t };
    });
  }

  // otherwise: arc-length resample and Gaussian smoothing with fixed endpoints
  const step = Math.max(1, 2 / zoom);
  const resampled: StrokeSample[] = [];
  let j = 0;
  for (let d = 0; d <= total; d += step) {
    while (j < lengths.length - 2 && lengths[j + 1] < d) j++;
    const seg = lengths[j + 1] - lengths[j] || 1;
    resampled.push(lerpSample(pts[j], pts[j + 1], (d - lengths[j]) / seg));
  }
  resampled.push(last);
  const sigma = Math.max(1, (strength * 14) / step);
  const radius = Math.ceil(sigma * 2.5);
  const weights: number[] = [];
  for (let k = -radius; k <= radius; k++) weights.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  const n = resampled.length;
  const out = resampled.map((p, i) => {
    if (i === 0 || i === n - 1) return p;
    // shrink the kernel near the ends so endpoints stay anchored
    const r = Math.min(radius, i, n - 1 - i);
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (let k = -r; k <= r; k++) {
      const w = weights[k + radius];
      sx += resampled[i + k].x * w;
      sy += resampled[i + k].y * w;
      sw += w;
    }
    return { ...p, x: sx / sw, y: sy / sw };
  });
  return out;
}

function dedupe(path: StrokeSample[]): StrokeSample[] {
  const out: StrokeSample[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const p = path[i];
    const q = out[out.length - 1];
    if (Math.hypot(p.x - q.x, p.y - q.y) > 0.05) out.push(p);
  }
  return out;
}

function cumulative(pts: StrokeSample[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++)
    out.push(out[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return out;
}
