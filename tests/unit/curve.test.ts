import { describe, expect, it } from 'vitest';
import {
  CURVE_PRESETS,
  LINEAR_CURVE,
  makeCurve,
  makeCurveLut,
  normalizeCurve,
} from '../../src/renderer/engine/curve';

describe('pressure / response curves', () => {
  it('linear curve is identity', () => {
    const f = makeCurve(LINEAR_CURVE);
    for (let x = 0; x <= 1; x += 0.05) expect(f(x)).toBeCloseTo(x, 6);
  });
  it('presets are monotone and hit their endpoints', () => {
    for (const pts of Object.values(CURVE_PRESETS)) {
      const f = makeCurve(pts);
      expect(f(0)).toBeCloseTo(0, 6);
      expect(f(1)).toBeCloseTo(1, 6);
      let prev = -1;
      for (let x = 0; x <= 1.0001; x += 0.001) {
        const y = f(x);
        expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = y;
      }
    }
  });
  it('soft curve is above linear, firm below', () => {
    expect(makeCurve(CURVE_PRESETS.soft)(0.3)).toBeGreaterThan(0.3);
    expect(makeCurve(CURVE_PRESETS.firm)(0.3)).toBeLessThan(0.3);
  });
  it('passes through user points and clamps input', () => {
    const pts = [
      { x: 0, y: 0.1 },
      { x: 0.2, y: 0.5 },
      { x: 0.4, y: 0.6 },
      { x: 0.8, y: 0.65 },
      { x: 1, y: 0.9 },
    ];
    const f = makeCurve(pts);
    for (const p of pts) expect(f(p.x)).toBeCloseTo(p.y, 6);
    expect(f(-5)).toBeCloseTo(0.1, 6);
    expect(f(7)).toBeCloseTo(0.9, 6);
  });
  it('normalises unsorted points and adds endpoints', () => {
    const n = normalizeCurve([
      { x: 0.7, y: 0.2 },
      { x: 0.3, y: 0.9 },
    ]);
    expect(n[0]).toEqual({ x: 0, y: 0.9 });
    expect(n[n.length - 1]).toEqual({ x: 1, y: 0.2 });
    expect(n.map((p) => p.x)).toEqual([0, 0.3, 0.7, 1]);
  });
  it('LUT matches the exact curve', () => {
    const f = makeCurve(CURVE_PRESETS.firm);
    const g = makeCurveLut(CURVE_PRESETS.firm);
    for (let x = 0; x <= 1; x += 0.013) expect(g(x)).toBeCloseTo(f(x), 3);
  });
});
