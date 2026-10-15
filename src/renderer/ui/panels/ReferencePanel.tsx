// Reference images for the active document: view with pan/zoom, flip, greyscale and colour picking.
import { useEffect, useRef, useState } from 'react';
import { useActiveSession, type DocumentSession } from '../../state/documents';
import { useUi } from '../../state/ui';
import { useColors } from '../../state/colors';
import { IconButton } from '../controls/controls';
import { rgbToHex } from '../../engine/color';
import {
  addReference,
  addReferenceFromClipboard,
  addReferenceFromDialog,
  decodeReference,
  referencesOf,
  removeReference,
  type DecodedReference,
  type ReferenceMeta,
} from '../../app/references';

interface RefView {
  /** null = fit to the panel */
  zoom: number | null;
  cx: number;
  cy: number;
}
/** View state per reference id; kept for the session, not saved. */
const views = new Map<string, RefView>();
let flip = false;
let grey = false;

function viewFor(m: ReferenceMeta): RefView {
  let v = views.get(m.id);
  if (!v) {
    v = { zoom: null, cx: m.width / 2, cy: m.height / 2 };
    views.set(m.id, v);
  }
  return v;
}

function ReferenceView(props: {
  s: DocumentSession;
  meta: ReferenceMeta;
  pick: boolean;
  flip: boolean;
  grey: boolean;
  onPicked: (hex: string) => void;
}) {
  const { meta } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<DecodedReference | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const redraw = () => setTick((t) => t + 1);

  useEffect(() => {
    let alive = true;
    const bytes = props.s.resources[meta.file];
    decodeReference(bytes, meta.name).then(
      (d) => alive && setImg(d),
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [props.s, meta]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geometry = () => {
    const el = wrap.current!;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const v = viewFor(meta);
    const fit = Math.min(w / meta.width, h / meta.height) * 0.96;
    const zoom = v.zoom ?? fit;
    const cx = v.zoom === null ? meta.width / 2 : v.cx;
    const cy = v.zoom === null ? meta.height / 2 : v.cy;
    return { w, h, zoom, cx, cy, v, fit };
  };

  useEffect(() => {
    const c = canvas.current;
    const el = wrap.current;
    if (!c || !el || !img) return;
    const dpr = window.devicePixelRatio || 1;
    const { w, h, zoom, cx, cy } = geometry();
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.translate(w / 2, h / 2);
    g.scale(props.flip ? -zoom : zoom, zoom);
    g.translate(-cx, -cy);
    g.imageSmoothingEnabled = zoom < 2;
    g.imageSmoothingQuality = 'high';
    g.filter = props.grey ? 'grayscale(1)' : 'none';
    g.drawImage(img.canvas, 0, 0);
  });

  const toImage = (clientX: number, clientY: number) => {
    const r = wrap.current!.getBoundingClientRect();
    const { w, h, zoom, cx, cy } = geometry();
    const sx = clientX - r.left - w / 2;
    const sy = clientY - r.top - h / 2;
    return { x: cx + (props.flip ? -sx : sx) / zoom, y: cy + sy / zoom };
  };

  const pickAt = (clientX: number, clientY: number) => {
    if (!img) return;
    const p = toImage(clientX, clientY);
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
    const i = (y * img.width + x) * 4;
    if (img.data[i + 3] === 0) return;
    let r = img.data[i] / 255;
    let g = img.data[i + 1] / 255;
    let b = img.data[i + 2] / 255;
    if (props.grey) r = g = b = 0.3 * r + 0.59 * g + 0.11 * b;
    useColors.getState().setFg({ r, g, b }, true);
    props.onPicked(rgbToHex({ r, g, b }));
  };

  const zoomBy = (k: number, clientX?: number, clientY?: number) => {
    const { zoom, cx, cy, v, fit } = geometry();
    const nz = Math.min(32, Math.max(fit * 0.25, zoom * k));
    let ncx = cx;
    let ncy = cy;
    if (clientX !== undefined && clientY !== undefined) {
      // keep the image point under the pointer fixed
      const p = toImage(clientX, clientY);
      ncx = p.x - ((p.x - cx) * zoom) / nz;
      ncy = p.y - ((p.y - cy) * zoom) / nz;
    }
    v.zoom = nz;
    v.cx = ncx;
    v.cy = ncy;
    redraw();
  };

  const drag = useRef<{ x: number; y: number; picking: boolean } | null>(null);

  if (error)
    return (
      <p className="panel-empty">
        Could not display {meta.name}: {error}
      </p>
    );
  return (
    <div
      ref={wrap}
      className={`ref-view ${props.pick ? 'is-picking' : ''}`}
      tabIndex={0}
      role="img"
      aria-label={`Reference image ${meta.name}, ${meta.width} × ${meta.height} pixels. Plus and minus zoom, 0 fits, arrow keys pan.`}
      data-testid="reference-view"
      onWheel={(e) => zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY)}
      onDoubleClick={() => {
        viewFor(meta).zoom = null;
        redraw();
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const picking = props.pick || e.altKey || useUi.getState().tool === 'eyedropper';
        drag.current = { x: e.clientX, y: e.clientY, picking };
        if (picking) pickAt(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        if (d.picking) return pickAt(e.clientX, e.clientY);
        const { zoom, cx, cy, v } = geometry();
        const dx = (e.clientX - d.x) / zoom;
        const dy = (e.clientY - d.y) / zoom;
        v.zoom = zoom;
        v.cx = cx - (props.flip ? -dx : dx);
        v.cy = cy - dy;
        d.x = e.clientX;
        d.y = e.clientY;
        redraw();
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={(e) => {
        const { zoom, cx, cy, v } = geometry();
        const step = 40 / zoom;
        const pan = (dx: number, dy: number) => {
          v.zoom = zoom;
          v.cx = cx + dx;
          v.cy = cy + dy;
          redraw();
        };
        let handled = true;
        if (e.key === '+' || e.key === '=') zoomBy(1.25);
        else if (e.key === '-') zoomBy(0.8);
        else if (e.key === '0') {
          v.zoom = null;
          redraw();
        } else if (e.key === 'ArrowLeft') pan(-step, 0);
        else if (e.key === 'ArrowRight') pan(step, 0);
        else if (e.key === 'ArrowUp') pan(0, -step);
        else if (e.key === 'ArrowDown') pan(0, step);
        else handled = false;
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <canvas ref={canvas} aria-hidden="true" />
      {!img ? <span className="ref-loading">Loading…</span> : null}
    </div>
  );
}

export function ReferencePanel() {
  const s = useActiveSession();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pick, setPick] = useState(false);
  const [, setFlags] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  if (!s) return <p className="panel-empty">Open a document to add reference images.</p>;
  const refs = referencesOf(s);
  const active = refs.find((r) => r.id === activeId) ?? refs[refs.length - 1] ?? null;
  const toggle = (fn: () => void) => {
    fn();
    setFlags((n) => n + 1);
  };
  return (
    <div
      className={`reference-panel ${over ? 'is-drop-target' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={async (e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        for (const f of [...e.dataTransfer.files]) {
          const id = await addReference(s, new Uint8Array(await f.arrayBuffer()), f.name);
          if (id) setActiveId(id);
        }
      }}
    >
      <div className="panel-toolbar" role="toolbar" aria-label="Reference tools">
        <IconButton
          icon="image"
          label="Add reference image…"
          tip="Add a reference image from a file"
          onClick={() => void addReferenceFromDialog()}
          testId="ref-add"
        />
        <IconButton
          icon="paste"
          label="Paste reference from clipboard"
          tip="Paste an image from the clipboard as a reference"
          onClick={() => void addReferenceFromClipboard()}
        />
        <IconButton
          icon="eyedropper"
          label="Pick colours from the reference"
          tip="Click picks the foreground colour (Alt+click works too)"
          pressed={pick}
          onClick={() => setPick(!pick)}
          testId="ref-pick"
        />
        <IconButton
          icon="flipH"
          label="Flip reference horizontally"
          tip="Flip the view (the image is not changed)"
          pressed={flip}
          onClick={() => toggle(() => (flip = !flip))}
        />
        <IconButton
          icon="adjust"
          label="Greyscale view"
          tip="Show the reference in greyscale to compare values"
          pressed={grey}
          onClick={() => toggle(() => (grey = !grey))}
        />
        <IconButton
          icon="fit"
          label="Fit reference"
          tip="Fit to the panel (or double-click the image)"
          disabled={!active}
          onClick={() => active && toggle(() => (viewFor(active).zoom = null))}
        />
        <IconButton
          icon="trash"
          label="Remove reference"
          tip="Remove this reference from the document (undo restores it)"
          disabled={!active}
          onClick={() => active && removeReference(s, active.id)}
          testId="ref-remove"
        />
      </div>
      {refs.length > 1 ? (
        <div className="ref-tabs" role="tablist" aria-label="Reference images">
          {refs.map((r) => (
            <button
              key={r.id}
              type="button"
              role="tab"
              aria-selected={r.id === active?.id}
              className={r.id === active?.id ? 'is-on' : ''}
              onClick={() => setActiveId(r.id)}
              data-tip={`${r.name} · ${r.width} × ${r.height}`}
            >
              {r.name.replace(/\.[a-z0-9]+$/i, '')}
            </button>
          ))}
        </div>
      ) : null}
      {active ? (
        <ReferenceView
          key={active.id}
          s={s}
          meta={active}
          pick={pick}
          flip={flip}
          grey={grey}
          onPicked={setPicked}
        />
      ) : (
        <div className="ref-empty" data-testid="ref-empty">
          Drop an image here, paste one or press <strong>Add</strong>. References are stored with the document
          and never change the artwork.
        </div>
      )}
      {active ? (
        <div className="ref-foot">
          <span>
            {active.width} × {active.height}
          </span>
          {picked ? (
            <span className="ref-picked">
              <span className="ref-picked-swatch" style={{ background: picked }} /> {picked}
            </span>
          ) : (
            <span>Drag to pan · wheel to zoom</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
