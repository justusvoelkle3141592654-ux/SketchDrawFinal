// Stroke input processing: stabilisation, curve interpolation and spacing-based resampling.

export interface StrokeSample {
  /** Document pixels. */
  x: number;
  y: number;
  /** 0..1, after the user's pressure curve. */
  pressure: number;
  /** Degrees −90..90 (0 = perpendicular). */
  tiltX: number;
  tiltY: number;
  /** Degrees 0..359. */
  twist: number;
  /** Milliseconds (monotonic). */
  time: number;
}

export function lerpSample(a: StrokeSample, b: StrokeSample, t: number): StrokeSample {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    pressure: a.pressure + (b.pressure - a.pressure) * t,
    tiltX: a.tiltX + (b.tiltX - a.tiltX) * t,
    tiltY: a.tiltY + (b.tiltY - a.tiltY) * t,
    twist: lerpAngleDeg(a.twist, b.twist, t),
    time: a.time + (b.time - a.time) * t,
  };
}

function lerpAngleDeg(a: number, b: number, t: number): number {
  let d = ((b - a + 540) % 360) - 180;
  if (d < -180) d += 360;
  return (((a + d * t) % 360) + 360) % 360;
}

export type StabilizerKind = 'off' | 'smooth' | 'lazy';

/**
 * Stabiliser.
 *  - off: raw samples.
 *  - smooth: time-based exponential smoothing (τ up to 90 ms); finish() catches up to the pen.
 *  - lazy: "pulled string" — the brush only follows once the pen is further than a radius away.
 * Distances are configured in screen pixels and converted with the view zoom.
 */
export class Stabilizer {
  private cur: StrokeSample | null = null;
  private lastRaw: StrokeSample | null = null;
  private readonly tau: number;
  private readonly radius: number;

  constructor(
    readonly kind: StabilizerKind,
    readonly amount: number,
    zoom: number,
  ) {
    const a = Math.min(1, Math.max(0, amount));
    this.tau = a * 90;
    this.radius = (a * 48) / Math.max(zoom, 0.0001);
  }

  push(s: StrokeSample): StrokeSample[] {
    this.lastRaw = s;
    if (!this.cur || this.kind === 'off' || this.amount <= 0) {
      this.cur = s;
      return [s];
    }
    if (this.kind === 'smooth') {
      const dt = Math.max(1, s.time - this.cur.time);
      const k = 1 - Math.exp(-dt / Math.max(1, this.tau));
      const kp = 1 - Math.exp(-dt / Math.max(1, this.tau * 0.5));
      const next: StrokeSample = {
        ...lerpSample(this.cur, s, k),
        pressure: this.cur.pressure + (s.pressure - this.cur.pressure) * kp,
        time: s.time,
      };
      this.cur = next;
      return [next];
    }
    // lazy / pulled string
    const dx = s.x - this.cur.x;
    const dy = s.y - this.cur.y;
    const d = Math.hypot(dx, dy);
    if (d <= this.radius) {
      // keep pressure/tilt live so dynamics react even while the string is slack
      this.cur = {
        ...this.cur,
        pressure: s.pressure,
        tiltX: s.tiltX,
        tiltY: s.tiltY,
        twist: s.twist,
        time: s.time,
      };
      return [];
    }
    const move = (d - this.radius) / d;
    const next: StrokeSample = {
      ...s,
      x: this.cur.x + dx * move,
      y: this.cur.y + dy * move,
    };
    this.cur = next;
    return [next];
  }

  /** Remaining output at pen-up. The smooth stabiliser converges to the last raw point. */
  finish(): StrokeSample[] {
    if (!this.cur || !this.lastRaw || this.kind !== 'smooth' || this.amount <= 0) return [];
    const out: StrokeSample[] = [];
    const from = this.cur;
    const to = this.lastRaw;
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    if (d < 0.25) return [];
    const steps = Math.min(24, Math.max(2, Math.ceil(d / 2)));
    for (let i = 1; i <= steps; i++) out.push(lerpSample(from, to, i / steps));
    this.cur = to;
    return out;
  }
}

/**
 * Catmull–Rom (centripetal-ish uniform) interpolation between incoming points, emitting short linear
 * pieces. Introduces a one-sample delay; finish() flushes the tail.
 */
export class CurveInterpolator {
  private pts: StrokeSample[] = [];
  constructor(private readonly enabled: boolean) {}

  push(s: StrokeSample): StrokeSample[] {
    if (!this.enabled) return [s];
    const last = this.pts[this.pts.length - 1];
    if (last && Math.hypot(s.x - last.x, s.y - last.y) < 0.05) {
      // only pressure/tilt changed: update in place, do not create a degenerate segment
      this.pts[this.pts.length - 1] = { ...s, x: last.x, y: last.y };
      return this.pts.length === 1 ? [] : [];
    }
    this.pts.push(s);
    if (this.pts.length === 1) return [s];
    if (this.pts.length === 2) return [];
    // segment p1→p2 can be produced once p3 is known
    const n = this.pts.length;
    const p0 = this.pts[n - 4] ?? this.pts[n - 3];
    const p1 = this.pts[n - 3];
    const p2 = this.pts[n - 2];
    const p3 = this.pts[n - 1];
    if (this.pts.length > 4) this.pts.shift();
    return segment(p0, p1, p2, p3);
  }

  finish(): StrokeSample[] {
    if (!this.enabled || this.pts.length < 2) return [];
    const n = this.pts.length;
    const p0 = this.pts[n - 3] ?? this.pts[n - 2];
    const p1 = this.pts[n - 2];
    const p2 = this.pts[n - 1];
    const out = segment(p0, p1, p2, p2);
    this.pts = [];
    return out;
  }
}

function segment(p0: StrokeSample, p1: StrokeSample, p2: StrokeSample, p3: StrokeSample): StrokeSample[] {
  const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const steps = Math.max(1, Math.min(64, Math.ceil(len / 1.5)));
  const out: StrokeSample[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const t2 = t * t;
    const t3 = t2 * t;
    const cr = (a: number, b: number, c: number, d: number) =>
      0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    const base = lerpSample(p1, p2, t);
    out.push({ ...base, x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y) });
  }
  return out;
}

/**
 * Emits dab positions at a spacing that may depend on the sample (e.g. pressure-dependent size).
 * Distance left over at the end of one segment carries into the next, so dabs are evenly spaced
 * regardless of input event rate.
 */
export class Resampler {
  private prev: StrokeSample | null = null;
  private untilNext = 0;
  /** Total distance travelled along the resampled path. */
  distance = 0;

  constructor(private readonly spacingAt: (s: StrokeSample) => number) {}

  push(s: StrokeSample, emit: (s: StrokeSample, distance: number) => void): void {
    if (!this.prev) {
      this.prev = s;
      emit(s, 0);
      this.untilNext = this.safeSpacing(s);
      return;
    }
    const a = this.prev;
    const L = Math.hypot(s.x - a.x, s.y - a.y);
    if (L <= 1e-9) {
      this.prev = { ...s, x: a.x, y: a.y };
      return;
    }
    let pos = 0;
    let guard = 0;
    while (this.untilNext <= L - pos && guard++ < 200000) {
      pos += this.untilNext;
      const p = lerpSample(a, s, pos / L);
      emit(p, this.distance + pos);
      this.untilNext = this.safeSpacing(p);
    }
    this.untilNext -= L - pos;
    this.distance += L;
    this.prev = s;
  }

  private safeSpacing(s: StrokeSample): number {
    const v = this.spacingAt(s);
    return v > 0.25 ? v : 0.25;
  }
}

/** Speed in screen px/ms, smoothed, normalised to 0..1 (≈ 3 px/ms = fast). */
export class SpeedTracker {
  private last: StrokeSample | null = null;
  value = 0;
  constructor(private readonly zoom: number) {}
  push(s: StrokeSample): number {
    if (this.last) {
      const dt = Math.max(1, s.time - this.last.time);
      const v = (Math.hypot(s.x - this.last.x, s.y - this.last.y) * this.zoom) / dt;
      const n = Math.min(1, v / 3);
      this.value += (n - this.value) * 0.3;
    }
    this.last = s;
    return this.value;
  }
}
