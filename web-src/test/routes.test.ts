import { describe, expect, test } from 'bun:test';
import {
  buildRawFileUrl,
  buildRoute,
  parseRoute,
} from '../routes';

describe('routes', () => {
  const defaultRange = { from: 'HEAD', to: 'worktree' };

  test('builds canonical diff and file detail URLs', () => {
    const range = { from: 'HEAD', to: 'worktree' };
    expect(buildRoute({ screen: 'repo', ref: 'worktree', path: '', range })).toBe('/');
    expect(buildRoute({ screen: 'repo', ref: 'main', path: 'web-src/server', range }))
      .toBe('/?ref=main&path=web-src%2Fserver');
    expect(buildRoute({ screen: 'diff', range })).toBe('/todif?from=HEAD&to=worktree');
    expect(buildRoute({ screen: 'diff', range, path: 'web-src/app.ts', line: 3655 }))
      .toBe('/todif?from=HEAD&to=worktree&path=web-src%2Fapp.ts&line=3655');
    expect(buildRoute({ screen: 'file', path: 'src/a b.ts', ref: 'feat/foo', range }))
      .toBe('/file?path=src%2Fa%20b.ts&ref=feat%2Ffoo&from=HEAD&to=worktree');
    expect(buildRoute({ screen: 'file', path: 'README.md', ref: 'main', view: 'blob', range }))
      .toBe('/file?path=README.md&target=main');
    expect(buildRoute({ screen: 'file', path: 'README.md', ref: 'main', view: 'blob', line: 12, range }))
      .toBe('/file?path=README.md&target=main&line=12');
    expect(buildRoute({ screen: 'file', path: 'README.md', ref: 'main', view: 'blob', line: { start: 12, end: 15 }, range }))
      .toBe('/file?path=README.md&target=main&line=12-15');
    expect(buildRoute({ screen: 'help', lang: 'en', section: 'keybindings', range }))
      .toBe('/help');
    expect(buildRoute({ screen: 'help', lang: 'ja', section: 'keybindings', range }))
      .toBe('/help?lang=ja');
  });

  test('parses repository routes with worktree default ref', () => {
    expect(parseRoute('/', '', defaultRange))
      .toEqual({ screen: 'repo', ref: 'worktree', path: '', range: defaultRange });
    expect(parseRoute('/', '?ref=main&path=src', defaultRange))
      .toEqual({ screen: 'repo', ref: 'main', path: 'src', range: defaultRange });
    expect(parseRoute('/', '?target=main&path=src', defaultRange))
      .toEqual({ screen: 'repo', ref: 'main', path: 'src', range: defaultRange });
  });

  test('parses file routes with branch refs containing slashes', () => {
    expect(parseRoute('/file', '?path=src%2Fa.ts&ref=feat%2Ffoo&from=main&to=feat%2Ffoo', defaultRange))
      .toEqual({ screen: 'file', path: 'src/a.ts', ref: 'feat/foo', range: { from: 'main', to: 'feat/foo' }, view: 'detail' });
    expect(parseRoute('/file', '?path=README.md&target=worktree', defaultRange))
      .toEqual({ screen: 'file', path: 'README.md', ref: 'worktree', view: 'blob', range: defaultRange });
    expect(parseRoute('/file', '?path=README.md&target=main&line=12', defaultRange))
      .toEqual({ screen: 'file', path: 'README.md', ref: 'main', view: 'blob', line: 12, range: defaultRange });
    expect(parseRoute('/file', '?path=README.md&target=main&line=12-15', defaultRange))
      .toEqual({ screen: 'file', path: 'README.md', ref: 'main', view: 'blob', line: { start: 12, end: 15 }, range: defaultRange });
    expect(parseRoute('/file', '?path=README.md&target=main&line=15-12', defaultRange))
      .toEqual({ screen: 'file', path: 'README.md', ref: 'main', view: 'blob', line: { start: 12, end: 15 }, range: defaultRange });
  });

  test('reads legacy compact range URLs but writes canonical from and to params', () => {
    expect(parseRoute('/todif', '?range=HEAD~1..worktree', defaultRange))
      .toEqual({ screen: 'diff', range: { from: 'HEAD~1', to: 'worktree' } });
    expect(buildRoute(parseRoute('/todif', '?range=HEAD~1..worktree', defaultRange)))
      .toBe('/todif?from=HEAD~1&to=worktree');
  });

  test('returns explicit unknown routes instead of silently falling back', () => {
    expect(parseRoute('/file', '?ref=worktree', defaultRange))
      .toEqual({ screen: 'unknown', reason: 'missing-path', rawPathname: '/file', rawSearch: '?ref=worktree', range: defaultRange });
    expect(parseRoute('/blame', '?from=main&to=worktree', defaultRange))
      .toEqual({ screen: 'unknown', reason: 'unknown-pathname', rawPathname: '/blame', rawSearch: '?from=main&to=worktree', range: { from: 'main', to: 'worktree' } });
  });

  test('parses help routes with language and section defaults', () => {
    expect(parseRoute('/help', '', defaultRange))
      .toEqual({ screen: 'help', lang: 'en', section: 'keybindings', range: defaultRange });
    expect(parseRoute('/help', '?lang=ja&section=keybindings', defaultRange))
      .toEqual({ screen: 'help', lang: 'ja', section: 'keybindings', range: defaultRange });
  });

  test('builds deterministic URLs for round trips and todiff aliases', () => {
    expect(buildRoute(parseRoute('/todiff', '?from=main&to=feat%2Ffoo', defaultRange)))
      .toBe('/todif?from=main&to=feat%2Ffoo');
    expect(parseRoute('/todif', '?from=HEAD&to=worktree&path=web-src%2Fapp.ts&line=3655', defaultRange))
      .toEqual({ screen: 'diff', range: { from: 'HEAD', to: 'worktree' }, path: 'web-src/app.ts', line: 3655 });
    const route = { screen: 'file' as const, path: 'src/a?b&c=1.ts', ref: 'feat/foo', range: { from: 'HEAD^', to: 'worktree' } };
    expect(buildRoute(parseRoute('/file', buildRoute(route).slice('/file'.length), defaultRange)))
      .toBe(buildRoute(route));
  });

  test('builds raw file API URLs from path and ref only', () => {
    expect(buildRawFileUrl({ path: 'src/a.ts', ref: 'worktree' }))
      .toBe('/_file?path=src%2Fa.ts&ref=worktree');
  });
});
