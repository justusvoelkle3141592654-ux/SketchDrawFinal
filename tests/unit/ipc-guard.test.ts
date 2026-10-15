import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isAppRendererUrl, PathGrants } from '../../src/main/ipc-guard';

describe('isAppRendererUrl (built app)', () => {
  // a real absolute path on the platform running the tests
  const base = process.platform === 'win32' ? 'C:\\Program Files\\Canvas Forge' : '/opt/Canvas Forge';
  const entry = pathToFileURL(join(base, 'resources/app.asar/dist/renderer/index.html')).href;

  it('accepts the app index.html, also with query, hash or a different encoding', () => {
    expect(entry).toContain('Canvas%20Forge');
    expect(isAppRendererUrl(entry, entry, false)).toBe(true);
    expect(isAppRendererUrl(`${entry}?a=1#x`, entry, false)).toBe(true);
    expect(isAppRendererUrl(entry.replace('Canvas%20Forge', 'Canvas Forge'), entry, false)).toBe(true);
    expect(isAppRendererUrl(entry.replace('/index.html', '/./index.html'), entry, false)).toBe(true);
  });

  it('rejects other files, schemes and malformed URLs', () => {
    const others = [
      entry.replace('/index.html', '/other.html'),
      entry.replace('/dist/renderer/', '/dist%2Frenderer/'),
      entry.replace('file:///', 'file://evil.example/'),
      'file:///tmp/index.html',
      'https://evil.example/index.html',
      'http://localhost:5183/',
      'about:blank',
      'devtools://devtools/bundled/inspector.html',
      'data:text/html,<p>x</p>',
      '',
      'not a url',
    ];
    for (const url of others) expect(isAppRendererUrl(url, entry, false), url).toBe(false);
  });

  it('compares paths case-insensitively only when asked (Windows)', () => {
    const win = 'file:///C:/Program%20Files/Canvas%20Forge/resources/app.asar/dist/renderer/index.html';
    const lower = 'file:///c:/program%20files/canvas%20forge/resources/app.asar/dist/renderer/index.html';
    expect(isAppRendererUrl(lower, win, true)).toBe(true);
    expect(isAppRendererUrl(lower, win, false)).toBe(false);
  });
});

describe('isAppRendererUrl (dev server)', () => {
  const entry = 'http://localhost:5183/';

  it('accepts any page of the dev server origin', () => {
    expect(isAppRendererUrl('http://localhost:5183/', entry)).toBe(true);
    expect(isAppRendererUrl('http://localhost:5183/index.html#x', entry)).toBe(true);
  });

  it('rejects other origins and local files', () => {
    expect(isAppRendererUrl('http://localhost:5184/', entry)).toBe(false);
    expect(isAppRendererUrl('https://localhost:5183/', entry)).toBe(false);
    expect(isAppRendererUrl('http://127.0.0.1:5183/', entry)).toBe(false);
    expect(isAppRendererUrl('http://evil.example/', entry)).toBe(false);
    expect(isAppRendererUrl('file:///tmp/index.html', entry)).toBe(false);
  });

  it('rejects everything for an unsupported entry scheme', () => {
    expect(isAppRendererUrl('app://renderer/index.html', 'app://renderer/index.html')).toBe(false);
  });
});

describe('PathGrants', () => {
  it('matches granted paths after normalisation only', () => {
    const g = new PathGrants();
    g.grant('/home/me/art/../art/cat.cforge');
    expect(g.has('/home/me/art/cat.cforge')).toBe(true);
    expect(g.has('/home/me/art/dog.cforge')).toBe(false);
  });

  it('keeps a recovery original path only when it is already granted', () => {
    const g = new PathGrants();
    g.grant('/home/me/art/cat.cforge');
    expect(g.recoveryPath('/home/me/art/cat.cforge')).toBe('/home/me/art/cat.cforge');
    expect(g.recoveryPath('/etc/passwd')).toBeNull();
    expect(g.recoveryPath('cat.cforge')).toBeNull();
    expect(g.recoveryPath(null)).toBeNull();
    expect(g.recoveryPath(42)).toBeNull();
    expect(g.recoveryPath({ toString: () => '/home/me/art/cat.cforge' })).toBeNull();
  });
});
