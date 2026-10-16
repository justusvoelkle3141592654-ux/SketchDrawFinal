// Document-level actions shared by commands, panels and Orbit.
import type { HistoryEntry } from '../engine/history';
import * as ops from '../engine/layer-ops';
import { fitView, mirrorView, nextZoomStep, rotateAt, zoomAt, type Viewport } from '../engine/view';
import { activeSession, useDocs, type DocumentSession } from '../state/documents';
import { confirmDialog, toast, useUi } from '../state/ui';
import { usePrefs } from '../state/preferences';

/** Size of the canvas element in CSS px (kept up to date by CanvasView). */
export const canvasViewport: Viewport = { width: 1200, height: 800 };
let redraw: () => void = () => undefined;
export function setRedrawHandler(fn: () => void) {
  redraw = fn;
}
export function requestRedraw() {
  redraw();
}

export function withSession(fn: (s: DocumentSession) => void) {
  const s = activeSession();
  if (s) fn(s);
}

export function pushEntry(s: DocumentSession, e: HistoryEntry | null) {
  if (e) s.history.push(e);
}

// ------------------------------------------------------------------------------------ history

export function undo() {
  withSession((s) => {
    if (useUi.getState().drawing) return;
    if (!s.history.undo()) toast('info', 'Nothing to undo.');
    requestRedraw();
  });
}

export function redo() {
  withSession((s) => {
    if (useUi.getState().drawing) return;
    if (!s.history.redo()) toast('info', 'Nothing to redo.');
    requestRedraw();
  });
}

// ------------------------------------------------------------------------------------ view

function setView(s: DocumentSession, v: DocumentSession['view']) {
  s.view = v;
  requestRedraw();
  useDocs.getState().bump();
}

export function zoomStep(dir: 1 | -1) {
  withSession((s) => {
    const center = { x: canvasViewport.width / 2, y: canvasViewport.height / 2 };
    setView(
      s,
      zoomAt(s.view, canvasViewport, s.doc.width, s.doc.height, nextZoomStep(s.view.zoom, dir), center),
    );
  });
}

export function setZoom(z: number) {
  withSession((s) => {
    const center = { x: canvasViewport.width / 2, y: canvasViewport.height / 2 };
    setView(s, zoomAt(s.view, canvasViewport, s.doc.width, s.doc.height, z, center));
  });
}

export function fitToScreen() {
  withSession((s) => {
    const f = fitView(canvasViewport, s.doc.width, s.doc.height);
    setView(s, { ...f, flipX: s.view.flipX, flipY: s.view.flipY });
  });
}

export function actualPixels() {
  withSession((s) => setView(s, { ...s.view, zoom: 1, panX: 0, panY: 0 }));
}

export function resetRotation() {
  withSession((s) => {
    const c = { x: canvasViewport.width / 2, y: canvasViewport.height / 2 };
    setView(s, rotateAt(s.view, canvasViewport, s.doc.width, s.doc.height, 0, c));
  });
}

export function rotateBy(deg: number) {
  withSession((s) => {
    const c = { x: canvasViewport.width / 2, y: canvasViewport.height / 2 };
    setView(
      s,
      rotateAt(s.view, canvasViewport, s.doc.width, s.doc.height, s.view.rotation + (deg * Math.PI) / 180, c),
    );
  });
}

/** Mirrors the view horizontally ('x') or vertically ('y') as seen on screen; pixels are unchanged. */
export function toggleMirror(axis: 'x' | 'y' = 'x') {
  withSession((s) => setView(s, mirrorView(s.view, axis)));
}

export function resetView() {
  fitToScreen();
}

// ------------------------------------------------------------------------------------ layers

export function newLayer() {
  withSession((s) => pushEntry(s, ops.addRasterLayer(s.doc).entry));
}

export function newGroup() {
  withSession((s) => pushEntry(s, ops.addGroup(s.doc)));
}

export function groupLayer() {
  withSession((s) => pushEntry(s, ops.groupActive(s.doc)));
}

export function duplicateLayer() {
  withSession((s) => pushEntry(s, ops.duplicateLayer(s.doc, s.doc.activeLayerId)));
}

export async function deleteLayer(id?: string) {
  const s = activeSession();
  if (!s) return;
  const target = id ?? s.doc.activeLayerId;
  const node = s.doc.getLayer(target);
  if (!node) return;
  if (usePrefs.getState().prefs.confirmOnLayerDelete) {
    const r = await confirmDialog({
      title: 'Delete layer?',
      message: `Delete "${node.name}"? You can undo this.`,
      buttons: [
        { id: 'delete', label: 'Delete', kind: 'danger' },
        { id: 'cancel', label: 'Cancel' },
      ],
      cancelId: 'cancel',
    });
    if (r !== 'delete') return;
  }
  const e = ops.deleteLayer(s.doc, target);
  if (!e) toast('info', 'A document needs at least one layer.');
  pushEntry(s, e);
}

export function mergeDown() {
  withSession((s) => {
    const problem = ops.mergeDownProblem(s.doc, s.doc.activeLayerId);
    if (problem) return toast('info', problem);
    pushEntry(s, ops.mergeDown(s.doc, s.doc.activeLayerId));
  });
}

export function mergeVisible() {
  withSession((s) => {
    const e = ops.mergeVisible(s.doc);
    if (!e) toast('info', 'Merge visible needs at least two visible layers.');
    pushEntry(s, e);
  });
}

export function flattenCopy() {
  withSession((s) => pushEntry(s, ops.flattenCopy(s.doc)));
}

export function clearLayer() {
  withSession((s) => {
    const l = s.doc.activeLayer;
    if (!l || l.kind !== 'raster') return toast('info', 'Select a paint layer to clear.');
    if (l.locked) return toast('warning', `"${l.name}" is locked.`);
    pushEntry(s, ops.clearLayer(s.doc, l.id));
    requestRedraw();
  });
}

export function setLayerProps(id: string, props: ops.LayerProps, label?: string) {
  withSession((s) => pushEntry(s, ops.setLayerProps(s.doc, id, props, label)));
}

export function selectLayer(id: string) {
  withSession((s) => {
    if (s.doc.activeLayerId === id) return;
    s.doc.activeLayerId = id;
    s.doc.structureVersion++;
    useDocs.getState().bump();
  });
}

export function selectLayerRelative(dir: 1 | -1) {
  withSession((s) => {
    const flat = s.doc.layers.length ? flattenIds(s) : [];
    const i = flat.indexOf(s.doc.activeLayerId);
    const j = i - dir; // panel order is top → bottom
    if (j >= 0 && j < flat.length) selectLayer(flat[j]);
  });
}

function flattenIds(s: DocumentSession): string[] {
  const out: string[] = [];
  const walk = (list: typeof s.doc.layers) => {
    for (let i = list.length - 1; i >= 0; i--) {
      out.push(list[i].id);
      const n = list[i];
      if (n.kind === 'group' && n.expanded) walk(n.children);
    }
  };
  walk(s.doc.layers);
  return out;
}

export function toggleAlphaLock() {
  withSession((s) => {
    const l = s.doc.activeRaster;
    if (l)
      pushEntry(
        s,
        ops.setLayerProps(
          s.doc,
          l.id,
          { alphaLock: !l.alphaLock },
          l.alphaLock ? 'Unlock alpha' : 'Lock alpha',
        ),
      );
  });
}

export function toggleClip() {
  withSession((s) => {
    const l = s.doc.activeRaster;
    if (l)
      pushEntry(
        s,
        ops.setLayerProps(
          s.doc,
          l.id,
          { clip: !l.clip },
          l.clip ? 'Release clipping mask' : 'Create clipping mask',
        ),
      );
  });
}

export function addMask(fromSelection = false) {
  withSession((s) => {
    const e = ops.addMask(s.doc, s.doc.activeLayerId, fromSelection);
    if (!e) toast('info', 'Select a paint layer without a mask.');
    pushEntry(s, e);
  });
}

export function deleteMask() {
  withSession((s) => pushEntry(s, ops.deleteMask(s.doc, s.doc.activeLayerId)));
}

export function applyMask() {
  withSession((s) => pushEntry(s, ops.applyMask(s.doc, s.doc.activeLayerId)));
}

export function moveLayerTo(id: string, parentId: string | null, index: number) {
  withSession((s) => pushEntry(s, ops.moveLayer(s.doc, id, parentId, index)));
}

export function nudgeActiveLayer(dir: 1 | -1) {
  withSession((s) => pushEntry(s, ops.nudgeLayer(s.doc, s.doc.activeLayerId, dir)));
}
