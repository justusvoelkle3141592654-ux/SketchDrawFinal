// Canvas view state and the document ↔ screen coordinate transform.
import { apply, clamp, invert, multiply, rotate, scale, translate, type Mat2D, type Point } from './geometry';

export const MIN_ZOOM = 0.0625;
export const MAX_ZOOM = 64;

export interface ViewState {
  /** 1 = 100 %. */
  zoom: number;
  /** Radians, clockwise on screen. */
  rotation: number;
  /** Offset of the document centre from the viewport centre, in CSS pixels. */
  panX: number;
  panY: number;
  flipX: boolean;
  flipY: boolean;
}

export interface Viewport {
  width: number;
  height: number;
}

export const defaultView = (): ViewState => ({
  zoom: 1,
  rotation: 0,
  panX: 0,
  panY: 0,
  flipX: false,
  flipY: false,
});

/** Matrix mapping document pixels to viewport CSS pixels. */
export function viewMatrix(view: ViewState, viewport: Viewport, docW: number, docH: number): Mat2D {
  let m = translate(viewport.width / 2 + view.panX, viewport.height / 2 + view.panY);
  m = multiply(m, rotate(view.rotation));
  m = multiply(m, scale(view.flipX ? -1 : 1, view.flipY ? -1 : 1));
  m = multiply(m, scale(view.zoom));
  m = multiply(m, translate(-docW / 2, -docH / 2));
  return m;
}

export function screenToDoc(
  view: ViewState,
  viewport: Viewport,
  docW: number,
  docH: number,
  p: Point,
): Point {
  return apply(invert(viewMatrix(view, viewport, docW, docH)), p.x, p.y);
}

export function docToScreen(
  view: ViewState,
  viewport: Viewport,
  docW: number,
  docH: number,
  p: Point,
): Point {
  return apply(viewMatrix(view, viewport, docW, docH), p.x, p.y);
}

/** Changes zoom while keeping the document point under `anchor` (screen px) fixed. */
export function zoomAt(
  view: ViewState,
  viewport: Viewport,
  docW: number,
  docH: number,
  newZoom: number,
  anchor: Point,
): ViewState {
  const z = clamp(newZoom, MIN_ZOOM, MAX_ZOOM);
  const docPt = screenToDoc(view, viewport, docW, docH, anchor);
  const next = { ...view, zoom: z };
  const moved = docToScreen(next, viewport, docW, docH, docPt);
  return { ...next, panX: next.panX + (anchor.x - moved.x), panY: next.panY + (anchor.y - moved.y) };
}

/** Rotates the view around a screen anchor. */
export function rotateAt(
  view: ViewState,
  viewport: Viewport,
  docW: number,
  docH: number,
  newRotation: number,
  anchor: Point,
): ViewState {
  const docPt = screenToDoc(view, viewport, docW, docH, anchor);
  const next = { ...view, rotation: normalizeAngle(newRotation) };
  const moved = docToScreen(next, viewport, docW, docH, docPt);
  return { ...next, panX: next.panX + (anchor.x - moved.x), panY: next.panY + (anchor.y - moved.y) };
}

/**
 * Mirrors the view on screen (view only, pixels are untouched): 'x' flips left↔right, 'y' flips
 * top↔bottom, about the document centre. A screen flip of a rotated view equals the opposite
 * rotation applied to the flipped document, so the rotation changes sign; repeating restores the view.
 */
export function mirrorView(view: ViewState, axis: 'x' | 'y'): ViewState {
  return {
    ...view,
    rotation: normalizeAngle(-view.rotation),
    flipX: axis === 'x' ? !view.flipX : view.flipX,
    flipY: axis === 'y' ? !view.flipY : view.flipY,
  };
}

export function normalizeAngle(a: number): number {
  const t = Math.PI * 2;
  let r = a % t;
  if (r > Math.PI) r -= t;
  if (r <= -Math.PI) r += t;
  return r;
}

export function fitView(viewport: Viewport, docW: number, docH: number, margin = 32): ViewState {
  const zx = (viewport.width - margin * 2) / docW;
  const zy = (viewport.height - margin * 2) / docH;
  const zoom = clamp(Math.min(zx, zy), MIN_ZOOM, MAX_ZOOM);
  return { ...defaultView(), zoom };
}

/** Standard zoom steps used by zoom in/out commands. */
export const ZOOM_STEPS = [
  0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48,
  64,
];

export function nextZoomStep(zoom: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((z) => z > zoom * 1.001) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom / 1.001) ?? MIN_ZOOM;
}
