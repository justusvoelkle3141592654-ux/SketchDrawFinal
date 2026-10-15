// Atomic file IO for the main process.
import { randomBytes } from 'node:crypto';
import { open, rename, unlink, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Windows can briefly refuse a rename while antivirus/indexers hold the target open. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (e) {
      lastError = e;
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') break;
      await sleep(60 * (attempt + 1));
    }
  }
  throw lastError;
}

/**
 * Writes `bytes` next to `target`, flushes, re-reads and validates the temporary file,
 * then replaces the target. The original file is untouched if any step fails.
 */
export async function atomicWrite(
  target: string,
  bytes: Uint8Array,
  validate?: (written: Uint8Array) => string | null,
): Promise<void> {
  const tmp = join(dirname(target), `.${basename(target)}.tmp-${randomBytes(6).toString('hex')}`);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(tmp, 'wx');
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    const written = new Uint8Array(await readFile(tmp));
    if (written.byteLength !== bytes.byteLength) throw new Error('Written size does not match.');
    for (let i = 0; i < written.byteLength; i += 4093) {
      if (written[i] !== bytes[i]) throw new Error('Written data does not match.');
    }
    if (validate) {
      const problem = validate(written);
      if (problem) throw new Error(`Validation failed: ${problem}`);
    }
    await renameWithRetry(tmp, target);
  } catch (e) {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(tmp).catch(() => undefined);
    throw e;
  }
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export function describeFsError(e: unknown): string {
  const err = e as NodeJS.ErrnoException;
  switch (err?.code) {
    case 'ENOENT':
      return 'The file or folder no longer exists.';
    case 'EACCES':
    case 'EPERM':
      return 'Permission denied. The file may be read-only or opened by another program.';
    case 'ENOSPC':
      return 'The disk is full.';
    case 'EROFS':
      return 'The drive is read-only.';
    case 'EBUSY':
      return 'The file is in use by another program.';
    default:
      return err?.message ?? String(e);
  }
}
