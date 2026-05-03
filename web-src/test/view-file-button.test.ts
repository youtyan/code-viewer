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
    expect(html.includes('data-route="help"')).toBe(true);
    expect(html.includes('href="/help"')).toBe(true);
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

  test('help page renders localized subnavigation and keybindings section', () => {
    expect(app.includes('type HelpLanguage =')).toBe(true);
    expect(app.includes('const HELP_CONTENT')).toBe(true);
    expect(app.includes("keybindings: {")).toBe(true);
    expect(app.includes("function renderHelpPage()")).toBe(true);
    expect(app.includes("helpNav.className = 'gdp-help-nav'")).toBe(true);
    expect(app.includes("langSelect.className = 'gdp-help-language'")).toBe(true);
    expect(app.includes("Keyboard Shortcuts")).toBe(true);
    expect(app.includes("キーバインド")).toBe(true);
    expect(style.includes('.gdp-help-layout')).toBe(true);
    expect(style.includes('.gdp-help-nav')).toBe(true);
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

  test('repository file view does not render unsupported binary files as text', () => {
    expect(app.includes('function sourceDisplayKind(path: string)')).toBe(true);
    expect(app.includes("return 'unsupported'")).toBe(true);
    expect(app.includes('renderSourceUnsupported(card, target)')).toBe(true);
    expect(app.includes("const displayKind = sourceDisplayKind(target.path)")).toBe(true);
    expect(app.includes("if (displayKind === 'unsupported')")).toBe(true);
    expect(app.includes('Preview unavailable')).toBe(true);
    expect(app.includes('This file type cannot be previewed safely in the browser.')).toBe(true);
    expect(app.includes("if (displayKind === 'text')")).toBe(true);
    expect(app.includes('await response.text()')).toBe(true);
  });

  test('repository file view previews browser-playable audio files', () => {
    expect(app.includes("function sourceDisplayKind(path: string): 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'unsupported'")).toBe(true);
    expect(app.includes("if (isAudio(path)) return 'audio'")).toBe(true);
    expect(app.includes("displayKind === 'audio'")).toBe(true);
    expect(app.includes("mediaKind === 'audio'")).toBe(true);
    expect(app.includes("document.createElement('audio')")).toBe(true);
    expect(app.includes("const AUDIO_RE = /\\.(mp3|wav|ogg|flac|m4a|aac|opus)$/i")).toBe(true);
    expect(app.includes("if (isVideo(path)) return 'video';\n    if (isAudio(path)) return 'audio';")).toBe(true);
    expect(app.includes("if (ext === 'mid' || ext === 'midi') return 'MIDI file'")).toBe(true);
    expect(app.includes("return '<audio src=\"' + url + '\" controls preload=\"metadata\"></audio>'")).toBe(true);
    expect(style.includes('.gdp-media audio')).toBe(true);
  });

  test('repository file view treats common source and config formats as text', () => {
    expect(app.includes('TEXT_SOURCE_EXTENSIONS')).toBe(true);
    expect(app.includes('...Object.keys(EXT_TO_LANG)')).toBe(true);
    [
      "'tf'", "'tfvars'", "'hcl'", "'tfstate'",
      "'lua'", "'proto'", "'gradle'", "'properties'", "'patch'", "'diff'",
      "'nix'", "'cue'", "'rego'", "'bicep'", "'bazel'", "'graphqls'",
      "'bzl'", "'cmake'", "'ipynb'", "'thrift'", "'prisma'",
      "'ejs'", "'hbs'", "'mustache'", "'liquid'", "'pug'",
    ].forEach(ext => expect(app.includes(ext)).toBe(true));
    expect(app.includes('TEXT_SOURCE_FILENAMES')).toBe(true);
    [
      "'codeowners'", "'go.mod'", "'build.bazel'", "'workspace.bazel'", "'module.bazel'",
      "'copying'", "'authors'", "'contributors'",
      "'gemfile'", "'rakefile'", "'procfile'", "'brewfile'",
      "'.gitattributes'", "'.gitmodules'", "'.npmrc'", "'.nvmrc'",
      "'.yarnrc'", "'.prettierrc'", "'.eslintrc'",
    ].forEach(name => expect(app.includes(name)).toBe(true));
    expect(app.includes('isDockerfileName(name)')).toBe(true);
    expect(app.includes('isMakefileName(name)')).toBe(true);
    expect(app.includes('FILENAME_TO_LANG')).toBe(true);
    expect(app.includes("makefile: 'makefile'")).toBe(true);
    expect(app.includes("dockerfile: 'dockerfile'")).toBe(true);
    expect(app.includes("tf: 'terraform', tfvars: 'terraform', hcl: 'terraform'")).toBe(true);
  });

  test('unsupported file preview is styled as a file detail empty state', () => {
    expect(app.includes("content.className = 'gdp-source-unsupported-content'")).toBe(true);
    expect(app.includes("title.className = 'gdp-source-unsupported-title'")).toBe(true);
    expect(app.includes("message.className = 'gdp-source-unsupported-message'")).toBe(true);
    expect(app.includes("link.className = 'gdp-btn gdp-btn-sm gdp-source-download'")).toBe(true);
    expect(style.includes('.gdp-source-viewer.unsupported')).toBe(true);
    expect(style.includes('.gdp-source-unsupported-content')).toBe(true);
    expect(style.includes('.gdp-source-download')).toBe(true);
  });

  test('raw file responses use explicit browser-safe headers', () => {
    expect(server.includes('function rawFileHeaders(path: string, size: number | null = null): HeadersInit')).toBe(true);
    expect(server.includes('function rawFileSize(path: string, ref: string): number | null')).toBe(true);
    expect(server.includes("if (req.method === 'HEAD') return new Response(null")).toBe(true);
    expect(server.includes("headers['Content-Length'] = String(size)")).toBe(true);
    expect(server.includes("'X-Content-Type-Options': 'nosniff'")).toBe(true);
    expect(server.includes("'Content-Security-Policy': 'sandbox'")).toBe(true);
    expect(server.includes("'.pdf': 'application/pdf'")).toBe(true);
    expect(server.includes("'.mp3': 'audio/mpeg'")).toBe(true);
    expect(server.includes("'.wav': 'audio/wav'")).toBe(true);
    expect(server.includes("'.m4a': 'audio/mp4'")).toBe(true);
    expect(server.includes("'.mov': 'video/quicktime'")).toBe(true);
    expect(server.includes("'.mid': 'audio/midi'")).toBe(false);
  });

  test('raw file HEAD requests validate refs and paths before returning metadata', () => {
    expect(server.includes("if (!git.verifyTreeRef(ref, cwd)) return text('invalid ref', 400);\n    const size = rawFileSize(path, ref);\n    if (size == null) return text('not in ref', 404);\n    if (req.method === 'HEAD')")).toBe(true);
    expect(server.includes("const full = safeWorktreePath(path);\n    if (!full) return text('not found', 404);\n    const size = rawFileSize(path, ref);\n    if (size == null) return text('not found', 404);\n    if (req.method === 'HEAD')")).toBe(true);
  });

  test('binary and media file views show file metadata', () => {
    expect(app.includes('function formatBytes(bytes: number): string')).toBe(true);
    expect(app.includes('function humanFileKind(path: string, mime: string | undefined, fallback: string): string')).toBe(true);
    expect(app.includes('async function loadRawFileInfo(target: SourceFileTarget)')).toBe(true);
    expect(app.includes("method: 'HEAD'")).toBe(true);
    expect(app.includes("const rawSize = res.headers.get('content-length')")).toBe(true);
    expect(app.includes('size: rawSize != null && Number.isFinite(size) ? size : undefined')).toBe(true);
    expect(app.includes('function createSourceFileInfo')).toBe(true);
    expect(app.includes("type.textContent = humanFileKind(target.path, meta.type, kind)")).toBe(true);
    expect(app.includes("type.className = 'kind'")).toBe(true);
    expect(app.includes("'ZIP archive'")).toBe(true);
    expect(app.includes("'PDF document'")).toBe(true);
    expect(app.includes("resolution.textContent = img.naturalWidth + ' x ' + img.naturalHeight")).toBe(true);
    expect(app.includes('This file type cannot be previewed safely in the browser.')).toBe(true);
  });

  test('file detail supports markdown preview and code highlighting', () => {
    expect(app.includes('function isPreviewableSource(path: string): boolean')).toBe(true);
    expect(app.includes("previewButton.textContent = 'Preview'")).toBe(true);
    expect(app.includes("codeButton.textContent = 'Code'")).toBe(true);
    expect(app.includes("function createSourceTabs(active: 'preview' | 'code', textValue?: string)")).toBe(true);
    expect(app.includes("let previewButton: HTMLButtonElement | null = null")).toBe(true);
    expect(app.includes('return { tabs, codeButton, previewButton }')).toBe(true);
    expect(app.includes('await loadSyntaxHighlighter()')).toBe(true);
    expect(style.includes('.gdp-markdown-preview')).toBe(true);
    expect(style.includes('.gdp-source-tabs')).toBe(true);
  });

  test('file detail Code tab exposes a GitHub-style copy source button', () => {
    expect(app.includes('function createSourceCopyButton(textValue: string): HTMLButtonElement')).toBe(true);
    expect(app.includes("copy.className = 'gdp-file-header-icon gdp-copy-source'")).toBe(true);
    expect(app.includes("copy.title = 'Copy source'")).toBe(true);
    expect(app.includes("copy.innerHTML = iconSvg('octicon-copy', COPY_16_PATHS)")).toBe(true);
    expect(app.includes('await navigator.clipboard.writeText(textValue)')).toBe(true);
    expect(app.includes('tabs.appendChild(createSourceCopyButton(textValue))')).toBe(true);
    expect(app.includes("copy.className = 'gdp-file-header-icon gdp-copy-source gdp-source-virtual-copy'")).toBe(true);
    expect(app.includes("copy.setAttribute('aria-label', 'Copy source')")).toBe(true);
    expect(style.includes('.gdp-copy-source')).toBe(true);
    expect(style.includes('.gdp-copy-source.copied')).toBe(true);
    expect(style.includes('.gdp-copy-source.failed')).toBe(true);
    expect(style.includes('.gdp-source-virtual-copy')).toBe(true);
  });

  test('file detail uses Shiki for non-virtual source highlighting', () => {
    expect(app.includes('type SourceShikiHighlighter')).toBe(true);
    expect(app.includes('function loadSourceShikiHighlighter()')).toBe(true);
    expect(app.includes("import('/' + 'shiki.js')")).toBe(true);
    expect(app.includes('bundledLanguages?: Record<string, unknown>')).toBe(true);
    expect(app.includes('SOURCE_SHIKI_LANGS.filter(lang => !!typed.bundledLanguages?.[lang])')).toBe(true);
    expect(app.includes("'terraform'")).toBe(true);
    expect(app.includes('const sourceShikiLang = normalizeSourceShikiLang(lang)')).toBe(true);
    expect(app.includes('const shikiLines = sourceShikiRef && sourceShikiLang ? sourceShikiLines(textValue, sourceShikiLang, sourceShikiRef) : null')).toBe(true);
    expect(app.includes('renderVirtualSource(target, textValue, lines, hljsRef, lang)')).toBe(true);
    expect(app.includes("code.classList.add('shiki')")).toBe(true);
    expect(style.includes('.gdp-source-line-code.shiki')).toBe(true);
    expect(style.includes('[data-theme="dark"] .gdp-source-line-code.shiki span')).toBe(true);
  });

  test('file detail shows a Code tab even when preview is unavailable', () => {
    expect(app.includes('const previewable = isPreviewableSource(target.path)')).toBe(true);
    expect(app.includes("createSourceTabs(previewable ? 'preview' : 'code', textValue)")).toBe(true);
    expect(app.includes('if (tabsHost) {')).toBe(true);
    expect(app.includes('tabsHost.hidden = false')).toBe(true);
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
    expect(app.includes("if (dir.children_omitted_reason !== 'internal')")).toBe(true);
    expect(app.includes('children_omitted_reason: dir.children_omitted_reason')).toBe(true);
    expect(app.includes("if (!dir.children_omitted) {\n          chev.addEventListener('click', toggleDir)")).toBe(true);
    expect(app.includes("if (file.type === 'tree')")).toBe(true);
    expect(app.includes("setRoute(repoRoute(normalizedRef, file.path))")).toBe(true);
    expect(app.includes('loadRepo()')).toBe(true);
  });

  test('repository sidebar view toggle preserves repository click behavior', () => {
    expect(app.includes('let SIDEBAR_FILES: SidebarItem[] = []')).toBe(true);
    expect(app.includes('let SIDEBAR_ON_FILE_CLICK: ((file: SidebarItem) => void) | undefined')).toBe(true);
    expect(app.includes('SIDEBAR_FILES = files;')).toBe(true);
    expect(app.includes('SIDEBAR_ON_FILE_CLICK = onFileClick;')).toBe(true);
    expect(app.includes('renderSidebar(SIDEBAR_FILES, SIDEBAR_ON_FILE_CLICK);')).toBe(true);
  });

  test('repository file detail reveals its active path in the tree sidebar', () => {
    expect(app.includes('function sidebarAncestorDirs(path: string): string[]')).toBe(true);
    expect(app.includes('function expandSidebarAncestors(path: string)')).toBe(true);
    expect(app.includes('STATE.collapsedDirs.delete(dir)')).toBe(true);
    expect(app.includes("localStorage.setItem('gdp:collapsed-dirs', JSON.stringify([...STATE.collapsedDirs]))")).toBe(true);
    expect(app.includes('function markActive(path: string, options: { reveal?: boolean } = {})')).toBe(true);
    expect(app.includes("if (options.reveal && STATE.sbView === 'tree') expandSidebarAncestors(path);")).toBe(true);
    expect(app.includes("const active = document.querySelector<HTMLElement>('#filelist li.active[data-path], #filelist .tree-dir.active[data-dirpath]')")).toBe(true);
    expect(app.includes('requestAnimationFrame(() => scrollSidebarItemIntoView(active));')).toBe(true);
    expect(app.includes('markActive(currentPath, { reveal: true });')).toBe(true);
  });

  test('repository sidebar supports visible-row keyboard navigation', () => {
    expect(app.includes("import { resolveKeymapAction")).toBe(true);
    expect(app.includes("function dispatchKeymapAction(action: KeymapAction, scope: KeymapScope, repeated = false): boolean")).toBe(true);
    expect(app.includes('function visibleSidebarItems()')).toBe(true);
    expect(app.includes('function isSidebarRowVisible')).toBe(true);
    expect(app.includes("return $$<HTMLElement>('#filelist li[data-path], #filelist .tree-dir[data-dirpath]')")).toBe(true);
    expect(app.includes('function isRepositorySidebarMode()')).toBe(true);
    expect(app.includes('function moveActiveSidebarItem(direction: 1 | -1)')).toBe(true);
    expect(app.includes('function moveActiveSidebarPage(direction: 1 | -1)')).toBe(true);
    expect(app.includes("function scrollSidebarItemIntoView(item: HTMLElement, block: 'nearest' | 'start' | 'end' = 'nearest')")).toBe(true);
    expect(app.includes("const visibleTop = sidebarRect.top + topPadding")).toBe(true);
    expect(app.includes('function setActiveSidebarDirectoryCollapsed(collapsed: boolean)')).toBe(true);
    expect(app.includes('function openActiveSidebarItem()')).toBe(true);
    expect(app.includes('const repoSidebar = isRepositorySidebarMode()')).toBe(true);
    expect(app.includes("if (action === 'open-sidebar-item')")).toBe(true);
    expect(app.includes('openActiveSidebarItem()')).toBe(true);
    expect(app.includes("if (action === 'sidebar-expand')")).toBe(true);
    expect(app.includes('toggleActiveSidebarDirectoryCollapsed()')).toBe(true);
    expect(app.includes("if (action === 'sidebar-collapse')")).toBe(true);
    expect(app.includes('setActiveSidebarDirectoryCollapsed(true)')).toBe(true);
    expect(app.includes("if (action === 'sidebar-page-down' || action === 'sidebar-page-up')")).toBe(true);
    expect(app.includes("moveActiveSidebarPage(action === 'sidebar-page-down' ? 1 : -1)")).toBe(true);
    expect(app.includes("if (!repoSidebar && target.dataset.path) target.click()")).toBe(true);
    expect(app.includes("function moveActiveSidebarToEdge(edge: 'top' | 'bottom')")).toBe(true);
  });

  test('repository sidebar l toggles the active directory', () => {
    expect(app.includes('function toggleActiveSidebarDirectoryCollapsed()')).toBe(true);
    expect(app.includes("const active = document.querySelector<HTMLElement>('#filelist .tree-dir.active[data-dirpath]')")).toBe(true);
    expect(app.includes("const control = active.querySelector<HTMLElement>('.chev')")).toBe(true);
    expect(app.includes('if (control) control.click()')).toBe(true);
    expect(app.includes("if (action === 'sidebar-expand')")).toBe(true);
    expect(app.includes('toggleActiveSidebarDirectoryCollapsed()')).toBe(true);
  });

  test('vim panel focus and main-panel scrolling are routed through keymap actions', () => {
    expect(app.includes("from './focus-scope'")).toBe(true);
    expect(app.includes('getPanelFocusScope')).toBe(true);
    expect(app.includes('setPanelFocusScope')).toBe(true);
    expect(app.includes('prepareKeyboardPanels();')).toBe(true);
    expect(app.includes("function scrollMainPanel(direction: 1 | -1, repeated = false, unit: 'line' | 'page' = 'line')")).toBe(true);
    expect(app.includes('function sourceLineScrollAmount()')).toBe(true);
    expect(app.includes("function scrollMainToEdge(edge: 'top' | 'bottom')")).toBe(true);
    expect(app.includes("if (action === 'focus-sidebar')")).toBe(true);
    expect(app.includes("if (action === 'focus-main')")).toBe(true);
    expect(app.includes("if (action === 'scroll-main-down' || action === 'scroll-main-up')")).toBe(true);
    expect(app.includes("if (action === 'scroll-main-page-down' || action === 'scroll-main-page-up')")).toBe(true);
    expect(app.includes("function switchSourceTab(tab: 'preview' | 'code'): boolean")).toBe(true);
    expect(app.includes("if (action === 'tab-preview' || action === 'tab-code')")).toBe(true);
    expect(app.includes('focusMainPanel();')).toBe(true);
    expect(app.includes('focusSidebarPanel();')).toBe(true);
    expect(app.includes('if (onFileClick) onFileClick(f);\n          else scrollToFile(f.path);\n          focusMainPanel();')).toBe(false);
    expect(app.includes('onFileClick({\n                path: dir.path,')).toBe(true);
    expect(app.includes('composing: e.isComposing')).toBe(true);
    expect(app.includes('paletteOpen: !!PALETTE')).toBe(true);
    expect(app.includes("if (action === 'start-g-sequence')")).toBe(true);
    expect(app.includes("if (action === 'goto-top' || action === 'goto-bottom')")).toBe(true);
    expect(style.includes('body[data-focus-scope="sidebar"] #sidebar')).toBe(true);
    expect(style.includes('body[data-focus-scope="main"] #content')).toBe(true);
  });

  test('repository sidebar filter enter can focus a visible directory match', () => {
    expect(app.includes('function jumpToActiveOrFirstFilteredItem()')).toBe(true);
    expect(app.includes('const items = visibleSidebarItems();')).toBe(true);
    expect(app.includes('jumpToActiveOrFirstFilteredItem();')).toBe(true);
    expect(app.includes('visibleSidebarItems().filter(item => !!item.dataset.path)')).toBe(false);
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

  test('repository sidebar reuses the existing tree when navigating within the same ref', () => {
    expect(app.includes('let REPO_SIDEBAR_REF: string | null = null')).toBe(true);
    expect(app.includes('function activateRepoSidebarPath(currentPath: string)')).toBe(true);
    expect(app.includes('function invalidateRepoSidebar()')).toBe(true);
    expect(app.includes('function isRepoSidebarReusable(ref: string): boolean')).toBe(true);
    expect(app.includes('if (isRepoSidebarReusable(normalizedRef))')).toBe(true);
    expect(app.includes("if (!isRepoSidebarReusable(meta.ref)) $('#totals').textContent = ''")).toBe(true);
    expect(app.includes('return Promise.resolve()')).toBe(true);
    expect(app.includes("const activeRepoRef = repoFileTargetFromRoute() || (STATE.route.screen === 'repo' ? STATE.route.ref : '')")).toBe(true);
    expect(app.includes('invalidateRepoSidebar();\n      const savedScroll = window.scrollY;')).toBe(true);
    expect(app.includes('if (REPO_SIDEBAR_LOAD === load)')).toBe(true);
    expect(app.includes("$('#filelist').replaceChildren()")).toBe(false);
    expect(app.includes('REPO_SIDEBAR_REF = null')).toBe(true);
  });

  test('repository folder detail uses the available content width', () => {
    expect(style.includes('.gdp-repo-shell {\n  width: 100%;\n  min-width: 0;')).toBe(true);
    expect(style.includes('width: min(1120px, calc(100vw - 64px));')).toBe(false);
  });

  test('file detail mode ignores stale source fetches', () => {
    expect(app.includes('let SOURCE_REQ_SEQ = 0')).toBe(true);
    expect(app.includes('if (req !== SOURCE_REQ_SEQ || !sourceTargetsEqual(sourceTargetFromRoute(), target)) return')).toBe(true);
  });

  test('file detail source loading can be cancelled by button or Escape', () => {
    expect(app.includes('let ACTIVE_SOURCE_LOAD:')).toBe(true);
    expect(app.includes("function cancelActiveSourceLoad(reason: 'user' | 'navigation' | 'esc'): boolean")).toBe(true);
    expect(app.includes("fetch(buildRawFileUrl(target), { signal: controller.signal })")).toBe(true);
    expect(app.includes("renderSourceLoading(card, target, () => cancelActiveSourceLoad('user'))")).toBe(true);
    expect(app.includes("if (action === 'cancel-source-load')")).toBe(true);
    expect(app.includes('function renderSourceCancelled(card: DiffCardElement, target: SourceFileTarget)')).toBe(true);
    expect(app.includes('async function renderSourceText(card: DiffCardElement, target: SourceFileTarget, textValue: string, signal?: AbortSignal): Promise<boolean>')).toBe(true);
    expect(app.includes('if (signal?.aborted) return false')).toBe(true);
    expect(app.includes('const rendered = await renderSourceText(card, target, textValue, controller.signal)')).toBe(true);
    expect(style.includes('.gdp-source-viewer.cancelled')).toBe(true);
    expect(style.includes('.gdp-source-cancel')).toBe(true);
  });

  test('large source files use a virtualized source viewer instead of rendering every row', () => {
    expect(app.includes('const VIRTUAL_SOURCE_LINE_THRESHOLD = 3000')).toBe(true);
    expect(app.includes('function shouldVirtualizeSource(textValue: string, lines: string[]): boolean')).toBe(true);
    expect(app.includes('function isVirtualSourceDisabled(): boolean')).toBe(true);
    expect(app.includes("new URLSearchParams(window.location.search).get('virtual') === 'off'")).toBe(true);
    expect(app.includes("function renderVirtualSource(target: SourceFileTarget, textValue: string, lines: string[], hljsRef: HljsApi | null, lang: string | null): HTMLElement")).toBe(true);
    expect(app.includes("view.classList.add('virtual')")).toBe(true);
    expect(app.includes("badge.textContent = 'Virtual mode'")).toBe(true);
    expect(app.includes("const { tabs, codeButton, previewButton } = createSourceTabs('preview', textValue)")).toBe(true);
    expect(app.includes('virtualCode.hidden = true')).toBe(true);
    expect(app.includes("full.textContent = 'Open full view'")).toBe(true);
    expect(app.includes('navigator.clipboard.writeText(textValue)')).toBe(true);
    expect(app.includes('VIRTUAL_SOURCE_HIGHLIGHT_MAX_LINE_LENGTH')).toBe(true);
    expect(app.includes("code.innerHTML = hljsRef.highlight(line, { language: lang, ignoreIllegals: true }).value")).toBe(true);
    expect(app.includes("code.textContent = line")).toBe(true);
    expect(app.includes('windowEl.replaceChildren()')).toBe(true);
    expect(app.includes('render();')).toBe(true);
    expect(app.includes('new ResizeObserver(() =>')).toBe(true);
    expect(app.includes('resizeObserver?.disconnect()')).toBe(true);
    expect(style.includes('.gdp-source-virtual-scroller')).toBe(true);
    expect(style.includes('.gdp-source-virtual-row')).toBe(true);
    expect(style.includes('.gdp-source-virtual-badge')).toBe(true);
    expect(style.includes('.gdp-source-virtual-action')).toBe(true);
    expect(style.includes('.gdp-source-virtual-copy')).toBe(true);
    expect(style.includes('line-height: 20px;')).toBe(true);
  });

  test('huge added diffs can be opened through the virtualized file viewer', () => {
    expect(app.includes("openFileBtn.textContent = 'Open as file'")).toBe(true);
    expect(app.includes("openFileBtn.title = 'Open this file in the virtualized source viewer'")).toBe(true);
    expect(app.includes("if (file.status === 'A') wrap.appendChild(openFileBtn)")).toBe(true);
    expect(app.includes("fullBtn.textContent = 'Load full diff'")).toBe(true);
  });
});
