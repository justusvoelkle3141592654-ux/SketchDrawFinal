// Command registry: every user-facing action with label, icon, default shortcut and enablement.
import type { IconName } from '../ui/icons';
import type { BrushPreset } from '../engine/brush/schema';
import { activeSession, useDocs } from '../state/documents';
import { useUi, type PanelId, type ToolId, PANEL_TITLES } from '../state/ui';
import { usePrefs } from '../state/preferences';
import { useColors } from '../state/colors';
import { useBrushes } from '../state/brushes';
import * as A from './actions';
import * as F from './file-actions';
import { forge } from '../platform';
import { normalizeShortcut } from './shortcuts';

export interface Command {
  id: string;
  label: string;
  group: string;
  icon?: IconName;
  keys?: string[];
  hint?: string;
  run: () => void | Promise<void>;
  enabled?: () => boolean;
  checked?: () => boolean;
}

const registry = new Map<string, Command>();

export function register(c: Command) {
  registry.set(c.id, c);
}

export function getCommand(id: string): Command | undefined {
  return registry.get(id);
}

export function allCommands(): Command[] {
  return [...registry.values()];
}

export function runCommand(id: string) {
  const c = registry.get(id);
  if (!c) return;
  if (c.enabled && !c.enabled()) return;
  void c.run();
}

export function shortcutsFor(id: string): string[] {
  const override = usePrefs.getState().prefs.shortcuts[id];
  return (override ?? registry.get(id)?.keys ?? []).map(normalizeShortcut);
}

/** Maps normalised shortcut → command id (user overrides win). */
export function buildShortcutMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of registry.values()) for (const k of shortcutsFor(c.id)) if (k) map.set(k, c.id);
  return map;
}

export function tooltipFor(id: string): string {
  const c = registry.get(id);
  if (!c) return '';
  const k = shortcutsFor(id)[0];
  return k ? `${c.label} (${k})` : c.label;
}

const hasDoc = () => !!activeSession();

// ------------------------------------------------------------------------------- definitions

const tool = (id: ToolId, label: string, icon: IconName, keys: string[] = [], hint?: string): Command => ({
  id: `tool.${id}`,
  label,
  group: 'Tools',
  icon,
  keys,
  hint,
  run: () => useUi.getState().setTool(id),
  checked: () => useUi.getState().tool === id,
});

const panel = (id: PanelId, icon: IconName, keys: string[] = []): Command => ({
  id: `panel.${id}`,
  label: `${PANEL_TITLES[id]} panel`,
  group: 'Panels',
  icon,
  keys,
  run: () => useUi.getState().togglePanel(id),
  checked: () => useUi.getState().layout.panels[id].visible,
});

export function registerCoreCommands() {
  const cmds: Command[] = [
    // document
    {
      id: 'file.new',
      label: 'New document…',
      group: 'Document',
      icon: 'new',
      keys: ['Ctrl+N'],
      run: () => F.openNewDocumentDialog(),
    },
    {
      id: 'file.open',
      label: 'Open…',
      group: 'Document',
      icon: 'open',
      keys: ['Ctrl+O'],
      run: () => F.openDocumentDialog(),
    },
    {
      id: 'file.save',
      label: 'Save',
      group: 'Document',
      icon: 'save',
      keys: ['Ctrl+S'],
      run: () => void F.saveSession(activeSession(), false),
      enabled: hasDoc,
    },
    {
      id: 'file.saveAs',
      label: 'Save as…',
      group: 'Document',
      icon: 'save',
      keys: ['Ctrl+Shift+S'],
      run: () => void F.saveSession(activeSession(), true),
      enabled: hasDoc,
    },
    {
      id: 'file.close',
      label: 'Close document',
      group: 'Document',
      icon: 'close',
      keys: ['Ctrl+W'],
      run: () => void F.closeSession(),
      enabled: hasDoc,
    },
    {
      id: 'file.export',
      label: 'Export image…',
      group: 'Document',
      icon: 'export',
      keys: ['Ctrl+Shift+E'],
      run: () => useUi.getState().openDialog('export'),
      enabled: hasDoc,
    },
    {
      id: 'file.import',
      label: 'Import image as layer…',
      group: 'Document',
      icon: 'import',
      keys: ['Ctrl+Shift+O'],
      run: () => F.importImageDialog(),
      enabled: hasDoc,
    },
    { id: 'app.quit', label: 'Exit', group: 'Document', keys: ['Alt+F4'], run: () => F.closeAllAndQuit() },
    // history
    {
      id: 'edit.undo',
      label: 'Undo',
      group: 'Edit',
      icon: 'undo',
      keys: ['Ctrl+Z'],
      run: A.undo,
      enabled: () => !!activeSession()?.history.canUndo,
    },
    {
      id: 'edit.redo',
      label: 'Redo',
      group: 'Edit',
      icon: 'redo',
      keys: ['Ctrl+Shift+Z', 'Ctrl+Y'],
      run: A.redo,
      enabled: () => !!activeSession()?.history.canRedo,
    },
    // view
    {
      id: 'view.zoomIn',
      label: 'Zoom in',
      group: 'View',
      icon: 'zoomIn',
      keys: ['Ctrl+=', 'Ctrl+Shift+='],
      run: () => A.zoomStep(1),
      enabled: hasDoc,
    },
    {
      id: 'view.zoomOut',
      label: 'Zoom out',
      group: 'View',
      icon: 'zoomOut',
      keys: ['Ctrl+-'],
      run: () => A.zoomStep(-1),
      enabled: hasDoc,
    },
    {
      id: 'view.fit',
      label: 'Fit to screen',
      group: 'View',
      icon: 'fit',
      keys: ['Ctrl+0'],
      run: A.fitToScreen,
      enabled: hasDoc,
    },
    {
      id: 'view.actual',
      label: 'Actual pixels (100 %)',
      group: 'View',
      icon: 'actual',
      keys: ['Ctrl+1'],
      run: A.actualPixels,
      enabled: hasDoc,
    },
    {
      id: 'view.rotateLeft',
      label: 'Rotate view left 15°',
      group: 'View',
      icon: 'rotateLeft',
      keys: ['Ctrl+Alt+['],
      run: () => A.rotateBy(-15),
      enabled: hasDoc,
    },
    {
      id: 'view.rotateRight',
      label: 'Rotate view right 15°',
      group: 'View',
      icon: 'rotateRight',
      keys: ['Ctrl+Alt+]'],
      run: () => A.rotateBy(15),
      enabled: hasDoc,
    },
    {
      id: 'view.resetRotation',
      label: 'Reset view rotation',
      group: 'View',
      icon: 'rotateReset',
      keys: ['Shift+R'],
      run: A.resetRotation,
      enabled: hasDoc,
    },
    {
      id: 'view.mirror',
      label: 'Mirror view horizontally',
      group: 'View',
      icon: 'mirror',
      keys: ['H'],
      hint: 'Flips the view left to right; pixels are unchanged.',
      run: () => A.toggleMirror('x'),
      enabled: hasDoc,
      checked: () => !!activeSession()?.view.flipX,
    },
    {
      id: 'view.mirrorVertical',
      label: 'Mirror view vertically',
      group: 'View',
      icon: 'mirrorV',
      keys: ['Shift+H'],
      hint: 'Flips the view top to bottom; pixels are unchanged.',
      run: () => A.toggleMirror('y'),
      enabled: hasDoc,
      checked: () => !!activeSession()?.view.flipY,
    },
    {
      id: 'view.focus',
      label: 'Focus Canvas',
      group: 'View',
      icon: 'focus',
      keys: ['Tab'],
      hint: 'Hides panels and bars. Press Tab or use the restore button to bring them back.',
      run: () => useUi.getState().setFocusMode(!useUi.getState().focusMode),
      checked: () => useUi.getState().focusMode,
    },
    {
      id: 'view.fullscreen',
      label: 'Full screen',
      group: 'View',
      icon: 'fullscreen',
      keys: ['F11'],
      run: async () => {
        const fs = await forge.toggleFullScreen();
        useUi.setState({ fullScreen: fs });
      },
      checked: () => useUi.getState().fullScreen,
    },
    {
      id: 'view.pixelGrid',
      label: 'Pixel grid at high zoom',
      group: 'View',
      icon: 'grid',
      run: () => usePrefs.getState().update((p) => void (p.pixelGrid = !p.pixelGrid)),
      checked: () => usePrefs.getState().prefs.pixelGrid,
    },
    // tools
    tool('brush', 'Brush', 'brush', ['B']),
    tool('eraser', 'Eraser', 'eraser', ['E']),
    tool(
      'eyedropper',
      'Eyedropper',
      'eyedropper',
      ['I'],
      'Hold Alt while painting for a quick pick. Ctrl samples the active layer only.',
    ),
    tool('pan', 'Pan', 'pan', [], 'Hold Space to pan with any tool.'),
    tool('zoom', 'Zoom', 'zoom', ['Z'], 'Click to zoom in, Alt+click to zoom out, drag to zoom smoothly.'),
    tool('rotate', 'Rotate view', 'rotate', ['R'], 'Drag to rotate the view. Shift snaps to 15°.'),
    // layers
    {
      id: 'layer.new',
      label: 'New layer',
      group: 'Layers',
      icon: 'plus',
      keys: ['Ctrl+Shift+N'],
      run: A.newLayer,
      enabled: hasDoc,
    },
    {
      id: 'layer.newGroup',
      label: 'New group',
      group: 'Layers',
      icon: 'group',
      run: A.newGroup,
      enabled: hasDoc,
    },
    {
      id: 'layer.group',
      label: 'Group active layer',
      group: 'Layers',
      icon: 'group',
      keys: ['Ctrl+G'],
      run: A.groupLayer,
      enabled: hasDoc,
    },
    {
      id: 'layer.duplicate',
      label: 'Duplicate layer',
      group: 'Layers',
      icon: 'duplicate',
      keys: ['Ctrl+J'],
      run: A.duplicateLayer,
      enabled: hasDoc,
    },
    {
      id: 'layer.delete',
      label: 'Delete layer',
      group: 'Layers',
      icon: 'trash',
      keys: ['Ctrl+Shift+Delete'],
      run: () => A.deleteLayer(),
      enabled: hasDoc,
    },
    {
      id: 'layer.mergeDown',
      label: 'Merge down',
      group: 'Layers',
      icon: 'merge',
      keys: ['Ctrl+E'],
      run: A.mergeDown,
      enabled: hasDoc,
    },
    {
      id: 'layer.mergeVisible',
      label: 'Merge visible',
      group: 'Layers',
      icon: 'merge',
      keys: ['Ctrl+Alt+Shift+E'],
      run: A.mergeVisible,
      enabled: hasDoc,
    },
    {
      id: 'layer.flattenCopy',
      label: 'Flatten to new layer',
      group: 'Layers',
      icon: 'layers',
      run: A.flattenCopy,
      enabled: hasDoc,
    },
    {
      id: 'layer.clear',
      label: 'Clear layer / selection',
      group: 'Layers',
      icon: 'trash',
      keys: ['Delete', 'Backspace'],
      run: A.clearLayer,
      enabled: hasDoc,
    },
    {
      id: 'layer.alphaLock',
      label: 'Lock transparency',
      group: 'Layers',
      icon: 'alphaLock',
      keys: ['/'],
      run: A.toggleAlphaLock,
      enabled: hasDoc,
      checked: () => !!activeSession()?.doc.activeRaster?.alphaLock,
    },
    {
      id: 'layer.clip',
      label: 'Clip to layer below',
      group: 'Layers',
      icon: 'clip',
      keys: ['Ctrl+Alt+G'],
      run: A.toggleClip,
      enabled: hasDoc,
      checked: () => !!activeSession()?.doc.activeRaster?.clip,
    },
    {
      id: 'layer.addMask',
      label: 'Add layer mask',
      group: 'Layers',
      icon: 'mask',
      run: () => A.addMask(!!activeSession()?.doc.selection),
      enabled: hasDoc,
    },
    {
      id: 'layer.deleteMask',
      label: 'Delete layer mask',
      group: 'Layers',
      icon: 'mask',
      run: A.deleteMask,
      enabled: () => !!activeSession()?.doc.activeRaster?.mask,
    },
    {
      id: 'layer.applyMask',
      label: 'Apply layer mask',
      group: 'Layers',
      icon: 'mask',
      run: A.applyMask,
      enabled: () => !!activeSession()?.doc.activeRaster?.mask,
    },
    {
      id: 'layer.up',
      label: 'Move layer up',
      group: 'Layers',
      icon: 'chevronUp',
      keys: ['Ctrl+]'],
      run: () => A.nudgeActiveLayer(1),
      enabled: hasDoc,
    },
    {
      id: 'layer.down',
      label: 'Move layer down',
      group: 'Layers',
      icon: 'chevronDown',
      keys: ['Ctrl+['],
      run: () => A.nudgeActiveLayer(-1),
      enabled: hasDoc,
    },
    {
      id: 'layer.selectUp',
      label: 'Select layer above',
      group: 'Layers',
      keys: ['Alt+]'],
      run: () => A.selectLayerRelative(1),
      enabled: hasDoc,
    },
    {
      id: 'layer.selectDown',
      label: 'Select layer below',
      group: 'Layers',
      keys: ['Alt+['],
      run: () => A.selectLayerRelative(-1),
      enabled: hasDoc,
    },
    // colour
    {
      id: 'colour.swap',
      label: 'Swap foreground and background colours',
      group: 'Colour',
      icon: 'swap',
      keys: ['X'],
      run: () => useColors.getState().swap(),
    },
    {
      id: 'colour.reset',
      label: 'Reset colours to black and white',
      group: 'Colour',
      icon: 'reset',
      keys: ['D'],
      run: () => useColors.getState().reset(),
    },
    // brush
    {
      id: 'brush.sizeUp',
      label: 'Increase brush size',
      group: 'Brush',
      keys: [']'],
      run: () =>
        adjustActiveBrush((b) => (b.diameter = Math.min(1000, Math.max(b.diameter + 1, b.diameter * 1.15)))),
    },
    {
      id: 'brush.sizeDown',
      label: 'Decrease brush size',
      group: 'Brush',
      keys: ['['],
      run: () =>
        adjustActiveBrush((b) => (b.diameter = Math.max(0.5, Math.min(b.diameter - 1, b.diameter / 1.15)))),
    },
    {
      id: 'brush.opacityUp',
      label: 'Increase brush opacity',
      group: 'Brush',
      keys: ['Shift+]'],
      run: () => adjustActiveBrush((b) => (b.opacity = Math.min(1, b.opacity + 0.1))),
    },
    {
      id: 'brush.opacityDown',
      label: 'Decrease brush opacity',
      group: 'Brush',
      keys: ['Shift+['],
      run: () => adjustActiveBrush((b) => (b.opacity = Math.max(0.02, b.opacity - 0.1))),
    },
    // panels and workspace
    panel('colour', 'colour', ['F6']),
    panel('palettes', 'palette', ['Shift+F6']),
    panel('brushes', 'brushes', ['F5']),
    panel('layers', 'layers', ['F7']),
    panel('animation', 'animation', ['F8']),
    panel('reference', 'reference', ['F9']),
    {
      id: 'workspace.reset',
      label: 'Reset panel layout',
      group: 'Panels',
      icon: 'dock',
      run: () => useUi.getState().resetLayout(),
    },
    {
      id: 'workspace.leftHanded',
      label: 'Left-handed workspace',
      group: 'Panels',
      run: () => usePrefs.getState().update((p) => void (p.leftHanded = !p.leftHanded)),
      checked: () => usePrefs.getState().prefs.leftHanded,
    },
    {
      id: 'workspace.density',
      label: 'Roomy (touch) density',
      group: 'Panels',
      run: () =>
        usePrefs.getState().update((p) => void (p.density = p.density === 'roomy' ? 'compact' : 'roomy')),
      checked: () => usePrefs.getState().prefs.density === 'roomy',
    },
    {
      id: 'workspace.theme',
      label: 'Light theme',
      group: 'Panels',
      run: () => usePrefs.getState().update((p) => void (p.theme = p.theme === 'light' ? 'dark' : 'light')),
      checked: () => usePrefs.getState().prefs.theme === 'light',
    },
    // app
    {
      id: 'app.preferences',
      label: 'Preferences…',
      group: 'App',
      icon: 'settings',
      keys: ['Ctrl+,'],
      run: () => useUi.getState().openDialog('preferences'),
    },
    {
      id: 'app.tablet',
      label: 'Input & tablet settings…',
      group: 'App',
      icon: 'settings',
      run: () => useUi.getState().openDialog('preferences', { page: 'input' }),
    },
    {
      id: 'app.shortcuts',
      label: 'Keyboard shortcuts…',
      group: 'App',
      icon: 'keyboard',
      keys: ['Ctrl+/'],
      run: () => useUi.getState().openDialog('preferences', { page: 'shortcuts' }),
    },
    {
      id: 'app.about',
      label: 'About Canvas Forge',
      group: 'App',
      icon: 'info',
      run: () => useUi.getState().openDialog('about'),
    },
    {
      id: 'mode.predictive',
      label: 'Predictive stroke',
      group: 'Drawing modes',
      icon: 'predictive',
      keys: ['P'],
      hint: 'After you lift the pen, near-straight strokes become clean lines and curves are smoothed.',
      run: () => usePrefs.getState().update((p) => void (p.predictive.enabled = !p.predictive.enabled)),
      checked: () => usePrefs.getState().prefs.predictive.enabled,
    },
    {
      id: 'mode.stabilizer',
      label: 'Stroke stabiliser',
      group: 'Drawing modes',
      icon: 'stabilizer',
      keys: ['Shift+P'],
      hint: 'Smooths hand jitter. Brushes can override this in Brush Lab.',
      run: () =>
        usePrefs.getState().update((p) => {
          p.stabilizer.mode = p.stabilizer.mode === 'off' ? 'smooth' : 'off';
        }),
      checked: () => usePrefs.getState().prefs.stabilizer.mode !== 'off',
    },
  ];
  for (const c of cmds) register(c);
}

export function adjustActiveBrush(fn: (b: BrushPreset) => void) {
  const ui = useUi.getState();
  const br = useBrushes.getState();
  const id = ui.tool === 'eraser' ? br.activeEraserId : br.activeBrushId;
  br.update(id, fn);
  A.requestRedraw();
}

/** Re-render subscribers when command state may have changed. */
export function useCommandState() {
  useUi((s) => s.tool);
  useUi((s) => s.layout);
  useUi((s) => s.focusMode);
  useDocs((s) => s.rev);
  usePrefs((s) => s.prefs);
}
