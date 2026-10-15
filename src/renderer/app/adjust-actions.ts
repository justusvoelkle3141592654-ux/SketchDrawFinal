// Destructive colour adjustments on the active paint layer, with an undoable live preview.
import { TileDiffRecorder, type HistoryEntry } from '../engine/history';
import { applyAdjustment, type Adjustment } from '../engine/pixel-ops';
import type { RasterLayer } from '../engine/layers';
import { activeSession, type DocumentSession } from '../state/documents';
import { toast } from '../state/ui';
import { requestRedraw } from './actions';

export const ADJUST_LABELS: Record<Adjustment['kind'], string> = {
  'brightness-contrast': 'Brightness / contrast',
  'hue-saturation': 'Hue / saturation',
  grayscale: 'Greyscale',
  invert: 'Invert colours',
};

/** Returns the session and paint layer an adjustment may change, or explains why not. */
export function adjustTarget(quiet = false): { s: DocumentSession; layer: RasterLayer } | null {
  const s = activeSession();
  if (!s) return null;
  const layer = s.doc.activeRaster;
  if (!layer) {
    if (!quiet) toast('info', 'Select a paint layer to adjust.');
    return null;
  }
  if (layer.locked) {
    if (!quiet) toast('warning', `"${layer.name}" is locked.`);
    return null;
  }
  return { s, layer };
}

function run(s: DocumentSession, layer: RasterLayer, adj: Adjustment): HistoryEntry | null {
  const rec = new TileDiffRecorder(layer.pixels);
  applyAdjustment(s.doc, layer, rec, adj);
  const e = rec.toEntry(ADJUST_LABELS[adj.kind], (r) => s.doc.markPixelsChanged(r));
  s.doc.markPixelsChanged(null);
  requestRedraw();
  return e;
}

/** Applies an adjustment immediately and records it in the history. */
export function applyAdjustmentNow(adj: Adjustment): void {
  const t = adjustTarget();
  if (!t) return;
  const e = run(t.s, t.layer, adj);
  if (e) t.s.history.push(e);
  else toast('info', 'The layer has no pixels to adjust here.');
}

/**
 * Live preview: each update reverts the previous preview before applying the new values, so the
 * layer never accumulates intermediate results. `commit` records one history entry; `cancel`
 * restores the original pixels.
 */
export class AdjustmentPreview {
  private entry: HistoryEntry | null = null;
  private last: string | null = null;
  constructor(
    private readonly s: DocumentSession,
    private readonly layer: RasterLayer,
  ) {}

  update(adj: Adjustment | null): void {
    const key = adj ? JSON.stringify(adj) : null;
    if (key === this.last) return;
    this.revert();
    this.last = key;
    if (adj) this.entry = run(this.s, this.layer, adj);
  }

  private revert(): void {
    if (!this.entry) return;
    this.entry.undo();
    this.entry = null;
    this.s.doc.markPixelsChanged(null);
    requestRedraw();
  }

  commit(adj: Adjustment): void {
    this.update(adj);
    if (this.entry) this.s.history.push(this.entry);
    this.entry = null;
    this.last = null;
  }

  cancel(): void {
    this.revert();
    this.last = null;
  }
}
