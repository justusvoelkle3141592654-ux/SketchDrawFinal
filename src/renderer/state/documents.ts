// Open documents (sessions), the active document and change notification for React.
import { create } from 'zustand';
import { Compositor } from '../engine/compositor';
import type { RasterDocument } from '../engine/document';
import { History } from '../engine/history';
import { uid } from '../engine/random';
import { defaultView, type ViewState } from '../engine/view';
import type { Point } from '../engine/geometry';
import type { BrushPreset } from '../engine/brush/schema';
import type { PaletteRef } from '../engine/io/cforge';

export type SymmetryMode = 'off' | 'vertical' | 'horizontal' | 'both' | 'radial' | 'kaleido';

export interface AssistState {
  symmetry: { mode: SymmetryMode; segments: number; cx: number; cy: number };
  ruler: { enabled: boolean; a: Point; b: Point };
  ellipse: { enabled: boolean; cx: number; cy: number; rx: number; ry: number; angle: number };
  perspective: { enabled: boolean; mode: 1 | 2 | 3; vps: Point[]; horizonY: number };
  grid: { visible: boolean; size: number; snap: boolean };
  guides: { x: number[]; y: number[]; snap: boolean };
}

export function defaultAssist(w: number, h: number): AssistState {
  return {
    symmetry: { mode: 'off', segments: 6, cx: w / 2, cy: h / 2 },
    ruler: { enabled: false, a: { x: w * 0.25, y: h * 0.5 }, b: { x: w * 0.75, y: h * 0.5 } },
    ellipse: { enabled: false, cx: w / 2, cy: h / 2, rx: w * 0.25, ry: h * 0.15, angle: 0 },
    perspective: {
      enabled: false,
      mode: 2,
      vps: [
        { x: -w * 0.2, y: h * 0.45 },
        { x: w * 1.2, y: h * 0.45 },
        { x: w / 2, y: h * 2.2 },
      ],
      horizonY: h * 0.45,
    },
    grid: { visible: false, size: 64, snap: false },
    guides: { x: [], y: [], snap: true },
  };
}

export class DocumentSession {
  readonly id = uid('S');
  readonly history = new History();
  compositor: Compositor;
  view: ViewState = defaultView();
  viewInitialized = false;
  filePath: string | null = null;
  fileName: string;
  savedStateId = 0;
  /** Set when the document has content that was never saved (imported image, recovery). */
  unsavedOrigin = false;
  readonly recoveryId = uid('r')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
  lastAutosaveStateId = 0;
  assist: AssistState;
  /** Opaque per-document feature data saved in document.json (animation, time-lapse settings…). */
  features: Record<string, unknown> = {};
  resources: Record<string, Uint8Array> = {};
  /** Brushes painted with or stored in the document; saved to resources/brushes.json. */
  usedBrushIds = new Set<string>();
  /** Brush presets as stored in the opened document, used when the library no longer has them. */
  storedBrushes = new Map<string, BrushPreset>();
  /** Id of the palette the document refers to; null follows the active palette. */
  paletteId: string | null = null;
  /** Palette as stored in the opened document, used when the library no longer has it. */
  storedPalette: PaletteRef | null = null;

  constructor(
    public doc: RasterDocument,
    fileName = 'Untitled',
  ) {
    this.compositor = new Compositor(doc);
    this.fileName = fileName;
    this.assist = defaultAssist(doc.width, doc.height);
  }

  get dirty(): boolean {
    return this.unsavedOrigin || this.history.stateId !== this.savedStateId;
  }

  get displayName(): string {
    return this.fileName.replace(/\.cforge$/i, '');
  }

  markSaved(path: string | null, name: string) {
    this.filePath = path;
    this.fileName = name;
    this.savedStateId = this.history.stateId;
    this.unsavedOrigin = false;
  }

  /** Replace the document (e.g. after resize/crop that rebuilds the doc object). */
  replaceDocument(doc: RasterDocument) {
    this.doc = doc;
    this.compositor = new Compositor(doc);
  }
}

interface DocsState {
  sessions: DocumentSession[];
  activeId: string | null;
  /** Bumped on any change that should re-render document-dependent UI. */
  rev: number;
  add: (s: DocumentSession) => void;
  remove: (id: string) => void;
  setActive: (id: string) => void;
  bump: () => void;
}

export const useDocs = create<DocsState>((set, get) => ({
  sessions: [],
  activeId: null,
  rev: 0,
  add: (s) => {
    s.history.onChange(() => get().bump());
    set({ sessions: [...get().sessions, s], activeId: s.id, rev: get().rev + 1 });
  },
  remove: (id) => {
    const list = get().sessions;
    const idx = list.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const next = list.filter((s) => s.id !== id);
    const activeId =
      get().activeId === id ? (next[Math.min(idx, next.length - 1)]?.id ?? null) : get().activeId;
    set({ sessions: next, activeId, rev: get().rev + 1 });
  },
  setActive: (id) => set({ activeId: id, rev: get().rev + 1 }),
  bump: () => set({ rev: get().rev + 1 }),
}));

export function activeSession(): DocumentSession | null {
  const s = useDocs.getState();
  return s.sessions.find((x) => x.id === s.activeId) ?? null;
}

/** React hook: active session, re-rendering on document changes. */
export function useActiveSession(): DocumentSession | null {
  const activeId = useDocs((s) => s.activeId);
  const sessions = useDocs((s) => s.sessions);
  useDocs((s) => s.rev);
  return sessions.find((x) => x.id === activeId) ?? null;
}
