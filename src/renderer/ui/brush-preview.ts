// Renders brush stroke previews with the real engine (cached as data URLs).
import { RasterDocument } from '../engine/document';
import { Compositor } from '../engine/compositor';
import { StrokeEngine } from '../engine/stroke/stroke-engine';
import { cloneBrush, createBrush, type BrushPreset } from '../engine/brush/schema';
import type { StrokeSample } from '../engine/stroke/pipeline';
import type { RGB } from '../engine/color';

const cache = new Map<string, string>();

export function brushKey(b: BrushPreset, w: number, h: number, theme: string): string {
  const { modified: _m, created: _c, name: _n, tags: _t, ...rest } = b;
  return `${w}x${h}:${theme}:${JSON.stringify(rest)}`;
}

export interface PreviewOptions {
  width: number;
  height: number;
  color: RGB;
  background: 'transparent' | 'white' | 'grey' | 'black';
  /** Optional replay path (Brush Lab test strokes). */
  path?: StrokeSample[];
  seed?: number;
}

/** Default S-curve with a pressure swell, used for library thumbnails. */
export function defaultPreviewPath(w: number, h: number): StrokeSample[] {
  const pts: StrokeSample[] = [];
  const n = 90;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = w * 0.08 + t * w * 0.84;
    const y = h / 2 + Math.sin(t * Math.PI * 2) * h * 0.22;
    const pressure = Math.sin(t * Math.PI) * 0.9 + 0.1;
    pts.push({ x, y, pressure, tiltX: 20 * Math.cos(t * 3), tiltY: 15, twist: t * 180, time: i * 6 });
  }
  return pts;
}

const BG: Record<PreviewOptions['background'], RGB | null> = {
  transparent: null,
  white: { r: 1, g: 1, b: 1 },
  grey: { r: 0.5, g: 0.5, b: 0.52 },
  black: { r: 0.06, g: 0.06, b: 0.07 },
};

/** Renders a preview into straight RGBA. Brush size is scaled so the stroke fits the box. */
export function renderBrushPreview(brushIn: BrushPreset, o: PreviewOptions, scaleToFit = true): ImageData {
  const brush = cloneBrush(brushIn);
  if (scaleToFit) {
    const maxD = o.height * 0.55;
    if (brush.diameter > maxD) brush.diameter = maxD;
    if (brush.diameter < 2 && o.height > 30) brush.diameter = Math.max(brush.diameter, 1.5);
  }
  brush.stroke.stabilizer = 'off';
  brush.stroke.airbrushRate = 0;
  brush.fixedSeed = true;
  const bg = BG[o.background];
  const doc = RasterDocument.createDefault({
    width: o.width,
    height: o.height,
    background: bg ? { transparent: false, color: bg } : { transparent: true, color: { r: 1, g: 1, b: 1 } },
  });
  const layer = doc.activeRaster!;
  const needsBase =
    brush.engine === 'eraser' ||
    brush.engine === 'smudge' ||
    brush.engine === 'blender' ||
    brush.mixing.mode !== 'none';
  if (needsBase) {
    // paint colour bands for erasers / smudgers to act on
    const base = createBrush({
      id: 'preview.base',
      name: 'base',
      tip: { shape: 'round', hardness: 1, aspect: 1, angle: 0, antialias: true },
      diameter: o.height * 0.42,
      minDiameter: 1,
      dynamics: [],
      stroke: {
        spacing: 0.1,
        accumulate: 'max',
        blendMode: 'normal',
        stabilizer: 'off',
        stabilizerAmount: 0,
        airbrushRate: 0,
        smoothInterpolation: false,
      },
    });
    const bands: [RGB, number][] = [
      [{ r: 0.2, g: 0.62, b: 0.9 }, 0.36],
      [{ r: 0.95, g: 0.55, b: 0.2 }, 0.64],
    ];
    for (const [c, fy] of bands) {
      const e = new StrokeEngine(doc, layer, null, settings(base, c, 1));
      e.begin({ x: 0, y: o.height * fy, pressure: 1, tiltX: 0, tiltY: 0, twist: 0, time: 0 });
      e.addSamples([{ x: o.width, y: o.height * fy, pressure: 1, tiltX: 0, tiltY: 0, twist: 0, time: 10 }]);
      e.end();
    }
  }
  const engine = new StrokeEngine(doc, layer, null, settings(brush, o.color, o.seed ?? 7));
  const path = o.path ?? defaultPreviewPath(o.width, o.height);
  engine.begin(path[0]);
  engine.addSamples(path.slice(1));
  engine.end();
  const comp = new Compositor(doc);
  const data = comp.compositeToRGBA(doc.bounds);
  return new ImageData(data as Uint8ClampedArray<ArrayBuffer>, o.width, o.height);
}

function settings(brush: BrushPreset, color: RGB, seed: number) {
  return {
    brush,
    color,
    zoom: 1,
    stabilizer: 'off' as const,
    stabilizerAmount: 0,
    predictive: 0,
    symmetry: [],
    selection: null,
    forceErase: false,
    seed,
  };
}

let canvas: HTMLCanvasElement | null = null;

export function brushThumbnail(b: BrushPreset, w: number, h: number, theme: 'dark' | 'light'): string {
  const key = brushKey(b, w, h, theme);
  const hit = cache.get(key);
  if (hit) return hit;
  const color = theme === 'dark' ? { r: 0.88, g: 0.9, b: 0.93 } : { r: 0.12, g: 0.13, b: 0.15 };
  const img = renderBrushPreview(b, { width: w, height: h, color, background: 'transparent' });
  canvas ??= document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  const url = canvas.toDataURL('image/png');
  if (cache.size > 400) cache.clear();
  cache.set(key, url);
  return url;
}

/** Queues thumbnail generation during idle time; resolves with the data URL. */
const queue: {
  b: BrushPreset;
  w: number;
  h: number;
  theme: 'dark' | 'light';
  resolve: (s: string) => void;
}[] = [];
let scheduled = false;
export function thumbnailAsync(
  b: BrushPreset,
  w: number,
  h: number,
  theme: 'dark' | 'light',
): Promise<string> {
  const key = brushKey(b, w, h, theme);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    queue.push({ b, w, h, theme, resolve });
    if (!scheduled) {
      scheduled = true;
      const run = (deadline?: IdleDeadline) => {
        const start = performance.now();
        while (queue.length && (deadline ? deadline.timeRemaining() > 2 : performance.now() - start < 12)) {
          const job = queue.shift()!;
          job.resolve(brushThumbnail(job.b, job.w, job.h, job.theme));
        }
        if (queue.length) schedule();
        else scheduled = false;
      };
      const schedule = () =>
        'requestIdleCallback' in window
          ? requestIdleCallback(run, { timeout: 200 })
          : setTimeout(() => run(), 16);
      schedule();
    }
  });
}
