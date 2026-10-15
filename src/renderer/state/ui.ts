// Workspace/UI state: tools, panel layout, dialogs, toasts, pucks and Orbit.
import { create } from 'zustand';
import { forge } from '../platform';

export type ToolId =
  | 'brush'
  | 'eraser'
  | 'eyedropper'
  | 'fill'
  | 'gradient'
  | 'select-rect'
  | 'select-ellipse'
  | 'select-lasso'
  | 'select-polygon'
  | 'select-wand'
  | 'transform'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'polyline'
  | 'text'
  | 'crop'
  | 'pan'
  | 'zoom'
  | 'rotate';

export type PanelId = 'colour' | 'palettes' | 'brushes' | 'layers' | 'animation' | 'reference';
export const PANEL_IDS: PanelId[] = ['colour', 'palettes', 'brushes', 'layers', 'animation', 'reference'];
export const PANEL_TITLES: Record<PanelId, string> = {
  colour: 'Colour',
  palettes: 'Palettes',
  brushes: 'Brushes',
  layers: 'Layers',
  animation: 'Animation',
  reference: 'Reference',
};

export interface PanelState {
  visible: boolean;
  floating: boolean;
  collapsed: boolean;
  /** Docked height weight (flex-grow). */
  dockWeight: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  dockWidth: number;
  order: PanelId[];
  panels: Record<PanelId, PanelState>;
}

export function defaultLayout(): Layout {
  const p = (visible: boolean, dockWeight: number, y: number): PanelState => ({
    visible,
    floating: false,
    collapsed: false,
    dockWeight,
    x: 220,
    y,
    w: 280,
    h: 360,
  });
  return {
    dockWidth: 284,
    order: ['colour', 'brushes', 'layers', 'palettes', 'animation', 'reference'],
    panels: {
      colour: p(true, 1.15, 90),
      palettes: p(false, 0.8, 140),
      brushes: p(true, 1.0, 190),
      layers: p(true, 1.0, 240),
      animation: p(false, 0.8, 290),
      reference: p(false, 0.9, 340),
    },
  };
}

export function sanitizeLayout(raw: unknown): Layout {
  const d = defaultLayout();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<Layout>;
  const order = Array.isArray(r.order)
    ? r.order.filter((id): id is PanelId => PANEL_IDS.includes(id as PanelId))
    : d.order;
  for (const id of PANEL_IDS) if (!order.includes(id)) order.push(id);
  const panels = { ...d.panels };
  for (const id of PANEL_IDS) {
    const src = (r.panels as Record<string, Partial<PanelState>> | undefined)?.[id];
    if (!src || typeof src !== 'object') continue;
    const num = (v: unknown, lo: number, hi: number, def: number) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
    panels[id] = {
      visible: typeof src.visible === 'boolean' ? src.visible : d.panels[id].visible,
      floating: !!src.floating,
      collapsed: !!src.collapsed,
      dockWeight: num(src.dockWeight, 0.2, 5, d.panels[id].dockWeight),
      x: num(src.x, 0, 8000, d.panels[id].x),
      y: num(src.y, 0, 8000, d.panels[id].y),
      w: num(src.w, 200, 1200, d.panels[id].w),
      h: num(src.h, 120, 1600, d.panels[id].h),
    };
  }
  return {
    dockWidth: typeof r.dockWidth === 'number' ? Math.min(560, Math.max(220, r.dockWidth)) : d.dockWidth,
    order,
    panels,
  };
}

export type DialogKind =
  | 'new-document'
  | 'preferences'
  | 'brush-lab'
  | 'export'
  | 'image-size'
  | 'canvas-size'
  | 'adjust'
  | 'about'
  | 'shortcuts'
  | 'timelapse'
  | 'animation-export'
  | 'recovery';

export interface DialogState {
  kind: DialogKind;
  props?: Record<string, unknown>;
}

export interface ConfirmButton {
  id: string;
  label: string;
  kind?: 'primary' | 'danger' | 'default';
}

export interface ConfirmRequest {
  title: string;
  message: string;
  buttons: ConfirmButton[];
  /** Button id returned on Escape. */
  cancelId: string;
  resolve: (id: string) => void;
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error' | 'warning';
  text: string;
  detail?: string;
}

export interface PuckState {
  open: boolean;
  x: number;
  y: number;
}

export type SelectionCombine = 'replace' | 'add' | 'subtract' | 'intersect';

interface UiState {
  tool: ToolId;
  previousTool: ToolId;
  layout: Layout;
  focusMode: boolean;
  drawing: boolean;
  fullScreen: boolean;
  dialog: DialogState | null;
  confirm: ConfirmRequest | null;
  toasts: Toast[];
  sizePuck: PuckState;
  navPuck: PuckState;
  orbit: { open: boolean; x: number; y: number; viaGesture: boolean };
  selectionCombine: SelectionCombine;
  /** Last pointer position over the canvas (screen px, relative to canvas element). */
  pointer: { x: number; y: number; inside: boolean };
  setTool: (t: ToolId) => void;
  restorePreviousTool: () => void;
  setLayout: (fn: (l: Layout) => Layout | void) => void;
  resetLayout: () => void;
  loadLayout: () => Promise<void>;
  togglePanel: (id: PanelId, visible?: boolean) => void;
  setFocusMode: (v: boolean) => void;
  setDrawing: (v: boolean) => void;
  openDialog: (kind: DialogKind, props?: Record<string, unknown>) => void;
  closeDialog: () => void;
  toast: (kind: Toast['kind'], text: string, detail?: string) => void;
  dismissToast: (id: number) => void;
}

let toastSerial = 0;
let layoutTimer: ReturnType<typeof setTimeout> | null = null;
function saveLayout(l: Layout) {
  if (layoutTimer) clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => void forge.saveAppData('workspace', { layout: l }), 500);
}

export const useUi = create<UiState>((set, get) => ({
  tool: 'brush',
  previousTool: 'brush',
  layout: defaultLayout(),
  focusMode: false,
  drawing: false,
  fullScreen: false,
  dialog: null,
  confirm: null,
  toasts: [],
  sizePuck: { open: false, x: 0, y: 0 },
  navPuck: { open: false, x: 0, y: 0 },
  orbit: { open: false, x: 0, y: 0, viaGesture: false },
  selectionCombine: 'replace',
  pointer: { x: 0, y: 0, inside: false },
  setTool: (t) => {
    const cur = get().tool;
    if (cur === t) return;
    set({ tool: t, previousTool: cur });
  },
  restorePreviousTool: () => set({ tool: get().previousTool }),
  setLayout: (fn) => {
    const draft = structuredClone(get().layout);
    const next = fn(draft) ?? draft;
    set({ layout: next });
    saveLayout(next);
  },
  resetLayout: () => {
    const l = defaultLayout();
    set({ layout: l });
    saveLayout(l);
  },
  loadLayout: async () => {
    const raw = (await forge.loadAppData('workspace').catch(() => null)) as { layout?: unknown } | null;
    set({ layout: sanitizeLayout(raw?.layout) });
  },
  togglePanel: (id, visible) =>
    get().setLayout((l) => {
      const p = l.panels[id];
      p.visible = visible ?? !p.visible;
      if (p.visible) p.collapsed = false;
    }),
  setFocusMode: (v) => set({ focusMode: v }),
  setDrawing: (v) => {
    if (get().drawing !== v) set({ drawing: v });
  },
  openDialog: (kind, props) => set({ dialog: { kind, props } }),
  closeDialog: () => set({ dialog: null }),
  toast: (kind, text, detail) => {
    const id = ++toastSerial;
    set({ toasts: [...get().toasts.slice(-3), { id, kind, text, detail }] });
    const ttl = kind === 'error' ? 9000 : kind === 'warning' ? 6000 : 3200;
    setTimeout(() => get().dismissToast(id), ttl);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

/** Shows a modal choice; resolves with the chosen button id. */
export function confirmDialog(req: Omit<ConfirmRequest, 'resolve'>): Promise<string> {
  return new Promise((resolve) => {
    useUi.setState({
      confirm: {
        ...req,
        resolve: (id) => {
          useUi.setState({ confirm: null });
          resolve(id);
        },
      },
    });
  });
}

export const toast = (kind: Toast['kind'], text: string, detail?: string) =>
  useUi.getState().toast(kind, text, detail);
