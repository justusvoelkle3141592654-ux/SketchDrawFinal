// Image size, canvas size and colour adjustment dialogs.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../Overlays';
import { Button, NumberField, Slider, Toggle } from '../controls/controls';
import { useUi } from '../../state/ui';
import { activeSession } from '../../state/documents';
import { estimateDocumentMemory, MAX_DOCUMENT_SIDE } from '../../engine/document';
import { resizeCanvas, resizeImage, type Adjustment } from '../../engine/pixel-ops';
import { docOp } from '../../app/extended';
import { allRasterLayers } from '../../engine/layers';
import {
  ADJUST_LABELS,
  AdjustmentPreview,
  adjustTarget,
  adjustedPixels,
  undoNote,
} from '../../app/adjust-actions';

const fmtBytes = (b: number) =>
  b > 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${Math.round(b / 1024 ** 2)} MB`;
const clampSide = (v: number) => Math.min(MAX_DOCUMENT_SIDE, Math.max(1, Math.round(v)));

function layerCount(): number {
  const s = activeSession();
  return s ? Math.max(1, allRasterLayers(s.doc.layers).length) : 1;
}

export function ImageSizeDialog() {
  const close = useUi((s) => s.closeDialog);
  const s = activeSession();
  const ow = s?.doc.width ?? 1;
  const oh = s?.doc.height ?? 1;
  const [w, setW] = useState(ow);
  const [h, setH] = useState(oh);
  const [keep, setKeep] = useState(true);
  if (!s) return null;
  const ratio = ow / oh;
  const setWidth = (v: number) => {
    setW(clampSide(v));
    if (keep) setH(clampSide(v / ratio));
  };
  const setHeight = (v: number) => {
    setH(clampSide(v));
    if (keep) setW(clampSide(v * ratio));
  };
  const setPercent = (p: number) => {
    setW(clampSide((ow * p) / 100));
    setH(clampSide((oh * p) / 100));
  };
  const mem = estimateDocumentMemory(w, h, layerCount());
  const changed = w !== ow || h !== oh;
  const apply = () => {
    close();
    if (changed) docOp(`Image resized to ${w} × ${h} px`, (x) => resizeImage(x.doc, w, h));
  };
  return (
    <Modal
      title="Image size"
      onClose={close}
      width={440}
      testId="image-size-dialog"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button kind="primary" onClick={apply} disabled={!changed} testId="image-size-apply">
            Resize
          </Button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <p className="form-note">
          Resamples every layer. Currently {ow} × {oh} px.
        </p>
        <div className="field-row">
          <NumberField
            label="Width"
            value={w}
            integer
            min={1}
            max={MAX_DOCUMENT_SIDE}
            unit="px"
            onChange={setWidth}
            testId="image-size-width"
          />
          <NumberField
            label="Height"
            value={h}
            integer
            min={1}
            max={MAX_DOCUMENT_SIDE}
            unit="px"
            onChange={setHeight}
            testId="image-size-height"
          />
        </div>
        <NumberField
          label="Scale"
          value={Math.round((w / ow) * 1000) / 10}
          min={1}
          max={1600}
          unit="%"
          onChange={setPercent}
        />
        <Toggle label="Keep proportions" checked={keep} onChange={setKeep} />
        <p className="form-note">
          Estimated memory: {fmtBytes(mem)}. Enlarging softens detail; shrinking averages neighbouring pixels.
          Masks are resampled, the selection is cleared. Undo restores the original size.
        </p>
        {mem > 1.5 * 1024 ** 3 ? (
          <p className="form-warning">This size needs a lot of memory and may be slow.</p>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

type Anchor = [number, number];
const ANCHOR_LABELS = [
  ['Top left', 'Top', 'Top right'],
  ['Left', 'Centre', 'Right'],
  ['Bottom left', 'Bottom', 'Bottom right'],
];

export function CanvasSizeDialog() {
  const close = useUi((s) => s.closeDialog);
  const s = activeSession();
  const ow = s?.doc.width ?? 1;
  const oh = s?.doc.height ?? 1;
  const [w, setW] = useState(ow);
  const [h, setH] = useState(oh);
  const [anchor, setAnchor] = useState<Anchor>([1, 1]);
  if (!s) return null;
  const changed = w !== ow || h !== oh;
  const dx = anchor[0] === 0 ? 0 : anchor[0] === 1 ? Math.round((w - ow) / 2) : w - ow;
  const dy = anchor[1] === 0 ? 0 : anchor[1] === 1 ? Math.round((h - oh) / 2) : h - oh;
  const apply = () => {
    close();
    if (changed) docOp(`Canvas resized to ${w} × ${h} px`, (x) => resizeCanvas(x.doc, w, h, dx, dy));
  };
  const crops = w < ow || h < oh;
  return (
    <Modal
      title="Canvas size"
      onClose={close}
      width={440}
      testId="canvas-size-dialog"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button kind="primary" onClick={apply} disabled={!changed} testId="canvas-size-apply">
            Apply
          </Button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <p className="form-note">
          Adds or removes canvas around the artwork without resampling. Currently {ow} × {oh} px.
        </p>
        <div className="field-row">
          <NumberField
            label="Width"
            value={w}
            integer
            min={1}
            max={MAX_DOCUMENT_SIDE}
            unit="px"
            onChange={(v) => setW(clampSide(v))}
            testId="canvas-size-width"
          />
          <NumberField
            label="Height"
            value={h}
            integer
            min={1}
            max={MAX_DOCUMENT_SIDE}
            unit="px"
            onChange={(v) => setH(clampSide(v))}
            testId="canvas-size-height"
          />
        </div>
        <div className="anchor-row">
          <span className="anchor-label" id="anchor-label">
            Anchor
          </span>
          <div className="anchor-grid" role="radiogroup" aria-labelledby="anchor-label">
            {[0, 1, 2].map((row) =>
              [0, 1, 2].map((col) => (
                <button
                  key={`${col}-${row}`}
                  type="button"
                  role="radio"
                  aria-checked={anchor[0] === col && anchor[1] === row}
                  aria-label={ANCHOR_LABELS[row][col]}
                  data-tip={ANCHOR_LABELS[row][col]}
                  className={anchor[0] === col && anchor[1] === row ? 'is-on' : ''}
                  onClick={() => setAnchor([col, row])}
                />
              )),
            )}
          </div>
        </div>
        {crops ? (
          <p className="form-warning">
            The new size is smaller: pixels outside it are removed (undo restores them).
          </p>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

type AdjustKind = 'brightness-contrast' | 'hue-saturation';
interface AdjustValues {
  brightness: number;
  contrast: number;
  hue: number;
  saturation: number;
  lightness: number;
}
const ZERO: AdjustValues = { brightness: 0, contrast: 0, hue: 0, saturation: 0, lightness: 0 };

export function AdjustDialog() {
  const dialog = useUi((s) => s.dialog);
  const close = useUi((s) => s.closeDialog);
  const kind = (dialog?.props?.kind as AdjustKind | undefined) ?? 'brightness-contrast';
  const [target] = useState(() => adjustTarget(true));
  const preview = useMemo(() => (target ? new AdjustmentPreview(target.s, target.layer) : null), [target]);
  const [v, setV] = useState<AdjustValues>(ZERO);
  const [live, setLive] = useState(true);
  const finished = useRef(false);
  const adj: Adjustment =
    kind === 'brightness-contrast'
      ? { kind, brightness: v.brightness, contrast: v.contrast }
      : { kind, hue: v.hue / 360, saturation: v.saturation, lightness: v.lightness };
  const neutral =
    kind === 'brightness-contrast' ? !v.brightness && !v.contrast : !v.hue && !v.saturation && !v.lightness;
  const key = JSON.stringify(adj);

  useEffect(() => {
    if (!preview) return;
    const t = setTimeout(() => preview.update(live && !neutral ? (JSON.parse(key) as Adjustment) : null), 50);
    return () => clearTimeout(t);
  }, [preview, key, live, neutral]);
  useEffect(
    () => () => {
      if (!finished.current) preview?.cancel();
    },
    [preview],
  );
  useEffect(() => {
    if (!target) close();
  }, [target, close]);
  if (!target || !preview) return null;

  const cancel = () => {
    finished.current = true;
    preview.cancel();
    close();
  };
  const apply = () => {
    finished.current = true;
    if (neutral) preview.cancel();
    else preview.commit(adj);
    close();
  };
  const set = (k: keyof AdjustValues) => (x: number) => setV((o) => ({ ...o, [k]: x }));
  return (
    <Modal
      title={ADJUST_LABELS[kind]}
      onClose={cancel}
      width={420}
      testId="adjust-dialog"
      footer={
        <>
          <Button onClick={() => setV(ZERO)} disabled={neutral}>
            Reset
          </Button>
          <Button onClick={cancel}>Cancel</Button>
          <Button kind="primary" onClick={apply} testId="adjust-apply">
            Apply
          </Button>
        </>
      }
    >
      <div className="form-grid adjust-form">
        <p className="form-warning" data-testid="adjust-destructive-note">
          <strong>Destructive:</strong> changes the pixels of {adjustedPixels(target.s, target.layer)}.{' '}
          {undoNote()}
        </p>
        {kind === 'brightness-contrast' ? (
          <>
            <Slider
              label="Brightness"
              value={v.brightness}
              min={-1}
              max={1}
              step={0.01}
              displayScale={100}
              unit="%"
              defaultValue={0}
              onChange={set('brightness')}
              testId="adjust-brightness"
            />
            <Slider
              label="Contrast"
              value={v.contrast}
              min={-1}
              max={1}
              step={0.01}
              displayScale={100}
              unit="%"
              defaultValue={0}
              onChange={set('contrast')}
              testId="adjust-contrast"
            />
          </>
        ) : (
          <>
            <Slider
              label="Hue"
              value={v.hue}
              min={-180}
              max={180}
              step={1}
              unit="°"
              defaultValue={0}
              onChange={set('hue')}
              testId="adjust-hue"
            />
            <Slider
              label="Saturation"
              value={v.saturation}
              min={-1}
              max={1}
              step={0.01}
              displayScale={100}
              unit="%"
              defaultValue={0}
              onChange={set('saturation')}
              testId="adjust-saturation"
            />
            <Slider
              label="Lightness"
              value={v.lightness}
              min={-1}
              max={1}
              step={0.01}
              displayScale={100}
              unit="%"
              defaultValue={0}
              onChange={set('lightness')}
              testId="adjust-lightness"
            />
          </>
        )}
        <Toggle label="Preview on canvas" checked={live} onChange={setLive} />
      </div>
    </Modal>
  );
}
