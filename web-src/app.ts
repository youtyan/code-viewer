import { GdpExpandLogic } from './expand-logic';
import { nextVisibleFileIndex } from './file-navigation';
import { filePathClipboardText } from './file-path-copy';
import { compileFileFilter } from './file-filter';
import { findMainScrollTarget, focusMainPanel, focusSidebarPanel, getPanelFocusScope, isEditableKeyTarget, keymapScope, prepareKeyboardPanels, setPanelFocusScope, type PanelFocusScope } from './focus-scope';
import { fuzzyMatchPath, globMatchPath, isGlobPathQuery, rankPathMatches, type FuzzyRange } from './fuzzy-search';
import { resolveKeymapAction, type KeymapAction, type KeymapScope } from './keymap';
import { limitPaletteResults, movePaletteSelection } from './search-palette';
import { createCatchUpGate, shouldCatchUpDiff } from './catch-up';
import {
  buildRawFileUrl,
  buildRoute,
  parseRoute,
  type DiffRange,
  type AppRoute,
  type SourceFileTarget,
  type SourceLineTarget,
} from './routes';
import { renderMarkdownPreview } from './markdown-preview';
import { suppressWhitespaceOnlyInlineHighlights } from './ws-highlight';
import type {
  DiffCardElement,
  DiffMeta,
  FileDiffResponse,
  FileSearchListResponse,
  FileMeta,
  RepoTreeResponse,
  RepoTreeEntry,
  GrepResponse,
  RefResponse,
} from './types';

window.GdpExpandLogic = GdpExpandLogic;

(() => {
  type LayoutMode = 'side-by-side' | 'line-by-line';
  type SidebarView = 'tree' | 'flat';
  type ThemeMode = 'light' | 'dark';
  type HelpLanguage = 'en' | 'ja';
  type HelpSection = 'keybindings';
  type LoadQueueItem = { file: FileMeta; card: DiffCardElement; priority: number };
  type HljsApi = {
    configure?: (options: Record<string, unknown>) => void;
    getLanguage?: (language: string) => unknown;
    highlight?: (code: string, options: { language: string; ignoreIllegals: boolean }) => { value: string };
  };
  type SourceShikiHighlighter = {
    codeToHtml: (code: string, options: {
      lang: string;
      themes: { light: string; dark: string };
      defaultColor: false;
    }) => string;
  };
  type SourceShikiModule = {
    bundledLanguages?: Record<string, unknown>;
    createHighlighter: (options: { themes: string[]; langs: string[] }) => Promise<SourceShikiHighlighter>;
  };
  type TreeNode = {
    name: string;
    dirs: Record<string, TreeNode>;
    files: SidebarItem[];
    path: string;
    minOrder: number;
    explicit?: boolean;
    children_omitted?: true;
  };
  type SidebarItem = {
    order?: number;
    path: string;
    display_path?: string;
    type?: RepoTreeEntry['type'];
    children_omitted?: true;
    status?: string;
    additions?: number;
    deletions?: number;
  };
  type HunkInfo = {
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
  };
  type HunkSibling = {
    tr: HTMLTableRowElement;
    info?: Element | null;
    hunk?: HunkInfo | null;
    sideIndex?: number;
  };
  type HunkRow = {
    tr: HTMLTableRowElement;
    info: Element | null;
    hunk: HunkInfo;
    siblings: HunkSibling[];
    prevHunkEndNew: number;
    prevHunkEndOld: number;
    topExpandedStart?: number;
    bottomExpandedEnd?: number;
  };
  type AppState = {
    layout: LayoutMode;
    theme: ThemeMode;
    sbView: SidebarView;
    sbWidth: number;
    collapsedDirs: Set<string>;
    ignoreWs: boolean;
    from: string;
    to: string;
    collapsed: boolean;
    files: FileMeta[];
    activeFile: string | null;
    hideTests: boolean;
    syntaxHighlight: boolean;
    viewedFiles: Set<string>;
    route: AppRoute;
    repoRef: string;
  };
  type ScrollSpyHandler = EventListener & { _raf?: number | null };

  type HelpContent = {
    languageLabel: string;
    title: string;
    sections: Record<HelpSection, {
      nav: string;
      title: string;
      intro: string;
      groups: Array<{ title: string; rows: Array<[string, string]> }>;
    }>;
  };

  const FOLDER_ICON_PATHS = {
    closed: 'M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z',
    open: 'M.513 1.513A1.75 1.75 0 0 1 1.75 1h3.5c.55 0 1.07.26 1.4.7l.9 1.2a.25.25 0 0 0 .2.1H13a1 1 0 0 1 1 1v.5H2.75a.75.75 0 0 0 0 1.5h11.978a1 1 0 0 1 .994 1.117L15 13.25A1.75 1.75 0 0 1 13.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75c0-.464.184-.91.513-1.237Z',
  };
  const CHEVRON_DOWN_12_PATH = 'M6 8.825c-.2 0-.4-.1-.5-.2l-3.3-3.3c-.3-.3-.3-.8 0-1.1.3-.3.8-.3 1.1 0l2.7 2.7 2.7-2.7c.3-.3.8-.3 1.1 0 .3.3.3.8 0 1.1l-3.2 3.2c-.2.2-.4.3-.6.3Z';
  const CHEVRON_DOWN_16_PATH = 'M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z';
  const COPY_16_PATHS = [
    'M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z',
    'M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z',
  ];
  const FILE_16_PATH = 'M2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 12.25 16h-8.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 8 4.25V1.5Zm5.75.062V4.25c0 .138.112.25.25.25h2.688Z';
  const OPEN_EXTERNAL_16_PATH = 'M3.75 2A1.75 1.75 0 0 0 2 3.75v8.5C2 13.216 2.784 14 3.75 14h8.5A1.75 1.75 0 0 0 14 12.25v-3.5a.75.75 0 0 0-1.5 0v3.5a.25.25 0 0 1-.25.25h-8.5a.25.25 0 0 1-.25-.25v-8.5a.25.25 0 0 1 .25-.25h3.5a.75.75 0 0 0 0-1.5h-3.5Zm6.5 0a.75.75 0 0 0 0 1.5h1.19L7.72 7.22a.749.749 0 1 0 1.06 1.06l3.72-3.72v1.19a.75.75 0 0 0 1.5 0v-3A.75.75 0 0 0 13.25 2h-3Z';
  const UNFOLD_16_PATH = 'm8.177.677 2.896 2.896a.25.25 0 0 1-.177.427H8.75v1.25a.75.75 0 0 1-1.5 0V4H5.104a.25.25 0 0 1-.177-.427L7.823.677a.25.25 0 0 1 .354 0ZM7.25 10.75a.75.75 0 0 1 1.5 0V12h2.146a.25.25 0 0 1 .177.427l-2.896 2.896a.25.25 0 0 1-.354 0l-2.896-2.896A.25.25 0 0 1 5.104 12H7.25v-1.25Zm-5-2a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM6 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 6 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM12 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 12 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5Z';
  const FOLD_16_PATH = 'M10.896 2H8.75V.75a.75.75 0 0 0-1.5 0V2H5.104a.25.25 0 0 0-.177.427l2.896 2.896a.25.25 0 0 0 .354 0l2.896-2.896A.25.25 0 0 0 10.896 2ZM8.75 15.25a.75.75 0 0 1-1.5 0V14H5.104a.25.25 0 0 1-.177-.427l2.896-2.896a.25.25 0 0 1 .354 0l2.896 2.896a.25.25 0 0 1-.177.427H8.75v1.25Zm-6.5-6.5a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM6 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 6 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM12 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 12 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5Z';

  const $ = <T extends Element = HTMLElement>(sel: string): T => document.querySelector(sel) as T;
  const $$ = <T extends Element = HTMLElement>(sel: string): T[] => Array.from(document.querySelectorAll(sel)) as T[];
  const diffCardSelector = (path: string) =>
    '.gdp-file-shell[data-path="' + (window.CSS && CSS.escape ? CSS.escape(path) : path) + '"]';
  const HIGHLIGHT_SRC = '/vendor/highlight.js/highlight.min.js';
  const DEFAULT_RANGE: DiffRange = { from: 'HEAD', to: 'worktree' };
  const VIRTUAL_SOURCE_LINE_THRESHOLD = 3000;
  const VIRTUAL_SOURCE_SIZE_THRESHOLD = 1024 * 1024;
  // Keep in sync with .gdp-source-virtual-row height/line-height in web/style.css.
  const VIRTUAL_SOURCE_ROW_HEIGHT = 20;
  const VIRTUAL_SOURCE_HIGHLIGHT_MAX_LINE_LENGTH = 2000;
  let highlightLoadPromise: Promise<HljsApi | null> | null = null;
  let sourceShikiLoadPromise: Promise<SourceShikiHighlighter | null> | null = null;
  let highlightConfigured = false;
  let PROJECT_NAME = '';
  let REPO_SIDEBAR_REF: string | null = null;
  let REPO_SIDEBAR_LOAD_REF: string | null = null;
  let REPO_SIDEBAR_LOAD: Promise<void> | null = null;
  let PENDING_G_SCOPE: KeymapScope | null = null;
  let PENDING_G_UNTIL = 0;
  let SOURCE_CURSOR: { target: SourceFileTarget; line: number } | null = null;
  const SOURCE_CURSOR_TOTALS = new Map<string, number>();

  const HELP_LANGUAGES: HelpLanguage[] = ['en', 'ja'];
  const HELP_SECTIONS: HelpSection[] = ['keybindings'];
  const HELP_CONTENT: Record<HelpLanguage, HelpContent> = {
    en: {
      languageLabel: 'Language',
      title: 'Help',
      sections: {
        keybindings: {
          nav: 'Keybindings',
          title: 'Keyboard Shortcuts',
          intro: 'Use these shortcuts to move between panels and navigate files without leaving the keyboard.',
          groups: [
            { title: 'Global', rows: [['Ctrl+K', 'Open file palette'], ['Ctrl+G', 'Open grep palette'], ['/', 'Focus file filter'], ['t', 'Toggle theme']] },
            { title: 'Panels', rows: [['Ctrl+H', 'Focus sidebar'], ['Ctrl+L', 'Focus main panel']] },
            { title: 'Sidebar', rows: [['j / k', 'Move selection down / up'], ['Ctrl+D / Ctrl+U', 'Move selection by half a page'], ['gg / Shift+G', 'Move to top / bottom'], ['Enter', 'Open selected item'], ['h / l', 'Collapse / expand directory']] },
            { title: 'Main Panel', rows: [['j / k', 'Move code cursor down / up'], ['Ctrl+D / Ctrl+U', 'Move code cursor by half a page'], ['gg / Shift+G', 'Move code cursor to top / bottom'], ['gp / gc', 'Switch to Preview / Code tab']] },
          ],
        },
      },
    },
    ja: {
      languageLabel: '言語',
      title: 'ヘルプ',
      sections: {
        keybindings: {
          nav: 'キーバインド',
          title: 'キーバインド',
          intro: 'キーボードだけでパネル移動、ファイル選択、スクロールを行うためのショートカットです。',
          groups: [
            { title: 'グローバル', rows: [['Ctrl+K', 'ファイルパレットを開く'], ['Ctrl+G', 'grep パレットを開く'], ['/', 'ファイルフィルターへフォーカス'], ['t', 'テーマ切り替え']] },
            { title: 'パネル', rows: [['Ctrl+H', 'サイドバーへフォーカス'], ['Ctrl+L', 'メインパネルへフォーカス']] },
            { title: 'サイドバー', rows: [['j / k', '選択を下 / 上へ移動'], ['Ctrl+D / Ctrl+U', '半ページ分選択を移動'], ['gg / Shift+G', '先頭 / 末尾へ移動'], ['Enter', '選択項目を開く'], ['h / l', 'ディレクトリを閉じる / 開く']] },
            { title: 'メインパネル', rows: [['j / k', 'コードカーソルを下 / 上へ移動'], ['Ctrl+D / Ctrl+U', 'コードカーソルを半ページ分移動'], ['gg / Shift+G', 'コードカーソルを先頭 / 末尾へ移動'], ['gp / gc', 'Preview / Code タブへ切り替え']] },
          ],
        },
      },
    },
  };

  function sourceLineScrollAmount(): number | null {
    const virtualRow = Array.from(document.querySelectorAll<HTMLElement>('#content .gdp-source-virtual-row'))
      .find(item => item.offsetParent !== null);
    if (virtualRow) return virtualRow.getBoundingClientRect().height || VIRTUAL_SOURCE_ROW_HEIGHT;
    const sourceRow = Array.from(document.querySelectorAll<HTMLElement>('#content .gdp-source-table tr'))
      .find(item => item.offsetParent !== null);
    if (sourceRow) return sourceRow.getBoundingClientRect().height || 20;
    const preview = document.querySelector<HTMLElement>('#content .gdp-markdown-preview:not([hidden])');
    const lineHeight = Number.parseFloat(getComputedStyle(preview || document.body).lineHeight);
    return Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 20;
  }

  function hasVisibleSourceCodeSurface(): boolean {
    return Array.from(document.querySelectorAll<HTMLElement>('#content .gdp-source-virtual-scroller, #content .gdp-source-table'))
      .some(item => item.offsetParent !== null);
  }

  function sourceCursorKey(target: SourceFileTarget): string {
    return target.ref + '\0' + target.path;
  }

  function sourceCursorMatches(target: SourceFileTarget, line: number): boolean {
    return !!SOURCE_CURSOR && sourceTargetsEqual(SOURCE_CURSOR.target, target) && SOURCE_CURSOR.line === line;
  }

  function syncSourceCursorRows(target: SourceFileTarget) {
    document.querySelectorAll<HTMLElement>('#content [data-line]').forEach(row => {
      const line = Number(row.dataset.line || '0');
      row.classList.toggle('gdp-source-cursor', sourceCursorMatches(target, line));
    });
  }

  function visibleSourceLineFallback(): number {
    const scroller = findMainScrollTarget();
    if (scroller) return Math.max(1, Math.floor(scroller.scrollTop / VIRTUAL_SOURCE_ROW_HEIGHT) + 1);
    const rows = $$<HTMLElement>('#content .gdp-source-table tr[data-line]');
    const contentTop = document.querySelector<HTMLElement>('#content')?.getBoundingClientRect().top ?? 0;
    const row = rows.find(item => item.getBoundingClientRect().bottom >= Math.max(0, contentTop));
    return Math.max(1, Number(row?.dataset.line || '1'));
  }

  function ensureSourceCursor(target: SourceFileTarget): { target: SourceFileTarget; line: number } {
    if (SOURCE_CURSOR && sourceTargetsEqual(SOURCE_CURSOR.target, target)) return SOURCE_CURSOR;
    const routeLine = lineTargetStart(currentSourceLineTarget(target));
    SOURCE_CURSOR = { target, line: routeLine || visibleSourceLineFallback() };
    syncSourceCursorRows(target);
    return SOURCE_CURSOR;
  }

  function resetSourceCursorForTarget(target: SourceFileTarget, totalLines: number) {
    const routeLine = lineTargetStart(currentSourceLineTarget(target));
    SOURCE_CURSOR = { target, line: Math.max(1, Math.min(totalLines, routeLine || 1)) };
  }

  function scrollSourceCursorIntoView(cursor: { target: SourceFileTarget; line: number }, edge: 'nearest' | 'center' = 'nearest') {
    const scroller = findMainScrollTarget();
    if (scroller) {
      const top = (cursor.line - 1) * VIRTUAL_SOURCE_ROW_HEIGHT;
      const bottom = top + VIRTUAL_SOURCE_ROW_HEIGHT;
      const before = scroller.scrollTop;
      if (edge === 'center') scroller.scrollTop = Math.max(0, top - Math.round(scroller.clientHeight / 2));
      else if (top < scroller.scrollTop) scroller.scrollTop = top;
      else if (bottom > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = bottom - scroller.clientHeight;
      if (scroller.scrollTop !== before) scroller.dispatchEvent(new Event('scroll'));
      (scroller as HTMLElement & { __gdpRenderVirtualSource?: () => void }).__gdpRenderVirtualSource?.();
      syncSourceCursorRows(cursor.target);
      return;
    }
    document.querySelector<HTMLElement>('#content [data-line="' + cursor.line + '"]')?.scrollIntoView({ block: edge });
  }

  function moveSourceCursor(direction: 1 | -1, unit: 'line' | 'page' | 'edge', edge?: 'top' | 'bottom'): boolean {
    if (!hasVisibleSourceCodeSurface()) return false;
    const target = sourceTargetFromRoute();
    if (!target) return false;
    const total = SOURCE_CURSOR_TOTALS.get(sourceCursorKey(target));
    if (!total) return false;
    const cursor = ensureSourceCursor(target);
    if (unit === 'edge') {
      cursor.line = edge === 'bottom' ? total : 1;
      syncSourceCursorRows(target);
      scrollSourceCursorIntoView(cursor, 'center');
      return true;
    }
    const pageRows = Math.max(1, Math.floor(((findMainScrollTarget()?.clientHeight || window.innerHeight) * 0.55) / (sourceLineScrollAmount() || VIRTUAL_SOURCE_ROW_HEIGHT)));
    const delta = unit === 'page' ? pageRows : 1;
    cursor.line = Math.max(1, Math.min(total, cursor.line + direction * delta));
    syncSourceCursorRows(target);
    scrollSourceCursorIntoView(cursor);
    return true;
  }

  function scrollMainPanel(direction: 1 | -1, repeated = false, unit: 'line' | 'page' = 'line') {
    if (moveSourceCursor(direction, unit)) return;
    const top = direction * (unit === 'line' ? Math.round(sourceLineScrollAmount() || 32) : Math.round(window.innerHeight * 0.55));
    const behavior: ScrollBehavior = repeated ? 'auto' : 'smooth';
    const target = findMainScrollTarget();
    if (target) target.scrollBy({ top, behavior });
    else window.scrollBy({ top, behavior });
  }

  function scrollMainToEdge(edge: 'top' | 'bottom') {
    if (moveSourceCursor(edge === 'bottom' ? 1 : -1, 'edge', edge)) return;
    const target = findMainScrollTarget();
    if (target) {
      target.scrollTo({ top: edge === 'top' ? 0 : target.scrollHeight, behavior: 'auto' });
      return;
    }
    const top = edge === 'top' ? 0 : Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    window.scrollTo({ top, behavior: 'auto' });
  }

  function switchSourceTab(tab: 'preview' | 'code'): boolean {
    const tabs = document.querySelector<HTMLElement>('#content .gdp-source-tabs');
    if (!tabs) return false;
    const button = Array.from(tabs.querySelectorAll<HTMLButtonElement>('button'))
      .find(item => item.textContent?.trim().toLowerCase() === tab);
    if (!button || button.hidden || button.disabled) return false;
    button.click();
    focusMainPanel();
    return true;
  }

  function invalidateRepoSidebar() {
    REPO_SIDEBAR_REF = null;
    REPO_SIDEBAR_LOAD_REF = null;
    REPO_SIDEBAR_LOAD = null;
  }

  function isRepoSidebarReusable(ref: string): boolean {
    return REPO_SIDEBAR_REF === (ref || 'worktree') && isRepositorySidebarMode();
  }

  const STATE: AppState = (() => {
    const igRaw = localStorage.getItem('gdp:ignore-ws');
    const fallbackRange = {
      from: localStorage.getItem('gdp:from') || DEFAULT_RANGE.from,
      to: localStorage.getItem('gdp:to') || DEFAULT_RANGE.to,
    };
    const parsedRoute = parseRoute(window.location.pathname, window.location.search, fallbackRange);
    const route = parsedRoute.screen === 'unknown' ? { screen: 'diff' as const, range: parsedRoute.range } : parsedRoute;
    return {
      layout: (localStorage.getItem('gdp:layout') as LayoutMode) || 'side-by-side',
      theme:  (localStorage.getItem('gdp:theme') as ThemeMode)  || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
      sbView: (localStorage.getItem('gdp:sbview') as SidebarView) || 'tree',
      sbWidth: parseInt(localStorage.getItem('gdp:sbwidth')) || 308,
      collapsedDirs: new Set<string>(JSON.parse(localStorage.getItem('gdp:collapsed-dirs') || '[]')),
      ignoreWs: igRaw === null ? true : igRaw === '1',
      from: route.range.from,
      to:   route.range.to,
      collapsed: false,
      files: [],
      activeFile: null,
      hideTests: localStorage.getItem('gdp:hide-tests') === '1',
      syntaxHighlight: localStorage.getItem('gdp:syntax-highlight') !== '0',
      viewedFiles: new Set<string>(JSON.parse(localStorage.getItem('gdp:viewed-files') || '[]')),
      route,
      repoRef: route.screen === 'repo' ? route.ref : 'worktree',
    };
  })();

  function setStatus(s: 'live' | 'refreshing' | 'error' | null) {
    const el = $('#status');
    el.classList.remove('live', 'refreshing', 'error');
    if (s) el.classList.add(s);
  }

  function applyTheme() {
    document.documentElement.dataset.theme = STATE.theme;
    $<HTMLLinkElement>('#hljs-light').disabled = STATE.theme === 'dark';
    $<HTMLLinkElement>('#hljs-dark').disabled  = STATE.theme !== 'dark';
  }

  function getHljs(): HljsApi | null {
    const hljsRef = (window.hljs || (window.Diff2HtmlUI && window.Diff2HtmlUI.hljs)) as HljsApi | undefined;
    if (!hljsRef) return null;
    if (!highlightConfigured && typeof hljsRef.configure === 'function') {
      hljsRef.configure({ ignoreUnescapedHTML: true });
      highlightConfigured = true;
    }
    return hljsRef;
  }

  function setHighlightButton(state: 'idle' | 'loading' | 'loaded' | 'error') {
    const btn = $('#syntax-highlight');
    if (!btn) return;
    btn.classList.toggle('active', STATE.syntaxHighlight);
    btn.classList.toggle('loading', state === 'loading');
    btn.textContent = state === 'loading'
      ? 'loading...'
      : STATE.syntaxHighlight
        ? 'syntax on'
        : 'syntax off';
    btn.setAttribute('aria-pressed', STATE.syntaxHighlight ? 'true' : 'false');
    btn.title = STATE.syntaxHighlight
      ? 'syntax highlighting on'
      : state === 'loading'
        ? 'loading syntax highlighter'
        : state === 'error'
          ? 'failed to load syntax highlighter'
          : 'syntax highlighting off';
  }

  function loadSyntaxHighlighter(): Promise<HljsApi | null> {
    const existing = getHljs();
    if (existing) {
      setHighlightButton('loaded');
      return Promise.resolve(existing);
    }
    if (highlightLoadPromise) return highlightLoadPromise;

    setHighlightButton('loading');
    highlightLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = HIGHLIGHT_SRC;
      script.async = true;
      script.onload = () => {
        const hljsRef = getHljs();
        if (hljsRef) {
          setHighlightButton('loaded');
          resolve(hljsRef);
        } else {
          setHighlightButton('error');
          reject(new Error('highlight.js did not expose window.hljs'));
        }
      };
      script.onerror = () => {
        setHighlightButton('error');
        reject(new Error('failed to load highlight.js'));
      };
      document.head.appendChild(script);
    }).catch(() => {
      highlightLoadPromise = null;
      return null;
    });
    return highlightLoadPromise;
  }

  const SOURCE_SHIKI_LANGS = Array.from(new Set([
    'bash',
    'bibtex',
    'c',
    'clojure',
    'cmake',
    'cpp',
    'csharp',
    'css',
    'dart',
    'diff',
    'dockerfile',
    'elixir',
    'erlang',
    'fortran',
    'go',
    'gradle',
    'graphql',
    'haskell',
    'html',
    'java',
    'javascript',
    'json',
    'julia',
    'kotlin',
    'lua',
    'make',
    'markdown',
    'nix',
    'ocaml',
    'perl',
    'php',
    'properties',
    'protobuf',
    'python',
    'r',
    'rst',
    'ruby',
    'rust',
    'scala',
    'scss',
    'sql',
    'swift',
    'terraform',
    'tex',
    'toml',
    'typescript',
    'vim',
    'vue',
    'xml',
    'yaml',
  ]));

  const SOURCE_SHIKI_LANG_ALIASES: Record<string, string> = {
    makefile: 'make',
    objectivec: 'c',
    'objective-c': 'c',
    'objective-cpp': 'cpp',
    starlark: 'python',
  };

  function normalizeSourceShikiLang(lang: string | null): string | null {
    if (!lang) return null;
    return SOURCE_SHIKI_LANG_ALIASES[lang] || lang;
  }

  function loadSourceShikiHighlighter(): Promise<SourceShikiHighlighter | null> {
    if (!sourceShikiLoadPromise) {
      sourceShikiLoadPromise = import('/' + 'shiki.js').then((mod: unknown) => {
        const typed = mod as SourceShikiModule;
        const langs = typed.bundledLanguages
          ? SOURCE_SHIKI_LANGS.filter(lang => !!typed.bundledLanguages?.[lang])
          : SOURCE_SHIKI_LANGS;
        return typed.createHighlighter({
          themes: ['github-light', 'github-dark'],
          langs,
        });
      }).catch(() => null);
    }
    return sourceShikiLoadPromise;
  }

  function sourceShikiLines(textValue: string, lang: string, highlighter: SourceShikiHighlighter): string[] | null {
    try {
      const html = highlighter.codeToHtml(textValue || ' ', {
        lang,
        themes: { light: 'github-light', dark: 'github-dark' },
        defaultColor: false,
      });
      const template = document.createElement('template');
      template.innerHTML = html;
      const renderedLines = Array.from(template.content.querySelectorAll<HTMLElement>('.line'));
      if (!renderedLines.length) return null;
      return renderedLines.map(line => line.innerHTML || ' ');
    } catch {
      return null;
    }
  }

  function rerenderLoadedDiffs() {
    document.querySelectorAll<DiffCardElement>('.gdp-file-shell.loaded').forEach(card => {
      const data = card._diffData;
      const file = card._file;
      if (!data || !file) return;
      mountDiff(card, file, data);
      if (data.truncated && data.mode === 'preview') {
        addExpandHunksUI(file, data, card);
      }
      scheduleIdleHighlight(card, file);
    });
  }

  function setLayout(layout: LayoutMode) {
    STATE.layout = layout;
    localStorage.setItem('gdp:layout', layout);
    $$('#topbar .seg button').forEach(b => {
      b.classList.toggle('active', b.dataset.layout === layout);
    });
    // Re-render diff2html in each loaded card with the new layout, but
    // respect per-file force_layout (large/huge are pinned to line-by-line).
    document.querySelectorAll<DiffCardElement>('.gdp-file-shell.loaded').forEach(card => {
      const data = card._diffData;
      const file = card._file;
      if (!data || !file) return;
      mountDiff(card, file, data);
      if (data.truncated && data.mode === 'preview') {
        addExpandHunksUI(file, data, card);
      }
      scheduleIdleHighlight(card, file);
    });
  }

  function fileBadge(status?: string) {
    const ch = (status || 'M')[0].toUpperCase();
    const span = document.createElement('span');
    span.className = 'badge ' + ch;
    span.textContent = ch;
    span.title = ({ M: 'modified', A: 'added', D: 'deleted', R: 'renamed' })[ch] || ch;
    return span;
  }

  function persistViewedFiles() {
    localStorage.setItem('gdp:viewed-files', JSON.stringify([...STATE.viewedFiles]));
  }

  function setFileViewed(path: string, viewed: boolean) {
    if (viewed) STATE.viewedFiles.add(path);
    else STATE.viewedFiles.delete(path);
    persistViewedFiles();
    applyViewedState();
    $$<HTMLElement>(diffCardSelector(path)).forEach(card => {
      applyViewedToCard(card, viewed, true);
    });
  }

  function syncViewedCardDisplay(card: HTMLElement, viewed: boolean) {
    card.classList.toggle('viewed', viewed);
    card.querySelectorAll<HTMLInputElement>('.d2h-file-collapse-input').forEach(checkbox => {
      checkbox.checked = viewed;
    });
  }

  function applyViewedToCard(card: HTMLElement, viewed: boolean, collapseLoaded = false) {
    syncViewedCardDisplay(card, viewed);
    if (collapseLoaded && card.classList.contains('loaded')) {
      setFileCollapsed(card as DiffCardElement, viewed);
    }
  }

  function setFolderIcon(el: HTMLElement, collapsed: boolean) {
    const path = collapsed ? FOLDER_ICON_PATHS.closed : FOLDER_ICON_PATHS.open;
    el.innerHTML = '<svg class="octicon octicon-file-directory-' + (collapsed ? 'fill' : 'open-fill') + '" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">' +
      '<path fill="currentColor" d="' + path + '"></path></svg>';
  }

  function setChevronIcon(el: HTMLElement) {
    el.innerHTML = '<svg class="octicon octicon-chevron-down" viewBox="0 0 12 12" width="12" height="12" fill="currentColor" aria-hidden="true">' +
      '<path fill="currentColor" d="' + CHEVRON_DOWN_12_PATH + '"></path></svg>';
  }

  function iconSvg(className: string, paths: string | string[]): string {
    const pathList = Array.isArray(paths) ? paths : [paths];
    return '<svg class="octicon ' + className + '" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">' +
      pathList.map(path => '<path fill="currentColor" d="' + path + '"></path>').join('') +
      '</svg>';
  }

  function setUnfoldButtonState(button: HTMLButtonElement | null, expanded: boolean) {
    if (!button) return;
    button.setAttribute('aria-pressed', expanded ? 'true' : 'false');
    button.title = expanded ? 'Collapse expanded lines' : 'Expand all lines';
    button.innerHTML = expanded
      ? iconSvg('octicon-fold', FOLD_16_PATH)
      : iconSvg('octicon-unfold', UNFOLD_16_PATH);
  }

  function setSidebarTreeActionIcons() {
    const expand = document.querySelector<HTMLButtonElement>('#sb-expand-all');
    const collapse = document.querySelector<HTMLButtonElement>('#sb-collapse-all');
    if (expand) expand.innerHTML = iconSvg('octicon-unfold', UNFOLD_16_PATH);
    if (collapse) collapse.innerHTML = iconSvg('octicon-fold', FOLD_16_PATH);
  }


  // Build a directory trie from server tree entries. Explicit directory
  // entries are kept even when they have no visible file children, so the
  // worktree sidebar matches the repository tree screen.
  function buildTree(files: SidebarItem[]): TreeNode {
    const root: TreeNode = { name: '', dirs: {}, files: [], path: '', minOrder: Infinity, explicit: true };
    for (const f of files) {
      const parts = f.path.split('/');
      let node = root;
      let acc = '';
      const dirPartCount = f.type === 'tree' ? parts.length : parts.length - 1;
      for (let i = 0; i < dirPartCount; i++) {
        const p = parts[i];
        acc = acc ? acc + '/' + p : p;
        if (!node.dirs[p]) {
          node.dirs[p] = { name: p, dirs: {}, files: [], path: acc, minOrder: Infinity };
        }
        node = node.dirs[p];
        if (typeof f.order === 'number' && f.order < node.minOrder) node.minOrder = f.order;
      }
      if (f.type === 'tree') {
        node.explicit = true;
        if (f.children_omitted === true) node.children_omitted = true;
        continue;
      }
      node.files.push(f);
    }
    function compress(node: TreeNode) {
      const ks = Object.keys(node.dirs);
      while (ks.length === 1 && node.files.length === 0 && !node.explicit && node !== root) {
        const only = node.dirs[ks[0]];
        node.name = node.name ? node.name + '/' + only.name : only.name;
        node.dirs = only.dirs;
        node.files = only.files;
        node.path = only.path;
        node.minOrder = Math.min(node.minOrder, only.minOrder);
        ks.length = 0;
        Object.keys(node.dirs).forEach(k => ks.push(k));
      }
      Object.values(node.dirs).forEach(compress);
    }
    Object.values(root.dirs).forEach(compress);
    return root;
  }

  function renderTreeNode(node: TreeNode, depth: number, ul: HTMLElement, onFileClick?: (file: SidebarItem) => void) {
    // Sort by server-assigned order so the sidebar preserves the same root
    // ordering as the repository tree response.
    const items = [];
    for (const k of Object.keys(node.dirs)) {
      const d = node.dirs[k];
      items.push({ kind: 'dir', sortKey: d.minOrder, dir: d });
    }
    for (const f of node.files) {
      items.push({ kind: 'file', sortKey: f.order != null ? f.order : Infinity, file: f });
    }
    items.sort((a, b) => a.sortKey - b.sortKey);

    for (const item of items) {
      if (item.kind === 'dir') {
        const dir = item.dir;
        const li = document.createElement('li');
        li.className = 'tree-dir';
        li.tabIndex = -1;
        li.dataset.dirpath = dir.path;
        if (dir.explicit) li.dataset.explicit = 'true';
        if (dir.children_omitted) {
          li.classList.add('children-omitted');
          li.title = 'Directory contents are intentionally not listed';
        }
        li.style.setProperty('--lvl-pad', (12 + depth * 14) + 'px');
        const chev = document.createElement('span');
        chev.className = 'chev';
        setChevronIcon(chev);
        li.appendChild(chev);
        const dirIcon = document.createElement('span');
        dirIcon.className = 'dir-icon';
        li.appendChild(dirIcon);
        const label = document.createElement('span');
        label.className = 'dir-label';
        const dn = document.createElement('span');
        dn.className = 'dir-name';
        dn.textContent = dir.name;
        dn.title = dir.path;
        label.appendChild(dn);
        if (dir.children_omitted) {
          const omitted = document.createElement('span');
          omitted.className = 'dir-omitted';
          omitted.textContent = 'skipped';
          omitted.title = 'Directory contents are intentionally not listed';
          label.appendChild(omitted);
        }
        li.appendChild(label);
        li.appendChild(createOpenPathButton(dir.path, 'directory', 'open this folder in OS'));
        const collapsed = STATE.collapsedDirs.has(dir.path);
        if (collapsed) li.classList.add('collapsed');
        const updateIcon = () => {
          setFolderIcon(dirIcon, li.classList.contains('collapsed'));
        };
        updateIcon();
        const childUl = document.createElement('ul');
        childUl.className = 'tree-children';
        renderTreeNode(dir, depth + 1, childUl, onFileClick);
        const toggleDir = (e: Event) => {
          e.stopPropagation();
          li.classList.toggle('collapsed');
          updateIcon();
          if (li.classList.contains('collapsed')) STATE.collapsedDirs.add(dir.path);
          else STATE.collapsedDirs.delete(dir.path);
          localStorage.setItem('gdp:collapsed-dirs', JSON.stringify([...STATE.collapsedDirs]));
        };
        chev.addEventListener('click', toggleDir);
        dirIcon.addEventListener('click', toggleDir);
        if (onFileClick) {
          li.addEventListener('click', (e) => {
            e.stopPropagation();
            onFileClick({ path: dir.path, display_path: dir.path, type: 'tree', children_omitted: dir.children_omitted });
            focusSidebarPanel();
          });
        } else {
          li.addEventListener('click', toggleDir);
        }
        ul.appendChild(li);
        ul.appendChild(childUl);
      } else {
        const f = item.file;
        const li = document.createElement('li');
        li.className = 'tree-file';
        li.tabIndex = -1;
        li.dataset.path = f.path;
        li.classList.toggle('viewed', !onFileClick && STATE.viewedFiles.has(f.path));
        li.style.setProperty('--lvl-pad', (12 + depth * 14) + 'px');
        const spacer = document.createElement('span');
        spacer.className = 'chev-spacer';
        li.appendChild(spacer);
        if (f.status) {
          li.appendChild(fileBadge(f.status));
        } else {
          const icon = document.createElement('span');
          icon.className = 'd2h-icon-wrapper';
          icon.innerHTML = fileEntryIcon();
          li.appendChild(icon);
        }
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = f.path.split('/').pop();
        name.title = f.path;
        li.appendChild(name);
        li.addEventListener('click', () => {
          if (onFileClick) onFileClick(f);
          else scrollToFile(f.path);
          focusSidebarPanel();
        });
        if (!onFileClick) li.addEventListener('mouseenter', () => prefetchByPath(f.path), { passive: true });
        ul.appendChild(li);
      }
    }
  }

  function renderFlat(files: SidebarItem[], ul: HTMLElement, onFileClick?: (file: SidebarItem) => void) {
    files.forEach((f, i) => {
      const li = document.createElement('li');
      li.tabIndex = -1;
      li.dataset.index = String(i);
      li.dataset.path = f.path;
      li.classList.toggle('viewed', !onFileClick && STATE.viewedFiles.has(f.path));
      if (f.status) {
        li.appendChild(fileBadge(f.status));
      } else {
        const icon = document.createElement('span');
        icon.className = 'd2h-icon-wrapper';
        icon.innerHTML = fileEntryIcon();
        li.appendChild(icon);
      }
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = f.path;
      name.title = f.path;
      li.appendChild(name);
      li.addEventListener('click', () => {
        if (onFileClick) onFileClick(f);
        else scrollToFile(f.path);
        focusSidebarPanel();
      });
      if (!onFileClick) li.addEventListener('mouseenter', () => prefetchByPath(f.path), { passive: true });
      ul.appendChild(li);
    });
  }

  function renderSidebar(files: SidebarItem[], onFileClick?: (file: SidebarItem) => void) {
    const ul = $('#filelist');
    ul.innerHTML = '';
    ul.classList.toggle('tree', STATE.sbView === 'tree');
    STATE.files = files as FileMeta[];
    if (!onFileClick) REPO_SIDEBAR_REF = null;
    if (STATE.sbView === 'tree') {
      const root = buildTree(files);
      renderTreeNode(root, 0, ul, onFileClick);
    } else {
      renderFlat(files, ul, onFileClick);
    }
    $('#totals').textContent = files.length
      ? files.length + ' file' + (files.length === 1 ? '' : 's')
      : '';
    // Update view-toggle visual
    $$('.sb-view-seg button').forEach(b => {
      b.classList.toggle('active', b.dataset.view === STATE.sbView);
    });
    $$('.sb-tree-action').forEach(b => {
      (b as HTMLButtonElement).disabled = STATE.sbView !== 'tree' || !STATE.files.length;
    });
    // Re-apply active highlight if any
    if (STATE.activeFile) markActive(STATE.activeFile);
    applyFilter();
  }

  function setAllSidebarDirsCollapsed(collapsed: boolean) {
    if (!collapsed) STATE.collapsedDirs.clear();
    $$<HTMLElement>('#filelist .tree-dir[data-dirpath]').forEach(li => {
      const path = li.dataset.dirpath || '';
      if (!path) return;
      li.classList.toggle('collapsed', collapsed);
      const dirIcon = li.querySelector<HTMLElement>('.dir-icon');
      if (dirIcon) setFolderIcon(dirIcon, collapsed);
      if (collapsed) STATE.collapsedDirs.add(path);
    });
    localStorage.setItem('gdp:collapsed-dirs', JSON.stringify([...STATE.collapsedDirs]));
  }

  function syncRepoTargetInput(ref: string) {
    const input = document.querySelector<HTMLInputElement>('#repo-target');
    const wrap = document.querySelector<HTMLElement>('#repo-target-wrap');
    if (!input || !wrap) return;
    input.value = ref || 'worktree';
    wrap.hidden = !(STATE.route.screen === 'file' && STATE.route.view === 'blob');
  }

  function renderMeta(meta: DiffMeta | null) {
    const el = $('#meta');
    if (!meta) { el.textContent = ''; return; }
    PROJECT_NAME = meta.project || PROJECT_NAME;
    document.title = (meta.project ? meta.project + ' - ' : '') + 'code viewer';
    el.innerHTML = '';
    if (meta.branch) {
      const b = document.createElement('span');
      b.className = 'ref';
      b.textContent = '⎇ ' + meta.branch;
      el.appendChild(b);
    }
    if (meta.totals) {
      const t = document.createElement('span');
      t.className = 'num';
      t.innerHTML =
        '<span class="add">+' + meta.totals.additions + '</span> ' +
        '<span class="del">−' + meta.totals.deletions + '</span> ' +
        '<span>' + meta.totals.files + ' files</span>';
      el.appendChild(t);
    }
    const u = document.createElement('span');
    u.className = 'updated-at';
    u.title = 'last updated';
    u.textContent = 'updated ' + new Date().toLocaleTimeString([], { hour12: false });
    el.appendChild(u);
  }

  // While we're animating a programmatic scroll (e.g. from a sidebar click),
  // suppress scrollspy so the user-chosen active item doesn't flicker through
  // every file the scroll passes over.
  let SUPPRESS_SPY_UNTIL = 0;

  // Prefetch a file's diff (low priority). Used for sidebar hover and j/k.
  function prefetchByPath(path: string) {
    const card = document.querySelector<DiffCardElement>(diffCardSelector(path));
    if (!card || !card.classList.contains('pending')) return;
    const f = STATE.files.find(x => x.path === path);
    if (!f) return;
    enqueueLoad(f, card, 5);
  }

  function clearDiffLineFocus() {
    document.querySelectorAll<HTMLElement>('.gdp-diff-line-target').forEach(row => {
      row.classList.remove('gdp-diff-line-target');
    });
  }

  function diffRowLineNumber(row: HTMLTableRowElement): number | null {
    const newLine = row.querySelector<HTMLElement>('.line-num2, td.d2h-code-side-linenumber');
    const raw = (newLine?.textContent || '').trim();
    const line = Number(raw);
    return Number.isInteger(line) && line > 0 ? line : null;
  }

  function focusDiffLine(card: HTMLElement, line: SourceLineTarget | undefined) {
    const start = lineTargetStart(line);
    if (!start) return false;
    const rows = Array.from(card.querySelectorAll<HTMLTableRowElement>('table.d2h-diff-table tr'));
    const row = rows.find(candidate => diffRowLineNumber(candidate) === start);
    if (!row) return false;
    clearDiffLineFocus();
    row.classList.add('gdp-diff-line-target');
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }

  function applyDiffRouteFocus(card?: HTMLElement) {
    if (STATE.route.screen !== 'diff' || !STATE.route.path || !STATE.route.line) return false;
    if (card && card.dataset.path !== STATE.route.path) return false;
    const targetCard = card || document.querySelector<DiffCardElement>(diffCardSelector(STATE.route.path));
    if (!targetCard) return false;
    return focusDiffLine(targetCard, STATE.route.line);
  }

  function scrollToFile(path: string, line?: SourceLineTarget) {
    const card = document.querySelector<DiffCardElement>(diffCardSelector(path));
    if (!card) return;
    markActive(path);
    SUPPRESS_SPY_UNTIL = performance.now() + 1500;
    const onEnd = () => {
      SUPPRESS_SPY_UNTIL = 0;
      window.removeEventListener('scrollend', onEnd);
    };
    window.addEventListener('scrollend', onEnd, { once: true });
    // Priority-load if still pending
    if (card.classList.contains('pending')) {
      const f = STATE.files.find(x => x.path === path);
      if (f) enqueueLoad(f, card, 10);
    }
    if (!line || !focusDiffLine(card, line)) {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function markActive(path: string) {
    STATE.activeFile = path;
    $$('#filelist li').forEach(li => {
      const itemPath = li.dataset.path || li.dataset.dirpath;
      if (itemPath) li.classList.toggle('active', itemPath === path);
    });
  }

  function applyViewedState() {
    $$<HTMLElement>('#filelist li[data-path]').forEach(li => {
      const path = li.dataset.path || '';
      li.classList.toggle('viewed', !isRepositorySidebarMode() && STATE.viewedFiles.has(path));
    });
    if (isRepositorySidebarMode()) return;
    $$<HTMLElement>('.gdp-file-shell[data-path]').forEach(card => {
      const path = card.dataset.path || '';
      const viewed = STATE.viewedFiles.has(path);
      syncViewedCardDisplay(card, viewed);
    });
  }

  function applyFilter() {
    const input = $<HTMLInputElement>('#sb-filter');
    const filter = compileFileFilter(input.value);
    const invalid = filter.kind === 'invalid';
    input.toggleAttribute('aria-invalid', invalid);
    input.title = invalid ? filter.error || 'invalid regular expression' : '';
    const matches = invalid ? () => true : filter.match;
    $$('#filelist li[data-path]').forEach(li => {
      const match = matches(li.dataset.path || '');
      li.classList.toggle('hidden', !match);
    });
    if (!isRepositorySidebarMode()) {
      document.querySelectorAll<HTMLElement>('.gdp-file-shell').forEach(card => {
        const match = matches(card.dataset.path || '');
        card.classList.toggle('hidden-by-filter', !match);
      });
    }
    updateTreeDirVisibility(matches, filter.kind !== 'empty' && !invalid);
    if (typeof applyViewedState === 'function') applyViewedState();
  }

  function updateTreeDirVisibility(dirMatches?: (path: string) => boolean, filterActive = false) {
    $$('#filelist .tree-dir').forEach(dir => {
      const childUl = dir.nextElementSibling;
      if (!childUl || !childUl.classList.contains('tree-children')) return;
      const anyVisible = !!childUl.querySelector('.tree-file:not(.hidden):not(.hidden-by-tests)');
      const explicitVisible = dir.dataset.explicit === 'true' && !filterActive;
      const selfMatches = filterActive && !!dirMatches && dirMatches(dir.dataset.dirpath || '');
      dir.classList.toggle('hidden', !anyVisible && !explicitVisible && !selfMatches);
    });
  }

  // ============================================================
  // Lazy per-file rendering pipeline
  // ============================================================
  let SERVER_GENERATION = 0;
  let CLIENT_REQ_SEQ = 0;
  const LOAD_QUEUE: LoadQueueItem[] = [];
  let ACTIVE_LOADS = 0;
  const MAX_PARALLEL = 2;
  let lazyObserver: IntersectionObserver | null = null;
  let SOURCE_REQ_SEQ = 0;
  let ACTIVE_SOURCE_LOAD: {
    controller: AbortController;
    req: number;
    target: SourceFileTarget;
    card: DiffCardElement;
  } | null = null;

  // Top-edge loading indicator. Reflects any in-flight fetch (initial meta,
  // per-file diff, "show next", prefetch, ref-picker etc.).
  let IN_FLIGHT = 0;
  function updateLoadBar() {
    const el = $('#load-bar');
    if (el) el.classList.toggle('active', IN_FLIGHT > 0);
  }
  function trackLoad<T>(promise: Promise<T>): Promise<T> {
    IN_FLIGHT++;
    updateLoadBar();
    const done = () => { IN_FLIGHT = Math.max(0, IN_FLIGHT - 1); updateLoadBar(); };
    return Promise.resolve(promise).then(v => { done(); return v; },
                                          e => { done(); throw e; });
  }

  function escapeHtml(s: unknown): string {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function sourceTargetsEqual(a: SourceFileTarget | null, b: SourceFileTarget | null): boolean {
    return !!a && !!b && a.path === b.path && a.ref === b.ref;
  }

  function isAbortError(err: unknown): boolean {
    return err instanceof DOMException
      ? err.name === 'AbortError'
      : !!err && typeof err === 'object' && 'name' in err && (err as { name?: unknown }).name === 'AbortError';
  }

  function finishSourceLoad(req: number) {
    if (ACTIVE_SOURCE_LOAD?.req === req) ACTIVE_SOURCE_LOAD = null;
  }

  function cancelActiveSourceLoad(reason: 'user' | 'navigation' | 'esc'): boolean {
    const active = ACTIVE_SOURCE_LOAD;
    if (!active) return false;
    ACTIVE_SOURCE_LOAD = null;
    SOURCE_REQ_SEQ++;
    active.controller.abort();
    if (reason !== 'navigation' && sourceTargetsEqual(sourceTargetFromRoute(), active.target)) {
      renderSourceCancelled(active.card, active.target);
    }
    return true;
  }

  function fileSourceTarget(file: FileMeta): SourceFileTarget {
    if ((file.status || '').startsWith('D')) {
      return { path: file.old_path || file.path, ref: STATE.from || 'HEAD' };
    }
    const ref = (STATE.to && STATE.to !== 'worktree') ? STATE.to : 'worktree';
    return { path: file.path, ref };
  }

  function currentRange() {
    return { from: STATE.from || DEFAULT_RANGE.from, to: STATE.to || DEFAULT_RANGE.to };
  }

  function sourceTargetFromRoute(): SourceFileTarget | null {
    return STATE.route.screen === 'file' ? { path: STATE.route.path, ref: STATE.route.ref } : null;
  }

  function repoFileTargetFromRoute(): string | null {
    return STATE.route.screen === 'file' && STATE.route.view === 'blob' ? STATE.route.ref : null;
  }

  function helpLanguageFromRoute(): HelpLanguage {
    return STATE.route.screen === 'help' && HELP_LANGUAGES.includes(STATE.route.lang as HelpLanguage)
      ? STATE.route.lang as HelpLanguage
      : 'en';
  }

  function helpSectionFromRoute(): HelpSection {
    return STATE.route.screen === 'help' && HELP_SECTIONS.includes(STATE.route.section as HelpSection)
      ? STATE.route.section as HelpSection
      : 'keybindings';
  }

  function setRoute(route: AppRoute, replace = false) {
    const nextRoute = route.screen === 'unknown' ? { screen: 'diff' as const, range: route.range } : route;
    STATE.route = nextRoute;
    STATE.from = nextRoute.range.from;
    STATE.to = nextRoute.range.to;
    if (nextRoute.screen === 'repo' || (nextRoute.screen === 'file' && nextRoute.view === 'blob')) {
      STATE.repoRef = nextRoute.ref || 'worktree';
    }
    const url = buildRoute(nextRoute);
    const state = nextRoute.screen === 'file'
      ? { screen: 'file', path: nextRoute.path, ref: nextRoute.ref, view: nextRoute.view || 'detail' }
      : { view: nextRoute.screen };
    if (replace) history.replaceState(state, '', url);
    else history.pushState(state, '', url);
    syncHeaderMenu();
  }

  function setPageMode() {
    document.body.classList.toggle('gdp-file-detail-page', STATE.route.screen === 'file');
    document.body.classList.toggle('gdp-repo-blob-page', STATE.route.screen === 'file' && STATE.route.view === 'blob');
    document.body.classList.toggle('gdp-repo-page', STATE.route.screen === 'repo');
    document.body.classList.toggle('gdp-help-page', STATE.route.screen === 'help');
    syncRepoTargetInput(repoFileTargetFromRoute() || 'worktree');
  }

  function syncHeaderMenu() {
    document.querySelectorAll<HTMLAnchorElement>('.app-menu-item').forEach(link => {
      const fileRouteOwner = STATE.route.screen === 'file' && STATE.route.view === 'blob' ? 'repo' : 'diff';
      const active = link.dataset.route === STATE.route.screen || (STATE.route.screen === 'file' && link.dataset.route === fileRouteOwner);
      link.classList.toggle('active', active);
      link.setAttribute('aria-current', active ? 'page' : 'false');
      if (link.dataset.route === 'repo') {
        link.href = buildRoute({ screen: 'repo', ref: STATE.repoRef || 'worktree', path: '', range: currentRange() });
      }
      if (link.dataset.route === 'diff') {
        link.href = buildRoute({ screen: 'diff', range: currentRange() });
      }
      if (link.dataset.route === 'help') {
        link.href = buildRoute({ screen: 'help', lang: helpLanguageFromRoute(), section: helpSectionFromRoute(), range: currentRange() });
      }
    });
  }

  function removeStandaloneSource() {
    document.querySelectorAll('.gdp-standalone-source').forEach(el => el.remove());
    document.querySelectorAll('.gdp-repo-blob-layout').forEach(el => el.remove());
  }

  function renderHelpPage() {
    cancelActiveSourceLoad('navigation');
    removeStandaloneSource();
    LOAD_QUEUE.length = 0;
    const target = $('#diff');
    const empty = $('#empty');
    empty.classList.add('hidden');
    $('#meta').textContent = '';
    $('#totals').textContent = '';
    $('#filelist').textContent = '';

    const lang = helpLanguageFromRoute();
    const section = helpSectionFromRoute();
    const content = HELP_CONTENT[lang];
    const sectionContent = content.sections[section];

    const shell = document.createElement('section');
    shell.className = 'gdp-help-shell';
    const header = document.createElement('header');
    header.className = 'gdp-help-header';
    const title = document.createElement('h1');
    title.textContent = content.title;
    const langSelect = document.createElement('select');
    langSelect.className = 'gdp-help-language';
    langSelect.setAttribute('aria-label', content.languageLabel);
    HELP_LANGUAGES.forEach(optionLang => {
      const option = document.createElement('option');
      option.value = optionLang;
      option.textContent = optionLang.toUpperCase();
      option.selected = optionLang === lang;
      langSelect.appendChild(option);
    });
    langSelect.addEventListener('change', () => {
      setRoute({ screen: 'help', lang: langSelect.value, section, range: currentRange() });
      setPageMode();
      renderHelpPage();
      syncHeaderMenu();
    });
    header.append(title, langSelect);

    const layout = document.createElement('div');
    layout.className = 'gdp-help-layout';
    const helpNav = document.createElement('nav');
    helpNav.className = 'gdp-help-nav';
    HELP_SECTIONS.forEach(helpSection => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = helpSection === section ? 'active' : '';
      button.textContent = content.sections[helpSection].nav;
      button.addEventListener('click', () => {
        setRoute({ screen: 'help', lang, section: helpSection, range: currentRange() });
        renderHelpPage();
        syncHeaderMenu();
      });
      helpNav.appendChild(button);
    });

    const article = document.createElement('article');
    article.className = 'gdp-help-content';
    const h2 = document.createElement('h2');
    h2.textContent = sectionContent.title;
    const intro = document.createElement('p');
    intro.textContent = sectionContent.intro;
    article.append(h2, intro);
    sectionContent.groups.forEach(group => {
      const groupSection = document.createElement('section');
      groupSection.className = 'gdp-help-group';
      const groupTitle = document.createElement('h3');
      groupTitle.textContent = group.title;
      const table = document.createElement('table');
      group.rows.forEach(([keys, description]) => {
        const tr = document.createElement('tr');
        const keyCell = document.createElement('th');
        keyCell.scope = 'row';
        keys.split(' / ').forEach((key, index) => {
          if (index > 0) keyCell.append(' / ');
          const kbd = document.createElement('kbd');
          kbd.textContent = key;
          keyCell.appendChild(kbd);
        });
        const desc = document.createElement('td');
        desc.textContent = description;
        tr.append(keyCell, desc);
        table.appendChild(tr);
      });
      groupSection.append(groupTitle, table);
      article.appendChild(groupSection);
    });

    layout.append(helpNav, article);
    shell.append(header, layout);
    target.replaceChildren(shell);
  }

  function renderShell(meta: DiffMeta) {
    const newFiles = meta.files || [];
    STATE.files = newFiles;
    SERVER_GENERATION = meta.generation || 0;
    window._lastMeta = meta;
    renderMeta(meta);
    renderSidebar(newFiles);

    const target = $('#diff');
    const empty = $('#empty');
    if (!newFiles.length) {
      if (STATE.route.screen === 'file') {
        empty.classList.add('hidden');
        applySourceRouteToShell();
      } else {
        empty.classList.remove('hidden');
        target.replaceChildren();
      }
      LOAD_QUEUE.length = 0;
      return;
    }
    empty.classList.add('hidden');

    // Reuse existing cards by stable key when possible. This keeps scroll
    // position stable, avoids re-fetching unchanged files, and preserves any
    // expanded hunk state. Cards whose meta changed (size_class, status) are
    // reset to placeholder so they reload.
    const oldByKey = new Map();
    document.querySelectorAll<DiffCardElement>('.gdp-file-shell').forEach(c => {
      if (c.dataset.key) oldByKey.set(c.dataset.key, c);
    });

    const ordered = [];
    newFiles.forEach(f => {
      const key = f.key || f.path;
      const old = oldByKey.get(key);
      if (old) {
        oldByKey.delete(key);
        const sizeChanged   = old.dataset.sizeClass !== (f.size_class || 'small');
        const statusChanged = old.dataset.status    !== (f.status || 'M');
        if (sizeChanged || statusChanged) {
          // Meta drifted — drop content and re-queue
          old.classList.remove('loaded', 'error');
          old.classList.add('pending');
          old.replaceChildren();
          const tmp = createPlaceholder(f);
          while (tmp.firstChild) old.appendChild(tmp.firstChild);
          old.dataset.sizeClass = f.size_class || 'small';
          old.dataset.status    = f.status || 'M';
          // Manual-load is the user's "show this heavy file" intent. Keep it
          // across live refreshes, but reset it when the file's basic meta
          // changes enough that the old intent may no longer match.
          delete old.dataset.manualRendered;
          delete old.dataset.manualLoad;
          delete old.dataset.manualMode;
          old.style.minHeight = (f.estimated_height_px || 80) + 'px';
          old._diffData = null;
          old._file = null;
        } else {
          // Refresh the lightweight header counts in place
          const stats = old.querySelector('.gdp-shell-header .stats');
          if (stats) {
            stats.innerHTML = '<span class="a">+' + (f.additions||0) + '</span>' +
              '<span class="d">−' + (f.deletions||0) + '</span>';
          }
          old._file = f;
        }
        ordered.push(old);
      } else {
        ordered.push(createPlaceholder(f));
      }
    });

    // Cards no longer present
    oldByKey.forEach(c => c.remove());

    target.replaceChildren(...ordered);

    // Drop pending queue entries whose card is gone
    for (let i = LOAD_QUEUE.length - 1; i >= 0; i--) {
      if (!LOAD_QUEUE[i].card.isConnected) LOAD_QUEUE.splice(i, 1);
    }

    setupLazyObserver();
    enqueueInitialLoads();
    applySourceRouteToShell();
    setupScrollSpy();
    if (typeof applyHideTests === 'function') applyHideTests();
    applyFilter();
    applyViewedState();
  }

  function fileEntryIcon(): string {
    return iconSvg('octicon-file', FILE_16_PATH);
  }

  async function openPathInOs(path: string, kind: 'directory' | 'file-parent', button?: HTMLButtonElement) {
    const oldTitle = button?.title;
    if (button) {
      button.disabled = true;
      button.classList.remove('failed');
    }
    try {
      const res = await fetch('/_open_path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Code-Viewer-Action': '1' },
        body: JSON.stringify({ path, kind }),
      });
      if (!res.ok) throw new Error(await res.text());
      button?.classList.add('opened');
      setTimeout(() => { button?.classList.remove('opened'); }, 1200);
    } catch {
      if (button) {
        button.classList.add('failed');
        button.title = 'failed to open in OS';
        setTimeout(() => {
          button.classList.remove('failed');
          button.title = oldTitle || 'open in OS';
        }, 1600);
      }
    } finally {
      if (button) button.disabled = false;
    }
  }

  function createOpenPathButton(path: string, kind: 'directory' | 'file-parent', title = 'open folder in OS'): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gdp-file-header-icon gdp-open-path';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = iconSvg('octicon-link-external', OPEN_EXTERNAL_16_PATH);
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      openPathInOs(path, kind, button);
    });
    return button;
  }

  async function uploadFiles(path: string, files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    const label = path || PROJECT_NAME || 'repository root';
    if (!window.confirm('Upload ' + list.length + ' file' + (list.length === 1 ? '' : 's') + ' into ' + label + '?')) return;

    const form = new FormData();
    form.set('dir', path);
    list.forEach(file => form.append('files', file, file.name));
    const res = await fetch('/_upload_files', {
      method: 'POST',
      headers: { 'X-Code-Viewer-Action': '1' },
      body: form,
    });
    if (!res.ok) throw new Error(await res.text());
    invalidateRepoSidebar();
    await loadRepo();
  }

  function createRepoUploadPanel(path: string): HTMLElement {
    const dropPanel = document.createElement('div');
    dropPanel.className = 'gdp-upload-panel';

    const copy = document.createElement('div');
    copy.className = 'gdp-upload-copy';
    copy.textContent = 'Drop files into ' + (path || PROJECT_NAME || 'repository');

    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.hidden = true;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gdp-btn gdp-btn-sm';
    button.textContent = 'Upload files';
    button.addEventListener('click', () => input.click());

    const fail = () => {
      dropPanel.classList.add('failed');
      setTimeout(() => dropPanel.classList.remove('failed'), 1600);
    };

    input.addEventListener('change', async () => {
      try {
        if (input.files && input.files.length) await uploadFiles(path, input.files);
      } catch {
        fail();
      } finally {
        input.value = '';
      }
    });

    dropPanel.addEventListener('dragover', event => {
      event.preventDefault();
      dropPanel.classList.add('dragging');
    });
    dropPanel.addEventListener('dragleave', () => dropPanel.classList.remove('dragging'));
    dropPanel.addEventListener('drop', async event => {
      event.preventDefault();
      dropPanel.classList.remove('dragging');
      try {
        const files = event.dataTransfer?.files;
        if (files && files.length) await uploadFiles(path, files);
      } catch {
        fail();
      }
    });

    dropPanel.append(copy, button, input);
    return dropPanel;
  }

  function repoRoute(ref: string, path: string): AppRoute {
    return { screen: 'repo', ref: ref || 'worktree', path, range: currentRange() };
  }

  function wireRepoTargetPicker(input: HTMLInputElement, onPick: (ref: string) => void) {
    input.addEventListener('focus', () => openPopover(input));
    input.addEventListener('click', (e) => {
      e.stopPropagation();
      openPopover(input);
    });
    input.addEventListener('mousedown', (e) => {
      if (popover.hidden) {
        e.preventDefault();
        input.focus();
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        closePopover();
      } else if (e.key === 'Escape') {
        closePopover();
        input.blur();
      }
    });
    input.addEventListener('change', () => onPick(input.value || 'worktree'));
  }

  function createRepoBreadcrumb(target: string, path: string): HTMLElement {
    const nav = document.createElement('nav');
    nav.className = 'gdp-file-breadcrumb gdp-repo-breadcrumb';
    const root = document.createElement('button');
    root.type = 'button';
    root.className = path ? 'gdp-file-breadcrumb-part' : 'gdp-file-breadcrumb-current';
    root.textContent = PROJECT_NAME || 'repository';
    root.addEventListener('click', () => {
      setRoute(repoRoute(target, ''));
      loadRepo();
    });
    nav.appendChild(root);
    const parts = path ? path.split('/') : [];
    parts.forEach((part, index) => {
      const sep = document.createElement('span');
      sep.className = 'gdp-file-breadcrumb-sep';
      sep.textContent = '/';
      nav.appendChild(sep);
      const currentPath = parts.slice(0, index + 1).join('/');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = index === parts.length - 1 ? 'gdp-file-breadcrumb-current' : 'gdp-file-breadcrumb-part';
      button.textContent = part;
      button.disabled = index === parts.length - 1;
      button.addEventListener('click', () => {
        setRoute(repoRoute(target, currentPath));
        loadRepo();
      });
      nav.appendChild(button);
    });
    return nav;
  }

  async function renderRepo(meta: RepoTreeResponse) {
    PROJECT_NAME = meta.project || PROJECT_NAME;
    setPageMode();
    removeStandaloneSource();
    $('#empty').classList.add('hidden');
    $('#diff').replaceChildren();
    if (!isRepoSidebarReusable(meta.ref)) $('#totals').textContent = '';
    STATE.files = [];
    LOAD_QUEUE.length = 0;
    renderRepoBlobSidebar(meta.path || '', meta.ref);

    const target = $('#diff');
    const shell = document.createElement('section');
    shell.className = 'gdp-repo-shell';

    const targetPicker = document.createElement('input');
    targetPicker.className = 'ref-input gdp-repo-target';
    targetPicker.id = 'repo-ref';
    targetPicker.readOnly = true;
    targetPicker.autocomplete = 'off';
    targetPicker.value = meta.ref || 'worktree';
    targetPicker.placeholder = 'ref...';
    targetPicker.title = 'repository ref';
    wireRepoTargetPicker(targetPicker, (ref) => {
      setRoute(repoRoute(ref, ''));
      loadRepo();
    });
    const toolbar = document.createElement('div');
    toolbar.className = 'gdp-file-detail-header gdp-repo-toolbar';
    toolbar.append(createRepoBreadcrumb(meta.ref, meta.path || ''), createOpenPathButton(meta.path || '', 'directory', 'open this folder in OS'), targetPicker);
    shell.appendChild(toolbar);

    const listCard = document.createElement('section');
    listCard.className = 'gdp-file-shell loaded gdp-repo-list-shell';
    const listWrapper = document.createElement('div');
    listWrapper.className = 'd2h-file-wrapper';
    const listHeader = document.createElement('div');
    listHeader.className = 'd2h-file-header';
    const listName = document.createElement('div');
    listName.className = 'd2h-file-name-wrapper';
    const listIcon = document.createElement('span');
    listIcon.className = 'dir-icon';
    setFolderIcon(listIcon, false);
    const listTitle = document.createElement('span');
    listTitle.className = 'd2h-file-name';
    listTitle.textContent = meta.path || meta.project || 'Files';
    listName.append(listIcon, listTitle);
    listHeader.appendChild(listName);
    listHeader.appendChild(createOpenPathButton(meta.path || '', 'directory', 'open this folder in OS'));
    listWrapper.appendChild(listHeader);
    if (meta.upload_enabled && (meta.ref === 'worktree' || meta.ref === '')) {
      listWrapper.appendChild(createRepoUploadPanel(meta.path || ''));
    }
    const list = document.createElement('div');
    list.className = 'gdp-source-viewer gdp-repo-file-list';
    if (meta.path) {
      const parent = meta.path.split('/').slice(0, -1).join('/');
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'gdp-repo-row parent';
      const parentIcon = document.createElement('span');
      parentIcon.className = 'dir-icon';
      setFolderIcon(parentIcon, false);
      const parentName = document.createElement('span');
      parentName.className = 'name';
      parentName.textContent = '..';
      const parentKind = document.createElement('span');
      parentKind.className = 'kind';
      parentKind.textContent = 'parent';
      row.append(parentIcon, parentName, parentKind);
      row.addEventListener('click', () => {
        setRoute(repoRoute(meta.ref, parent));
        loadRepo();
      });
      list.appendChild(row);
    }
    meta.entries.forEach(entry => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'gdp-repo-row ' + entry.type;
      const icon = document.createElement('span');
      icon.className = entry.type === 'tree' ? 'dir-icon' : 'd2h-icon-wrapper';
      if (entry.type === 'tree') setFolderIcon(icon, true);
      else icon.innerHTML = fileEntryIcon();
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = entry.name;
      const kind = document.createElement('span');
      kind.className = 'kind';
      kind.textContent = entry.type === 'tree' ? 'directory' : entry.type === 'commit' ? 'submodule' : 'file';
      row.append(icon, name, kind);
      row.addEventListener('click', () => {
        if (entry.type === 'tree') {
          setRoute(repoRoute(meta.ref, entry.path));
          loadRepo();
        } else if (entry.type === 'blob') {
          setRoute({ screen: 'file', path: entry.path, ref: meta.ref, view: 'blob', range: currentRange() });
          renderStandaloneSource({ path: entry.path, ref: meta.ref });
        }
      });
      list.appendChild(row);
    });
    if (!meta.entries.length) {
      const empty = document.createElement('div');
      empty.className = 'gdp-repo-empty';
      empty.textContent = 'No files in this directory.';
      list.appendChild(empty);
    }
    listWrapper.appendChild(list);
    listCard.appendChild(listWrapper);
    shell.appendChild(listCard);

    if (meta.readme && meta.readme.text) {
      const readme = document.createElement('section');
      readme.className = 'gdp-file-shell loaded gdp-repo-readme';
      const wrapper = document.createElement('div');
      wrapper.className = 'd2h-file-wrapper';
      const readmeHeader = document.createElement('div');
      readmeHeader.className = 'd2h-file-header';
      const nameWrapper = document.createElement('div');
      nameWrapper.className = 'd2h-file-name-wrapper';
      const icon = document.createElement('span');
      icon.className = 'd2h-icon-wrapper';
      icon.innerHTML = iconSvg('octicon-file', FILE_16_PATH);
      const name = document.createElement('span');
      name.className = 'd2h-file-name';
      name.textContent = meta.readme.path;
      nameWrapper.append(icon, name);
      readmeHeader.appendChild(nameWrapper);
      wrapper.appendChild(readmeHeader);
      try {
        wrapper.appendChild(await renderMarkdownPreview(meta.readme.text, { path: meta.readme.path, ref: meta.ref }, {
          syntaxHighlight: STATE.syntaxHighlight,
          onNavigateMarkdown: (path, ref) => {
            setRoute({ screen: 'file', path, ref, view: 'blob', range: currentRange() });
            renderStandaloneSource({ path, ref });
          },
        }));
      } catch {
        const fallback = document.createElement('pre');
        fallback.className = 'gdp-markdown-fallback';
        fallback.textContent = meta.readme.text;
        wrapper.appendChild(fallback);
      }
      readme.appendChild(wrapper);
      shell.appendChild(readme);
    }

    target.appendChild(shell);
  }

  function renderRepoBlobSidebar(currentPath: string, ref: string) {
    syncRepoTargetInput(ref);
    const normalizedRef = ref || 'worktree';
    if (isRepoSidebarReusable(normalizedRef)) {
      activateRepoSidebarPath(currentPath);
      return Promise.resolve();
    }
    if (REPO_SIDEBAR_LOAD && REPO_SIDEBAR_LOAD_REF === normalizedRef) {
      return REPO_SIDEBAR_LOAD.then(() => {
        activateRepoSidebarPath(currentPath);
      });
    }
    const params = new URLSearchParams();
    params.set('ref', normalizedRef);
    params.set('recursive', '1');
    REPO_SIDEBAR_LOAD_REF = normalizedRef;
    const load = trackLoad<RepoTreeResponse>(fetch('/_tree?' + params.toString()).then(r => {
      if (!r.ok) throw new Error('failed to load repository tree');
      return r.json();
    })).then(meta => {
      const activeRepoRef = repoFileTargetFromRoute() || (STATE.route.screen === 'repo' ? STATE.route.ref : '');
      if ((activeRepoRef || 'worktree') !== normalizedRef) return;
      const files = meta.entries.map((entry, index) => ({
        order: index + 1,
        path: entry.path,
        display_path: entry.path,
        type: entry.type,
        children_omitted: entry.children_omitted,
      } satisfies SidebarItem));
      renderSidebar(files, file => {
        if (file.type === 'tree') {
          setRoute(repoRoute(normalizedRef, file.path));
          loadRepo();
          return;
        }
        setRoute({ screen: 'file', path: file.path, ref: normalizedRef, view: 'blob', range: currentRange() });
        renderStandaloneSource({ path: file.path, ref: normalizedRef });
      });
      REPO_SIDEBAR_REF = normalizedRef;
      activateRepoSidebarPath(currentPath);
    }).catch(() => {
      REPO_SIDEBAR_REF = null;
      renderSidebar([], undefined);
      $('#totals').textContent = 'Cannot load tree';
    }).finally(() => {
      if (REPO_SIDEBAR_LOAD === load) {
        REPO_SIDEBAR_LOAD_REF = null;
        REPO_SIDEBAR_LOAD = null;
      }
    });
    REPO_SIDEBAR_LOAD = load;
    return load;
  }

  function activateRepoSidebarPath(currentPath: string) {
    markActive(currentPath);
    applyFilter();
  }

  function createPlaceholder(f: FileMeta): DiffCardElement {
    const card = document.createElement('div');
    card.className = 'gdp-file-shell pending';
    card.dataset.path = f.path;
    card.dataset.key = f.key || f.path;
    card.dataset.sizeClass = f.size_class || 'small';
    card.dataset.status = f.status || 'M';
    card.classList.toggle('viewed', STATE.viewedFiles.has(f.path));
    if (f.estimated_height_px) {
      card.style.minHeight = f.estimated_height_px + 'px';
    }

    const head = document.createElement('div');
    head.className = 'gdp-shell-header';
    head.innerHTML =
      '<span class="status-pill ' + escapeHtml(f.status || 'M') + '">' +
        escapeHtml(f.status || 'M') + '</span>' +
      '<span class="path">' + escapeHtml(f.display_path || f.path) + '</span>' +
      '<span class="stats">' +
        '<span class="a">+' + (f.additions||0) + '</span>' +
        '<span class="d">−' + (f.deletions||0) + '</span>' +
      '</span>' +
      '<span class="size-tag ' + escapeHtml(f.size_class||'') + '">' +
        escapeHtml(f.size_class || '') + '</span>' +
      '<span class="loading-indicator" hidden>loading…</span>';
    card.appendChild(head);

    const body = document.createElement('div');
    body.className = 'gdp-shell-body';
    card.appendChild(body);

    return card;
  }

  function setupLazyObserver() {
    if (lazyObserver) lazyObserver.disconnect();
    lazyObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const card = entry.target as DiffCardElement;
        if (card.classList.contains('loaded') || card.classList.contains('loading')) return;
        const f = STATE.files.find(x => x.path === card.dataset.path);
        if (!f) return;
        enqueueLoad(f, card, 0);
      });
    }, { rootMargin: '1200px 0px 1600px 0px' });
    document.querySelectorAll<DiffCardElement>('.gdp-file-shell.pending').forEach(c => lazyObserver.observe(c));
  }

  window.addEventListener('scroll', () => enqueueInitialLoads(), { passive: true });
  window.addEventListener('resize', () => enqueueInitialLoads(), { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) enqueueInitialLoads();
  });

  function enqueueInitialLoads() {
    const viewportBottom = window.innerHeight + 1600;
    document.querySelectorAll<DiffCardElement>('.gdp-file-shell.pending').forEach(card => {
      const rect = card.getBoundingClientRect();
      if (rect.top > viewportBottom) return;
      const f = STATE.files.find(x => x.path === card.dataset.path);
      if (f) enqueueLoad(f, card, 0);
    });
  }

  function enqueueLoad(file: FileMeta, card: DiffCardElement, priority?: number) {
    if (manualLoadReason(file) && card.dataset.manualLoad !== '1') {
      renderManualLoadPlaceholder(card, file);
      return;
    }
    if (LOAD_QUEUE.find(item => item.card === card)) return;
    LOAD_QUEUE.push({ file, card, priority: priority || 0 });
    LOAD_QUEUE.sort((a, b) => b.priority - a.priority);
    pumpQueue();
  }

  function pumpQueue() {
    while (ACTIVE_LOADS < MAX_PARALLEL && LOAD_QUEUE.length) {
      const item = LOAD_QUEUE.shift();
      if (item.card.classList.contains('loaded') || item.card.classList.contains('loading')) continue;
      ACTIVE_LOADS++;
      loadFile(item.file, item.card).finally(() => {
        ACTIVE_LOADS--;
        pumpQueue();
      });
    }
  }

  function manualLoadReason(file: FileMeta): string | null {
    const path = file.path || '';
    if (file.size_class === 'huge') return 'huge diff';
    if (/\.(min|bundle)\.(js|mjs|css)$/i.test(path)) return 'minified or bundled file';
    if (/\.map$/i.test(path)) return 'source map';
    if (/(^|\/)(vendor|node_modules|dist|build|out)\//i.test(path)) return 'generated or vendored path';
    return null;
  }

  function renderManualLoadPlaceholder(card: DiffCardElement, file: FileMeta) {
    if (card.dataset.manualRendered === '1') return;
    card.dataset.manualRendered = '1';
    card.classList.remove('loading');
    card.classList.add('pending', 'manual-load');
    if (lazyObserver) lazyObserver.unobserve(card);
    const indicator = card.querySelector<HTMLElement>('.loading-indicator');
    if (indicator) indicator.hidden = true;
    const body = card.querySelector<HTMLElement>('.gdp-shell-body')!;
    body.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'gdp-manual-load';

    const note = document.createElement('div');
    note.className = 'gdp-manual-note';
    note.textContent = manualLoadReason(file) + ' - click to load diff';

    const previewBtn = document.createElement('button');
    previewBtn.className = 'gdp-show-full';
    previewBtn.textContent = 'Load preview';
    previewBtn.addEventListener('click', () => {
      body.innerHTML = '';
      card.dataset.manualLoad = '1';
      card.dataset.manualMode = 'preview';
      card.classList.remove('manual-load');
      loadFile(file, card, buildPreviewUrl(file, 3));
    });

    const openFileBtn = document.createElement('button');
    openFileBtn.className = 'gdp-show-full';
    openFileBtn.textContent = 'Open as file';
    openFileBtn.title = 'Open this file in the virtualized source viewer';
    openFileBtn.addEventListener('click', () => {
      const target = fileSourceTarget(file);
      setRoute({ screen: 'file', path: target.path, ref: target.ref, range: currentRange() });
      applySourceRouteToShell();
    });

    const fullBtn = document.createElement('button');
    fullBtn.className = 'gdp-show-full secondary';
    fullBtn.textContent = 'Load full diff';
    fullBtn.title = 'Render the full diff with Diff2Html. This can be slow for large files.';
    fullBtn.addEventListener('click', () => {
      body.innerHTML = '';
      card.dataset.manualLoad = '1';
      card.dataset.manualMode = 'full';
      card.classList.remove('manual-load');
      loadFile(file, card, file.load_url);
    });

    wrap.appendChild(note);
    if (file.status === 'A') wrap.appendChild(openFileBtn);
    wrap.appendChild(previewBtn);
    wrap.appendChild(fullBtn);
    body.appendChild(wrap);
  }

  function nextIdle(timeout = 500): Promise<void> {
    return new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const ric = window.requestIdleCallback;
      if (typeof ric === 'function') {
        ric(finish, { timeout });
      } else {
        requestAnimationFrame(finish);
        setTimeout(finish, 50);
      }
    });
  }

  function loadFile(file: FileMeta, card: DiffCardElement, urlOverride?: string): Promise<void> {
    card.classList.remove('pending');
    card.classList.add('loading');
    if (lazyObserver) lazyObserver.unobserve(card);
    const indicator = card.querySelector<HTMLElement>('.loading-indicator');
    if (indicator) indicator.hidden = false;

    const url = urlOverride || (card.dataset.manualMode === 'full' ? file.load_url : (file.preview_url || file.load_url));
    const myGen = SERVER_GENERATION;
    const myReq = ++CLIENT_REQ_SEQ;
    card.dataset.reqId = String(myReq);

    const retryStale = () => {
      if (String(myReq) !== card.dataset.reqId) return;
      card.classList.remove('loading');
      card.classList.add('pending');
      if (indicator) indicator.hidden = true;
      const fresh = STATE.files.find(x => x.path === card.dataset.path);
      if (fresh && card.isConnected) enqueueLoad(fresh, card, 0);
    };

    return trackLoad<FileDiffResponse>(fetch(url).then(r => r.json())).then(async data => {
      if (String(myReq) !== card.dataset.reqId) return;       // superseded by newer request
      if (myGen !== SERVER_GENERATION) { retryStale(); return; } // generation rolled, retry
      if (data.generation && data.generation !== SERVER_GENERATION) { retryStale(); return; }
      await nextIdle();
      if (String(myReq) !== card.dataset.reqId) return;
      renderFile(file, data, card);
    }).catch(() => {
      if (String(myReq) !== card.dataset.reqId) return;
      card.classList.remove('loading');
      card.classList.add('error');
      const body = card.querySelector<HTMLElement>('.gdp-shell-body')!;
      body.innerHTML = '<div class="gdp-error">failed to load — <button class="retry">retry</button></div>';
      const btn = body.querySelector('.retry');
      if (btn) btn.addEventListener('click', () => {
        card.classList.remove('error');
        card.classList.add('pending');
        body.innerHTML = '';
        enqueueLoad(file, card, 1);
      });
    });
  }

  function mountDiff(card: DiffCardElement, file: FileMeta, data: FileDiffResponse) {
    const head = card.querySelector<HTMLElement>('.gdp-shell-header');
    if (head) head.style.display = 'none';
    const body = card.querySelector<HTMLElement>('.gdp-shell-body')!;
    body.innerHTML = '';

    if (!data.diff || !data.diff.trim()) {
      body.innerHTML = '<div class="gdp-info">No content</div>';
      return;
    }

    const layout = file.force_layout || STATE.layout;
    const hljsRef = getHljs();
    const ui = new Diff2HtmlUI(body, data.diff, {
      drawFileList: false,
      matching: 'lines',
      outputFormat: layout,
      synchronisedScroll: true,
      highlight: !!(STATE.syntaxHighlight && file.highlight && hljsRef),
      fileListToggle: false,
      fileContentToggle: false,
    }, hljsRef);
    ui.draw();
    if (STATE.ignoreWs) suppressWhitespaceOnlyInlineHighlights(body);
    if (STATE.syntaxHighlight && file.highlight && hljsRef && typeof ui.highlightCode === 'function') ui.highlightCode();

    enhanceMediaCard(file, card);
    syncSideScrollCard(card);
    appendStatSquaresToHeader(card, file);
    setupHunkExpand(card, file);
  }

  // ---------- Hunk expand (mimics GitHub's ↕ at hunk separators) ----------
  // Parse "@@ -OLD,COUNT +NEW,COUNT @@" out of a row's text.
  // The text may be wrapped in leading/trailing whitespace from diff2html,
  // and there's also no requirement that @@ start at column 0.
  function parseHunkHeader(text: string | null): HunkInfo | null {
    const m = (text || '').match(/@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (!m) return null;
    return {
      oldStart: +m[1], oldCount: m[2] ? +m[2] : 1,
      newStart: +m[3], newCount: m[4] ? +m[4] : 1,
    };
  }

  // After the row's content lines, what's the next-new-line number?
  function nextNewLine(hunk: HunkInfo): number { return hunk.newStart + hunk.newCount; }
  function nextOldLine(hunk: HunkInfo): number { return hunk.oldStart + hunk.oldCount; }

  function setupHunkExpand(card: DiffCardElement, file: FileMeta) {
    if (file.binary) return;
    if (file.media_kind) return;
    // Collect hunk-info rows. In line-by-line there's one table per file,
    // each .d2h-info row carries the @@ text. In side-by-side there are TWO
    // sibling tables (left = old, right = new); each row is duplicated. We
    // group them by their position so a single click expands BOTH sides.
    const infoRows: HunkRow[] = [];
    const tables = card.querySelectorAll('table.d2h-diff-table');
    if (tables.length === 0) return;

    // Per-table: collect every info row in DOM order. In split view both
    // tables emit a row at the same DOM index for each hunk; only one side
    // tends to carry the parseable @@ text but both rows must be hidden /
    // updated together. Hold the raw row + info td and try parsing later.
    const perTable: HunkSibling[][] = [];
    tables.forEach(tbl => {
      const arr: HunkSibling[] = [];
      tbl.querySelectorAll('tr').forEach(tr => {
        const info = tr.querySelector('td.d2h-info:not(.d2h-code-linenumber):not(.d2h-code-side-linenumber)');
        if (!info) return;
        const txt = (info.textContent || '').trim();
        arr.push({ tr: tr as HTMLTableRowElement, info, hunk: parseHunkHeader(txt) });
      });
      perTable.push(arr);
    });

    // Pair hunk rows across left/right tables by their visible top position
    // rather than array index. Index pairing breaks when one side has an
    // extra placeholder row or when parse counts differ.
    const base = perTable.find(arr => arr.some(x => x.hunk)) || perTable[0] || [];
    // Track rows already paired so we don't re-pair the same physical row
    // twice when row-height drift makes another base "see" the same
    // candidate as its closest neighbour.
    const usedTrs = new WeakSet();
    base.forEach(baseItem => {
      const top = baseItem.tr.getBoundingClientRect().top;
      const group = perTable.map((arr, tableIndex) => {
        let best: HunkSibling | null = null, bestD = Infinity;
        for (const item of arr) {
          if (usedTrs.has(item.tr)) continue;
          const d = Math.abs(item.tr.getBoundingClientRect().top - top);
          if (d < bestD) { best = item; bestD = d; }
        }
        if (!best || bestD >= 12) return null;
        usedTrs.add(best.tr);
        // Carry the original table index so insertContextRows can pick the
        // right side's line-num (left=old, right=new). Filter+filter() would
        // otherwise renumber and corrupt that mapping.
        return Object.assign({ sideIndex: tableIndex }, best);
      }).filter(Boolean);
      if (!group.length) return;
      const parsed = group.find(g => g.hunk) || group[0];
      if (!parsed.hunk) return;
      group.forEach(g => g.tr.classList.add('gdp-hunk-row'));
      infoRows.push({
        tr: parsed.tr, info: parsed.info, hunk: parsed.hunk,
        siblings: group,
        prevHunkEndNew: 0, prevHunkEndOld: 0,
      });
    });
    // Compute prev hunk's end so we know how big the gap above is
    for (let i = 1; i < infoRows.length; i++) {
      const prev = infoRows[i - 1].hunk;
      infoRows[i].prevHunkEndNew = nextNewLine(prev);
      infoRows[i].prevHunkEndOld = nextOldLine(prev);
    }

    const ref = (STATE.to && STATE.to !== 'worktree') ? STATE.to : 'worktree';
    const refPath = encodeURIComponent(file.path);

    for (const item of infoRows) {
      attachExpandControls(item, file, ref, refPath);
    }
  }

  // Build the GitHub-style ↑ / ↓ stack inside the line-number column of a
  // hunk header row. For split view, the controls are mirrored on each
  // side panel's hunk row, but a single click triggers an insert on both.
  function attachExpandControls(item: HunkRow, file: FileMeta, ref: string, refPath: string) {
    const { hunk, prevHunkEndNew, prevHunkEndOld } = item;
    const fullGapStart = Math.max(1, prevHunkEndNew);
    const fullGapEnd   = hunk.newStart - 1;
    if (fullGapStart > fullGapEnd) {
      // Hide @@ when there are no preceding lines to expand (file starts
      // at line 1 / brand new file).
      for (const sib of (item.siblings || [{ tr: item.tr }])) {
        sib.tr.style.display = 'none';
      }
      return;
    }
    // Per-gap state: how far each side has been expanded so far.
    // top side fills the high end (just before this hunk), bottom side
    // fills the low end (just after the previous hunk).
    // top:    inclusive lowest line filled from the top (initially first
    //         line of THIS hunk; ↑ clicks shrink it).
    // bottom: inclusive highest line filled from the bottom (initially the
    //         last line of the PREVIOUS hunk = prevHunkEndNew - 1; ↓ clicks
    //         grow it). Off-by-one here used to leak line `prevHunkEndNew`
    //         out of the gap and into the "fully expanded" path, hiding the
    //         @@ row before the first gap line was ever fetched.
    const L = window.GdpExpandLogic;
    if (item.topExpandedStart == null || item.bottomExpandedEnd == null) {
      const init = L.initExpandState(prevHunkEndNew, hunk.newStart);
      item.topExpandedStart = init.topExpandedStart;
      item.bottomExpandedEnd = init.bottomExpandedEnd;
    }
    const gap = L.remainingGap({
      topExpandedStart: item.topExpandedStart,
      bottomExpandedEnd: item.bottomExpandedEnd,
    }, prevHunkEndNew);
    if (!gap) {
      for (const sib of (item.siblings || [{ tr: item.tr }])) {
        sib.tr.style.display = 'none';
      }
      return;
    }
    const remainingStart = gap.start;
    const remainingEnd = gap.end;

    const setBusy = (busy: boolean) => {
      for (const sib of (item.siblings || [{ tr: item.tr }])) {
        sib.tr.querySelectorAll<HTMLButtonElement>('.gdp-expand-btn').forEach(b => { b.disabled = busy; });
      }
    };

    const fetchAndInsert = (start: number, end: number, dir: 'before' | 'after') => {
      if (start < 1) start = 1;
      if (end < start) return;
      setBusy(true);
      const url = '/file_range?path=' + refPath +
                  '&ref=' + encodeURIComponent(ref) +
                  '&start=' + start + '&end=' + end;
      trackLoad<{ lines?: string[] }>(fetch(url).then(r => r.json())).then(data => {
        if (!data || !data.lines) { setBusy(false); return; }
        const oldStartForGap = prevHunkEndOld + (start - prevHunkEndNew);
        const card = item.tr.closest('.d2h-file-wrapper');
        const sibs = item.siblings || [{ tr: item.tr, sideIndex: 0 }];
        sibs.forEach(sib => {
          insertContextRows(sib.tr, data.lines, start, oldStartForGap, dir, sib.sideIndex || 0);
        });
        if (card) highlightInsertedSpans(card, file);
        // dir='after'  → filled HIGH end (rows go below @@) → topExpandedStart shrinks
        // dir='before' → filled LOW end (rows go above @@) → bottomExpandedEnd grows
        if (dir === 'after') item.topExpandedStart = start;
        else item.bottomExpandedEnd = end;
        // Replace expand stacks with refreshed ones (or hide).
        for (const sib of (item.siblings || [{ tr: item.tr }])) {
          const ln = sib.tr.querySelector('.d2h-code-linenumber.d2h-info, .d2h-code-side-linenumber.d2h-info');
          const old = ln && ln.querySelector('.gdp-expand-stack');
          if (old) old.remove();
        }
        attachExpandControls(item, file, ref, refPath);
      }).catch(() => { setBusy(false); });
    };

    const STEP = 20;
    const remainingSize = remainingEnd - remainingStart + 1;
    const isFirst = (prevHunkEndNew === 0);
    const buildStack = () => {
      // GitHub semantics: ↑ button shows more lines ABOVE @@ in the file
      // (closer to the previous hunk = lower line numbers). ↓ shows more
      // lines BELOW @@ (closer to this hunk = higher line numbers).
      // ↑ : pull lines just after the previous hunk (low end of gap).
      //     Only meaningful when there IS a previous hunk; otherwise it's
      //     equivalent to ↓ and we hide it to match github.com which only
      //     shows ↑ at the FIRST hunk and ↓ at the LAST hunk respectively.
      const buttons: ExpandButtonSpec[] = [];
      if (isFirst) {
        // First hunk: only one button. Behaviour matches a mid-hunk's ↓
        // (pull high end of gap, insert below @@) but the icon shows ↑
        // because conceptually the lines we expand into are ABOVE this
        // hunk in the file. Repeated clicks walk further up the file.
        buttons.push({ direction: 'up', title: 'Show ' + Math.min(STEP, remainingSize) + ' more lines',
          onClick: () => fetchAndInsert(Math.max(remainingStart, remainingEnd - STEP + 1), remainingEnd, 'after') });
      } else {
        // Mid hunks: ↑ pulls low end (toward prev hunk, above @@),
        //            ↓ pulls high end (toward this hunk, below @@).
        buttons.push({ direction: 'up', title: 'Show ' + Math.min(STEP, remainingSize) + ' more lines',
          onClick: () => fetchAndInsert(remainingStart, Math.min(remainingEnd, remainingStart + STEP - 1), 'before') });
        buttons.push({ direction: 'down', title: 'Show ' + Math.min(STEP, remainingSize) + ' more lines',
          onClick: () => fetchAndInsert(Math.max(remainingStart, remainingEnd - STEP + 1), remainingEnd, 'after') });
      }
      return createExpandStack(buttons);
    };

    const siblings = item.siblings || [{ tr: item.tr }];
    siblings.forEach(sib => {
      const ln = sib.tr.querySelector('.d2h-code-linenumber.d2h-info, .d2h-code-side-linenumber.d2h-info');
      if (ln && !ln.querySelector('.gdp-expand-stack')) {
        ln.appendChild(buildStack());
      }
    });
    const firstSib = siblings[0];
    if (firstSib) {
      syncExpandRowHeights(siblings.map(sib => sib.tr), firstSib.tr);
    }
  }

  type ExpandButtonSpec = {
    direction: 'up' | 'down';
    title: string;
    onClick: () => void;
  };

  const EXPAND_ICON_PATHS = {
    up: 'M8 3.5 3.75 7.75l1.06 1.06L7.25 6.37V13h1.5V6.37l2.44 2.44 1.06-1.06L8 3.5z',
    down: 'M8 12.5 12.25 8.25l-1.06-1.06L8.75 9.63V3h-1.5v6.63L4.81 7.19 3.75 8.25 8 12.5z',
  };

  function createExpandStack(buttons: ExpandButtonSpec[]) {
    const stack = document.createElement('div');
    stack.className = 'gdp-expand-stack';
    buttons.forEach(spec => {
      const button = document.createElement('button');
      button.className = 'gdp-expand-btn';
      button.title = spec.title;
      button.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
        '<path fill="currentColor" d="' + EXPAND_ICON_PATHS[spec.direction] + '"/></svg>';
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        if (button.disabled) return;
        spec.onClick();
      });
      stack.appendChild(button);
    });
    return stack;
  }

  function syncExpandRowHeights(rows: HTMLTableRowElement[], stackRow: HTMLTableRowElement) {
    const syncHeight = () => {
      const stack = stackRow.querySelector('.gdp-expand-stack');
      const targetH = stack ? Math.max(20, stack.getBoundingClientRect().height) : 20;
      rows.forEach(row => row.style.setProperty('height', targetH + 'px', 'important'));
    };
    requestAnimationFrame(syncHeight);
    setTimeout(syncHeight, 100);
  }

  function attachTrailingExpandControls(item: HunkRow, file: FileMeta, ref: string, refPath: string) {
    const STEP = 20;
    let nextNewStart = nextNewLine(item.hunk);
    let nextOldStart = nextOldLine(item.hunk);
    const rows = (item.siblings || [{ tr: item.tr, sideIndex: 0 }]).map(sib => {
      const tbody = sib.tr.parentElement;
      if (!tbody) return null;
      const isSplit = !!sib.tr.querySelector('td.d2h-code-side-linenumber');
      const tr = document.createElement('tr');
      tr.className = 'gdp-hunk-row gdp-trailing-expand-row';
      const ln = document.createElement('td');
      ln.className = isSplit ? 'd2h-code-side-linenumber d2h-info' : 'd2h-code-linenumber d2h-info';
      const info = document.createElement('td');
      info.className = 'd2h-info';
      const spacer = document.createElement('div');
      spacer.className = isSplit ? 'd2h-code-side-line' : 'd2h-code-line';
      info.appendChild(spacer);
      tr.appendChild(ln);
      tr.appendChild(info);
      tbody.appendChild(tr);
      return { tr, ln, sideIndex: sib.sideIndex || 0 };
    }).filter(Boolean);
    if (!rows.length) return;

    const setBusy = (busy: boolean) => {
      rows.forEach(row => row.ln.querySelectorAll<HTMLButtonElement>('.gdp-expand-btn').forEach(btn => { btn.disabled = busy; }));
    };
    const fetchAndInsert = () => {
      const range = window.GdpExpandLogic.trailingClickRange(nextNewStart, STEP);
      setBusy(true);
      const url = '/file_range?path=' + refPath +
                  '&ref=' + encodeURIComponent(ref) +
                  '&start=' + range.start + '&end=' + range.end;
      trackLoad<{ lines?: string[] }>(fetch(url).then(r => r.json())).then(data => {
        const lines = (data && data.lines) || [];
        if (!lines.length) {
          rows.forEach(row => row.tr.remove());
          return;
        }
        const card = item.tr.closest('.d2h-file-wrapper');
        rows.forEach(row => insertContextRows(row.tr, lines, range.start, nextOldStart, 'before', row.sideIndex));
        const next = window.GdpExpandLogic.applyTrailingResult(
          { newStart: nextNewStart, oldStart: nextOldStart },
          lines.length,
          STEP,
        );
        nextNewStart = next.newStart;
        nextOldStart = next.oldStart;
        if (card) highlightInsertedSpans(card, file);
        if (next.eof) {
          rows.forEach(row => row.tr.remove());
          return;
        }
        setBusy(false);
      }).catch(() => { setBusy(false); });
    };
    rows.forEach(row => {
      row.ln.appendChild(createExpandStack([{ direction: 'down', title: 'Show more lines', onClick: fetchAndInsert }]));
    });
    syncExpandRowHeights(rows.map(row => row.tr), rows[0].tr);
  }

  // Insert context rows around the `@@` info row.
  //   dir='before' (↑, low line nums after prev hunk): insert ABOVE @@.
  //   dir='after'  (↓, high line nums before this hunk): insert BELOW @@.
  // Detects unified vs split by the existing line-num td. For split,
  // sideIndex chooses old (0) vs new (1) numbering.
  function insertContextRows(
    targetTr: HTMLTableRowElement,
    lines: string[],
    newStart: number,
    oldStart: number,
    dir: 'before' | 'after',
    sideIndex: number,
  ) {
    const tbody = targetTr.parentElement;
    if (!tbody) return;
    const anchor = (dir === 'after') ? targetTr.nextElementSibling : targetTr;
    const isSplit = !!targetTr.querySelector('td.d2h-code-side-linenumber');
    const frag = document.createDocumentFragment();
    for (let i = 0; i < lines.length; i++) {
      const tr = document.createElement('tr');
      tr.className = 'gdp-inserted-ctx';
      if (dir) tr.dataset.gdpDir = dir;
      let lnHtml;
      if (isSplit) {
        const num = sideIndex === 0 ? (oldStart + i) : (newStart + i);
        lnHtml = '<td class="d2h-code-side-linenumber d2h-cntx">' + num + '</td>';
      } else {
        lnHtml = '<td class="d2h-code-linenumber d2h-cntx">' +
          '<div class="line-num1">' + (oldStart + i) + '</div>' +
          '<div class="line-num2">' + (newStart + i) + '</div>' +
          '</td>';
      }
      tr.innerHTML = lnHtml +
        '<td class="d2h-cntx">' +
          '<div class="' + (isSplit ? 'd2h-code-side-line' : 'd2h-code-line') + '">' +
            '<span class="d2h-code-line-prefix">&nbsp;</span>' +
            '<span class="d2h-code-line-ctn">' + escapeHtmlText(lines[i]) + '</span>' +
          '</div>' +
        '</td>';
      frag.appendChild(tr);
    }
    tbody.insertBefore(frag, anchor);
  }

  function escapeHtmlText(s: unknown): string {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function setFileCollapsed(card: DiffCardElement, collapsed: boolean) {
    card.classList.toggle('gdp-file-collapsed', collapsed);
    card.querySelectorAll<HTMLElement>('.d2h-files-diff, .d2h-file-diff, .gdp-source-viewer, .gdp-media').forEach(body => {
      body.classList.toggle('d2h-d-none', collapsed);
    });
    const button = card.querySelector<HTMLButtonElement>('.gdp-file-toggle');
    if (button) {
      button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      button.title = collapsed ? 'Expand file' : 'Collapse file';
    }
    const unfold = card.querySelector<HTMLButtonElement>('.gdp-file-unfold');
    if (unfold) unfold.disabled = collapsed;
    const viewFile = card.querySelector<HTMLButtonElement>('.gdp-view-file');
    if (viewFile) viewFile.disabled = collapsed;
  }

  function setViewFileButtonState(button: HTMLButtonElement | null, sourceMode: boolean) {
    if (!button) return;
    button.classList.add('gdp-btn', 'gdp-btn-sm');
    button.textContent = sourceMode ? 'View Diff' : 'View File';
    button.setAttribute('aria-pressed', sourceMode ? 'true' : 'false');
    button.title = sourceMode ? 'View diff' : 'View file';
  }

  function renderSourceLoading(card: DiffCardElement, target: SourceFileTarget, onCancel?: () => void) {
    const body = card.querySelector<HTMLElement>('.gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer');
    const view = document.createElement('div');
    view.className = 'gdp-source-viewer loading';
    const content = document.createElement('div');
    content.className = 'gdp-source-loading-content';
    const title = document.createElement('strong');
    title.className = 'gdp-source-loading-title';
    title.textContent = 'Loading file';
    const message = document.createElement('div');
    message.className = 'gdp-source-loading-message';
    message.textContent = target.path + ' at ' + target.ref;
    content.append(title, message);
    if (onCancel) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gdp-btn gdp-btn-sm gdp-source-cancel';
      button.textContent = 'Cancel';
      button.title = 'Cancel loading (Esc)';
      button.addEventListener('click', e => {
        e.stopPropagation();
        onCancel();
      });
      content.appendChild(button);
    }
    view.appendChild(content);
    if (body) body.replaceWith(view);
    else card.appendChild(view);
  }

  function renderSourceError(card: DiffCardElement, target: SourceFileTarget, message: string) {
    const body = card.querySelector<HTMLElement>('.gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer');
    const view = document.createElement('div');
    view.className = 'gdp-source-viewer error';
    view.textContent = message || ('Cannot load ' + target.path + ' at ' + target.ref);
    if (body) body.replaceWith(view);
    else card.appendChild(view);
  }

  function renderSourceCancelled(card: DiffCardElement, target: SourceFileTarget) {
    const body = card.querySelector<HTMLElement>('.gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer');
    const view = document.createElement('div');
    view.className = 'gdp-source-viewer cancelled';
    const content = document.createElement('div');
    content.className = 'gdp-source-loading-content';
    const title = document.createElement('strong');
    title.className = 'gdp-source-loading-title';
    title.textContent = 'Loading cancelled';
    const message = document.createElement('div');
    message.className = 'gdp-source-loading-message';
    message.textContent = target.path + ' at ' + target.ref;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'gdp-btn gdp-btn-sm';
    retry.textContent = 'Reopen';
    retry.addEventListener('click', () => renderStandaloneSource(sourceTargetFromRoute() || target));
    content.append(title, message, retry);
    view.appendChild(content);
    if (body) body.replaceWith(view);
    else card.appendChild(view);
  }

  function renderSourceUnsupported(card: DiffCardElement, target: SourceFileTarget) {
    const body = card.querySelector<HTMLElement>('.gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer');
    const view = document.createElement('div');
    view.className = 'gdp-source-viewer unsupported';
    const content = document.createElement('div');
    content.className = 'gdp-source-unsupported-content';
    const title = document.createElement('strong');
    title.className = 'gdp-source-unsupported-title';
    title.textContent = 'Preview unavailable';
    const message = document.createElement('div');
    message.className = 'gdp-source-unsupported-message';
    message.textContent = 'This file type cannot be previewed safely in the browser.';
    const info = createSourceFileInfo(target, 'unsupported file');
    const link = document.createElement('a');
    link.className = 'gdp-btn gdp-btn-sm gdp-source-download';
    link.href = buildRawFileUrl(target);
    link.textContent = 'Download raw';
    link.target = '_blank';
    link.rel = 'noreferrer';
    content.append(title, message, info, link);
    view.appendChild(content);
    if (body) body.replaceWith(view);
    else card.appendChild(view);
  }

  function isPreviewableSource(path: string): boolean {
    return /\.(md|markdown|mdown|mkdn|mdx)$/i.test(path);
  }

  const EXT_TO_LANG: Record<string, string> = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
    java: 'java', kt: 'kotlin', swift: 'swift',
    c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp',
    cs: 'csharp', php: 'php', lua: 'lua', sh: 'bash',
    bash: 'bash', zsh: 'bash', fish: 'bash',
    sql: 'sql', json: 'json', yaml: 'yaml', yml: 'yaml',
    toml: 'toml', tf: 'terraform', tfvars: 'terraform', hcl: 'terraform',
    xml: 'xml', html: 'xml', vue: 'xml',
    css: 'css', scss: 'scss', md: 'markdown', dockerfile: 'dockerfile',
    proto: 'protobuf', gradle: 'gradle', properties: 'properties',
    patch: 'diff', diff: 'diff', nix: 'nix', cue: 'cue',
    rego: 'rego', bicep: 'bicep', bazel: 'starlark',
    bzl: 'starlark', cmake: 'cmake', groovy: 'groovy',
    dart: 'dart', scala: 'scala', clj: 'clojure', cljs: 'clojure',
    cljc: 'clojure', edn: 'clojure', ex: 'elixir', exs: 'elixir',
    erl: 'erlang', hrl: 'erlang', hs: 'haskell', lhs: 'haskell',
    ml: 'ocaml', mli: 'ocaml', jl: 'julia', r: 'r', rmd: 'r',
    pl: 'perl', pm: 'perl', tcl: 'tcl', vim: 'vim',
    f: 'fortran', f90: 'fortran', m: 'objective-c', mm: 'objective-cpp',
    tex: 'tex', bib: 'bibtex', rst: 'rst',
  };

  const TEXT_SOURCE_EXTENSIONS = new Set([
    ...Object.keys(EXT_TO_LANG),
    'txt', 'md', 'markdown', 'mdown', 'mkdn', 'mdx',
    'json', 'jsonc', 'csv', 'tsv', 'yaml', 'yml', 'toml',
    'hcl', 'tf', 'tfvars', 'tfstate',
    'xml', 'html', 'htm', 'css', 'scss', 'sass', 'less',
    'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts',
    'vue', 'svelte', 'astro',
    'rs', 'go', 'py', 'rb', 'php', 'java', 'kt', 'kts',
    'c', 'cc', 'cpp', 'cxx', 'h', 'hpp', 'cs', 'swift',
    'sh', 'bash', 'zsh', 'fish', 'ps1',
    'sql', 'graphql', 'graphqls', 'gql',
    'ini', 'conf', 'env', 'properties',
    'gitignore', 'dockerignore', 'editorconfig',
    'lock', 'log', 'patch', 'diff', 'sum', 'mk',
    'proto', 'thrift', 'prisma', 'gradle', 'cmake',
    'nix', 'cue', 'rego', 'bicep', 'bazel', 'bzl',
    'dart', 'scala', 'clj', 'cljs', 'cljc', 'edn',
    'ex', 'exs', 'erl', 'hrl', 'hs', 'lhs', 'ml', 'mli',
    'jl', 'r', 'rmd', 'pl', 'pm', 'tcl', 'vim', 'groovy',
    'f', 'f90', 'm', 'mm', 'pas', 'tex', 'bib', 'rst', 'adoc', 'org',
    'ipynb', 'ejs', 'hbs', 'mustache', 'liquid', 'pug',
  ]);

  const TEXT_SOURCE_FILENAMES = new Set([
    'readme', 'license', 'copying', 'authors', 'contributors',
    'notice', 'changelog', 'todo', 'manifest', 'version',
    'codeowners', 'go.mod', 'build.bazel', 'workspace.bazel', 'module.bazel',
    'gemfile', 'rakefile', 'procfile', 'brewfile',
    'gnumakefile', 'bsdmakefile',
    '.gitattributes', '.gitmodules', '.npmrc', '.nvmrc',
    '.yarnrc', '.prettierrc', '.eslintrc', '.babelrc', '.stylelintrc',
  ]);

  const FILENAME_TO_LANG: Record<string, string> = {
    dockerfile: 'dockerfile',
    makefile: 'makefile',
    gnumakefile: 'makefile',
    bsdmakefile: 'makefile',
    'go.mod': 'go',
    'build.bazel': 'starlark',
    'workspace.bazel': 'starlark',
    'module.bazel': 'starlark',
  };

  function sourceFileName(path: string): string {
    return (path.split('/').pop() || path).toLowerCase();
  }

  function sourceFileExtension(name: string): string {
    const index = name.lastIndexOf('.');
    return index >= 0 ? name.slice(index + 1) : '';
  }

  function isDockerfileName(name: string): boolean {
    return /^dockerfile(?:[.-].+)?$/i.test(name);
  }

  function isMakefileName(name: string): boolean {
    return /^makefile(?:[.-].+)?$/i.test(name);
  }

  function sourceDisplayKind(path: string): 'image' | 'video' | 'pdf' | 'text' | 'unsupported' {
    if (isVideo(path)) return 'video';
    if (isImage(path)) return 'image';
    if (/\.pdf$/i.test(path)) return 'pdf';
    const name = sourceFileName(path);
    const ext = sourceFileExtension(name);
    if (TEXT_SOURCE_EXTENSIONS.has(ext)) return 'text';
    if (TEXT_SOURCE_FILENAMES.has(name)) return 'text';
    if (isDockerfileName(name) || isMakefileName(name)) return 'text';
    return 'unsupported';
  }

  function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return (unit === 0 ? String(value) : value.toFixed(value >= 10 ? 1 : 2).replace(/\.0+$/, '')) + ' ' + units[unit];
  }

  function humanFileKind(path: string, mime: string | undefined, fallback: string): string {
    const ext = (path.split('.').pop() || '').toLowerCase();
    if (ext === 'png') return 'PNG image';
    if (ext === 'jpg' || ext === 'jpeg') return 'JPEG image';
    if (ext === 'gif') return 'GIF image';
    if (ext === 'webp') return 'WebP image';
    if (ext === 'svg') return 'SVG image';
    if (ext === 'pdf') return 'PDF document';
    if (ext === 'zip') return 'ZIP archive';
    if (ext === 'mp4') return 'MP4 video';
    if (ext === 'webm') return 'WebM video';
    if (mime?.startsWith('image/')) return 'Image';
    if (mime?.startsWith('video/')) return 'Video';
    if (mime === 'application/pdf') return 'PDF document';
    if (fallback === 'unsupported file') return 'Binary file';
    return fallback.charAt(0).toUpperCase() + fallback.slice(1);
  }

  async function loadRawFileInfo(target: SourceFileTarget): Promise<{ size?: number; type?: string }> {
    try {
      const res = await fetch(buildRawFileUrl(target), { method: 'HEAD' });
      if (!res.ok) return {};
      const rawSize = res.headers.get('content-length');
      const size = rawSize == null ? NaN : Number(rawSize);
      return {
        size: rawSize != null && Number.isFinite(size) ? size : undefined,
        type: res.headers.get('content-type') || undefined,
      };
    } catch {
      return {};
    }
  }

  function createSourceFileInfo(target: SourceFileTarget, kind: string): HTMLElement {
    const info = document.createElement('div');
    info.className = 'gdp-source-file-info';
    const type = document.createElement('span');
    type.className = 'kind';
    type.textContent = humanFileKind(target.path, undefined, kind);
    info.appendChild(type);
    loadRawFileInfo(target).then(meta => {
      type.textContent = humanFileKind(target.path, meta.type, kind);
      if (meta.size != null) {
        const size = document.createElement('span');
        size.textContent = formatBytes(meta.size);
        info.appendChild(size);
      }
    });
    return info;
  }

  function createSourceCopyButton(textValue: string): HTMLButtonElement {
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'gdp-file-header-icon gdp-copy-source';
    copy.title = 'Copy source';
    copy.setAttribute('aria-label', 'Copy source');
    copy.innerHTML = iconSvg('octicon-copy', COPY_16_PATHS);
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(textValue);
        copy.classList.add('copied');
        setTimeout(() => { copy.classList.remove('copied'); }, 1200);
      } catch {
        copy.classList.add('failed');
        setTimeout(() => { copy.classList.remove('failed'); }, 1200);
      }
    });
    return copy;
  }

  function createSourceTabs(active: 'preview' | 'code', textValue?: string) {
    const tabs = document.createElement('div');
    tabs.className = 'gdp-source-tabs';
    const codeButton = document.createElement('button');
    codeButton.type = 'button';
    codeButton.textContent = 'Code';
    codeButton.classList.toggle('active', active === 'code');
    tabs.appendChild(codeButton);
    let previewButton: HTMLButtonElement | null = null;
    if (active === 'preview') {
      previewButton = document.createElement('button');
      previewButton.type = 'button';
      previewButton.className = 'active';
      previewButton.textContent = 'Preview';
      tabs.prepend(previewButton);
    }
    if (textValue != null) tabs.appendChild(createSourceCopyButton(textValue));
    return { tabs, codeButton, previewButton };
  }

  async function renderSourceText(card: DiffCardElement, target: SourceFileTarget, textValue: string, signal?: AbortSignal): Promise<boolean> {
    const lines = textValue.length ? textValue.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n') : [''];
    SOURCE_CURSOR_TOTALS.set(sourceCursorKey(target), lines.length);
    resetSourceCursorForTarget(target, lines.length);
    const body = card.querySelector<HTMLElement>('.gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer');
    const isStandalone = card.classList.contains('gdp-standalone-source');
    const view = document.createElement('div');
    view.className = 'gdp-source-viewer';
    const header = isStandalone ? null : document.createElement('div');
    if (header) {
      header.className = 'gdp-source-meta';
      header.textContent = target.path + ' @ ' + target.ref;
    }
    const lang = inferLang(target.path);
    const usesVirtualSource = shouldVirtualizeSource(textValue, lines) && !isVirtualSourceDisabled();
    const hljsRef = STATE.syntaxHighlight && usesVirtualSource ? await loadSyntaxHighlighter() : null;
    const sourceShikiRef = STATE.syntaxHighlight && !usesVirtualSource ? await loadSourceShikiHighlighter() : null;
    if (signal?.aborted) return false;
    const previewable = isPreviewableSource(target.path);
    const tabsHost = card.querySelector<HTMLElement>('.gdp-file-detail-tabs');
    if (usesVirtualSource) {
      const virtualCode = renderVirtualSource(target, textValue, lines, hljsRef, lang);
      if (previewable) {
        const { tabs, codeButton, previewButton } = createSourceTabs('preview', textValue);
        if (tabsHost) {
          tabsHost.hidden = false;
          tabsHost.replaceChildren(tabs);
        }
        const preview = await renderMarkdownPreview(textValue, target, {
          syntaxHighlight: STATE.syntaxHighlight,
          signal,
          onNavigateMarkdown: (path, ref) => {
            setRoute({ screen: 'file', path, ref, view: 'blob', range: currentRange() });
            renderStandaloneSource({ path, ref });
          },
        });
        if (signal?.aborted) return false;
        virtualCode.hidden = true;
        previewButton?.addEventListener('click', () => {
          previewButton.classList.add('active');
          codeButton.classList.remove('active');
          preview.hidden = false;
          virtualCode.hidden = true;
        });
        codeButton.addEventListener('click', () => {
          codeButton.classList.add('active');
          previewButton.classList.remove('active');
          preview.hidden = true;
          virtualCode.hidden = false;
        });
        if (header) view.appendChild(header);
        view.classList.add('virtual');
        view.append(preview, virtualCode);
        if (body) body.replaceWith(view);
        else card.appendChild(view);
        return true;
      }
      if (header) view.appendChild(header);
      view.classList.add('virtual');
      view.appendChild(virtualCode);
      if (signal?.aborted) return false;
      if (body) body.replaceWith(view);
      else card.appendChild(view);
      return true;
    }
    const table = document.createElement('table');
    table.className = 'gdp-source-table';
    const tbody = document.createElement('tbody');
    const sourceShikiLang = normalizeSourceShikiLang(lang);
    const shikiLines = sourceShikiRef && sourceShikiLang ? sourceShikiLines(textValue, sourceShikiLang, sourceShikiRef) : null;
    for (let index = 0; index < lines.length; index++) {
      if (signal?.aborted) return false;
      const line = lines[index];
      const tr = document.createElement('tr');
      tr.dataset.line = String(index + 1);
      tr.classList.toggle('gdp-source-line-target', lineInSourceTarget(index + 1, currentSourceLineTarget(target)));
      tr.classList.toggle('gdp-source-cursor', sourceCursorMatches(target, index + 1));
      const num = document.createElement('td');
      num.className = 'gdp-source-line-number';
      num.textContent = String(index + 1);
      bindSourceLineNumber(num, card, target, index + 1);
      const code = document.createElement('td');
      code.className = 'gdp-source-line-code';
      if (shikiLines && shikiLines[index] != null) {
        code.innerHTML = shikiLines[index] || ' ';
        code.classList.add('shiki');
      } else {
        code.textContent = line || ' ';
      }
      tr.appendChild(num);
      tr.appendChild(code);
      tbody.appendChild(tr);
      if (index > 0 && index % 500 === 0) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        if (signal?.aborted) return false;
      }
    }
    table.appendChild(tbody);
    const { tabs, codeButton, previewButton } = createSourceTabs(previewable ? 'preview' : 'code', textValue);
    if (tabsHost) {
      tabsHost.hidden = false;
      tabsHost.replaceChildren(tabs);
    }
    if (previewable) {
      const preview = await renderMarkdownPreview(textValue, target, {
        syntaxHighlight: STATE.syntaxHighlight,
        signal,
        onNavigateMarkdown: (path, ref) => {
          setRoute({ screen: 'file', path, ref, view: 'blob', range: currentRange() });
          renderStandaloneSource({ path, ref });
        },
      });
      if (signal?.aborted) return false;
      table.hidden = true;
      previewButton?.addEventListener('click', () => {
        previewButton.classList.add('active');
        codeButton.classList.remove('active');
        preview.hidden = false;
        table.hidden = true;
      });
      codeButton.addEventListener('click', () => {
        codeButton.classList.add('active');
        previewButton.classList.remove('active');
        preview.hidden = true;
        table.hidden = false;
      });
      if (header) view.appendChild(header);
      view.appendChild(preview);
      view.appendChild(table);
      if (signal?.aborted) return false;
      if (body) body.replaceWith(view);
      else card.appendChild(view);
      return true;
    }
    if (header) view.appendChild(header);
    view.appendChild(table);
    if (signal?.aborted) return false;
    if (body) body.replaceWith(view);
    else card.appendChild(view);
    return true;
  }

  function shouldVirtualizeSource(textValue: string, lines: string[]): boolean {
    return textValue.length >= VIRTUAL_SOURCE_SIZE_THRESHOLD || lines.length >= VIRTUAL_SOURCE_LINE_THRESHOLD;
  }

  function isVirtualSourceDisabled(): boolean {
    return new URLSearchParams(window.location.search).get('virtual') === 'off';
  }

  function buildCurrentFileRouteWithVirtualMode(target: SourceFileTarget, virtualMode: 'auto' | 'off'): string {
    const route: AppRoute = {
      screen: 'file',
      path: target.path,
      ref: target.ref,
      view: STATE.route.screen === 'file' ? STATE.route.view : 'blob',
      range: currentRange(),
    };
    const url = new URL(buildRoute(route), window.location.origin);
    if (virtualMode === 'off') url.searchParams.set('virtual', 'off');
    else url.searchParams.delete('virtual');
    return url.pathname + url.search;
  }

  function currentSourceLineTarget(target: SourceFileTarget): SourceLineTarget | undefined {
    const routeTarget = sourceTargetFromRoute();
    return sourceTargetsEqual(routeTarget, target) && STATE.route.screen === 'file' ? STATE.route.line : undefined;
  }

  function lineTargetStart(line: SourceLineTarget | undefined): number | undefined {
    if (!line) return undefined;
    return typeof line === 'number' ? line : line.start;
  }

  function lineInSourceTarget(lineNumber: number, target: SourceLineTarget | undefined): boolean {
    if (!target) return false;
    if (typeof target === 'number') return lineNumber === target;
    return lineNumber >= target.start && lineNumber <= target.end;
  }

  let SOURCE_LINE_DRAG: { target: SourceFileTarget; start: number } | null = null;

  function normalizeSourceLineSelection(start: number, end: number): SourceLineTarget {
    const a = Math.max(1, Math.floor(start));
    const b = Math.max(1, Math.floor(end));
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    return from === to ? from : { start: from, end: to };
  }

  function setSourceLineRoute(target: SourceFileTarget, line: SourceLineTarget) {
    if (STATE.route.screen !== 'file') return;
    setRoute({
      screen: 'file',
      path: target.path,
      ref: target.ref,
      view: STATE.route.view,
      range: currentRange(),
      line,
    }, true);
  }

  function syncRenderedSourceLineHighlights(card: HTMLElement, target: SourceFileTarget) {
    const lineTarget = currentSourceLineTarget(target);
    card.querySelectorAll<HTMLElement>('[data-line]').forEach(row => {
      const line = Number(row.dataset.line || '0');
      row.classList.toggle('gdp-source-line-target', lineInSourceTarget(line, lineTarget));
    });
  }

  function updateSourceLineSelection(card: HTMLElement, target: SourceFileTarget, start: number, end: number) {
    setSourceLineRoute(target, normalizeSourceLineSelection(start, end));
    syncRenderedSourceLineHighlights(card, target);
  }

  function beginSourceLineSelection(event: MouseEvent, card: HTMLElement, target: SourceFileTarget, line: number) {
    event.preventDefault();
    SOURCE_LINE_DRAG = { target, start: line };
    updateSourceLineSelection(card, target, line, line);
  }

  function bindSourceLineNumber(num: HTMLElement, card: HTMLElement, target: SourceFileTarget, line: number) {
    num.addEventListener('mousedown', e => beginSourceLineSelection(e, card, target, line));
    num.addEventListener('mouseenter', () => {
      if (!SOURCE_LINE_DRAG || !sourceTargetsEqual(SOURCE_LINE_DRAG.target, target)) return;
      updateSourceLineSelection(card, target, SOURCE_LINE_DRAG.start, line);
    });
  }

  document.addEventListener('mouseup', () => {
    SOURCE_LINE_DRAG = null;
  });

  function renderVirtualSource(target: SourceFileTarget, textValue: string, lines: string[], hljsRef: HljsApi | null, lang: string | null): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'gdp-source-virtual';
    const info = document.createElement('div');
    info.className = 'gdp-source-virtual-info';
    const badge = document.createElement('span');
    badge.className = 'gdp-source-virtual-badge';
    badge.textContent = 'Virtual mode';
    const summary = document.createElement('span');
    summary.className = 'gdp-source-virtual-summary';
    summary.textContent = lines.length.toLocaleString() + ' lines, ' + formatBytes(textValue.length) +
      '. Only visible rows are rendered. Highlighting is per-line.';
    const actions = document.createElement('span');
    actions.className = 'gdp-source-virtual-actions';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'gdp-file-header-icon gdp-copy-source gdp-source-virtual-copy';
    copy.title = 'Copy source';
    copy.setAttribute('aria-label', 'Copy source');
    copy.innerHTML = iconSvg('octicon-copy', COPY_16_PATHS);
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(textValue);
        copy.classList.add('copied');
        setTimeout(() => { copy.classList.remove('copied'); }, 1200);
      } catch {
        copy.classList.add('failed');
        setTimeout(() => { copy.classList.remove('failed'); }, 1600);
      }
    });
    const full = document.createElement('a');
    full.className = 'gdp-source-virtual-action';
    full.href = buildCurrentFileRouteWithVirtualMode(target, 'off');
    full.textContent = 'Open full view';
    full.title = 'Render every line without virtualization. This can be slow for large files.';
    full.addEventListener('click', (e) => {
      e.preventDefault();
      const url = new URL(full.href, window.location.origin);
      setRoute(parseRoute(url.pathname, url.search, currentRange()), true);
      renderStandaloneSource(target);
    });
    actions.append(copy, full);
    info.append(badge, summary, actions);
    const scroller = document.createElement('div');
    scroller.className = 'gdp-source-virtual-scroller';
    const spacer = document.createElement('div');
    spacer.className = 'gdp-source-virtual-spacer';
    spacer.style.height = Math.max(1, lines.length * VIRTUAL_SOURCE_ROW_HEIGHT) + 'px';
    const windowEl = document.createElement('div');
    windowEl.className = 'gdp-source-virtual-window';
    spacer.appendChild(windowEl);
    scroller.appendChild(spacer);
    wrap.append(info, scroller);

    let raf = 0;
    let renderedStart = -1;
    let renderedEnd = -1;
    const render = () => {
      raf = 0;
      const viewportHeight = scroller.clientHeight || window.innerHeight;
      const overscan = 20;
      const start = Math.max(0, Math.floor(scroller.scrollTop / VIRTUAL_SOURCE_ROW_HEIGHT) - overscan);
      const end = Math.min(lines.length, Math.ceil((scroller.scrollTop + viewportHeight) / VIRTUAL_SOURCE_ROW_HEIGHT) + overscan);
      if (start === renderedStart && end === renderedEnd) return;
      renderedStart = start;
      renderedEnd = end;
      windowEl.replaceChildren();
      windowEl.style.transform = 'translateY(' + (start * VIRTUAL_SOURCE_ROW_HEIGHT) + 'px)';
      const fragment = document.createDocumentFragment();
      for (let index = start; index < end; index++) {
        const row = document.createElement('div');
        row.className = 'gdp-source-virtual-row';
        row.dataset.line = String(index + 1);
        row.classList.toggle('gdp-source-line-target', lineInSourceTarget(index + 1, currentSourceLineTarget(target)));
        row.classList.toggle('gdp-source-cursor', sourceCursorMatches(target, index + 1));
        const num = document.createElement('span');
        num.className = 'gdp-source-virtual-line-number';
        num.textContent = String(index + 1);
        bindSourceLineNumber(num, wrap, target, index + 1);
        const code = document.createElement('span');
        code.className = 'gdp-source-virtual-line-code';
        const line = lines[index] ?? '';
        if (hljsRef && hljsRef.highlight && lang && line.length <= VIRTUAL_SOURCE_HIGHLIGHT_MAX_LINE_LENGTH && (!hljsRef.getLanguage || hljsRef.getLanguage(lang))) {
          try {
            code.innerHTML = hljsRef.highlight(line, { language: lang, ignoreIllegals: true }).value;
            code.classList.add('hljs');
          } catch {
            code.textContent = line;
          }
        } else {
          code.textContent = line;
        }
        row.append(num, code);
        fragment.appendChild(row);
      }
      windowEl.appendChild(fragment);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(render);
    };
    (scroller as HTMLElement & { __gdpRenderVirtualSource?: () => void }).__gdpRenderVirtualSource = render;
    scroller.addEventListener('scroll', schedule, { passive: true });
    let resizeObserver: ResizeObserver | null = null;
    resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      if (!scroller.isConnected) {
        resizeObserver?.disconnect();
        resizeObserver = null;
        return;
      }
      schedule();
    }) : null;
    resizeObserver?.observe(scroller);
    render();
    schedule();
    return wrap;
  }

  function renderSourceMedia(card: DiffCardElement, target: SourceFileTarget, mediaKind: string) {
    const body = card.querySelector<HTMLElement>('.gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer');
    const isStandalone = card.classList.contains('gdp-standalone-source');
    const view = document.createElement('div');
    view.className = 'gdp-source-viewer media';
    if (!isStandalone) {
      const meta = document.createElement('div');
      meta.className = 'gdp-source-meta';
      meta.textContent = target.path + ' @ ' + target.ref;
      view.appendChild(meta);
    }
    const url = buildRawFileUrl(target);
    const info = createSourceFileInfo(target, mediaKind);
    view.appendChild(info);
    if (mediaKind === 'video') {
      const video = document.createElement('video');
      video.src = url;
      video.controls = true;
      video.preload = 'metadata';
      view.appendChild(video);
    } else if (mediaKind === 'pdf') {
      const frame = document.createElement('iframe');
      frame.src = url;
      frame.title = target.path;
      frame.loading = 'lazy';
      view.appendChild(frame);
    } else {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.addEventListener('load', () => {
        const resolution = document.createElement('span');
        resolution.textContent = img.naturalWidth + ' x ' + img.naturalHeight;
        info.appendChild(resolution);
      }, { once: true });
      view.appendChild(img);
    }
    if (body) body.replaceWith(view);
    else card.appendChild(view);
  }

  function renderSourceBinary(card: DiffCardElement, target: SourceFileTarget) {
    const body = card.querySelector<HTMLElement>('.gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer');
    const isStandalone = card.classList.contains('gdp-standalone-source');
    const view = document.createElement('div');
    view.className = 'gdp-source-viewer binary';
    const link = document.createElement('a');
    link.href = buildRawFileUrl(target);
    link.textContent = 'Open raw file';
    link.target = '_blank';
    link.rel = 'noreferrer';
    if (!isStandalone) {
      const meta = document.createElement('div');
      meta.className = 'gdp-source-meta';
      meta.textContent = target.path + ' @ ' + target.ref;
      view.appendChild(meta);
    }
    view.appendChild(link);
    if (body) body.replaceWith(view);
    else card.appendChild(view);
  }

  function createFileBreadcrumb(path: string, ref?: string): HTMLElement {
    const nav = document.createElement('nav');
    nav.className = 'gdp-file-breadcrumb';
    nav.setAttribute('aria-label', 'File path');
    const parts = path.split('/').filter(Boolean);
    const allParts = PROJECT_NAME ? [PROJECT_NAME, ...parts] : parts;
    allParts.forEach((part, index) => {
      if (index > 0) {
        const sep = document.createElement('span');
        sep.className = 'gdp-file-breadcrumb-sep';
        sep.textContent = '/';
        nav.appendChild(sep);
      }
      const isCurrent = index === allParts.length - 1;
      const crumb = document.createElement(isCurrent ? 'span' : 'button');
      crumb.className = index === allParts.length - 1 ? 'gdp-file-breadcrumb-current' : 'gdp-file-breadcrumb-part';
      crumb.textContent = part;
      if (!isCurrent && crumb instanceof HTMLButtonElement) {
        crumb.type = 'button';
        crumb.addEventListener('click', () => {
          const projectOffset = PROJECT_NAME ? 1 : 0;
          const currentPath = parts.slice(0, Math.max(0, index - projectOffset + 1)).join('/');
          setRoute(repoRoute(ref || 'worktree', currentPath));
          loadRepo();
        });
      }
      nav.appendChild(crumb);
    });
    if (!allParts.length) {
      const crumb = document.createElement('span');
      crumb.className = 'gdp-file-breadcrumb-current';
      crumb.textContent = path;
      nav.appendChild(crumb);
    }
    return nav;
  }

  async function renderStandaloneSource(target: SourceFileTarget) {
    cancelActiveSourceLoad('navigation');
    const req = ++SOURCE_REQ_SEQ;
    const root = $('#diff');
    const repoTarget = repoFileTargetFromRoute();
    setPageMode();
    removeStandaloneSource();
    document.querySelectorAll('.gdp-repo-blob-layout').forEach(el => el.remove());
    const card = document.createElement('article') as DiffCardElement;
    card.className = 'gdp-file-shell loaded gdp-standalone-source gdp-source-mode';
    card.dataset.path = target.path;
    const wrapper = document.createElement('div');
    wrapper.className = 'gdp-file-detail-wrapper';
    const sticky = document.createElement('div');
    sticky.className = 'gdp-file-detail-sticky';
    const header = document.createElement('div');
    header.className = 'gdp-file-detail-header';
    const name = document.createElement('div');
    name.className = 'gdp-file-detail-path';
    name.appendChild(createFileBreadcrumb(target.path, target.ref));
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'gdp-file-header-icon gdp-copy-path';
    copy.title = 'copy file path';
    copy.innerHTML = iconSvg('octicon-copy', COPY_16_PATHS);
    copy.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(target.path);
        copy.classList.add('copied');
        setTimeout(() => { copy.classList.remove('copied'); }, 1200);
      } catch {
        copy.classList.add('failed');
        setTimeout(() => { copy.classList.remove('failed'); }, 1200);
      }
    });
    name.appendChild(copy);
    name.appendChild(createOpenPathButton(target.path, 'file-parent', 'open parent folder in OS'));
    header.appendChild(name);
    if (!repoTarget) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'gdp-view-file gdp-btn gdp-btn-sm';
      setViewFileButtonState(back, true);
      back.addEventListener('click', () => {
        setRoute({ screen: 'diff', range: currentRange() });
        setPageMode();
        removeStandaloneSource();
      });
      header.appendChild(back);
    }
    sticky.appendChild(header);
    const tabsHost = document.createElement('div');
    tabsHost.className = 'gdp-file-detail-tabs';
    tabsHost.hidden = true;
    sticky.appendChild(tabsHost);
    wrapper.appendChild(sticky);
    const detailBody = document.createElement('div');
    detailBody.className = 'gdp-file-detail-body';
    wrapper.appendChild(detailBody);
    card.appendChild(wrapper);
    if (repoTarget) {
      const layout = document.createElement('div');
      layout.className = 'gdp-repo-blob-layout';
      renderRepoBlobSidebar(target.path, repoTarget);
      layout.appendChild(card);
      root.replaceChildren(layout);
    } else {
      root.prepend(card);
    }
    const controller = new AbortController();
    ACTIVE_SOURCE_LOAD = { controller, req, target, card };
    renderSourceLoading(card, target, () => cancelActiveSourceLoad('user'));
    try {
      const displayKind = sourceDisplayKind(target.path);
      if (displayKind === 'unsupported') {
        if (req !== SOURCE_REQ_SEQ || !sourceTargetsEqual(sourceTargetFromRoute(), target)) return;
        finishSourceLoad(req);
        renderSourceUnsupported(card, target);
        return;
      }
      if (displayKind === 'image' || displayKind === 'video' || displayKind === 'pdf') {
        if (req !== SOURCE_REQ_SEQ || !sourceTargetsEqual(sourceTargetFromRoute(), target)) return;
        finishSourceLoad(req);
        renderSourceMedia(card, target, displayKind);
        return;
      }
      if (displayKind === 'text') {
      const response = await trackLoad(fetch(buildRawFileUrl(target), { signal: controller.signal }));
      if (req !== SOURCE_REQ_SEQ || !sourceTargetsEqual(sourceTargetFromRoute(), target)) return;
      if (!response.ok) {
        finishSourceLoad(req);
        renderSourceError(card, target, 'Cannot load ' + target.path + ' at ' + target.ref);
        return;
      }
      const textValue = await response.text();
      if (req !== SOURCE_REQ_SEQ || !sourceTargetsEqual(sourceTargetFromRoute(), target)) return;
      const rendered = await renderSourceText(card, target, textValue, controller.signal);
      if (req !== SOURCE_REQ_SEQ || !sourceTargetsEqual(sourceTargetFromRoute(), target)) return;
      if (!rendered) return;
      scrollStandaloneSourceLine(card, lineTargetStart(STATE.route.screen === 'file' ? STATE.route.line : undefined));
      finishSourceLoad(req);
      }
    } catch (err) {
      if (req !== SOURCE_REQ_SEQ || !sourceTargetsEqual(sourceTargetFromRoute(), target)) return;
      finishSourceLoad(req);
      if (isAbortError(err)) {
        renderSourceCancelled(card, target);
        return;
      }
      renderSourceError(card, target, 'Cannot load ' + target.path + ' at ' + target.ref);
    }
  }

  function scrollStandaloneSourceLine(card: HTMLElement, line: number | undefined) {
    if (!line || line < 1) return;
    const virtualScroller = card.querySelector<HTMLElement>('.gdp-source-virtual-scroller');
    if (virtualScroller) {
      const centeredOffset = (virtualScroller.clientHeight / 2) - (VIRTUAL_SOURCE_ROW_HEIGHT / 2);
      virtualScroller.scrollTop = Math.max(0, (line - 1) * VIRTUAL_SOURCE_ROW_HEIGHT - Math.max(0, centeredOffset));
      return;
    }
    const row = card.querySelector<HTMLElement>('.gdp-source-table tr[data-line="' + String(line) + '"]');
    if (row) row.scrollIntoView({ block: 'center' });
  }

  function applySourceRouteToShell() {
    const target = sourceTargetFromRoute();
    setPageMode();
    if (!target) {
      removeStandaloneSource();
      document.querySelectorAll<HTMLButtonElement>('.gdp-view-file').forEach(button => {
        setViewFileButtonState(button, false);
      });
      return;
    }
    renderStandaloneSource(target);
  }

  async function expandAllFileContext(card: DiffCardElement, file: FileMeta) {
    if (card.classList.contains('gdp-context-expanded')) {
      const data = card._diffData;
      if (!data) return;
      card.classList.remove('gdp-context-expanded');
      mountDiff(card, file, data);
      if (data.truncated && data.mode === 'preview') addExpandHunksUI(file, data, card);
      scheduleIdleHighlight(card, file);
      setUnfoldButtonState(card.querySelector<HTMLButtonElement>('.gdp-file-unfold'), false);
      return;
    }
    if (card._diffData && (card._diffData.truncated || card._diffData.mode === 'preview')) {
      await loadFile(file, card, file.load_url);
      card.classList.add('gdp-context-expanded');
      setUnfoldButtonState(card.querySelector<HTMLButtonElement>('.gdp-file-unfold'), true);
      return;
    }
    const button = card.querySelector<HTMLButtonElement>('.gdp-file-unfold');
    if (button) button.disabled = true;
    try {
      for (let i = 0; i < 200; i++) {
        const next = card.querySelector<HTMLButtonElement>('.gdp-expand-btn:not(:disabled)');
        if (!next) break;
        next.click();
        await new Promise(resolve => setTimeout(resolve, 80));
      }
      card.classList.add('gdp-context-expanded');
      setUnfoldButtonState(button || null, true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  // GitHub-style diff squares: 5 small filled boxes (green/red/grey)
  // appended to the right edge of the file header.
  function appendStatSquaresToHeader(card: DiffCardElement, file: FileMeta) {
    const header = card.querySelector('.d2h-file-header');
    if (!header) return;
    if (!header.querySelector('.gdp-file-toggle')) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'gdp-file-header-icon gdp-file-toggle';
      toggle.title = 'Collapse file';
      toggle.setAttribute('aria-expanded', 'true');
      toggle.innerHTML = iconSvg('octicon-chevron-down', CHEVRON_DOWN_16_PATH);
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        setFileCollapsed(card, !card.classList.contains('gdp-file-collapsed'));
      });
      header.insertBefore(toggle, header.firstChild);
    }
    header.querySelectorAll<HTMLInputElement>('.d2h-file-collapse-input').forEach(checkbox => {
      checkbox.checked = STATE.viewedFiles.has(file.path);
      if (checkbox.dataset.gdpBound !== '1') {
        checkbox.dataset.gdpBound = '1';
        checkbox.addEventListener('change', () => setFileViewed(file.path, checkbox.checked));
      }
    });
    if (!header.querySelector('.gdp-copy-path')) {
      const nameWrapper = header.querySelector('.d2h-file-name-wrapper');
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'gdp-file-header-icon gdp-copy-path';
      copy.title = 'copy file path';
      copy.innerHTML = iconSvg('octicon-copy', COPY_16_PATHS);
      copy.addEventListener('click', async (e) => {
        e.stopPropagation();
        const path = filePathClipboardText(file.path);
        if (!path) return;
        try {
          await navigator.clipboard.writeText(path);
          copy.classList.add('copied');
          setTimeout(() => { copy.classList.remove('copied'); }, 1200);
        } catch {
          copy.classList.add('failed');
          setTimeout(() => { copy.classList.remove('failed'); }, 1200);
        }
      });
      const statusTag = nameWrapper ? nameWrapper.querySelector('.d2h-tag') : null;
      if (statusTag) statusTag.insertAdjacentElement('afterend', copy);
      else if (nameWrapper) nameWrapper.insertAdjacentElement('beforeend', copy);
      else header.insertBefore(copy, header.firstChild);
    }
    if (!header.querySelector('.gdp-file-unfold')) {
      const unfold = document.createElement('button');
      unfold.type = 'button';
      unfold.className = 'gdp-file-header-icon gdp-file-unfold';
      setUnfoldButtonState(unfold, card.classList.contains('gdp-context-expanded'));
      unfold.addEventListener('click', (e) => {
        e.stopPropagation();
        expandAllFileContext(card, file);
      });
      const copy = header.querySelector('.gdp-copy-path');
      if (copy) copy.insertAdjacentElement('afterend', unfold);
      else header.appendChild(unfold);
    }
    if (!header.querySelector('.gdp-open-path')) {
      const unfold = header.querySelector('.gdp-file-unfold');
      const openPath = createOpenPathButton(file.path, 'file-parent', 'open parent folder in OS');
      if (unfold) unfold.insertAdjacentElement('afterend', openPath);
      else header.appendChild(openPath);
    }
    // Numeric counts (matches GitHub: "+10 -113 ▰▰▰▰▰")
    if (!header.querySelector('.gdp-stat-text')) {
      const stats = document.createElement('span');
      stats.className = 'gdp-stat-text';
      stats.innerHTML = '<span class="a">+' + (file.additions||0) + '</span>' +
                        '<span class="d">−' + (file.deletions||0) + '</span>';
      header.appendChild(stats);
    }
    const total = (file.additions || 0) + (file.deletions || 0);
    const SEG = 5;
    let aSeg, dSeg;
    if (total === 0) {
      aSeg = 0; dSeg = 0;
    } else {
      aSeg = Math.round((file.additions / total) * SEG);
      dSeg = Math.max(0, SEG - aSeg);
      if (file.additions > 0 && aSeg === 0) aSeg = 1;
      if (file.deletions > 0 && dSeg === 0) dSeg = 1;
      const over = (aSeg + dSeg) - SEG;
      if (over > 0) dSeg -= over;
    }
    const wrap = document.createElement('span');
    wrap.className = 'gdp-stat-squares';
    for (let i = 0; i < SEG; i++) {
      const box = document.createElement('span');
      if (i < aSeg) box.className = 'sq add';
      else if (i < aSeg + dSeg) box.className = 'sq del';
      else box.className = 'sq nu';
      wrap.appendChild(box);
    }
    header.appendChild(wrap);
    if (!header.querySelector('.gdp-view-file')) {
      const viewFile = document.createElement('button');
      viewFile.type = 'button';
      viewFile.className = 'gdp-view-file gdp-btn gdp-btn-sm';
      setViewFileButtonState(viewFile, false);
      viewFile.addEventListener('click', (e) => {
        e.stopPropagation();
        const target = fileSourceTarget(file);
        setRoute({ screen: 'file', path: target.path, ref: target.ref, range: currentRange() });
        applySourceRouteToShell();
      });
      header.appendChild(viewFile);
    } else {
      setViewFileButtonState(header.querySelector<HTMLButtonElement>('.gdp-view-file'), false);
    }
  }

  function renderFile(file: FileMeta, data: FileDiffResponse, card: DiffCardElement) {
    card._diffData = data;
    card._file = file;
    card.classList.remove('loading', 'pending');
    card.classList.add('loaded');
    card.style.minHeight = '';

    mountDiff(card, file, data);
    applyDiffRouteFocus(card);
    card.style.containIntrinsicSize = Math.max(card.offsetHeight, file.estimated_height_px || 200) + 'px';
    applyViewedToCard(card, STATE.viewedFiles.has(file.path), true);

    if (data.truncated && data.mode === 'preview') {
      addExpandHunksUI(file, data, card);
    }

    scheduleIdleHighlight(card, file);
  }

  function buildPreviewUrl(file: FileMeta, hunks: number): string {
    // Reuse load_url's query, swap mode/max_hunks
    const u = new URL(file.load_url, window.location.origin);
    u.searchParams.set('mode', 'preview');
    u.searchParams.set('max_hunks', String(hunks));
    return u.pathname + u.search;
  }

  function addExpandHunksUI(file: FileMeta, data: FileDiffResponse, card: DiffCardElement) {
    const total = data.hunk_count || 0;
    const rendered = data.rendered_hunk_count || 0;
    const remaining = total - rendered;
    if (remaining <= 0) return;

    const old = card.querySelector('.gdp-show-full-wrap');
    if (old) old.remove();

    const wrap = document.createElement('div');
    wrap.className = 'gdp-show-full-wrap';

    const step = Math.min(10, remaining);
    const moreBtn = document.createElement('button');
    moreBtn.className = 'gdp-show-full';
    moreBtn.textContent = 'Show next ' + step + ' hunk' + (step===1?'':'s');
    moreBtn.addEventListener('click', () => loadMore(rendered + step, false));

    const allBtn = document.createElement('button');
    allBtn.className = 'gdp-show-full secondary';
    allBtn.textContent = 'Show all (' + remaining + ' remaining)';
    allBtn.addEventListener('click', () => loadMore(total, true));

    const note = document.createElement('span');
    note.className = 'gdp-hunk-note';
    note.textContent = rendered + ' / ' + total + ' hunks shown';

    wrap.appendChild(note);
    wrap.appendChild(moreBtn);
    wrap.appendChild(allBtn);
    card.appendChild(wrap);

    function loadMore(count: number, full: boolean) {
      moreBtn.disabled = allBtn.disabled = true;
      moreBtn.textContent = 'Loading…';
      const myGen = SERVER_GENERATION;
      const url = full ? file.load_url : buildPreviewUrl(file, count);
      trackLoad<FileDiffResponse>(fetch(url).then(r => r.json())).then(next => {
        if (myGen !== SERVER_GENERATION) {
          moreBtn.textContent = 'Data changed — reload';
          moreBtn.disabled = allBtn.disabled = false;
          return;
        }
        wrap.remove();
        card._diffData = next;
        mountDiff(card, file, next);
        if (next.truncated || (next.mode === 'preview' && next.hunk_count > next.rendered_hunk_count)) {
          addExpandHunksUI(file, next, card);
        }
      }).catch(() => {
        moreBtn.disabled = allBtn.disabled = false;
        moreBtn.textContent = 'Failed — retry';
      });
    }
  }

  // ---- Idle highlight ----
  // For files where initial highlight was off (size_class != small) we still
  // run highlight.js, but chunked over requestIdleCallback so it never blocks
  // the main thread. Huge files are skipped entirely.
  function inferLang(path: string): string | null {
    const name = sourceFileName(path);
    const fileLang = FILENAME_TO_LANG[name];
    if (fileLang) return fileLang;
    if (isDockerfileName(name)) return 'dockerfile';
    if (isMakefileName(name)) return 'makefile';
    const m = path.match(/\.([^.]+)$/);
    if (!m) return null;
    return EXT_TO_LANG[m[1].toLowerCase()] || null;
  }
  // Highlight only the rows freshly inserted by hunk expand. Synchronous —
  // the inserted batch is small (≤ STEP), so this is cheap.
  function highlightInsertedSpans(card: Element, file: FileMeta) {
    if (file.size_class === 'huge') return;
    if (!STATE.syntaxHighlight) return;
    const hljsRef = getHljs();
    if (!hljsRef || !hljsRef.highlight) return;
    const lang = inferLang(file.path);
    if (!lang || !hljsRef.getLanguage || !hljsRef.getLanguage(lang)) return;
    const spans = card.querySelectorAll<HTMLElement>(
      'tr.gdp-inserted-ctx .d2h-code-line-ctn:not([data-gdp-hl])');
    spans.forEach(s => {
      s.dataset.gdpHl = '1';
      const text = s.textContent || '';
      if (text.length === 0) return;
      try {
        s.innerHTML = hljsRef.highlight(text, { language: lang, ignoreIllegals: true }).value;
        if (!s.classList.contains('hljs')) s.classList.add('hljs');
      } catch (_) { /* swallow */ }
    });
  }

  function scheduleIdleHighlight(card: DiffCardElement, file: FileMeta) {
    if (file.highlight) return;             // already highlighted at render time
    if (file.size_class === 'huge') return; // skip
    if (!STATE.syntaxHighlight) return;
    if (!('requestIdleCallback' in window)) return;
    const hljsRef = getHljs();
    if (!hljsRef || !hljsRef.highlight) return;
    const lang = inferLang(file.path);
    if (!lang || !hljsRef.getLanguage || !hljsRef.getLanguage(lang)) return;

    const work = (deadline: IdleDeadline) => {
      const spans = card.querySelectorAll<HTMLElement>('.d2h-code-line-ctn:not([data-gdp-hl])');
      let i = 0;
      while (i < spans.length && deadline.timeRemaining() > 4) {
        const s = spans[i++];
        s.dataset.gdpHl = '1';
        const text = s.textContent || '';
        if (text.length === 0) continue;
        try {
          s.innerHTML = hljsRef.highlight(text, { language: lang, ignoreIllegals: true }).value;
          if (!s.classList.contains('hljs')) s.classList.add('hljs');
        } catch (_) { /* swallow */ }
      }
      if (i < spans.length) requestIdleCallback(work, { timeout: 1500 });
    };
    requestIdleCallback(work, { timeout: 2000 });
  }

  // Per-card horizontal sync (same as old syncSideScroll, scoped to one card)
  function syncSideScrollCard(card: Element) {
    card.querySelectorAll('.d2h-files-diff').forEach(group => {
      const sides = group.querySelectorAll<HTMLElement>('.d2h-code-wrapper');
      if (sides.length !== 2) return;
      const [a, b] = sides;
      let syncing = false;
      const mirror = (src: HTMLElement, dst: HTMLElement) => {
        if (syncing) return;
        syncing = true;
        dst.scrollLeft = src.scrollLeft;
        requestAnimationFrame(() => { syncing = false; });
      };
      a.addEventListener('scroll', () => mirror(a, b), { passive: true });
      b.addEventListener('scroll', () => mirror(b, a), { passive: true });
    });
  }

  // ---- media (image / video) embedding for binary file diffs ----
  const MEDIA_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico|mp4|webm|mov)(\?.*)?$/i;
  const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(\?.*)?$/i;
  const VIDEO_RE = /\.(mp4|webm|mov)$/i;
  function isMedia(p: string): boolean { return MEDIA_RE.test(p); }
  function isImage(p: string): boolean { return IMAGE_RE.test(p); }
  function isVideo(p: string): boolean { return VIDEO_RE.test(p); }
  function fileURL(path: string, ref: string): string {
    return '/_file?path=' + encodeURIComponent(path) + '&ref=' + ref;
  }
  function mediaTag(path: string, ref: string): string {
    const url = fileURL(path, ref);
    if (isVideo(path)) {
      return '<video src="' + url + '" controls preload="metadata"></video>';
    }
    return '<img src="' + url + '" alt="" loading="lazy">';
  }

  // Per-card media enhancer (replaces the global walk; only touches this card)
  function enhanceMediaCard(file: FileMeta, card: Element) {
    const path = file.path;
    if (!file.media_kind && !isMedia(path)) return;
    const wrapper = card.querySelector('.d2h-file-wrapper');
    if (!wrapper) return;
    const body = wrapper.querySelector('.d2h-files-diff') || wrapper.querySelector('.d2h-file-diff');
    if (!body) return;
    const container = document.createElement('div');
    container.className = 'gdp-media';
    let leftHTML, rightHTML;
    if (file.status === 'A') {
      leftHTML  = '<div class="media-empty">Not in HEAD</div>';
      rightHTML = mediaTag(path, 'worktree');
    } else if (file.status === 'D') {
      leftHTML  = mediaTag(path, 'HEAD');
      rightHTML = '<div class="media-empty">Deleted</div>';
    } else {
      leftHTML  = mediaTag(path, 'HEAD');
      rightHTML = mediaTag(path, 'worktree');
    }
    container.innerHTML =
      '<div class="media-side"><div class="media-label del">Before</div>' + leftHTML + '</div>' +
      '<div class="media-side"><div class="media-label add">After</div>' + rightHTML + '</div>';
    body.replaceWith(container);
  }

  // Scrollspy: pick the file whose wrapper contains a scan line just below
  // the fixed topbar. Avoids IntersectionObserver weirdness with sticky headers.
  function setupScrollSpy() {
    const handler: ScrollSpyHandler = () => {
      if (handler._raf) return;
      if (performance.now() < SUPPRESS_SPY_UNTIL) return;
      handler._raf = requestAnimationFrame(() => {
        handler._raf = null;
        if (performance.now() < SUPPRESS_SPY_UNTIL) return;
        const topbarH = parseInt(getComputedStyle(document.documentElement)
                                   .getPropertyValue('--topbar-h')) || 56;
        // Note: spy now targets .gdp-file-shell (placeholder + loaded both expose
        // data-path), instead of .d2h-file-wrapper which only exists post-render.
        const scanY = topbarH + 24;
        const cards = document.querySelectorAll<HTMLElement>('.gdp-file-shell');
        for (const w of cards) {
          const r = w.getBoundingClientRect();
          if (r.top <= scanY && r.bottom > scanY) {
            const text = w.dataset.path || '';
            let best: string | null = null, bestLen = 0;
            STATE.files.forEach(f => {
              if ((text === f.path || text.endsWith(f.path)) && f.path.length > bestLen) {
                best = f.path; bestLen = f.path.length;
              }
            });
            if (best) {
              markActive(best);
              // Auto-scroll sidebar so the active item stays visible — but
              // only when the user is NOT currently interacting with the
              // sidebar. Otherwise lazy-render of huge diffs (40k+ lines)
              // fires window scroll, the spy yanks `li` into view, and
              // the user's manual sidebar scroll position is lost.
              const recentlyTouched = (performance.now() -
                (window.__gdpSidebarTouchedAt || 0)) < 1500;
              if (!recentlyTouched) {
                const li = document.querySelector<HTMLElement>('#filelist li[data-path="' + CSS.escape(best) + '"]');
                if (li) {
                  const sb = document.querySelector<HTMLElement>('#sidebar');
                  if (!sb) return;
                  const lr = li.getBoundingClientRect();
                  const sr = sb.getBoundingClientRect();
                  if (lr.top < sr.top + 40 || lr.bottom > sr.bottom - 40) {
                    li.scrollIntoView({ block: 'nearest' });
                  }
                }
              }
            }
            return;
          }
        }
      });
    };
    // Remove previous listeners (avoid duplicates after re-render)
    if (window.__gdpScrollSpy) window.removeEventListener('scroll', window.__gdpScrollSpy);
    window.__gdpScrollSpy = handler;
    window.addEventListener('scroll', handler, { passive: true });
    handler(new Event('scroll'));
  }

  function collapseAll(force?: boolean) {
    STATE.collapsed = (typeof force === 'boolean') ? force : !STATE.collapsed;
    document.querySelectorAll<HTMLElement>('.gdp-file-shell.loaded .d2h-file-wrapper').forEach(w => {
      const body = w.querySelector<HTMLElement>('.d2h-files-diff, .d2h-file-diff');
      if (body) body.style.display = STATE.collapsed ? 'none' : '';
    });
  }

  // ----- wiring -----
  setSidebarTreeActionIcons();
  // Sidebar view toggle (tree / flat)
  $$('.sb-view-seg button').forEach(b => {
    b.addEventListener('click', () => {
      STATE.sbView = (b.dataset.view as SidebarView) || 'tree';
      localStorage.setItem('gdp:sbview', STATE.sbView);
      if (STATE.files && STATE.files.length) renderSidebar(STATE.files);
    });
  });
  $('#sb-expand-all').addEventListener('click', () => setAllSidebarDirsCollapsed(false));
  $('#sb-collapse-all').addEventListener('click', () => setAllSidebarDirsCollapsed(true));
  prepareKeyboardPanels();
  document.querySelector<HTMLElement>('#content')?.addEventListener('mousedown', () => {
    focusMainPanel();
  });

  // Sidebar resizer (drag right edge)
  function applySidebarWidth(w: number) {
    const cw = Math.max(180, Math.min(900, w));
    document.documentElement.style.setProperty('--sidebar-w', cw + 'px');
    STATE.sbWidth = cw;
    localStorage.setItem('gdp:sbwidth', String(cw));
  }
  applySidebarWidth(STATE.sbWidth);
  // Track sidebar touch / wheel / scroll so the scrollSpy auto-scroll
  // doesn't fight against an active manual scroll. window.__gdpSidebarTouchedAt
  // is read by the spy.
  (function trackSidebarInteraction() {
    const sb = document.getElementById('sidebar');
    if (!sb) return;
    const mark = () => { window.__gdpSidebarTouchedAt = performance.now(); };
    sb.addEventListener('wheel', mark, { passive: true });
    sb.addEventListener('mousedown', mark);
    sb.addEventListener('touchstart', mark, { passive: true });
    sb.addEventListener('scroll', mark, { passive: true });
  })();
  (function setupResizer() {
    const handle = $('#sidebar-resizer');
    if (!handle) return;
    // Build a transient preview line so the heavy diff content doesn't
    // reflow on every mousemove. The real width is applied once on mouseup.
    const preview = document.createElement('div');
    preview.id = 'sidebar-resize-preview';
    document.body.appendChild(preview);

    const MIN = 180, MAX = 900;
    const clamp = (w: number) => Math.max(MIN, Math.min(MAX, w));
    let dragging = false, startX = 0, startW = 0, currentW = 0;

    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      startX = e.clientX;
      startW = STATE.sbWidth;
      currentW = startW;
      document.body.classList.add('gdp-resizing');
      preview.style.display = 'block';
      preview.style.left = startW + 'px';
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      currentW = clamp(startW + (e.clientX - startX));
      preview.style.left = currentW + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      preview.style.display = 'none';
      document.body.classList.remove('gdp-resizing');
      applySidebarWidth(currentW);
    });
    // double-click to reset
    handle.addEventListener('dblclick', () => applySidebarWidth(308));
  })();

  $$('#topbar .seg button').forEach(b => {
    b.addEventListener('click', () => setLayout((b.dataset.layout as LayoutMode) || 'side-by-side'));
  });
  $('#theme').addEventListener('click', () => {
    STATE.theme = STATE.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('gdp:theme', STATE.theme);
    applyTheme();
  });
  function isSidebarRowVisible(row: HTMLElement): boolean {
    if (row.classList.contains('hidden') || row.classList.contains('hidden-by-tests')) return false;
    let parent = row.parentElement;
    while (parent && parent.id !== 'filelist') {
      if (parent.classList.contains('tree-children')) {
        const dir = parent.previousElementSibling;
        if (dir?.classList.contains('collapsed') || dir?.classList.contains('hidden')) return false;
      }
      parent = parent.parentElement;
    }
    return true;
  }
  function visibleSidebarItems() {
    return $$<HTMLElement>('#filelist li[data-path], #filelist .tree-dir[data-dirpath]')
      .filter(isSidebarRowVisible);
  }
  function scrollSidebarItemIntoView(item: HTMLElement, block: 'nearest' | 'start' | 'end' = 'nearest') {
    const sidebar = document.querySelector<HTMLElement>('#sidebar');
    if (!sidebar) {
      item.scrollIntoView({ block });
      return;
    }
    const sidebarRect = sidebar.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const stickyBottom = (document.querySelector<HTMLElement>('.sb-filter-wrap')?.getBoundingClientRect().bottom || sidebarRect.top);
    const topPadding = Math.max(8, stickyBottom - sidebarRect.top + 8);
    const bottomPadding = 14;
    const visibleTop = sidebarRect.top + topPadding;
    const visibleBottom = sidebarRect.bottom - bottomPadding;
    if (block === 'start') {
      sidebar.scrollTop += itemRect.top - visibleTop;
      return;
    }
    if (block === 'end') {
      sidebar.scrollTop += itemRect.bottom - visibleBottom;
      return;
    }
    if (itemRect.top < visibleTop) sidebar.scrollTop += itemRect.top - visibleTop;
    else if (itemRect.bottom > visibleBottom) sidebar.scrollTop += itemRect.bottom - visibleBottom;
  }
  function isRepositorySidebarMode() {
    return document.body.classList.contains('gdp-repo-page') ||
      document.body.classList.contains('gdp-repo-blob-page');
  }
  function moveActiveSidebarItem(direction: 1 | -1) {
    const items = visibleSidebarItems();
    if (!items.length) return;
    const current = items.findIndex(li => li.classList.contains('active'));
    const idx = nextVisibleFileIndex(current, items.length, direction);
    const target = items[idx];
    if (!target) return;
    const path = target.dataset.path || target.dataset.dirpath;
    if (path) markActive(path);
    scrollSidebarItemIntoView(target);
    if (target.dataset.path) prefetchByPath(target.dataset.path);
  }
  function moveActiveSidebarPage(direction: 1 | -1) {
    const items = visibleSidebarItems();
    if (!items.length) return;
    const repoSidebar = isRepositorySidebarMode();
    const sidebar = document.querySelector<HTMLElement>('#sidebar');
    const sample = items.find(item => item.getBoundingClientRect().height > 0);
    const rowHeight = sample ? sample.getBoundingClientRect().height : 28;
    const halfPageRows = Math.max(1, Math.floor(((sidebar?.clientHeight || window.innerHeight) / 2) / rowHeight));
    const current = items.findIndex(li => li.classList.contains('active'));
    const start = current < 0 ? 0 : current;
    const idx = Math.max(0, Math.min(items.length - 1, start + direction * halfPageRows));
    const target = items[idx];
    const path = target.dataset.path || target.dataset.dirpath;
    if (!repoSidebar && target.dataset.path) target.click();
    else if (path) markActive(path);
    scrollSidebarItemIntoView(target);
    if (target.dataset.path) prefetchByPath(target.dataset.path);
  }
  function moveActiveSidebarToEdge(edge: 'top' | 'bottom') {
    const items = visibleSidebarItems();
    const repoSidebar = isRepositorySidebarMode();
    const target = edge === 'top' ? items[0] : items[items.length - 1];
    if (!target) return;
    const path = target.dataset.path || target.dataset.dirpath;
    if (!repoSidebar && target.dataset.path) target.click();
    else if (path) markActive(path);
    scrollSidebarItemIntoView(target, edge === 'top' ? 'start' : 'end');
    if (target.dataset.path) prefetchByPath(target.dataset.path);
  }
  function setActiveSidebarDirectoryCollapsed(collapsed: boolean) {
    const active = document.querySelector<HTMLElement>('#filelist .tree-dir.active[data-dirpath]');
    if (!active) return;
    if (active.classList.contains('collapsed') === collapsed) return;
    const control = active.querySelector<HTMLElement>('.chev');
    if (control) control.click();
  }
  function toggleActiveSidebarDirectoryCollapsed() {
    const active = document.querySelector<HTMLElement>('#filelist .tree-dir.active[data-dirpath]');
    if (!active) return;
    const control = active.querySelector<HTMLElement>('.chev');
    if (control) control.click();
  }
  function openActiveSidebarItem() {
    const active = document.querySelector<HTMLElement>('#filelist li.active[data-path], #filelist .tree-dir.active[data-dirpath]');
    if (active && isSidebarRowVisible(active)) active.click();
  }
  function jumpToActiveOrFirstFilteredItem() {
    const items = visibleSidebarItems();
    const active = items.find(li => li.classList.contains('active'));
    const target = active || items[0];
    if (target) {
      target.click();
      $<HTMLInputElement>('#sb-filter').blur();
    }
  }
  const sbFilter = $<HTMLInputElement>('#sb-filter');
  if (sbFilter) {
    sbFilter.addEventListener('input', () => applyFilter());
    sbFilter.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        jumpToActiveOrFirstFilteredItem();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        moveActiveSidebarItem(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'Escape') {
        if (sbFilter.value) {
          sbFilter.value = '';
          applyFilter();
        } else {
          sbFilter.blur();
        }
      }
    });
  }
  function focusFileFilter() {
    const input = $<HTMLInputElement>('#sb-filter');
    input.focus();
    input.select();
  }

  type PaletteMode = 'file' | 'grep';
  type PaletteFileItem = { kind: 'file'; path: string; old_path?: string; displayPath: string; ref: string; targetPath?: string; targetRef?: string; source: 'diff' | 'repo'; ranges: FuzzyRange[] };
  type PaletteGrepItem = { kind: 'grep'; path: string; line: number; column: number; preview: string; ref: string; source: 'diff' | 'repo' };
  type PaletteItem = PaletteFileItem | PaletteGrepItem;
  type PaletteState = {
    root: HTMLElement;
    input: HTMLInputElement;
    controls: HTMLElement;
    list: HTMLElement;
    status: HTMLElement;
    mode: PaletteMode;
    grepRegex: boolean;
    selected: number;
    items: PaletteItem[];
    composing: boolean;
    controller?: AbortController;
    debounce?: number;
    diffSnapshot: FileMeta[];
    previousFocusScope: PanelFocusScope | null;
  };
  let PALETTE: PaletteState | null = null;
  const REPO_FILE_CACHE = new Map<string, FileSearchListResponse>();

  function paletteSource(): 'diff' | 'repo' {
    if (STATE.route.screen === 'diff') return 'diff';
    if (STATE.route.screen === 'file' && STATE.route.view !== 'blob') return 'diff';
    return 'repo';
  }

  function paletteRef(source: 'diff' | 'repo'): string {
    if (source === 'diff') return (STATE.to && STATE.to !== 'worktree') ? STATE.to : 'worktree';
    if (STATE.route.screen === 'repo') return STATE.route.ref || 'worktree';
    if (STATE.route.screen === 'file') return STATE.route.ref || 'worktree';
    return STATE.repoRef || 'worktree';
  }

  function closeSearchPalette() {
    if (!PALETTE) return;
    const previousFocusScope = PALETTE.previousFocusScope;
    PALETTE.controller?.abort();
    if (PALETTE.debounce) window.clearTimeout(PALETTE.debounce);
    PALETTE.root.remove();
    PALETTE = null;
    setPanelFocusScope(previousFocusScope);
  }

  function createPalette(mode: PaletteMode): PaletteState {
    const previousFocusScope = PALETTE ? PALETTE.previousFocusScope : getPanelFocusScope();
    closeSearchPalette();
    const root = document.createElement('div');
    root.className = 'gdp-palette-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'gdp-palette';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const label = document.createElement('div');
    label.className = 'gdp-palette-label';
    label.textContent = mode === 'file' ? 'Files' : 'Grep';
    const input = document.createElement('input');
    input.className = 'gdp-palette-input';
    input.type = 'search';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = mode === 'file' ? 'Search files' : 'Search text';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', 'gdp-palette-list');
    const status = document.createElement('div');
    status.className = 'gdp-palette-status';
    const controls = document.createElement('div');
    controls.className = 'gdp-palette-controls';
    const list = document.createElement('div');
    list.id = 'gdp-palette-list';
    list.className = 'gdp-palette-list';
    list.setAttribute('role', 'listbox');
    dialog.append(label, input, controls, status, list);
    root.appendChild(dialog);
    document.body.appendChild(root);
    const state: PaletteState = {
      root,
      input,
      controls,
      list,
      status,
      mode,
      grepRegex: false,
      selected: -1,
      items: [],
      composing: false,
      diffSnapshot: [...STATE.files],
      previousFocusScope,
    };
    PALETTE = state;
    setPanelFocusScope(null);
    root.addEventListener('mousedown', e => {
      if (e.target === root) closeSearchPalette();
    });
    input.addEventListener('compositionstart', () => { state.composing = true; });
    input.addEventListener('compositionend', () => { state.composing = false; });
    input.addEventListener('input', () => updatePaletteResults(state));
    input.addEventListener('keydown', e => handlePaletteKeydown(e, state));
    input.focus();
    updatePaletteResults(state);
    return state;
  }

  function renderPaletteControls(state: PaletteState) {
    state.controls.innerHTML = '';
    if (state.mode === 'file') {
      const hint = document.createElement('span');
      hint.className = 'gdp-palette-mode-hint';
      hint.textContent = isGlobPathQuery(state.input.value) ? 'Glob: * ? []' : 'Fuzzy path search';
      state.controls.appendChild(hint);
      return;
    }
    const plain = document.createElement('button');
    plain.type = 'button';
    plain.className = 'gdp-palette-mode-button';
    plain.setAttribute('aria-pressed', String(!state.grepRegex));
    plain.textContent = 'Plain';
    plain.addEventListener('mousedown', e => {
      e.preventDefault();
      state.grepRegex = false;
      renderPaletteControls(state);
      updatePaletteResults(state);
      state.input.focus();
    });
    const regex = document.createElement('button');
    regex.type = 'button';
    regex.className = 'gdp-palette-mode-button';
    regex.setAttribute('aria-pressed', String(state.grepRegex));
    regex.textContent = '.* Regex';
    regex.title = 'Alt+R';
    regex.addEventListener('mousedown', e => {
      e.preventDefault();
      state.grepRegex = true;
      renderPaletteControls(state);
      updatePaletteResults(state);
      state.input.focus();
    });
    const hint = document.createElement('span');
    hint.className = 'gdp-palette-mode-hint';
    hint.textContent = 'Alt+R toggles regex';
    state.controls.append(plain, regex, hint);
  }

  function regexQueryIsValid(query: string): boolean {
    try {
      new RegExp(query);
      return true;
    } catch {
      return false;
    }
  }

  function appendHighlightedPath(parent: HTMLElement, path: string, ranges: FuzzyRange[]) {
    let cursor = 0;
    for (const range of ranges) {
      if (range.start > cursor) parent.appendChild(document.createTextNode(path.slice(cursor, range.start)));
      const mark = document.createElement('mark');
      mark.textContent = path.slice(range.start, range.end);
      parent.appendChild(mark);
      cursor = range.end;
    }
    if (cursor < path.length) parent.appendChild(document.createTextNode(path.slice(cursor)));
  }

  function renderPalette(state: PaletteState) {
    state.list.innerHTML = '';
    state.items.forEach((item, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.id = 'gdp-palette-item-' + index;
      row.className = 'gdp-palette-row';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', index === state.selected ? 'true' : 'false');
      const title = document.createElement('span');
      title.className = 'gdp-palette-row-title';
      const detail = document.createElement('span');
      detail.className = 'gdp-palette-row-detail';
      if (item.kind === 'file') {
        title.textContent = item.path.split('/').pop() || item.path;
        appendHighlightedPath(detail, item.displayPath, item.ranges);
        if (item.old_path && item.displayPath !== item.old_path) {
          detail.appendChild(document.createTextNode('  ' + item.old_path));
        }
      } else {
        title.textContent = item.path + ':' + item.line;
        detail.textContent = item.preview;
      }
      row.append(title, detail);
      row.addEventListener('mouseenter', () => {
        state.selected = index;
        syncPaletteSelection(state);
      });
      row.addEventListener('mousedown', e => {
        e.preventDefault();
        state.selected = index;
        selectPaletteItem(state);
      });
      state.list.appendChild(row);
    });
    syncPaletteSelection(state);
  }

  function syncPaletteSelection(state: PaletteState) {
    state.input.setAttribute('aria-activedescendant', state.selected >= 0 ? 'gdp-palette-item-' + state.selected : '');
    state.list.querySelectorAll<HTMLElement>('.gdp-palette-row').forEach((row, index) => {
      row.setAttribute('aria-selected', index === state.selected ? 'true' : 'false');
      if (index === state.selected) row.scrollIntoView({ block: 'nearest' });
    });
  }

  async function repoPaletteFiles(ref: string): Promise<FileSearchListResponse> {
    const cached = REPO_FILE_CACHE.get(ref);
    if (cached && cached.generation === SERVER_GENERATION) return cached;
    const params = new URLSearchParams();
    params.set('ref', ref);
    const res = await trackLoad<FileSearchListResponse>(fetch('/_files?' + params.toString()).then(r => {
      if (!r.ok) throw new Error('failed to load files');
      return r.json();
    }));
    REPO_FILE_CACHE.set(ref, res);
    return res;
  }

  function diffFilePaletteItems(state: PaletteState, query: string): PaletteFileItem[] {
    const matchPath = isGlobPathQuery(query) ? globMatchPath : fuzzyMatchPath;
    const candidates = state.diffSnapshot
      .map(file => {
        const current = matchPath(query, file.path);
        const old = file.old_path ? matchPath(query, file.old_path) : null;
        const best = old && (!current || old.score > current.score)
          ? { match: old, displayPath: file.old_path || file.path }
          : current
            ? { match: current, displayPath: file.path }
            : null;
        return best ? { file, ...best } : null;
      })
      .filter((item): item is { file: FileMeta; match: { score: number; ranges: FuzzyRange[] }; displayPath: string } => item !== null)
      .sort((a, b) => b.match.score - a.match.score || a.file.path.localeCompare(b.file.path));
    return limitPaletteResults(candidates).map(candidate => ({
      kind: 'file',
      path: candidate.file.path,
      old_path: candidate.file.old_path,
      displayPath: candidate.displayPath,
      ref: paletteRef('diff'),
      targetPath: fileSourceTarget(candidate.file).path,
      targetRef: fileSourceTarget(candidate.file).ref,
      source: 'diff',
      ranges: candidate.match.ranges,
    }));
  }

  async function updateFilePalette(state: PaletteState, query: string) {
    renderPaletteControls(state);
    const source = paletteSource();
    if (!query.trim()) {
      const base = source === 'diff'
        ? state.diffSnapshot.map(file => {
          const target = fileSourceTarget(file);
          return { kind: 'file' as const, path: file.path, old_path: file.old_path, displayPath: file.path, ref: paletteRef(source), targetPath: target.path, targetRef: target.ref, source, ranges: [] };
        })
        : [];
      state.items = limitPaletteResults(base);
      state.selected = state.items.length ? 0 : -1;
      state.status.textContent = source === 'diff' ? state.diffSnapshot.length + ' diff files' : 'Type to search repository files';
      renderPalette(state);
      return;
    }
    if (source === 'diff') {
      state.items = diffFilePaletteItems(state, query);
    } else {
      state.status.textContent = 'Loading files...';
      const ref = paletteRef(source);
      const response = await repoPaletteFiles(ref);
      if (PALETTE !== state || state.input.value !== query) return;
      state.items = limitPaletteResults(rankPathMatches(query, response.files)).map(match => ({
        kind: 'file',
        path: match.item.path,
        displayPath: match.item.path,
        ref,
        source,
        ranges: match.ranges,
      }));
    }
    state.selected = state.items.length ? 0 : -1;
    state.status.textContent = state.items.length ? state.items.length + ' results' : 'No results';
    renderPalette(state);
  }

  function updateGrepPalette(state: PaletteState, query: string) {
    renderPaletteControls(state);
    state.controller?.abort();
    if (state.debounce) window.clearTimeout(state.debounce);
    if (!query.trim()) {
      state.items = [];
      state.selected = -1;
      state.status.textContent = 'Type to grep';
      renderPalette(state);
      return;
    }
    if (state.grepRegex && !regexQueryIsValid(query)) {
      state.controller?.abort();
      state.items = [];
      state.selected = -1;
      state.status.textContent = 'Invalid regular expression';
      renderPalette(state);
      return;
    }
    state.status.textContent = 'Searching...';
    state.debounce = window.setTimeout(() => {
      const source = paletteSource();
      const ref = paletteRef(source);
      const params = new URLSearchParams();
      params.set('ref', ref);
      params.set('q', query);
      params.set('max', '200');
      if (state.grepRegex) params.set('regex', '1');
      if (source === 'diff') {
        for (const file of state.diffSnapshot) params.append('path', file.path);
      }
      const controller = new AbortController();
      state.controller = controller;
      trackLoad<GrepResponse>(fetch('/_grep?' + params.toString(), { signal: controller.signal }).then(r => {
        if (!r.ok) throw new Error('grep failed');
        return r.json();
      })).then(response => {
        if (PALETTE !== state || controller.signal.aborted) return;
        state.items = limitPaletteResults(response.matches.map(match => ({
          kind: 'grep' as const,
          path: match.path,
          line: match.line,
          column: match.column,
          preview: match.preview,
          ref,
          source,
        })));
        state.selected = state.items.length ? 0 : -1;
        state.status.textContent = response.engine + (state.grepRegex ? ' regex' : ' plain') + (response.truncated ? ' truncated' : '') + ' - ' + state.items.length + ' results';
        renderPalette(state);
      }).catch(err => {
        if (isAbortError(err)) return;
        state.status.textContent = 'Search failed';
      });
    }, 80);
  }

  function updatePaletteResults(state: PaletteState) {
    const query = state.input.value;
    if (state.mode === 'file') {
      updateFilePalette(state, query).catch(() => {
        state.status.textContent = 'Search failed';
      });
    } else {
      updateGrepPalette(state, query);
    }
  }

  function selectPaletteItem(state: PaletteState) {
    const item = state.items[state.selected];
    if (!item) return;
    closeSearchPalette();
    if (item.kind === 'file') {
      if (item.source === 'diff') {
        if (STATE.route.screen === 'file') {
          setRoute({ screen: 'file', path: item.targetPath || item.path, ref: item.targetRef || item.ref, range: currentRange() });
          applySourceRouteToShell();
        } else {
          scrollToFile(item.path);
        }
      } else {
        setRoute({ screen: 'file', path: item.path, ref: item.ref, view: 'blob', range: currentRange() });
        renderStandaloneSource({ path: item.path, ref: item.ref });
      }
      return;
    }
    if (item.source === 'diff') {
      setRoute({ screen: 'diff', range: currentRange(), path: item.path, line: item.line });
      scrollToFile(item.path, item.line);
    } else {
      setRoute({ screen: 'file', path: item.path, ref: item.ref, view: 'blob', line: item.line, range: currentRange() });
      renderStandaloneSource({ path: item.path, ref: item.ref });
    }
  }

  function handlePaletteKeydown(e: KeyboardEvent, state: PaletteState) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSearchPalette();
      return;
    }
    if (e.key === 'Enter') {
      if (state.composing) return;
      e.preventDefault();
      selectPaletteItem(state);
      return;
    }
    if (state.mode === 'grep' && e.altKey && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      state.grepRegex = !state.grepRegex;
      updatePaletteResults(state);
      return;
    }
    const direction = e.key === 'ArrowDown' || (e.ctrlKey && e.key.toLowerCase() === 'n')
      ? 1
      : e.key === 'ArrowUp' || (e.ctrlKey && e.key.toLowerCase() === 'p')
        ? -1
        : 0;
    if (direction) {
      e.preventDefault();
      state.selected = movePaletteSelection(state.selected, state.items.length, direction);
      syncPaletteSelection(state);
    }
  }

  function openSearchPalette(mode: PaletteMode) {
    createPalette(mode);
  }

  function dispatchKeymapAction(action: KeymapAction, scope: KeymapScope, repeated = false): boolean {
    if (action === 'open-file-palette') {
      if (PALETTE?.mode !== 'file') openSearchPalette('file');
      return true;
    }
    if (action === 'open-grep-palette') {
      if (PALETTE?.mode !== 'grep') openSearchPalette('grep');
      return true;
    }
    if (action === 'focus-file-filter') {
      focusFileFilter();
      return true;
    }
    if (action === 'focus-sidebar') {
      focusSidebarPanel();
      return true;
    }
    if (action === 'focus-main') {
      focusMainPanel();
      return true;
    }
    if (action === 'cancel-source-load') {
      return !document.querySelector('.mkdp-lightbox') && cancelActiveSourceLoad('esc');
    }
    if (action === 'open-sidebar-item') {
      if (!isRepositorySidebarMode()) return false;
      openActiveSidebarItem();
      focusMainPanel();
      return true;
    }
    if (action === 'sidebar-next' || action === 'sidebar-previous') {
      const repoSidebar = isRepositorySidebarMode();
      const items = repoSidebar ? visibleSidebarItems() : $$<HTMLElement>('#filelist li[data-path]:not(.hidden):not(.hidden-by-tests)');
      if (!items.length) return true;
      let idx = items.findIndex(li => li.classList.contains('active'));
      if (idx < 0) idx = 0;
      else idx = action === 'sidebar-next' ? Math.min(items.length - 1, idx + 1) : Math.max(0, idx - 1);
      const target = items[idx];
      const path = target?.dataset.path || target?.dataset.dirpath;
      if (!repoSidebar && target) {
        target.click();
        scrollSidebarItemIntoView(target);
      } else if (path) {
        markActive(path);
        scrollSidebarItemIntoView(target);
      }
      const nextIdx = action === 'sidebar-next' ? Math.min(items.length - 1, idx + 1) : Math.max(0, idx - 1);
      const nextItem = items[nextIdx];
      if (nextItem && nextItem !== target && nextItem.dataset.path) prefetchByPath(nextItem.dataset.path);
      return true;
    }
    if (action === 'sidebar-page-down' || action === 'sidebar-page-up') {
      moveActiveSidebarPage(action === 'sidebar-page-down' ? 1 : -1);
      return true;
    }
    if (action === 'sidebar-expand') {
      if (!isRepositorySidebarMode()) return false;
      toggleActiveSidebarDirectoryCollapsed();
      return true;
    }
    if (action === 'sidebar-collapse') {
      if (!isRepositorySidebarMode()) return false;
      setActiveSidebarDirectoryCollapsed(true);
      return true;
    }
    if (action === 'scroll-main-down' || action === 'scroll-main-up') {
      scrollMainPanel(action === 'scroll-main-down' ? 1 : -1, repeated);
      return true;
    }
    if (action === 'scroll-main-page-down' || action === 'scroll-main-page-up') {
      scrollMainPanel(action === 'scroll-main-page-down' ? 1 : -1, repeated, 'page');
      return true;
    }
    if (action === 'tab-preview' || action === 'tab-code') {
      return switchSourceTab(action === 'tab-preview' ? 'preview' : 'code');
    }
    if (action === 'start-g-sequence') {
      PENDING_G_SCOPE = scope;
      PENDING_G_UNTIL = performance.now() + 900;
      return true;
    }
    if (action === 'goto-top' || action === 'goto-bottom') {
      PENDING_G_SCOPE = null;
      PENDING_G_UNTIL = 0;
      const edge = action === 'goto-top' ? 'top' : 'bottom';
      if (scope === 'main') scrollMainToEdge(edge);
      else moveActiveSidebarToEdge(edge);
      return true;
    }
    if (action === 'layout-unified') {
      setLayout('line-by-line');
      return true;
    }
    if (action === 'layout-split') {
      setLayout('side-by-side');
      return true;
    }
    if (action === 'toggle-theme') {
      $('#theme').click();
      return true;
    }
    return false;
  }

  document.addEventListener('keydown', e => {
    const targetEl = e.target as Element | null;
    const scope = keymapScope(targetEl);
    const action = resolveKeymapAction(e, {
      scope,
      editable: isEditableKeyTarget(targetEl),
      composing: e.isComposing,
      paletteOpen: !!PALETTE,
      pendingG: PENDING_G_SCOPE === scope && performance.now() <= PENDING_G_UNTIL,
    });
    if (!action) return;
    if (action !== 'start-g-sequence' && action !== 'goto-top') {
      PENDING_G_SCOPE = null;
      PENDING_G_UNTIL = 0;
    }
    if (dispatchKeymapAction(action, scope, e.repeat)) e.preventDefault();
  });

  // ----- initial state + live updates -----
  applyTheme();
  setLayout(STATE.layout);
  setPageMode();
  if (window.location.pathname === '/') {
    setRoute(STATE.route, true);
  }

  function loadRepo(): Promise<void> {
    if (STATE.route.screen !== 'repo') return Promise.resolve();
    setStatus('refreshing');
    const params = new URLSearchParams();
    params.set('ref', STATE.route.ref || 'worktree');
    if (STATE.route.path) params.set('path', STATE.route.path);
    return trackLoad<RepoTreeResponse>(fetch('/_tree?' + params.toString()).then(r => {
      if (!r.ok) throw new Error('failed to load repository tree');
      return r.json();
    })).then(async data => {
      await renderRepo(data);
      setStatus('live');
      syncHeaderMenu();
    }).catch(() => setStatus('error'));
  }

  function load(options: { force?: boolean } = {}): Promise<void> {
    if (STATE.route.screen === 'help') {
      setStatus('live');
      renderHelpPage();
      syncHeaderMenu();
      return Promise.resolve();
    }
    if (STATE.route.screen === 'repo') return loadRepo();
    setStatus('refreshing');
    const params = new URLSearchParams();
    if (STATE.ignoreWs) params.set('ignore_ws', '1');
    if (STATE.from) params.set('from', STATE.from);
    if (STATE.to)   params.set('to',   STATE.to);
    if (options.force) params.set('nocache', '1');
    const url = '/diff.json' + (params.toString() ? '?' + params.toString() : '');
    return trackLoad<DiffMeta>(fetch(url).then(r => r.json())).then(data => {
      renderShell(data);
      setStatus('live');
    }).catch(() => setStatus('error'));
  }
  if (STATE.route.screen === 'help') {
    setStatus('live');
    renderHelpPage();
  } else if (STATE.route.screen === 'repo') loadRepo();
  else if (STATE.route.screen === 'file' && STATE.route.view === 'blob') {
    setStatus('live');
    applySourceRouteToShell();
  } else load();

  // Ref picker (from / to)
  function syncRefInputs() {
    const fi = $<HTMLInputElement>('#ref-from'), ti = $<HTMLInputElement>('#ref-to');
    if (fi) fi.value = STATE.from;
    if (ti) ti.value = STATE.to;
  }
  function setRange(from: string, to: string) {
    STATE.from = from || '';
    STATE.to   = to   || '';
    localStorage.setItem('gdp:from', STATE.from);
    localStorage.setItem('gdp:to',   STATE.to);
    syncRefInputs();
    const range = currentRange();
    if (STATE.route.screen === 'file') {
      setRoute({ screen: 'file', path: STATE.route.path, ref: STATE.route.ref, range }, true);
    } else if (STATE.route.screen === 'help') {
      setRoute({ screen: 'help', lang: helpLanguageFromRoute(), section: helpSectionFromRoute(), range }, true);
      renderHelpPage();
    } else {
      setRoute({ screen: 'diff', range }, true);
      load();
    }
  }
  syncRefInputs();
  syncHeaderMenu();

  // ---- Ref picker popover ----
  const REFS: Required<RefResponse> = { branches: [], tags: [], commits: [], current: '' };
  const popover = $<HTMLElement>('#ref-popover');
  const popBody = popover.querySelector<HTMLElement>('.rp-body')!;
  const popSearch = popover.querySelector<HTMLInputElement>('.rp-search')!;
  let popTarget: HTMLInputElement | null = null;  // which input opened the popover

  function fetchRefs() {
    return fetch('/_refs').then(r => r.json()).then((refs: RefResponse) => {
      Object.assign(REFS, refs);
    }).catch(() => {});
  }
  fetchRefs();

  let popTab = 'commits';
  function buildPopBody(query: string) {
    const q = (query || '').toLowerCase().trim();
    const m = (s: string) => !q || String(s).toLowerCase().includes(q);
    const html: string[] = [];
    if (popTab === 'commits') {
      const commits = (REFS.commits || []).filter(c => m(c));
      if (!commits.length) { html.push('<div class="rp-empty">no commits</div>'); }
      for (const c of commits) {
        const [sha, subject, author, when] = c.split('\t');
        if (!sha) continue;
        html.push(
          '<div class="rp-item-commit" data-val="' + escapeAttr(sha) + '">' +
            '<div class="row1">' +
              '<span class="sha">' + escapeHtml(sha) + '</span>' +
              '<span class="subject" title="' + escapeAttr(subject || '') + '">' + escapeHtml(subject || '') + '</span>' +
            '</div>' +
            '<div class="row2">' +
              '<span class="author">' + escapeHtml(author || '') + '</span>' +
              '<span class="when">' + escapeHtml(when || '') + '</span>' +
            '</div>' +
          '</div>'
        );
      }
    } else if (popTab === 'branches') {
      const branches = (REFS.branches || []).filter(m);
      if (!branches.length) { html.push('<div class="rp-empty">no branches</div>'); }
      for (const b of branches) {
        const cur = (b === REFS.current);
        html.push(
          '<div class="rp-item-ref" data-val="' + escapeAttr(b) + '">' +
            '<span class="name">' + escapeHtml(b) + '</span>' +
            (cur ? '<span class="badge cur">current</span>' : '<span class="badge">branch</span>') +
          '</div>'
        );
      }
    } else if (popTab === 'tags') {
      const tags = (REFS.tags || []).filter(m);
      if (!tags.length) { html.push('<div class="rp-empty">no tags</div>'); }
      for (const t of tags) {
        html.push(
          '<div class="rp-item-ref" data-val="' + escapeAttr(t) + '">' +
            '<span class="name">' + escapeHtml(t) + '</span>' +
            '<span class="badge">tag</span>' +
          '</div>'
        );
      }
    }
    popBody.innerHTML = html.join('');
    highlightCurrentInPopover();
  }

  // Mark the item matching the focused input's current value, so the user
  // sees what's currently selected when re-opening the picker.
  function highlightCurrentInPopover() {
    if (!popTarget) return;
    const cur = (popTarget.value || '').trim();
    if (!cur) return;
    const items = popBody.querySelectorAll<HTMLElement>('[data-val]');
    let match: HTMLElement | null = null;
    items.forEach(it => {
      if (it.dataset.val === cur) match = it;
    });
    if (match) {
      match.classList.add('current');
      // Bring into view inside the popover only (not the page scroll)
      const ph = popBody;
      const r = match.getBoundingClientRect();
      const pr = ph.getBoundingClientRect();
      if (r.top < pr.top || r.bottom > pr.bottom) {
        ph.scrollTop = match.offsetTop - ph.clientHeight / 2;
      }
    }
  }
  function escapeAttr(s: unknown): string {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  function openPopover(input: HTMLInputElement) {
    popTarget = input;
    popSearch.value = '';
    buildPopBody('');
    // Reflect the input's current value on the quick chips
    const cur = (input.value || '').trim();
    popover.querySelectorAll<HTMLElement>('.rp-chip').forEach(c => {
      c.classList.toggle('current', c.dataset.val === cur);
    });
    popover.hidden = false;
    const r = input.getBoundingClientRect();
    const popWidth = Math.min(560, Math.floor(window.innerWidth * 0.9));
    popover.style.left = Math.max(8, Math.min(r.left, window.innerWidth - popWidth - 8)) + 'px';
    popover.style.top = (r.bottom + 4) + 'px';
    setTimeout(() => popSearch.focus(), 0);
  }
  function closePopover() {
    popover.hidden = true;
    popTarget = null;
  }

  ['#ref-from', '#ref-to'].forEach(sel => {
    const el = $<HTMLInputElement>(sel);
    el.addEventListener('focus', () => openPopover(el));
    el.addEventListener('mousedown', (e) => {
      // Re-open if already focused but popover closed
      if (popover.hidden) {
        e.preventDefault();
        el.focus();
      }
    });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openPopover(el);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        closePopover();
      } else if (e.key === 'Escape') {
        closePopover();
        el.blur();
      }
    });
  });
  wireRepoTargetPicker($<HTMLInputElement>('#repo-target'), (ref) => {
    if (STATE.route.screen !== 'file') return;
    setRoute({ screen: 'file', path: STATE.route.path, ref, view: 'blob', range: currentRange() });
    renderStandaloneSource({ path: STATE.route.path, ref });
  });
  document.addEventListener('focusin', (e) => {
    const el = e.target as Element | null;
    if (el instanceof HTMLInputElement && (el.id === 'repo-ref' || el.id === 'repo-target')) openPopover(el);
  });

  popSearch.addEventListener('input', () => buildPopBody(popSearch.value));
  popSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closePopover(); }
    if (e.key === 'Enter') {
      // pick first visible item
      const first = popBody.querySelector<HTMLElement>('.rp-item');
      if (first) first.click();
    }
  });
  function handlePicked(val?: string) {
    if (!popTarget || !val) return;
    const pickedTarget = popTarget;
    pickedTarget.value = val;
    if (pickedTarget.id === 'repo-ref') {
      closePopover();
      pickedTarget.dispatchEvent(new Event('change'));
      return;
    }
    if (pickedTarget.id === 'repo-target') {
      closePopover();
      pickedTarget.dispatchEvent(new Event('change'));
      return;
    }
    const targetWasFrom = (pickedTarget.id === 'ref-from');
    const otherEmpty = !$<HTMLInputElement>('#ref-to').value;
    closePopover();
    setRange($<HTMLInputElement>('#ref-from').value, $<HTMLInputElement>('#ref-to').value);
    // Move focus to the other input on first selection for fast 2-step entry
    if (targetWasFrom && otherEmpty) {
      const ti = $<HTMLInputElement>('#ref-to');
      // re-focus -> reopens popover
      setTimeout(() => ti.focus(), 0);
    }
  }
  popBody.addEventListener('click', (e) => {
    const item = (e.target as Element).closest<HTMLElement>('.rp-item-commit, .rp-item-ref');
    if (!item) return;
    handlePicked(item.dataset.val);
  });

  // Tabs
  popover.querySelectorAll<HTMLElement>('.rp-tab').forEach(t => {
    t.addEventListener('click', () => {
      popTab = t.dataset.tab || 'commits';
      popover.querySelectorAll('.rp-tab').forEach(b => b.classList.toggle('active', b === t));
      buildPopBody(popSearch.value);
    });
  });

  // Quick-fill chips (worktree / HEAD / --staged)
  popover.querySelectorAll<HTMLElement>('.rp-chip').forEach(c => {
    c.addEventListener('click', () => handlePicked(c.dataset.val));
  });
  document.addEventListener('mousedown', (e) => {
    if (popover.hidden) return;
    const target = e.target as Element;
    if (popover.contains(target)) return;
    if (target.id === 'ref-from' || target.id === 'ref-to' || target.id === 'repo-ref' || target.id === 'repo-target') return;
    closePopover();
  });

  $('#ref-reset').addEventListener('click', () => setRange('HEAD', 'worktree'));
  window.addEventListener('popstate', () => {
    const parsedRoute = parseRoute(window.location.pathname, window.location.search, currentRange());
    STATE.route = parsedRoute.screen === 'unknown' ? { screen: 'diff', range: parsedRoute.range } : parsedRoute;
    STATE.from = STATE.route.range.from;
    STATE.to = STATE.route.range.to;
    if (STATE.route.screen === 'repo') STATE.repoRef = STATE.route.ref || 'worktree';
    syncRefInputs();
    syncHeaderMenu();
    if (STATE.route.screen === 'help') {
      cancelActiveSourceLoad('navigation');
      setPageMode();
      renderHelpPage();
      setStatus('live');
      return;
    }
    if (STATE.route.screen === 'repo') {
      cancelActiveSourceLoad('navigation');
      setPageMode();
      removeStandaloneSource();
      loadRepo();
      return;
    }
    if (STATE.route.screen !== 'file') {
      cancelActiveSourceLoad('navigation');
      setPageMode();
      removeStandaloneSource();
      load();
      return;
    }
    applySourceRouteToShell();
  });

  // Ignore-whitespace toggle
  function applyIgnoreWs() {
    const btn = $('#ignore-ws');
    if (btn) btn.classList.toggle('active', STATE.ignoreWs);
  }
  applyIgnoreWs();
  $('#ignore-ws').addEventListener('click', () => {
    STATE.ignoreWs = !STATE.ignoreWs;
    localStorage.setItem('gdp:ignore-ws', STATE.ignoreWs ? '1' : '0');
    applyIgnoreWs();
    load();
  });

  function setSyntaxHighlight(on: boolean) {
    STATE.syntaxHighlight = on;
    localStorage.setItem('gdp:syntax-highlight', on ? '1' : '0');
    setHighlightButton(on && getHljs() ? 'loaded' : 'idle');
    if (on) {
      loadSyntaxHighlighter().then(hljsRef => {
        if (!hljsRef) return;
        rerenderLoadedDiffs();
      });
    } else {
      rerenderLoadedDiffs();
    }
  }

  setHighlightButton(STATE.syntaxHighlight && getHljs() ? 'loaded' : 'idle');
  $('#syntax-highlight').addEventListener('click', () => {
    setSyntaxHighlight(!STATE.syntaxHighlight);
  });
  if (STATE.syntaxHighlight) setSyntaxHighlight(true);

  // Manual reload button
  // Prominent reload button (next to ref-picker)
  $('#reload-prom').addEventListener('click', () => {
    const btn = $('#reload-prom');
    btn.classList.add('spinning');
    load().finally(() => {
      setTimeout(() => btn.classList.remove('spinning'), 200);
    });
  });

  window.addEventListener('storage', (e) => {
    if (e.key === 'gdp:syntax-highlight') setSyntaxHighlight(e.newValue !== '0');
  });

  // Hide-tests toggle: ファイル名に test|spec が含まれるエントリをフィルタ。
  const TEST_RE = /(^|[/_.])(test|spec|__tests__)([/_.]|$)/i;
  function applyHideTests() {
    const btn = $('#hide-tests');
    if (btn) btn.classList.toggle('active', STATE.hideTests);
    document.querySelectorAll<HTMLElement>('.gdp-file-shell').forEach(card => {
      const isTest = TEST_RE.test(card.dataset.path || '');
      card.classList.toggle('hidden-by-tests', STATE.hideTests && isTest);
    });
    document.querySelectorAll<HTMLElement>('#filelist li[data-path]').forEach(li => {
      const isTest = TEST_RE.test(li.dataset.path || '');
      li.classList.toggle('hidden-by-tests', STATE.hideTests && isTest);
    });
    updateTreeDirVisibility();
    if (typeof applyViewedState === 'function') applyViewedState();
  }
  applyHideTests();
  $('#hide-tests').addEventListener('click', () => {
    STATE.hideTests = !STATE.hideTests;
    localStorage.setItem('gdp:hide-tests', STATE.hideTests ? '1' : '0');
    applyHideTests();
  });

  // Debounce SSE-driven reloads. Multiple BufWritePost in quick succession
  // collapse into one fetch. Scroll + active file are preserved across reload.
  let sseTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleSseLoad() {
    if (sseTimer) clearTimeout(sseTimer);
    sseTimer = setTimeout(() => {
      sseTimer = null;
      invalidateRepoSidebar();
      const savedScroll = window.scrollY;
      const savedActive = STATE.activeFile;
      load().then(() => {
        if (savedActive) {
          const card = document.querySelector<DiffCardElement>(diffCardSelector(savedActive));
          if (card) { card.scrollIntoView({ block: 'start' }); return; }
        }
        window.scrollTo(0, savedScroll);
      });
    }, 350);
  }

  const es = new EventSource('/events');
  const catchUpGate = createCatchUpGate(() => Date.now(), 1000);
  let openedOnce = false;
  es.addEventListener('update', () => scheduleSseLoad());
  es.addEventListener('reload', () => location.reload());
  es.addEventListener('error', () => setStatus('error'));
  es.addEventListener('open',  () => {
    setStatus('live');
    if (!openedOnce) { openedOnce = true; return; }
    catchUpDiff();
  });

  function catchUpDiff() {
    if (!shouldCatchUpDiff(STATE.route)) return;
    if (!catchUpGate()) return;
    void load({ force: true });
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) catchUpDiff();
  });
  window.addEventListener('focus', catchUpDiff);
})();
