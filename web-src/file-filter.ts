export function normalizeFileFilterQuery(value: string | null | undefined): string {
  return (value || '').toLowerCase().trim();
}

export type CompiledFileFilter = {
  kind: 'empty' | 'substring' | 'regex' | 'invalid';
  match: (path: string) => boolean;
  error?: string;
};

function parseSlashRegex(query: string): { source: string; flags: string } | null {
  if (!query.startsWith('/') || query.length < 2) return null;
  const lastSlash = query.lastIndexOf('/');
  if (lastSlash <= 0) return null;
  return {
    source: query.slice(1, lastSlash),
    flags: query.slice(lastSlash + 1),
  };
}

export function compileFileFilter(value: string | null | undefined): CompiledFileFilter {
  const raw = (value || '').trim();
  if (!raw) return { kind: 'empty', match: () => true };

  const slashRegex = parseSlashRegex(raw);
  if (slashRegex) {
    try {
      const regex = new RegExp(slashRegex.source, slashRegex.flags);
      return { kind: 'regex', match: (path) => regex.test(path) };
    } catch (error) {
      return {
        kind: 'invalid',
        match: () => false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const q = normalizeFileFilterQuery(raw.startsWith('/') ? raw.slice(1) : raw);
  return {
    kind: 'substring',
    match: (path) => path.toLowerCase().includes(q),
  };
}

export function filePathMatchesFilter(path: string, query: string | null | undefined): boolean {
  return compileFileFilter(query).match(path);
}
