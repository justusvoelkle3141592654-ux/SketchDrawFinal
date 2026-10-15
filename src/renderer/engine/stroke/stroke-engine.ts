// Orchestrates one stroke: input samples → stabiliser → interpolation → resampling → dynamics → dabs → commit.
import { blendInto, loadPremul, modeIndex, storeStraight, type PaintBlendMode } from '../blend';
import type { RGB } from '../color';
import { jitterColor } from '../color';
import type { Compositor, StrokePreview } from '../compositor';
import type { RasterDocument } from '../document';
import type { Rect } from '../geometry';
import { TileDiffRecorder, type HistoryEntry } from '../history';
import type { RasterLayer } from '../layers';
import { mulberry32 } from '../random';
import type { MaskGrid } from '../tiles';
import { FloatTileGrid, keyTx, keyTy, type TileGrid } from '../tiles';
import {
  paintDirect,
  sampleUnderDab,
  stampDab,
  type CarriedColor,
  type Dab,
  type DabTexture,
} from '../brush/dab';
import { compileDynamics, evaluateDynamics, type CompiledDynamics } from '../brush/dynamics';
import { isDirectEngine, type BrushPreset } from '../brush/schema';
import { getTexture, getTipImage, type MipImage } from '../brush/tips';
import {
  CurveInterpolator,
  Resampler,
  SpeedTracker,
  Stabilizer,
  type StabilizerKind,
  type StrokeSample,
} from './pipeline';
import { predictPath } from './predictive';

/** Maps a dab to a mirrored/rotated copy (symmetry). */
export interface DabTransform {
  (x: number, y: number, angle: number): { x: number; y: number; angle: number };
}

export interface StrokeSettings {
  brush: BrushPreset;
  color: RGB;
  zoom: number;
  stabilizer: StabilizerKind;
  stabilizerAmount: number;
  /** 0 = off. Strength of post-stroke smoothing / straight-line detection. */
  predictive: number;
  /** Extra transforms (symmetry). Identity is always applied. */
  symmetry: DabTransform[];
  selection: MaskGrid | null;
  /** Force erase regardless of brush engine (pen eraser tip). */
  forceErase: boolean;
  seed?: number;
}

export class StrokeEngine {
  private readonly direct: boolean;
  private readonly target: 'pixels' | 'mask';
  private readonly buffer: FloatTileGrid;
  private readonly recorder: TileDiffRecorder;
  private readonly dyn: CompiledDynamics;
  private readonly tip: MipImage | null;
  private readonly tex: { data: Float32Array; size: number } | null;
  private readonly mode: PaintBlendMode;
  private readonly clip: Rect;
  private stabilizer!: Stabilizer;
  private interp!: CurveInterpolator;
  private resampler!: Resampler;
  private speed!: SpeedTracker;
  private rand!: () => number;
  private readonly seed: number;
  private strokeColor: RGB;
  private lastDab: { x: number; y: number } | null = null;
  private direction = 0;
  private lastSample: StrokeSample | null = null;
  private lastDabTime = 0;
  private carried: CarriedColor | null = null;
  private dabCount = 0;
  /** Stabilised path (for predictive stroke replay). */
  private path: StrokeSample[] = [];
  private active = false;
  private dirtyRects: Rect[] = [];

  constructor(
    private readonly doc: RasterDocument,
    private readonly layer: RasterLayer,
    private readonly compositor: Compositor | null,
    private readonly s: StrokeSettings,
  ) {
    const b = s.brush;
    this.target = layer.editMask && layer.mask ? 'mask' : 'pixels';
    this.direct = this.target === 'pixels' && !s.forceErase && isDirectEngine(b);
    this.buffer = new FloatTileGrid(doc.tileSize);
    const grid: TileGrid | MaskGrid = this.target === 'mask' ? layer.mask! : layer.pixels;
    this.recorder = new TileDiffRecorder(grid);
    this.dyn = compileDynamics(b);
    this.tip = getTipImage(b.tip);
    this.tex = b.texture.enabled ? getTexture(b.texture) : null;
    this.mode = s.forceErase || b.engine === 'eraser' ? 'erase' : b.stroke.blendMode;
    this.clip = doc.bounds;
    this.seed = s.seed ?? (b.fixedSeed ? b.seed : (b.seed * 2654435761 + Date.now()) >>> 0);
    this.strokeColor = this.baseColor;
    this.reset();
  }

  private get baseColor(): RGB {
    const b = this.s.brush;
    return b.colorMode === 'fixed' ? b.fixedColor : this.s.color;
  }

  private reset() {
    const b = this.s.brush;
    this.stabilizer = new Stabilizer(this.s.stabilizer, this.s.stabilizerAmount, this.s.zoom);
    this.interp = new CurveInterpolator(b.stroke.smoothInterpolation);
    this.speed = new SpeedTracker(this.s.zoom);
    this.rand = mulberry32(this.seed);
    this.resampler = new Resampler((p) => this.spacingFor(p));
    this.lastDab = null;
    this.carried = null;
    this.dabCount = 0;
    const cj = b.colorJitter;
    this.strokeColor = cj.perStroke
      ? jitterColor(
          this.baseColor,
          (this.rand() - 0.5) * cj.hue,
          (this.rand() - 0.5) * 2 * cj.saturation,
          (this.rand() - 0.5) * 2 * cj.luminance,
        )
      : this.baseColor;
  }

  get isDirect(): boolean {
    return this.direct;
  }

  begin(sample: StrokeSample): void {
    this.active = true;
    this.lastDabTime = sample.time;
    if (!this.direct && this.compositor) {
      const preview: StrokePreview = {
        layerId: this.layer.id,
        target: this.target,
        buffer: this.buffer,
        opacity: this.s.brush.opacity,
        mode: this.mode,
        alphaLock: false,
      };
      this.compositor.preview = preview;
    }
    this.addSamples([sample]);
  }

  addSamples(samples: StrokeSample[]): void {
    if (!this.active) return;
    for (const raw of samples) {
      this.lastSample = raw;
      this.speed.push(raw);
      for (const st of this.stabilizer.push(raw)) this.feedStabilized(st);
    }
    this.flushDirty();
  }

  /** Called every animation frame while the pointer is down (airbrush flow while resting). */
  tick(time: number): void {
    const rate = this.s.brush.stroke.airbrushRate;
    if (!this.active || rate <= 0 || !this.lastDab || !this.lastSample) return;
    const interval = 1000 / rate;
    let n = 0;
    while (time - this.lastDabTime >= interval && n < 8) {
      this.lastDabTime += interval;
      this.emitDab({ ...this.lastSample, x: this.lastDab.x, y: this.lastDab.y }, this.resampler.distance);
      n++;
    }
    if (n) this.flushDirty();
  }

  private feedStabilized(st: StrokeSample) {
    this.path.push(st);
    for (const p of this.interp.push(st)) this.resampler.push(p, (d, dist) => this.emitDab(d, dist));
  }

  private spacingFor(p: StrokeSample): number {
    const b = this.s.brush;
    // spacing follows the pressure-dependent size so light strokes stay gap-free
    const r = evaluateDynamics(this.dyn, {
      pressure: p.pressure,
      speed: this.speed.value,
      tiltX: p.tiltX,
      tiltY: p.tiltY,
      twist: p.twist,
      direction: this.direction,
      distance: this.resampler?.distance ?? 0,
      random: () => 0.5,
    });
    const diameter = b.diameter * (b.minDiameter + (1 - b.minDiameter) * r.size);
    return Math.max(0.3, diameter * b.stroke.spacing);
  }

  private emitDab(p: StrokeSample, distance: number): void {
    const b = this.s.brush;
    if (this.lastDab) {
      const dx = p.x - this.lastDab.x;
      const dy = p.y - this.lastDab.y;
      if (dx * dx + dy * dy > 0.01) {
        const a = Math.atan2(dy, dx);
        // smooth direction changes to avoid jitter on tiny segments
        let d = a - this.direction;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        this.direction = this.dabCount < 2 ? a : this.direction + d * 0.5;
      }
    }
    this.lastDab = { x: p.x, y: p.y };
    this.lastDabTime = Math.max(this.lastDabTime, p.time);
    this.dabCount++;
    const rand = this.rand;
    const dyn = evaluateDynamics(this.dyn, {
      pressure: p.pressure,
      speed: this.speed.value,
      tiltX: p.tiltX,
      tiltY: p.tiltY,
      twist: p.twist,
      direction: this.direction,
      distance,
      random: rand,
    });
    const diameter = b.diameter * (b.minDiameter + (1 - b.minDiameter) * dyn.size);
    const radius = diameter / 2;
    if (radius < 0.05) return;
    const count = Math.max(1, b.count - Math.round(b.countJitter * rand() * (b.count - 1)));
    const cj = b.colorJitter;
    for (let k = 0; k < count; k++) {
      let x = p.x;
      let y = p.y;
      const scatter = b.scatter * diameter * dyn.scatter;
      if (scatter > 0) {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * scatter;
        x += Math.cos(a) * r;
        y += Math.sin(a) * r;
      }
      let angle = (b.tip.angle * Math.PI) / 180 + dyn.angle;
      if (b.rotationJitter > 0) angle += (rand() - 0.5) * 2 * ((b.rotationJitter * Math.PI) / 180);
      let color = this.strokeColor;
      if (!cj.perStroke && (cj.hue > 0 || cj.saturation > 0 || cj.luminance > 0)) {
        color = jitterColor(
          color,
          (rand() - 0.5) * cj.hue,
          (rand() - 0.5) * 2 * cj.saturation,
          (rand() - 0.5) * 2 * cj.luminance,
        );
      }
      if (dyn.hue || dyn.saturation || dyn.luminance)
        color = jitterColor(color, dyn.hue, dyn.saturation, dyn.luminance);
      const texture: DabTexture | null = this.tex
        ? {
            data: this.tex.data,
            size: this.tex.size,
            scale: b.texture.scale,
            contrast: b.texture.contrast,
            strength: Math.min(1, b.texture.strength * dyn.texture),
            invert: b.texture.invert,
            offX: -x * b.texture.movement,
            offY: -y * b.texture.movement,
          }
        : null;
      const dab: Dab = {
        x,
        y,
        radius,
        aspect: b.tip.aspect,
        angle,
        hardness: b.tip.hardness,
        antialias: b.tip.antialias,
        tip: this.tip,
        alpha: b.flow * dyn.flow,
        ceil: dyn.opacity,
        r: color.r,
        g: color.g,
        b: color.b,
        texture,
      };
      this.placeDab(dab);
      for (const t of this.s.symmetry) {
        const m = t(dab.x, dab.y, dab.angle);
        this.placeDab({
          ...dab,
          x: m.x,
          y: m.y,
          angle: m.angle,
          texture: texture
            ? { ...texture, offX: -m.x * b.texture.movement, offY: -m.y * b.texture.movement }
            : null,
        });
      }
    }
  }

  private placeDab(dab: Dab): void {
    const b = this.s.brush;
    let rect: Rect | null;
    if (this.direct) {
      const grid = this.layer.pixels;
      const under = sampleUnderDab(grid, dab, this.clip);
      const decay =
        b.mixing.persistence >= 0.999
          ? 1
          : Math.max(b.mixing.persistence, Math.exp(-this.dabCount * (1 - b.mixing.persistence) * 0.04));
      const strength = b.mixing.strength * decay * Math.min(1, dab.ceil);
      const paint = { r: dab.r, g: dab.g, b: dab.b, a: 1 };
      if (b.engine === 'blender' || b.mixing.mode === 'blend') {
        if (!under) return;
        rect = paintDirect(
          grid,
          this.recorder,
          dab,
          under,
          strength,
          this.clip,
          this.s.selection,
          this.layer.alphaLock,
        );
      } else {
        // smudge / wet mixing: start with paint (dilution) or picked-up colour
        if (!this.carried) {
          const base = under ?? { r: 0, g: 0, b: 0, a: 0 };
          this.carried = mixCarried(base, paint, b.mixing.dilution);
        }
        rect = paintDirect(
          grid,
          this.recorder,
          dab,
          this.carried,
          strength,
          this.clip,
          this.s.selection,
          this.layer.alphaLock,
        );
        if (under) this.carried = mixCarried(this.carried, under, b.mixing.pickup);
        if (b.mixing.dilution > 0) this.carried = mixCarried(this.carried, paint, b.mixing.dilution * 0.5);
      }
    } else {
      rect = stampDab(this.buffer, dab, b.stroke.accumulate, this.clip, this.s.selection);
    }
    if (rect) this.dirtyRects.push(rect);
  }

  private flushDirty(): void {
    if (!this.dirtyRects.length) return;
    for (const r of this.dirtyRects) this.doc.invalidate(r);
    this.dirtyRects = [];
  }

  /** Ends the stroke, commits pixels and returns an undo entry (null when nothing changed). */
  end(): HistoryEntry | null {
    if (!this.active) return null;
    for (const st of this.stabilizer.finish()) this.feedStabilized(st);
    for (const p of this.interp.finish()) this.resampler.push(p, (d, dist) => this.emitDab(d, dist));
    this.flushDirty();
    if (!this.direct && this.s.predictive > 0 && this.path.length > 3) {
      const predicted = predictPath(this.path, this.s.predictive, this.s.zoom);
      if (predicted) this.replay(predicted);
    }
    this.active = false;
    if (!this.direct) this.commitBuffer();
    if (this.compositor) this.compositor.preview = null;
    const entry = this.recorder.toEntry(this.label(), (rect) => this.doc.markPixelsChanged(rect));
    if (entry) this.doc.markPixelsChanged(null);
    return entry;
  }

  /** Discards the stroke (only possible for buffered strokes; direct strokes are rolled back). */
  cancel(): void {
    if (!this.active) return;
    this.active = false;
    if (this.compositor) this.compositor.preview = null;
    if (this.direct) {
      const entry = this.recorder.toEntry('cancel', (rect) => this.doc.invalidate(rect));
      entry?.undo();
    } else {
      for (const [k, b] of this.buffer.bounds) {
        const ts = this.doc.tileSize;
        this.doc.invalidate({
          x: keyTx(k) * ts + b[0],
          y: keyTy(k) * ts + b[1],
          w: b[2] - b[0],
          h: b[3] - b[1],
        });
      }
    }
    this.buffer.clear();
  }

  private label(): string {
    if (this.target === 'mask') return 'Paint mask';
    if (this.mode === 'erase') return 'Erase';
    return `${this.s.brush.name} stroke`;
  }

  /** Re-renders the stroke from a replacement path (predictive stroke). */
  private replay(path: StrokeSample[]): void {
    const ts = this.doc.tileSize;
    for (const [k, b] of this.buffer.bounds) {
      this.doc.invalidate({
        x: keyTx(k) * ts + b[0],
        y: keyTy(k) * ts + b[1],
        w: b[2] - b[0],
        h: b[3] - b[1],
      });
    }
    this.buffer.clear();
    this.reset();
    const resampler = this.resampler;
    for (const p of path) resampler.push(p, (d, dist) => this.emitDab(d, dist));
    this.flushDirty();
  }

  private commitBuffer(): void {
    const ts = this.doc.tileSize;
    const opacity = this.s.brush.opacity;
    const m = modeIndex(this.mode);
    const lock = this.layer.alphaLock;
    const px = new Float32Array(4);
    for (const [key, b] of this.buffer.bounds) {
      const src = this.buffer.tiles.get(key);
      if (!src) continue;
      const tx = keyTx(key);
      const ty = keyTy(key);
      const [x0, y0, x1, y1] = b;
      if (this.target === 'mask') {
        const mask = this.layer.mask!;
        this.recorder.capture(key, x0, y0, x1 - x0, y1 - y0);
        const mt = mask.getOrCreate(tx, ty);
        const erase = this.mode === 'erase';
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * ts + x) * 4;
            const sa = src[i + 3] * opacity;
            if (sa <= 0) continue;
            const grey = erase ? 0 : (0.3 * src[i] + 0.59 * src[i + 1] + 0.11 * src[i + 2]) / src[i + 3];
            const j = y * ts + x;
            mt[j] = (mt[j] / 255) * (1 - sa) * 255 + grey * sa * 255;
          }
        }
        continue;
      }
      let tile = this.layer.pixels.get(tx, ty);
      if (!tile && (this.mode === 'erase' || lock)) continue;
      this.recorder.capture(key, x0, y0, x1 - x0, y1 - y0);
      if (!tile) tile = this.layer.pixels.getOrCreate(tx, ty);
      const normal = m === 0 && !lock;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * ts + x) * 4;
          const sa = src[i + 3] * opacity;
          if (sa <= 0) continue;
          if (normal) {
            // inlined source-over in premultiplied space, stored back as straight RGBA8
            const da = tile[i + 3] * INV255;
            const k = 1 - sa;
            const na = sa + da * k;
            if (na <= 1 / 510) {
              tile[i] = tile[i + 1] = tile[i + 2] = tile[i + 3] = 0;
              continue;
            }
            const dk = da * k * INV255;
            const inv = 255 / na;
            tile[i] = (src[i] * opacity + tile[i] * dk) * inv;
            tile[i + 1] = (src[i + 1] * opacity + tile[i + 1] * dk) * inv;
            tile[i + 2] = (src[i + 2] * opacity + tile[i + 2] * dk) * inv;
            tile[i + 3] = na * 255;
            continue;
          }
          loadPremul(tile, i, px, 0);
          blendInto(px, 0, src[i] * opacity, src[i + 1] * opacity, src[i + 2] * opacity, sa, m, lock);
          storeStraight(px, 0, tile, i);
        }
      }
    }
    this.buffer.clear();
  }
}

const INV255 = 1 / 255;

function mixCarried(a: CarriedColor, b: CarriedColor, t: number): CarriedColor {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
  };
}

/** Symmetry helpers. Angles are mirrored so asymmetric tips stay mirrored too. */
export function mirrorX(cx: number): DabTransform {
  return (x, y, angle) => ({ x: 2 * cx - x, y, angle: Math.PI - angle });
}
export function mirrorY(cy: number): DabTransform {
  return (x, y, angle) => ({ x, y: 2 * cy - y, angle: -angle });
}
export function rotateAbout(cx: number, cy: number, rad: number): DabTransform {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return (x, y, angle) => ({
    x: cx + (x - cx) * c - (y - cy) * s,
    y: cy + (x - cx) * s + (y - cy) * c,
    angle: angle + rad,
  });
}
export function composeTransforms(a: DabTransform, b: DabTransform): DabTransform {
  return (x, y, angle) => {
    const m = a(x, y, angle);
    return b(m.x, m.y, m.angle);
  };
}
