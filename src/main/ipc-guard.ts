// Pure checks for the IPC layer: which page may call the main process and which paths the
// renderer may use. No Electron imports, so the rules are unit-tested directly.
import { extname, isAbsolute, normalize, posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCUMENT_EXTENSION } from '../shared/ipc';

function localPath(u: URL, windows: boolean): string | null {
  try {
    // rejects encoded separators (and hosts on POSIX), so a look-alike URL cannot match
    const p = fileURLToPath(u, { windows });
    // Windows paths compare case-insensitively, drive letter and UNC host included
    return windows ? win32.normalize(p).toLowerCase() : posix.normalize(p);
  } catch {
    return null;
  }
}

/**
 * True when `frameUrl` shows the app's own renderer: the same index.html file as `entryUrl` for a
 * built app (query and hash ignored), or the same origin as the dev server in development.
 * `windows` selects Windows path rules for file URLs; tests pass it to run both on any OS.
 */
export function isAppRendererUrl(
  frameUrl: string,
  entryUrl: string,
  windows = process.platform === 'win32',
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
    const expected = localPath(entry, windows);
    return expected !== null && localPath(frame, windows) === expected;
  }
  if (entry.protocol === 'http:' || entry.protocol === 'https:') return frame.origin === entry.origin;
  return false;
}

/** An absolute path to a .cforge document, the only kind of file a recovery snapshot points back to. */
export function isDocumentPath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length <= 4096 &&
    isAbsolute(path) &&
    extname(path).toLowerCase() === `.${DOCUMENT_EXTENSION}`
  );
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
   * The original path a recovery snapshot may keep: only a .cforge document the renderer already
   * holds a grant for, so restoring the snapshot (even after a restart) can only re-grant a
   * document the user chose, never an image, palette or brush pack opened through a dialog.
   */
  recoveryPath(path: unknown): string | null {
    return isDocumentPath(path) && this.has(path) ? path : null;
  }
}
