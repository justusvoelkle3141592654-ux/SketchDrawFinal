// Editable response curve: drag points, double-click to add, right-click to remove (minimum kept).
import { useMemo, useRef, useState } from 'react';
import { makeCurve, normalizeCurve, type CurvePoint } from '../../engine/curve';

export function CurveEditor(props: {
  points: CurvePoint[];
  onChange: (pts: CurvePoint[]) => void;
  onCommit?: (pts: CurvePoint[]) => void;
  size?: number;
  minPoints?: number;
  maxPoints?: number;
  label: string;
  xLabel?: string;
  yLabel?: string;
  /** Live input marker (0..1) shown as a vertical line. */
  marker?: number | null;
}) {
  const size = props.size ?? 180;
  const pad = 10;
  const inner = size - pad * 2;
  const minPts = props.minPoints ?? 5;
  const maxPts = props.maxPoints ?? 10;
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [focus, setFocus] = useState(0);
  const pts = props.points;
  const f = useMemo(() => makeCurve(pts), [pts]);
  const path = useMemo(() => {
    let d = '';
    for (let i = 0; i <= 64; i++) {
      const x = i / 64;
      d += `${i ? 'L' : 'M'}${pad + x * inner},${pad + (1 - f(x)) * inner}`;
    }
    return d;
  }, [f, inner]);
  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left - pad) / inner)),
      y: Math.min(1, Math.max(0, 1 - (e.clientY - r.top - pad) / inner)),
    };
  };
  const movePoint = (i: number, p: CurvePoint): CurvePoint[] => {
    const next = pts.map((q) => ({ ...q }));
    const isEnd = i === 0 || i === pts.length - 1;
    const lo = i > 0 ? pts[i - 1].x + 0.01 : 0;
    const hi = i < pts.length - 1 ? pts[i + 1].x - 0.01 : 1;
    next[i] = { x: isEnd ? pts[i].x : Math.min(hi, Math.max(lo, p.x)), y: p.y };
    return next;
  };
  return (
    <div className="curve-editor">
      <svg
        ref={svgRef}
        width={size}
        height={size}
        role="group"
        aria-label={`${props.label}. Arrow keys move the selected point; Tab moves between points.`}
        onDoubleClick={(e) => {
          if (pts.length >= maxPts) return;
          const p = toLocal(e);
          const next = normalizeCurve([...pts, p]);
          props.onChange(next);
          props.onCommit?.(next);
        }}
        onPointerMove={(e) => {
          if (drag === null) return;
          props.onChange(movePoint(drag, toLocal(e)));
        }}
        onPointerUp={() => {
          if (drag !== null) props.onCommit?.(pts);
          setDrag(null);
        }}
      >
        <rect x={pad} y={pad} width={inner} height={inner} className="curve-bg" />
        {[0.25, 0.5, 0.75].map((g) => (
          <g key={g} className="curve-grid">
            <line x1={pad + g * inner} y1={pad} x2={pad + g * inner} y2={pad + inner} />
            <line x1={pad} y1={pad + g * inner} x2={pad + inner} y2={pad + g * inner} />
          </g>
        ))}
        <line x1={pad} y1={pad + inner} x2={pad + inner} y2={pad} className="curve-diag" />
        {props.marker !== undefined && props.marker !== null ? (
          <line
            x1={pad + props.marker * inner}
            y1={pad}
            x2={pad + props.marker * inner}
            y2={pad + inner}
            className="curve-marker"
          />
        ) : null}
        <path d={path} className="curve-line" />
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={pad + p.x * inner}
            cy={pad + (1 - p.y) * inner}
            r={drag === i || focus === i ? 6.5 : 5.5}
            className={`curve-point ${focus === i ? 'is-focus' : ''}`}
            tabIndex={0}
            role="slider"
            aria-label={`Point ${i + 1}: input ${Math.round(p.x * 100)} %, output ${Math.round(p.y * 100)} %`}
            aria-valuenow={Math.round(p.y * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            onFocus={() => setFocus(i)}
            onKeyDown={(e) => {
              const st = e.shiftKey ? 0.1 : 0.01;
              let q = { ...p };
              if (e.key === 'ArrowUp') q.y = Math.min(1, p.y + st);
              else if (e.key === 'ArrowDown') q.y = Math.max(0, p.y - st);
              else if (e.key === 'ArrowLeft') q.x = Math.max(0, p.x - st);
              else if (e.key === 'ArrowRight') q.x = Math.min(1, p.x + st);
              else if (
                (e.key === 'Delete' || e.key === 'Backspace') &&
                pts.length > minPts &&
                i > 0 &&
                i < pts.length - 1
              ) {
                const next = pts.filter((_, j) => j !== i);
                props.onChange(next);
                props.onCommit?.(next);
                e.preventDefault();
                return;
              } else return;
              e.preventDefault();
              q = movePoint(i, q)[i];
              const next = pts.map((r, j) => (j === i ? q : r));
              props.onChange(next);
              props.onCommit?.(next);
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId);
              setDrag(i);
              setFocus(i);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (pts.length > minPts && i > 0 && i < pts.length - 1) {
                const next = pts.filter((_, j) => j !== i);
                props.onChange(next);
                props.onCommit?.(next);
              }
            }}
          />
        ))}
      </svg>
      <div className="curve-axes">
        <span>{props.xLabel ?? 'Input'}</span>
        <span>{props.yLabel ?? 'Output'}</span>
      </div>
    </div>
  );
}

/** Ensures a curve has at least `n` points by inserting evaluated points. */
export function withMinPoints(pts: CurvePoint[], n = 5): CurvePoint[] {
  const p = normalizeCurve(pts);
  if (p.length >= n) return p;
  const f = makeCurve(p);
  const out = [...p];
  const xs = [0.25, 0.5, 0.75, 0.125, 0.375, 0.625, 0.875];
  for (const x of xs) {
    if (out.length >= n) break;
    if (!out.some((q) => Math.abs(q.x - x) < 0.05)) out.push({ x, y: f(x) });
  }
  return normalizeCurve(out);
}
