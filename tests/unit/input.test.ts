import { describe, expect, it, vi } from 'vitest';
import { CURVE_PRESETS, makeCurve, type CurvePoint } from '../../src/renderer/engine/curve';
import {
  coalesced,
  mapPressure,
  normalizePointer,
  type RawPointerData,
} from '../../src/renderer/input/normalize';
import { routePointerDown, type CanvasPointerState } from '../../src/renderer/input/routing';
import {
  DEFAULT_PREFERENCES,
  sanitizePreferences,
  type InputPreferences,
} from '../../src/renderer/state/preferences';

// The preferences store imports the preload bridge, which needs a browser window.
vi.mock('../../src/renderer/platform', () => ({ forge: {}, isDesktop: false }));

const prefs = (over: Partial<InputPreferences> = {}): InputPreferences => ({
  ...structuredClone(DEFAULT_PREFERENCES.input),
  ...over,
});

/** A pen sample in contact, shaped like the PointerEvent fields the normaliser reads. */
const ev = (over: Partial<RawPointerData> = {}): RawPointerData => ({
  pointerType: 'pen',
  pressure: 0.5,
  tangentialPressure: 0,
  tiltX: 0,
  tiltY: 0,
  twist: 0,
  width: 1,
  height: 1,
  buttons: 1,
  button: -1,
  ...over,
});

/** A field the platform does not provide. */
const missing = undefined as unknown as number;

describe('pointer normalisation', () => {
  it('maps pen pressure through the dead zone and curve and keeps the raw value', () => {
    const n = normalizePointer(ev({ pressure: 0.4 }), prefs({ deadZone: 0 }), true);
    expect(n.pointerType).toBe('pen');
    expect(n.rawPressure).toBe(0.4);
    expect(n.pressure).toBeCloseTo(0.4, 3);
    // default 2 % threshold: 0.51 sits half-way between threshold and full pressure
    expect(normalizePointer(ev({ pressure: 0.51 }), prefs(), true).pressure).toBeCloseTo(0.5, 3);
    const soft = normalizePointer(
      ev({ pressure: 0.3 }),
      prefs({ deadZone: 0, pressureCurve: CURVE_PRESETS.soft }),
      true,
    );
    expect(soft.pressure).toBeCloseTo(makeCurve(CURVE_PRESETS.soft)(0.3), 3);
    expect(soft.pressure).toBeGreaterThan(0.3);
  });

  it('falls back to the fixed pressure when a pen reports none', () => {
    for (const pressure of [missing, Number.NaN, -1]) {
      const n = normalizePointer(ev({ pressure }), prefs(), true);
      expect(n.pressure).toBe(DEFAULT_PREFERENCES.input.mousePressure);
      expect(n.rawPressure).toBe(-1);
    }
  });

  it('uses the fixed pressure when pressure is switched off but still reports the raw value', () => {
    const n = normalizePointer(
      ev({ pressure: 0.9 }),
      prefs({ pressureEnabled: false, mousePressure: 0.3 }),
      true,
    );
    expect(n.pressure).toBe(0.3);
    expect(n.rawPressure).toBe(0.9);
  });

  it('lifts a zero first-contact sample just above zero; the threshold still applies', () => {
    const noThreshold = normalizePointer(ev({ pressure: 0 }), prefs({ deadZone: 0 }), true);
    expect(noThreshold.rawPressure).toBe(0);
    expect(noThreshold.pressure).toBeGreaterThan(0);
    expect(noThreshold.pressure).toBeLessThan(0.01);
    expect(normalizePointer(ev({ pressure: 0 }), prefs(), true).pressure).toBe(0);
    // hovering pen
    expect(normalizePointer(ev({ pressure: 0, buttons: 0 }), prefs({ deadZone: 0 }), false).pressure).toBe(0);
  });

  it('gives a mouse a stable simulated pressure and no pen data', () => {
    const p = prefs({ mousePressure: 0.6 });
    for (const [pressure, buttons, inContact] of [
      [0.5, 1, true],
      [0, 0, false],
    ] as const) {
      const n = normalizePointer(
        ev({ pointerType: 'mouse', pressure, buttons, tiltX: 30, tiltY: 10, twist: 90 }),
        p,
        inContact,
      );
      expect(n.pointerType).toBe('mouse');
      expect(n.pressure).toBe(0.6);
      expect(n.rawPressure).toBe(-1);
      expect([n.tiltX, n.tiltY, n.twist]).toEqual([0, 0, 0]);
    }
    for (const [buttons, button] of [
      [2, 2],
      [4, 1],
      [32, 5],
    ]) {
      const n = normalizePointer(ev({ pointerType: 'mouse', buttons, button }), p, true);
      expect([n.eraser, n.barrel, n.barrel2]).toEqual([false, false, false]);
    }
  });

  it('gives touch the fixed pressure and reports its contact size', () => {
    const n = normalizePointer(
      ev({ pointerType: 'touch', pressure: 0.3, width: 22, height: 18, tiltX: 40 }),
      prefs(),
      true,
    );
    expect(n.pointerType).toBe('touch');
    expect(n.pressure).toBe(DEFAULT_PREFERENCES.input.mousePressure);
    expect(n.rawPressure).toBe(0.3);
    expect([n.contactWidth, n.contactHeight]).toEqual([22, 18]);
    expect(n.tiltX).toBe(0);
    expect(normalizePointer(ev({ pointerType: 'touch', pressure: missing }), prefs(), true).rawPressure).toBe(
      -1,
    );
  });

  it('treats unknown pointer types as a mouse', () => {
    for (const pointerType of ['', 'unknown']) {
      const n = normalizePointer(ev({ pointerType, pressure: 0.2 }), prefs(), true);
      expect(n.pointerType).toBe('mouse');
      expect(n.pressure).toBe(DEFAULT_PREFERENCES.input.mousePressure);
    }
  });

  it('passes pen tilt, twist, tangential pressure and contact size through', () => {
    const n = normalizePointer(
      ev({ tiltX: -35, tiltY: 20, twist: 270, tangentialPressure: -0.4, width: 2, height: 3 }),
      prefs(),
      true,
    );
    expect([n.tiltX, n.tiltY, n.twist]).toEqual([-35, 20, 270]);
    expect(n.tangentialPressure).toBe(-0.4);
    expect([n.contactWidth, n.contactHeight]).toEqual([2, 3]);
  });

  it('switching tilt off neutralises tilt but keeps rotation', () => {
    const n = normalizePointer(
      ev({ tiltX: -35, tiltY: 20, twist: 270 }),
      prefs({ tiltEnabled: false }),
      true,
    );
    expect([n.tiltX, n.tiltY, n.twist]).toEqual([0, 0, 270]);
  });

  it('treats missing tilt, rotation, tangential pressure and contact size as neutral', () => {
    for (const v of [missing, Number.NaN]) {
      const n = normalizePointer(
        ev({ tiltX: v, tiltY: v, twist: v, tangentialPressure: v, width: v, height: v }),
        prefs(),
        true,
      );
      expect([n.tiltX, n.tiltY, n.twist, n.tangentialPressure]).toEqual([0, 0, 0, 0]);
      expect([n.contactWidth, n.contactHeight]).toEqual([1, 1]);
      expect(Number.isFinite(n.pressure)).toBe(true);
    }
  });

  it('detects the eraser tip and barrel buttons when enabled', () => {
    const flags = (over: Partial<RawPointerData>, p = prefs()) => {
      const n = normalizePointer(ev(over), p, true);
      return [n.eraser, n.barrel, n.barrel2];
    };
    expect(flags({ buttons: 1 })).toEqual([false, false, false]);
    expect(flags({ buttons: 32 })).toEqual([true, false, false]);
    expect(flags({ buttons: 32, button: 5 })).toEqual([true, false, false]);
    expect(flags({ buttons: 2 })).toEqual([false, true, false]);
    expect(flags({ buttons: 0, button: 2 })).toEqual([false, true, false]);
    expect(flags({ buttons: 4 })).toEqual([false, false, true]);
    expect(flags({ buttons: 0, button: 1 })).toEqual([false, false, true]);
    expect(flags({ buttons: 32 }, prefs({ eraserTipEnabled: false }))).toEqual([false, false, false]);
    expect(flags({ buttons: 6 }, prefs({ barrelButtonsEnabled: false }))).toEqual([false, false, false]);
  });
});

describe('pressure mapping', () => {
  it('treats pressure at or below the dead zone as zero and rescales the rest to 0..1', () => {
    const p = prefs({ deadZone: 0.1 });
    expect(mapPressure(0, p)).toBe(0);
    expect(mapPressure(0.05, p)).toBe(0);
    expect(mapPressure(0.1, p)).toBe(0);
    expect(mapPressure(0.11, p)).toBeCloseTo(0.01 / 0.9, 3);
    expect(mapPressure(0.55, p)).toBeCloseTo(0.5, 3);
    expect(mapPressure(1, p)).toBeCloseTo(1, 6);
  });

  it('clamps out-of-range raw values', () => {
    for (const deadZone of [0, 0.02, 0.4]) {
      const p = prefs({ deadZone });
      expect(mapPressure(-0.5, p)).toBe(0);
      expect(mapPressure(1.5, p)).toBeCloseTo(1, 6);
      expect(mapPressure(Number.POSITIVE_INFINITY, p)).toBeCloseTo(1, 6);
    }
  });

  it('follows the user curve and picks up a changed curve', () => {
    const custom: CurvePoint[] = [
      { x: 0, y: 0.2 },
      { x: 0.3, y: 0.3 },
      { x: 0.5, y: 0.5 },
      { x: 0.7, y: 0.65 },
      { x: 1, y: 0.8 },
    ];
    for (const curve of [CURVE_PRESETS.soft, CURVE_PRESETS.firm, custom, CURVE_PRESETS.soft]) {
      const p = prefs({ deadZone: 0.1, pressureCurve: curve });
      const f = makeCurve(curve);
      for (const raw of [0.2, 0.45, 0.8]) expect(mapPressure(raw, p)).toBeCloseTo(f((raw - 0.1) / 0.9), 3);
    }
    // the curve's end points set the minimum and maximum output above the threshold
    const p = prefs({ deadZone: 0.1, pressureCurve: custom });
    expect(mapPressure(0.1001, p)).toBeCloseTo(0.2, 3);
    expect(mapPressure(1, p)).toBeCloseTo(0.8, 6);
  });

  it('is monotone and within 0..1 for every preset and threshold', () => {
    for (const curve of Object.values(CURVE_PRESETS)) {
      for (const deadZone of [0, 0.02, 0.25, 0.4]) {
        const p = prefs({ deadZone, pressureCurve: curve });
        let prev = 0;
        for (let raw = 0; raw <= 1.0001; raw += 0.005) {
          const y = mapPressure(raw, p);
          expect(y).toBeGreaterThanOrEqual(prev - 1e-6);
          expect(y).toBeLessThanOrEqual(1);
          prev = y;
        }
      }
    }
  });

  it('stored preferences keep the threshold and fixed pressure in range', () => {
    const lo = sanitizePreferences({ input: { deadZone: -1, mousePressure: 0 } }).input;
    expect([lo.deadZone, lo.mousePressure]).toEqual([0, 0.05]);
    const hi = sanitizePreferences({ input: { deadZone: 5, mousePressure: 3 } }).input;
    expect([hi.deadZone, hi.mousePressure]).toEqual([0.4, 1]);
    const bad = sanitizePreferences({ input: { deadZone: 'x', mousePressure: Number.NaN } }).input;
    expect([bad.deadZone, bad.mousePressure]).toEqual([
      DEFAULT_PREFERENCES.input.deadZone,
      DEFAULT_PREFERENCES.input.mousePressure,
    ]);
    expect(mapPressure(1, hi)).toBeCloseTo(1, 6);
  });
});

describe('coalesced samples', () => {
  const event = (extra: object = {}) => ({ type: 'pointermove', ...extra }) as unknown as PointerEvent;

  it('uses the event itself when getCoalescedEvents is missing', () => {
    const e = event();
    expect(coalesced(e)).toEqual([e]);
  });

  it('uses the event itself when the list is empty or the call throws', () => {
    const empty = event({ getCoalescedEvents: () => [] });
    expect(coalesced(empty)).toEqual([empty]);
    const throws = event({
      getCoalescedEvents: () => {
        throw new Error('not supported');
      },
    });
    expect(coalesced(throws)).toEqual([throws]);
  });

  it('returns all coalesced samples in order when provided', () => {
    const samples = [event({ clientX: 1 }), event({ clientX: 2 }), event({ clientX: 3 })];
    const e = event({ clientX: 3, getCoalescedEvents: () => samples });
    expect(coalesced(e)).toEqual(samples);
  });
});

describe('canvas routing of pen, mouse and touch', () => {
  const idle: CanvasPointerState = { touches: 0, active: null, gesture: false };
  const allPrefs = [
    { penOnly: false, touchGestures: false },
    { penOnly: false, touchGestures: true },
    { penOnly: true, touchGestures: false },
    { penOnly: true, touchGestures: true },
  ];

  it('pen and mouse always reach the tool', () => {
    for (const p of allPrefs) {
      expect(routePointerDown('pen', p, idle)).toBe('tool');
      expect(routePointerDown('mouse', p, idle)).toBe('tool');
      // a finger resting on the canvas does not block the pen
      expect(routePointerDown('pen', p, { ...idle, touches: 1 })).toBe('tool');
    }
  });

  it('a finger paints only when pen-only mode is off; otherwise it pans', () => {
    const one = { ...idle, touches: 1 };
    expect(routePointerDown('touch', { penOnly: false, touchGestures: true }, one)).toBe('tool');
    expect(routePointerDown('touch', { penOnly: true, touchGestures: true }, one)).toBe('pan');
    expect(routePointerDown('touch', { penOnly: true, touchGestures: false }, one)).toBe('pan');
  });

  it('a second finger starts a gesture when gestures are on, also in pen-only mode', () => {
    for (const penOnly of [false, true]) {
      const two = { ...idle, touches: 2, active: 'touch' };
      expect(routePointerDown('touch', { penOnly, touchGestures: true }, two)).toBe('gesture');
      expect(routePointerDown('touch', { penOnly, touchGestures: false }, two)).toBe('ignore');
    }
  });

  it('touch never disturbs a pen or mouse stroke in progress', () => {
    for (const p of allPrefs) {
      for (const active of ['pen', 'mouse']) {
        expect(routePointerDown('touch', p, { ...idle, touches: 1, active })).toBe('ignore');
        expect(routePointerDown('touch', p, { ...idle, touches: 2, active })).toBe('ignore');
      }
    }
  });

  it('ignores extra fingers and new pointers while busy', () => {
    const p = { penOnly: true, touchGestures: true };
    expect(routePointerDown('touch', p, { ...idle, touches: 3, gesture: true })).toBe('ignore');
    expect(routePointerDown('pen', p, { touches: 2, active: null, gesture: true })).toBe('ignore');
    expect(routePointerDown('pen', p, { ...idle, active: 'touch' })).toBe('ignore');
    expect(routePointerDown('mouse', p, { ...idle, active: 'pen' })).toBe('ignore');
  });
});
