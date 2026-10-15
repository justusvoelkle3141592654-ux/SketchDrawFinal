// Structural validation of a .cforge container, shared by main (before atomic replace) and renderer (on open).
import { unzipSync, strFromU8 } from 'fflate';

export const CFORGE_FORMAT_ID = 'canvas-forge';
export const CFORGE_FORMAT_VERSION = 1;

export interface CforgeManifest {
  format: string;
  formatVersion: number;
  appVersion: string;
  created: string;
  modified: string;
  document: string;
}

export type ValidationResult = { ok: true; manifest: CforgeManifest } | { ok: false; error: string };

export function parseManifest(json: unknown): ValidationResult {
  if (!json || typeof json !== 'object') return { ok: false, error: 'manifest.json is not an object.' };
  const m = json as Record<string, unknown>;
  if (m.format !== CFORGE_FORMAT_ID) return { ok: false, error: 'This file is not a Canvas Forge document.' };
  if (typeof m.formatVersion !== 'number' || !Number.isInteger(m.formatVersion) || m.formatVersion < 1) {
    return { ok: false, error: 'The document format version is missing or invalid.' };
  }
  if (m.formatVersion > CFORGE_FORMAT_VERSION) {
    return {
      ok: false,
      error: `This document was saved by a newer Canvas Forge (format ${m.formatVersion}). This version reads format ${CFORGE_FORMAT_VERSION} and older.`,
    };
  }
  if (typeof m.document !== 'string' || !m.document)
    return { ok: false, error: 'manifest.json has no document entry.' };
  return {
    ok: true,
    manifest: {
      format: m.format,
      formatVersion: m.formatVersion,
      appVersion: typeof m.appVersion === 'string' ? m.appVersion : 'unknown',
      created: typeof m.created === 'string' ? m.created : '',
      modified: typeof m.modified === 'string' ? m.modified : '',
      document: m.document,
    },
  };
}

/** Fully decompresses the archive (catching truncation/corruption) and checks manifest + document JSON. */
export function validateCforgeBytes(bytes: Uint8Array): ValidationResult {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (e) {
    return { ok: false, error: `The file is damaged or not a ZIP container (${(e as Error).message}).` };
  }
  const manifestBytes = entries['manifest.json'];
  if (!manifestBytes) return { ok: false, error: 'manifest.json is missing.' };
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(strFromU8(manifestBytes));
  } catch {
    return { ok: false, error: 'manifest.json is not valid JSON.' };
  }
  const result = parseManifest(manifestJson);
  if (!result.ok) return result;
  const docBytes = entries[result.manifest.document];
  if (!docBytes) return { ok: false, error: `${result.manifest.document} is missing.` };
  try {
    JSON.parse(strFromU8(docBytes));
  } catch {
    return { ok: false, error: `${result.manifest.document} is not valid JSON.` };
  }
  return result;
}
