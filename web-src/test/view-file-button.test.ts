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

  test('repository blob routes render source without waiting for diff metadata', () => {
    expect(app.includes("STATE.route.screen === 'file' && STATE.route.view === 'blob'")).toBe(true);
    expect(app.includes("setStatus('live');\n    applySourceRouteToShell();")).toBe(true);
    expect(app.includes("if (STATE.route.screen === 'file') {\n        empty.classList.add('hidden');\n        applySourceRouteToShell();")).toBe(true);
  });

  test('toolbar does not expose the removed auto reload poller', () => {
    const html = readFileSync('web/index.html', 'utf8');
    expect(html.includes('id="auto-reload"')).toBe(false);
    expect(app.includes('gdp:auto-reload')).toBe(false);
    expect(app.includes('AUTO_RELOAD_MS')).toBe(false);
    expect(style.includes('#auto-reload')).toBe(false);
  });

  test('repository blob sidebar keeps a resize hit area on the visible edge', () => {
    expect(style.includes('#sidebar-resizer {\n  position: fixed;')).toBe(true);
    expect(style.includes('left: calc(var(--sidebar-w) - 4px);')).toBe(true);
    expect(style.includes('width: 8px;')).toBe(true);
    expect(style.includes('body.gdp-file-detail-page.gdp-repo-blob-page #sidebar-resizer {\n  display: block;')).toBe(true);
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
    expect(app.includes('function createFileBreadcrumb(path: string, ref?: string): HTMLElement')).toBe(true);
    expect(app.includes("nav.className = 'gdp-file-breadcrumb'")).toBe(true);
    expect(app.includes("copy.className = 'gdp-file-header-icon gdp-copy-path'")).toBe(true);
    expect(style.includes('.gdp-file-breadcrumb')).toBe(true);
  });

  test('file detail breadcrumb directory parts navigate to repository folders', () => {
    expect(app.includes('function createFileBreadcrumb(path: string, ref?: string): HTMLElement')).toBe(true);
    expect(app.includes("document.createElement(isCurrent ? 'span' : 'button')")).toBe(true);
    expect(app.includes("crumb.className = index === allParts.length - 1 ? 'gdp-file-breadcrumb-current' : 'gdp-file-breadcrumb-part'")).toBe(true);
    expect(app.includes("setRoute(repoRoute(ref || 'worktree', currentPath))")).toBe(true);
    expect(app.includes('loadRepo()')).toBe(true);
  });

  test('repository blob sidebar directory entries navigate to folder detail', () => {
    expect(app.includes("if (onFileClick) {\n          li.addEventListener('click'")).toBe(true);
    expect(app.includes("onFileClick({ path: dir.path, display_path: dir.path, type: 'tree', children_omitted: dir.children_omitted })")).toBe(true);
    expect(app.includes("chev.addEventListener('click', toggleDir)")).toBe(true);
    expect(app.includes("if (file.type === 'tree')")).toBe(true);
    expect(app.includes("setRoute(repoRoute(ref, file.path))")).toBe(true);
    expect(app.includes('loadRepo()')).toBe(true);
  });

  test('repository sidebar supports visible-row keyboard navigation', () => {
    expect(app.includes('function visibleSidebarItems()')).toBe(true);
    expect(app.includes('function isSidebarRowVisible')).toBe(true);
    expect(app.includes("return $$<HTMLElement>('#filelist li[data-path], #filelist .tree-dir[data-dirpath]')")).toBe(true);
    expect(app.includes('function isRepositorySidebarMode()')).toBe(true);
    expect(app.includes('function moveActiveSidebarItem(direction: 1 | -1)')).toBe(true);
    expect(app.includes('function setActiveSidebarDirectoryCollapsed(collapsed: boolean)')).toBe(true);
    expect(app.includes('function openActiveSidebarItem()')).toBe(true);
    expect(app.includes('const repoSidebar = isRepositorySidebarMode()')).toBe(true);
    expect(app.includes("if (e.key === 'Enter')")).toBe(true);
    expect(app.includes('openActiveSidebarItem()')).toBe(true);
    expect(app.includes("if (e.key === 'l')")).toBe(true);
    expect(app.includes('setActiveSidebarDirectoryCollapsed(false)')).toBe(true);
    expect(app.includes("if (e.key === 'h')")).toBe(true);
    expect(app.includes('setActiveSidebarDirectoryCollapsed(true)')).toBe(true);
  });

  test('repository sidebar filter does not hide the right-side detail pane', () => {
    expect(app.includes('if (!isRepositorySidebarMode()) {')).toBe(true);
    expect(app.includes("document.querySelectorAll<HTMLElement>('.gdp-file-shell').forEach(card => {")).toBe(true);
    expect(app.includes("card.classList.toggle('hidden-by-filter', !match)")).toBe(true);
  });

  test('repository folder pages keep the tree sidebar visible', () => {
    expect(app.includes("renderRepoBlobSidebar(meta.path || '', meta.ref)")).toBe(true);
    expect(style.includes('body.gdp-repo-page #sidebar,\nbody.gdp-file-detail-page #sidebar-resizer')).toBe(false);
    expect(style.includes('body.gdp-repo-page #content {\n  margin-left: var(--sidebar-w);')).toBe(true);
    expect(style.includes('body.gdp-repo-page #sidebar-resizer {\n  display: none;')).toBe(false);
  });

  test('repository folder detail uses the available content width', () => {
    expect(style.includes('.gdp-repo-shell {\n  width: 100%;\n  min-width: 0;')).toBe(true);
    expect(style.includes('width: min(1120px, calc(100vw - 64px));')).toBe(false);
  });

  test('file detail mode ignores stale source fetches', () => {
    expect(app.includes('let SOURCE_REQ_SEQ = 0')).toBe(true);
    expect(app.includes('if (req !== SOURCE_REQ_SEQ || !sourceTargetsEqual(sourceTargetFromRoute(), target)) return')).toBe(true);
  });
});
