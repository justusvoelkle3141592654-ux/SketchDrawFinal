// Brush library: factory + user presets, favourites, ordering and the active brushes per tool.
import { create } from 'zustand';
import { FACTORY_BRUSHES, DEFAULT_BRUSH_ID, DEFAULT_ERASER_ID } from '../engine/brush/presets';
import { cloneBrush, validateBrush, type BrushPreset } from '../engine/brush/schema';
import { uid } from '../engine/random';
import { forge } from '../platform';

interface BrushState {
  brushes: BrushPreset[];
  favorites: string[];
  activeBrushId: string;
  activeEraserId: string;
  loaded: boolean;
  load: () => Promise<void>;
  get: (id: string) => BrushPreset | undefined;
  update: (id: string, fn: (b: BrushPreset) => void) => void;
  replace: (b: BrushPreset) => void;
  add: (b: BrushPreset, afterId?: string) => BrushPreset;
  duplicate: (id: string) => BrushPreset | null;
  remove: (id: string) => void;
  move: (id: string, toIndex: number) => void;
  toggleFavorite: (id: string) => void;
  setActive: (id: string) => void;
  restoreFactory: () => void;
  restoreOne: (id: string) => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const s = useBrushes.getState();
    void forge.saveAppData('brushes', {
      version: 1,
      brushes: s.brushes,
      favorites: s.favorites,
      activeBrushId: s.activeBrushId,
      activeEraserId: s.activeEraserId,
    });
  }, 600);
}

const isEraser = (b: BrushPreset) => b.engine === 'eraser';

export const useBrushes = create<BrushState>((set, get) => ({
  brushes: FACTORY_BRUSHES.map(cloneBrush),
  favorites: ['cf.studio-ink', 'cf.graphite-fine', 'cf.soft-air', 'cf.hard-round'],
  activeBrushId: DEFAULT_BRUSH_ID,
  activeEraserId: DEFAULT_ERASER_ID,
  loaded: false,
  load: async () => {
    const raw = (await forge.loadAppData('brushes').catch(() => null)) as Record<string, unknown> | null;
    if (!raw || !Array.isArray(raw.brushes)) {
      set({ loaded: true });
      return;
    }
    const brushes: BrushPreset[] = [];
    const seen = new Set<string>();
    for (const b of raw.brushes) {
      try {
        const v = validateBrush(b);
        if (seen.has(v.id)) continue;
        seen.add(v.id);
        brushes.push(v);
      } catch {
        // skip unreadable entries
      }
    }
    // factory presets added in newer versions
    for (const f of FACTORY_BRUSHES) if (!seen.has(f.id)) brushes.push(cloneBrush(f));
    const ids = new Set(brushes.map((b) => b.id));
    const pick = (v: unknown, d: string) => (typeof v === 'string' && ids.has(v) ? v : d);
    set({
      brushes,
      favorites: Array.isArray(raw.favorites)
        ? raw.favorites.filter((f): f is string => typeof f === 'string' && ids.has(f))
        : get().favorites,
      activeBrushId: pick(raw.activeBrushId, DEFAULT_BRUSH_ID),
      activeEraserId: pick(raw.activeEraserId, DEFAULT_ERASER_ID),
      loaded: true,
    });
  },
  get: (id) => get().brushes.find((b) => b.id === id),
  update: (id, fn) => {
    set({
      brushes: get().brushes.map((b) => {
        if (b.id !== id) return b;
        const copy = cloneBrush(b);
        fn(copy);
        copy.modified = new Date().toISOString();
        return copy;
      }),
    });
    persist();
  },
  replace: (nb) => {
    set({ brushes: get().brushes.map((b) => (b.id === nb.id ? cloneBrush(nb) : b)) });
    persist();
  },
  add: (b, afterId) => {
    const list = [...get().brushes];
    const nb = cloneBrush(b);
    const idx = afterId ? list.findIndex((x) => x.id === afterId) : -1;
    if (idx >= 0) list.splice(idx + 1, 0, nb);
    else list.push(nb);
    set({ brushes: list });
    persist();
    return nb;
  },
  duplicate: (id) => {
    const src = get().get(id);
    if (!src) return null;
    const now = new Date().toISOString();
    const copy = {
      ...cloneBrush(src),
      id: uid('u.'),
      name: `${src.name} copy`,
      factory: false,
      category: src.category,
      created: now,
      modified: now,
    };
    return get().add(copy, id);
  },
  remove: (id) => {
    const list = get().brushes.filter((b) => b.id !== id);
    if (!list.length) return;
    const s = get();
    set({
      brushes: list,
      favorites: s.favorites.filter((f) => f !== id),
      activeBrushId:
        s.activeBrushId === id ? (list.find((b) => !isEraser(b))?.id ?? list[0].id) : s.activeBrushId,
      activeEraserId:
        s.activeEraserId === id ? (list.find(isEraser)?.id ?? DEFAULT_ERASER_ID) : s.activeEraserId,
    });
    persist();
  },
  move: (id, toIndex) => {
    const list = [...get().brushes];
    const from = list.findIndex((b) => b.id === id);
    if (from < 0) return;
    const [b] = list.splice(from, 1);
    list.splice(Math.max(0, Math.min(list.length, toIndex)), 0, b);
    set({ brushes: list });
    persist();
  },
  toggleFavorite: (id) => {
    const f = get().favorites;
    set({ favorites: f.includes(id) ? f.filter((x) => x !== id) : [...f, id] });
    persist();
  },
  setActive: (id) => {
    const b = get().get(id);
    if (!b) return;
    if (isEraser(b)) set({ activeEraserId: id });
    else set({ activeBrushId: id });
    persist();
  },
  restoreFactory: () => {
    const user = get().brushes.filter((b) => !b.factory);
    const brushes = [...FACTORY_BRUSHES.map(cloneBrush), ...user];
    set({ brushes, activeBrushId: DEFAULT_BRUSH_ID, activeEraserId: DEFAULT_ERASER_ID });
    persist();
  },
  restoreOne: (id) => {
    const f = FACTORY_BRUSHES.find((b) => b.id === id);
    if (f) get().replace(f);
  },
}));

export function factoryVersionOf(id: string): BrushPreset | undefined {
  return FACTORY_BRUSHES.find((b) => b.id === id);
}
