import { describe, expect, it } from 'vitest';
import {
  CurveInterpolator,
  Resampler,
  Stabilizer,
  type StrokeSample,
} from '../../src/renderer/engine/stroke/pipeline';
import { compileDynamics, evaluateDynamics } from '../../src/renderer/engine/brush/dynamics';
import { createBrush } from '../../src/renderer/engine/brush/schema';
import { predictPath } from '../../src/renderer/engine/stroke/predictive';

const S = (x: number, y: number, time = 0, pressure = 1): StrokeSample => ({
  x,
  y,
  pressure,
  tiltX: 0,
  tiltY: 0,
  twist: 0,
  time,
});

describe('resampler', () => {
  it('emits evenly spaced dabs independent of event rate', () => {
    const coarse: StrokeSample[] = [];
    const fine: StrokeSample[] = [];
    const a = new Resampler(() => 5);
    const b = new Resampler(() => 5);
    a.push(S(0, 0), (s) => coarse.push(s));
    a.push(S(100, 0), (s) => coarse.push(s));
    b.push(S(0, 0), (s) => fine.push(s));
    for (let x = 1; x <= 100; x += 1) b.push(S(x, 0), (s) => fine.push(s));
    const r6 = (s: StrokeSample) => Math.round(s.x * 1e6) / 1e6;
    expect(coarse.map(r6)).toEqual(fine.map(r6));
    expect(coarse.length).toBe(21);
    for (let i = 1; i < coarse.length; i++) expect(coarse[i].x - coarse[i - 1].x).toBeCloseTo(5, 9);
  });
  it('a fast stroke with large gaps between events stays gap-free', () => {
    const out: StrokeSample[] = [];
    const r = new Resampler(() => 2);
    r.push(S(0, 0), (s) => out.push(s));
    r.push(S(500, 300), (s) => out.push(s));
    r.push(S(-200, 900), (s) => out.push(s));
    for (let i = 1; i < out.length; i++) {
      expect(Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y)).toBeLessThanOrEqual(2 + 1e-6);
    }
  });
  it('interpolates pressure along the segment', () => {
    const out: StrokeSample[] = [];
    const r = new Resampler(() => 25);
    r.push(S(0, 0, 0, 0), (s) => out.push(s));
    r.push(S(100, 0, 10, 1), (s) => out.push(s));
    expect(out.map((s) => s.pressure)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
  it('size-dependent spacing never stalls at zero size', () => {
    const out: StrokeSample[] = [];
    const r = new Resampler(() => 0);
    r.push(S(0, 0), (s) => out.push(s));
    r.push(S(10, 0), (s) => out.push(s));
    expect(out.length).toBe(41); // floor of 0.25 px spacing
  });
});

describe('stabiliser', () => {
  it('off passes samples through', () => {
    const st = new Stabilizer('off', 1, 1);
    expect(st.push(S(3, 4, 1))).toEqual([S(3, 4, 1)]);
  });
  it('smooth lags behind and finish() reaches the last raw point', () => {
    const st = new Stabilizer('smooth', 0.8, 1);
    st.push(S(0, 0, 0));
    const out = st.push(S(100, 0, 8));
    expect(out[0].x).toBeGreaterThan(0);
    expect(out[0].x).toBeLessThan(100);
    const tail = st.finish();
    expect(tail[tail.length - 1].x).toBeCloseTo(100, 6);
  });
  it('lazy stabiliser holds still inside the radius', () => {
    const st = new Stabilizer('lazy', 0.5, 1); // radius = 24 screen px
    st.push(S(0, 0));
    expect(st.push(S(10, 0))).toEqual([]);
    const out = st.push(S(40, 0));
    expect(out[0].x).toBeCloseTo(16, 6);
  });
  it('lazy radius is defined in screen pixels', () => {
    const st = new Stabilizer('lazy', 0.5, 4); // 24 screen px = 6 document px
    st.push(S(0, 0));
    expect(st.push(S(10, 0))[0].x).toBeCloseTo(4, 6);
  });
});

describe('curve interpolation', () => {
  it('passes through the input points', () => {
    const ci = new CurveInterpolator(true);
    const pts = [S(0, 0), S(10, 10), S(20, 0), S(30, 10)];
    const out: StrokeSample[] = [];
    for (const p of pts) out.push(...ci.push(p));
    out.push(...ci.finish());
    for (const p of pts) expect(out.some((o) => Math.hypot(o.x - p.x, o.y - p.y) < 1e-9)).toBe(true);
    expect(out[out.length - 1].x).toBe(30);
  });
});

describe('dynamics', () => {
  it('pressure → size with amount', () => {
    const b = createBrush({ id: 't', name: 't' });
    b.dynamics = [
      {
        id: 'a',
        enabled: true,
        input: 'pressure',
        output: 'size',
        amount: 0.5,
        curve: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      },
    ];
    const c = compileDynamics(b);
    const base = { speed: 0, tiltX: 0, tiltY: 0, twist: 0, direction: 0, distance: 0, random: () => 0.5 };
    expect(evaluateDynamics(c, { ...base, pressure: 0 }).size).toBeCloseTo(0.5, 3);
    expect(evaluateDynamics(c, { ...base, pressure: 1 }).size).toBeCloseTo(1, 3);
  });
  it('stroke direction rotates the tip angle', () => {
    const b = createBrush({ id: 't', name: 't' });
    b.dynamics = [
      {
        id: 'a',
        enabled: true,
        input: 'direction',
        output: 'angle',
        amount: 1,
        curve: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      },
    ];
    const c = compileDynamics(b);
    const r = evaluateDynamics(c, {
      pressure: 1,
      speed: 0,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      direction: Math.PI / 2,
      distance: 0,
      random: () => 0,
    });
    expect(r.angle).toBeCloseTo(Math.PI / 2, 2);
  });
  it('disabled mappings have no effect', () => {
    const b = createBrush({ id: 't', name: 't' });
    b.dynamics = b.dynamics.map((d) => ({ ...d, enabled: false }));
    const r = evaluateDynamics(compileDynamics(b), {
      pressure: 0,
      speed: 0,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      direction: 0,
      distance: 0,
      random: () => 0,
    });
    expect(r.size).toBe(1);
    expect(r.opacity).toBe(1);
  });
});

describe('predictive stroke', () => {
  it('turns an almost straight stroke into an exact line, keeping pressure', () => {
    const path: StrokeSample[] = [];
    for (let i = 0; i <= 50; i++) path.push(S(i * 4, Math.sin(i) * 1.5, i, i / 50));
    const out = predictPath(path, 0.5, 1)!;
    expect(out).not.toBeNull();
    for (const p of out)
      expect(
        Math.abs(
          p.y - (path[0].y + ((path[50].y - path[0].y) * (p.x - path[0].x)) / (path[50].x - path[0].x)),
        ),
      ).toBeLessThan(1e-6);
    expect(out[out.length - 1].pressure).toBe(1);
  });
  it('keeps endpoints of curved strokes', () => {
    const path: StrokeSample[] = [];
    for (let i = 0; i <= 60; i++) path.push(S(Math.cos(i / 20) * 100, Math.sin(i / 20) * 100 + (i % 2), i));
    const out = predictPath(path, 0.6, 1)!;
    expect(out[0].x).toBeCloseTo(path[0].x, 6);
    expect(out[out.length - 1].x).toBeCloseTo(path[60].x, 6);
  });
});
