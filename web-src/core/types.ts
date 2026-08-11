import type { GdpExpandLogic } from "./expand-logic";
import type { KeymapOverrides } from "./keymap";
import type { ToolId } from "./tools";
import type {
  WorktreeFileOrigin,
  WorktreeItem,
  WorktreeOverlap,
} from "./worktree";

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
  error?: string;
};

// ai-dup-check: allow -- client response DTO is intentionally kept in core types.
export type RepoTreeEntry = {
  name: string;
  path: string;
  type: "tree" | "blob" | "commit";
  submodule?: true;
  children_omitted?: true;
  children_omitted_reason?: "heavy" | "internal" | "truncated";
  size?: number;
  created_at?: string;
  updated_at?: string;
  commit_updated_at?: string;
  // A symlink keeps its resolved `type` (tree/blob) so navigation just
  // works - is_symlink only changes how it is drawn/labeled. resolved_path
  // is set only for a committed-ref directory symlink: `path` itself
  // cannot be browsed with `git ls-tree` (unlike a worktree path, which the
  // OS resolves transparently), so navigation must use resolved_path.
  is_symlink?: true;
  symlink_target?: string;
  symlink_target_type?: "tree" | "blob" | "missing";
  resolved_path?: string;
  status?: string;
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
  /** Registry clients use this to prove that a loopback server owns the entry. */
  server: {
    pid: number;
    root: string;
  };
  scope: {
    omit_dirs_effective: string[];
    omit_dirs_built_in: string[];
    exclude_names_effective: string[];
    exclude_names_built_in: string[];
    max_entries: number;
    watch_limit_effective: number;
    watch_limit_default: number;
    watch_limit_min: number;
    watch_limit_max: number;
    // True when the platform watches the whole tree through a single OS handle,
    // which leaves no per-directory watchers for the limit to cap.
    watch_recursive: boolean;
  };
};

export type WorktreesResponse = {
  worktrees: WorktreeItem[];
  repoRoot: string;
  /** 追加時に作られる場所。画面の説明文に出す。 */
  addParent: string;
  /** 位置関係の基準にしたブランチ。決められなかったときは空。 */
  baseBranch: string;
  /** 2 本以上が同じファイルを触っている箇所。無ければ空。 */
  overlaps: WorktreeOverlap[];
  /**
   * 自分自身と競合しうる一覧なので、応答が古いかどうかをクライアントが
   * 判定できるようにする (server.md の Request Lifecycle Discipline)。
   */
  generation: number;
  /** 一覧そのものを取れなかった理由。取れているなら無い。 */
  error?: string;
};

/** 追加・削除・起動の結果。失敗は HTTP ステータスとテキストで返す。 */
export type WorktreeActionResponse = {
  /** open のとき、開くべき URL。 */
  url?: string;
  /** open がサーバを起動した (既存を再利用したなら false)。 */
  started?: boolean;
  /** add のとき、作った作業ツリーのパス。作ったものをそのまま選ぶために使う。 */
  path?: string;
};

export type WorktreeDiffResponse = {
  file: string;
  origin: WorktreeFileOrigin;
  diff: string;
  totalHunks: number;
  renderedHunks: number;
  truncated: boolean;
  generation: number;
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
  /**
   * ターミナルの文字サイズ (px)。コードやサイドバーの段階値と違い、xterm は
   * 実数の px を要るので数値で持つ。字の大きさを変えると表示領域に入る
   * 桁数・行数も変わるので、PTY のリサイズもここから連動する。
   */
  terminalFontSize?: number;
  /** 下パネルを本文と高さを分けて表示する。false / 未設定なら重ねて表示。 */
  appPanelDocked?: boolean;
  syntaxHighlight?: boolean;
  autoUpdate?: boolean;
  queryHistoryPanelWidth?: number;
  annotationPanelOpen?: boolean;
  annotationPanelWidth?: number;
  annotationFollow?: boolean;
  annotationMuted?: boolean;
  annotationRate?: number;
  ignoreWhitespace?: boolean;
  hideTests?: boolean;
  fileSelectionHistory?: string[];
  grepSelectionHistory?: string[];
  grepRegex?: boolean;
  grepGroupByFile?: boolean;
  grepPaletteWidth?: number;
  grepPaletteHeight?: number;
  scopeOmitDirs?: string[];
  scopeExcludeNames?: string[];
  scopeWatchLimit?: number;
  uploadEnabled?: boolean;
  /**
   * ユーザーが変更したキー割り当てだけを持つ差分。ここに無いアクションは
   * デフォルトのまま動くので、後からデフォルトを変えても、触っていない
   * ものは新しい割り当てに追従する。
   */
  keybindings?: KeymapOverrides;
  range?: {
    from: string;
    to: string;
  };
};

export type ViewState = {
  version: 1;
  collapsedDirs: string[];
  lazyExpandedDirs: string[];
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
  expandedTables?: Record<string, string[]>;
  /** snapshot 取得ダイアログで前回チェックしていたテーブル集合を scope 単位
   * (dbId + schema) で覚えておくための永続キャッシュ。値は sorted unique
   * テーブル名配列。サイズと値の sanitize は state-store 側で行う。 */
  snapshotSelectedTables?: Record<string, string[]>;
  prefs?: DbUiPrefs;
};

// tools.json に保存されるスクラッチパッドの状態。貼り付けた本文はブラウザを
// 閉じても消えないほうが道具として使いやすいので、他の永続 UI 状態と同じく
// .code-viewer 配下に置く (localStorage は使わない)。
export type ToolsState = {
  version: 1;
  /** 最後に開いていたツール。次に開いたときの初期タブになる。 */
  activeTool?: ToolId;
  /**
   * 右ドロワーだった頃の幅 (px)。下パネルに移して幅を持たなくなったので、
   * もう書かない。古い保存値がそのまま読めるように型だけ残してある。
   */
  width?: number;
  /** ツールごとの入力本文。空文字は「下書き無し」として保存しない。 */
  drafts?: Partial<Record<ToolId, string>>;
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
  matchText?: string;
};

export type GrepResponse = {
  ref: string;
  engine: "rg" | "git" | "fallback";
  truncated: boolean;
  matches: GrepMatch[];
  generation?: number;
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
  error?: string;
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
  _loadPromise?: Promise<void>;
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
  submodule?: RepoTreeEntry["submodule"];
  children_omitted?: true;
  children_omitted_reason?: RepoTreeEntry["children_omitted_reason"];
  is_symlink?: RepoTreeEntry["is_symlink"];
  symlink_target?: RepoTreeEntry["symlink_target"];
  symlink_target_type?: RepoTreeEntry["symlink_target_type"];
  resolved_path?: RepoTreeEntry["resolved_path"];
  status?: string;
  additions?: number;
  deletions?: number;
  size_class?: string;
  media_kind?: string | null;
  binary?: boolean;
};

export type RawFileInfo = {
  size?: number;
  type?: string;
  created_at?: string;
  updated_at?: string;
  commit_updated_at?: string;
};
