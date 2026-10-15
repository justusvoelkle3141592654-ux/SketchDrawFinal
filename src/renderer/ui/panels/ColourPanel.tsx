// Colour editor: hue ring + saturation/value square, RGB/HSV/HEX entry, transparency, recents and harmonies.
import { useEffect, useRef, useState } from 'react';
import { useColors } from '../../state/colors';
import {
  harmony,
  hsvToRgb,
  parseHex,
  rgbEquals,
  rgbToCss,
  rgbToHex,
  rgbToHsv,
  type HarmonyKind,
  type HSV,
  type RGB,
} from '../../engine/color';
import { Icon } from '../icons';
import { Segmented, Slider } from '../controls/controls';
import { runCommand, tooltipFor } from '../../app/commands';
import { useUi } from '../../state/ui';

function useHsv(): [HSV, (h: HSV, commit?: boolean) => void] {
  const fg = useColors((s) => s.fg);
  const setFg = useColors((s) => s.setFg);
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(fg));
  const lastSet = useRef<RGB>(fg);
  useEffect(() => {
    // external change (eyedropper, palette): adopt, keeping hue when the colour is grey
    if (!rgbEquals(fg, lastSet.current)) {
      const n = rgbToHsv(fg);
      setHsv((old) => ({
        h: n.s < 0.001 || n.v < 0.001 ? old.h : n.h,
        s: n.v < 0.001 ? old.s : n.s,
        v: n.v,
      }));
      lastSet.current = fg;
    }
  }, [fg]);
  const update = (h: HSV, commit = false) => {
    setHsv(h);
    const rgb = hsvToRgb(h);
    lastSet.current = rgb;
    setFg(rgb, commit);
  };
  return [hsv, update];
}

function Wheel({
  hsv,
  onChange,
  size,
}: {
  hsv: HSV;
  onChange: (h: HSV, commit?: boolean) => void;
  size: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ring = Math.max(14, size * 0.1);
  const outer = size / 2;
  const inner = outer - ring;
  const sq = inner * Math.SQRT2 * 0.92;
  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr;
    c.height = size * dpr;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    const cx = size / 2;
    const cy = size / 2;
    const cg = g.createConicGradient(-Math.PI / 2, cx, cy);
    for (let i = 0; i <= 12; i++) cg.addColorStop(i / 12, rgbToCss(hsvToRgb({ h: i / 12, s: 1, v: 1 })));
    g.beginPath();
    g.arc(cx, cy, outer - 0.5, 0, Math.PI * 2);
    g.arc(cx, cy, inner + 0.5, 0, Math.PI * 2, true);
    g.fillStyle = cg;
    g.fill('evenodd');
    const x0 = cx - sq / 2;
    const y0 = cy - sq / 2;
    const hue = rgbToCss(hsvToRgb({ h: hsv.h, s: 1, v: 1 }));
    const gx = g.createLinearGradient(x0, 0, x0 + sq, 0);
    gx.addColorStop(0, '#fff');
    gx.addColorStop(1, hue);
    g.fillStyle = gx;
    g.fillRect(x0, y0, sq, sq);
    const gy = g.createLinearGradient(0, y0, 0, y0 + sq);
    gy.addColorStop(0, 'rgba(0,0,0,0)');
    gy.addColorStop(1, '#000');
    g.fillStyle = gy;
    g.fillRect(x0, y0, sq, sq);
    // markers
    const ha = hsv.h * Math.PI * 2 - Math.PI / 2;
    const hr = (outer + inner) / 2;
    const marker = (x: number, y: number, r: number) => {
      g.lineWidth = 2;
      g.strokeStyle = '#000';
      g.beginPath();
      g.arc(x, y, r + 1, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = '#fff';
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.stroke();
    };
    marker(cx + Math.cos(ha) * hr, cy + Math.sin(ha) * hr, ring / 2 - 2);
    marker(x0 + hsv.s * sq, y0 + (1 - hsv.v) * sq, 5);
  }, [hsv, size, outer, inner, ring, sq]);

  const mode = useRef<'ring' | 'square' | null>(null);
  const handle = (e: React.PointerEvent | PointerEvent, commit: boolean) => {
    const r = ref.current!.getBoundingClientRect();
    const x = e.clientX - r.left - size / 2;
    const y = e.clientY - r.top - size / 2;
    if (mode.current === 'ring') {
      let h = (Math.atan2(y, x) + Math.PI / 2) / (Math.PI * 2);
      if (h < 0) h += 1;
      onChange({ ...hsv, h }, commit);
    } else if (mode.current === 'square') {
      const s = Math.min(1, Math.max(0, (x + sq / 2) / sq));
      const v = Math.min(1, Math.max(0, 1 - (y + sq / 2) / sq));
      onChange({ ...hsv, s, v }, commit);
    }
  };
  return (
    <canvas
      ref={ref}
      className="colour-wheel"
      style={{ width: size, height: size }}
      role="application"
      aria-label={`Colour wheel. Hue ${Math.round(hsv.h * 360)} degrees, saturation ${Math.round(hsv.s * 100)} percent, value ${Math.round(hsv.v * 100)} percent. Use arrow keys: left/right hue, up/down value, Shift+arrows saturation.`}
      tabIndex={0}
      data-testid="colour-wheel"
      onKeyDown={(e) => {
        const step = e.altKey ? 0.002 : 0.01;
        let { h, s, v } = hsv;
        if (e.key === 'ArrowLeft') {
          if (e.shiftKey) s = Math.max(0, s - step);
          else h = (h - step + 1) % 1;
        } else if (e.key === 'ArrowRight') {
          if (e.shiftKey) s = Math.min(1, s + step);
          else h = (h + step) % 1;
        } else if (e.key === 'ArrowUp') v = Math.min(1, v + step);
        else if (e.key === 'ArrowDown') v = Math.max(0, v - step);
        else return;
        e.preventDefault();
        onChange({ h, s, v }, true);
      }}
      onPointerDown={(e) => {
        const r = ref.current!.getBoundingClientRect();
        const x = e.clientX - r.left - size / 2;
        const y = e.clientY - r.top - size / 2;
        const d = Math.hypot(x, y);
        if (d >= inner && d <= outer) mode.current = 'ring';
        else if (Math.abs(x) <= sq / 2 && Math.abs(y) <= sq / 2) mode.current = 'square';
        else return;
        (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
        handle(e, false);
      }}
      onPointerMove={(e) => mode.current && handle(e, false)}
      onPointerUp={(e) => {
        if (mode.current) handle(e, true);
        mode.current = null;
      }}
    />
  );
}

function Swatch({
  color,
  label,
  onClick,
  size = 22,
}: {
  color: RGB;
  label?: string;
  onClick: () => void;
  size?: number;
}) {
  const hex = rgbToHex(color);
  return (
    <button
      type="button"
      className="swatch"
      style={{ background: hex, width: size, height: size }}
      aria-label={label ?? hex}
      data-tip={label ?? hex}
      onClick={onClick}
    />
  );
}

export function ColourPanel() {
  const [hsv, setHsv] = useHsv();
  const fg = useColors((s) => s.fg);
  const bg = useColors((s) => s.bg);
  const alpha = useColors((s) => s.fgAlpha);
  const recent = useColors((s) => s.recent);
  const colors = useColors.getState();
  const [mode, setMode] = useState<'hsv' | 'rgb'>('hsv');
  const [hk, setHk] = useState<HarmonyKind>('complementary');
  const [hex, setHex] = useState(rgbToHex(fg));
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(200);
  useEffect(() => setHex(rgbToHex(fg)), [fg]);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const body = el.closest('.panel-body') as HTMLElement | null;
    const measure = () => {
      const byWidth = el.clientWidth - 16;
      // leave room for the header row and two slider rows when the panel is short
      const byHeight = body ? body.clientHeight - 150 : 260;
      setSize(Math.max(110, Math.min(260, byWidth, byHeight)));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (body) ro.observe(body);
    return () => ro.disconnect();
  }, []);
  const setRgb = (c: RGB, commit = false) => colors.setFg(c, commit);
  return (
    <div className="colour-panel" ref={wrapRef}>
      <div className="colour-top">
        <div className="fgbg" aria-label="Foreground and background colours">
          <button
            type="button"
            className="fgbg-fg"
            style={{ background: rgbToCss(fg, alpha) }}
            aria-label={`Foreground ${rgbToHex(fg)}`}
            data-tip="Foreground colour"
          />
          <button
            type="button"
            className="fgbg-bg"
            style={{ background: rgbToCss(bg) }}
            aria-label={`Background ${rgbToHex(bg)}. Click to swap.`}
            data-tip={tooltipFor('colour.swap')}
            onClick={() => runCommand('colour.swap')}
          />
        </div>
        <div className="colour-top-actions">
          <button
            type="button"
            className="mini-btn"
            aria-label="Swap colours"
            data-tip={tooltipFor('colour.swap')}
            onClick={() => runCommand('colour.swap')}
          >
            <Icon name="swap" size={15} />
          </button>
          <button
            type="button"
            className="mini-btn"
            aria-label="Reset colours"
            data-tip={tooltipFor('colour.reset')}
            onClick={() => runCommand('colour.reset')}
          >
            <Icon name="reset" size={15} />
          </button>
          <button
            type="button"
            className="mini-btn"
            aria-label="Eyedropper"
            data-tip={tooltipFor('tool.eyedropper')}
            onClick={() => useUi.getState().setTool('eyedropper')}
          >
            <Icon name="eyedropper" size={15} />
          </button>
        </div>
        <label className="hex-field">
          <span className="sr-only">Hex colour</span>
          <input
            value={hex}
            aria-label="Hex colour"
            spellCheck={false}
            onChange={(e) => setHex(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            onBlur={() => {
              const p = parseHex(hex);
              if (p) setRgb({ r: p.r, g: p.g, b: p.b }, true);
              else setHex(rgbToHex(fg));
            }}
            data-testid="hex-input"
          />
        </label>
      </div>
      <div className="wheel-wrap">
        <Wheel hsv={hsv} onChange={setHsv} size={size} />
      </div>
      <Segmented
        label="Slider mode"
        value={mode}
        onChange={setMode}
        options={[
          { id: 'hsv', label: 'HSV' },
          { id: 'rgb', label: 'RGB' },
        ]}
      />
      {mode === 'hsv' ? (
        <>
          <Slider
            label="H"
            value={hsv.h * 360}
            min={0}
            max={360}
            step={1}
            unit="°"
            onChange={(v) => setHsv({ ...hsv, h: v / 360 })}
            onCommit={() => colors.pushRecent(colors.fg)}
          />
          <Slider
            label="S"
            value={hsv.s}
            min={0}
            max={1}
            step={0.01}
            displayScale={100}
            unit="%"
            onChange={(v) => setHsv({ ...hsv, s: v })}
            onCommit={() => colors.pushRecent(colors.fg)}
          />
          <Slider
            label="V"
            value={hsv.v}
            min={0}
            max={1}
            step={0.01}
            displayScale={100}
            unit="%"
            onChange={(v) => setHsv({ ...hsv, v })}
            onCommit={() => colors.pushRecent(colors.fg)}
          />
        </>
      ) : (
        <>
          <Slider
            label="R"
            value={fg.r * 255}
            min={0}
            max={255}
            step={1}
            onChange={(v) => setRgb({ ...fg, r: v / 255 })}
            onCommit={() => colors.pushRecent(colors.fg)}
          />
          <Slider
            label="G"
            value={fg.g * 255}
            min={0}
            max={255}
            step={1}
            onChange={(v) => setRgb({ ...fg, g: v / 255 })}
            onCommit={() => colors.pushRecent(colors.fg)}
          />
          <Slider
            label="B"
            value={fg.b * 255}
            min={0}
            max={255}
            step={1}
            onChange={(v) => setRgb({ ...fg, b: v / 255 })}
            onCommit={() => colors.pushRecent(colors.fg)}
          />
        </>
      )}
      <Slider
        label="Alpha"
        value={alpha}
        min={0}
        max={1}
        step={0.01}
        displayScale={100}
        unit="%"
        defaultValue={1}
        hint="Colour transparency. Multiplies the brush opacity."
        onChange={(v) => colors.setFgAlpha(v)}
      />
      {recent.length ? (
        <div className="swatch-row" aria-label="Recent colours">
          <span className="row-label">Recent</span>
          <div className="swatches">
            {recent.map((h) => {
              const p = parseHex(h)!;
              return <Swatch key={h} color={p} onClick={() => setRgb(p, true)} size={18} />;
            })}
          </div>
        </div>
      ) : null}
      <div className="swatch-row" aria-label="Colour harmonies">
        <select
          className="harmony-select"
          value={hk}
          aria-label="Harmony"
          onChange={(e) => setHk(e.target.value as HarmonyKind)}
        >
          <option value="complementary">Complementary</option>
          <option value="analogous">Analogous</option>
          <option value="triadic">Triadic</option>
          <option value="split">Split complementary</option>
          <option value="tetradic">Tetradic</option>
        </select>
        <div className="swatches">
          {harmony(fg, hk).map((c, i) => (
            <Swatch key={i} color={c} onClick={() => setRgb(c, true)} size={22} />
          ))}
        </div>
      </div>
    </div>
  );
}
