// Marching-ants outline of the document selection (filled in by the selection module).
import type { OverlayInfo } from '../render/canvas-renderer';

export type SelectionOutlineDrawer = (c: CanvasRenderingContext2D, info: OverlayInfo) => void;
let drawer: SelectionOutlineDrawer | null = null;

export function setSelectionOutlineDrawer(d: SelectionOutlineDrawer) {
  drawer = d;
}

export function drawSelectionOutline(c: CanvasRenderingContext2D, info: OverlayInfo) {
  drawer?.(c, info);
}
