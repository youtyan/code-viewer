import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const app = readFileSync('web-src/app.ts', 'utf8');
const html = readFileSync('web/index.html', 'utf8');
const server = readFileSync('web-src/server/preview.ts', 'utf8');
const style = readFileSync('web/style.css', 'utf8');

describe('open path in OS action', () => {
  test('server exposes a localhost-only POST endpoint with bounded JSON input', () => {
    expect(server.includes("if (url.pathname === '/_open_path') return handleOpenPath(req)")).toBe(true);
    expect(server.includes("if (req.method !== 'POST') return text('method not allowed', 405)")).toBe(true);
    expect(server.includes('function sideEffectRequestAllowed(req: Request)')).toBe(true);
    expect(server.includes("if (!sideEffectRequestAllowed(req)) return text('forbidden', 403)")).toBe(true);
    expect(server.includes("return text('unsupported media type', 415)")).toBe(true);
    expect(server.includes("if (length > 1024) return text('payload too large', 413)")).toBe(true);
    expect(server.includes("if (kind !== 'directory' && kind !== 'file-parent') return text('invalid kind', 400)")).toBe(true);
    expect(server.includes("if (kind === 'file-parent' && !path) return text('invalid path', 400)")).toBe(true);
  });

  test('server validates repo-relative paths before spawning the OS opener', () => {
    expect(server.includes('function safeOpenWorktreePath(path: string): string | null')).toBe(true);
    expect(server.includes("path.split(/[\\\\/]+/).some(part => part.toLowerCase() === '.git')")).toBe(true);
    expect(server.includes('if (isGitInternalPath(rel)) return null')).toBe(true);
    expect(server.includes('Bun.spawn(cmd, { stdout:')).toBe(true);
  });

  test('UI adds open actions to directory-oriented surfaces', () => {
    expect(app.includes("createOpenPathButton(dir.path, 'directory', 'open this folder in OS')")).toBe(true);
    expect(app.includes("createOpenPathButton(target.path, 'file-parent', 'open parent folder in OS')")).toBe(true);
    expect(app.includes("createOpenPathButton(file.path, 'file-parent', 'open parent folder in OS')")).toBe(true);
    expect(app.includes("body: JSON.stringify({ path, kind })")).toBe(true);
    expect(app.includes("button.setAttribute('aria-label', title)")).toBe(true);
    expect(style.includes('.gdp-open-path {\n  color: var(--accent);')).toBe(true);
    expect(style.includes('.gdp-open-path:hover')).toBe(true);
    expect(style.includes('.gdp-open-path.opened')).toBe(true);
  });
});

describe('sidebar tree bulk actions', () => {
  test('sidebar exposes expand and collapse all buttons for tree mode', () => {
    expect(html.includes('id="sb-expand-all"')).toBe(true);
    expect(html.includes('id="sb-collapse-all"')).toBe(true);
    expect(html.includes('class="sb-actions"')).toBe(true);
    expect(html.includes('class="sb-icon-action sb-tree-action"')).toBe(true);
    expect(app.includes('function setAllSidebarDirsCollapsed(collapsed: boolean)')).toBe(true);
    expect(app.includes('function setSidebarTreeActionIcons()')).toBe(true);
    expect(app.includes("expand.innerHTML = iconSvg('octicon-unfold', UNFOLD_16_PATH)")).toBe(true);
    expect(app.includes("collapse.innerHTML = iconSvg('octicon-fold', FOLD_16_PATH)")).toBe(true);
    expect(app.includes("$('#sb-expand-all').addEventListener('click', () => setAllSidebarDirsCollapsed(false))")).toBe(true);
    expect(app.includes("$('#sb-collapse-all').addEventListener('click', () => setAllSidebarDirsCollapsed(true))")).toBe(true);
    expect(style.includes('.sb-actions')).toBe(true);
    expect(style.includes('.sb-icon-action')).toBe(true);
  });
});

describe('state changing refresh endpoint', () => {
  test('refresh uses the same side-effect request gate as upload and open path', () => {
    expect(server.includes("if (url.pathname === '/refresh' && req.method === 'POST')")).toBe(true);
    expect(server.includes("if (!sideEffectRequestAllowed(req)) return text('forbidden', 403);\n      generation++;")).toBe(true);
  });
});

describe('search palette shortcuts', () => {
  test('Ctrl+K and Ctrl+G open the palette while slash keeps sidebar filter focus', () => {
    expect(app.includes("openSearchPalette('file')")).toBe(true);
    expect(app.includes("openSearchPalette('grep')")).toBe(true);
    expect(app.includes("if (e.key === '/') { e.preventDefault(); focusFileFilter(); }")).toBe(true);
    expect(app.includes("focusFileFilter();\n      return;\n    }\n    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g')")).toBe(false);
  });

  test('palette keeps keyboard selection scrolled into view', () => {
    expect(app.includes("row.scrollIntoView({ block: 'nearest' })")).toBe(true);
  });
});
