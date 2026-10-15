// Per-tool options shown in the tool options bar (persisted with the workspace).
import { create } from 'zustand';
import type { CombineMode } from '../engine/selection';

export interface ToolOptions {
  select: { combine: CombineMode; feather: number; antialias: boolean; fromCenter: boolean };
  wand: { tolerance: number; contiguous: boolean; sampleAll: boolean };
  fill: { tolerance: number; contiguous: boolean; sampleAll: boolean; grow: number; opacity: number };
  gradient: { kind: 'linear' | 'radial'; toTransparent: boolean; opacity: number };
  shape: { mode: 'stroke' | 'fill' | 'both'; sides: number; fromCenter: boolean; useBrush: boolean };
  text: {
    font: string;
    size: number;
    bold: boolean;
    italic: boolean;
    align: 'left' | 'center' | 'right';
    lineHeight: number;
  };
  crop: { ratio: 'free' | 'square' | 'document' };
}

export const DEFAULT_TOOL_OPTIONS: ToolOptions = {
  select: { combine: 'replace', feather: 0, antialias: true, fromCenter: false },
  wand: { tolerance: 0.12, contiguous: true, sampleAll: true },
  fill: { tolerance: 0.12, contiguous: true, sampleAll: true, grow: 1, opacity: 1 },
  gradient: { kind: 'linear', toTransparent: false, opacity: 1 },
  shape: { mode: 'stroke', sides: 6, fromCenter: false, useBrush: true },
  text: { font: 'Segoe UI', size: 48, bold: false, italic: false, align: 'left', lineHeight: 1.2 },
  crop: { ratio: 'free' },
};

export const FONT_CHOICES = [
  'Segoe UI',
  'Arial',
  'Calibri',
  'Cambria',
  'Candara',
  'Consolas',
  'Constantia',
  'Corbel',
  'Courier New',
  'Georgia',
  'Impact',
  'Palatino Linotype',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
  'sans-serif',
  'serif',
  'monospace',
];

interface ToolOptionsState {
  opts: ToolOptions;
  set: <K extends keyof ToolOptions>(key: K, patch: Partial<ToolOptions[K]>) => void;
}

export const useToolOptions = create<ToolOptionsState>((set, get) => ({
  opts: structuredClone(DEFAULT_TOOL_OPTIONS),
  set: (key, patch) => set({ opts: { ...get().opts, [key]: { ...get().opts[key], ...patch } } }),
}));

export const toolOpts = () => useToolOptions.getState().opts;
