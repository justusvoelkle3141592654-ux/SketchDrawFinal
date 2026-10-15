// Brush pack import/export with collision resolution.
import { readBrushPack, writeBrushPack } from '../engine/io/brushpack';
import type { BrushPreset } from '../engine/brush/schema';
import { uid } from '../engine/random';
import { forge } from '../platform';
import { useBrushes } from '../state/brushes';
import { confirmDialog, toast } from '../state/ui';
import { APP_VERSION } from './file-actions';

export async function exportBrushPack(brushes: BrushPreset[], label: string): Promise<void> {
  if (!brushes.length) {
    toast('info', 'There are no brushes to export in this view.');
    return;
  }
  const name = label === 'All' ? 'Canvas Forge brushes' : `${label} brushes`;
  const bytes = writeBrushPack(name, brushes, APP_VERSION);
  const r = await forge.exportBrushPack(name, bytes);
  if (r.ok)
    toast('success', `Exported ${brushes.length} brush${brushes.length === 1 ? '' : 'es'} to ${r.name}`);
  else if (!r.canceled) toast('error', 'The brush pack could not be exported.', r.error);
}

export async function importBrushPack(): Promise<void> {
  const file = await forge.importBrushPack();
  if (!file) return;
  if ('error' in file) {
    toast('error', 'Could not read the brush pack.', file.error);
    return;
  }
  await importBrushPackBytes(file.bytes, file.name);
}

export async function importBrushPackBytes(bytes: Uint8Array, fileName: string): Promise<void> {
  let pack;
  try {
    pack = readBrushPack(bytes);
  } catch (e) {
    toast('error', `Could not import ${fileName}`, (e as Error).message);
    return;
  }
  const store = useBrushes.getState();
  const collisions = pack.brushes.filter((b) => store.get(b.id));
  let policy = 'keep';
  if (collisions.length) {
    policy = await confirmDialog({
      title: 'Some brushes already exist',
      message: `${collisions.length} of ${pack.brushes.length} brushes in "${pack.name}" have the same identity as brushes in your library (for example "${collisions[0].name}"). What should happen to them?`,
      buttons: [
        { id: 'keep', label: 'Keep both', kind: 'primary' },
        { id: 'replace', label: 'Replace mine' },
        { id: 'skip', label: 'Skip duplicates' },
        { id: 'cancel', label: 'Cancel import' },
      ],
      cancelId: 'cancel',
    });
    if (policy === 'cancel') return;
  }
  let added = 0;
  let replaced = 0;
  for (const b of pack.brushes) {
    const exists = !!store.get(b.id);
    if (!exists) {
      store.add({ ...b, factory: false });
      added++;
    } else if (policy === 'replace') {
      store.replace({ ...b, factory: store.get(b.id)!.factory && b.factory });
      replaced++;
    } else if (policy === 'keep') {
      store.add({ ...b, id: uid('u.'), name: `${b.name} (imported)`, factory: false });
      added++;
    }
  }
  const parts = [`${added} added`];
  if (replaced) parts.push(`${replaced} replaced`);
  if (pack.errors.length) parts.push(`${pack.errors.length} skipped (invalid)`);
  toast(
    pack.errors.length ? 'warning' : 'success',
    `Imported "${pack.name}": ${parts.join(', ')}.`,
    pack.errors.slice(0, 3).join('\n') || undefined,
  );
}
