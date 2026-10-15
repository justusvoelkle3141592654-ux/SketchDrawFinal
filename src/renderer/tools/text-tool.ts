// Raster text: click to place an editing box, type, then commit to a new layer.
import { create } from 'zustand';
import { TileGrid } from '../engine/tiles';
import { addLayerWithPixels } from '../engine/layer-ops';
import { useColors } from '../state/colors';
import { toolOpts } from '../state/tool-options';
import { rgbToCss } from '../engine/color';
import { useDocs, type DocumentSession } from '../state/documents';
import type { Tool, ToolContext, ToolPointer } from './types';

export interface TextEditState {
  active: boolean;
  session: DocumentSession | null;
  x: number;
  y: number;
  text: string;
}

export const useTextEdit = create<TextEditState>(() => ({
  active: false,
  session: null,
  x: 0,
  y: 0,
  text: '',
}));

export function textFont(): string {
  const o = toolOpts().text;
  return `${o.italic ? 'italic ' : ''}${o.bold ? '700 ' : '400 '}${o.size}px "${o.font}", sans-serif`;
}

/** Rasterises the current text into a new layer. */
export function commitText(): void {
  const st = useTextEdit.getState();
  useTextEdit.setState({ active: false, text: '', session: null });
  const s = st.session;
  if (!s || !st.text.trim()) return;
  const o = toolOpts().text;
  const lines = st.text.replace(/\r/g, '').split('\n');
  const c = document.createElement('canvas');
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.font = textFont();
  const lineH = o.size * o.lineHeight;
  const widths = lines.map((l) => g.measureText(l).width);
  const maxW = Math.ceil(Math.max(1, ...widths)) + Math.ceil(o.size * 0.5);
  const totalH = Math.ceil(lineH * lines.length + o.size * 0.4);
  if (maxW * totalH > 64e6) return;
  c.width = maxW;
  c.height = totalH;
  g.font = textFont();
  g.textBaseline = 'top';
  g.fillStyle = rgbToCss(useColors.getState().fg, useColors.getState().fgAlpha);
  const pad = Math.ceil(o.size * 0.25);
  lines.forEach((line, i) => {
    const w = widths[i];
    const x = o.align === 'left' ? pad : o.align === 'center' ? (maxW - w) / 2 : maxW - w - pad;
    g.fillText(line, x, i * lineH + o.size * 0.1);
  });
  const img = g.getImageData(0, 0, c.width, c.height);
  const ox = Math.round(st.x - (o.align === 'left' ? pad : o.align === 'center' ? maxW / 2 : maxW - pad));
  const oy = Math.round(st.y);
  const grid = new TileGrid(s.doc.tileSize);
  // crop to the document
  const x0 = Math.max(0, ox);
  const y0 = Math.max(0, oy);
  const x1 = Math.min(s.doc.width, ox + c.width);
  const y1 = Math.min(s.doc.height, oy + c.height);
  if (x1 <= x0 || y1 <= y0) return;
  const w = x1 - x0;
  const h = y1 - y0;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    data.set(
      img.data.subarray(
        ((y0 - oy + y) * c.width + (x0 - ox)) * 4,
        ((y0 - oy + y) * c.width + (x0 - ox) + w) * 4,
      ),
      y * w * 4,
    );
  grid.writeRect({ x: x0, y: y0, w, h }, data);
  const name = `Text: ${lines[0].slice(0, 24) || 'text'}`;
  const { entry } = addLayerWithPixels(s.doc, name, grid);
  s.history.push(entry);
  useDocs.getState().bump();
}

export function cancelText(): void {
  useTextEdit.setState({ active: false, text: '', session: null });
}

export class TextTool implements Tool {
  cursor() {
    return 'text';
  }
  down(p: ToolPointer, ctx: ToolContext) {
    const st = useTextEdit.getState();
    if (st.active) commitText();
    useTextEdit.setState({ active: true, session: ctx.session, x: p.x, y: p.y, text: '' });
    return false;
  }
  move() {}
  up() {}
  cancel() {}
  deactivate() {
    if (useTextEdit.getState().active) commitText();
  }
}
