// Rectangles and 2D affine matrices used across the engine.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export const emptyRect = (): Rect => ({ x: 0, y: 0, w: 0, h: 0 });

export function isEmptyRect(r: Rect): boolean {
  return r.w <= 0 || r.h <= 0;
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a || isEmptyRect(a)) return { ...b };
  if (isEmptyRect(b)) return { ...a };
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function intersectRect(a: Rect, b: Rect): Rect {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** Expands a floating-point rect outward to integer pixel bounds. */
export function pixelBounds(x0: number, y0: number, x1: number, y1: number): Rect {
  const ix0 = Math.floor(x0);
  const iy0 = Math.floor(y0);
  return { x: ix0, y: iy0, w: Math.ceil(x1) - ix0, h: Math.ceil(y1) - iy0 };
}

/** Splits a rect into per-tile sub-rects. Callback receives tile coords and the clipped rect in document space. */
export function forEachTileInRect(
  r: Rect,
  tileSize: number,
  cb: (tx: number, ty: number, sub: Rect) => void,
): void {
  if (isEmptyRect(r)) return;
  const tx0 = Math.floor(r.x / tileSize);
  const ty0 = Math.floor(r.y / tileSize);
  const tx1 = Math.floor((r.x + r.w - 1) / tileSize);
  const ty1 = Math.floor((r.y + r.h - 1) / tileSize);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const sub = intersectRect(r, { x: tx * tileSize, y: ty * tileSize, w: tileSize, h: tileSize });
      if (!isEmptyRect(sub)) cb(tx, ty, sub);
    }
  }
}

// Affine matrix [a, b, c, d, e, f] mapping (x, y) → (a·x + c·y + e, b·x + d·y + f), like DOMMatrix 2D.
export type Mat2D = [number, number, number, number, number, number];

export const identity = (): Mat2D => [1, 0, 0, 1, 0, 0];

export function multiply(m: Mat2D, n: Mat2D): Mat2D {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Mat2D): Mat2D {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) throw new Error('Matrix is not invertible');
  const id = 1 / det;
  return [
    m[3] * id,
    -m[1] * id,
    -m[2] * id,
    m[0] * id,
    (m[2] * m[5] - m[3] * m[4]) * id,
    (m[1] * m[4] - m[0] * m[5]) * id,
  ];
}

export function apply(m: Mat2D, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export const translate = (x: number, y: number): Mat2D => [1, 0, 0, 1, x, y];
export const scale = (sx: number, sy = sx): Mat2D => [sx, 0, 0, sy, 0, 0];
export function rotate(rad: number): Mat2D {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, s, -s, c, 0, 0];
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
