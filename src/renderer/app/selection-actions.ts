// Selection commands and the marching-ants outline.
import type { MaskGrid } from '../engine/tiles';
import {
  combineMasks,
  featherMask,
  growMask,
  invertMask,
  maskOutline,
  selectAllMask,
  selectionEntry,
  type CombineMode,
} from '../engine/selection';
import { activeSession, useDocs, type DocumentSession } from '../state/documents';
import { toolOpts } from '../state/tool-options';
import { toast } from '../state/ui';
import { requestRedraw } from './actions';
import { setSelectionOutlineDrawer } from '../tools/selection-overlay';
import { prompt } from './prompt';
import { isTransforming } from '../tools/transform-tool';

/** Combines a new mask into the document selection with one undo step. */
export function commitSelection(
  s: DocumentSession,
  mask: MaskGrid | null,
  mode: CombineMode,
  label: string,
  feather = toolOpts().select.feather,
) {
  const doc = s.doc;
  const before = doc.selection;
  let next = mask ? combineMasks(before, mask, mode) : mode === 'replace' ? null : before;
  if (next && feather > 0 && mask) next = featherMask(doc, next, feather);
  if (next === before) return;
  const e = selectionEntry(doc, label, before, next);
  e.redo();
  s.history.push(e);
  requestRedraw();
  useDocs.getState().bump();
}

export function selectAll() {
  const s = activeSession();
  if (s) commitSelection(s, selectAllMask(s.doc), 'replace', 'Select all', 0);
}

export function deselect() {
  const s = activeSession();
  if (!s || !s.doc.selection) return;
  commitSelection(s, null, 'replace', 'Deselect', 0);
}

export function invertSelection() {
  const s = activeSession();
  if (!s) return;
  const doc = s.doc;
  const before = doc.selection;
  const e = selectionEntry(doc, 'Invert selection', before, invertMask(doc, before));
  e.redo();
  s.history.push(e);
  requestRedraw();
  useDocs.getState().bump();
}

export async function featherSelection() {
  const s = activeSession();
  if (!s?.doc.selection) return toast('info', 'There is no selection to feather.');
  const v = await prompt({
    title: 'Feather selection',
    label: 'Radius',
    unit: 'px',
    value: 8,
    min: 0.5,
    max: 250,
  });
  if (v === null) return;
  const doc = s.doc;
  const before = doc.selection;
  const e = selectionEntry(doc, `Feather ${v}px`, before, featherMask(doc, before!, v));
  e.redo();
  s.history.push(e);
  requestRedraw();
  useDocs.getState().bump();
}

export async function growSelection(sign: 1 | -1) {
  const s = activeSession();
  if (!s?.doc.selection) return toast('info', 'There is no selection.');
  const v = await prompt({
    title: sign > 0 ? 'Expand selection' : 'Contract selection',
    label: 'By',
    unit: 'px',
    value: 4,
    min: 1,
    max: 100,
    integer: true,
  });
  if (v === null) return;
  const doc = s.doc;
  const before = doc.selection;
  const e = selectionEntry(
    doc,
    sign > 0 ? `Expand ${v}px` : `Contract ${v}px`,
    before,
    growMask(doc, before!, sign * v),
  );
  e.redo();
  s.history.push(e);
  requestRedraw();
  useDocs.getState().bump();
}

// ------------------------------------------------------------------------------ marching ants

let cache: { docId: string; version: number; segs: number[] } | null = null;
let antsTimer: ReturnType<typeof setInterval> | null = null;
let antsPhase = 0;

function ensureAntsTimer(on: boolean) {
  if (on && !antsTimer) {
    antsTimer = setInterval(() => {
      antsPhase = (antsPhase + 1) % 16;
      requestRedraw();
    }, 140);
  } else if (!on && antsTimer) {
    clearInterval(antsTimer);
    antsTimer = null;
  }
}

setSelectionOutlineDrawer((c, info) => {
  const doc = info.session.doc;
  const sel = doc.selection;
  ensureAntsTimer(!!sel);
  // while the selection floats with the transform tool, its frame replaces the outline
  if (!sel || isTransforming(info.session)) return;
  if (!cache || cache.docId !== doc.id || cache.version !== doc.selectionVersion) {
    cache = { docId: doc.id, version: doc.selectionVersion, segs: maskOutline(sel, doc.width, doc.height) };
  }
  const segs = cache.segs;
  const m = info.matrix;
  c.save();
  c.setTransform(
    info.dpr * m[0],
    info.dpr * m[1],
    info.dpr * m[2],
    info.dpr * m[3],
    info.dpr * m[4],
    info.dpr * m[5],
  );
  c.beginPath();
  for (let i = 0; i < segs.length; i += 4) {
    c.moveTo(segs[i], segs[i + 1]);
    c.lineTo(segs[i + 2], segs[i + 3]);
  }
  c.restore();
  // The outline is many short pixel-edge segments; a dash pattern would restart on each one (and can
  // vanish on diagonals), so the ants are a diagonal stripe pattern shifted over time instead.
  const pattern = antsPattern(c);
  c.lineWidth = 1;
  if (pattern) {
    pattern.setTransform(new DOMMatrix().translateSelf(antsPhase, 0));
    c.strokeStyle = pattern;
  } else c.strokeStyle = '#000';
  c.stroke();
});

let pattern: CanvasPattern | null = null;
function antsPattern(c: CanvasRenderingContext2D): CanvasPattern | null {
  if (pattern) return pattern;
  const tile = document.createElement('canvas');
  tile.width = tile.height = 16;
  const g = tile.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#000';
  // XOR of two crossing stripe sets so that no line direction runs along a single colour
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) if ((x + y) % 8 < 4 !== (x - y + 16) % 16 < 8) g.fillRect(x, y, 1, 1);
  pattern = c.createPattern(tile, 'repeat');
  return pattern;
}
