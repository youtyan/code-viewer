// プロジェクトの登録簿と、それをエージェント一覧・ヘッダの切替に並べる
// 純ロジック。
//
// 登録簿はユーザー単位の 1 ファイル (server/projects/registry.ts)。登録の鍵は
// git の本体の作業ツリーのルート (実パス)。エージェント一覧がペインを束ねる
// 鍵 (AgentProjectInfo.root) と同じなので、tmux から見つかったプロジェクトと
// 登録したプロジェクトは同じ鍵で 1 つにまとまる。
//
// DOM にもファイルにも触らない。並び・開くときの判断・止めてよいかの判定は
// ここだけで確かめられる。

import type {
  AgentOverviewResponse,
  AgentProjectInfo,
  AgentProjectServer,
} from "./agent-overview";
import { hasControlCharacter } from "./control-chars";
import { errorWithCause } from "./error-detail";
import { withOpenPaneOverlay } from "./routes";

/** 登録簿の 1 件。 */
export type StoredProject = {
  /** git の本体の作業ツリーのルート (実パス)。 */
  root: string;
  /** 表示名。既定はフォルダ名。 */
  name: string;
  /** 登録した時刻 (ISO 8601)。 */
  addedAt: string;
};

/** 並び順は配列の順。利用者が上下で変えられる。 */
export type ProjectRegistry = {
  version: 1;
  projects: StoredProject[];
};

export const MAX_PROJECTS = 200;
export const MAX_PROJECT_NAME_LENGTH = 80;
const MAX_ROOT_LENGTH = 4096;

export function emptyProjectRegistry(): ProjectRegistry {
  return { version: 1, projects: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** 表示名の問題。無ければ null。 */
export function projectNameIssue(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "empty";
  if (trimmed.length > MAX_PROJECT_NAME_LENGTH) {
    return `longer than ${MAX_PROJECT_NAME_LENGTH} characters`;
  }
  if (hasControlCharacter(trimmed)) return "contains a control character";
  return null;
}

/** 登録の鍵にできるパスか (絶対パス・制御文字なし・長すぎない)。 */
export function projectRootIssue(root: string): string | null {
  if (!root.startsWith("/")) return "not an absolute path";
  if (root.length > MAX_ROOT_LENGTH) return "too long";
  if (hasControlCharacter(root)) return "contains a control character";
  return null;
}

/**
 * 読んだ JSON を登録簿として確かめる。1 件でも壊れていれば全体を ok: false
 * にし、どこがどう壊れているかを全部返す (黙って読み飛ばすと、次に書いた
 * ときにその登録が消える)。
 */
export function parseProjectRegistry(
  raw: unknown,
): { ok: true; registry: ProjectRegistry } | { ok: false; issues: string[] } {
  if (!isRecord(raw)) return { ok: false, issues: ["not a JSON object"] };
  const issues: string[] = [];
  if (raw.version !== 1) issues.push(`unsupported version: ${raw.version}`);
  if (!Array.isArray(raw.projects)) {
    issues.push("projects is not an array");
    return { ok: false, issues };
  }
  const projects: StoredProject[] = [];
  const seen = new Set<string>();
  raw.projects.forEach((entry: unknown, index: number) => {
    const at = `projects[${index}]`;
    if (!isRecord(entry)) {
      issues.push(`${at}: not an object`);
      return;
    }
    // 以前の版はプロジェクトごとのポート (port) を書いていた。入口のサーバで
    // オリジンが 1 つになったので使わない。読み飛ばし、次に書くときに落ちる。
    const { root, name, addedAt } = entry;
    if (typeof root !== "string") {
      issues.push(`${at}.root: not a string`);
      return;
    }
    const rootIssue = projectRootIssue(root);
    if (rootIssue) issues.push(`${at}.root: ${rootIssue}`);
    if (seen.has(root)) issues.push(`${at}.root: listed twice (${root})`);
    seen.add(root);
    if (typeof name !== "string") issues.push(`${at}.name: not a string`);
    else {
      const nameIssue = projectNameIssue(name);
      if (nameIssue) issues.push(`${at}.name: ${nameIssue}`);
    }
    if (typeof addedAt !== "string" || !addedAt) {
      issues.push(`${at}.addedAt: not a string`);
    }
    projects.push({
      root,
      name: typeof name === "string" ? name.trim() : "",
      addedAt: typeof addedAt === "string" ? addedAt : "",
    });
  });
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, registry: { version: 1, projects } };
}

export type ProjectRegistryIssue =
  | { code: "name"; issue: string }
  | { code: "root"; issue: string }
  | { code: "duplicate"; existing: string }
  | { code: "too-many"; limit: number }
  | { code: "not-found"; root: string };

/** フォルダ名。表示名の既定。 */
export function defaultProjectName(root: string): string {
  const trimmed = root.replace(/\/+$/, "");
  const name = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return (name || trimmed || root).slice(0, MAX_PROJECT_NAME_LENGTH);
}

export type ProjectRegistryChange =
  | { ok: true; registry: ProjectRegistry; project: StoredProject }
  | { ok: false; issue: ProjectRegistryIssue };

export function addProject(
  registry: ProjectRegistry,
  input: { root: string; name?: string },
  now: number,
): ProjectRegistryChange {
  const rootIssue = projectRootIssue(input.root);
  if (rootIssue)
    return { ok: false, issue: { code: "root", issue: rootIssue } };
  const name = (input.name ?? "").trim() || defaultProjectName(input.root);
  const nameIssue = projectNameIssue(name);
  if (nameIssue)
    return { ok: false, issue: { code: "name", issue: nameIssue } };
  const existing = registry.projects.find((item) => item.root === input.root);
  if (existing) {
    return { ok: false, issue: { code: "duplicate", existing: existing.name } };
  }
  if (registry.projects.length >= MAX_PROJECTS) {
    return { ok: false, issue: { code: "too-many", limit: MAX_PROJECTS } };
  }
  const project: StoredProject = {
    root: input.root,
    name,
    addedAt: new Date(now).toISOString(),
  };
  return {
    ok: true,
    registry: { version: 1, projects: [...registry.projects, project] },
    project,
  };
}

function findIndex(
  registry: ProjectRegistry,
  root: string,
): number | ProjectRegistryChange {
  const index = registry.projects.findIndex((item) => item.root === root);
  if (index < 0) return { ok: false, issue: { code: "not-found", root } };
  return index;
}

/** 登録簿から外す。リポジトリには触らない (呼び出し側も触らない)。 */
export function removeProject(
  registry: ProjectRegistry,
  root: string,
): ProjectRegistryChange {
  const index = findIndex(registry, root);
  if (typeof index !== "number") return index;
  const project = registry.projects[index] as StoredProject;
  return {
    ok: true,
    registry: {
      version: 1,
      projects: registry.projects.filter((_, at) => at !== index),
    },
    project,
  };
}

function replaceAt(
  registry: ProjectRegistry,
  index: number,
  project: StoredProject,
): ProjectRegistryChange {
  const projects = [...registry.projects];
  projects[index] = project;
  return { ok: true, registry: { version: 1, projects }, project };
}

/** 表示名を変える。空にすると既定 (フォルダ名) に戻る。 */
export function renameProject(
  registry: ProjectRegistry,
  root: string,
  name: string,
): ProjectRegistryChange {
  const index = findIndex(registry, root);
  if (typeof index !== "number") return index;
  const next = name.trim() || defaultProjectName(root);
  const issue = projectNameIssue(next);
  if (issue) return { ok: false, issue: { code: "name", issue } };
  const current = registry.projects[index] as StoredProject;
  return replaceAt(registry, index, { ...current, name: next });
}

/**
 * before の前へ置く (null なら末尾)。位置を番号でなく隣の鍵で受けるのは、
 * 別のサーバが間に登録簿を変えても、利用者が落とした場所の隣に置くため。
 * 並びが変わらなければ同じ登録簿を返す (書かない)。
 */
export function placeProject(
  registry: ProjectRegistry,
  root: string,
  before: string | null,
): ProjectRegistryChange {
  const index = findIndex(registry, root);
  if (typeof index !== "number") return index;
  const project = registry.projects[index] as StoredProject;
  const rest = registry.projects.filter((_, at) => at !== index);
  const target =
    before === null ? rest.length : rest.findIndex((p) => p.root === before);
  if (target < 0) {
    if (before === root) return { ok: true, registry, project };
    return { ok: false, issue: { code: "not-found", root: before as string } };
  }
  if (target === index) return { ok: true, registry, project };
  const projects = [...rest.slice(0, target), project, ...rest.slice(target)];
  return { ok: true, registry: { version: 1, projects }, project };
}

/** 1 つ上 (-1) か下 (+1) へ。端ではそのまま。 */
export function moveProject(
  registry: ProjectRegistry,
  root: string,
  direction: -1 | 1,
): ProjectRegistryChange {
  const index = findIndex(registry, root);
  if (typeof index !== "number") return index;
  const neighbor = registry.projects[index + direction];
  if (!neighbor) {
    return {
      ok: true,
      registry,
      project: registry.projects[index] as StoredProject,
    };
  }
  const before =
    direction < 0
      ? neighbor.root
      : (registry.projects[index + 2]?.root ?? null);
  return placeProject(registry, root, before);
}

/**
 * ドラッグで落とす位置 (並びの中の隙間の番号、0 = 先頭の前、length = 末尾の
 * 後) から、送る before を決める。掴んだものの前後の隙間は並びが変わらない
 * ので null (落とす先の線も出さない)。
 */
export function projectDropBefore(
  order: readonly string[],
  dragged: string,
  gap: number,
): { before: string | null } | null {
  const from = order.indexOf(dragged);
  if (from < 0 || gap < 0 || gap > order.length) return null;
  if (gap === from || gap === from + 1) return null;
  return { before: order[gap] ?? null };
}

/** 一覧・切替に載せる登録の情報 (ワイヤ形式)。 */
export type RegisteredProjectInfo = {
  root: string;
  name: string;
  /** 登録簿の中の位置 (0 始まり)。利用者が決めた順。 */
  order: number;
};

export type ProjectRegistrySnapshot = {
  projects: RegisteredProjectInfo[];
  /** 登録簿を読めなかった理由 (全文)。空なら読めた。 */
  error: string;
  /** 登録簿のファイルの場所。案内とエラーに出す。 */
  path: string;
};

export function registeredProjectInfos(
  registry: ProjectRegistry,
): RegisteredProjectInfo[] {
  return registry.projects.map((project, order) => ({
    root: project.root,
    name: project.name,
    order,
  }));
}

/**
 * サーバの状態から、見出しの「開く」が何をするか。
 *
 * - current: この画面のサーバ。移らない
 * - navigate: 動いている。その URL へ同じタブで移る
 * - start: 登録済みで動いていない。起こしてから移る
 * - register-first: 登録していない・動いていない。起こさず、先に登録を促す
 * - unavailable: 開けない (git 管理外・確かめられない)。理由を出す
 */
export type ProjectOpenDecision =
  | { kind: "current" }
  | { kind: "navigate"; url: string }
  | { kind: "start" }
  | { kind: "register-first" }
  | { kind: "unavailable"; reason: string };

export function decideProjectOpen(input: {
  server: AgentProjectServer;
  registered: boolean;
  git: boolean;
}): ProjectOpenDecision {
  const { server } = input;
  if (server.status === "current") return { kind: "current" };
  if (server.status === "running") return { kind: "navigate", url: server.url };
  if (!input.git || server.status === "none") {
    return { kind: "unavailable", reason: "not a git repository" };
  }
  if (server.status === "unreachable" || server.status === "invalid") {
    return { kind: "unavailable", reason: server.detail };
  }
  return input.registered ? { kind: "start" } : { kind: "register-first" };
}

/**
 * エージェントのペインを開く行き先。通知・サイドバー・全体ボード・パレットが
 * これ 1 つを使う。ペインのプロジェクトがこの画面のもの・一覧に無い・移れない
 * (git の外・サーバに繋がらない) なら、この画面のタブで開く。移れる別の
 * プロジェクトなら、そこへ移り、移った先で `?open-pane=` のペインを開く
 * (path は移り先のアプリ内パス。今の画面のパスに付ける)。
 */
export function agentPaneTarget(
  pane: string,
  overview: Pick<AgentOverviewResponse, "panes" | "projects"> | null,
  currentPath: string,
):
  | { kind: "here" }
  | { kind: "project"; info: AgentProjectInfo; path: string } {
  const root = overview?.panes.find((item) => item.id === pane)?.project;
  const info = overview?.projects.find((item) => item.root === root);
  if (!info) return { kind: "here" };
  const decision = decideProjectOpen({
    server: info.server,
    registered: info.registered !== null,
    git: info.git,
  });
  if (decision.kind === "current" || decision.kind === "unavailable") {
    return { kind: "here" };
  }
  return {
    kind: "project",
    info,
    path: withOpenPaneOverlay(currentPath, pane),
  };
}

/**
 * 一覧のメニューから止めてよいか。code-viewer が起こしたサーバだけ。
 * 利用者が自分で起動したサーバと、この画面のサーバは止めない。
 */
export function canStopProjectServer(server: AgentProjectServer): boolean {
  return server.status === "running" && server.launched;
}

/**
 * 移り先の URL。プロジェクトの根 (`http://127.0.0.1:<port>/`、入口の下なら
 * `http://127.0.0.1:<port>/p/<鍵>/`) に、移る前と同じ画面のパスを付ける。
 * パスは `/` 始まりのアプリ内のもの (前置きを外したもの) だけ受け、それ以外は
 * 根にする (別のオリジンへ飛ばさない)。
 */
export function projectDestination(serverUrl: string, path: string): string {
  let base: URL;
  try {
    base = new URL(serverUrl);
  } catch (cause) {
    throw errorWithCause(
      "project server URL must be an HTTP loopback URL",
      cause,
    );
  }
  const loopbackHost =
    base.hostname === "127.0.0.1" ||
    base.hostname === "localhost" ||
    base.hostname === "[::1]";
  const projectRoot = /^\/p\/[0-9a-f]{16}\/$/.test(base.pathname);
  if (
    hasControlCharacter(serverUrl) ||
    base.protocol !== "http:" ||
    !loopbackHost ||
    !base.port ||
    base.username ||
    base.password ||
    (base.pathname !== "/" && !projectRoot) ||
    base.search ||
    base.hash
  ) {
    throw new Error("project server URL must be an HTTP loopback URL");
  }
  const safe =
    path.startsWith("/") && !path.startsWith("//") && !hasControlCharacter(path)
      ? path
      : "/";
  const prefix = base.pathname.replace(/\/+$/, "");
  const target = new URL(prefix + safe, base);
  if (
    target.origin !== base.origin ||
    (prefix && !target.pathname.startsWith(`${prefix}/`))
  ) {
    return base.href;
  }
  return target.href;
}

/** 起こした結果 (ワイヤ形式)。 */
export type ProjectOpenResponse = {
  url: string;
  /** 今回起こしたか (既に動いていたら false)。 */
  started: boolean;
};

/** 絞り込みの文字でプロジェクトを選ぶ (名前とパスの部分一致、大小無視)。 */
export function matchesProjectQuery(
  project: { name: string; root: string },
  query: string,
): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = `${project.name}\n${project.root}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}
