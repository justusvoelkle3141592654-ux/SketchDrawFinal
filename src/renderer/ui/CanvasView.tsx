// The drawing surface: owns the renderer and routes pen/touch/mouse input to tools.
import { useEffect, useRef } from 'react';
import { CanvasRenderer } from '../render/canvas-renderer';
import { activeSession, useDocs, type DocumentSession } from '../state/documents';
import { getPrefs, usePrefs, type ButtonAction } from '../state/preferences';
import { useUi, type ToolId } from '../state/ui';
import { useInput } from '../state/input';
import { coalesced, normalizePointer } from '../input/normalize';
import { PALM_SLOP, PenProximity, routePointerDown, TouchContacts } from '../input/routing';
import { invert, apply, type Point } from '../engine/geometry';
import { fitView, rotateAt, viewMatrix, zoomAt, type ViewState } from '../engine/view';
import { canvasViewport, setRedrawHandler } from '../app/actions';
import { buildShortcutMap, runCommand } from '../app/commands';
import { normalizeShortcut } from '../app/shortcuts';
import { getTool, overlayTools } from '../tools/registry';
import { commitTransform, isTransforming } from '../tools/transform-tool';
import { commitText, useTextEdit } from '../tools/text-tool';
import type { Tool, ToolContext, ToolPointer } from '../tools/types';
import { drawAssistOverlay } from '../tools/assist-overlay';
import { hitAssistHandle, type AssistDrag } from '../tools/assist-handles';
import { attachRenderer, stop as stopPlayback, usePlayback } from '../app/animation';
import { attachTimelapseRenderer } from '../app/timelapse';

/** Wraps a guide-handle drag in the tool interface so it uses the normal pointer life cycle. */
function assistDragTool(drag: AssistDrag): Tool {
  return {
    cursor: () => 'grabbing',
    down: () => true,
    move: (ps, ctx) => {
      const p = ps[ps.length - 1];
      drag.move({ x: p.x, y: p.y }, p.shift);
      ctx.requestDraw();
    },
    up: () => useDocs.getState().bump(),
    cancel: () => useDocs.getState().bump(),
  };
}

interface ActivePointer {
  id: number;
  tool: Tool;
  pointerType: string;
  startTime: number;
  temp: boolean;
  /** Client position at pointerdown. */
  from: Point;
  /** Movement (px) before moves reach the tool; 0 once it has been passed. */
  slop: number;
}

interface Gesture {
  ids: [number, number];
  /** Client positions of both fingers at the start. */
  p0: [Point, Point];
  /** Movement (px) a finger needs before the gesture moves the view; 0 once passed. */
  slop: number;
  c0: Point;
  d0: number;
  a0: number;
  view0: ViewState;
  start: number;
  moved: boolean;
}

/** Keys currently held (for Space-pan, Alt-eyedropper etc.). */
export const heldKeys = { space: false, alt: false, shift: false, ctrl: false };

class CanvasController {
  renderer: CanvasRenderer;
  private active: ActivePointer | null = null;
  private contacts = new TouchContacts();
  private pen = new PenProximity();
  private gesture: Gesture | null = null;
  private rect: DOMRect;
  private matrixInv: [number, number, number, number, number, number] | null = null;
  private disposers: (() => void)[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new CanvasRenderer(canvas);
    attachRenderer(this.renderer);
    attachTimelapseRenderer(this.renderer);
    this.rect = canvas.getBoundingClientRect();
    this.renderer.onFrame = (t) => {
      const s = activeSession();
      if (s && this.active?.tool.frame) this.active.tool.frame(t, this.ctx(s));
    };
    this.renderer.overlays.add((c, info) => drawAssistOverlay(c, info));
    this.renderer.overlays.add((c, info) => {
      const s = activeSession();
      if (!s) return;
      const ctx = this.ctx(s);
      for (const t of overlayTools(useUi.getState().tool)) t.overlay?.(c, info, ctx);
    });
    setRedrawHandler(() => this.renderer.requestDraw());
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      canvas.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => canvas.removeEventListener(type, fn as EventListener, opts));
    };
    on('pointerdown', (e) => this.onDown(e));
    on('pointermove', (e) => this.onMove(e));
    on('pointerup', (e) => this.onUp(e, false));
    on('pointercancel', (e) => this.onUp(e, true));
    on('lostpointercapture', (e) => this.onLost(e));
    on('pointerleave', (e) => {
      if (!this.drivesHover(e)) return;
      useUi.setState({ pointer: { ...useUi.getState().pointer, inside: false } });
      this.renderer.requestDraw();
    });
    on('pointerenter', (e) => {
      if (!this.drivesHover(e)) return;
      useUi.setState({ pointer: { ...useUi.getState().pointer, inside: true } });
    });
    // pen proximity anywhere in the window, captured before the canvas sees the event
    const onPen = (e: PointerEvent) => this.onPen(e);
    const penTypes = ['pointerover', 'pointermove', 'pointerdown', 'pointerup', 'pointerout'] as const;
    for (const type of penTypes) {
      window.addEventListener(type, onPen, true);
      this.disposers.push(() => window.removeEventListener(type, onPen, true));
    }
    on('wheel', (e) => this.onWheel(e), { passive: false });
    on('contextmenu', (e) => e.preventDefault());
    on('dblclick', (e) => {
      const s = activeSession();
      if (!s) return;
      const tool = getTool(useUi.getState().tool);
      tool.dblclick?.(this.toPointer(e as unknown as PointerEvent, s), this.ctx(s));
    });
  }

  destroy() {
    for (const d of this.disposers) d();
    attachRenderer(null);
    attachTimelapseRenderer(null);
    this.renderer.destroy();
  }

  updateRect() {
    this.rect = this.canvas.getBoundingClientRect();
  }

  ctx(session: DocumentSession): ToolContext {
    return {
      session,
      renderer: this.renderer,
      toDoc: (sx, sy) => this.toDoc(session, sx, sy),
      toScreen: (p) =>
        apply(
          viewMatrix(session.view, this.renderer.viewport, session.doc.width, session.doc.height),
          p.x,
          p.y,
        ),
      requestDraw: () => this.renderer.requestDraw(),
    };
  }

  private toDoc(session: DocumentSession, sx: number, sy: number): Point {
    const m = viewMatrix(session.view, this.renderer.viewport, session.doc.width, session.doc.height);
    this.matrixInv = invert(m);
    return apply(this.matrixInv, sx, sy);
  }

  private toPointer(
    e: PointerEvent,
    session: DocumentSession,
    inv?: [number, number, number, number, number, number],
  ): ToolPointer {
    const sx = e.clientX - this.rect.left;
    const sy = e.clientY - this.rect.top;
    const m =
      inv ?? invert(viewMatrix(session.view, this.renderer.viewport, session.doc.width, session.doc.height));
    const d = apply(m, sx, sy);
    const n = normalizePointer(e, getPrefs().input, (e.buttons & 1) !== 0 || e.type === 'pointerdown');
    return {
      sx,
      sy,
      x: d.x,
      y: d.y,
      pressure: n.pressure,
      tiltX: n.tiltX,
      tiltY: n.tiltY,
      twist: n.twist,
      time: e.timeStamp,
      pointerType: n.pointerType,
      eraser: n.eraser,
      shift: e.shiftKey,
      alt: e.altKey,
      ctrl: e.ctrlKey || e.metaKey,
      button: e.button,
    };
  }

  private buttonAction(e: PointerEvent): ButtonAction | null {
    const input = getPrefs().input;
    if (e.pointerType === 'pen') {
      if (!input.barrelButtonsEnabled) return null;
      if (e.button === 2 || (e.buttons & 2) !== 0) return input.barrelButton;
      if (e.button === 1 || (e.buttons & 4) !== 0) return input.barrelButton2;
      return null;
    }
    if (e.pointerType === 'mouse') {
      if (e.button === 2) return input.rightMouse;
      if (e.button === 3) return input.mouseBack;
      if (e.button === 4) return input.mouseForward;
      if (e.button === 1) return 'pan';
    }
    return null;
  }

  private onDown(e: PointerEvent) {
    const session = activeSession();
    if (!session) return;
    if (usePlayback.getState().playing) {
      // touching the canvas during playback stops it on the frame that was showing
      stopPlayback(true);
      return;
    }
    this.updateRect();
    const prefs = getPrefs();
    const touch = e.pointerType === 'touch';
    if (touch) this.contacts.down(e.pointerId, { x: e.clientX, y: e.clientY });
    const route = routePointerDown(e.pointerType, prefs.input, {
      touches: this.contacts.fingers().length,
      active: this.active?.pointerType ?? null,
      gesture: this.gesture !== null,
      penNear: this.pen.near(e.timeStamp),
    });
    if (route === 'palm') {
      this.contacts.palm(e.pointerId);
      return;
    }
    if (route === 'gesture') {
      // a second finger turns a fresh touch stroke into a navigation gesture
      if (this.active) {
        if (e.timeStamp - this.active.startTime < 350 && this.active.tool.abort)
          this.active.tool.abort(this.ctx(session));
        else this.active.tool.cancel(this.ctx(session));
        this.active = null;
      }
      this.startGesture(session, prefs.input.penOnly ? PALM_SLOP : 0);
      return;
    }
    if (route === 'ignore') return;
    e.preventDefault();
    this.canvas.focus({ preventScroll: true });

    let toolId: ToolId = useUi.getState().tool;
    let temp = false;
    const action = this.buttonAction(e);
    if (action) {
      const handled = this.runButtonAction(action, e);
      if (handled === 'done') {
        // the pen or mouse acted (undo, Orbit...): resting palms give way to it
        if (route === 'preempt') this.palmsGiveWay();
        return;
      }
      if (handled) {
        toolId = handled;
        temp = true;
      }
    } else if (route === 'pan') {
      toolId = 'pan';
      temp = true;
    } else if (heldKeys.space) {
      toolId = heldKeys.shift ? 'rotate' : heldKeys.ctrl ? 'zoom' : 'pan';
      temp = true;
    } else if (
      heldKeys.alt &&
      ['brush', 'eraser', 'fill', 'gradient', 'line', 'rect', 'ellipse', 'polygon', 'polyline'].includes(
        toolId,
      )
    ) {
      toolId = 'eyedropper';
      temp = true;
    }
    if (e.pointerType === 'mouse' && e.button !== 0 && !temp) return;
    let tool = getTool(toolId);
    const p = this.toPointer(e, session);
    if (!temp) {
      // guide handles (ruler, ellipse, vanishing points, symmetry centre) take precedence over the tool
      const drag = hitAssistHandle(session, { x: p.sx, y: p.sy }, this.ctx(session).toScreen);
      if (drag) tool = assistDragTool(drag);
    }
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // pointer may already be gone
    }
    // one instance per tool: a touch pan must let go of the pan tool before the pen takes it
    if (route === 'preempt' && this.active?.tool === tool) this.palmsGiveWay();
    if (!tool.down(p, this.ctx(session))) {
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      // a refused pen or mouse (locked layer) leaves touch navigation running
      return;
    }
    // touches on the canvas when a pen or mouse stroke starts are palms; a touch pan or gesture stops
    if (!touch) this.palmsGiveWay();
    this.active = {
      id: e.pointerId,
      tool,
      pointerType: e.pointerType,
      startTime: e.timeStamp,
      temp,
      from: { x: e.clientX, y: e.clientY },
      // pen-only touch navigation waits until the contact clearly moves: a settling palm does not
      slop: route === 'pan' ? PALM_SLOP : 0,
    };
    this.canvas.style.cursor = tool.cursor?.(this.ctx(session)) ?? 'crosshair';
    this.renderer.requestDraw();
  }

  /** Returns a temporary tool, 'done' when the action completed immediately, or null. */
  private runButtonAction(a: ButtonAction, e: PointerEvent): ToolId | 'done' | null {
    const ui = useUi.getState();
    const x = e.clientX;
    const y = e.clientY;
    switch (a) {
      case 'orbit':
        useUi.setState({ orbit: { open: true, x, y, viaGesture: true } });
        return 'done';
      case 'sizePuck':
        useUi.setState({ sizePuck: { open: true, x, y } });
        return 'done';
      case 'eyedropper':
        return 'eyedropper';
      case 'eraser':
        return 'eraser';
      case 'pan':
        return 'pan';
      case 'undo':
        runCommand('edit.undo');
        return 'done';
      case 'redo':
        runCommand('edit.redo');
        return 'done';
      case 'shortcut': {
        const k = normalizeShortcut(getPrefs().input.customShortcut);
        const id = buildShortcutMap().get(k);
        if (id) runCommand(id);
        return 'done';
      }
      default:
        void ui;
        return null;
    }
  }

  /** Pen proximity, from pen events anywhere in the window (capture phase, before the canvas). */
  private onPen(e: PointerEvent) {
    if (e.pointerType !== 'pen') return;
    if (e.type === 'pointerout') {
      // no related target: the pen left hover range (or the window), not just this element
      if (e.relatedTarget === null) this.pen.left();
      return;
    }
    this.pen.seen(e.timeStamp);
    // tip or eraser not in contact: the pen hovers, so the hand holding it is coming down
    const hover = e.type === 'pointermove' && (e.buttons & (1 | 32)) === 0;
    if (hover && getPrefs().input.penOnly) this.palmsGiveWay();
  }

  /** Touches on the canvas become palms; a touch pan or gesture stops without the quick-tap undo. */
  private palmsGiveWay() {
    this.contacts.allPalms();
    const a = this.active;
    if (a?.pointerType === 'touch') {
      // the canvas keeps the palm's pointer capture, so its pointerup still arrives here and clears it
      this.active = null;
      const session = activeSession();
      if (session) a.tool.cancel(this.ctx(session));
      this.updateCursor(session);
    }
    if (this.gesture) {
      this.gesture = null;
      useDocs.getState().bump();
    }
  }

  /** Whether a pointer drives the brush outline, puck position and tool hover. */
  private drivesHover(e: PointerEvent) {
    if (e.pointerType !== 'touch') return true;
    // in pen-only mode fingers never paint; palms never count
    if (getPrefs().input.penOnly || this.contacts.isPalm(e.pointerId)) return false;
    return !this.active || this.active.id === e.pointerId;
  }

  private onMove(e: PointerEvent) {
    const session = activeSession();
    const sx = e.clientX - this.rect.left;
    const sy = e.clientY - this.rect.top;
    const hover = this.drivesHover(e);
    if (hover) useUi.setState({ pointer: { x: sx, y: sy, inside: true } });
    const list = coalesced(e);
    if (useInput.getState().listening)
      useInput.getState().report(normalizePointer(e, getPrefs().input, e.buttons !== 0), e, list.length);
    if (!session) return;
    const touch = e.pointerType === 'touch';
    if (touch && this.contacts.move(e.pointerId, { x: e.clientX, y: e.clientY }) && this.gesture) {
      this.updateGesture(session);
      return;
    }
    if (this.active && e.pointerId === this.active.id) {
      const a = this.active;
      if (a.slop) {
        if (Math.hypot(e.clientX - a.from.x, e.clientY - a.from.y) < a.slop) return;
        // past the slop the view catches up with the finger
        a.slop = 0;
      }
      const inv = invert(
        viewMatrix(session.view, this.renderer.viewport, session.doc.width, session.doc.height),
      );
      const samples = list.map((ce) => this.toPointer(ce, session, inv));
      a.tool.move(samples, this.ctx(session));
      return;
    }
    if (!this.active && hover) {
      const tool = getTool(useUi.getState().tool);
      if (tool.hover) tool.hover(this.toPointer(e, session), this.ctx(session));
      else this.renderer.requestDraw();
      this.updateCursor(session);
    }
  }

  updateCursor(session: DocumentSession | null = activeSession()) {
    if (!session) {
      this.canvas.style.cursor = 'default';
      return;
    }
    if (this.active) return;
    if (heldKeys.space) {
      this.canvas.style.cursor = 'grab';
      return;
    }
    const tool = getTool(useUi.getState().tool);
    this.canvas.style.cursor = tool.cursor?.(this.ctx(session)) ?? 'crosshair';
  }

  private onUp(e: PointerEvent, cancelled: boolean) {
    if (e.pointerType === 'touch') {
      const palm = this.contacts.isPalm(e.pointerId);
      this.contacts.up(e.pointerId);
      if (palm) return;
      if (this.gesture) {
        if (this.contacts.fingers().length < 2) this.endGesture(e.timeStamp, cancelled);
        return;
      }
    }
    const session = activeSession();
    if (!this.active || e.pointerId !== this.active.id || !session) return;
    const a = this.active;
    this.active = null;
    if (cancelled) a.tool.cancel(this.ctx(session));
    else a.tool.up(this.toPointer(e, session), this.ctx(session));
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    this.updateCursor(session);
    this.renderer.requestDraw();
  }

  private onLost(e: PointerEvent) {
    const session = activeSession();
    if (!this.active || e.pointerId !== this.active.id || !session) return;
    const a = this.active;
    this.active = null;
    a.tool.cancel(this.ctx(session));
    this.updateCursor(session);
    this.renderer.requestDraw();
  }

  /** Cancels any in-progress operation (document switch, dialog). */
  cancelActive() {
    const session = activeSession();
    if (this.active && session) this.active.tool.cancel(this.ctx(session));
    this.active = null;
  }

  private startGesture(session: DocumentSession, slop: number) {
    const [a, b] = this.contacts.fingers();
    const c0 = { x: (a[1].x + b[1].x) / 2 - this.rect.left, y: (a[1].y + b[1].y) / 2 - this.rect.top };
    this.gesture = {
      ids: [a[0], b[0]],
      p0: [a[1], b[1]],
      slop,
      c0,
      d0: Math.max(1, Math.hypot(a[1].x - b[1].x, a[1].y - b[1].y)),
      a0: Math.atan2(b[1].y - a[1].y, b[1].x - a[1].x),
      view0: { ...session.view },
      start: performance.now(),
      moved: false,
    };
  }

  private updateGesture(session: DocumentSession) {
    const g = this.gesture!;
    const a = this.contacts.get(g.ids[0]);
    const b = this.contacts.get(g.ids[1]);
    if (!a || !b) return;
    const c = { x: (a.x + b.x) / 2 - this.rect.left, y: (a.y + b.y) / 2 - this.rect.top };
    const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    if (Math.abs(d - g.d0) > 6 || Math.hypot(c.x - g.c0.x, c.y - g.c0.y) > 6) g.moved = true;
    if (g.slop) {
      const far = Math.max(
        Math.hypot(a.x - g.p0[0].x, a.y - g.p0[0].y),
        Math.hypot(b.x - g.p0[1].x, b.y - g.p0[1].y),
      );
      if (far < g.slop) return;
      // past the slop the view catches up with the fingers
      g.slop = 0;
    }
    const doc = session.doc;
    const vp = this.renderer.viewport;
    let v = zoomAt(g.view0, vp, doc.width, doc.height, g.view0.zoom * (d / g.d0), g.c0);
    v = rotateAt(v, vp, doc.width, doc.height, g.view0.rotation + (ang - g.a0), g.c0);
    v = { ...v, panX: v.panX + c.x - g.c0.x, panY: v.panY + c.y - g.c0.y };
    session.view = v;
    this.renderer.requestDraw();
  }

  private endGesture(time: number, cancelled: boolean) {
    const g = this.gesture;
    this.gesture = null;
    if (!g) return;
    // quick two-finger tap = undo; a cancelled contact (Windows palm rejection) is no tap
    if (!cancelled && !g.moved && time - g.start < 260) runCommand('edit.undo');
    useDocs.getState().bump();
  }

  private onWheel(e: WheelEvent) {
    const session = activeSession();
    if (!session) return;
    e.preventDefault();
    this.updateRect();
    const anchor = { x: e.clientX - this.rect.left, y: e.clientY - this.rect.top };
    const doc = session.doc;
    const vp = this.renderer.viewport;
    const pixelMode = e.deltaMode === 0;
    const trackpadPan =
      pixelMode && !e.ctrlKey && (Math.abs(e.deltaX) > 0 || Math.abs(e.deltaY) < 40) && !e.altKey;
    if (e.altKey) {
      const step = (e.deltaY > 0 ? 1 : -1) * (Math.PI / 36);
      session.view = rotateAt(session.view, vp, doc.width, doc.height, session.view.rotation + step, anchor);
    } else if (trackpadPan && !e.shiftKey) {
      session.view = {
        ...session.view,
        panX: session.view.panX - e.deltaX,
        panY: session.view.panY - e.deltaY,
      };
    } else if (e.shiftKey && !e.ctrlKey) {
      session.view = { ...session.view, panX: session.view.panX - (e.deltaY || e.deltaX) };
    } else {
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      const factor = Math.pow(2, -dy / (e.ctrlKey ? 100 : 360));
      session.view = zoomAt(session.view, vp, doc.width, doc.height, session.view.zoom * factor, anchor);
    }
    this.renderer.requestDraw();
    scheduleBump();
  }
}

let bumpTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleBump() {
  if (bumpTimer) return;
  bumpTimer = setTimeout(() => {
    bumpTimer = null;
    useDocs.getState().bump();
  }, 120);
}

export let canvasController: CanvasController | null = null;

export function CanvasView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const activeId = useDocs((s) => s.activeId);
  const sessions = useDocs((s) => s.sessions);
  const tool = useUi((s) => s.tool);
  const theme = usePrefs((s) => s.prefs.theme);
  const pixelGrid = usePrefs((s) => s.prefs.pixelGrid);

  useEffect(() => {
    const c = new CanvasController(canvasRef.current!);
    canvasController = c;
    return () => {
      c.destroy();
      canvasController = null;
    };
  }, []);

  useEffect(() => {
    const c = canvasController;
    if (!c) return;
    c.cancelActive();
    const s = sessions.find((x) => x.id === activeId) ?? null;
    if (isTransforming() && !isTransforming(s)) commitTransform();
    if (useTextEdit.getState().active && useTextEdit.getState().session !== s) commitText();
    if (s && !s.viewInitialized && c.renderer.viewport.width > 10) {
      s.view = fitView(c.renderer.viewport, s.doc.width, s.doc.height);
      s.viewInitialized = true;
    }
    c.renderer.setSession(s);
    c.renderer.retainSessions(new Set(sessions.map((x) => x.id)));
    c.updateCursor(s);
  }, [activeId, sessions]);

  const prevTool = useRef<ToolId>(tool);
  useEffect(() => {
    const c = canvasController;
    const s = activeSession();
    if (c && s && prevTool.current !== tool) getTool(prevTool.current).deactivate?.(c.ctx(s));
    prevTool.current = tool;
    canvasController?.updateCursor();
    canvasController?.renderer.requestDraw();
  }, [tool]);

  useEffect(() => {
    const c = canvasController;
    if (!c) return;
    const color = getComputedStyle(document.documentElement).getPropertyValue('--ws').trim();
    c.renderer.setWorkspaceColor(color || '#181818');
    c.renderer.pixelGrid = pixelGrid;
  }, [theme, pixelGrid]);

  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const c = canvasController;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      c.renderer.resize(r.width, r.height, dpr);
      canvasViewport.width = r.width;
      canvasViewport.height = r.height;
      c.updateRect();
      const s = activeSession();
      if (s && !s.viewInitialized && r.width > 10) {
        s.view = fitView(c.renderer.viewport, s.doc.width, s.doc.height);
        s.viewInitialized = true;
        c.renderer.requestDraw();
      }
    });
    ro.observe(el);
    // devicePixelRatio changes (moving between monitors with different scaling)
    let mq: MediaQueryList | null = null;
    const onDpr = () => {
      const r = el.getBoundingClientRect();
      canvasController?.renderer.resize(r.width, r.height, window.devicePixelRatio || 1);
      mq?.removeEventListener('change', onDpr);
      mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener('change', onDpr);
    };
    onDpr();
    return () => {
      ro.disconnect();
      mq?.removeEventListener('change', onDpr);
    };
  }, []);

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="canvas"
        tabIndex={-1}
        aria-label="Drawing canvas"
        data-testid="canvas"
      />
    </div>
  );
}
