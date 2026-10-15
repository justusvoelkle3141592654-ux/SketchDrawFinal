// In-place text editing box for the text tool.
import { useEffect, useRef } from 'react';
import { useTextEdit, commitText, cancelText } from '../tools/text-tool';
import { useToolOptions } from '../state/tool-options';
import { useColors } from '../state/colors';
import { rgbToCss } from '../engine/color';
import { viewMatrix } from '../engine/view';
import { apply } from '../engine/geometry';
import { canvasViewport } from '../app/actions';

export function TextOverlay() {
  const st = useTextEdit();
  const o = useToolOptions((s) => s.opts.text);
  const fg = useColors((s) => s.fg);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (st.active) setTimeout(() => ref.current?.focus(), 0);
  }, [st.active]);
  if (!st.active || !st.session) return null;
  const s = st.session;
  const m = viewMatrix(s.view, canvasViewport, s.doc.width, s.doc.height);
  const p = apply(m, st.x, st.y);
  const zoom = s.view.zoom;
  const rows = Math.max(1, st.text.split('\n').length);
  const longest = Math.max(4, ...st.text.split('\n').map((l) => l.length));
  return (
    <textarea
      ref={ref}
      className="text-overlay"
      aria-label="Text to place on the canvas. Ctrl+Enter places it, Escape cancels."
      value={st.text}
      spellCheck={false}
      onChange={(e) => useTextEdit.setState({ text: e.target.value })}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          commitText();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          cancelText();
        }
      }}
      rows={rows}
      style={{
        left:
          o.align === 'left'
            ? p.x
            : o.align === 'center'
              ? p.x - longest * o.size * zoom * 0.3
              : p.x - longest * o.size * zoom * 0.6,
        top: p.y,
        font: `${o.italic ? 'italic ' : ''}${o.bold ? '700 ' : '400 '}${o.size * zoom}px "${o.font}", sans-serif`,
        lineHeight: o.lineHeight,
        color: rgbToCss(fg),
        textAlign: o.align,
        width: Math.max(80, longest * o.size * zoom * 0.62),
        transform: `rotate(${s.view.rotation}rad)`,
        transformOrigin: '0 0',
      }}
      data-testid="text-overlay"
    />
  );
}
