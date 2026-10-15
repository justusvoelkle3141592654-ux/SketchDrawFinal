// Preferences: general, workspace, input & tablet (pressure curve, mappings, diagnostics), strokes, Orbit, shortcuts, files.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../Overlays';
import { Button, Segmented, Select, Slider, Toggle } from '../controls/controls';
import { CurveEditor, withMinPoints } from '../controls/CurveEditor';
import { useUi } from '../../state/ui';
import {
  BUTTON_ACTIONS,
  DEFAULT_ORBIT_SLOTS,
  DEFAULT_PREFERENCES,
  usePrefs,
  type ButtonAction,
} from '../../state/preferences';
import { useInput } from '../../state/input';
import { CURVE_PRESETS, makeCurve } from '../../engine/curve';
import { allCommands, getCommand, shortcutsFor } from '../../app/commands';
import { eventToShortcut, normalizeShortcut } from '../../app/shortcuts';
import { normalizePointer } from '../../input/normalize';
import { renderBrushPreview } from '../brush-preview';
import { createBrush } from '../../engine/brush/schema';
import type { StrokeSample } from '../../engine/stroke/pipeline';
import { forge } from '../../platform';
import { toast } from '../../state/ui';

type Page = 'general' | 'input' | 'strokes' | 'orbit' | 'shortcuts' | 'files';
const PAGES: { id: Page; label: string }[] = [
  { id: 'general', label: 'General & workspace' },
  { id: 'input', label: 'Input & Tablet' },
  { id: 'strokes', label: 'Strokes' },
  { id: 'orbit', label: 'Orbit' },
  { id: 'shortcuts', label: 'Keyboard shortcuts' },
  { id: 'files', label: 'Files & memory' },
];

export function PreferencesDialog() {
  const close = useUi((s) => s.closeDialog);
  const props = useUi((s) => s.dialog?.props);
  const [page, setPage] = useState<Page>((props?.page as Page) ?? 'general');
  return (
    <Modal
      title="Preferences"
      onClose={close}
      width={860}
      className="prefs-modal"
      testId="prefs-dialog"
      footer={
        <Button kind="primary" onClick={close}>
          Done
        </Button>
      }
    >
      <div className="prefs">
        <nav className="prefs-nav" role="tablist" aria-orientation="vertical" aria-label="Preference pages">
          {PAGES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={page === p.id}
              className={page === p.id ? 'is-on' : ''}
              onClick={() => setPage(p.id)}
              data-testid={`prefs-tab-${p.id}`}
            >
              {p.label}
            </button>
          ))}
        </nav>
        <div className="prefs-page" role="tabpanel">
          {page === 'general' ? <GeneralPage /> : null}
          {page === 'input' ? <InputPage /> : null}
          {page === 'strokes' ? <StrokesPage /> : null}
          {page === 'orbit' ? <OrbitPage /> : null}
          {page === 'shortcuts' ? <ShortcutsPage /> : null}
          {page === 'files' ? <FilesPage /> : null}
        </div>
      </div>
    </Modal>
  );
}

function GeneralPage() {
  const p = usePrefs((s) => s.prefs);
  const up = usePrefs((s) => s.update);
  return (
    <div className="form-grid">
      <h3>Appearance</h3>
      <div className="field">
        <span className="field-label">Theme</span>
        <Segmented
          label="Theme"
          value={p.theme}
          onChange={(v) => up((x) => void (x.theme = v))}
          options={[
            { id: 'dark', label: 'Graphite (dark)' },
            { id: 'light', label: 'Light' },
          ]}
        />
      </div>
      <div className="field">
        <span className="field-label">Density</span>
        <Segmented
          label="Density"
          value={p.density}
          onChange={(v) => up((x) => void (x.density = v))}
          options={[
            { id: 'compact', label: 'Compact', tip: 'Precise pen and mouse work' },
            { id: 'roomy', label: 'Roomy (touch)', tip: 'Larger touch targets for tablets' },
          ]}
        />
      </div>
      <h3>Workspace</h3>
      <Toggle
        label="Left-handed layout"
        checked={p.leftHanded}
        onChange={(v) => up((x) => void (x.leftHanded = v))}
        hint="Moves the tool rail and Orbit to the right and panels to the left. Text and shortcuts are unchanged."
        testId="pref-lefthanded"
      />
      <Toggle
        label="Hide panels while drawing"
        checked={p.autoHidePanels}
        onChange={(v) => up((x) => void (x.autoHidePanels = v))}
        hint="Panels fade out during a stroke and return when you lift the pen."
      />
      <Toggle
        label="Show brush outline cursor"
        checked={p.showBrushOutline}
        onChange={(v) => up((x) => void (x.showBrushOutline = v))}
      />
      <Toggle
        label="Pixel grid at 800 % and above"
        checked={p.pixelGrid}
        onChange={(v) => up((x) => void (x.pixelGrid = v))}
      />
      <Toggle
        label="Confirm before deleting layers"
        checked={p.confirmOnLayerDelete}
        onChange={(v) => up((x) => void (x.confirmOnLayerDelete = v))}
      />
      <div className="field-actions">
        <Button onClick={() => useUi.getState().resetLayout()}>Reset panel layout</Button>
        <Button
          kind="danger"
          onClick={() => {
            usePrefs.getState().reset();
            toast('success', 'Preferences were reset to their defaults.');
          }}
        >
          Reset all preferences
        </Button>
      </div>
    </div>
  );
}

function rampPath(w: number, h: number, curve: (x: number) => number, deadZone: number): StrokeSample[] {
  const out: StrokeSample[] = [];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    const raw = t;
    const p = raw <= deadZone ? 0 : curve((raw - deadZone) / (1 - deadZone));
    out.push({
      x: 10 + t * (w - 20),
      y: h / 2 + Math.sin(t * Math.PI * 2) * h * 0.18,
      pressure: p,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      time: i * 6,
    });
  }
  return out;
}

function CurvePreview({ points, deadZone }: { points: { x: number; y: number }[]; deadZone: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = usePrefs((s) => s.prefs.theme);
  useEffect(() => {
    const c = ref.current!;
    const w = 300;
    const h = 70;
    c.width = w;
    c.height = h;
    const f = makeCurve(points);
    const brush = createBrush({
      id: 'preview.curve',
      name: 'curve',
      tip: { shape: 'round', hardness: 0.9, aspect: 1, angle: 0, antialias: true },
      diameter: 22,
      minDiameter: 0.05,
      dynamics: [
        {
          id: 'a',
          enabled: true,
          input: 'pressure',
          output: 'size',
          amount: 1,
          curve: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        },
        {
          id: 'b',
          enabled: true,
          input: 'pressure',
          output: 'opacity',
          amount: 0.6,
          curve: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        },
      ],
      stroke: {
        spacing: 0.05,
        accumulate: 'max',
        blendMode: 'normal',
        stabilizer: 'off',
        stabilizerAmount: 0,
        airbrushRate: 0,
        smoothInterpolation: true,
      },
    });
    const img = renderBrushPreview(
      brush,
      {
        width: w,
        height: h,
        color: theme === 'dark' ? { r: 0.9, g: 0.92, b: 0.95 } : { r: 0.1, g: 0.1, b: 0.12 },
        background: 'transparent',
        path: rampPath(w, h, f, deadZone),
      },
      false,
    );
    c.getContext('2d')!.putImageData(img, 0, 0);
  }, [points, deadZone, theme]);
  return (
    <canvas ref={ref} className="curve-preview" aria-label="Preview stroke from light to firm pressure" />
  );
}

function TestPad() {
  const report = useInput((s) => s.report);
  return (
    <div
      className="test-pad"
      aria-label="Pen test area: draw here to see live values"
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)}
      onPointerMove={(e) => {
        const ev = e.nativeEvent;
        const list = ev.getCoalescedEvents?.() ?? [ev];
        report(normalizePointer(ev, usePrefs.getState().prefs.input, ev.buttons !== 0), ev, list.length || 1);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      Draw or hover here
    </div>
  );
}

function Diagnostics() {
  const diag = useInput((s) => s.diag);
  const setListening = useInput((s) => s.setListening);
  useEffect(() => {
    setListening(1);
    return () => setListening(-1);
  }, [setListening]);
  const row = (k: string, v: string) => (
    <div className="diag-row" key={k}>
      <span>{k}</span>
      <span className="mono">{v}</span>
    </div>
  );
  const f = (n: number, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');
  return (
    <div className="diagnostics" aria-live="off" data-testid="diagnostics">
      {diag ? (
        <>
          {row('Pointer type', diag.type)}
          {row('Raw pressure', diag.rawPressure < 0 ? 'not reported' : f(diag.rawPressure))}
          {row('Normalised pressure', f(diag.pressure))}
          {row('Tilt X / Y', `${f(diag.tiltX, 1)}° / ${f(diag.tiltY, 1)}°`)}
          {row('Twist (rotation)', `${f(diag.twist, 1)}°`)}
          {row('Tangential pressure', f(diag.tangentialPressure))}
          {row('Contact size', `${f(diag.width, 1)} × ${f(diag.height, 1)}`)}
          {row('Buttons', `${diag.buttons} ${diag.eraser ? '(eraser)' : ''}${diag.barrel ? '(barrel)' : ''}`)}
          {row('Coalesced samples', String(diag.coalesced))}
          {row('Approx. sample rate', `${diag.rateHz} Hz`)}
        </>
      ) : (
        <p className="muted">Move a pen, finger or mouse over the test area or the canvas.</p>
      )}
    </div>
  );
}

function InputPage() {
  const p = usePrefs((s) => s.prefs);
  const up = usePrefs((s) => s.update);
  const input = p.input;
  const [curve, setCurve] = useState(() => withMinPoints(input.pressureCurve));
  useEffect(() => setCurve(withMinPoints(input.pressureCurve)), [input.pressureCurve]);
  const diag = useInput((s) => s.diag);
  const marker = diag && diag.rawPressure >= 0 ? diag.rawPressure : null;
  const setAction = (
    key: 'barrelButton' | 'barrelButton2' | 'rightMouse' | 'mouseBack' | 'mouseForward',
    v: ButtonAction,
  ) => up((x) => void (x.input[key] = v));
  return (
    <div className="form-grid input-page">
      <h3>Pen and touch</h3>
      <div className="two-col">
        <div>
          <Toggle
            label="Pressure"
            checked={input.pressureEnabled}
            onChange={(v) => up((x) => void (x.input.pressureEnabled = v))}
            testId="pref-pressure"
          />
          <Toggle
            label="Tilt"
            checked={input.tiltEnabled}
            onChange={(v) => up((x) => void (x.input.tiltEnabled = v))}
          />
          <Toggle
            label="Barrel buttons"
            checked={input.barrelButtonsEnabled}
            onChange={(v) => up((x) => void (x.input.barrelButtonsEnabled = v))}
          />
          <Toggle
            label="Eraser tip erases"
            checked={input.eraserTipEnabled}
            onChange={(v) => up((x) => void (x.input.eraserTipEnabled = v))}
          />
          <Toggle
            label="Touch gestures (pan, pinch, rotate)"
            checked={input.touchGestures}
            onChange={(v) => up((x) => void (x.input.touchGestures = v))}
          />
          <Toggle
            label="Pen-only canvas (palm rejection)"
            checked={input.penOnly}
            onChange={(v) => up((x) => void (x.input.penOnly = v))}
            hint="Fingers can use panels and navigate the canvas, but never paint."
            testId="pref-penonly"
          />
          <Slider
            label="Pressure threshold"
            value={input.deadZone}
            min={0}
            max={0.4}
            step={0.005}
            displayScale={100}
            decimals={1}
            unit="%"
            defaultValue={DEFAULT_PREFERENCES.input.deadZone}
            onChange={(v) => up((x) => void (x.input.deadZone = v))}
            hint="Pressure below this counts as zero (ignores very light touches)."
          />
          <Slider
            label="Fixed pressure (mouse / pressure off)"
            value={input.mousePressure}
            min={0.05}
            max={1}
            step={0.01}
            displayScale={100}
            unit="%"
            defaultValue={DEFAULT_PREFERENCES.input.mousePressure}
            onChange={(v) => up((x) => void (x.input.mousePressure = v))}
          />
        </div>
        <div>
          <span className="field-label">Pressure curve</span>
          <CurveEditor
            label="Pressure curve"
            points={curve}
            onChange={setCurve}
            onCommit={(pts) => up((x) => void (x.input.pressureCurve = pts))}
            xLabel="Pen pressure"
            yLabel="Brush pressure"
            marker={marker}
            size={200}
          />
          <div className="field-actions">
            {(['soft', 'linear', 'firm'] as const).map((k) => (
              <Button
                key={k}
                onClick={() => up((x) => void (x.input.pressureCurve = withMinPoints(CURVE_PRESETS[k])))}
                testId={`curve-${k}`}
              >
                {k[0].toUpperCase() + k.slice(1)}
              </Button>
            ))}
            <Button
              onClick={() => up((x) => void (x.input.pressureCurve = withMinPoints(CURVE_PRESETS.linear)))}
            >
              Reset
            </Button>
          </div>
          <CurvePreview points={curve} deadZone={input.deadZone} />
        </div>
      </div>
      <h3>Buttons</h3>
      <div className="two-col">
        <Select
          label="Pen barrel button"
          value={input.barrelButton}
          options={BUTTON_ACTIONS}
          onChange={(v) => setAction('barrelButton', v)}
        />
        <Select
          label="Pen second barrel button"
          value={input.barrelButton2}
          options={BUTTON_ACTIONS}
          onChange={(v) => setAction('barrelButton2', v)}
        />
        <Select
          label="Right mouse button"
          value={input.rightMouse}
          options={BUTTON_ACTIONS}
          onChange={(v) => setAction('rightMouse', v)}
        />
        <Select
          label="Mouse back button"
          value={input.mouseBack}
          options={BUTTON_ACTIONS}
          onChange={(v) => setAction('mouseBack', v)}
        />
        <Select
          label="Mouse forward button"
          value={input.mouseForward}
          options={BUTTON_ACTIONS}
          onChange={(v) => setAction('mouseForward', v)}
        />
        <label className="field">
          <span className="field-label">Custom shortcut (for “Custom shortcut” actions)</span>
          <input
            className="text-input"
            value={input.customShortcut}
            placeholder="e.g. Ctrl+Shift+N"
            onChange={(e) => up((x) => void (x.input.customShortcut = e.target.value))}
          />
        </label>
      </div>
      <h3>Diagnostics</h3>
      <div className="two-col">
        <TestPad />
        <Diagnostics />
      </div>
      <p className="muted">
        Canvas Forge reads pens through Windows Ink (Pointer Events). Devices that only offer a Wintab driver
        need Windows Ink enabled in their driver settings. See docs/tablet-testing.md.
      </p>
    </div>
  );
}

function StrokesPage() {
  const p = usePrefs((s) => s.prefs);
  const up = usePrefs((s) => s.update);
  return (
    <div className="form-grid">
      <h3>Stabiliser (default for brushes set to “inherit”)</h3>
      <div className="field">
        <span className="field-label">Mode</span>
        <Segmented
          label="Stabiliser mode"
          value={p.stabilizer.mode}
          onChange={(v) => up((x) => void (x.stabilizer.mode = v))}
          options={[
            { id: 'off', label: 'Raw input', tip: 'No smoothing' },
            {
              id: 'smooth',
              label: 'Smooth',
              tip: 'Time-based smoothing; the line catches up when you lift the pen',
            },
            { id: 'lazy', label: 'Pulled string', tip: 'The brush trails the pen by a fixed distance' },
          ]}
        />
      </div>
      <Slider
        label="Strength"
        value={p.stabilizer.amount}
        min={0}
        max={1}
        step={0.01}
        displayScale={100}
        unit="%"
        disabled={p.stabilizer.mode === 'off'}
        onChange={(v) => up((x) => void (x.stabilizer.amount = v))}
      />
      <h3>Predictive stroke</h3>
      <Toggle
        label="Enable predictive stroke"
        checked={p.predictive.enabled}
        onChange={(v) => up((x) => void (x.predictive.enabled = v))}
        hint="After lifting the pen, nearly straight strokes become clean lines and curves are smoothed."
      />
      <Slider
        label="Strength"
        value={p.predictive.strength}
        min={0.05}
        max={1}
        step={0.01}
        displayScale={100}
        unit="%"
        disabled={!p.predictive.enabled}
        onChange={(v) => up((x) => void (x.predictive.strength = v))}
      />
    </div>
  );
}

function OrbitPage() {
  const slots = usePrefs((s) => s.prefs.orbitSlots);
  const up = usePrefs((s) => s.update);
  const options = useMemo(
    () =>
      allCommands()
        .filter((c) => !c.id.startsWith('app.quit'))
        .map((c) => ({ id: c.id, label: `${c.group}: ${c.label}` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [],
  );
  return (
    <div className="form-grid">
      <p className="muted">
        Orbit is the radial quick menu. Open it with the right mouse button or pen barrel button on the
        canvas, the Orbit hub in the corner, or the ` key. Drag toward a segment and release, or click a
        segment.
      </p>
      <div className="two-col">
        {slots.map((id, i) => (
          <Select
            key={i}
            label={`Segment ${i + 1}`}
            value={getCommand(id) ? id : options[0].id}
            options={options}
            onChange={(v) => up((x) => void (x.orbitSlots[i] = v))}
          />
        ))}
      </div>
      <div className="field-actions">
        <Button onClick={() => up((x) => void (x.orbitSlots = [...DEFAULT_ORBIT_SLOTS]))}>
          Restore default segments
        </Button>
      </div>
    </div>
  );
}

function ShortcutsPage() {
  const prefs = usePrefs((s) => s.prefs);
  const up = usePrefs((s) => s.update);
  const [query, setQuery] = useState('');
  const [capture, setCapture] = useState<string | null>(null);
  const cmds = useMemo(
    () => allCommands().sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label)),
    [],
  );
  const owner = (key: string, except: string) =>
    cmds.find((c) => c.id !== except && shortcutsFor(c.id).includes(key));
  useEffect(() => {
    if (!capture) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setCapture(null);
      if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        up((x) => void (x.shortcuts[capture] = []));
        return setCapture(null);
      }
      const k = eventToShortcut(e);
      if (!k) return;
      const other = owner(k, capture);
      up((x) => {
        if (other) x.shortcuts[other.id] = shortcutsFor(other.id).filter((s) => s !== k);
        x.shortcuts[capture] = [normalizeShortcut(k)];
      });
      if (other) toast('info', `${k} was moved from “${other.label}” to “${getCommand(capture)?.label}”.`);
      setCapture(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture]);
  const q = query.toLowerCase();
  return (
    <div className="shortcuts-page">
      <input
        className="search"
        type="search"
        placeholder="Search commands"
        aria-label="Search commands"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="shortcut-list" role="table" aria-label="Keyboard shortcuts">
        {cmds
          .filter(
            (c) =>
              !q ||
              c.label.toLowerCase().includes(q) ||
              c.group.toLowerCase().includes(q) ||
              shortcutsFor(c.id).join(' ').toLowerCase().includes(q),
          )
          .map((c) => {
            const keys = shortcutsFor(c.id);
            const custom = prefs.shortcuts[c.id] !== undefined;
            return (
              <div className="shortcut-row" role="row" key={c.id}>
                <span role="cell" className="sc-group">
                  {c.group}
                </span>
                <span role="cell" className="sc-label">
                  {c.label}
                </span>
                <span role="cell" className="sc-keys">
                  {capture === c.id ? (
                    <kbd className="is-capturing">Press keys… (Esc cancels, Backspace clears)</kbd>
                  ) : keys.length ? (
                    keys.map((k) => <kbd key={k}>{k}</kbd>)
                  ) : (
                    <span className="muted">—</span>
                  )}
                </span>
                <span role="cell" className="sc-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setCapture(c.id)}
                    aria-label={`Change shortcut for ${c.label}`}
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={!custom}
                    onClick={() =>
                      up((x) => {
                        delete x.shortcuts[c.id];
                      })
                    }
                    aria-label={`Reset shortcut for ${c.label}`}
                  >
                    Reset
                  </button>
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}

function FilesPage() {
  const p = usePrefs((s) => s.prefs);
  const up = usePrefs((s) => s.update);
  return (
    <div className="form-grid">
      <h3>Autosave and recovery</h3>
      <Slider
        label="Recovery snapshot every"
        value={p.autosaveMinutes}
        min={0}
        max={30}
        step={1}
        unit="min"
        onChange={(v) => up((x) => void (x.autosaveMinutes = v))}
        hint="0 turns recovery snapshots off. Snapshots are stored in the app data folder, never in your document."
      />
      <h3>Export</h3>
      <label className="field">
        <span className="field-label">File name template</span>
        <input
          className="text-input"
          value={p.exportNameTemplate}
          onChange={(e) => up((x) => void (x.exportNameTemplate = e.target.value))}
        />
        <span className="muted">
          Tokens: {'{name}'} {'{date}'} {'{time}'} {'{w}'} {'{h}'}
        </span>
      </label>
      <h3>Memory</h3>
      <Slider
        label="Undo history budget"
        value={p.historyBudgetMB}
        min={64}
        max={4096}
        step={64}
        unit="MB"
        onChange={(v) => up((x) => void (x.historyBudgetMB = v))}
        hint="When undo data exceeds this size, the oldest steps are discarded. Applies to newly opened documents."
      />
      <h3>Recent files</h3>
      <div className="field-actions">
        <Button
          onClick={() => void forge.clearRecent().then(() => toast('success', 'Recent files list cleared.'))}
        >
          Clear recent files
        </Button>
      </div>
    </div>
  );
}
