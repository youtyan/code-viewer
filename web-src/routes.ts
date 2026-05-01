export type DiffRange = {
  from: string;
  to: string;
};

export type SourceFileTarget = {
  path: string;
  ref: string;
};

export type AppRoute =
  | { screen: 'repo'; ref: string; path: string; range: DiffRange }
  | { screen: 'diff'; range: DiffRange }
  | { screen: 'file'; path: string; ref: string; range: DiffRange; view?: 'blob' | 'detail' }
  | { screen: 'unknown'; reason: 'unknown-pathname' | 'missing-path'; rawPathname: string; rawSearch: string; range: DiffRange };

export const SPA_PATHS = ['/todif', '/todiff', '/file'] as const;
export const APP_ENTRY_PATHS = ['/', '/index.html'] as const;

export function assertNever(value: never): never {
  throw new Error('unhandled route: ' + JSON.stringify(value));
}

function parseLegacyRange(value: string | null | undefined, fallback: DiffRange): DiffRange {
  const raw = value || '';
  const sep = raw.indexOf('..');
  if (sep < 0) return fallback;
  return {
    from: raw.slice(0, sep) || fallback.from,
    to: raw.slice(sep + 2) || fallback.to,
  };
}

export function parseRoute(pathname: string, search: string, fallbackRange: DiffRange): AppRoute {
  const params = new URLSearchParams(search);
  const legacyRange = parseLegacyRange(params.get('range'), fallbackRange);
  const range = {
    from: params.get('from') || legacyRange.from,
    to: params.get('to') || legacyRange.to,
  };
  switch (pathname) {
    case '/':
    case '/index.html':
      return {
        screen: 'repo',
        ref: params.get('ref') || params.get('target') || 'worktree',
        path: params.get('path') || '',
        range,
      };
    case '/todif':
    case '/todiff':
      return { screen: 'diff', range };
    case '/file': {
      const path = params.get('path') || '';
      const target = params.get('target') || '';
      const ref = target || params.get('ref') || 'worktree';
      if (!path) return { screen: 'unknown', reason: 'missing-path', rawPathname: pathname, rawSearch: search, range };
      return { screen: 'file', path, ref, range, view: target ? 'blob' : 'detail' };
    }
    default:
      return { screen: 'unknown', reason: 'unknown-pathname', rawPathname: pathname, rawSearch: search, range };
  }
}

export function buildRoute(route: AppRoute): string {
  switch (route.screen) {
    case 'repo': {
      const params = new URLSearchParams();
      if (route.ref && route.ref !== 'worktree') params.set('ref', route.ref);
      if (route.path) params.set('path', route.path);
      const qs = params.toString();
      return '/' + (qs ? '?' + qs : '');
    }
    case 'file':
      if (route.view === 'blob') {
        return '/file?path=' + encodeURIComponent(route.path) +
          '&target=' + encodeURIComponent(route.ref || 'worktree');
      }
      return '/file?path=' + encodeURIComponent(route.path) +
        '&ref=' + encodeURIComponent(route.ref || 'worktree') +
        '&from=' + encodeURIComponent(route.range.from || '') +
        '&to=' + encodeURIComponent(route.range.to || 'worktree');
    case 'diff':
      return '/todif?from=' + encodeURIComponent(route.range.from || '') +
        '&to=' + encodeURIComponent(route.range.to || 'worktree');
    case 'unknown':
      return '/todif?from=' + encodeURIComponent(route.range.from || '') +
        '&to=' + encodeURIComponent(route.range.to || 'worktree');
    default:
      return assertNever(route);
  }
}

export function buildRawFileUrl(target: SourceFileTarget): string {
  return '/_file?path=' + encodeURIComponent(target.path) +
    '&ref=' + encodeURIComponent(target.ref || 'worktree');
}
