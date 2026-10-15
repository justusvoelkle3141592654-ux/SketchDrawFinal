// Tool controller contract.
import type { Point } from '../engine/geometry';
import type { CanvasRenderer, OverlayInfo } from '../render/canvas-renderer';
import type { DocumentSession } from '../state/documents';

export interface ToolPointer {
  /** Canvas-relative CSS pixels. */
  sx: number;
  sy: number;
  /** Document pixels. */
  x: number;
  y: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  twist: number;
  time: number;
  pointerType: 'pen' | 'touch' | 'mouse';
  eraser: boolean;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  button: number;
}

export interface ToolContext {
  session: DocumentSession;
  renderer: CanvasRenderer;
  toDoc: (sx: number, sy: number) => Point;
  toScreen: (p: Point) => Point;
  requestDraw: () => void;
}

export interface Tool {
  /** CSS cursor for the canvas. */
  cursor?: (ctx: ToolContext) => string;
  /** Returns false if the tool refuses to start (e.g. locked layer). */
  down: (p: ToolPointer, ctx: ToolContext) => boolean;
  move: (ps: ToolPointer[], ctx: ToolContext) => void;
  up: (p: ToolPointer, ctx: ToolContext) => void;
  /** Pointer lost or cancelled: finish safely (strokes commit what was drawn). */
  cancel: (ctx: ToolContext) => void;
  /** Discard the operation entirely (e.g. a touch stroke that became a two-finger gesture). */
  abort?: (ctx: ToolContext) => void;
  hover?: (p: ToolPointer, ctx: ToolContext) => void;
  frame?: (time: number, ctx: ToolContext) => void;
  overlay?: (c: CanvasRenderingContext2D, info: OverlayInfo, ctx: ToolContext) => void;
  /** Keyboard while the tool is active; return true when handled. */
  key?: (e: KeyboardEvent, ctx: ToolContext) => boolean;
  deactivate?: (ctx: ToolContext) => void;
  /** Double click / double tap. */
  dblclick?: (p: ToolPointer, ctx: ToolContext) => void;
}
