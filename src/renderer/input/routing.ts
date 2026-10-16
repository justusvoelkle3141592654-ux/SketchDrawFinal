// Decides what a new pointer on the canvas does, from the pen-only and touch-gesture preferences.
import type { InputPreferences } from '../state/preferences';

/**
 * - gesture: second finger starts two-finger pan / pinch / rotate (a touch stroke in progress is dropped)
 * - ignore: the contact is not used (busy, extra fingers)
 * - pan: a finger in pen-only mode navigates instead of painting
 * - tool: the current tool gets the pointer (button mappings and held keys still apply)
 */
export type CanvasDownRoute = 'gesture' | 'ignore' | 'pan' | 'tool';

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
  if (state.active !== null || state.gesture) return 'ignore';
  return touch && input.penOnly ? 'pan' : 'tool';
}
