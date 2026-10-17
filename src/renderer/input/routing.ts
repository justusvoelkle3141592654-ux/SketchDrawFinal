// Canvas input routing: what a new pointer does (pen-only, touch gestures), palms and pen proximity.
import type { Point } from '../engine/geometry';
import type { InputPreferences } from '../state/preferences';

/**
 * - gesture: second finger starts two-finger pan / pinch / rotate (a touch stroke in progress is dropped)
 * - ignore: the contact is not used (busy, extra fingers)
 * - palm: a touch that lands during a pen or mouse stroke, or near a hovering pen in pen-only mode;
 *   it is ignored until it lifts and never counts as a finger
 * - pan: a finger in pen-only mode navigates instead of painting
 * - preempt: pen-only mode, a pen or mouse lands while fingers navigate; once the pen or mouse is
 *   accepted the touch pan or gesture is dropped (no quick-tap undo) and its contacts become palms
 * - tool: the current tool gets the pointer (button mappings and held keys still apply)
 */
export type CanvasDownRoute = 'gesture' | 'ignore' | 'palm' | 'pan' | 'preempt' | 'tool';

export interface CanvasPointerState {
  /** Fingers on the canvas (palms excluded), including the new one when it is a touch. */
  touches: number;
  /** Pointer type of the stroke or drag in progress, or null. */
  active: string | null;
  /** A two-finger gesture is in progress. */
  gesture: boolean;
  /** A pen is hovering or touching (see PenProximity). */
  penNear: boolean;
}

/** Movement (CSS px) a pen-only touch pan or gesture needs before it moves the view: palms settle. */
export const PALM_SLOP = 24;
/** A pen counts as near this long (ms) after its last event, unless it reported leaving earlier. */
export const PEN_NEAR_TIMEOUT = 500;

export function routePointerDown(
  pointerType: string,
  input: Pick<InputPreferences, 'penOnly' | 'touchGestures'>,
  state: CanvasPointerState,
): CanvasDownRoute {
  const touch = pointerType === 'touch';
  if (touch) {
    // A pen or mouse stroke keeps the view: a palm landing mid-stroke must not pan, zoom or undo.
    if (state.active !== null && state.active !== 'touch') return 'palm';
    // In pen-only mode a contact made while the pen hovers is the hand holding it.
    if (input.penOnly && state.penNear) return 'palm';
    if (state.touches === 2 && input.touchGestures) return 'gesture';
    if (state.touches > 2) return 'ignore';
  }
  if (state.active !== null || state.gesture) {
    // Palms usually land before the pen: in pen-only mode touch only navigates, so the pen wins.
    const fingers = state.gesture || state.active === 'touch';
    return !touch && input.penOnly && fingers ? 'preempt' : 'ignore';
  }
  return touch && input.penOnly ? 'pan' : 'tool';
}

/** Touch contacts on the canvas. Palms stay known until they lift but never count as fingers. */
export class TouchContacts {
  private points = new Map<number, Point>();
  private palms = new Set<number>();

  get size() {
    return this.points.size;
  }

  down(id: number, p: Point) {
    this.points.set(id, p);
    this.palms.delete(id);
  }

  /** Updates a known contact; false when the id is not on the canvas. */
  move(id: number, p: Point): boolean {
    if (!this.points.has(id)) return false;
    this.points.set(id, p);
    return true;
  }

  up(id: number) {
    this.points.delete(id);
    this.palms.delete(id);
  }

  palm(id: number) {
    if (this.points.has(id)) this.palms.add(id);
  }

  /** Every contact on the canvas becomes a palm (a pen or mouse took over). */
  allPalms() {
    for (const id of this.points.keys()) this.palms.add(id);
  }

  get(id: number): Point | undefined {
    return this.points.get(id);
  }

  isPalm(id: number) {
    return this.palms.has(id);
  }

  /** Contacts that are not palms, in landing order. */
  fingers(): [number, Point][] {
    return [...this.points].filter(([id]) => !this.palms.has(id));
  }
}

/**
 * Whether a pen is in hover range. Windows Ink reports hover moves for most pens and a pointerout
 * without relatedTarget when the pen leaves range; the timeout covers drivers that never say so.
 */
export class PenProximity {
  private last = -Infinity;
  private gone = true;

  constructor(private readonly timeout = PEN_NEAR_TIMEOUT) {}

  /** Any pen event (hover or contact) at time t (ms). */
  seen(t: number) {
    this.last = t;
    this.gone = false;
  }

  /** The pen left hover range or the window. */
  left() {
    this.gone = true;
  }

  near(t: number) {
    return !this.gone && t - this.last <= this.timeout;
  }
}
