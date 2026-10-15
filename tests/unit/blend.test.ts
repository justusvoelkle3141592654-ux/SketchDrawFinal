import { describe, expect, it } from 'vitest';
import { blendInto, loadPremul, modeIndex, storeStraight } from '../../src/renderer/engine/blend';

function px(r: number, g: number, b: number, a: number) {
  // straight → premultiplied
  return new Float32Array([r * a, g * a, b * a, a]);
}
function straight(f: Float32Array) {
  const a = f[3];
  return a > 0 ? [f[0] / a, f[1] / a, f[2] / a, a] : [0, 0, 0, 0];
}

describe('blend modes (premultiplied)', () => {
  it('normal: opaque source replaces', () => {
    const d = px(0.2, 0.4, 0.6, 1);
    blendInto(d, 0, 1, 0, 0, 1, modeIndex('normal'));
    expect([...d]).toEqual([1, 0, 0, 1]);
  });
  it('normal: semi-transparent white over transparent stays white (no dark halo)', () => {
    const d = new Float32Array(4);
    blendInto(d, 0, 0.5, 0.5, 0.5, 0.5, modeIndex('normal'));
    const s = straight(d);
    expect(s[0]).toBeCloseTo(1, 6);
    expect(s[3]).toBeCloseTo(0.5, 6);
  });
  it('multiply of opaque colours', () => {
    const d = px(0.5, 1, 0.2, 1);
    blendInto(d, 0, 0.5, 0.5, 1, 1, modeIndex('multiply'));
    expect(straight(d).map((v) => +v.toFixed(5))).toEqual([0.25, 0.5, 0.2, 1]);
  });
  it('screen, darken, lighten, add, overlay of opaque colours', () => {
    const cases: [Parameters<typeof modeIndex>[0], number[]][] = [
      ['screen', [0.75, 1, 0.84]],
      ['darken', [0.5, 0.5, 0.2]],
      ['lighten', [0.5, 1, 0.8]],
      ['add', [1, 1, 1]],
      ['overlay', [0.5, 1, 0.32]],
    ];
    for (const [mode, expected] of cases) {
      const d = px(0.5, 1, 0.2, 1);
      // source (0.5, 0.5, 0.8)
      blendInto(d, 0, 0.5, 0.5, 0.8, 1, modeIndex(mode));
      const s = straight(d);
      expected.forEach((v, i) => expect(s[i]).toBeCloseTo(v, 5));
    }
  });
  it('colour and luminosity preserve the expected luma', () => {
    const lum = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;
    const d = px(0.2, 0.3, 0.4, 1);
    blendInto(d, 0, 0.9, 0.1, 0.1, 1, modeIndex('color'));
    const s = straight(d);
    expect(lum(s[0], s[1], s[2])).toBeCloseTo(lum(0.2, 0.3, 0.4), 4);
    const e = px(0.2, 0.3, 0.4, 1);
    blendInto(e, 0, 0.9, 0.8, 0.7, 1, modeIndex('luminosity'));
    const t = straight(e);
    expect(lum(t[0], t[1], t[2])).toBeCloseTo(lum(0.9, 0.8, 0.7), 4);
  });
  it('blend modes over transparent destination behave like normal', () => {
    for (const m of ['multiply', 'screen', 'overlay', 'color'] as const) {
      const d = new Float32Array(4);
      blendInto(d, 0, 0.3, 0.2, 0.1, 0.5, modeIndex(m));
      expect([...d].map((v) => +v.toFixed(5))).toEqual([0.3, 0.2, 0.1, 0.5]);
    }
  });
  it('alpha lock keeps destination alpha', () => {
    const d = px(1, 1, 1, 0.4);
    blendInto(d, 0, 0, 0, 0, 1, modeIndex('normal'), true);
    expect(d[3]).toBeCloseTo(0.4, 6);
    expect(straight(d)[0]).toBeCloseTo(0, 6);
    const empty = new Float32Array(4);
    blendInto(empty, 0, 1, 0, 0, 1, modeIndex('normal'), true);
    expect([...empty]).toEqual([0, 0, 0, 0]);
  });
  it('erase reduces alpha and keeps straight colour', () => {
    const d = px(0.8, 0.6, 0.4, 1);
    blendInto(d, 0, 0, 0, 0, 0.25, modeIndex('erase'));
    const s = straight(d);
    expect(s[3]).toBeCloseTo(0.75, 6);
    expect(s[0]).toBeCloseTo(0.8, 6);
  });
  it('8-bit straight ↔ premultiplied float round trip is exact for opaque and semi-transparent pixels', () => {
    const u8 = new Uint8ClampedArray([12, 200, 255, 255, 255, 128, 0, 77, 3, 4, 5, 1, 0, 0, 0, 0]);
    const f = new Float32Array(16);
    const out = new Uint8ClampedArray(16);
    for (let i = 0; i < 16; i += 4) {
      loadPremul(u8, i, f, i);
      storeStraight(f, i, out, i);
    }
    expect([...out.slice(0, 12)]).toEqual([...u8.slice(0, 12)]);
    expect([...out.slice(12)]).toEqual([0, 0, 0, 0]);
  });
});
