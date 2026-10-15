// User preferences (persisted to preferences.json in the app data folder).
import { create } from 'zustand';
import { CURVE_PRESETS, normalizeCurve, type CurvePoint } from '../engine/curve';
import { forge } from '../platform';

export type ButtonAction =
  'none' | 'sizePuck' | 'eyedropper' | 'orbit' | 'eraser' | 'pan' | 'undo' | 'redo' | 'shortcut';
export const BUTTON_ACTIONS: { id: ButtonAction; label: string }[] = [
  { id: 'none', label: 'Do nothing' },
  { id: 'orbit', label: 'Open Orbit' },
  { id: 'sizePuck', label: 'Size & opacity puck' },
  { id: 'eyedropper', label: 'Eyedropper' },
  { id: 'eraser', label: 'Erase while held' },
  { id: 'pan', label: 'Pan while held' },
  { id: 'undo', label: 'Undo' },
  { id: 'redo', label: 'Redo' },
  { id: 'shortcut', label: 'Custom shortcut' },
];

export interface InputPreferences {
  pressureEnabled: boolean;
  tiltEnabled: boolean;
  barrelButtonsEnabled: boolean;
  eraserTipEnabled: boolean;
  touchGestures: boolean;
  /** Fingers cannot paint; they can still use panels and navigate the canvas. */
  penOnly: boolean;
  pressureCurve: CurvePoint[];
  /** Raw pressure below this is treated as zero. */
  deadZone: number;
  /** Simulated pressure for mouse input. */
  mousePressure: number;
  barrelButton: ButtonAction;
  barrelButton2: ButtonAction;
  rightMouse: ButtonAction;
  mouseBack: ButtonAction;
  mouseForward: ButtonAction;
  /** Shortcut string sent when an action is 'shortcut'. */
  customShortcut: string;
}

export interface Preferences {
  version: 1;
  theme: 'dark' | 'light';
  density: 'compact' | 'roomy';
  leftHanded: boolean;
  autoHidePanels: boolean;
  showBrushOutline: boolean;
  input: InputPreferences;
  stabilizer: { mode: 'off' | 'smooth' | 'lazy'; amount: number };
  predictive: { enabled: boolean; strength: number };
  orbitSlots: string[];
  shortcuts: Record<string, string[]>;
  autosaveMinutes: number;
  historyBudgetMB: number;
  exportNameTemplate: string;
  pixelGrid: boolean;
  confirmOnLayerDelete: boolean;
}

export const DEFAULT_ORBIT_SLOTS = [
  'tool.brush',
  'tool.eraser',
  'tool.eyedropper',
  'edit.undo',
  'edit.redo',
  'view.fit',
  'panel.colour',
  'view.focus',
];

export const DEFAULT_PREFERENCES: Preferences = {
  version: 1,
  theme: 'dark',
  density: 'compact',
  leftHanded: false,
  autoHidePanels: false,
  showBrushOutline: true,
  input: {
    pressureEnabled: true,
    tiltEnabled: true,
    barrelButtonsEnabled: true,
    eraserTipEnabled: true,
    touchGestures: true,
    penOnly: false,
    pressureCurve: CURVE_PRESETS.linear,
    deadZone: 0.02,
    mousePressure: 0.7,
    barrelButton: 'orbit',
    barrelButton2: 'eyedropper',
    rightMouse: 'orbit',
    mouseBack: 'undo',
    mouseForward: 'redo',
    customShortcut: '',
  },
  stabilizer: { mode: 'smooth', amount: 0.2 },
  predictive: { enabled: false, strength: 0.5 },
  orbitSlots: DEFAULT_ORBIT_SLOTS,
  shortcuts: {},
  autosaveMinutes: 2,
  historyBudgetMB: 768,
  exportNameTemplate: '{name}',
  pixelGrid: true,
  confirmOnLayerDelete: false,
};

const n = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const b = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const action = (v: unknown, d: ButtonAction): ButtonAction =>
  BUTTON_ACTIONS.some((a) => a.id === v) ? (v as ButtonAction) : d;

export function sanitizePreferences(raw: unknown): Preferences {
  const d = DEFAULT_PREFERENCES;
  if (!raw || typeof raw !== 'object') return structuredClone(d);
  const r = raw as Record<string, unknown>;
  const ri = (r.input ?? {}) as Record<string, unknown>;
  const curve = Array.isArray(ri.pressureCurve)
    ? normalizeCurve(
        (ri.pressureCurve as CurvePoint[])
          .filter((p) => p && typeof p.x === 'number' && typeof p.y === 'number')
          .slice(0, 12),
      )
    : d.input.pressureCurve;
  const st = (r.stabilizer ?? {}) as Record<string, unknown>;
  const pr = (r.predictive ?? {}) as Record<string, unknown>;
  const shortcuts: Record<string, string[]> = {};
  if (r.shortcuts && typeof r.shortcuts === 'object') {
    for (const [k, v] of Object.entries(r.shortcuts as Record<string, unknown>)) {
      if (Array.isArray(v) && v.every((s) => typeof s === 'string' && s.length < 40))
        shortcuts[k] = v.slice(0, 3);
    }
  }
  return {
    version: 1,
    theme: r.theme === 'light' ? 'light' : 'dark',
    density: r.density === 'roomy' ? 'roomy' : 'compact',
    leftHanded: b(r.leftHanded, d.leftHanded),
    autoHidePanels: b(r.autoHidePanels, d.autoHidePanels),
    showBrushOutline: b(r.showBrushOutline, d.showBrushOutline),
    input: {
      pressureEnabled: b(ri.pressureEnabled, d.input.pressureEnabled),
      tiltEnabled: b(ri.tiltEnabled, d.input.tiltEnabled),
      barrelButtonsEnabled: b(ri.barrelButtonsEnabled, d.input.barrelButtonsEnabled),
      eraserTipEnabled: b(ri.eraserTipEnabled, d.input.eraserTipEnabled),
      touchGestures: b(ri.touchGestures, d.input.touchGestures),
      penOnly: b(ri.penOnly, d.input.penOnly),
      pressureCurve: curve.length >= 2 ? curve : d.input.pressureCurve,
      deadZone: n(ri.deadZone, 0, 0.4, d.input.deadZone),
      mousePressure: n(ri.mousePressure, 0.05, 1, d.input.mousePressure),
      barrelButton: action(ri.barrelButton, d.input.barrelButton),
      barrelButton2: action(ri.barrelButton2, d.input.barrelButton2),
      rightMouse: action(ri.rightMouse, d.input.rightMouse),
      mouseBack: action(ri.mouseBack, d.input.mouseBack),
      mouseForward: action(ri.mouseForward, d.input.mouseForward),
      customShortcut: typeof ri.customShortcut === 'string' ? ri.customShortcut.slice(0, 40) : '',
    },
    stabilizer: {
      mode: st.mode === 'off' || st.mode === 'lazy' || st.mode === 'smooth' ? st.mode : d.stabilizer.mode,
      amount: n(st.amount, 0, 1, d.stabilizer.amount),
    },
    predictive: {
      enabled: b(pr.enabled, d.predictive.enabled),
      strength: n(pr.strength, 0, 1, d.predictive.strength),
    },
    orbitSlots:
      Array.isArray(r.orbitSlots) &&
      r.orbitSlots.length === 8 &&
      r.orbitSlots.every((s) => typeof s === 'string')
        ? (r.orbitSlots as string[])
        : d.orbitSlots,
    shortcuts,
    autosaveMinutes: n(r.autosaveMinutes, 0, 60, d.autosaveMinutes),
    historyBudgetMB: n(r.historyBudgetMB, 64, 8192, d.historyBudgetMB),
    exportNameTemplate:
      typeof r.exportNameTemplate === 'string' ? r.exportNameTemplate.slice(0, 120) : d.exportNameTemplate,
    pixelGrid: b(r.pixelGrid, d.pixelGrid),
    confirmOnLayerDelete: b(r.confirmOnLayerDelete, d.confirmOnLayerDelete),
  };
}

interface PrefsState {
  prefs: Preferences;
  loaded: boolean;
  load: () => Promise<void>;
  update: (fn: (p: Preferences) => Preferences | void) => void;
  reset: () => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(p: Preferences) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void forge.saveAppData('preferences', p);
  }, 400);
}

export const usePrefs = create<PrefsState>((set, get) => ({
  prefs: structuredClone(DEFAULT_PREFERENCES),
  loaded: false,
  load: async () => {
    const raw = await forge.loadAppData('preferences').catch(() => null);
    set({ prefs: sanitizePreferences(raw), loaded: true });
  },
  update: (fn) => {
    const draft = structuredClone(get().prefs);
    const result = fn(draft) ?? draft;
    set({ prefs: result });
    scheduleSave(result);
  },
  reset: () => {
    const p = structuredClone(DEFAULT_PREFERENCES);
    set({ prefs: p });
    scheduleSave(p);
  },
}));

export const getPrefs = () => usePrefs.getState().prefs;
