/**
 * フロントからサーバへ送る要求の URL を組み立てる、ただ 1 つの場所。
 *
 * フロントの `.ts` (`server/`・`test/` を除く) で、サーバの経路の文字列
 * (`/_…`・`/file_…`・`/events`・`/diff.json`) を書いてよいのはこのファイルだけ。
 * `web-src/test/api-url-guard.test.ts` が見ている。経路を足すときは下の表に
 * 1 行足し、呼び出し側は `apiUrl("名前")` にクエリを繋げる。
 *
 * zone は、入口のサーバ (server/entry/) の下でどこが受けるか:
 * - `project`: リポジトリ決め打ちの処理。入口の下の画面では `/p/<鍵>` を前置きし、
 *   入口がそのプロジェクトの裏のプロセスへ取り次ぐ
 * - `entry`: プロジェクトに依らない処理 (入口が受ける)。前置きしない
 * 1 つで完結するサーバ (`--standalone`) の画面は前置きが無く、URL は今までと同じ。
 */

export type ApiZone = "project" | "entry";

/**
 * 入口のサーバへの要求に付ける、画面が選んでいるプロジェクトの鍵。入口は
 * これでシェルの作業場所や「このリポジトリのペインか」を決める
 * (server/entry/server.ts)。
 */
export const PROJECT_HEADER = "X-Code-Viewer-Project";

const API_ENDPOINTS = {
  agentAccounts: { path: "/_agent/accounts", zone: "entry" },
  agentAccountsLogin: { path: "/_agent/accounts/login", zone: "entry" },
  agentAccountsPlan: { path: "/_agent/accounts/plan", zone: "entry" },
  agentHooks: { path: "/_agent/hooks", zone: "entry" },
  agentHooksApply: { path: "/_agent/hooks/apply", zone: "entry" },
  agentHooksFailures: { path: "/_agent/hooks/failures", zone: "entry" },
  agentHooksPlan: { path: "/_agent/hooks/plan", zone: "entry" },
  agentImages: { path: "/_agent/images", zone: "entry" },
  agentImagesHistory: { path: "/_agent/images/history", zone: "entry" },
  agentLaunch: { path: "/_agent/launch", zone: "entry" },
  agentOverview: { path: "/_agent/overview", zone: "entry" },
  agentPaste: { path: "/_agent/paste", zone: "entry" },
  agentProjects: { path: "/_agent/projects", zone: "entry" },
  agentProjectsOpen: { path: "/_agent/projects/open", zone: "entry" },
  agentProjectsStop: { path: "/_agent/projects/stop", zone: "entry" },
  agentRules: { path: "/_agent/rules", zone: "entry" },
  agentState: { path: "/_agent/state", zone: "entry" },
  agentStates: { path: "/_agent/states", zone: "entry" },
  agentStatuslineApply: { path: "/_agent/statusline/apply", zone: "entry" },
  agentStatuslineFailures: {
    path: "/_agent/statusline/failures",
    zone: "entry",
  },
  agentStatuslinePlan: { path: "/_agent/statusline/plan", zone: "entry" },
  agentUnread: { path: "/_agent/unread", zone: "entry" },
  annotations: { path: "/_annotations", zone: "project" },
  authors: { path: "/_authors", zone: "project" },
  commits: { path: "/_commits", zone: "project" },
  createDirectory: { path: "/_create_directory", zone: "project" },
  dbClose: { path: "/_db/close", zone: "project" },
  dbColumns: { path: "/_db/columns", zone: "project" },
  dbConnections: { path: "/_db/connections", zone: "project" },
  dbConnectionsTest: { path: "/_db/connections/test", zone: "project" },
  dbDdl: { path: "/_db/ddl", zone: "project" },
  dbDynamodbItem: { path: "/_db/dynamodb/item", zone: "project" },
  dbDynamodbItems: { path: "/_db/dynamodb/items", zone: "project" },
  dbDynamodbTable: { path: "/_db/dynamodb/table", zone: "project" },
  dbDynamodbTables: { path: "/_db/dynamodb/tables", zone: "project" },
  dbElasticsearchDoc: { path: "/_db/elasticsearch/doc", zone: "project" },
  dbElasticsearchDocs: { path: "/_db/elasticsearch/docs", zone: "project" },
  dbElasticsearchIndices: {
    path: "/_db/elasticsearch/indices",
    zone: "project",
  },
  dbElasticsearchMapping: {
    path: "/_db/elasticsearch/mapping",
    zone: "project",
  },
  dbElasticsearchWrite: { path: "/_db/elasticsearch/write", zone: "project" },
  dbExport: { path: "/_db/export", zone: "project" },
  dbFiles: { path: "/_db/files", zone: "project" },
  dbHistory: { path: "/_db/history", zone: "project" },
  dbHistoryClear: { path: "/_db/history/clear", zone: "project" },
  dbHistoryDelete: { path: "/_db/history/delete", zone: "project" },
  dbMutate: { path: "/_db/mutate", zone: "project" },
  dbQuery: { path: "/_db/query", zone: "project" },
  dbRedisDatabases: { path: "/_db/redis/databases", zone: "project" },
  dbRedisKeys: { path: "/_db/redis/keys", zone: "project" },
  dbRedisValue: { path: "/_db/redis/value", zone: "project" },
  dbRedisWrite: { path: "/_db/redis/write", zone: "project" },
  dbS3Buckets: { path: "/_db/s3/buckets", zone: "project" },
  dbS3Folder: { path: "/_db/s3/folder", zone: "project" },
  dbS3Head: { path: "/_db/s3/head", zone: "project" },
  dbS3Objects: { path: "/_db/s3/objects", zone: "project" },
  dbS3Raw: { path: "/_db/s3/raw", zone: "project" },
  dbS3Text: { path: "/_db/s3/text", zone: "project" },
  dbS3Write: { path: "/_db/s3/write", zone: "project" },
  dbSchema: { path: "/_db/schema", zone: "project" },
  dbSchemas: { path: "/_db/schemas", zone: "project" },
  dbSearchCancel: { path: "/_db/search/cancel", zone: "project" },
  dbSearchStart: { path: "/_db/search/start", zone: "project" },
  dbSearchStatus: { path: "/_db/search/status", zone: "project" },
  dbSnapshotCancel: { path: "/_db/snapshot/cancel", zone: "project" },
  dbSnapshotCreate: { path: "/_db/snapshot/create", zone: "project" },
  dbSnapshotDelete: { path: "/_db/snapshot/delete", zone: "project" },
  dbSnapshotDiffRows: { path: "/_db/snapshot/diff/rows", zone: "project" },
  dbSnapshotDiffTables: { path: "/_db/snapshot/diff/tables", zone: "project" },
  dbSnapshotList: { path: "/_db/snapshot/list", zone: "project" },
  dbSnapshotUpdateNote: { path: "/_db/snapshot/update-note", zone: "project" },
  dbTable: { path: "/_db/table", zone: "project" },
  dbTableCount: { path: "/_db/table-count", zone: "project" },
  dbTabs: { path: "/_db/tabs", zone: "project" },
  dbUi: { path: "/_db/ui", zone: "project" },
  doctor: { path: "/_doctor", zone: "project" },
  file: { path: "/_file", zone: "project" },
  fileBlame: { path: "/_file_blame", zone: "project" },
  fileRevisions: { path: "/_file_revisions", zone: "project" },
  files: { path: "/_files", zone: "project" },
  grep: { path: "/_grep", zone: "project" },
  journal: { path: "/_journal", zone: "project" },
  log: { path: "/_log", zone: "project" },
  openPath: { path: "/_open_path", zone: "project" },
  refs: { path: "/_refs", zone: "project" },
  restoreTrash: { path: "/_restore_trash", zone: "project" },
  settings: { path: "/_settings", zone: "project" },
  shellClose: { path: "/_shell/close", zone: "entry" },
  shellCreate: { path: "/_shell/create", zone: "entry" },
  shellKeys: { path: "/_shell/keys", zone: "entry" },
  shellList: { path: "/_shell/list", zone: "entry" },
  shellResize: { path: "/_shell/resize", zone: "entry" },
  shellStream: { path: "/_shell/stream", zone: "entry" },
  stateSettings: { path: "/_state/settings", zone: "project" },
  stateTools: { path: "/_state/tools", zone: "project" },
  stateView: { path: "/_state/view", zone: "project" },
  tmuxClients: { path: "/_tmux/clients", zone: "entry" },
  tmuxOpen: { path: "/_tmux/open", zone: "entry" },
  tmuxPanes: { path: "/_tmux/panes", zone: "entry" },
  trashPath: { path: "/_trash_path", zone: "project" },
  tree: { path: "/_tree", zone: "project" },
  uploadFiles: { path: "/_upload_files", zone: "project" },
  worktreeAdd: { path: "/_worktree/add", zone: "project" },
  worktreeCommits: { path: "/_worktree/commits", zone: "project" },
  worktreeDiff: { path: "/_worktree/diff", zone: "project" },
  worktreeFile: { path: "/_worktree/file", zone: "project" },
  worktreeList: { path: "/_worktree/list", zone: "project" },
  worktreeOpen: { path: "/_worktree/open", zone: "entry" },
  worktreeRemove: { path: "/_worktree/remove", zone: "project" },
  worktreeStop: { path: "/_worktree/stop", zone: "entry" },
  diffJson: { path: "/diff.json", zone: "project" },
  entryRestart: { path: "/_entry/restart", zone: "entry" },
  events: { path: "/events", zone: "project" },
  fileRange: { path: "/file_range", zone: "project" },
  // サーバが一覧の応答で返す load_url・preview_url の経路。呼び出し側は
  // apiUrl で組み立てず、projectRequest が前置きを付ける先として載せる。
  fileDiff: { path: "/file_diff", zone: "project" },
} as const satisfies Record<string, { path: string; zone: ApiZone }>;

export type ApiEndpoint = keyof typeof API_ENDPOINTS;

/**
 * 入口のサーバの下で開いた画面の URL の前置き (`/p/<鍵>`)。鍵は根の実パスの
 * rootFileKey (server/server-registry.ts) で、16 進 16 文字。1 つで完結する
 * サーバ (`--standalone`) の画面には付かない。
 */
const PROJECT_PREFIX_PATTERN = /^\/p\/([0-9a-f]{16})(?=[/?#]|$)/;

function currentPathname(): string {
  // サーバ (entry/server.ts) もこのファイルを読むので、location が無い所では空。
  return typeof location === "undefined" ? "" : location.pathname;
}

/** 画面が選んでいるプロジェクトの鍵。前置きの無い画面では null。 */
export function projectKey(
  pathname: string = currentPathname(),
): string | null {
  return PROJECT_PREFIX_PATTERN.exec(pathname)?.[1] ?? null;
}

function projectPrefix(): string {
  const key = projectKey();
  return key ? `/p/${key}` : "";
}

/**
 * 前置きを外した画面の URL (`/p/<鍵>/file?…` → `/file?…`)。parseRoute など
 * 経路を読む側はこれを通す。前置きが無ければそのまま。
 */
export function withoutProjectPrefix(url: string): string {
  const rest = url.replace(PROJECT_PREFIX_PATTERN, "");
  if (rest === url) return url;
  return rest.startsWith("/") ? rest : `/${rest}`;
}

/** いまの画面の経路 (前置きを外した location.pathname)。 */
export function routePathname(): string {
  return withoutProjectPrefix(currentPathname());
}

/** サーバの経路の URL (クエリは呼び出し側が繋げる)。 */
export function apiUrl(endpoint: ApiEndpoint): string {
  const { path, zone } = API_ENDPOINTS[endpoint];
  return zone === "project" ? projectPrefix() + path : path;
}

/** 画面の URL (`/file?…`・`/todif?…` など)。`buildRoute` が通す。 */
export function pageUrl(path: string): string {
  return projectPrefix() + path;
}

const PATHS_BY_ZONE: Record<ApiZone, ReadonlySet<string>> = {
  project: new Set(
    Object.values(API_ENDPOINTS)
      .filter((spec) => spec.zone === "project")
      .map((spec) => spec.path),
  ),
  entry: new Set(
    Object.values(API_ENDPOINTS)
      .filter((spec) => spec.zone === "entry")
      .map((spec) => spec.path),
  ),
};

/**
 * すべての fetch が通る包み (network-activity の prepareRequest) で、入口の
 * サーバの下の画面の要求を整える。
 * - プロジェクトの経路で前置きの無いもの (サーバが返した `load_url` の
 *   `/file_diff?…` など) に前置きを付ける
 * - 入口が受ける経路には、選んでいるプロジェクトの鍵を PROJECT_HEADER で渡す
 * 前置きの無い画面 (1 つで完結するサーバ) では何もしない。
 */
export function projectRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): { input: RequestInfo | URL; init?: RequestInit } {
  const key = projectKey();
  if (!key || typeof input !== "string") return { input, init };
  if (!input.startsWith("/") || input.startsWith("//")) return { input, init };
  const path = input.split(/[?#]/, 1)[0] ?? input;
  if (PATHS_BY_ZONE.project.has(path)) {
    return { input: `/p/${key}${input}`, init };
  }
  if (PATHS_BY_ZONE.entry.has(path)) {
    const headers = new Headers(init?.headers);
    headers.set(PROJECT_HEADER, key);
    return { input, init: { ...init, headers } };
  }
  return { input, init };
}
