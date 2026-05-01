import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const app = readFileSync('web-src/app.ts', 'utf8');
const style = readFileSync('web/style.css', 'utf8');
const server = readFileSync('web-src/server/preview.ts', 'utf8');

describe('view file UI', () => {
  test('adds a right-side View File button that toggles back to diff', () => {
    expect(app.includes("button.textContent = sourceMode ? 'View Diff' : 'View File'")).toBe(true);
    expect(app.includes("viewFile.className = 'gdp-view-file gdp-btn gdp-btn-sm'")).toBe(true);
    expect(app.includes("button.classList.add('gdp-btn', 'gdp-btn-sm')")).toBe(true);
    expect(style.includes('.gdp-view-file')).toBe(true);
    expect(style.includes('.gdp-btn-sm')).toBe(true);
  });

  test('file view URLs include both path and ref', () => {
    expect(app.includes("buildRoute(nextRoute)")).toBe(true);
    expect(app.includes("buildRawFileUrl(target)")).toBe(true);
  });

  test('diff and file routes carry explicit from and to params', () => {
    expect(app.includes("parseRoute(window.location.pathname, window.location.search")).toBe(true);
    expect(app.includes("setRoute({ screen: 'diff', range: currentRange() })")).toBe(true);
  });

  test('top header exposes the diff viewer menu', () => {
    const html = readFileSync('web/index.html', 'utf8');
    expect(html.includes('class="app-menu"')).toBe(true);
    expect(html.includes('Diff Viewer')).toBe(true);
    expect(app.includes('function syncHeaderMenu()')).toBe(true);
    expect(style.includes('.app-menu-item.active')).toBe(true);
  });

  test('deleted files view old_path at the from ref', () => {
    expect(app.includes("if ((file.status || '').startsWith('D'))")).toBe(true);
    expect(app.includes("return { path: file.old_path || file.path, ref: STATE.from || 'HEAD' }")).toBe(true);
  });

  test('file and todif routes serve the SPA shell', () => {
    expect(server.includes("import { APP_ENTRY_PATHS, SPA_PATHS } from '../routes'")).toBe(true);
    expect(server.includes('for (const spaPath of [...APP_ENTRY_PATHS, ...SPA_PATHS])')).toBe(true);
  });

  test('file URLs can render outside the current diff when no card matches', () => {
    expect(app.includes('function renderStandaloneSource(target: SourceFileTarget)')).toBe(true);
    expect(app.includes('renderStandaloneSource(target)')).toBe(true);
  });

  test('source view renders file text as textContent, not HTML', () => {
    expect(app.includes('code.textContent = line')).toBe(true);
    expect(app.includes('num.textContent = String(index + 1)')).toBe(true);
  });

  test('file detail supports markdown preview and code highlighting', () => {
    expect(app.includes('function isPreviewableSource(path: string): boolean')).toBe(true);
    expect(app.includes("previewButton.textContent = 'Preview'")).toBe(true);
    expect(app.includes("codeButton.textContent = 'Code'")).toBe(true);
    expect(app.includes('await loadSyntaxHighlighter()')).toBe(true);
    expect(style.includes('.gdp-markdown-preview')).toBe(true);
    expect(style.includes('.gdp-source-tabs')).toBe(true);
  });

  test('file detail keeps preview tabs in the sticky header instead of the source viewer', () => {
    expect(app.includes("sticky.className = 'gdp-file-detail-sticky'")).toBe(true);
    expect(app.includes("tabsHost.className = 'gdp-file-detail-tabs'")).toBe(true);
    expect(app.includes('sticky.appendChild(tabsHost)')).toBe(true);
    expect(app.includes('tabsHost.replaceChildren(tabs)')).toBe(true);
    expect(app.includes('view.appendChild(tabs)')).toBe(false);
    expect(style.includes('.gdp-file-detail-sticky')).toBe(true);
    expect(style.includes('position: sticky')).toBe(true);
    expect(style.includes('top: var(--global-header-h)')).toBe(true);
  });

  test('file detail avoids doubled borders between the sticky header and source body', () => {
    expect(style.includes('.gdp-standalone-source .gdp-source-viewer')).toBe(true);
    expect(style.includes('border-top: 0')).toBe(true);
    expect(style.includes('border-radius: 0 0 6px 6px')).toBe(true);
    expect(style.includes('body.gdp-file-detail-page {\n  --chrome-h: var(--global-header-h);')).toBe(true);
  });

  test('file detail does not create hidden standalone source metadata', () => {
    expect(app.includes("const isStandalone = card.classList.contains('gdp-standalone-source')")).toBe(true);
    expect(app.includes("const header = isStandalone ? null : document.createElement('div')")).toBe(true);
    expect(style.includes('.gdp-standalone-source .gdp-source-meta')).toBe(false);
  });

  test('file detail header renders a breadcrumb path with copy action', () => {
    expect(app.includes('function createFileBreadcrumb(path: string): HTMLElement')).toBe(true);
    expect(app.includes("nav.className = 'gdp-file-breadcrumb'")).toBe(true);
    expect(app.includes("copy.className = 'gdp-file-header-icon gdp-copy-path'")).toBe(true);
    expect(style.includes('.gdp-file-breadcrumb')).toBe(true);
  });

  test('file detail mode ignores stale source fetches', () => {
    expect(app.includes('let SOURCE_REQ_SEQ = 0')).toBe(true);
    expect(app.includes('if (req !== SOURCE_REQ_SEQ || !sourceTargetsEqual(sourceTargetFromRoute(), target)) return')).toBe(true);
  });
});
