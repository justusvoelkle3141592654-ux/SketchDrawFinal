// Commands for drawing assists (symmetry, guides, grid). Selection/transform/shape commands register here too.
import { register } from './commands';
import { activeSession, useDocs, type SymmetryMode } from '../state/documents';
import { fitToScreen, requestRedraw } from './actions';
import { toast } from '../state/ui';
import { symmetryLabel } from '../tools/symmetry';
import { useUi, type ToolId } from '../state/ui';
import * as Sel from './selection-actions';
import * as Clip from './clipboard';
import { beginTransform, commitTransform, isTransforming } from '../tools/transform-tool';
import { flipDocument, flipLayer, resizeCanvas, rotateDocument } from '../engine/pixel-ops';
import { maskBounds } from '../engine/selection';
import { TileDiffRecorder, type HistoryEntry } from '../engine/history';
import { fillCoverage } from '../engine/pixel-ops';
import { useColors } from '../state/colors';
import type { IconName } from '../ui/icons';
import { adjustTarget, applyAdjustmentNow } from './adjust-actions';
import { addReferenceFromClipboard, addReferenceFromDialog } from './references';

function assist(fn: (a: NonNullable<ReturnType<typeof activeSession>>['assist']) => void) {
  const s = activeSession();
  if (!s) return;
  fn(s.assist);
  requestRedraw();
  useDocs.getState().bump();
}

const SYM_CYCLE: SymmetryMode[] = ['off', 'vertical', 'horizontal', 'both', 'radial', 'kaleido'];

export function setSymmetry(mode: SymmetryMode, segments?: number) {
  assist((a) => {
    a.symmetry.mode = mode;
    if (segments) a.symmetry.segments = segments;
  });
}

function tool(id: ToolId, label: string, icon: IconName, keys: string[] = [], hint?: string) {
  register({
    id: `tool.${id}`,
    label,
    group: 'Tools',
    icon,
    keys,
    hint,
    run: () => useUi.getState().setTool(id),
    checked: () => useUi.getState().tool === id,
  });
}

export function docOp(
  label: string,
  make: (s: NonNullable<ReturnType<typeof activeSession>>) => HistoryEntry | null,
) {
  const s = activeSession();
  if (!s) return;
  if (isTransforming(s)) commitTransform();
  const e = make(s);
  if (!e) return;
  s.history.push(e);
  s.assist.symmetry.cx = s.doc.width / 2;
  s.assist.symmetry.cy = s.doc.height / 2;
  fitToScreen();
  requestRedraw();
  useDocs.getState().bump();
  toast('info', label);
}

function fillSelection() {
  const s = activeSession();
  if (!s) return;
  const l = s.doc.activeRaster;
  if (!l || l.locked) return toast('info', 'Select an unlocked paint layer to fill.');
  const doc = s.doc;
  const cov = new Uint8ClampedArray(doc.width * doc.height).fill(255);
  const c = useColors.getState();
  const rec = new TileDiffRecorder(l.pixels);
  fillCoverage(doc, l, rec, cov, c.fg, c.fgAlpha);
  const e = rec.toEntry(doc.selection ? 'Fill selection' : 'Fill layer', (r) => doc.markPixelsChanged(r));
  if (e) s.history.push(e);
  doc.markPixelsChanged(null);
}

export function registerExtendedFeatures() {
  const hasDoc = () => !!activeSession();
  const hasSel = () => !!activeSession()?.doc.selection;
  tool(
    'fill',
    'Fill',
    'fill',
    ['G'],
    'Click to flood-fill an area of similar colour with the foreground colour.',
  );
  tool('gradient', 'Gradient', 'gradient', ['Shift+G'], 'Drag to draw a gradient. Shift snaps the angle.');
  tool(
    'select-rect',
    'Rectangle selection',
    'selectRect',
    ['M'],
    'Shift adds, Alt subtracts, Shift+Alt intersects. Hold Ctrl for a square.',
  );
  tool(
    'select-ellipse',
    'Ellipse selection',
    'selectEllipse',
    ['Shift+M'],
    'Shift adds, Alt subtracts. Hold Ctrl for a circle.',
  );
  tool('select-lasso', 'Lasso selection', 'lasso', ['L'], 'Draw around an area.');
  tool(
    'select-polygon',
    'Polygonal lasso',
    'polygonLasso',
    ['Shift+L'],
    'Click corners; click the first point, double-click or press Enter to close.',
  );
  tool('select-wand', 'Magic wand', 'wand', ['W'], 'Select an area of similar colour.');
  register({
    id: 'tool.transform',
    label: 'Transform',
    group: 'Tools',
    icon: 'transform',
    keys: ['V', 'Ctrl+T'],
    hint: 'Move, scale, rotate or flip the selection or layer. Ctrl+drag a corner to distort. Enter applies, Esc cancels.',
    checked: () => useUi.getState().tool === 'transform',
    run: () => {
      useUi.getState().setTool('transform');
      const s = activeSession();
      if (s) beginTransform(s);
      requestRedraw();
    },
  });
  tool('crop', 'Crop', 'crop', ['C'], 'Drag the crop frame, then press Enter to crop or Esc to reset.');
  tool('line', 'Line', 'line', ['U'], 'Draws with the current brush. Ctrl snaps to 15°.');
  tool('rect', 'Rectangle', 'rect', ['Shift+U'], 'Stroke, fill or both (tool options). Ctrl for a square.');
  tool('ellipse', 'Ellipse', 'ellipse', [], 'Stroke, fill or both. Ctrl for a circle.');
  tool(
    'polygon',
    'Polygon',
    'polygon',
    [],
    'Regular polygon from the centre; set the number of sides in the tool options.',
  );
  tool(
    'polyline',
    'Polyline',
    'polyline',
    [],
    'Click points; double-click or Enter to finish, click the first point to close.',
  );
  tool(
    'text',
    'Text',
    'text',
    ['T'],
    'Click to place text; it becomes a new raster layer when you press Ctrl+Enter or click elsewhere.',
  );

  register({
    id: 'select.all',
    label: 'Select all',
    group: 'Select',
    icon: 'selectAll',
    keys: ['Ctrl+A'],
    run: Sel.selectAll,
    enabled: hasDoc,
  });
  register({
    id: 'select.none',
    label: 'Deselect',
    group: 'Select',
    icon: 'deselect',
    keys: ['Ctrl+D'],
    run: Sel.deselect,
    enabled: hasSel,
  });
  register({
    id: 'select.invert',
    label: 'Invert selection',
    group: 'Select',
    icon: 'invert',
    keys: ['Ctrl+Shift+I'],
    run: Sel.invertSelection,
    enabled: hasDoc,
  });
  register({
    id: 'select.feather',
    label: 'Feather selection…',
    group: 'Select',
    keys: ['Ctrl+Alt+D'],
    run: () => void Sel.featherSelection(),
    enabled: hasSel,
  });
  register({
    id: 'select.grow',
    label: 'Expand selection…',
    group: 'Select',
    run: () => void Sel.growSelection(1),
    enabled: hasSel,
  });
  register({
    id: 'select.shrink',
    label: 'Contract selection…',
    group: 'Select',
    run: () => void Sel.growSelection(-1),
    enabled: hasSel,
  });

  register({
    id: 'edit.cut',
    label: 'Cut',
    group: 'Edit',
    icon: 'cut',
    keys: ['Ctrl+X'],
    run: () => void Clip.cut(),
    enabled: hasDoc,
  });
  register({
    id: 'edit.copy',
    label: 'Copy',
    group: 'Edit',
    icon: 'copy',
    keys: ['Ctrl+C'],
    run: () => void Clip.copy(false),
    enabled: hasDoc,
  });
  register({
    id: 'edit.copyMerged',
    label: 'Copy merged',
    group: 'Edit',
    icon: 'copy',
    keys: ['Ctrl+Shift+C'],
    run: () => void Clip.copy(true),
    enabled: hasDoc,
  });
  register({
    id: 'edit.paste',
    label: 'Paste (floating, then Enter)',
    group: 'Edit',
    icon: 'paste',
    keys: ['Ctrl+V'],
    run: () => void Clip.paste(),
    enabled: hasDoc,
  });
  register({
    id: 'edit.pasteLayer',
    label: 'Paste as new layer',
    group: 'Edit',
    icon: 'paste',
    keys: ['Ctrl+Shift+V'],
    run: () => void Clip.pasteAsLayer(),
    enabled: hasDoc,
  });
  register({
    id: 'edit.fill',
    label: 'Fill selection with colour',
    group: 'Edit',
    icon: 'fill',
    keys: ['Shift+Backspace'],
    run: fillSelection,
    enabled: hasDoc,
  });

  register({
    id: 'image.rotateCW',
    label: 'Rotate canvas 90° clockwise',
    group: 'Image',
    icon: 'rotateRight',
    run: () => docOp('Rotated 90° clockwise', (s) => rotateDocument(s.doc, 1)),
    enabled: hasDoc,
  });
  register({
    id: 'image.rotateCCW',
    label: 'Rotate canvas 90° counter-clockwise',
    group: 'Image',
    icon: 'rotateLeft',
    run: () => docOp('Rotated 90° counter-clockwise', (s) => rotateDocument(s.doc, 3)),
    enabled: hasDoc,
  });
  register({
    id: 'image.rotate180',
    label: 'Rotate canvas 180°',
    group: 'Image',
    icon: 'rotate',
    run: () => docOp('Rotated 180°', (s) => rotateDocument(s.doc, 2)),
    enabled: hasDoc,
  });
  register({
    id: 'image.flipH',
    label: 'Flip canvas horizontally',
    group: 'Image',
    icon: 'flipH',
    run: () => docOp('Flipped horizontally', (s) => flipDocument(s.doc, 'h')),
    enabled: hasDoc,
  });
  register({
    id: 'image.flipV',
    label: 'Flip canvas vertically',
    group: 'Image',
    icon: 'flipV',
    run: () => docOp('Flipped vertically', (s) => flipDocument(s.doc, 'v')),
    enabled: hasDoc,
  });
  register({
    id: 'image.cropToSelection',
    label: 'Crop to selection',
    group: 'Image',
    icon: 'crop',
    run: () =>
      docOp('Cropped to selection', (s) => {
        const b = s.doc.selection ? maskBounds(s.doc.selection) : null;
        return b ? resizeCanvas(s.doc, b.w, b.h, -b.x, -b.y, 'Crop to selection') : null;
      }),
    enabled: hasSel,
  });
  register({
    id: 'image.size',
    label: 'Image size…',
    group: 'Image',
    icon: 'resize',
    keys: ['Ctrl+Alt+I'],
    run: () => useUi.getState().openDialog('image-size'),
    enabled: hasDoc,
  });
  register({
    id: 'image.canvasSize',
    label: 'Canvas size…',
    group: 'Image',
    icon: 'resize',
    keys: ['Ctrl+Alt+C'],
    run: () => useUi.getState().openDialog('canvas-size'),
    enabled: hasDoc,
  });
  register({
    id: 'layer.flipH',
    label: 'Flip layer horizontally',
    group: 'Layers',
    icon: 'flipH',
    run: () => {
      const s = activeSession();
      const l = s?.doc.activeRaster;
      if (s && l) s.history.push(flipLayer(s.doc, l, 'h'));
    },
    enabled: hasDoc,
  });
  register({
    id: 'layer.flipV',
    label: 'Flip layer vertically',
    group: 'Layers',
    icon: 'flipV',
    run: () => {
      const s = activeSession();
      const l = s?.doc.activeRaster;
      if (s && l) s.history.push(flipLayer(s.doc, l, 'v'));
    },
    enabled: hasDoc,
  });
  for (const [id, label, kind, keys] of [
    ['adjust.brightness', 'Brightness / contrast…', 'brightness-contrast', ['Ctrl+Alt+B']],
    ['adjust.hue', 'Hue / saturation…', 'hue-saturation', ['Ctrl+U']],
    ['adjust.grayscale', 'Greyscale', 'grayscale', ['Ctrl+Shift+U']],
    ['adjust.invert', 'Invert colours', 'invert', ['Ctrl+I']],
  ] as const) {
    register({
      id,
      label,
      group: 'Adjust',
      icon: 'adjust',
      keys: [...keys],
      hint: 'Destructive: changes the pixels of the active layer (inside the selection). Undo is available.',
      run: () => {
        if (kind === 'grayscale' || kind === 'invert') applyAdjustmentNow({ kind });
        else if (adjustTarget()) useUi.getState().openDialog('adjust', { kind });
      },
      enabled: hasDoc,
    });
  }
  register({
    id: 'reference.add',
    label: 'Add reference image…',
    group: 'View',
    icon: 'image',
    hint: 'Shows an image in the Reference panel; it is saved with the document and never changes the artwork.',
    run: () => void addReferenceFromDialog(),
    enabled: hasDoc,
  });
  register({
    id: 'reference.paste',
    label: 'Paste reference image',
    group: 'View',
    icon: 'paste',
    run: () => void addReferenceFromClipboard(),
    enabled: hasDoc,
  });
  register({
    id: 'assist.symmetry',
    label: 'Symmetry',
    group: 'Assist',
    icon: 'symmetry',
    keys: ['Shift+Y'],
    hint: 'Cycles off → vertical → horizontal → four-way → radial → kaleidoscope. Configure in the assist bar.',
    enabled: hasDoc,
    checked: () => (activeSession()?.assist.symmetry.mode ?? 'off') !== 'off',
    run: () =>
      assist((a) => {
        const i = SYM_CYCLE.indexOf(a.symmetry.mode);
        a.symmetry.mode = SYM_CYCLE[(i + 1) % SYM_CYCLE.length];
        toast('info', symmetryLabel(a.symmetry.mode, a.symmetry.segments));
      }),
  });
  register({
    id: 'assist.ruler',
    label: 'Ruler guide',
    group: 'Assist',
    icon: 'ruler',
    hint: 'Strokes that start near the ruler follow it. Drag its end points with the Transform tool or the assist bar.',
    enabled: hasDoc,
    checked: () => !!activeSession()?.assist.ruler.enabled,
    run: () => assist((a) => void (a.ruler.enabled = !a.ruler.enabled)),
  });
  register({
    id: 'assist.ellipse',
    label: 'Ellipse guide',
    group: 'Assist',
    icon: 'ellipseGuide',
    hint: 'Strokes that start near the ellipse follow its outline.',
    enabled: hasDoc,
    checked: () => !!activeSession()?.assist.ellipse.enabled,
    run: () => assist((a) => void (a.ellipse.enabled = !a.ellipse.enabled)),
  });
  register({
    id: 'assist.perspective',
    label: 'Perspective guides',
    group: 'Assist',
    icon: 'perspective',
    hint: 'Strokes lock toward the vanishing point that matches your initial direction.',
    enabled: hasDoc,
    checked: () => !!activeSession()?.assist.perspective.enabled,
    run: () => assist((a) => void (a.perspective.enabled = !a.perspective.enabled)),
  });
  register({
    id: 'assist.grid',
    label: 'Grid',
    group: 'Assist',
    icon: 'grid',
    keys: ["Ctrl+'"],
    enabled: hasDoc,
    checked: () => !!activeSession()?.assist.grid.visible,
    run: () => assist((a) => void (a.grid.visible = !a.grid.visible)),
  });
}
