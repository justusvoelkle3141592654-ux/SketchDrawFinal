// Pure checks for the IPC layer: which page may call the main process and which paths the
// renderer may use. No Electron imports, so the rules are unit-tested directly.
import { isAbsolute, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

function localPath(u: URL, ignoreCase: boolean): string | null {
  try {
    // rejects hosts on POSIX and encoded separators, so a look-alike URL cannot match
    const p = normalize(fileURLToPath(u));
    return ignoreCase ? p.toLowerCase() : p;
  } catch {
    return null;
  }
}

/**
 * True when `frameUrl` shows the app's own renderer: the same index.html file as `entryUrl` for a
 * built app (query and hash ignored), or the same origin as the dev server in development.
 */
export function isAppRendererUrl(
  frameUrl: string,
  entryUrl: string,
  ignoreCase = process.platform === 'win32',
): boolean {
  let frame: URL;
  let entry: URL;
  try {
    frame = new URL(frameUrl);
    entry = new URL(entryUrl);
  } catch {
    return false;
  }
  if (entry.protocol === 'file:') {
    if (frame.protocol !== 'file:') return false;
    const expected = localPath(entry, ignoreCase);
    return expected !== null && localPath(frame, ignoreCase) === expected;
  }
  if (entry.protocol === 'http:' || entry.protocol === 'https:') return frame.origin === entry.origin;
  return false;
}

/** Paths the renderer may write to or read again: chosen in a dialog, recent, dropped or opened by the OS. */
export class PathGrants {
  private readonly granted = new Set<string>();

  grant(path: string): void {
    this.granted.add(normalize(path));
  }

  has(path: string): boolean {
    return this.granted.has(normalize(path));
  }

  /**
   * The original path a recovery snapshot may keep: only one the renderer already holds a grant
   * for, so restoring the snapshot (even after a restart) can only re-grant a path the user chose.
   */
  recoveryPath(path: unknown): string | null {
    return typeof path === 'string' && path.length <= 4096 && isAbsolute(path) && this.has(path)
      ? path
      : null;
  }
}
