// Cut / copy / copy merged / paste / paste as new layer. Internal clipboard keeps exact pixels and
// position; the system clipboard receives a PNG so other applications can paste.
import { Compositor } from '../engine/compositor';
import { TileDiffRecorder } from '../engine/history';
import { addLayerWithPixels } from '../engine/layer-ops';
import { clearBlock, extractBlock, trimBlock, type PixelBlock } from '../engine/pixel-ops';
import { maskBounds } from '../engine/selection';
import { TileGrid } from '../engine/tiles';
import { encodePng } from '../engine/io/png';
import { forge } from '../platform';
import { activeSession, useDocs } from '../state/documents';
import { toast } from '../state/ui';
import { decodeImageBytes } from './image-codec';
import { beginPasteTransform } from '../tools/transform-tool';
import { requestRedraw } from './actions';

let internal: { block: PixelBlock; w: number; h: number } | null = null;

function selectionArea() {
  const s = activeSession();
  if (!s) return null;
  const sel = s.doc.selection;
  const area = sel ? maskBounds(sel) : s.doc.bounds;
  return area ? { s, sel, area } : null;
}

async function toSystem(block: PixelBlock) {
  try {
    await forge.clipboardWriteImage(encodePng(block.w, block.h, block.data, { level: 3 }));
  } catch {
    // system clipboard is optional
  }
}

export async function copy(merged = false): Promise<boolean> {
  const a = selectionArea();
  if (!a) return false;
  const { s, sel, area } = a;
  let block: PixelBlock | null;
  if (merged) {
    const data = new Compositor(s.doc).compositeToRGBA(area);
    block = { ...area, data };
    if (sel) {
      const m = sel.readRect(area);
      for (let i = 0; i < m.length; i++) data[i * 4 + 3] = (data[i * 4 + 3] * m[i]) / 255;
    }
    block = trimBlock(block);
  } else {
    const l = s.doc.activeRaster;
    if (!l) {
      toast('info', 'Select a paint layer to copy from.');
      return false;
    }
    block = trimBlock(extractBlock(l.pixels, area, sel));
  }
  if (!block) {
    toast('info', 'Nothing to copy here.');
    return false;
  }
  internal = { block, w: block.w, h: block.h };
  await toSystem(block);
  toast('success', `Copied ${block.w} × ${block.h} px${merged ? ' (merged)' : ''}.`);
  return true;
}

export async function cut(): Promise<void> {
  const a = selectionArea();
  if (!a) return;
  const l = a.s.doc.activeRaster;
  if (!l) return toast('info', 'Select a paint layer to cut from.');
  if (l.locked) return toast('warning', `"${l.name}" is locked.`);
  if (!(await copy(false))) return;
  const rec = new TileDiffRecorder(l.pixels);
  clearBlock(l.pixels, rec, a.area, a.sel);
  const e = rec.toEntry('Cut', (r) => a.s.doc.markPixelsChanged(r));
  if (e) a.s.history.push(e);
  a.s.doc.markPixelsChanged(null);
  requestRedraw();
}

/** Prefers the internal clipboard when the system clipboard still holds the image we copied. */
async function clipboardBlock(): Promise<{ block: PixelBlock; placed: boolean } | null> {
  const png = await forge.clipboardReadImage().catch(() => null);
  if (png) {
    try {
      const img = await decodeImageBytes(png, 'clipboard.png');
      if (internal && img.width === internal.w && img.height === internal.h)
        return { block: internal.block, placed: true };
      return { block: { x: 0, y: 0, w: img.width, h: img.height, data: img.data }, placed: false };
    } catch {
      // fall back to the internal clipboard
    }
  }
  if (internal) return { block: internal.block, placed: true };
  return null;
}

function centred(block: PixelBlock, docW: number, docH: number): PixelBlock {
  return { ...block, x: Math.round((docW - block.w) / 2), y: Math.round((docH - block.h) / 2) };
}

/** Paste floats the pixels on the active layer with the transform tool (Enter applies). */
export async function paste(): Promise<void> {
  const s = activeSession();
  if (!s) return;
  const c = await clipboardBlock();
  if (!c) return toast('info', 'The clipboard has no image.');
  const block = c.placed ? c.block : centred(c.block, s.doc.width, s.doc.height);
  if (beginPasteTransform(s, block))
    toast('info', 'Position the pasted pixels, then press Enter to apply or Esc to cancel.');
  requestRedraw();
}

/** Paste as a new layer at the original position (or centred for external images). */
export async function pasteAsLayer(): Promise<void> {
  const s = activeSession();
  if (!s) return;
  const c = await clipboardBlock();
  if (!c) return toast('info', 'The clipboard has no image.');
  const block = c.placed ? c.block : centred(c.block, s.doc.width, s.doc.height);
  const grid = new TileGrid(s.doc.tileSize);
  const x0 = Math.max(0, block.x);
  const y0 = Math.max(0, block.y);
  const x1 = Math.min(s.doc.width, block.x + block.w);
  const y1 = Math.min(s.doc.height, block.y + block.h);
  if (x1 <= x0 || y1 <= y0) return toast('info', 'The pasted image lies outside the canvas.');
  const w = x1 - x0;
  const h = y1 - y0;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    data.set(
      block.data.subarray(
        ((y0 - block.y + y) * block.w + (x0 - block.x)) * 4,
        ((y0 - block.y + y) * block.w + (x0 - block.x) + w) * 4,
      ),
      y * w * 4,
    );
  grid.writeRect({ x: x0, y: y0, w, h }, data);
  const { entry } = addLayerWithPixels(s.doc, 'Pasted', grid);
  s.history.push(entry);
  useDocs.getState().bump();
  requestRedraw();
}
