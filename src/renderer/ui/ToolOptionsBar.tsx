// Contextual options for the active tool, shown as a slim strip over the top of the canvas.
import { useEffect, useState } from 'react';
import { useUi } from '../state/ui';
import { useToolOptions, FONT_CHOICES } from '../state/tool-options';
import { useBrushes } from '../state/brushes';
import { usePrefs } from '../state/preferences';
import { useActiveSession, useDocs, type SymmetryMode } from '../state/documents';
import { Icon, type IconName } from './icons';
import { runCommand, tooltipFor } from '../app/commands';
import {
  cancelTransform,
  commitTransform,
  flipTransform,
  rotateTransform,
  setTransformNumeric,
  useTransformState,
} from '../tools/transform-tool';
import { useCropState, type CropTool } from '../tools/paint-tools';
import { getTool } from '../tools/registry';
import { canvasController } from './CanvasView';
import { activeSession } from '../state/documents';
import { commitText, cancelText, useTextEdit } from '../tools/text-tool';
import { requestRedraw } from '../app/actions';
import { setSymmetry } from '../app/extended';

function Mini(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  scale?: number;
  unit?: string;
  onChange: (v: number) => void;
  width?: number;
}) {
  const scale = props.scale ?? 1;
  const [text, setText] = useState(String(Math.round(props.value * scale * 10) / 10));
  useEffect(() => setText(String(Math.round(props.value * scale * 10) / 10)), [props.value, scale]);
  return (
    <label className="tob-mini">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? (props.max - props.min) / 100}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        style={{ width: props.width ?? 90 }}
        aria-label={props.label}
      />
      <input
        className="tob-num"
        value={text}
        aria-label={`${props.label} value`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        onBlur={() => {
          const n = Number(text.replace(',', '.'));
          if (Number.isFinite(n)) props.onChange(Math.min(props.max, Math.max(props.min, n / scale)));
          else setText(String(props.value * scale));
        }}
      />
      {props.unit ? <span className="tob-unit">{props.unit}</span> : null}
    </label>
  );
}

function Check(props: { label: string; checked: boolean; onChange: (v: boolean) => void; tip?: string }) {
  return (
    <label className="tob-check" data-tip={props.tip}>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span>{props.label}</span>
    </label>
  );
}

function Seg<T extends string>(props: {
  value: T;
  options: { id: T; label: string; icon?: IconName; tip?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="tob-seg" role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={props.value === o.id}
          className={props.value === o.id ? 'is-on' : ''}
          onClick={() => props.onChange(o.id)}
          data-tip={o.tip ?? o.label}
          aria-label={o.label}
        >
          {o.icon ? <Icon name={o.icon} size={15} /> : o.label}
        </button>
      ))}
    </div>
  );
}

function Btn(props: {
  label: string;
  onClick: () => void;
  icon?: IconName;
  primary?: boolean;
  tip?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className={`tob-btn ${props.primary ? 'is-primary' : ''}`}
      onClick={props.onClick}
      data-tip={props.tip}
      aria-label={props.label}
      data-testid={props.testId}
    >
      {props.icon ? <Icon name={props.icon} size={15} /> : null}
      {props.icon && !props.primary ? null : <span>{props.label}</span>}
    </button>
  );
}

const Sep = () => <span className="tob-sep" aria-hidden="true" />;

function BrushOptions() {
  const tool = useUi((s) => s.tool);
  const brushes = useBrushes((s) => s.brushes);
  const id = useBrushes((s) => (tool === 'eraser' ? s.activeEraserId : s.activeBrushId));
  const b = brushes.find((x) => x.id === id);
  const prefs = usePrefs((s) => s.prefs);
  const up = usePrefs((s) => s.update);
  if (!b) return null;
  const store = useBrushes.getState();
  return (
    <>
      <button
        type="button"
        className="tob-btn"
        onClick={() => runCommand('brush.lab')}
        data-tip={tooltipFor('brush.lab')}
      >
        <Icon name="brush" size={15} />
        <span>{b.name}</span>
      </button>
      <Mini
        label="Size"
        value={b.diameter}
        min={0.5}
        max={500}
        step={0.5}
        unit="px"
        onChange={(v) => store.update(b.id, (x) => void (x.diameter = v))}
      />
      <Mini
        label="Opacity"
        value={b.opacity}
        min={0.01}
        max={1}
        step={0.01}
        scale={100}
        unit="%"
        onChange={(v) => store.update(b.id, (x) => void (x.opacity = v))}
      />
      <Sep />
      <Seg
        label="Stabiliser"
        value={prefs.stabilizer.mode}
        onChange={(v) => up((x) => void (x.stabilizer.mode = v))}
        options={[
          { id: 'off', label: 'Raw' },
          { id: 'smooth', label: 'Smooth' },
          { id: 'lazy', label: 'String' },
        ]}
      />
      {prefs.stabilizer.mode !== 'off' ? (
        <Mini
          label=""
          value={prefs.stabilizer.amount}
          min={0}
          max={1}
          step={0.01}
          scale={100}
          unit="%"
          width={60}
          onChange={(v) => up((x) => void (x.stabilizer.amount = v))}
        />
      ) : null}
      <Check
        label="Predictive"
        checked={prefs.predictive.enabled}
        onChange={(v) => up((x) => void (x.predictive.enabled = v))}
        tip={tooltipFor('mode.predictive')}
      />
    </>
  );
}

function SelectOptions({ wand }: { wand: boolean }) {
  const o = useToolOptions((s) => s.opts);
  const set = useToolOptions((s) => s.set);
  const tool = useUi((s) => s.tool);
  return (
    <>
      <Seg
        label="Selection mode"
        value={o.select.combine}
        onChange={(v) => set('select', { combine: v })}
        options={[
          { id: 'replace', label: 'New', tip: 'New selection' },
          { id: 'add', label: 'Add', tip: 'Add (or hold Shift)' },
          { id: 'subtract', label: 'Subtract', tip: 'Subtract (or hold Alt)' },
          { id: 'intersect', label: 'Intersect', tip: 'Intersect (or hold Shift+Alt)' },
        ]}
      />
      {wand ? (
        <>
          <Mini
            label="Tolerance"
            value={o.wand.tolerance}
            min={0}
            max={1}
            step={0.01}
            scale={100}
            unit="%"
            onChange={(v) => set('wand', { tolerance: v })}
          />
          <Check
            label="Contiguous"
            checked={o.wand.contiguous}
            onChange={(v) => set('wand', { contiguous: v })}
          />
          <Check
            label="All layers"
            checked={o.wand.sampleAll}
            onChange={(v) => set('wand', { sampleAll: v })}
          />
        </>
      ) : (
        <>
          <Mini
            label="Feather"
            value={o.select.feather}
            min={0}
            max={100}
            step={0.5}
            unit="px"
            onChange={(v) => set('select', { feather: v })}
          />
          <Check
            label="Anti-alias"
            checked={o.select.antialias}
            onChange={(v) => set('select', { antialias: v })}
          />
          {tool === 'select-rect' || tool === 'select-ellipse' ? (
            <Check
              label="From centre"
              checked={o.select.fromCenter}
              onChange={(v) => set('select', { fromCenter: v })}
            />
          ) : null}
        </>
      )}
      <Sep />
      <Btn
        label="Select all"
        icon="selectAll"
        tip={tooltipFor('select.all')}
        onClick={() => runCommand('select.all')}
      />
      <Btn
        label="Deselect"
        icon="deselect"
        tip={tooltipFor('select.none')}
        onClick={() => runCommand('select.none')}
      />
      <Btn
        label="Invert"
        icon="invert"
        tip={tooltipFor('select.invert')}
        onClick={() => runCommand('select.invert')}
      />
    </>
  );
}

function TransformOptions() {
  const st = useTransformState();
  const [v, setV] = useState({ x: '', y: '', w: '', h: '', a: '' });
  useEffect(() => {
    setV({
      x: st.cx.toFixed(1),
      y: st.cy.toFixed(1),
      w: st.w.toFixed(1),
      h: st.h.toFixed(1),
      a: st.angle.toFixed(1),
    });
  }, [st.rev, st.cx, st.cy, st.w, st.h, st.angle]);
  if (!st.active) {
    return (
      <span className="tob-hint">
        Drag on the canvas to move the {activeSession()?.doc.selection ? 'selection' : 'active layer'}, or
        press Ctrl+T.
      </span>
    );
  }
  const field = (k: keyof typeof v, label: string, apply: (n: number) => void) => (
    <label className="tob-field">
      <span>{label}</span>
      <input
        value={v[k]}
        aria-label={label}
        onChange={(e) => setV({ ...v, [k]: e.target.value })}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        onBlur={() => {
          const n = Number(v[k].replace(',', '.'));
          if (Number.isFinite(n)) {
            apply(n);
            requestRedraw();
          }
        }}
        data-testid={`transform-${k}`}
      />
    </label>
  );
  return (
    <>
      {field('x', 'X', (n) => setTransformNumeric({ cx: n }))}
      {field('y', 'Y', (n) => setTransformNumeric({ cy: n }))}
      {field('w', 'W', (n) => setTransformNumeric({ w: n }))}
      {field('h', 'H', (n) => setTransformNumeric({ h: n }))}
      {field('a', '∠', (n) => setTransformNumeric({ angle: n }))}
      <Btn
        label="Flip horizontally"
        icon="flipH"
        tip="Flip horizontally"
        onClick={() => (flipTransform('h'), requestRedraw())}
      />
      <Btn
        label="Flip vertically"
        icon="flipV"
        tip="Flip vertically"
        onClick={() => (flipTransform('v'), requestRedraw())}
      />
      <Btn
        label="Rotate 90° left"
        icon="rotateLeft"
        tip="Rotate 90° counter-clockwise"
        onClick={() => (rotateTransform(-90), requestRedraw())}
      />
      <Btn
        label="Rotate 90° right"
        icon="rotateRight"
        tip="Rotate 90° clockwise"
        onClick={() => (rotateTransform(90), requestRedraw())}
      />
      {st.free ? (
        <span className="tob-hint">Perspective</span>
      ) : (
        <span className="tob-hint">Shift: keep ratio · Alt: from centre · Ctrl+corner: distort</span>
      )}
      <Sep />
      <Btn
        label="Cancel"
        tip="Cancel (Esc)"
        onClick={() => (cancelTransform(), requestRedraw())}
        testId="transform-cancel"
      />
      <Btn
        label="Apply"
        primary
        tip="Apply (Enter)"
        onClick={() => (commitTransform(), requestRedraw())}
        testId="transform-apply"
      />
    </>
  );
}

function CropOptions() {
  const o = useToolOptions((s) => s.opts.crop);
  const set = useToolOptions((s) => s.set);
  const rect = useCropState((s) => s.rect);
  const crop = getTool('crop') as CropTool;
  const ctx = () => {
    const s = activeSession();
    return s && canvasController ? canvasController.ctx(s) : null;
  };
  return (
    <>
      <Seg
        label="Aspect ratio"
        value={o.ratio}
        onChange={(v) => set('crop', { ratio: v })}
        options={[
          { id: 'free', label: 'Free' },
          { id: 'square', label: '1:1' },
          { id: 'document', label: 'Original' },
        ]}
      />
      <span className="tob-hint">
        {rect ? `${rect.w} × ${rect.h} px at ${rect.x}, ${rect.y}` : 'Drag to choose the area to keep.'}
      </span>
      <Sep />
      <Btn
        label="Reset"
        onClick={() => {
          const c = ctx();
          if (c) crop.reset(c);
        }}
      />
      <Btn
        label="Crop"
        primary
        tip="Crop (Enter)"
        onClick={() => {
          const c = ctx();
          if (c) crop.apply(c);
        }}
        testId="crop-apply"
      />
    </>
  );
}

function TextOptions() {
  const o = useToolOptions((s) => s.opts.text);
  const set = useToolOptions((s) => s.set);
  const editing = useTextEdit((s) => s.active);
  return (
    <>
      <select
        className="tob-select"
        value={o.font}
        aria-label="Font"
        onChange={(e) => set('text', { font: e.target.value })}
      >
        {FONT_CHOICES.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <Mini
        label="Size"
        value={o.size}
        min={4}
        max={600}
        step={1}
        unit="px"
        onChange={(v) => set('text', { size: Math.round(v) })}
      />
      <Check label="Bold" checked={o.bold} onChange={(v) => set('text', { bold: v })} />
      <Check label="Italic" checked={o.italic} onChange={(v) => set('text', { italic: v })} />
      <Seg
        label="Alignment"
        value={o.align}
        onChange={(v) => set('text', { align: v })}
        options={[
          { id: 'left', label: 'Left' },
          { id: 'center', label: 'Centre' },
          { id: 'right', label: 'Right' },
        ]}
      />
      {editing ? (
        <>
          <Sep />
          <Btn label="Cancel" onClick={cancelText} tip="Cancel (Esc)" />
          <Btn
            label="Place text"
            primary
            onClick={commitText}
            tip="Rasterise into a new layer (Ctrl+Enter)"
            testId="text-commit"
          />
        </>
      ) : (
        <span className="tob-hint">Click on the canvas to type.</span>
      )}
    </>
  );
}

function SymmetryOptions() {
  const s = useActiveSession();
  if (!s || s.assist.symmetry.mode === 'off') return null;
  const sym = s.assist.symmetry;
  return (
    <>
      <Sep />
      <Icon name="symmetry" size={15} />
      <select
        className="tob-select"
        value={sym.mode}
        aria-label="Symmetry mode"
        onChange={(e) => {
          setSymmetry(e.target.value as SymmetryMode);
          requestRedraw();
        }}
      >
        <option value="vertical">Vertical</option>
        <option value="horizontal">Horizontal</option>
        <option value="both">Four-way</option>
        <option value="radial">Radial</option>
        <option value="kaleido">Kaleidoscope</option>
        <option value="off">Off</option>
      </select>
      {sym.mode === 'radial' || sym.mode === 'kaleido' ? (
        <Mini
          label="Segments"
          value={sym.segments}
          min={2}
          max={24}
          step={1}
          width={70}
          onChange={(v) => setSymmetry(sym.mode, Math.round(v))}
        />
      ) : null}
      <Btn
        label="Centre"
        tip="Move the symmetry centre to the canvas centre (or drag its handle)"
        onClick={() => {
          sym.cx = s.doc.width / 2;
          sym.cy = s.doc.height / 2;
          requestRedraw();
          useDocs.getState().bump();
        }}
      />
    </>
  );
}

function GuideOptions() {
  const s = useActiveSession();
  if (!s) return null;
  const a = s.assist;
  const any = a.ruler.enabled || a.ellipse.enabled || a.perspective.enabled || a.grid.visible;
  if (!any) return null;
  return (
    <>
      <Sep />
      {a.perspective.enabled ? (
        <select
          className="tob-select"
          value={a.perspective.mode}
          aria-label="Perspective points"
          onChange={(e) => {
            a.perspective.mode = Number(e.target.value) as 1 | 2 | 3;
            requestRedraw();
            useDocs.getState().bump();
          }}
        >
          <option value={1}>1-point</option>
          <option value={2}>2-point</option>
          <option value={3}>3-point</option>
        </select>
      ) : null}
      {a.grid.visible ? (
        <>
          <Mini
            label="Grid"
            value={a.grid.size}
            min={4}
            max={512}
            step={1}
            unit="px"
            width={70}
            onChange={(v) => {
              a.grid.size = Math.round(v);
              requestRedraw();
              useDocs.getState().bump();
            }}
          />
          <Check
            label="Snap shapes"
            checked={a.grid.snap}
            onChange={(v) => ((a.grid.snap = v), useDocs.getState().bump())}
          />
        </>
      ) : null}
      <span className="tob-hint">Drag guide handles on the canvas to adjust them.</span>
    </>
  );
}

export function ToolOptionsBar() {
  const tool = useUi((s) => s.tool);
  const session = useActiveSession();
  useDocs((s) => s.rev);
  const o = useToolOptions((s) => s.opts);
  const set = useToolOptions((s) => s.set);
  if (!session) return null;
  let content: React.ReactNode = null;
  switch (tool) {
    case 'brush':
    case 'eraser':
      content = <BrushOptions />;
      break;
    case 'select-rect':
    case 'select-ellipse':
    case 'select-lasso':
    case 'select-polygon':
      content = <SelectOptions wand={false} />;
      break;
    case 'select-wand':
      content = <SelectOptions wand />;
      break;
    case 'fill':
      content = (
        <>
          <Mini
            label="Tolerance"
            value={o.fill.tolerance}
            min={0}
            max={1}
            step={0.01}
            scale={100}
            unit="%"
            onChange={(v) => set('fill', { tolerance: v })}
          />
          <Mini
            label="Expand"
            value={o.fill.grow}
            min={0}
            max={8}
            step={1}
            unit="px"
            width={60}
            onChange={(v) => set('fill', { grow: Math.round(v) })}
          />
          <Mini
            label="Opacity"
            value={o.fill.opacity}
            min={0.01}
            max={1}
            step={0.01}
            scale={100}
            unit="%"
            onChange={(v) => set('fill', { opacity: v })}
          />
          <Check
            label="Contiguous"
            checked={o.fill.contiguous}
            onChange={(v) => set('fill', { contiguous: v })}
          />
          <Check
            label="Sample all layers"
            checked={o.fill.sampleAll}
            onChange={(v) => set('fill', { sampleAll: v })}
          />
        </>
      );
      break;
    case 'gradient':
      content = (
        <>
          <Seg
            label="Gradient type"
            value={o.gradient.kind}
            onChange={(v) => set('gradient', { kind: v })}
            options={[
              { id: 'linear', label: 'Linear' },
              { id: 'radial', label: 'Radial' },
            ]}
          />
          <Seg
            label="Gradient colours"
            value={o.gradient.toTransparent ? 'fade' : 'fgbg'}
            onChange={(v) => set('gradient', { toTransparent: v === 'fade' })}
            options={[
              { id: 'fgbg', label: 'Foreground → background' },
              { id: 'fade', label: 'Foreground → transparent' },
            ]}
          />
          <Mini
            label="Opacity"
            value={o.gradient.opacity}
            min={0.01}
            max={1}
            step={0.01}
            scale={100}
            unit="%"
            onChange={(v) => set('gradient', { opacity: v })}
          />
        </>
      );
      break;
    case 'line':
    case 'rect':
    case 'ellipse':
    case 'polygon':
    case 'polyline':
      content = (
        <>
          {tool !== 'line' && tool !== 'polyline' ? (
            <Seg
              label="Shape mode"
              value={o.shape.mode}
              onChange={(v) => set('shape', { mode: v })}
              options={[
                { id: 'stroke', label: 'Stroke' },
                { id: 'fill', label: 'Fill' },
                { id: 'both', label: 'Both' },
              ]}
            />
          ) : null}
          {tool === 'polygon' ? (
            <Mini
              label="Sides"
              value={o.shape.sides}
              min={3}
              max={24}
              step={1}
              width={70}
              onChange={(v) => set('shape', { sides: Math.round(v) })}
            />
          ) : null}
          {tool === 'rect' || tool === 'ellipse' ? (
            <Check
              label="From centre"
              checked={o.shape.fromCenter}
              onChange={(v) => set('shape', { fromCenter: v })}
            />
          ) : null}
          <span className="tob-hint">Strokes use the active brush.</span>
        </>
      );
      break;
    case 'text':
      content = <TextOptions />;
      break;
    case 'transform':
      content = <TransformOptions />;
      break;
    case 'crop':
      content = <CropOptions />;
      break;
    case 'eyedropper':
      content = (
        <span className="tob-hint">
          Click to pick the visible colour; hold Ctrl to sample the active layer only.
        </span>
      );
      break;
    case 'pan':
    case 'zoom':
    case 'rotate':
      content = (
        <>
          <Btn label="Fit" icon="fit" tip={tooltipFor('view.fit')} onClick={() => runCommand('view.fit')} />
          <Btn
            label="100 %"
            icon="actual"
            tip={tooltipFor('view.actual')}
            onClick={() => runCommand('view.actual')}
          />
          <Btn
            label="Reset rotation"
            icon="rotateReset"
            tip={tooltipFor('view.resetRotation')}
            onClick={() => runCommand('view.resetRotation')}
          />
        </>
      );
      break;
  }
  return (
    <div className="tool-options" role="toolbar" aria-label="Tool options" data-testid="tool-options">
      {content}
      <SymmetryOptions />
      <GuideOptions />
    </div>
  );
}
