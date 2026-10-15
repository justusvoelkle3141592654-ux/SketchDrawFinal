// On-canvas visuals for symmetry axes, guides, grid and the selection outline.
import type { OverlayInfo } from '../render/canvas-renderer';
import { drawSelectionOutline } from './selection-overlay';

function dashed(c: CanvasRenderingContext2D, draw: () => void, color = 'rgba(93, 214, 200, 0.9)') {
  c.lineWidth = 1;
  c.setLineDash([6, 4]);
  c.strokeStyle = 'rgba(0,0,0,0.6)';
  c.lineDashOffset = 0;
  draw();
  c.stroke();
  c.strokeStyle = color;
  c.lineDashOffset = 5;
  draw();
  c.stroke();
  c.setLineDash([]);
}

export function drawAssistOverlay(c: CanvasRenderingContext2D, info: OverlayInfo) {
  const { session, toScreen } = info;
  const a = session.assist;
  const doc = session.doc;
  if (a.grid.visible && a.grid.size * info.zoom >= 6) {
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(140, 150, 165, 0.28)';
    c.beginPath();
    for (let x = 0; x <= doc.width; x += a.grid.size) {
      const p = toScreen({ x, y: 0 });
      const q = toScreen({ x, y: doc.height });
      c.moveTo(p.x, p.y);
      c.lineTo(q.x, q.y);
    }
    for (let y = 0; y <= doc.height; y += a.grid.size) {
      const p = toScreen({ x: 0, y });
      const q = toScreen({ x: doc.width, y });
      c.moveTo(p.x, p.y);
      c.lineTo(q.x, q.y);
    }
    c.stroke();
  }
  const sym = a.symmetry;
  if (sym.mode !== 'off') {
    const center = toScreen({ x: sym.cx, y: sym.cy });
    const L = Math.max(doc.width, doc.height) * 1.5;
    const line = (ang: number) => {
      const p = toScreen({ x: sym.cx + Math.cos(ang) * L, y: sym.cy + Math.sin(ang) * L });
      const q = toScreen({ x: sym.cx - Math.cos(ang) * L, y: sym.cy - Math.sin(ang) * L });
      c.beginPath();
      c.moveTo(p.x, p.y);
      c.lineTo(q.x, q.y);
    };
    const accent = 'rgba(139, 110, 240, 0.95)';
    if (sym.mode === 'vertical' || sym.mode === 'both') dashed(c, () => line(Math.PI / 2), accent);
    if (sym.mode === 'horizontal' || sym.mode === 'both') dashed(c, () => line(0), accent);
    if (sym.mode === 'radial' || sym.mode === 'kaleido') {
      const n = Math.max(2, Math.round(sym.segments));
      for (let k = 0; k < n; k++) {
        const ang = -Math.PI / 2 + (k * Math.PI * 2) / n;
        dashed(
          c,
          () => {
            const q = toScreen({ x: sym.cx + Math.cos(ang) * L, y: sym.cy + Math.sin(ang) * L });
            c.beginPath();
            c.moveTo(center.x, center.y);
            c.lineTo(q.x, q.y);
          },
          accent,
        );
      }
    }
    c.fillStyle = accent;
    c.beginPath();
    c.arc(center.x, center.y, 4, 0, Math.PI * 2);
    c.fill();
  }
  if (a.ruler.enabled) {
    const p = toScreen(a.ruler.a);
    const q = toScreen(a.ruler.b);
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const ext = 4000;
    dashed(c, () => {
      c.beginPath();
      c.moveTo(p.x - (dx / len) * ext, p.y - (dy / len) * ext);
      c.lineTo(q.x + (dx / len) * ext, q.y + (dy / len) * ext);
    });
    for (const h of [p, q]) {
      c.fillStyle = 'rgba(93, 214, 200, 0.95)';
      c.strokeStyle = 'rgba(0,0,0,0.6)';
      c.beginPath();
      c.arc(h.x, h.y, 6, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
  }
  if (a.ellipse.enabled) {
    const e = a.ellipse;
    dashed(c, () => {
      c.beginPath();
      for (let i = 0; i <= 96; i++) {
        const t = (i / 96) * Math.PI * 2;
        const ex = e.rx * Math.cos(t);
        const ey = e.ry * Math.sin(t);
        const p = toScreen({
          x: e.cx + ex * Math.cos(e.angle) - ey * Math.sin(e.angle),
          y: e.cy + ex * Math.sin(e.angle) + ey * Math.cos(e.angle),
        });
        if (i) c.lineTo(p.x, p.y);
        else c.moveTo(p.x, p.y);
      }
    });
    const ctr = toScreen({ x: e.cx, y: e.cy });
    c.fillStyle = 'rgba(93, 214, 200, 0.95)';
    c.beginPath();
    c.arc(ctr.x, ctr.y, 4, 0, Math.PI * 2);
    c.fill();
  }
  if (a.perspective.enabled) {
    const vps = a.perspective.vps.slice(0, a.perspective.mode);
    c.lineWidth = 1;
    for (const vp of vps) {
      const s = toScreen(vp);
      c.strokeStyle = 'rgba(227, 166, 79, 0.35)';
      c.beginPath();
      for (let k = 0; k < 24; k++) {
        const ang = (k / 24) * Math.PI * 2;
        c.moveTo(s.x, s.y);
        c.lineTo(s.x + Math.cos(ang) * 4000, s.y + Math.sin(ang) * 4000);
      }
      c.stroke();
      c.fillStyle = 'rgba(227, 166, 79, 0.95)';
      c.strokeStyle = 'rgba(0,0,0,0.6)';
      c.beginPath();
      c.arc(s.x, s.y, 6, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    if (a.perspective.mode >= 2) {
      const h1 = toScreen({ x: -doc.width * 4, y: a.perspective.horizonY });
      const h2 = toScreen({ x: doc.width * 5, y: a.perspective.horizonY });
      dashed(
        c,
        () => {
          c.beginPath();
          c.moveTo(h1.x, h1.y);
          c.lineTo(h2.x, h2.y);
        },
        'rgba(227, 166, 79, 0.9)',
      );
    }
  }
  drawSelectionOutline(c, info);
}
