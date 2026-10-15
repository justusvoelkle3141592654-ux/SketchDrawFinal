// Flipbook animation model. Every top-level node of the layer stack (a layer or a group) is one
// frame, bottom → top. Optionally the bottom node is a held background and the top node a held
// foreground, visible behind/above every frame. Settings live in `features.animation`.
import type { CompositeOptions, NodeStyle } from './compositor';
import type { RasterDocument } from './document';
import { isDescendant, type LayerNode } from './layers';

export interface OnionSettings {
  enabled: boolean;
  /** Frames shown before / after the current one (0–5). */
  before: number;
  after: number;
  /** Opacity of the nearest onion frame; farther frames fade linearly. */
  opacity: number;
  /** Tint previous frames warm and next frames cool. */
  tint: boolean;
}

export interface AnimationSettings {
  enabled: boolean;
  fps: number;
  loop: boolean;
  holdBackground: boolean;
  holdForeground: boolean;
  onion: OnionSettings;
  /** Exposure (number of timeline ticks) per frame node id; missing = 1. */
  exposures: Record<string, number>;
}

export const MAX_EXPOSURE = 48;
export const ONION_BEFORE = { r: 0.92, g: 0.32, b: 0.36 };
export const ONION_AFTER = { r: 0.2, g: 0.68, b: 0.95 };

export function defaultAnimation(): AnimationSettings {
  return {
    enabled: false,
    fps: 12,
    loop: true,
    holdBackground: false,
    holdForeground: false,
    onion: { enabled: true, before: 1, after: 1, opacity: 0.4, tint: true },
    exposures: {},
  };
}

const num = (v: unknown, lo: number, hi: number, def: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;

/** Validates settings read from a file (unknown or broken values fall back to defaults). */
export function sanitizeAnimation(raw: unknown): AnimationSettings {
  const d = defaultAnimation();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<AnimationSettings>;
  const o = (r.onion && typeof r.onion === 'object' ? r.onion : {}) as Partial<OnionSettings>;
  const exposures: Record<string, number> = {};
  if (r.exposures && typeof r.exposures === 'object')
    for (const [k, v] of Object.entries(r.exposures)) {
      const n = Math.round(num(v, 1, MAX_EXPOSURE, 1));
      if (n > 1) exposures[k] = n;
    }
  return {
    enabled: r.enabled === true,
    fps: Math.round(num(r.fps, 1, 60, d.fps)),
    loop: typeof r.loop === 'boolean' ? r.loop : d.loop,
    holdBackground: r.holdBackground === true,
    holdForeground: r.holdForeground === true,
    onion: {
      enabled: typeof o.enabled === 'boolean' ? o.enabled : d.onion.enabled,
      before: Math.round(num(o.before, 0, 5, d.onion.before)),
      after: Math.round(num(o.after, 0, 5, d.onion.after)),
      opacity: num(o.opacity, 0.05, 1, d.onion.opacity),
      tint: typeof o.tint === 'boolean' ? o.tint : d.onion.tint,
    },
    exposures,
  };
}

export interface FrameLayout {
  background: LayerNode | null;
  foreground: LayerNode | null;
  frames: LayerNode[];
}

/** Splits the top-level layers into held background, frames and held foreground. */
export function frameLayout(doc: RasterDocument, a: AnimationSettings): FrameLayout {
  const top = doc.layers;
  let lo = 0;
  let hi = top.length;
  const background = a.holdBackground && hi - lo >= 2 ? top[lo++] : null;
  const foreground = a.holdForeground && hi - lo >= 2 ? top[--hi] : null;
  return { background, foreground, frames: top.slice(lo, hi) };
}

/** The top-level node that contains layer `id` (or is it). */
export function topLevelOf(doc: RasterDocument, id: string): LayerNode | null {
  for (const n of doc.layers) {
    if (n.id === id) return n;
    if (n.kind === 'group' && isDescendant(n, id)) return n;
  }
  return null;
}

/** Index of the frame holding the active layer; held layers report the nearest frame. */
export function currentFrameIndex(doc: RasterDocument, a: AnimationSettings): number {
  const { frames, background, foreground } = frameLayout(doc, a);
  if (!frames.length) return -1;
  const top = topLevelOf(doc, doc.activeLayerId);
  if (!top) return 0;
  if (top === background) return 0;
  if (top === foreground) return frames.length - 1;
  const i = frames.indexOf(top);
  return i < 0 ? 0 : i;
}

export function exposureOf(a: AnimationSettings, node: LayerNode): number {
  return Math.max(1, Math.min(MAX_EXPOSURE, Math.round(a.exposures[node.id] ?? 1)));
}

/** Timeline: frame i starts at tick `start` and lasts `length` ticks (1 tick = 1 / fps s). */
export function timeline(frames: LayerNode[], a: AnimationSettings): { start: number; length: number }[] {
  let t = 0;
  return frames.map((f) => {
    const length = exposureOf(a, f);
    const e = { start: t, length };
    t += length;
    return e;
  });
}

/** Frame index shown at `tick` (ticks wrap when looping, otherwise clamp to the last frame). */
export function frameAtTick(frames: LayerNode[], a: AnimationSettings, tick: number): number {
  const tl = timeline(frames, a);
  if (!tl.length) return -1;
  const total = tl[tl.length - 1].start + tl[tl.length - 1].length;
  let t = Math.floor(tick);
  if (a.loop) t = ((t % total) + total) % total;
  else t = Math.max(0, Math.min(total - 1, t));
  for (let i = tl.length - 1; i >= 0; i--) if (t >= tl[i].start) return i;
  return 0;
}

/**
 * Composite options that show frame `index` with the held layers and, when `onion` is set,
 * the neighbouring frames as tinted, fading onion skins underneath the current frame.
 */
export function frameCompositeOptions(
  doc: RasterDocument,
  a: AnimationSettings,
  index: number,
  onion: boolean,
): CompositeOptions {
  const { frames, background, foreground } = frameLayout(doc, a);
  const roots: LayerNode[] = [];
  const styles = new Map<string, NodeStyle>();
  if (background) roots.push(background);
  if (onion && a.onion.enabled && frames.length > 1) {
    const add = (k: number, count: number, tint: NodeStyle['tint']) => {
      const f = frames[k];
      if (!f) return;
      const dist = Math.abs(k - index);
      styles.set(f.id, {
        opacity: (a.onion.opacity * (count - dist + 1)) / count,
        tint: a.onion.tint ? tint : null,
        tintAmount: a.onion.tint ? 0.75 : 0,
      });
      roots.push(f);
    };
    // farthest first so nearer onion frames draw on top
    for (let d = a.onion.before; d >= 1; d--) add(index - d, a.onion.before, ONION_BEFORE);
    for (let d = a.onion.after; d >= 1; d--) add(index + d, a.onion.after, ONION_AFTER);
  }
  const cur = frames[index];
  if (cur) roots.push(cur);
  if (foreground) roots.push(foreground);
  return {
    roots,
    nodeStyle: styles.size ? (n) => styles.get(n.id) ?? null : undefined,
  };
}

/** Stable key of what a frame view shows, used to know when the view must be recomposited. */
export function frameViewKey(
  doc: RasterDocument,
  a: AnimationSettings,
  index: number,
  onion: boolean,
): string {
  const o = frameCompositeOptions(doc, a, index, onion);
  const ids = (o.roots ?? []).map((n) => n.id).join(',');
  return `${ids}|${onion && a.onion.enabled ? `${a.onion.before}.${a.onion.after}.${a.onion.opacity}.${a.onion.tint}` : '-'}`;
}
