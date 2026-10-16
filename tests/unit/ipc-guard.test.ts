import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { isAppRendererUrl, isDocumentPath, PathGrants } from '../../src/main/ipc-guard';

// How main.ts builds the entry URL, and how Chromium reports a frame URL after parsing it.
const posixUrl = (p: string) => pathToFileURL(p, { windows: false }).href;
const winUrl = (p: string) => pathToFileURL(p, { windows: true }).href;
const reported = (u: string) => new URL(u).href;

describe('isAppRendererUrl (built app, POSIX paths)', () => {
  const entry = posixUrl('/opt/Canvas Forge/resources/app.asar/dist/renderer/index.html');

  it('accepts the app index.html, also with query, hash or a different encoding', () => {
    expect(entry).toContain('Canvas%20Forge');
    expect(isAppRendererUrl(entry, entry, false)).toBe(true);
    expect(isAppRendererUrl(`${entry}?a=1#x`, entry, false)).toBe(true);
    expect(isAppRendererUrl(entry.replace('Canvas%20Forge', 'Canvas Forge'), entry, false)).toBe(true);
    expect(isAppRendererUrl(entry.replace('/index.html', '/./index.html'), entry, false)).toBe(true);
  });

  it("accepts an install path with '%', '#', spaces and non-ASCII characters", () => {
    const special = posixUrl('/home/50%off #1/Ünï cöde/app/dist/renderer/index.html');
    expect(special).toContain('50%25off%20%231');
    expect(isAppRendererUrl(reported(special), special, false)).toBe(true);
    expect(isAppRendererUrl(`${reported(special)}#x`, special, false)).toBe(true);
    // loadFile() would leave the '%' raw; such a URL does not decode, so main.ts loads `special`
    expect(isAppRendererUrl(special.replace('50%25off', '50%off'), special, false)).toBe(false);
    expect(isAppRendererUrl(special.replace('%231', '%232'), special, false)).toBe(false);
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

  it('compares case-sensitively', () => {
    expect(isAppRendererUrl(entry.replace('Canvas%20Forge', 'canvas%20forge'), entry, false)).toBe(false);
  });
});

describe('isAppRendererUrl (built app, Windows paths)', () => {
  const entry = winUrl('C:\\Program Files\\Canvas Forge\\resources\\app.asar\\dist\\renderer\\index.html');

  it('accepts the same file regardless of case, drive-letter case and dot segments', () => {
    expect(entry).toBe(
      'file:///C:/Program%20Files/Canvas%20Forge/resources/app.asar/dist/renderer/index.html',
    );
    expect(isAppRendererUrl(entry, entry, true)).toBe(true);
    expect(isAppRendererUrl(`${entry}?a=1#x`, entry, true)).toBe(true);
    expect(isAppRendererUrl(entry.toLowerCase(), entry, true)).toBe(true);
    expect(isAppRendererUrl(entry.replace('/C:/', '/c:/'), entry, true)).toBe(true);
    expect(isAppRendererUrl(entry.replace('/dist/', '/./dist/'), entry, true)).toBe(true);
  });

  it("accepts an install path with '%', '#', spaces and non-ASCII characters", () => {
    const special = winUrl(
      'D:\\Apps 50%off\\Ünï cöde #1\\Canvas Forge\\resources\\app.asar\\dist\\renderer\\index.html',
    );
    expect(special).toContain('Apps%2050%25off/%C3%9Cn%C3%AF%20c%C3%B6de%20%231');
    expect(isAppRendererUrl(reported(special), special, true)).toBe(true);
    expect(isAppRendererUrl(special.replace('50%25off', '50%off'), special, true)).toBe(false);
  });

  it('accepts an install on a UNC share only from the same host', () => {
    const unc = winUrl('\\\\nas\\apps\\Canvas Forge\\resources\\app.asar\\dist\\renderer\\index.html');
    expect(unc.startsWith('file://nas/apps/')).toBe(true);
    expect(isAppRendererUrl(unc, unc, true)).toBe(true);
    expect(isAppRendererUrl(unc.replace('//nas/', '//NAS/'), unc, true)).toBe(true);
    expect(isAppRendererUrl(unc.replace('//nas/', '//evil/'), unc, true)).toBe(false);
    expect(isAppRendererUrl(unc.replace('file://nas/', 'file:///'), unc, true)).toBe(false);
  });

  it('rejects other drives, hosts, encoded separators and other files', () => {
    const others = [
      entry.replace('/C:/', '/D:/'),
      entry.replace('file:///', 'file://evil.example/'),
      entry.replace('/dist/renderer/', '/dist%5Crenderer/'),
      entry.replace('/dist/renderer/', '/dist%2Frenderer/'),
      entry.replace('/index.html', '/other.html'),
      'file:///C:/index.html',
      'https://evil.example/index.html',
    ];
    for (const url of others) expect(isAppRendererUrl(url, entry, true), url).toBe(false);
  });

  it('decodes Windows URLs as POSIX paths only when Windows rules are off', () => {
    // '/C:/...' on POSIX: still the same file, but case matters there
    expect(isAppRendererUrl(entry, entry, false)).toBe(true);
    expect(isAppRendererUrl(entry.toLowerCase(), entry, false)).toBe(false);
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

  it('keeps a recovery original path only when it is an already granted .cforge document', () => {
    const g = new PathGrants();
    g.grant('/home/me/art/cat.cforge');
    g.grant('/home/me/art/Dog.CFORGE');
    // granted through an open dialog, but not a document
    g.grant('/home/me/art/photo.png');
    g.grant('/home/me/art/colours.gpl');
    expect(g.recoveryPath('/home/me/art/cat.cforge')).toBe('/home/me/art/cat.cforge');
    expect(g.recoveryPath('/home/me/art/Dog.CFORGE')).toBe('/home/me/art/Dog.CFORGE');
    expect(g.recoveryPath('/home/me/art/photo.png')).toBeNull();
    expect(g.recoveryPath('/home/me/art/colours.gpl')).toBeNull();
    expect(g.recoveryPath('/home/me/art/bird.cforge')).toBeNull();
    expect(g.recoveryPath('/etc/passwd')).toBeNull();
    expect(g.recoveryPath('cat.cforge')).toBeNull();
    expect(g.recoveryPath(null)).toBeNull();
    expect(g.recoveryPath(42)).toBeNull();
    expect(g.recoveryPath({ toString: () => '/home/me/art/cat.cforge' })).toBeNull();
  });
});

describe('isDocumentPath', () => {
  it('accepts absolute .cforge paths only', () => {
    expect(isDocumentPath('/home/me/art/cat.cforge')).toBe(true);
    expect(isDocumentPath('/home/me/art/cat.CForge')).toBe(true);
    expect(isDocumentPath('/home/me/art/cat.cforge-brushpack')).toBe(false);
    expect(isDocumentPath('/home/me/art/cat.png')).toBe(false);
    expect(isDocumentPath('/home/me/art/.cforge')).toBe(false);
    expect(isDocumentPath('art/cat.cforge')).toBe(false);
    expect(isDocumentPath(`/${'a'.repeat(4096)}.cforge`)).toBe(false);
    expect(isDocumentPath(undefined)).toBe(false);
  });
});
