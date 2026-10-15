// New document, export and about dialogs.
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Overlays';
import { Button, NumberField, Segmented, Select, Slider, Toggle } from '../controls/controls';
import { useUi } from '../../state/ui';
import { activeSession } from '../../state/documents';
import { newDocument, exportImage, expandNameTemplate, type ExportOptions } from '../../app/file-actions';
import { estimateDocumentMemory, MAX_DOCUMENT_SIDE } from '../../engine/document';
import { parseHex, rgbToHex } from '../../engine/color';
import { usePrefs } from '../../state/preferences';
import { forge } from '../../platform';
import type { AppInfo } from '../../../shared/ipc';
import { AppMark } from '../icons';
import { animationOf } from '../../app/animation';

const PRESETS: { id: string; label: string; w: number; h: number; dpi: number }[] = [
  { id: 'hd', label: 'Screen 1920 × 1080', w: 1920, h: 1080, dpi: 144 },
  { id: 'qhd', label: 'Screen 2560 × 1440', w: 2560, h: 1440, dpi: 144 },
  { id: 'uhd', label: 'Screen 3840 × 2160 (4K)', w: 3840, h: 2160, dpi: 144 },
  { id: 'sketch', label: 'Sketch 3000 × 2000', w: 3000, h: 2000, dpi: 300 },
  { id: 'square', label: 'Square 2048 × 2048', w: 2048, h: 2048, dpi: 144 },
  { id: 'a4', label: 'A4 portrait, 300 dpi', w: 2480, h: 3508, dpi: 300 },
  { id: 'a5', label: 'A5 portrait, 300 dpi', w: 1748, h: 2480, dpi: 300 },
  { id: 'letter', label: 'US Letter portrait, 300 dpi', w: 2550, h: 3300, dpi: 300 },
  { id: 'social', label: 'Social portrait 1080 × 1350', w: 1080, h: 1350, dpi: 72 },
  { id: 'board', label: 'Storyboard panel 1600 × 900', w: 1600, h: 900, dpi: 144 },
  { id: 'custom', label: 'Custom', w: 0, h: 0, dpi: 0 },
];

const fmtBytes = (b: number) =>
  b > 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${Math.round(b / 1024 ** 2)} MB`;

export function NewDocumentDialog() {
  const close = useUi((s) => s.closeDialog);
  const [preset, setPreset] = useState('qhd');
  const [w, setW] = useState(2560);
  const [h, setH] = useState(1440);
  const [dpi, setDpi] = useState(144);
  const [bg, setBg] = useState<'white' | 'transparent' | 'custom'>('white');
  const [custom, setCustom] = useState('#F4F1EA');
  const [title, setTitle] = useState('');
  const mem = estimateDocumentMemory(w, h, 2);
  const valid =
    Number.isInteger(w) &&
    Number.isInteger(h) &&
    w >= 1 &&
    h >= 1 &&
    w <= MAX_DOCUMENT_SIDE &&
    h <= MAX_DOCUMENT_SIDE;
  const risky = mem > 1.5 * 1024 ** 3 || w * h > 60_000_000;
  const choose = (id: string) => {
    setPreset(id);
    const p = PRESETS.find((x) => x.id === id);
    if (p && p.w) {
      setW(p.w);
      setH(p.h);
      setDpi(p.dpi);
    }
  };
  const create = () => {
    if (!valid) return;
    const c = bg === 'custom' ? (parseHex(custom) ?? { r: 1, g: 1, b: 1 }) : { r: 1, g: 1, b: 1 };
    newDocument({
      width: w,
      height: h,
      dpi,
      background: { transparent: bg === 'transparent', color: { r: c.r, g: c.g, b: c.b } },
      title: title.trim() || undefined,
    });
    close();
  };
  return (
    <Modal
      title="New canvas"
      onClose={close}
      width={520}
      testId="new-doc-dialog"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button kind="primary" onClick={create} disabled={!valid} testId="new-doc-create">
            Create
          </Button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <Select
          label="Preset"
          value={preset}
          options={PRESETS.map((p) => ({ id: p.id, label: p.label }))}
          onChange={choose}
          testId="new-doc-preset"
        />
        <div className="field-row">
          <NumberField
            label="Width"
            value={w}
            integer
            min={1}
            max={MAX_DOCUMENT_SIDE}
            unit="px"
            onChange={(v) => {
              setW(v);
              setPreset('custom');
            }}
            testId="new-doc-width"
          />
          <button
            type="button"
            className="icon-btn swap-dims"
            aria-label="Swap width and height (orientation)"
            data-tip="Swap orientation"
            onClick={() => {
              setW(h);
              setH(w);
            }}
          >
            ⇄
          </button>
          <NumberField
            label="Height"
            value={h}
            integer
            min={1}
            max={MAX_DOCUMENT_SIDE}
            unit="px"
            onChange={(v) => {
              setH(v);
              setPreset('custom');
            }}
            testId="new-doc-height"
          />
        </div>
        <NumberField label="Resolution" value={dpi} integer min={1} max={2400} unit="dpi" onChange={setDpi} />
        <div className="field">
          <span className="field-label">Background</span>
          <Segmented
            label="Background"
            value={bg}
            onChange={setBg}
            options={[
              { id: 'white', label: 'White' },
              { id: 'transparent', label: 'Transparent' },
              { id: 'custom', label: 'Colour' },
            ]}
          />
          {bg === 'custom' ? (
            <input
              className="text-input"
              aria-label="Background colour (hex)"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              style={{ marginTop: 6 }}
            />
          ) : null}
        </div>
        <label className="field">
          <span className="field-label">Name (optional)</span>
          <input
            className="text-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled"
          />
        </label>
        <p className={`mem-estimate ${risky ? 'is-warning' : ''}`} role={risky ? 'alert' : undefined}>
          {valid ? (
            <>
              {((w * h) / 1e6).toFixed(1)} megapixels · about {fmtBytes(mem)} with two painted layers.
              {risky
                ? ' This is a very large canvas: painting, undo and saving will use a lot of memory. Consider a smaller size or fewer layers.'
                : ''}
            </>
          ) : (
            `Width and height must be whole numbers from 1 to ${MAX_DOCUMENT_SIDE} px.`
          )}
        </p>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function ExportDialog() {
  const close = useUi((s) => s.closeDialog);
  const s = activeSession();
  const template = usePrefs((x) => x.prefs.exportNameTemplate);
  const [opts, setOpts] = useState<ExportOptions>({
    format: 'png',
    quality: 0.92,
    scale: 1,
    transparent: !!s?.doc.background.transparent,
  });
  const [busy, setBusy] = useState(false);
  if (!s) return null;
  const w = Math.max(1, Math.round(s.doc.width * opts.scale));
  const h = Math.max(1, Math.round(s.doc.height * opts.scale));
  const run = async () => {
    setBusy(true);
    const ok = await exportImage(s, opts);
    setBusy(false);
    if (ok) close();
  };
  return (
    <Modal
      title="Export image"
      onClose={close}
      width={460}
      testId="export-dialog"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button kind="primary" onClick={() => void run()} disabled={busy} testId="export-run">
            {busy ? 'Exporting…' : 'Export…'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field">
          <span className="field-label">Format</span>
          <Segmented
            label="Format"
            value={opts.format}
            onChange={(f) => setOpts({ ...opts, format: f })}
            options={[
              { id: 'png', label: 'PNG', tip: 'Lossless, keeps transparency' },
              { id: 'jpeg', label: 'JPEG', tip: 'Lossy, no transparency' },
              { id: 'webp', label: 'WebP', tip: 'Lossy, keeps transparency' },
            ]}
          />
        </div>
        {opts.format !== 'png' ? (
          <Slider
            label="Quality"
            value={opts.quality}
            min={0.3}
            max={1}
            step={0.01}
            displayScale={100}
            unit="%"
            onChange={(q) => setOpts({ ...opts, quality: q })}
          />
        ) : null}
        <Select
          label="Scale"
          value={String(opts.scale)}
          options={[
            { id: '0.25', label: '25 %' },
            { id: '0.5', label: '50 %' },
            { id: '1', label: '100 % (original)' },
            { id: '2', label: '200 %' },
          ]}
          onChange={(v) => setOpts({ ...opts, scale: Number(v) })}
        />
        {opts.format !== 'jpeg' ? (
          <Toggle
            label="Transparent background"
            checked={opts.transparent}
            onChange={(t) => setOpts({ ...opts, transparent: t })}
            hint="Leave out the document background colour."
          />
        ) : (
          <p className="muted">
            JPEG has no transparency; transparent areas are filled with{' '}
            {s.doc.background.transparent ? 'white' : 'the background colour'}.
          </p>
        )}
        {animationOf(s).enabled ? (
          <p className="muted">
            This document is animated: the current frame (with held layers, without onion skins) is exported.
            Use Export animation for GIF or a PNG sequence.
          </p>
        ) : null}
        <p className="muted">
          {w} × {h} px · file name “{expandNameTemplate(template, s, w, h)}” (change the template in
          Preferences)
        </p>
      </div>
    </Modal>
  );
}

export function AboutDialog() {
  const close = useUi((s) => s.closeDialog);
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    void forge.appInfo().then(setInfo);
  }, []);
  const year = useMemo(() => new Date().getFullYear(), []);
  return (
    <Modal
      title="About Canvas Forge"
      onClose={close}
      width={460}
      footer={
        <Button kind="primary" onClick={close}>
          Close
        </Button>
      }
    >
      <div className="about">
        <AppMark size={48} />
        <div>
          <h3>Canvas Forge {info?.version}</h3>
          <p>A tablet-native digital sketchbook with deep brush control and a calm, modern workspace.</p>
          <p className="muted">
            Runs fully offline. No account, no telemetry, no network access. Your artwork never leaves this
            computer.
          </p>
          {info ? (
            <p className="muted mono">
              Electron {info.electron} · Chromium {info.chrome} · Node {info.node} · {info.platform}
              <br />
              Settings folder: {info.userDataPath}
            </p>
          ) : null}
          <p className="muted">
            © {year} Canvas Forge contributors. Third-party licences are listed in THIRD_PARTY_NOTICES.md.
          </p>
        </div>
      </div>
    </Modal>
  );
}

export { rgbToHex };
