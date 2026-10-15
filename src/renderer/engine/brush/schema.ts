// Versioned, serialisable brush preset schema with validation and migration.
import type { CurvePoint } from '../curve';
import { LINEAR_CURVE, normalizeCurve } from '../curve';
import { isBlendMode, type BlendMode } from '../blend';

export const BRUSH_SCHEMA_VERSION = 1;

export type BrushEngine =
  'stamp' | 'airbrush' | 'ink' | 'marker' | 'texture' | 'eraser' | 'smudge' | 'blender' | 'composite';

export const BRUSH_ENGINES: { id: BrushEngine; label: string; hint: string }[] = [
  { id: 'stamp', label: 'Pixel stamp', hint: 'Classic dabs that build up within a stroke.' },
  { id: 'airbrush', label: 'Soft airbrush', hint: 'Soft build-up; keeps spraying while the pen rests.' },
  { id: 'ink', label: 'Ink', hint: 'Even coverage: overlapping dabs never darken within a stroke.' },
  { id: 'marker', label: 'Marker', hint: 'Flat within a stroke, darkens where strokes overlap.' },
  { id: 'texture', label: 'Textured paint', hint: 'Stamp with strong paper or canvas grain.' },
  { id: 'eraser', label: 'Eraser', hint: 'Removes pixels using the tip shape.' },
  { id: 'smudge', label: 'Smudge', hint: 'Picks up and drags existing colour.' },
  { id: 'blender', label: 'Blender', hint: 'Softens and averages colours under the tip.' },
  { id: 'composite', label: 'Custom composite', hint: 'Stamp with a custom blend mode and scattering.' },
];

export type BrushCategory = 'Sketch' | 'Ink' | 'Paint' | 'Markers' | 'Texture' | 'Effects' | 'Custom';
export const BRUSH_CATEGORIES: BrushCategory[] = [
  'Sketch',
  'Ink',
  'Paint',
  'Markers',
  'Texture',
  'Effects',
  'Custom',
];

export type TipGenerator = 'bristle' | 'chalk' | 'flat' | 'fan' | 'splatter' | 'charcoal' | 'pencil';
export const TIP_GENERATORS: TipGenerator[] = [
  'pencil',
  'bristle',
  'chalk',
  'flat',
  'fan',
  'splatter',
  'charcoal',
];

export interface BrushTip {
  /** 'round' = procedural ellipse; 'generated' = procedural grey image; 'image' = user grey image. */
  shape: 'round' | 'generated' | 'image';
  generator?: TipGenerator;
  generatorSeed?: number;
  /** Grey image, row-major, 0..255, base64 encoded (only when shape = 'image'). */
  image?: { width: number; height: number; data: string };
  hardness: number; // 0..1
  /** Roundness: 1 = circle, smaller = flatter ellipse. */
  aspect: number; // 0.05..1
  angle: number; // degrees
  antialias: boolean;
  invert?: boolean;
}

export type TextureSource = 'paper' | 'canvas' | 'grain' | 'speckle' | 'fiber' | 'image';
export const TEXTURE_SOURCES: TextureSource[] = ['paper', 'canvas', 'grain', 'speckle', 'fiber', 'image'];

export interface BrushTexture {
  enabled: boolean;
  source: TextureSource;
  image?: { width: number; height: number; data: string };
  /** Texture pixels per texel (1 = native). */
  scale: number; // 0.1..8
  contrast: number; // 0..3
  /** How strongly the grain modulates the dab (0..1). */
  strength: number;
  /** 0 = grain fixed to paper, 1 = grain moves with each dab. */
  movement: number;
  invert: boolean;
}

export type DynamicsInput =
  'pressure' | 'speed' | 'tilt' | 'tiltDirection' | 'direction' | 'rotation' | 'random' | 'fade';
export type DynamicsOutput =
  'size' | 'opacity' | 'flow' | 'angle' | 'scatter' | 'hue' | 'saturation' | 'luminance' | 'texture';

export const DYNAMICS_INPUTS: { id: DynamicsInput; label: string }[] = [
  { id: 'pressure', label: 'Pressure' },
  { id: 'speed', label: 'Speed' },
  { id: 'tilt', label: 'Tilt' },
  { id: 'tiltDirection', label: 'Tilt direction' },
  { id: 'direction', label: 'Stroke direction' },
  { id: 'rotation', label: 'Pen rotation' },
  { id: 'random', label: 'Random' },
  { id: 'fade', label: 'Fade (distance)' },
];
export const DYNAMICS_OUTPUTS: { id: DynamicsOutput; label: string }[] = [
  { id: 'size', label: 'Size' },
  { id: 'opacity', label: 'Opacity' },
  { id: 'flow', label: 'Flow' },
  { id: 'angle', label: 'Angle' },
  { id: 'scatter', label: 'Scatter' },
  { id: 'hue', label: 'Hue' },
  { id: 'saturation', label: 'Saturation' },
  { id: 'luminance', label: 'Luminance' },
  { id: 'texture', label: 'Texture strength' },
];

export interface DynamicsMapping {
  id: string;
  enabled: boolean;
  input: DynamicsInput;
  output: DynamicsOutput;
  /** 0..1: how much the curve affects the output. */
  amount: number;
  curve: CurvePoint[];
}

export type StabilizerMode = 'off' | 'smooth' | 'lazy';

export interface BrushStroke {
  spacing: number; // fraction of diameter, 0.01..2
  /** 'buildup' = flow accumulates; 'max' = even coverage within a stroke. */
  accumulate: 'buildup' | 'max';
  blendMode: BlendMode;
  /** Brush-level stabiliser; 'inherit' uses the global setting. */
  stabilizer: StabilizerMode | 'inherit';
  stabilizerAmount: number; // 0..1
  /** Dabs per second while the pointer rests (airbrush). 0 = off. */
  airbrushRate: number;
  /** Catmull-Rom interpolation between samples. */
  smoothInterpolation: boolean;
}

export interface BrushMixing {
  mode: 'none' | 'smudge' | 'blend';
  /** How much existing colour is picked up per dab (0..1). */
  pickup: number;
  /** How long carried colour persists (0..1). */
  persistence: number;
  /** How much fresh brush colour is mixed in (0..1). */
  dilution: number;
  strength: number; // 0..1
}

export interface BrushColorJitter {
  hue: number; // 0..1 (fraction of the colour wheel)
  saturation: number; // 0..1
  luminance: number; // 0..1
  perStroke: boolean;
}

export interface BrushPreset {
  schemaVersion: number;
  id: string;
  name: string;
  category: BrushCategory;
  tags: string[];
  author: string;
  created: string;
  modified: string;
  factory: boolean;
  engine: BrushEngine;
  tip: BrushTip;
  diameter: number; // px at 100 % zoom, 0.5..1000
  minDiameter: number; // 0..1 fraction of diameter reached at zero input
  opacity: number; // 0..1 stroke opacity
  flow: number; // 0..1 per dab
  count: number; // 1..16 dabs per stamp position
  countJitter: number; // 0..1
  scatter: number; // 0..4 (fraction of diameter)
  rotationJitter: number; // degrees 0..180
  colorJitter: BrushColorJitter;
  /** 'fixed' paints with fixedColor regardless of the current colour (e.g. construction pencils). */
  colorMode: 'current' | 'fixed';
  fixedColor: { r: number; g: number; b: number };
  texture: BrushTexture;
  dynamics: DynamicsMapping[];
  stroke: BrushStroke;
  mixing: BrushMixing;
  seed: number;
  /** Fixed seed makes every stroke identical for a given path (tests, replays). */
  fixedSeed: boolean;
}

export const LIMITS = {
  diameter: [0.5, 1000],
  spacing: [0.01, 2],
  count: [1, 16],
  scatter: [0, 4],
  rotationJitter: [0, 180],
  textureScale: [0.1, 8],
  textureContrast: [0, 3],
} as const;

export function defaultDynamics(): DynamicsMapping[] {
  return [
    { id: 'd-size', enabled: true, input: 'pressure', output: 'size', amount: 0.7, curve: LINEAR_CURVE },
    {
      id: 'd-opacity',
      enabled: false,
      input: 'pressure',
      output: 'opacity',
      amount: 0.5,
      curve: LINEAR_CURVE,
    },
  ];
}

export function createBrush(partial: Partial<BrushPreset> & { id: string; name: string }): BrushPreset {
  const now = new Date(0).toISOString();
  const base: BrushPreset = {
    schemaVersion: BRUSH_SCHEMA_VERSION,
    id: partial.id,
    name: partial.name,
    category: 'Custom',
    tags: [],
    author: 'Canvas Forge',
    created: now,
    modified: now,
    factory: false,
    engine: 'stamp',
    tip: {
      shape: 'round',
      generator: 'bristle',
      generatorSeed: 1,
      hardness: 0.9,
      aspect: 1,
      angle: 0,
      antialias: true,
      invert: false,
    },
    diameter: 12,
    minDiameter: 0.15,
    opacity: 1,
    flow: 1,
    count: 1,
    countJitter: 0,
    scatter: 0,
    rotationJitter: 0,
    colorJitter: { hue: 0, saturation: 0, luminance: 0, perStroke: false },
    colorMode: 'current',
    fixedColor: { r: 0.35, g: 0.65, b: 0.9 },
    texture: {
      enabled: false,
      source: 'paper',
      scale: 1,
      contrast: 1,
      strength: 0.5,
      movement: 0,
      invert: false,
    },
    dynamics: defaultDynamics(),
    stroke: {
      spacing: 0.1,
      accumulate: 'buildup',
      blendMode: 'normal',
      stabilizer: 'inherit',
      stabilizerAmount: 0.3,
      airbrushRate: 0,
      smoothInterpolation: true,
    },
    mixing: { mode: 'none', pickup: 0.5, persistence: 0.5, dilution: 0, strength: 0.6 },
    seed: 1,
    fixedSeed: false,
  };
  return {
    ...base,
    ...partial,
    tip: { ...base.tip, ...partial.tip },
    texture: { ...base.texture, ...partial.texture },
    stroke: { ...base.stroke, ...partial.stroke },
    mixing: { ...base.mixing, ...partial.mixing },
    colorJitter: { ...base.colorJitter, ...partial.colorJitter },
    fixedColor: { ...base.fixedColor, ...partial.fixedColor },
    dynamics: partial.dynamics ?? base.dynamics,
  };
}

// ----------------------------------------------------------------------------------- validation

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const str = (v: unknown, fallback: string, max = 120) => (typeof v === 'string' ? v.slice(0, max) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return options.includes(v as T) ? (v as T) : fallback;
}

function validImage(v: unknown): { width: number; height: number; data: string } | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const w = num(o.width, 1, 1024, 0);
  const h = num(o.height, 1, 1024, 0);
  if (!w || !h || typeof o.data !== 'string' || o.data.length > 2_000_000) return undefined;
  return { width: Math.round(w), height: Math.round(h), data: o.data };
}

function validCurve(v: unknown): CurvePoint[] {
  if (!Array.isArray(v)) return LINEAR_CURVE;
  const pts = v
    .filter((p) => p && typeof p === 'object')
    .slice(0, 16)
    .map((p) => ({ x: num((p as CurvePoint).x, 0, 1, 0), y: num((p as CurvePoint).y, 0, 1, 0) }));
  return pts.length >= 2 ? normalizeCurve(pts) : LINEAR_CURVE;
}

/** Migrates older schema versions in place. Throws for unknown future versions. */
export function migrateBrush(raw: Record<string, unknown>): Record<string, unknown> {
  const v = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (v > BRUSH_SCHEMA_VERSION) {
    throw new Error(`Brush "${String(raw.name ?? '?')}" uses a newer brush format (v${v}).`);
  }
  const out = { ...raw };
  if (v < 1) {
    // v0 (pre-release drafts) stored size as "size" and spacing at the top level.
    if (typeof out.size === 'number' && out.diameter === undefined) out.diameter = out.size;
    if (typeof out.spacing === 'number') out.stroke = { ...(out.stroke as object), spacing: out.spacing };
    out.schemaVersion = 1;
  }
  return out;
}

/** Validates untrusted JSON into a complete preset (clamping values, filling defaults). */
export function validateBrush(input: unknown): BrushPreset {
  if (!input || typeof input !== 'object') throw new Error('Brush data is not an object.');
  const raw = migrateBrush(input as Record<string, unknown>);
  const id = str(raw.id, '', 80);
  if (!id) throw new Error('Brush has no id.');
  const base = createBrush({ id, name: str(raw.name, 'Untitled brush', 80) || 'Untitled brush' });
  const tip = (raw.tip ?? {}) as Record<string, unknown>;
  const tex = (raw.texture ?? {}) as Record<string, unknown>;
  const stroke = (raw.stroke ?? {}) as Record<string, unknown>;
  const mixing = (raw.mixing ?? {}) as Record<string, unknown>;
  const cj = (raw.colorJitter ?? {}) as Record<string, unknown>;
  const engines = BRUSH_ENGINES.map((e) => e.id);
  const tipShape = oneOf(tip.shape, ['round', 'generated', 'image'] as const, 'round');
  const tipImage = validImage(tip.image);
  const texImage = validImage(tex.image);
  const dynamicsRaw = Array.isArray(raw.dynamics) ? raw.dynamics.slice(0, 24) : base.dynamics;
  return {
    ...base,
    schemaVersion: BRUSH_SCHEMA_VERSION,
    category: oneOf(raw.category, BRUSH_CATEGORIES, 'Custom'),
    tags: Array.isArray(raw.tags)
      ? raw.tags
          .filter((t) => typeof t === 'string')
          .slice(0, 12)
          .map((t) => String(t).slice(0, 32))
      : [],
    author: str(raw.author, ''),
    created: str(raw.created, base.created, 40),
    modified: str(raw.modified, base.modified, 40),
    factory: bool(raw.factory, false),
    engine: oneOf(raw.engine, engines, 'stamp'),
    tip: {
      shape: tipShape === 'image' && !tipImage ? 'round' : tipShape,
      generator: oneOf(tip.generator, TIP_GENERATORS, 'bristle'),
      generatorSeed: num(tip.generatorSeed, 0, 2 ** 31, 1),
      ...(tipImage ? { image: tipImage } : {}),
      hardness: num(tip.hardness, 0, 1, base.tip.hardness),
      aspect: num(tip.aspect, 0.05, 1, 1),
      angle: num(tip.angle, -360, 360, 0),
      antialias: bool(tip.antialias, true),
      invert: bool(tip.invert, false),
    },
    diameter: num(raw.diameter, LIMITS.diameter[0], LIMITS.diameter[1], base.diameter),
    minDiameter: num(raw.minDiameter, 0, 1, base.minDiameter),
    opacity: num(raw.opacity, 0, 1, 1),
    flow: num(raw.flow, 0.001, 1, 1),
    count: Math.round(num(raw.count, LIMITS.count[0], LIMITS.count[1], 1)),
    countJitter: num(raw.countJitter, 0, 1, 0),
    scatter: num(raw.scatter, LIMITS.scatter[0], LIMITS.scatter[1], 0),
    rotationJitter: num(raw.rotationJitter, LIMITS.rotationJitter[0], LIMITS.rotationJitter[1], 0),
    colorJitter: {
      hue: num(cj.hue, 0, 1, 0),
      saturation: num(cj.saturation, 0, 1, 0),
      luminance: num(cj.luminance, 0, 1, 0),
      perStroke: bool(cj.perStroke, false),
    },
    colorMode: oneOf(raw.colorMode, ['current', 'fixed'] as const, 'current'),
    fixedColor: (() => {
      const fc = (raw.fixedColor ?? {}) as Record<string, unknown>;
      return { r: num(fc.r, 0, 1, 0.35), g: num(fc.g, 0, 1, 0.65), b: num(fc.b, 0, 1, 0.9) };
    })(),
    texture: {
      enabled: bool(tex.enabled, false),
      source:
        oneOf(tex.source, TEXTURE_SOURCES, 'paper') === 'image' && !texImage
          ? 'paper'
          : oneOf(tex.source, TEXTURE_SOURCES, 'paper'),
      ...(texImage ? { image: texImage } : {}),
      scale: num(tex.scale, LIMITS.textureScale[0], LIMITS.textureScale[1], 1),
      contrast: num(tex.contrast, LIMITS.textureContrast[0], LIMITS.textureContrast[1], 1),
      strength: num(tex.strength, 0, 1, 0.5),
      movement: num(tex.movement, 0, 1, 0),
      invert: bool(tex.invert, false),
    },
    dynamics: dynamicsRaw
      .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
      .map((d, i) => ({
        id: str(d.id, `d${i}`, 40) || `d${i}`,
        enabled: bool(d.enabled, true),
        input: oneOf(
          d.input,
          ['pressure', 'speed', 'tilt', 'tiltDirection', 'direction', 'rotation', 'random', 'fade'] as const,
          'pressure',
        ),
        output: oneOf(
          d.output,
          [
            'size',
            'opacity',
            'flow',
            'angle',
            'scatter',
            'hue',
            'saturation',
            'luminance',
            'texture',
          ] as const,
          'size',
        ),
        amount: num(d.amount, 0, 1, 1),
        curve: validCurve(d.curve),
      })),
    stroke: {
      spacing: num(stroke.spacing, LIMITS.spacing[0], LIMITS.spacing[1], 0.1),
      accumulate: oneOf(stroke.accumulate, ['buildup', 'max'] as const, 'buildup'),
      blendMode: isBlendMode(stroke.blendMode) ? stroke.blendMode : 'normal',
      stabilizer: oneOf(stroke.stabilizer, ['inherit', 'off', 'smooth', 'lazy'] as const, 'inherit'),
      stabilizerAmount: num(stroke.stabilizerAmount, 0, 1, 0.3),
      airbrushRate: num(stroke.airbrushRate, 0, 240, 0),
      smoothInterpolation: bool(stroke.smoothInterpolation, true),
    },
    mixing: {
      mode: oneOf(mixing.mode, ['none', 'smudge', 'blend'] as const, 'none'),
      pickup: num(mixing.pickup, 0, 1, 0.5),
      persistence: num(mixing.persistence, 0, 1, 0.5),
      dilution: num(mixing.dilution, 0, 1, 0),
      strength: num(mixing.strength, 0, 1, 0.6),
    },
    seed: Math.round(num(raw.seed, 0, 2 ** 31, 1)),
    fixedSeed: bool(raw.fixedSeed, false),
  };
}

export function cloneBrush(b: BrushPreset): BrushPreset {
  return JSON.parse(JSON.stringify(b)) as BrushPreset;
}

/** True when engine needs direct layer access (no stroke buffer). */
export function isDirectEngine(b: BrushPreset): boolean {
  return b.engine === 'smudge' || b.engine === 'blender' || b.mixing.mode !== 'none';
}
