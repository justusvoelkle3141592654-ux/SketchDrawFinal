// Decides what a new pointer on the canvas does, from the pen-only and touch-gesture preferences.
import type { InputPreferences } from '../state/preferences';

/**
 * - gesture: second finger starts two-finger pan / pinch / rotate (a touch stroke in progress is dropped)
 * - ignore: the contact is not used (busy, extra fingers)
 * - pan: a finger in pen-only mode navigates instead of painting
 * - preempt: pen-only mode, a pen or mouse lands while fingers navigate; the touch pan or gesture is
 *   dropped (no quick-tap undo) and the pen or mouse then gets the tool, so resting palms never block it
 * - tool: the current tool gets the pointer (button mappings and held keys still apply)
 */
export type CanvasDownRoute = 'gesture' | 'ignore' | 'pan' | 'preempt' | 'tool';

export interface CanvasPointerState {
  /** Fingers on the canvas, including the new one when it is a touch. */
  touches: number;
  /** Pointer type of the stroke or drag in progress, or null. */
  active: string | null;
  /** A two-finger gesture is in progress. */
  gesture: boolean;
}

export function routePointerDown(
  pointerType: string,
  input: Pick<InputPreferences, 'penOnly' | 'touchGestures'>,
  state: CanvasPointerState,
): CanvasDownRoute {
  const touch = pointerType === 'touch';
  if (touch) {
    // A pen or mouse stroke keeps the view: a palm landing mid-stroke must not pan, zoom or undo.
    const free = state.active === null || state.active === 'touch';
    if (state.touches === 2 && input.touchGestures && free) return 'gesture';
    if (state.touches > 2) return 'ignore';
  }
  if (state.active !== null || state.gesture) {
    // Palms usually land before the pen: in pen-only mode touch only navigates, so the pen wins.
    const fingers = state.gesture || state.active === 'touch';
    return !touch && input.penOnly && fingers ? 'preempt' : 'ignore';
  }
  return touch && input.penOnly ? 'pan' : 'tool';
}
