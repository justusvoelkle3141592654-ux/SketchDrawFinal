// Monotone cubic response curves (Fritsch–Carlson), used for pressure curves and brush dynamics.

export interface CurvePoint {
  x: number;
  y: number;
}

export const LINEAR_CURVE: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 0.25, y: 0.25 },
  { x: 0.5, y: 0.5 },
  { x: 0.75, y: 0.75 },
  { x: 1, y: 1 },
];

export const CURVE_PRESETS: Record<'soft' | 'linear' | 'firm', CurvePoint[]> = {
  // Soft: light pressure already produces strong output.
  soft: [
    { x: 0, y: 0 },
    { x: 0.2, y: 0.38 },
    { x: 0.45, y: 0.68 },
    { x: 0.7, y: 0.88 },
    { x: 1, y: 1 },
  ],
  linear: LINEAR_CURVE,
  // Firm: requires more pressure for full output.
  firm: [
    { x: 0, y: 0 },
    { x: 0.3, y: 0.12 },
    { x: 0.55, y: 0.32 },
    { x: 0.8, y: 0.62 },
    { x: 1, y: 1 },
  ],
};

/** Sorts, clamps and de-duplicates points; guarantees endpoints at x=0 and x=1. */
export function normalizeCurve(points: CurvePoint[]): CurvePoint[] {
  const pts = points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) }))
    .sort((a, b) => a.x - b.x);
  const out: CurvePoint[] = [];
  for (const p of pts) {
    if (out.length && Math.abs(out[out.length - 1].x - p.x) < 1e-4) out[out.length - 1] = p;
    else out.push(p);
  }
  if (!out.length || out[0].x > 0) out.unshift({ x: 0, y: out.length ? out[0].y : 0 });
  if (out[out.length - 1].x < 1) out.push({ x: 1, y: out[out.length - 1].y });
  return out;
}

/** Builds a fast evaluator. Output is clamped to 0..1. */
export function makeCurve(points: CurvePoint[]): (x: number) => number {
  const p = normalizeCurve(points);
  const n = p.length;
  if (n === 2) {
    const [a, b] = p;
    return (x) => {
      const t = x <= 0 ? 0 : x >= 1 ? 1 : x;
      return Math.min(1, Math.max(0, a.y + ((b.y - a.y) * (t - a.x)) / (b.x - a.x || 1)));
    };
  }
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = p[i + 1].x - p[i].x;
    slope[i] = (p[i + 1].y - p[i].y) / dx[i];
  }
  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  // Fritsch–Carlson limiter keeps the interpolant monotone between monotone points.
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }
  return (xIn: number) => {
    const x = xIn <= 0 ? 0 : xIn >= 1 ? 1 : xIn;
    let i = 0;
    while (i < n - 2 && x > p[i + 1].x) i++;
    const h = dx[i];
    const t = (x - p[i].x) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const y =
      (2 * t3 - 3 * t2 + 1) * p[i].y +
      (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * p[i + 1].y +
      (t3 - t2) * h * m[i + 1];
    return y < 0 ? 0 : y > 1 ? 1 : y;
  };
}

/** Lookup-table version for hot loops (pressure per sample). */
export function makeCurveLut(points: CurvePoint[], size = 1024): (x: number) => number {
  const f = makeCurve(points);
  const lut = new Float32Array(size + 1);
  for (let i = 0; i <= size; i++) lut[i] = f(i / size);
  return (x: number) => {
    const t = (x <= 0 ? 0 : x >= 1 ? 1 : x) * size;
    const i = Math.floor(t);
    if (i >= size) return lut[size];
    const fr = t - i;
    return lut[i] + (lut[i + 1] - lut[i]) * fr;
  };
}

export function isLinear(points: CurvePoint[]): boolean {
  return normalizeCurve(points).every((p) => Math.abs(p.x - p.y) < 1e-3);
}
