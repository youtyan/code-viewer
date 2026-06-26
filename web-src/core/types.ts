import type { GdpExpandLogic } from "./expand-logic";

export type FileMeta = {
  order?: number;
  key?: string;
  path: string;
  old_path?: string;
  display_path?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  binary?: boolean;
  media_kind?: string | null;
  size_class?: string;
  force_layout?: string;
  highlight?: boolean;
  load_url: string;
  preview_url?: string | null;
  estimated_height_px?: number;
  untracked?: boolean;
  size?: number;
  created_at?: string;
  updated_at?: string;
  commit_updated_at?: string;
};

export type DiffMeta = {
  files: FileMeta[];
  totals?: {
    files: number;
    additions: number;
    deletions: number;
  };
  range?: string;
  branch?: string;
  project?: string;
  generation?: number;
};

// ai-dup-check: allow -- client response DTO is intentionally kept in core types.
export type RepoTreeEntry = {
  name: string;
  path: string;
  type: "tree" | "blob" | "commit";
  children_omitted?: true;
  children_omitted_reason?: "heavy" | "internal" | "truncated";
  size?: number;
  created_at?: string;
  updated_at?: string;
  commit_updated_at?: string;
};

export type RepoTreeResponse = {
  ref: string;
  path: string;
  project: string;
  branch?: string;
  upload_enabled?: boolean;
  entries: RepoTreeEntry[];
  readme?: {
    path: string;
    text: string;
  } | null;
};

export type SettingsResponse = {
  project: string;
  branch?: string;
  repo_web_url: string | null;
  scope: {
    omit_dirs_effective: string[];
    omit_dirs_built_in: string[];
    exclude_names_effective: string[];
    exclude_names_built_in: string[];
    max_entries: number;
  };
};

export type ViewerFontSizeSetting = "compact" | "regular" | "large" | "xlarge";

export type AppSettingsState = {
  version: 1;
  layout?: "side-by-side" | "line-by-line";
  theme?: "light" | "dark";
  language?: "en" | "ja";
  sidebarView?: "tree" | "flat";
  sidebarWidth?: number;
  historyWidth?: number;
  sidebarHidden?: boolean;
  sidebarFontSize?: ViewerFontSizeSetting;
  codeFontSize?: ViewerFontSizeSetting;
  syntaxHighlight?: boolean;
  autoUpdate?: boolean;
  queryHistoryPanelWidth?: number;
  annotationPanelOpen?: boolean;
  annotationFollow?: boolean;
  annotationMuted?: boolean;
  annotationRate?: number;
  ignoreWhitespace?: boolean;
  hideTests?: boolean;
  scopeOmitDirs?: string[];
  scopeExcludeNames?: string[];
  uploadEnabled?: boolean;
  range?: {
    from: string;
    to: string;
  };
};

export type ViewState = {
  version: 1;
  collapsedDirs: string[];
  viewedFiles: string[];
};

// db-ui.json に保存される DB ビューア固有の永続 UI 状態。タブ寿命を超えて
// 残したいユーザー設定 (列幅 / 各種トグル) はここに集約する。新しいキーは
// prefs 配下に増やすことで、columnWidths 系の構造変更を巻き込まない。
export type DbUiPrefs = {
  // S3 explorer の行ホバーで画像プレビュー + 全 key を出すフローティング
  // ツールチップを有効化するかどうか。default true。
  s3TooltipEnabled?: boolean;
  // Rails の命名規約 (foo_id → foos.id) を使って未宣言の FK を仮想的に
  // 推測し、🔗 表示や関連パネル経由でナビゲートできるようにする。
  // default false (DB の真実を尊重)。
  inferFkRails?: boolean;
};

export type DbUiState = {
  version: 1;
  columnWidths: Record<string, Record<string, Record<string, number>>>;
  prefs?: DbUiPrefs;
};

export type UndoActionResponse = {
  id: string;
  type: string;
  label: string;
  payload: Record<string, unknown>;
};

export type FileSearchListResponse = {
  ref: string;
  generation: number;
  files: {
    path: string;
    type: "blob" | "commit";
  }[];
  truncated: boolean;
};

export type GrepMatch = {
  path: string;
  line: number;
  column: number;
  preview: string;
};

export type GrepResponse = {
  ref: string;
  engine: "rg" | "git" | "fallback";
  truncated: boolean;
  matches: GrepMatch[];
};

export type FileDiffResponse = {
  path: string;
  old_path?: string;
  status?: string;
  mode?: string;
  diff: string;
  hunk_count?: number;
  rendered_hunk_count?: number;
  truncated?: boolean;
  binary?: boolean;
  generation?: number;
};

export type FileRangeResponse = {
  path: string;
  ref: string;
  start: number;
  end: number;
  lines: string[];
  /**
   * When complete is true, total is the file's total line count.
   * When complete is false, total is only the highest line number the server
   * had to scan to prove more lines exist.
   */
  total: number;
  complete?: boolean;
  generation?: number;
};

export type AnnotationLineRange = {
  start: number;
  end: number;
};

export type AnnotationDatabaseTab =
  | "data"
  | "query"
  | "schema"
  | "er"
  | "search"
  | "snapshot";

export type AnnotationDatabaseDataState = {
  search?: string;
  filters?: Array<{ column: string; value: string }>;
  sort?: { column: string; direction: "asc" | "desc" };
  row?: number;
};

export type AnnotationDatabaseQueryState = {
  sql?: string;
  mode?: "run" | "explain";
  autoRun?: boolean;
};

export type AnnotationDatabaseSearchState = {
  term?: string;
  includeNonText?: boolean;
  autoRun?: boolean;
};

export type AnnotationDatabaseSnapshotState = {
  fromSnapshotId?: string;
  toSnapshotId?: string;
  table?: string;
};

export type AnnotationTarget =
  | {
      kind: "code";
      path: string;
      line?: AnnotationLineRange;
      range: { from: string; to: string };
    }
  | {
      kind: "database";
      db?: string;
      schema?: string;
      table?: string;
      tab?: AnnotationDatabaseTab;
      data?: AnnotationDatabaseDataState;
      query?: AnnotationDatabaseQueryState;
      search?: AnnotationDatabaseSearchState;
      snapshot?: AnnotationDatabaseSnapshotState;
    };

export type AnnotationEntry = {
  id: string;
  created_at: string;
  path: string;
  line?: AnnotationLineRange;
  range: { from: string; to: string };
  target?: AnnotationTarget;
  title?: string;
  body: string;
};

export type AnnotationSession = {
  id: string;
  title: string;
  created_at: string;
  entries: AnnotationEntry[];
};

export type AnnotationsState = {
  version: 1;
  sessions: AnnotationSession[];
};

export type AnnotationSseEvent = {
  kind: "start" | "add" | "delete" | "clear" | "update";
  session_id?: string;
  entry_id?: string;
};

export type DiffCardElement = HTMLElement & {
  _diffData?: FileDiffResponse | null;
  _file?: FileMeta | null;
};

export type RefResponse = {
  branches?: BranchMeta[];
  tags?: TagMeta[];
  commits?: CommitMeta[];
  current?: string;
};

export type BranchMeta = {
  name: string;
  when: string;
};

export type TagMeta = {
  name: string;
  when: string;
};

// ai-dup-check: allow -- client response DTO is intentionally kept in core types.
export type CommitMeta = {
  sha: string;
  subject: string;
  author: string;
  when: string;
};

export type RefCommitResponse = {
  commits?: CommitMeta[];
  hasMore?: boolean;
};

type Diff2HtmlGlobal = {
  new (
    element: HTMLElement,
    diffInput: string,
    configuration?: Record<string, unknown>,
    hljs?: {
      highlightElement?: (element: HTMLElement) => void;
      highlight?: (
        code: string,
        options: { language: string; ignoreIllegals: boolean },
      ) => { value: string };
    } | null,
  ): {
    draw(): void;
    highlightCode(): void;
  };
  hljs?: {
    highlightElement?: (element: HTMLElement) => void;
    highlight?: (
      code: string,
      options: { language: string; ignoreIllegals: boolean },
    ) => { value: string };
  };
};

declare global {
  interface Window {
    Diff2HtmlUI: Diff2HtmlGlobal;
    hljs: unknown;
    GdpExpandLogic: typeof GdpExpandLogic;
    _lastMeta?: DiffMeta | null;
    __gdpScrollSpy?: EventListener;
    __gdpSidebarTouchedAt?: number;
  }

  const Diff2HtmlUI: Diff2HtmlGlobal;
}

export type HljsApi = {
  configure?: (options: Record<string, unknown>) => void;
  getLanguage?: (language: string) => unknown;
  registerLanguage?: (
    language: string,
    languageDefinition: (
      hljs: Record<string, unknown>,
    ) => Record<string, unknown>,
  ) => void;
  highlight?: (
    code: string,
    options: { language: string; ignoreIllegals: boolean },
  ) => { value: string };
};

export type SidebarItem = {
  order?: number;
  path: string;
  display_path?: string;
  type?: RepoTreeEntry["type"];
  children_omitted?: true;
  children_omitted_reason?: RepoTreeEntry["children_omitted_reason"];
  status?: string;
  additions?: number;
  deletions?: number;
};

export type RawFileInfo = {
  size?: number;
  type?: string;
  created_at?: string;
  updated_at?: string;
  commit_updated_at?: string;
};
