// Application data stored in Electron's userData directory. All writes are atomic.
import { app } from 'electron';
import { mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { atomicWrite, fileExists } from './files';
import type { AppDataKind, RecentEntry, RecoveryEntry, RecoveryMeta } from '../shared/ipc';

const MAX_RECENT = 15;
const MAX_APPDATA_BYTES = 32 * 1024 * 1024;

export function dataDir(): string {
  return app.getPath('userData');
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

async function readJson(path: string): Promise<unknown> {
  try {
    const text = await readFile(path, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value, null, 1);
  if (text.length > MAX_APPDATA_BYTES) throw new Error('Data is too large to store.');
  await ensureDir(join(path, '..'));
  await atomicWrite(path, new TextEncoder().encode(text));
}

export async function loadAppData(kind: AppDataKind): Promise<unknown> {
  return readJson(join(dataDir(), `${kind}.json`));
}

export async function saveAppData(kind: AppDataKind, data: unknown): Promise<void> {
  await writeJson(join(dataDir(), `${kind}.json`), data);
}

// ----- recent files -----

interface StoredRecent {
  path: string;
  name: string;
  openedAt: number;
}

async function loadRecentRaw(): Promise<StoredRecent[]> {
  const v = await readJson(join(dataDir(), 'recent.json'));
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (e): e is StoredRecent =>
        !!e && typeof e.path === 'string' && typeof e.name === 'string' && typeof e.openedAt === 'number',
    )
    .slice(0, MAX_RECENT);
}

export async function listRecent(): Promise<RecentEntry[]> {
  const raw = await loadRecentRaw();
  return Promise.all(raw.map(async (e) => ({ ...e, exists: await fileExists(e.path) })));
}

export async function pushRecent(path: string): Promise<void> {
  const raw = (await loadRecentRaw()).filter((e) => e.path !== path);
  raw.unshift({ path, name: basename(path), openedAt: Date.now() });
  await writeJson(join(dataDir(), 'recent.json'), raw.slice(0, MAX_RECENT));
}

export async function isRecent(path: string): Promise<boolean> {
  return (await loadRecentRaw()).some((e) => e.path === path);
}

export async function clearRecent(): Promise<void> {
  await writeJson(join(dataDir(), 'recent.json'), []);
}

// ----- recovery -----

const RECOVERY_ID = /^[a-z0-9-]{1,64}$/;

function recoveryDir() {
  return join(dataDir(), 'recovery');
}

export function isValidRecoveryId(id: unknown): id is string {
  return typeof id === 'string' && RECOVERY_ID.test(id);
}

export async function writeRecovery(meta: RecoveryMeta, bytes: Uint8Array): Promise<void> {
  if (!isValidRecoveryId(meta.id)) throw new Error('Invalid recovery id.');
  await ensureDir(recoveryDir());
  await atomicWrite(join(recoveryDir(), `${meta.id}.cforge`), bytes);
  await writeJson(join(recoveryDir(), `${meta.id}.json`), meta);
}

export async function listRecovery(): Promise<RecoveryEntry[]> {
  let names: string[];
  try {
    names = await readdir(recoveryDir());
  } catch {
    return [];
  }
  const out: RecoveryEntry[] = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    const id = n.slice(0, -5);
    if (!isValidRecoveryId(id)) continue;
    const meta = (await readJson(join(recoveryDir(), n))) as RecoveryMeta | null;
    if (!meta || typeof meta.title !== 'string') continue;
    try {
      const s = await stat(join(recoveryDir(), `${id}.cforge`));
      out.push({
        id,
        title: meta.title,
        originalPath: typeof meta.originalPath === 'string' ? meta.originalPath : null,
        savedAt: Number(meta.savedAt) || s.mtimeMs,
        width: Number(meta.width) || 0,
        height: Number(meta.height) || 0,
        sizeBytes: s.size,
      });
    } catch {
      // data file missing: ignore orphaned metadata
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

export async function readRecovery(id: string): Promise<Uint8Array | null> {
  if (!isValidRecoveryId(id)) return null;
  try {
    return new Uint8Array(await readFile(join(recoveryDir(), `${id}.cforge`)));
  } catch {
    return null;
  }
}

export async function deleteRecovery(id: string): Promise<void> {
  if (!isValidRecoveryId(id)) return;
  await unlink(join(recoveryDir(), `${id}.cforge`)).catch(() => undefined);
  await unlink(join(recoveryDir(), `${id}.json`)).catch(() => undefined);
}

// ----- window state -----

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

export async function loadWindowState(): Promise<WindowState | null> {
  const v = (await readJson(join(dataDir(), 'window-state.json'))) as WindowState | null;
  if (!v || typeof v.width !== 'number' || typeof v.height !== 'number') return null;
  return v;
}

export async function saveWindowState(s: WindowState): Promise<void> {
  await writeJson(join(dataDir(), 'window-state.json'), s);
}
