export type DiffRange = {
  from: string;
  to: string;
};

export type SourceLineRange = {
  start: number;
  end: number;
};

export type SourceLineTarget = number | SourceLineRange;

export type SourceFileTarget = {
  path: string;
  ref: string;
};

export type AppRoute =
  | { screen: 'repo'; ref: string; path: string; range: DiffRange }
  | { screen: 'diff'; range: DiffRange; path?: string; line?: SourceLineTarget }
  | { screen: 'file'; path: string; ref: string; range: DiffRange; view?: 'blob' | 'detail'; line?: SourceLineTarget }
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

function parseLineTarget(value: string | null | undefined): SourceLineTarget | undefined {
  const raw = value || '';
  const range = /^(\d+)-(\d+)$/.exec(raw);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    if (start > 0) return { start, end };
    return undefined;
  }
  const line = Number(raw);
  return Number.isInteger(line) && line > 0 ? line : undefined;
}

function formatLineTarget(line: SourceLineTarget): string {
  return typeof line === 'number' ? String(line) : line.start + '-' + line.end;
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
      return {
        screen: 'diff',
        range,
        ...(params.get('path') ? { path: params.get('path') || '' } : {}),
        ...(parseLineTarget(params.get('line')) ? { line: parseLineTarget(params.get('line')) } : {}),
      };
    case '/file': {
      const path = params.get('path') || '';
      const target = params.get('target') || '';
      const ref = target || params.get('ref') || 'worktree';
      const line = parseLineTarget(params.get('line'));
      if (!path) return { screen: 'unknown', reason: 'missing-path', rawPathname: pathname, rawSearch: search, range };
      return { screen: 'file', path, ref, range, view: target ? 'blob' : 'detail', ...(line ? { line } : {}) };
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
          '&target=' + encodeURIComponent(route.ref || 'worktree') +
          (route.line ? '&line=' + encodeURIComponent(formatLineTarget(route.line)) : '');
      }
      return '/file?path=' + encodeURIComponent(route.path) +
        '&ref=' + encodeURIComponent(route.ref || 'worktree') +
        '&from=' + encodeURIComponent(route.range.from || '') +
        '&to=' + encodeURIComponent(route.range.to || 'worktree') +
        (route.line ? '&line=' + encodeURIComponent(formatLineTarget(route.line)) : '');
    case 'diff':
      return '/todif?from=' + encodeURIComponent(route.range.from || '') +
        '&to=' + encodeURIComponent(route.range.to || 'worktree') +
        (route.path ? '&path=' + encodeURIComponent(route.path) : '') +
        (route.line ? '&line=' + encodeURIComponent(formatLineTarget(route.line)) : '');
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
