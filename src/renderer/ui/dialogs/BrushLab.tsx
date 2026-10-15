// Brush Lab: create and edit brushes with grouped controls, curves and a live test area.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../Overlays';
import { Button, IconButton, Segmented, Select, Slider, Toggle } from '../controls/controls';
import { CurveEditor, withMinPoints } from '../controls/CurveEditor';
import { Icon } from '../icons';
import { confirmDialog, toast, useUi } from '../../state/ui';
import { useBrushes, factoryVersionOf } from '../../state/brushes';
import { useColors } from '../../state/colors';
import { usePrefs } from '../../state/preferences';
import {
  BRUSH_CATEGORIES,
  BRUSH_ENGINES,
  DYNAMICS_INPUTS,
  DYNAMICS_OUTPUTS,
  TEXTURE_SOURCES,
  TIP_GENERATORS,
  cloneBrush,
  createBrush,
  type BrushPreset,
  type DynamicsMapping,
} from '../../engine/brush/schema';
import { LINEAR_CURVE } from '../../engine/curve';
import { uid } from '../../engine/random';
import { RasterDocument } from '../../engine/document';
import { Compositor } from '../../engine/compositor';
import { StrokeEngine } from '../../engine/stroke/stroke-engine';
import type { StrokeSample } from '../../engine/stroke/pipeline';
import { forge } from '../../platform';
import { decodeImageBytes, resizeRGBA } from '../../app/image-codec';
import { encodeGreyImage } from '../../engine/brush/tips';
import { normalizePointer } from '../../input/normalize';
import { parseHex, rgbToHex, type RGB } from '../../engine/color';
import { renderBrushPreview } from '../brush-preview';

type SectionId = 'tip' | 'stroke' | 'dynamics' | 'texture' | 'colour' | 'mixing';
const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'tip', label: 'Tip' },
  { id: 'stroke', label: 'Stroke' },
  { id: 'dynamics', label: 'Dynamics' },
  { id: 'texture', label: 'Texture' },
  { id: 'colour', label: 'Colour' },
  { id: 'mixing', label: 'Mixing' },
];

type Bg = 'white' | 'grey' | 'black' | 'transparent';
const BG_RGB: Record<Bg, RGB | null> = {
  white: { r: 1, g: 1, b: 1 },
  grey: { r: 0.5, g: 0.5, b: 0.52 },
  black: { r: 0.06, g: 0.06, b: 0.07 },
  transparent: null,
};

// ------------------------------------------------------------------------------- test strokes

type Replay = 'ramp' | 'zigzag' | 'slow' | 'taper' | 'scribble';
const REPLAYS: { id: Replay; label: string; tip: string }[] = [
  { id: 'ramp', label: 'Pressure ramp', tip: 'Light to heavy pressure, left to right' },
  { id: 'taper', label: 'Taper', tip: 'Light → heavy → light swell' },
  { id: 'slow', label: 'Slow curve', tip: 'Slow S-curve with constant medium pressure' },
  {
    id: 'zigzag',
    label: 'Fast zig-zag',
    tip: 'Fast stroke with sharp corners (tests spacing and speed dynamics)',
  },
  { id: 'scribble', label: 'Tilted scribble', tip: 'Loops with changing tilt and pen rotation' },
];

function replayPath(kind: Replay, w: number, h: number, row: number, rows: number): StrokeSample[] {
  const pts: StrokeSample[] = [];
  const top = (h / rows) * row;
  const band = h / rows;
  const cy = top + band / 2;
  const amp = band * 0.3;
  const n = kind === 'zigzag' ? 40 : 140;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let x = 20 + t * (w - 40);
    let y = cy;
    let p = 0.6;
    let dt = 8;
    let tiltX = 0;
    let tiltY = 0;
    let twist = 0;
    switch (kind) {
      case 'ramp':
        p = t;
        y = cy + Math.sin(t * Math.PI * 2) * amp * 0.4;
        break;
      case 'taper':
        p = Math.sin(t * Math.PI);
        y = cy + Math.sin(t * Math.PI * 2) * amp;
        break;
      case 'slow':
        p = 0.55;
        y = cy + Math.sin(t * Math.PI * 2) * amp;
        dt = 24;
        break;
      case 'zigzag':
        p = 0.8;
        y = cy + (i % 2 ? amp : -amp);
        dt = 3;
        break;
      case 'scribble': {
        const a = t * Math.PI * 8;
        x = 30 + t * (w - 60) + Math.cos(a) * amp * 0.8;
        y = cy + Math.sin(a) * amp;
        p = 0.4 + 0.5 * Math.abs(Math.sin(a / 2));
        tiltX = Math.cos(t * Math.PI * 2) * 55;
        tiltY = Math.sin(t * Math.PI * 2) * 40;
        twist = (t * 720) % 360;
        break;
      }
    }
    pts.push({ x, y, pressure: p, tiltX, tiltY, twist, time: i * dt });
  }
  return pts;
}

// ------------------------------------------------------------------------------- test area

function TestArea({ brush, color }: { brush: BrushPreset; color: RGB }) {
  const W = 380;
  const H = 250;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [bg, setBg] = useState<Bg>('white');
  const docRef = useRef<RasterDocument | null>(null);
  const engineRef = useRef<StrokeEngine | null>(null);
  const compRef = useRef<Compositor | null>(null);
  const brushRef = useRef(brush);
  brushRef.current = brush;

  const reset = useCallback(() => {
    const c = BG_RGB[bg];
    docRef.current = RasterDocument.createDefault({
      width: W,
      height: H,
      background: c ? { transparent: false, color: c } : { transparent: true, color: { r: 1, g: 1, b: 1 } },
    });
  }, [bg]);

  const paint = useCallback(() => {
    const doc = docRef.current;
    const cv = canvasRef.current;
    if (!doc || !cv) return;
    const comp = compRef.current ?? new Compositor(doc);
    const data = comp.compositeToRGBA(doc.bounds);
    cv.getContext('2d')!.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, W, H), 0, 0);
  }, []);

  useEffect(() => {
    reset();
    paint();
  }, [reset, paint]);

  const settingsFor = (b: BrushPreset) => ({
    brush: b,
    color,
    zoom: 1,
    stabilizer:
      b.stroke.stabilizer === 'inherit' ? usePrefs.getState().prefs.stabilizer.mode : b.stroke.stabilizer,
    stabilizerAmount:
      b.stroke.stabilizer === 'inherit'
        ? usePrefs.getState().prefs.stabilizer.amount
        : b.stroke.stabilizerAmount,
    predictive: 0,
    symmetry: [],
    selection: null,
    forceErase: false,
  });

  const replay = (kind: Replay) => {
    const doc = docRef.current!;
    const b = cloneBrush(brushRef.current);
    const rows = 3;
    for (let row = 0; row < rows; row++) {
      const path = replayPath(kind, W, H, row, rows);
      const comp = new Compositor(doc);
      const e = new StrokeEngine(doc, doc.activeRaster!, comp, { ...settingsFor(b), seed: 11 + row });
      e.begin(path[0]);
      e.addSamples(path.slice(1));
      e.end();
    }
    paint();
  };

  const prefill = () => {
    // a few colour bands to try smudge, blend and eraser brushes on
    const doc = docRef.current!;
    const base = createBrush({
      id: 'lab.base',
      name: 'base',
      tip: { shape: 'round', hardness: 1, aspect: 1, angle: 0, antialias: true },
      diameter: 46,
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
      [{ r: 0.17, g: 0.6, b: 0.86 }, 0.25],
      [{ r: 0.95, g: 0.62, b: 0.18 }, 0.5],
      [{ r: 0.82, g: 0.22, b: 0.42 }, 0.75],
    ];
    for (const [c, fy] of bands) {
      const e = new StrokeEngine(doc, doc.activeRaster!, null, {
        ...settingsFor(base),
        color: c,
        stabilizer: 'off',
        stabilizerAmount: 0,
        seed: 1,
      });
      e.begin({ x: 0, y: H * fy, pressure: 1, tiltX: 0, tiltY: 0, twist: 0, time: 0 });
      e.addSamples([{ x: W, y: H * fy, pressure: 1, tiltX: 0, tiltY: 0, twist: 0, time: 10 }]);
      e.end();
    }
    paint();
  };

  const toSample = (e: PointerEvent): StrokeSample => {
    const r = canvasRef.current!.getBoundingClientRect();
    const n = normalizePointer(e, usePrefs.getState().prefs.input, true);
    return {
      x: ((e.clientX - r.left) / r.width) * W,
      y: ((e.clientY - r.top) / r.height) * H,
      pressure: n.pressure,
      tiltX: n.tiltX,
      tiltY: n.tiltY,
      twist: n.twist,
      time: e.timeStamp,
    };
  };

  return (
    <div className="lab-test">
      <div className="lab-test-head">
        <Segmented<Bg>
          label="Test background"
          value={bg}
          onChange={setBg}
          options={[
            { id: 'white', label: 'White' },
            { id: 'grey', label: 'Grey' },
            { id: 'black', label: 'Black' },
            { id: 'transparent', label: 'Clear', tip: 'Transparent background' },
          ]}
        />
        <IconButton icon="trash" label="Clear test area" onClick={() => (reset(), paint())} size={16} />
      </div>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className={`lab-canvas ${bg === 'transparent' ? 'is-transparent' : ''}`}
        aria-label="Brush test area. Draw here with a pen or mouse."
        data-testid="lab-canvas"
        style={{ touchAction: 'none' }}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (e.button !== 0 && e.pointerType === 'mouse') return;
          (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
          const doc = docRef.current!;
          const comp = new Compositor(doc);
          const eng = new StrokeEngine(
            doc,
            doc.activeRaster!,
            comp,
            settingsFor(cloneBrush(brushRef.current)),
          );
          compRef.current = comp;
          engineRef.current = eng;
          eng.begin(toSample(e.nativeEvent));
          paint();
        }}
        onPointerMove={(e) => {
          const eng = engineRef.current;
          if (!eng) return;
          const ev = e.nativeEvent;
          const list = ev.getCoalescedEvents?.() ?? [ev];
          eng.addSamples((list.length ? list : [ev]).map(toSample));
          paint();
        }}
        onPointerUp={() => {
          engineRef.current?.end();
          engineRef.current = null;
          compRef.current = null;
          paint();
        }}
        onPointerCancel={() => {
          engineRef.current?.end();
          engineRef.current = null;
          compRef.current = null;
          paint();
        }}
      />
      <div className="lab-replays">
        {REPLAYS.map((r) => (
          <Button key={r.id} onClick={() => replay(r.id)} title={r.tip} testId={`lab-replay-${r.id}`}>
            {r.label}
          </Button>
        ))}
        <Button onClick={prefill} title="Paint colour bands to test smudge, blend and eraser brushes">
          Colour bands
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------- live stamp

function LiveStamp({ brush }: { brush: BrushPreset }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = usePrefs((s) => s.prefs.theme);
  useEffect(() => {
    const t = setTimeout(() => {
      const S = 64;
      const b = cloneBrush(brush);
      b.diameter = Math.min(52, Math.max(4, b.diameter));
      b.count = 1;
      b.scatter = 0;
      b.dynamics = b.dynamics.filter((d) => d.input !== 'random');
      const img = renderBrushPreview(
        b,
        {
          width: S,
          height: S,
          color: theme === 'dark' ? { r: 0.92, g: 0.93, b: 0.95 } : { r: 0.1, g: 0.1, b: 0.12 },
          background: 'transparent',
          path: [{ x: S / 2, y: S / 2, pressure: 1, tiltX: 0, tiltY: 0, twist: 0, time: 0 }],
        },
        false,
      );
      ref.current?.getContext('2d')!.putImageData(img, 0, 0);
    }, 60);
    return () => clearTimeout(t);
  }, [brush, theme]);
  return <canvas ref={ref} width={64} height={64} className="lab-stamp" aria-label="Brush tip stamp" />;
}

// ------------------------------------------------------------------------------- sections

type Patch = (fn: (b: BrushPreset) => void) => void;

function TipSection({ b, patch }: { b: BrushPreset; patch: Patch }) {
  const importTip = async () => {
    const f = await forge.importImage();
    if (!f) return;
    if ('error' in f) return toast('error', 'Could not read the image.', f.error);
    try {
      const img = await decodeImageBytes(f.bytes, f.name);
      const max = 256;
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * k));
      const h = Math.max(1, Math.round(img.height * k));
      const data = k < 1 ? resizeRGBA(img.data, img.width, img.height, w, h) : img.data;
      // dark, opaque pixels paint; white or transparent pixels do not
      const grey = new Uint8ClampedArray(w * h);
      for (let i = 0; i < w * h; i++) {
        const a = data[i * 4 + 3] / 255;
        const lum = (0.3 * data[i * 4] + 0.59 * data[i * 4 + 1] + 0.11 * data[i * 4 + 2]) / 255;
        grey[i] = (1 - lum) * a * 255;
      }
      patch((x) => {
        x.tip.shape = 'image';
        x.tip.image = encodeGreyImage(w, h, grey);
      });
      toast(
        'success',
        `Using ${f.name} as the brush tip (${w}×${h}). Dark areas paint, white areas stay clear.`,
      );
    } catch (e) {
      toast('error', 'The image could not be used as a tip.', (e as Error).message);
    }
  };
  return (
    <div className="lab-grid">
      <h4>Shape</h4>
      <Segmented
        label="Tip shape"
        value={b.tip.shape}
        onChange={(v) =>
          patch((x) => {
            if (v === 'image' && !x.tip.image) {
              void importTip();
              return;
            }
            x.tip.shape = v;
          })
        }
        options={[
          { id: 'round', label: 'Round / elliptical' },
          { id: 'generated', label: 'Generated' },
          { id: 'image', label: 'Image' },
        ]}
      />
      {b.tip.shape === 'generated' ? (
        <div className="lab-row">
          <Select
            label="Pattern"
            value={b.tip.generator ?? 'bristle'}
            options={TIP_GENERATORS.map((g) => ({ id: g, label: g[0].toUpperCase() + g.slice(1) }))}
            onChange={(v) => patch((x) => void (x.tip.generator = v))}
          />
          <Slider
            label="Variation seed"
            value={b.tip.generatorSeed ?? 1}
            min={1}
            max={99}
            step={1}
            onChange={(v) => patch((x) => void (x.tip.generatorSeed = Math.round(v)))}
          />
        </div>
      ) : null}
      {b.tip.shape === 'image' ? (
        <div className="lab-row">
          <Button icon="import" onClick={() => void importTip()}>
            Import grey tip image…
          </Button>
          <Toggle
            label="Invert tip"
            checked={!!b.tip.invert}
            onChange={(v) => patch((x) => void (x.tip.invert = v))}
          />
        </div>
      ) : (
        <div className="lab-row">
          <Button
            icon="import"
            onClick={() => void importTip()}
            title="Make this brush use an imported grey image as its tip"
          >
            New tip from image…
          </Button>
        </div>
      )}
      <h4>Size and form</h4>
      <Slider
        label="Diameter"
        value={b.diameter}
        min={0.5}
        max={1000}
        step={0.1}
        decimals={1}
        unit="px"
        curve="pow"
        onChange={(v) => patch((x) => void (x.diameter = v))}
        testId="lab-diameter"
      />
      <Slider
        label="Minimum diameter"
        value={b.minDiameter}
        min={0}
        max={1}
        step={0.01}
        displayScale={100}
        unit="%"
        hint="Size reached when the size dynamics are at zero (e.g. no pressure)."
        onChange={(v) => patch((x) => void (x.minDiameter = v))}
      />
      <Slider
        label="Hardness"
        value={b.tip.hardness}
        min={0}
        max={1}
        step={0.01}
        displayScale={100}
        unit="%"
        disabled={b.tip.shape !== 'round'}
        onChange={(v) => patch((x) => void (x.tip.hardness = v))}
      />
      <Slider
        label="Roundness"
        value={b.tip.aspect}
        min={0.05}
        max={1}
        step={0.01}
        displayScale={100}
        unit="%"
        hint="100 % is a circle; lower values flatten the tip."
        onChange={(v) => patch((x) => void (x.tip.aspect = v))}
      />
      <Slider
        label="Angle"
        value={b.tip.angle}
        min={-180}
        max={180}
        step={1}
        unit="°"
        onChange={(v) => patch((x) => void (x.tip.angle = v))}
      />
      <Toggle
        label="Anti-aliasing"
        checked={b.tip.antialias}
        onChange={(v) => patch((x) => void (x.tip.antialias = v))}
        hint="Off gives hard pixel edges (pixel art)."
      />
    </div>
  );
}

function StrokeSection({ b, patch }: { b: BrushPreset; patch: Patch }) {
  return (
    <div className="lab-grid">
      <h4>Paint</h4>
      <Slider
        label="Opacity"
        value={b.opacity}
        min={0.01}
        max={1}
        step={0.01}
        displayScale={100}
        unit="%"
        hint="Maximum opacity of one stroke."
        onChange={(v) => patch((x) => void (x.opacity = v))}
      />
      <Slider
        label="Flow"
        value={b.flow}
        min={0.001}
        max={1}
        step={0.001}
        displayScale={100}
        decimals={1}
        unit="%"
        hint="Paint per dab; low flow builds up gradually."
        onChange={(v) => patch((x) => void (x.flow = v))}
      />
      <div className="field">
        <span className="field-label">Coverage within a stroke</span>
        <Segmented
          label="Accumulation"
          value={b.stroke.accumulate}
          onChange={(v) => patch((x) => void (x.stroke.accumulate = v))}
          options={[
            { id: 'buildup', label: 'Build up', tip: 'Overlapping dabs add up to the opacity limit' },
            { id: 'max', label: 'Even', tip: 'Overlaps within one stroke never darken (ink, markers)' },
          ]}
        />
      </div>
      <Select
        label="Blend mode"
        value={b.stroke.blendMode}
        options={[
          { id: 'normal', label: 'Normal' },
          { id: 'multiply', label: 'Multiply' },
          { id: 'screen', label: 'Screen' },
          { id: 'overlay', label: 'Overlay' },
          { id: 'add', label: 'Add' },
          { id: 'darken', label: 'Darken' },
          { id: 'lighten', label: 'Lighten' },
          { id: 'color', label: 'Colour' },
          { id: 'luminosity', label: 'Luminosity' },
        ]}
        onChange={(v) => patch((x) => void (x.stroke.blendMode = v))}
      />
      <h4>Dabs</h4>
      <Slider
        label="Spacing"
        value={b.stroke.spacing}
        min={0.01}
        max={2}
        step={0.01}
        displayScale={100}
        unit="%"
        hint="Distance between dabs relative to the diameter."
        onChange={(v) => patch((x) => void (x.stroke.spacing = v))}
      />
      <Slider
        label="Count"
        value={b.count}
        min={1}
        max={16}
        step={1}
        onChange={(v) => patch((x) => void (x.count = Math.round(v)))}
      />
      <Slider
        label="Count jitter"
        value={b.countJitter}
        min={0}
        max={1}
        step={0.01}
        displayScale={100}
        unit="%"
        onChange={(v) => patch((x) => void (x.countJitter = v))}
      />
      <Slider
        label="Scatter"
        value={b.scatter}
        min={0}
        max={4}
        step={0.01}
        displayScale={100}
        unit="%"
        hint="Random offset relative to the diameter."
        onChange={(v) => patch((x) => void (x.scatter = v))}
      />
      <Slider
        label="Rotation jitter"
        value={b.rotationJitter}
        min={0}
        max={180}
        step={1}
        unit="°"
        onChange={(v) => patch((x) => void (x.rotationJitter = v))}
      />
      <h4>Smoothing</h4>
      <Select
        label="Stabiliser"
        value={b.stroke.stabilizer}
        options={[
          { id: 'inherit', label: 'Use global setting' },
          { id: 'off', label: 'Raw input' },
          { id: 'smooth', label: 'Smooth' },
          { id: 'lazy', label: 'Pulled string' },
        ]}
        onChange={(v) => patch((x) => void (x.stroke.stabilizer = v))}
      />
      <Slider
        label="Stabiliser strength"
        value={b.stroke.stabilizerAmount}
        min={0}
        max={1}
        step={0.01}
        displayScale={100}
        unit="%"
        disabled={b.stroke.stabilizer === 'inherit' || b.stroke.stabilizer === 'off'}
        onChange={(v) => patch((x) => void (x.stroke.stabilizerAmount = v))}
      />
      <Toggle
        label="Curved interpolation"
        checked={b.stroke.smoothInterpolation}
        onChange={(v) => patch((x) => void (x.stroke.smoothInterpolation = v))}
        hint="Catmull–Rom curves between input samples instead of straight segments."
      />
      <Slider
        label="Airbrush flow while resting"
        value={b.stroke.airbrushRate}
        min={0}
        max={120}
        step={1}
        unit="/s"
        hint="Keeps adding dabs while the pen rests (0 = off)."
        onChange={(v) => patch((x) => void (x.stroke.airbrushRate = v))}
      />
      <h4>Randomness</h4>
      <Toggle
        label="Same pattern every stroke (fixed seed)"
        checked={b.fixedSeed}
        onChange={(v) => patch((x) => void (x.fixedSeed = v))}
      />
      <Slider
        label="Seed"
        value={b.seed}
        min={1}
        max={9999}
        step={1}
        disabled={!b.fixedSeed}
        onChange={(v) => patch((x) => void (x.seed = Math.round(v)))}
      />
    </div>
  );
}

function DynamicsSection({ b, patch }: { b: BrushPreset; patch: Patch }) {
  const [open, setOpen] = useState<string | null>(b.dynamics[0]?.id ?? null);
  const add = () => {
    const m: DynamicsMapping = {
      id: uid('d'),
      enabled: true,
      input: 'pressure',
      output: 'size',
      amount: 0.5,
      curve: withMinPoints(LINEAR_CURVE),
    };
    patch((x) => void x.dynamics.push(m));
    setOpen(m.id);
  };
  return (
    <div className="lab-grid">
      <p className="muted">
        Each mapping sends an input through its curve to an output. Size, opacity, flow, scatter and texture
        are scaled; angle and colour are shifted. Stroke direction, tilt direction and pen rotation rotate the
        tip directly.
      </p>
      {b.dynamics.length === 0 ? (
        <p className="muted">
          No dynamics: the brush behaves the same regardless of pressure, speed or tilt.
        </p>
      ) : null}
      {b.dynamics.map((m, i) => (
        <div key={m.id} className={`dyn-card ${m.enabled ? '' : 'is-off'}`}>
          <div className="dyn-head">
            <button
              type="button"
              className="mini-btn"
              aria-expanded={open === m.id}
              aria-label={open === m.id ? 'Hide curve' : 'Show curve'}
              onClick={() => setOpen(open === m.id ? null : m.id)}
            >
              <Icon name={open === m.id ? 'chevronDown' : 'chevronRight'} size={14} />
            </button>
            <select
              aria-label="Input"
              value={m.input}
              onChange={(e) =>
                patch((x) => void (x.dynamics[i].input = e.target.value as DynamicsMapping['input']))
              }
            >
              {DYNAMICS_INPUTS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="dyn-arrow" aria-hidden="true">
              →
            </span>
            <select
              aria-label="Output"
              value={m.output}
              onChange={(e) =>
                patch((x) => void (x.dynamics[i].output = e.target.value as DynamicsMapping['output']))
              }
            >
              {DYNAMICS_OUTPUTS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              role="switch"
              aria-checked={m.enabled}
              aria-label="Enabled"
              className={`switch ${m.enabled ? 'is-on' : ''}`}
              onClick={() => patch((x) => void (x.dynamics[i].enabled = !m.enabled))}
            >
              <span className="switch-knob" />
            </button>
            <IconButton
              icon="trash"
              label="Remove mapping"
              size={15}
              onClick={() => patch((x) => void x.dynamics.splice(i, 1))}
            />
          </div>
          <Slider
            label="Amount"
            value={m.amount}
            min={0}
            max={1}
            step={0.01}
            displayScale={100}
            unit="%"
            onChange={(v) => patch((x) => void (x.dynamics[i].amount = v))}
          />
          {open === m.id ? (
            <div className="dyn-curve">
              <CurveEditor
                label={`${m.input} to ${m.output} curve`}
                points={withMinPoints(m.curve)}
                onChange={(pts) => patch((x) => void (x.dynamics[i].curve = pts))}
                size={170}
                xLabel={DYNAMICS_INPUTS.find((d) => d.id === m.input)?.label}
                yLabel={DYNAMICS_OUTPUTS.find((d) => d.id === m.output)?.label}
              />
              <div className="dyn-curve-actions">
                <Button
                  onClick={() => patch((x) => void (x.dynamics[i].curve = withMinPoints(LINEAR_CURVE)))}
                >
                  Linear
                </Button>
                <Button
                  onClick={() =>
                    patch(
                      (x) =>
                        void (x.dynamics[i].curve = withMinPoints([
                          { x: 0, y: 1 },
                          { x: 1, y: 0 },
                        ])),
                    )
                  }
                >
                  Inverted
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ))}
      <Button icon="plus" onClick={add} testId="lab-add-dynamics">
        Add mapping
      </Button>
    </div>
  );
}

function TextureSection({ b, patch }: { b: BrushPreset; patch: Patch }) {
  const t = b.texture;
  const importTexture = async () => {
    const f = await forge.importImage();
    if (!f) return;
    if ('error' in f) return toast('error', 'Could not read the image.', f.error);
    try {
      const img = await decodeImageBytes(f.bytes, f.name);
      const max = 512;
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * k));
      const h = Math.max(1, Math.round(img.height * k));
      const data = k < 1 ? resizeRGBA(img.data, img.width, img.height, w, h) : img.data;
      const grey = new Uint8ClampedArray(w * h);
      for (let i = 0; i < w * h; i++)
        grey[i] = 0.3 * data[i * 4] + 0.59 * data[i * 4 + 1] + 0.11 * data[i * 4 + 2];
      patch((x) => {
        x.texture.enabled = true;
        x.texture.source = 'image';
        x.texture.image = encodeGreyImage(w, h, grey);
      });
    } catch (e) {
      toast('error', 'The image could not be used as a texture.', (e as Error).message);
    }
  };
  return (
    <div className="lab-grid">
      <Toggle
        label="Use texture"
        checked={t.enabled}
        onChange={(v) => patch((x) => void (x.texture.enabled = v))}
        testId="lab-texture-enabled"
      />
      <Select
        label="Grain"
        value={t.source}
        disabled={!t.enabled}
        options={TEXTURE_SOURCES.map((s) => ({
          id: s,
          label: s === 'image' ? 'Imported image' : s[0].toUpperCase() + s.slice(1),
        }))}
        onChange={(v) => {
          if (v === 'image' && !t.image) void importTexture();
          else patch((x) => void (x.texture.source = v));
        }}
      />
      <div className="lab-row">
        <Button icon="import" onClick={() => void importTexture()}>
          Import texture image…
        </Button>
      </div>
      <Slider
        label="Scale"
        value={t.scale}
        min={0.1}
        max={8}
        step={0.05}
        decimals={2}
        unit="×"
        disabled={!t.enabled}
        onChange={(v) => patch((x) => void (x.texture.scale = v))}
      />
      <Slider
        label="Contrast"
        value={t.contrast}
        min={0}
        max={3}
        step={0.05}
        decimals={2}
        disabled={!t.enabled}
        onChange={(v) => patch((x) => void (x.texture.contrast = v))}
      />
      <Slider
        label="Strength"
        value={t.strength}
        min={0}
        max={1}
        step={0.01}
        displayScale={100}
        unit="%"
        disabled={!t.enabled}
        onChange={(v) => patch((x) => void (x.texture.strength = v))}
      />
      <Slider
        label="Movement"
        value={t.movement}
        min={0}
        max={1}
        step={0.01}
        displayScale={100}
        unit="%"
        hint="0 % keeps the grain fixed to the paper; 100 % moves it with every dab."
        disabled={!t.enabled}
        onChange={(v) => patch((x) => void (x.texture.movement = v))}
      />
      <Toggle
        label="Invert grain"
        checked={t.invert}
        disabled={!t.enabled}
        onChange={(v) => patch((x) => void (x.texture.invert = v))}
      />
    </div>
  );
}

function ColourSection({ b, patch }: { b: BrushPreset; patch: Patch }) {
  const [hex, setHex] = useState(rgbToHex(b.fixedColor));
  useEffect(() => setHex(rgbToHex(b.fixedColor)), [b.fixedColor]);
  return (
    <div className="lab-grid">
      <div className="field">
        <span className="field-label">Colour source</span>
        <Segmented
          label="Colour source"
          value={b.colorMode}
          onChange={(v) => patch((x) => void (x.colorMode = v))}
          options={[
            { id: 'current', label: 'Current colour' },
            {
              id: 'fixed',
              label: 'Fixed colour',
              tip: 'Always paints with the colour below (e.g. construction lines)',
            },
          ]}
        />
      </div>
      {b.colorMode === 'fixed' ? (
        <label className="field">
          <span className="field-label">Fixed colour (hex)</span>
          <span className="lab-row">
            <span className="lab-swatch" style={{ background: rgbToHex(b.fixedColor) }} />
            <input
              className="text-input"
              value={hex}
              onChange={(e) => setHex(e.target.value)}
              onBlur={() => {
                const p = parseHex(hex);
                if (p) patch((x) => void (x.fixedColor = { r: p.r, g: p.g, b: p.b }));
                else setHex(rgbToHex(b.fixedColor));
              }}
            />
            <Button onClick={() => patch((x) => void (x.fixedColor = { ...useColors.getState().fg }))}>
              Use current
            </Button>
          </span>
        </label>
      ) : null}
      <h4>Colour jitter</h4>
      <Slider
        label="Hue"
        value={b.colorJitter.hue}
        min={0}
        max={1}
        step={0.005}
        displayScale={360}
        unit="°"
        onChange={(v) => patch((x) => void (x.colorJitter.hue = v))}
      />
      <Slider
        label="Saturation"
        value={b.colorJitter.saturation}
        min={0}
        max={1}
        step={0.01}
        displayScale={100}
        unit="%"
        onChange={(v) => patch((x) => void (x.colorJitter.saturation = v))}
      />
      <Slider
        label="Luminance"
        value={b.colorJitter.luminance}
        min={0}
        max={1}
        step={0.01}
        displayScale={100}
        unit="%"
        onChange={(v) => patch((x) => void (x.colorJitter.luminance = v))}
      />
      <Toggle
        label="Once per stroke (instead of per dab)"
        checked={b.colorJitter.perStroke}
        onChange={(v) => patch((x) => void (x.colorJitter.perStroke = v))}
      />
      <p className="muted">
        Hue, saturation and luminance can also follow pressure, speed or tilt in the Dynamics section.
      </p>
    </div>
  );
}

function MixingSection({ b, patch }: { b: BrushPreset; patch: Patch }) {
  const m = b.mixing;
  const direct = b.engine === 'smudge' || b.engine === 'blender' || m.mode !== 'none';
  return (
    <div className="lab-grid">
      <div className="field">
        <span className="field-label">Mixing</span>
        <Segmented
          label="Mixing mode"
          value={m.mode}
          onChange={(v) => patch((x) => void (x.mixing.mode = v))}
          options={[
            { id: 'none', label: 'None', tip: 'Paint lays on top' },
            {
              id: 'smudge',
              label: 'Smudge / wet',
              tip: 'Carries colour along the stroke and mixes with the canvas',
            },
            { id: 'blend', label: 'Blend', tip: 'Averages the colours under the tip' },
          ]}
        />
      </div>
      <Slider
        label="Strength"
        value={m.strength}
        min={0}
        max={1}
        step={0.01}
        displayScale={100}
        unit="%"
        disabled={!direct}
        onChange={(v) => patch((x) => void (x.mixing.strength = v))}
      />
      <Slider
        label="Pick-up"
        value={m.pickup}
        min={0}
        max={1}
        step={0.01}
        displayScale={100}
        unit="%"
        hint="How much canvas colour is picked up per dab."
        disabled={!direct}
        onChange={(v) => patch((x) => void (x.mixing.pickup = v))}
      />
      <Slider
        label="Persistence"
        value={m.persistence}
        min={0}
        max={1}
        step={0.01}
        displayScale={100}
        unit="%"
        hint="How long the effect lasts along the stroke."
        disabled={!direct}
        onChange={(v) => patch((x) => void (x.mixing.persistence = v))}
      />
      <Slider
        label="Fresh paint"
        value={m.dilution}
        min={0}
        max={1}
        step={0.01}
        displayScale={100}
        unit="%"
        hint="How much of the brush colour is mixed in (0 % = pure smudge)."
        disabled={!direct}
        onChange={(v) => patch((x) => void (x.mixing.dilution = v))}
      />
      <p className="muted">Mixing brushes paint directly into the layer and sample only the active layer.</p>
    </div>
  );
}

// ------------------------------------------------------------------------------- dialog

export function BrushLab() {
  const close = useUi((s) => s.closeDialog);
  const props = useUi((s) => s.dialog?.props) ?? {};
  const store = useBrushes.getState();
  const color = useColors((s) => s.fg);
  const initial = useMemo(() => {
    if (props.create) {
      const now = new Date().toISOString();
      return createBrush({
        id: uid('u.'),
        name: 'New brush',
        category: 'Custom',
        author: 'Me',
        created: now,
        modified: now,
        factory: false,
      });
    }
    const src = store.get(String(props.id ?? store.activeBrushId)) ?? store.brushes[0];
    return cloneBrush(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const isNew = !store.get(initial.id);
  const [draft, setDraft] = useState<BrushPreset>(initial);
  const [saved, setSaved] = useState<string>(JSON.stringify(initial));
  const [section, setSection] = useState<SectionId>('tip');
  const dirty = JSON.stringify(draft) !== saved || isNew;
  const patch: Patch = (fn) =>
    setDraft((d) => {
      const c = cloneBrush(d);
      fn(c);
      return c;
    });

  const save = () => {
    const b = { ...draft, modified: new Date().toISOString() };
    if (store.get(b.id)) store.replace(b);
    else store.add(b);
    store.setActive(b.id);
    setSaved(JSON.stringify(b));
    setDraft(b);
    toast('success', `Saved ${b.name}`);
  };
  const saveAsNew = () => {
    const now = new Date().toISOString();
    const b = {
      ...cloneBrush(draft),
      id: uid('u.'),
      name: draft.name.endsWith(' copy') ? draft.name : `${draft.name} copy`,
      factory: false,
      created: now,
      modified: now,
    };
    store.add(b, draft.id);
    store.setActive(b.id);
    setDraft(b);
    setSaved(JSON.stringify(b));
    toast('success', `Saved new brush ${b.name}`);
  };
  const reset = async () => {
    const factory = factoryVersionOf(draft.id);
    const stored = store.get(draft.id);
    if (factory && stored && JSON.stringify(stored) !== JSON.stringify(factory)) {
      const r = await confirmDialog({
        title: 'Reset brush',
        message: 'Revert to the last saved version, or restore the original factory settings?',
        buttons: [
          { id: 'saved', label: 'Last saved', kind: 'primary' },
          { id: 'factory', label: 'Factory settings' },
          { id: 'cancel', label: 'Cancel' },
        ],
        cancelId: 'cancel',
      });
      if (r === 'factory') {
        setDraft(cloneBrush(factory));
        return;
      }
      if (r === 'cancel') return;
    }
    setDraft(JSON.parse(saved) as BrushPreset);
  };
  const requestClose = async () => {
    if (dirty) {
      const r = await confirmDialog({
        title: 'Unsaved brush changes',
        message: `Save the changes to "${draft.name}"?`,
        buttons: [
          { id: 'save', label: 'Save', kind: 'primary' },
          { id: 'discard', label: 'Discard', kind: 'danger' },
          { id: 'cancel', label: 'Cancel' },
        ],
        cancelId: 'cancel',
      });
      if (r === 'cancel') return;
      if (r === 'save') save();
    }
    close();
  };

  return (
    <Modal
      title="Brush Lab"
      onClose={() => void requestClose()}
      width={1080}
      className="brush-lab"
      testId="brush-lab"
      footer={
        <>
          <Button onClick={() => void requestClose()}>Close</Button>
        </>
      }
    >
      <div className="lab-header">
        <LiveStamp brush={draft} />
        <div className="lab-title">
          <input
            className="lab-name"
            value={draft.name}
            aria-label="Brush name"
            onChange={(e) => patch((x) => void (x.name = e.target.value.slice(0, 80)))}
            data-testid="lab-name"
          />
          <div className="lab-meta">
            <select
              aria-label="Category"
              value={draft.category}
              onChange={(e) => patch((x) => void (x.category = e.target.value as BrushPreset['category']))}
            >
              {BRUSH_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              aria-label="Engine"
              value={draft.engine}
              onChange={(e) => patch((x) => void (x.engine = e.target.value as BrushPreset['engine']))}
              data-testid="lab-engine"
            >
              {BRUSH_ENGINES.map((en) => (
                <option key={en.id} value={en.id} title={en.hint}>
                  {en.label}
                </option>
              ))}
            </select>
            <span className={`lab-dirty ${dirty ? 'is-dirty' : ''}`}>
              {dirty ? (isNew ? 'New — not saved' : 'Modified') : 'Saved'}
            </span>
            {draft.factory ? <span className="muted">Factory brush</span> : null}
          </div>
        </div>
        <div className="lab-actions">
          <Button icon="duplicate" onClick={saveAsNew} title="Save these settings as a new brush">
            Save as new
          </Button>
          <Button icon="reset" onClick={() => void reset()} disabled={!dirty || isNew}>
            Reset
          </Button>
          <Button kind="primary" icon="save" onClick={save} disabled={!dirty} testId="lab-save">
            Save
          </Button>
        </div>
      </div>
      <div className="lab-body">
        <nav className="lab-nav" role="tablist" aria-label="Brush settings sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={section === s.id}
              className={section === s.id ? 'is-on' : ''}
              onClick={() => setSection(s.id)}
              data-testid={`lab-tab-${s.id}`}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="lab-section" role="tabpanel">
          {section === 'tip' ? <TipSection b={draft} patch={patch} /> : null}
          {section === 'stroke' ? <StrokeSection b={draft} patch={patch} /> : null}
          {section === 'dynamics' ? <DynamicsSection b={draft} patch={patch} /> : null}
          {section === 'texture' ? <TextureSection b={draft} patch={patch} /> : null}
          {section === 'colour' ? <ColourSection b={draft} patch={patch} /> : null}
          {section === 'mixing' ? <MixingSection b={draft} patch={patch} /> : null}
        </div>
        <div className="lab-preview">
          <h4>Preview</h4>
          <TestArea brush={draft} color={color} />
        </div>
      </div>
    </Modal>
  );
}
