// 登録したプロジェクトを足す・開く・止める。
//
// 開くのは既存の起動の仕組み (worktree/open.ts の起動・本人確認・停止) を
// そのまま使う。任意のパスでサーバを起こさせないため、起こせるのは登録簿に
// あるプロジェクトだけ (登録簿はこのユーザーの状態ディレクトリにあり、
// 登録の入口は同一オリジンからの要求だけが通る)。
//
// ポートは毎回自動 (0)。入口のサーバの下ではオリジンが入口の 1 つなので、
// プロジェクトごとのポートを覚える理由が無い (以前は通知の許可と画面の寸法を
// 保つために覚えていた)。

import { realpathSync } from "node:fs";
import { join } from "node:path";
import { formatErrorDetail } from "../../core/error-detail";
import {
  addProject,
  moveProject,
  type ProjectOpenResponse,
  removeProject,
  renameProject,
  type StoredProject,
} from "../../core/projects";
import { projectRootResultAsync } from "../git";
import { rootFileKey } from "../server-registry";
import { errno } from "../terminal/settings-file";
import { codeViewerStateDir } from "../user-state-dir";
import {
  openWorktreeServer,
  type RunningWorktreeServerResult,
  runningServerResult,
  type SpawnOptions,
  stopWorktreeServer,
  type WorktreeOpenResult,
} from "../worktree/open";
import {
  ProjectRegistryError,
  projectRegistryPath,
  readProjectRegistry,
  updateProjectRegistry,
} from "./registry";

/** パスから、登録の鍵 (git の本体の作業ツリーのルートの実パス) を求める。 */
export async function resolveProjectRoot(
  path: string,
  cwd: string,
): Promise<string> {
  const resolved = await projectRootResultAsync(path, cwd);
  if (resolved.kind === "outside") {
    throw new ProjectRegistryError(
      `${path} is not inside a git repository`,
      "invalid",
    );
  }
  if (resolved.kind === "error") {
    throw new ProjectRegistryError(
      `cannot find the repository of ${path}:\n${resolved.error}`,
      "invalid",
    );
  }
  try {
    return realpathSync(resolved.root);
  } catch (error) {
    throw new ProjectRegistryError(
      `cannot resolve ${resolved.root}`,
      errno(error) === "ENOENT" ? "not-found" : "failed",
      { cause: error },
    );
  }
}

export type ProjectChange =
  | { action: "add"; path: string; name?: string }
  | { action: "remove"; root: string }
  | { action: "rename"; root: string; name: string }
  | { action: "move"; root: string; direction: -1 | 1 };

export async function changeProjects(
  change: ProjectChange,
  cwd: string,
  now: number = Date.now(),
  path: string = projectRegistryPath(),
): Promise<StoredProject> {
  if (change.action === "add") {
    const root = await resolveProjectRoot(change.path, cwd);
    return updateProjectRegistry(path, (registry) =>
      addProject(registry, { root, name: change.name }, now),
    );
  }
  return updateProjectRegistry(path, (registry) => {
    if (change.action === "remove") return removeProject(registry, change.root);
    if (change.action === "rename") {
      return renameProject(registry, change.root, change.name);
    }
    return moveProject(registry, change.root, change.direction);
  });
}

/** 起こしたサーバの出力の置き場所。起動に失敗したとき末尾を理由に出す。 */
export function serverLogFile(root: string): string {
  return join(codeViewerStateDir(), "server-logs", `${rootFileKey(root)}.log`);
}

/** 起こす・確かめる・止める手段。テストで差し替える。 */
export type ProjectServerDeps = {
  registryPath: string;
  running(root: string): Promise<RunningWorktreeServerResult>;
  open(root: string, options: SpawnOptions): Promise<WorktreeOpenResult>;
  stop(root: string): Promise<void>;
};

export function defaultProjectServerDeps(): ProjectServerDeps {
  return {
    registryPath: projectRegistryPath(),
    running: (root) => runningServerResult(root),
    open: openWorktreeServer,
    stop: stopWorktreeServer,
  };
}

function registeredProject(registryPath: string, root: string): StoredProject {
  const read = readProjectRegistry(registryPath);
  if (read.ok === false) {
    throw new ProjectRegistryError(
      `the project registry cannot be read.\n${read.error}`,
      "unreadable",
    );
  }
  const project = read.registry.projects.find((item) => item.root === root);
  if (!project) {
    throw new ProjectRegistryError(
      `${root} is not a registered project; register it before opening it`,
      "not-found",
    );
  }
  return project;
}

/**
 * 登録したプロジェクトのサーバの URL。動いていなければ起こす (ポートは自動)。
 * 登録していないプロジェクトは起こさない (not-found)。
 */
export async function openRegisteredProject(
  root: string,
  deps: ProjectServerDeps = defaultProjectServerDeps(),
): Promise<ProjectOpenResponse> {
  registeredProject(deps.registryPath, root);
  const running = await deps.running(root);
  if (running.status === "running") return { url: running.url, started: false };
  if (running.status !== "absent") {
    throw new ProjectRegistryError(
      `the running code-viewer server for ${root} could not be checked:\n${formatErrorDetail(running.error)}`,
      "failed",
      { cause: running.error },
    );
  }
  const result = await deps.open(root, {
    port: 0,
    logFile: serverLogFile(root),
  });
  if (result.status === "ok") return { url: result.url, started: true };
  if (result.status === "missing") {
    throw new ProjectRegistryError(
      `the repository folder ${root} does not exist`,
      "not-found",
    );
  }
  if (result.status === "timeout") {
    throw new ProjectRegistryError(
      `the code-viewer server for ${root} did not start in time`,
      "failed",
    );
  }
  throw new ProjectRegistryError(
    `could not start the code-viewer server for ${root}:\n${formatErrorDetail(result.error)}`,
    "failed",
    { cause: result.error },
  );
}

/**
 * code-viewer が起こしたサーバを止める。利用者が自分で起動したサーバと、
 * この画面のサーバは止めない。
 */
export async function stopLaunchedServer(
  root: string,
  serverRoot: string,
  deps: ProjectServerDeps = defaultProjectServerDeps(),
): Promise<{ stopped: boolean }> {
  if (root === serverRoot) {
    throw new ProjectRegistryError(
      "the server showing this screen cannot be stopped from here",
      "conflict",
    );
  }
  const running = await deps.running(root);
  if (running.status === "absent") return { stopped: false };
  if (running.status !== "running") {
    throw new ProjectRegistryError(
      `the code-viewer server for ${root} could not be checked:\n${formatErrorDetail(running.error)}`,
      "failed",
      { cause: running.error },
    );
  }
  if (!running.launched) {
    throw new ProjectRegistryError(
      `the code-viewer server for ${root} was started outside code-viewer; stop it where it was started`,
      "conflict",
    );
  }
  await deps.stop(root);
  return { stopped: true };
}
