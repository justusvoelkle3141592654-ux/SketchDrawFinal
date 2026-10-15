// .cforge-brushpack: ZIP with manifest.json and brushes.json (array of brush presets, schema-validated).
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { validateBrush, type BrushPreset } from '../brush/schema';

export const BRUSHPACK_FORMAT = 'canvas-forge-brushpack';
export const BRUSHPACK_VERSION = 1;

export function writeBrushPack(name: string, brushes: BrushPreset[], appVersion: string): Uint8Array {
  const manifest = {
    format: BRUSHPACK_FORMAT,
    formatVersion: BRUSHPACK_VERSION,
    name,
    appVersion,
    created: new Date().toISOString(),
    brushCount: brushes.length,
  };
  return zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    'brushes.json': strToU8(
      JSON.stringify(
        brushes.map((b) => ({ ...b, factory: false })),
        null,
        1,
      ),
    ),
  });
}

export interface ReadPackResult {
  name: string;
  brushes: BrushPreset[];
  errors: string[];
}

export function readBrushPack(bytes: Uint8Array): ReadPackResult {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error('The brush pack is damaged or not a Canvas Forge brush pack.');
  }
  if (!entries['manifest.json'] || !entries['brushes.json'])
    throw new Error('The brush pack is missing manifest.json or brushes.json.');
  let manifest: Record<string, unknown>;
  let list: unknown;
  try {
    manifest = JSON.parse(strFromU8(entries['manifest.json']));
    list = JSON.parse(strFromU8(entries['brushes.json']));
  } catch {
    throw new Error('The brush pack contains invalid JSON.');
  }
  if (manifest.format !== BRUSHPACK_FORMAT) throw new Error('This file is not a Canvas Forge brush pack.');
  if (typeof manifest.formatVersion !== 'number' || manifest.formatVersion > BRUSHPACK_VERSION) {
    throw new Error(
      `This brush pack needs a newer Canvas Forge (pack format ${String(manifest.formatVersion)}).`,
    );
  }
  if (!Array.isArray(list)) throw new Error('brushes.json must contain a list of brushes.');
  const brushes: BrushPreset[] = [];
  const errors: string[] = [];
  for (const raw of list.slice(0, 500)) {
    try {
      brushes.push({ ...validateBrush(raw), factory: false });
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return {
    name: typeof manifest.name === 'string' ? manifest.name.slice(0, 80) : 'Brush pack',
    brushes,
    errors,
  };
}
