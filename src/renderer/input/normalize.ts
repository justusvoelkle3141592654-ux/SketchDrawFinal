// Pointer Event normalisation for pen, touch and mouse, including pressure curve and fallbacks.
import { makeCurveLut } from '../engine/curve';
import type { InputPreferences } from '../state/preferences';

export interface RawPointerData {
  pointerType: string;
  pressure: number;
  tangentialPressure: number;
  tiltX: number;
  tiltY: number;
  twist: number;
  width: number;
  height: number;
  buttons: number;
  button: number;
}

export interface NormalizedInput {
  pointerType: 'pen' | 'touch' | 'mouse';
  /** Raw device pressure (0..1) or −1 when not provided. */
  rawPressure: number;
  /** Final pressure after fallback, dead zone and curve. */
  pressure: number;
  tiltX: number;
  tiltY: number;
  twist: number;
  tangentialPressure: number;
  contactWidth: number;
  contactHeight: number;
  eraser: boolean;
  barrel: boolean;
  barrel2: boolean;
}

let curveCache: { key: string; f: (x: number) => number } | null = null;
function curveFor(prefs: InputPreferences): (x: number) => number {
  const key = JSON.stringify(prefs.pressureCurve);
  if (!curveCache || curveCache.key !== key) curveCache = { key, f: makeCurveLut(prefs.pressureCurve) };
  return curveCache.f;
}

/** Applies dead zone and the user's curve to a raw pen pressure. */
export function mapPressure(raw: number, prefs: InputPreferences): number {
  const dz = prefs.deadZone;
  if (raw <= dz) return 0;
  const x = dz >= 1 ? 1 : (raw - dz) / (1 - dz);
  return curveFor(prefs)(x);
}

export function normalizePointer(
  e: RawPointerData,
  prefs: InputPreferences,
  inContact: boolean,
): NormalizedInput {
  const type: NormalizedInput['pointerType'] =
    e.pointerType === 'pen' ? 'pen' : e.pointerType === 'touch' ? 'touch' : 'mouse';
  const fixed = prefs.mousePressure;
  let pressure = fixed;
  let rawPressure = -1;
  if (type === 'pen') {
    rawPressure = Number.isFinite(e.pressure) ? e.pressure : -1;
    if (prefs.pressureEnabled && rawPressure >= 0) {
      // Some drivers report 0 on the first contact sample; avoid a missing start dot.
      const p = inContact && rawPressure === 0 ? 0.001 : rawPressure;
      pressure = mapPressure(p, prefs);
    } else if (!prefs.pressureEnabled) {
      pressure = fixed;
    }
  } else if (type === 'touch') {
    rawPressure = Number.isFinite(e.pressure) ? e.pressure : -1;
    pressure = fixed;
  }
  const tiltOk = type === 'pen' && prefs.tiltEnabled;
  const eraser = type === 'pen' && prefs.eraserTipEnabled && ((e.buttons & 32) !== 0 || e.button === 5);
  const barrel = type === 'pen' && prefs.barrelButtonsEnabled && ((e.buttons & 2) !== 0 || e.button === 2);
  const barrel2 = type === 'pen' && prefs.barrelButtonsEnabled && ((e.buttons & 4) !== 0 || e.button === 1);
  return {
    pointerType: type,
    rawPressure,
    pressure,
    tiltX: tiltOk && Number.isFinite(e.tiltX) ? e.tiltX : 0,
    tiltY: tiltOk && Number.isFinite(e.tiltY) ? e.tiltY : 0,
    twist: type === 'pen' && Number.isFinite(e.twist) ? e.twist : 0,
    tangentialPressure: Number.isFinite(e.tangentialPressure) ? e.tangentialPressure : 0,
    contactWidth: Number.isFinite(e.width) ? e.width : 1,
    contactHeight: Number.isFinite(e.height) ? e.height : 1,
    eraser,
    barrel,
    barrel2,
  };
}

/** Coalesced samples when supported, otherwise the event itself. Never returns an empty list. */
export function coalesced(e: PointerEvent): PointerEvent[] {
  try {
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    return list.length ? list : [e];
  } catch {
    return [e];
  }
}
