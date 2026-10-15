// Application root: initialisation, global keyboard handling, autosave/recovery and workspace layout.
import { useEffect, useMemo, useState } from 'react';
import { usePrefs } from '../state/preferences';
import { useUi } from '../state/ui';
import { useColors } from '../state/colors';
import { useBrushes } from '../state/brushes';
import { activeSession, useDocs } from '../state/documents';
import { forge } from '../platform';
import { buildShortcutMap, getCommand, register, registerCoreCommands, runCommand } from './commands';
import { eventToShortcut, isTextInput } from './shortcuts';
import { closeAllAndQuit, openFile, placeImageBytes, serializeSession } from './file-actions';
import { CanvasView, canvasController, heldKeys } from '../ui/CanvasView';
import { CommandBar, FocusRestore, StartScreen, StatusBar, TitleBar, ToolRail } from '../ui/Chrome';
import { FloatingPanels, PanelDock } from '../ui/PanelDock';
import { ConfirmModal, PromptModal, Toasts, TooltipLayer } from '../ui/Overlays';
import { ToolOptionsBar } from '../ui/ToolOptionsBar';
import { TextOverlay } from '../ui/TextOverlay';
import { usePrompt } from './prompt';
import { CommandPalette, openPalette, usePalette } from '../ui/CommandPalette';
import { DialogHost } from '../ui/dialogs/DialogHost';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { Orbit } from '../ui/Orbit';
import {
  NavPuck,
  PuckDock,
  SizePuck,
  openNavPuckAtPointer,
  openOrbitAtPointer,
  openSizePuckAtPointer,
} from '../ui/Pucks';
import { getTool } from '../tools/registry';
import { registerExtendedFeatures } from './extended';
import { importBrushPackBytes } from './brush-actions';

let initialised = false;
function registerAll() {
  if (initialised) return;
  initialised = true;
  registerCoreCommands();
  register({
    id: 'puck.size',
    label: 'Brush size & opacity puck',
    group: 'Brush',
    icon: 'puck',
    keys: ['S'],
    run: openSizePuckAtPointer,
  });
  register({
    id: 'puck.nav',
    label: 'Navigation puck (pan, zoom, rotate)',
    group: 'View',
    icon: 'pan',
    keys: ['Shift+S'],
    run: openNavPuckAtPointer,
  });
  register({
    id: 'orbit.open',
    label: 'Open Orbit quick menu',
    group: 'View',
    icon: 'orbit',
    keys: ['`'],
    run: openOrbitAtPointer,
  });
  register({
    id: 'brush.lab',
    label: 'Brush Lab…',
    group: 'Brush',
    icon: 'settings',
    keys: ['Ctrl+B'],
    run: () => {
      const b = useBrushes.getState();
      useUi.getState().openDialog('brush-lab', {
        id: useUi.getState().tool === 'eraser' ? b.activeEraserId : b.activeBrushId,
      });
    },
  });
  register({
    id: 'app.commands',
    label: 'All commands…',
    group: 'App',
    icon: 'menu',
    keys: ['Ctrl+K'],
    hint: 'Search and run any command',
    run: openPalette,
  });
  registerExtendedFeatures();
}
registerAll();

function useGlobalKeys() {
  const shortcuts = usePrefs((s) => s.prefs.shortcuts);
  // buildShortcutMap reads the preference store; `shortcuts` is the trigger for rebuilding it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const map = useMemo(() => buildShortcutMap(), [shortcuts]);
  useEffect(() => {
    const syncHeld = (e: KeyboardEvent) => {
      heldKeys.alt = e.altKey;
      heldKeys.shift = e.shiftKey;
      heldKeys.ctrl = e.ctrlKey || e.metaKey;
    };
    const down = (e: KeyboardEvent) => {
      syncHeld(e);
      // a focused control already handled this key (list navigation, rename, …)
      if (e.defaultPrevented) return;
      const ui = useUi.getState();
      if (ui.dialog || ui.confirm || usePrompt.getState().req || usePalette.getState().open) return;
      if (isTextInput(e.target)) return;
      const target = e.target as HTMLElement | null;
      const onControl =
        !!target &&
        target !== document.body &&
        !target.classList.contains('canvas') &&
        target.matches(
          'button, [role="option"], [role="tab"], [role="switch"], select, input, [role="slider"], [role="menuitem"]',
        );
      if (e.key === 'Alt') e.preventDefault();
      if (e.code === 'Space' && !e.ctrlKey && !e.altKey) {
        if (onControl) return;
        e.preventDefault();
        if (!heldKeys.space) {
          heldKeys.space = true;
          canvasController?.updateCursor();
        }
        return;
      }
      const s = activeSession();
      if (s && canvasController) {
        const tool = getTool(ui.tool);
        if (tool.key?.(e, canvasController.ctx(s))) {
          e.preventDefault();
          return;
        }
      }
      if (e.key === 'Escape') {
        if (ui.focusMode) {
          ui.setFocusMode(false);
          e.preventDefault();
        }
        return;
      }
      const k = eventToShortcut(e);
      if (!k) return;
      // Tab moves keyboard focus through the interface; it toggles Focus Canvas only while the
      // canvas itself has focus (after drawing on it) or to leave Focus Canvas again
      if (k === 'Tab' && !ui.focusMode && !target?.classList.contains('canvas')) return;
      // plain Enter/Space/arrows belong to the focused control; with Ctrl/Alt they stay shortcuts
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
      if (onControl && plain && (e.key === 'Enter' || e.key === ' ' || e.key.startsWith('Arrow'))) return;
      const id = map.get(k);
      if (id) {
        e.preventDefault();
        if (e.repeat && !/^(brush\.|view\.zoom)/.test(id)) return;
        runCommand(id);
      }
    };
    const up = (e: KeyboardEvent) => {
      syncHeld(e);
      if (e.code === 'Space') {
        heldKeys.space = false;
        canvasController?.updateCursor();
      }
    };
    const blur = () => {
      heldKeys.space = heldKeys.alt = heldKeys.shift = heldKeys.ctrl = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [map]);
}

function useAutosave() {
  const minutes = usePrefs((s) => s.prefs.autosaveMinutes);
  useEffect(() => {
    if (!minutes) return;
    let busy = false;
    const id = setInterval(async () => {
      if (busy || useUi.getState().drawing) return;
      busy = true;
      try {
        for (const s of useDocs.getState().sessions) {
          if (!s.dirty || s.history.stateId === s.lastAutosaveStateId) continue;
          const stateId = s.history.stateId;
          const bytes = await serializeSession(s, true);
          const r = await forge.recoveryWrite(
            {
              id: s.recoveryId,
              title: s.displayName,
              originalPath: s.filePath,
              savedAt: Date.now(),
              width: s.doc.width,
              height: s.doc.height,
            },
            bytes,
          );
          if (r.ok) s.lastAutosaveStateId = stateId;
        }
      } catch {
        // recovery is best-effort; the next interval retries
      } finally {
        busy = false;
      }
    }, minutes * 60_000);
    return () => clearInterval(id);
  }, [minutes]);
}

function useDropAndPaste() {
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    };
    const drop = async (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      for (const f of [...e.dataTransfer.files]) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        if (/\.cforge$/i.test(f.name)) {
          const path = await forge.grantDroppedFile(f);
          await openFile({ path: path ?? f.name, name: f.name, bytes });
        } else if (/\.cforge-brushpack$/i.test(f.name)) {
          await importBrushPackBytes(bytes, f.name);
        } else if (/\.(png|jpe?g|webp)$/i.test(f.name)) {
          const s = activeSession();
          if (s) await placeImageBytes(s, bytes, f.name);
          else await openFile({ path: f.name, name: f.name, bytes });
        } else {
          useUi.getState().toast('warning', `${f.name} is not a supported file type.`);
        }
      }
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
}

export function App() {
  const prefs = usePrefs((s) => s.prefs);
  const loaded = usePrefs((s) => s.loaded);
  const focusMode = useUi((s) => s.focusMode);
  const drawing = useUi((s) => s.drawing);
  const sessions = useDocs((s) => s.sessions);
  const activeId = useDocs((s) => s.activeId);
  useDocs((s) => s.rev);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      await Promise.all([
        usePrefs.getState().load(),
        useUi.getState().loadLayout(),
        useColors.getState().load(),
        useBrushes.getState().load(),
      ]).catch(() => undefined);
      setReady(true);
      const rec = await forge.recoveryList().catch(() => []);
      if (rec.length) useUi.getState().openDialog('recovery', { entries: rec });
    })();
    const offClose = forge.onCloseRequested(() => void closeAllAndQuit());
    const offOpen = forge.onOpenPath((f) => {
      if ('error' in f) useUi.getState().toast('error', 'Could not open the file', f.error);
      else void openFile(f);
    });
    const offFs = forge.onFullScreenChanged((fs) => useUi.setState({ fullScreen: fs }));
    // Test hooks are read-only views used by the automated smoke test.
    window.__cforge = { activeSession, useDocs, useUi, useBrushes, runCommand, getCommand };
    return () => {
      offClose();
      offOpen();
      offFs();
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = prefs.theme;
    root.dataset.density = prefs.density;
    root.dataset.hand = prefs.leftHanded ? 'left' : 'right';
    const st = getComputedStyle(root);
    forge.setTitleBarOverlay({
      color: st.getPropertyValue('--surface-0').trim() || '#15171b',
      symbolColor: st.getPropertyValue('--text-1').trim() || '#b9bfc8',
    });
  }, [prefs.theme, prefs.density, prefs.leftHanded]);

  const active = sessions.find((s) => s.id === activeId);
  useEffect(() => {
    forge.setTitle(
      active ? `${active.dirty ? '• ' : ''}${active.displayName} — Canvas Forge` : 'Canvas Forge',
    );
  });

  useGlobalKeys();
  useAutosave();
  useDropAndPaste();

  const hidePanels = focusMode || (prefs.autoHidePanels && drawing);
  return (
    <div
      className={`app ${focusMode ? 'is-focus' : ''} ${hidePanels ? 'hide-panels' : ''} ${prefs.leftHanded ? 'is-left-handed' : ''}`}
      data-ready={ready && loaded ? 'true' : 'false'}
    >
      <TitleBar />
      {!focusMode ? <CommandBar /> : null}
      <main className="workspace">
        <h1 className="sr-only">Canvas Forge</h1>
        {!focusMode ? <ToolRail /> : null}
        <div className="canvas-area">
          <CanvasView />
          {active && !focusMode ? <ToolOptionsBar /> : null}
          {active ? <TextOverlay /> : null}
          {!active ? <StartScreen /> : null}
          {active ? <PuckDock /> : null}
          {active ? <Orbit /> : null}
          <SizePuck />
          <NavPuck />
          <FocusRestore />
        </div>
        {!focusMode ? <PanelDock /> : null}
      </main>
      {!focusMode ? <StatusBar /> : null}
      {!focusMode ? <FloatingPanels /> : null}
      <ErrorBoundary name="Dialog" kind="dialog">
        <DialogHost />
      </ErrorBoundary>
      <ConfirmModal />
      <PromptModal />
      <CommandPalette />
      <Toasts />
      <TooltipLayer />
    </div>
  );
}
