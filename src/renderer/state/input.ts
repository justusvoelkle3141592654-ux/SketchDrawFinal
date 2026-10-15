// Live input diagnostics (latest raw/normalised pointer values) for the Input & Tablet page.
import { create } from 'zustand';
import type { NormalizedInput } from '../input/normalize';

export interface Diagnostics {
  type: string;
  rawPressure: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  twist: number;
  tangentialPressure: number;
  width: number;
  height: number;
  buttons: number;
  eraser: boolean;
  barrel: boolean;
  coalesced: number;
  rateHz: number;
  x: number;
  y: number;
}

interface InputState {
  diag: Diagnostics | null;
  /** Diagnostics only update while a consumer is visible (avoids re-render cost while drawing). */
  listening: number;
  setListening: (delta: number) => void;
  report: (n: NormalizedInput, e: PointerEvent, coalescedCount: number) => void;
}

let lastTime = 0;
let rate = 0;

export const useInput = create<InputState>((set, get) => ({
  diag: null,
  listening: 0,
  setListening: (d) => set({ listening: Math.max(0, get().listening + d) }),
  report: (n, e, count) => {
    if (!get().listening) return;
    const dt = e.timeStamp - lastTime;
    lastTime = e.timeStamp;
    if (dt > 0 && dt < 500) rate = rate * 0.8 + (1000 / dt) * Math.max(1, count) * 0.2;
    set({
      diag: {
        type: n.pointerType,
        rawPressure: n.rawPressure,
        pressure: n.pressure,
        tiltX: n.tiltX,
        tiltY: n.tiltY,
        twist: n.twist,
        tangentialPressure: n.tangentialPressure,
        width: n.contactWidth,
        height: n.contactHeight,
        buttons: e.buttons,
        eraser: n.eraser,
        barrel: n.barrel,
        coalesced: count,
        rateHz: Math.round(rate),
        x: Math.round(e.clientX),
        y: Math.round(e.clientY),
      },
    });
  },
}));
