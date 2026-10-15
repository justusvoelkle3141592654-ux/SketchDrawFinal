// Foreground/background colours, recent colours and palettes (persisted to palettes.json).
import { create } from 'zustand';
import type { RGB } from '../engine/color';
import { hsvToRgb, parseHex, rgbEquals, rgbToHex } from '../engine/color';
import { uid } from '../engine/random';
import { forge } from '../platform';

export interface Palette {
  id: string;
  name: string;
  colors: string[]; // #RRGGBB
  builtIn?: boolean;
}

function ramp(name: string, hexes: string[]): Palette {
  return { id: `builtin.${name.toLowerCase().replace(/\W+/g, '-')}`, name, colors: hexes, builtIn: true };
}

function hueSweep(s: number, v: number, n = 12): string[] {
  return Array.from({ length: n }, (_, i) => rgbToHex(hsvToRgb({ h: i / n, s, v })));
}

export const BUILTIN_PALETTES: Palette[] = [
  ramp('Neutral Studio', [
    '#000000',
    '#1C1D20',
    '#36383D',
    '#55585F',
    '#777B83',
    '#9A9EA6',
    '#BEC1C7',
    '#DDDFE3',
    '#F2F3F5',
    '#FFFFFF',
    '#2B2724',
    '#5A524B',
  ]),
  ramp('Spectrum Vivid', hueSweep(0.85, 0.95)),
  ramp('Spectrum Muted', hueSweep(0.4, 0.75)),
  ramp('Spectrum Deep', hueSweep(0.75, 0.45)),
  ramp('Earth & Clay', [
    '#3B2A20',
    '#5C3D2B',
    '#7E5136',
    '#A26B45',
    '#C58D5C',
    '#DDB085',
    '#E9CFAE',
    '#6B6A3E',
    '#8C8A55',
    '#4E5A3A',
    '#A3472E',
    '#D9773E',
  ]),
  ramp('Sea & Sky', [
    '#0B2440',
    '#12406B',
    '#1C5E92',
    '#2E7FB3',
    '#4FA1CC',
    '#82C1DE',
    '#BCDDEB',
    '#0F4D4A',
    '#1F7A73',
    '#3BA69A',
    '#7CCDC0',
    '#E4F3F2',
  ]),
  ramp('Skin Range', [
    '#FBE3D3',
    '#F2CDB5',
    '#E8B597',
    '#D99B79',
    '#C78463',
    '#B06E50',
    '#955A40',
    '#7A4834',
    '#5F3829',
    '#45291F',
    '#F5D5C6',
    '#E7B9A1',
  ]),
  ramp('Twilight', [
    '#1B1638',
    '#2E2560',
    '#4A3A86',
    '#6E52A8',
    '#9670C2',
    '#C091D2',
    '#E7B6D9',
    '#F6D3C4',
    '#F9A98B',
    '#E27A6B',
    '#B15468',
    '#6E3459',
  ]),
];

interface ColorState {
  fg: RGB;
  bg: RGB;
  /** Foreground transparency multiplies the stroke opacity. */
  fgAlpha: number;
  recent: string[];
  palettes: Palette[];
  activePaletteId: string;
  /** False until palettes.json has been read; nothing is written before that. */
  loaded: boolean;
  setFg: (c: RGB, commitRecent?: boolean) => void;
  setBg: (c: RGB) => void;
  setFgAlpha: (a: number) => void;
  swap: () => void;
  reset: () => void;
  pushRecent: (c: RGB) => void;
  setActivePalette: (id: string) => void;
  addPalette: (p: Omit<Palette, 'id'>) => string;
  updatePalette: (id: string, fn: (p: Palette) => void) => void;
  deletePalette: (id: string) => void;
  /** Adds a palette stored with a document unless one with its id exists; the active palette is kept. */
  ensurePalette: (p: { id: string; name: string; colors: string[] }) => boolean;
  load: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (!useColors.getState().loaded) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const s = useColors.getState();
    void forge.saveAppData('palettes', {
      version: 1,
      fg: rgbToHex(s.fg),
      bg: rgbToHex(s.bg),
      recent: s.recent,
      activePaletteId: s.activePaletteId,
      palettes: s.palettes.filter((p) => !p.builtIn),
    });
  }, 500);
}

function validHexList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((h): h is string => typeof h === 'string' && !!parseHex(h))
    .map((h) => h.toUpperCase())
    .slice(0, 512);
}

export const useColors = create<ColorState>((set, get) => ({
  fg: { r: 0.08, g: 0.09, b: 0.11 },
  bg: { r: 1, g: 1, b: 1 },
  fgAlpha: 1,
  recent: [],
  palettes: BUILTIN_PALETTES,
  activePaletteId: BUILTIN_PALETTES[0].id,
  loaded: false,
  setFg: (c, commitRecent = false) => {
    set({ fg: c });
    if (commitRecent) get().pushRecent(c);
    persist();
  },
  setBg: (c) => {
    set({ bg: c });
    persist();
  },
  setFgAlpha: (a) => set({ fgAlpha: Math.min(1, Math.max(0, a)) }),
  swap: () => {
    const { fg, bg } = get();
    set({ fg: bg, bg: fg });
    persist();
  },
  reset: () => {
    set({ fg: { r: 0, g: 0, b: 0 }, bg: { r: 1, g: 1, b: 1 }, fgAlpha: 1 });
    persist();
  },
  pushRecent: (c) => {
    const hex = rgbToHex(c);
    const recent = [hex, ...get().recent.filter((h) => h !== hex)].slice(0, 18);
    if (recent[0] === get().recent[0] && recent.length === get().recent.length) return;
    set({ recent });
    persist();
  },
  setActivePalette: (id) => {
    set({ activePaletteId: id });
    persist();
  },
  addPalette: (p) => {
    const id = uid('P');
    set({ palettes: [...get().palettes, { ...p, id, builtIn: false }], activePaletteId: id });
    persist();
    return id;
  },
  updatePalette: (id, fn) => {
    set({
      palettes: get().palettes.map((p) => {
        if (p.id !== id || p.builtIn) return p;
        const copy = { ...p, colors: [...p.colors] };
        fn(copy);
        return copy;
      }),
    });
    persist();
  },
  deletePalette: (id) => {
    const palettes = get().palettes.filter((p) => p.id !== id || p.builtIn);
    set({
      palettes,
      activePaletteId: palettes.some((p) => p.id === get().activePaletteId)
        ? get().activePaletteId
        : palettes[0].id,
    });
    persist();
  },
  ensurePalette: (p) => {
    if (get().palettes.some((x) => x.id === p.id)) return false;
    set({ palettes: [...get().palettes, { id: p.id, name: p.name, colors: [...p.colors], builtIn: false }] });
    persist();
    return true;
  },
  load: async () => {
    const raw = (await forge.loadAppData('palettes').catch(() => null)) as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object') {
      set({ loaded: true });
      // palettes from documents opened before loading finished
      if (get().palettes.some((p) => !p.builtIn)) persist();
      return;
    }
    const fg = typeof raw.fg === 'string' ? parseHex(raw.fg) : null;
    const bg = typeof raw.bg === 'string' ? parseHex(raw.bg) : null;
    const userPalettes: Palette[] = Array.isArray(raw.palettes)
      ? (raw.palettes as unknown[])
          .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
          .map((p) => ({
            id: typeof p.id === 'string' ? p.id.slice(0, 64) : uid('P'),
            name: typeof p.name === 'string' ? p.name.slice(0, 80) : 'Palette',
            colors: validHexList(p.colors),
          }))
          .slice(0, 100)
      : [];
    const ids = new Set(BUILTIN_PALETTES.map((p) => p.id));
    const palettes = [...BUILTIN_PALETTES];
    // ids are unique; a user palette never shadows a built-in one
    for (const p of userPalettes) {
      if (ids.has(p.id)) continue;
      ids.add(p.id);
      palettes.push(p);
    }
    // palettes from documents opened before loading finished
    const early = get().palettes.filter((p) => !p.builtIn && !ids.has(p.id));
    palettes.push(...early);
    set({
      fg: fg ? { r: fg.r, g: fg.g, b: fg.b } : get().fg,
      bg: bg ? { r: bg.r, g: bg.g, b: bg.b } : get().bg,
      recent: validHexList(raw.recent).slice(0, 18),
      palettes,
      activePaletteId: palettes.some((p) => p.id === raw.activePaletteId)
        ? (raw.activePaletteId as string)
        : palettes[0].id,
      loaded: true,
    });
    if (early.length) persist();
  },
}));

export function sameColor(a: RGB, b: RGB) {
  return rgbEquals(a, b);
}

/** Parses a GIMP .gpl palette (open text format). */
export function parseGpl(text: string): { name: string; colors: string[] } | null {
  const lines = text.split(/\r?\n/);
  if (!/^GIMP Palette/i.test(lines[0] ?? '')) return null;
  let name = 'Imported palette';
  const colors: string[] = [];
  for (const line of lines.slice(1)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = /^Name:\s*(.+)$/i.exec(t);
    if (m) {
      name = m[1].slice(0, 80);
      continue;
    }
    if (/^Columns:/i.test(t)) continue;
    const parts = t.split(/\s+/);
    const [r, g, b] = parts.slice(0, 3).map(Number);
    if ([r, g, b].every((v) => Number.isInteger(v) && v >= 0 && v <= 255))
      colors.push(rgbToHex({ r: r / 255, g: g / 255, b: b / 255 }));
    if (colors.length >= 512) break;
  }
  return colors.length ? { name, colors } : null;
}
