// 入口のサーバ。ユーザーが起動する code-viewer は 1 つ、ブラウザが開くポートも 1 つ。
//
// 入口が受けるもの (プロジェクトに依らない):
// - 画面のファイル (static-files.ts)。`/p/<鍵>/<画面の経路>` も index.html
// - エージェント (`/_agent/*`)・tmux (`/_tmux/*`)・ブラウザのシェル
//   (`/_shell/*`)・作業ツリーの開く/止める (`/_worktree/open|stop`)。tmux の巡回と
//   フックの受け口はここにしか無い
// - 入口そのもの (`/_entry`: 本人確認・`/_entry/open`: このディレクトリを開く・
//   `/_entry/restart`: 落ちた裏を起こし直す)
// 裏へ取り次ぐもの: `/p/<鍵>/…` の残り全部 (リポジトリ決め打ちの処理)。裏は
// プロジェクトごとに起こす今のサーバ (`--backend`)。
//
// プロジェクトに依らない処理でも、シェルの作業場所・「このリポジトリの
// ペインか」など、選んでいるプロジェクトで決まるものがある。画面は要求に
// PROJECT_HEADER で鍵を付ける (core/api-url.ts)。無ければ起動したディレクトリ。
//
// 前置きの無い画面の URL (`/`・`/file?…` の古いブックマーク) は、最後に開いた
// プロジェクト (ユーザー単位の設定 lastProjectRoot)、無ければ起動した
// ディレクトリのプロジェクトへ送る。

import { readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_HEADER } from "../../core/api-url";
import { hasControlCharacter } from "../../core/control-chars";
import { errorWithCause, formatErrorDetail } from "../../core/error-detail";
import type { ProjectOpenResponse } from "../../core/projects";
import type { EntryBackendFailure } from "../../core/types";
import {
  configureExternalCommands,
  parseExternalCommandOverride,
} from "../command-resolver";
import {
  json,
  parseBoundedJsonBody,
  textError,
} from "../database/handle-shared";
import * as git from "../git";
import { openUrlInOs } from "../os-opener";
import { ProjectRegistryError } from "../projects/registry";
import {
  changeProjects,
  defaultProjectServerDeps,
  stopLaunchedServer,
} from "../projects/service";
import { requestAllowed, sideEffectRequestAllowed } from "../request-origin";
import { ROOT } from "../root";
import { startServer } from "../runtime";
import { loadAppSettingsState } from "../state-store";
import { isAppEntryPath, staticFile } from "../static-files";
import type { ListTmuxPanesOptions } from "../tmux/panes";
import {
  patchUserSettings,
  readUserSettings,
  userSettingsPath,
} from "../user-settings";
import type { WorktreeOpenResult } from "../worktree/open";
import {
  decideEntryLaunch,
  type EntryArgs,
  parseEntryArgs,
  type RunningEntry,
} from "./args";
import {
  createEntryBackends,
  defaultEntryBackendsDeps,
  type EntryBackends,
} from "./backends";
import {
  acquireEntryStartLock,
  entryProcessAlive,
  readEntryRecord,
  removeEntryRecord,
  writeEntryRecord,
} from "./entry-file";
import { createEntryProjects, type EntryProjects } from "./projects";
import { isConnectionFailure, proxyToBackend } from "./proxy";

const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
  .version as string;

/** 入口の本人確認の待ち時間。ローカルなので短く。 */
const IDENTITY_TIMEOUT_MS = 1500;
/** 別の CLI が入口を起こしている間、待つ上限。 */
const START_WAIT_MS = 20_000;
const START_POLL_MS = 150;
/** `/_entry/open`・`/_entry/restart` の本文の上限。パスか鍵だけが来る。 */
const MAX_ENTRY_BODY_BYTES = 16 * 1024;
const ENTRY_ONLY_WORKTREE_PATHS = new Set([
  "/_worktree/open",
  "/_worktree/stop",
]);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** 起動したディレクトリ。git の中なら作業ツリーの根 (preview.ts と同じ決め方)。 */
function resolveLaunchRoot(cwd: string | null): string {
  let dir: string;
  try {
    dir = realpathSync(cwd ?? process.cwd());
    if (!statSync(dir).isDirectory())
      throw new Error(`${dir} is not a directory`);
  } catch (error) {
    fail(
      `--cwd must point to an existing directory\n${formatErrorDetail(error)}`,
    );
  }
  const result = git.repoRootResult(dir);
  if (result.kind !== "root") return dir;
  let root: string;
  try {
    root = realpathSync(result.root);
  } catch (error) {
    fail(
      `cannot resolve the repository root ${result.root}\n${formatErrorDetail(error)}`,
    );
  }
  // --cwd でサブディレクトリを明示したら、そのディレクトリのまま (preview.ts と同じ)。
  return cwd === null || root === dir ? root : dir;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

/** entry.json を読み、生きている入口かを本人確認 (`/_entry`) で確かめる。 */
export async function findRunningEntry(): Promise<RunningEntry> {
  const read = readEntryRecord();
  if (read.ok === false) return { status: "broken", detail: read.error };
  const entry = read.registry;
  if (!entry || !entryProcessAlive(entry)) return { status: "none" };
  let res: Response;
  try {
    res = await fetchWithTimeout(
      new URL("_entry", entry.url).href,
      { redirect: "error" },
      IDENTITY_TIMEOUT_MS,
    );
  } catch (error) {
    // 何も待ち受けていない = 落ちた入口の記録 (pid は別のプロセスに使い回された)。
    if (isConnectionFailure(error)) return { status: "none" };
    return {
      status: "broken",
      detail: `the entry server at ${entry.url} (pid ${entry.pid}) did not answer:\n${formatErrorDetail(error)}`,
    };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (error) {
    return {
      status: "broken",
      detail: `the entry server at ${entry.url} returned ${res.status} that is not JSON:\n${formatErrorDetail(error)}`,
    };
  }
  const identity = body as { role?: unknown; pid?: unknown; version?: unknown };
  if (!res.ok || identity.role !== "entry" || identity.pid !== entry.pid) {
    return {
      status: "broken",
      detail: `the server at ${entry.url} is not the entry server recorded for pid ${entry.pid} (HTTP ${res.status}: ${JSON.stringify(body)})`,
    };
  }
  return {
    status: "running",
    url: entry.url,
    pid: entry.pid,
    version: typeof identity.version === "string" ? identity.version : "",
  };
}

/** 動いている入口に「このディレクトリを開いて」を送り、開く URL を返す。 */
async function delegateOpen(entryUrl: string, path: string): Promise<string> {
  const origin = new URL(entryUrl).origin;
  let res: Response;
  try {
    res = await fetchWithTimeout(
      new URL("_entry/open", entryUrl).href,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify({ path }),
      },
      30_000,
    );
  } catch (error) {
    throw errorWithCause(
      `could not reach the code-viewer entry server at ${entryUrl}`,
      error,
    );
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `the code-viewer entry server at ${entryUrl} could not open ${path} (HTTP ${res.status}):\n${text}`,
    );
  }
  const body = JSON.parse(text) as { url?: unknown };
  if (typeof body.url !== "string") {
    throw new Error(`the entry server returned no URL: ${text}`);
  }
  return body.url;
}

function errorJson(
  status: number,
  code: string,
  error: string,
  extra: Record<string, unknown> = {},
): Response {
  return json({ error, code, ...extra }, status);
}

export async function runEntry(argv: readonly string[]): Promise<void> {
  const parsed = parseEntryArgs(argv);
  if (parsed.ok === false) fail(parsed.error);
  const args: EntryArgs = parsed.args;
  const overrides = [];
  for (const bin of args.bins) {
    const override = parseExternalCommandOverride(bin);
    if (override.ok === false) fail(override.error);
    overrides.push(override.override);
  }
  const launchRoot = resolveLaunchRoot(args.cwd);
  const commandConfig = configureExternalCommands({
    cwd: launchRoot,
    cliOverrides: overrides,
  });
  if (commandConfig.ok === false) fail(commandConfig.error);

  // 動いている入口があればそちらへ。無ければ起動ロックを取って自分が入口になる。
  const deadline = Date.now() + START_WAIT_MS;
  let lock: ReturnType<typeof acquireEntryStartLock> = null;
  while (!lock) {
    const decision = decideEntryLaunch(await findRunningEntry(), VERSION);
    if (decision.kind === "broken") {
      fail(
        `code-viewer cannot tell whether an entry server is running:\n${decision.detail}`,
      );
    }
    if (decision.kind === "other-version") {
      fail(
        `a code-viewer entry server of another version (${decision.version || "unknown"}) is running at ${decision.url} (pid ${decision.pid}).\nStop it, then start code-viewer again. This one (${VERSION}) was not started.`,
      );
    }
    if (decision.kind === "delegate") {
      const url = await delegateOpen(decision.url, launchRoot);
      if (args.port !== 0 && new URL(decision.url).port !== String(args.port)) {
        console.warn(
          `code-viewer is already running at ${decision.url}; --port ${args.port} was not used.`,
        );
      }
      if (args.backendArgs.length > 0 || args.bins.length > 0) {
        console.warn(
          `code-viewer is already running; the server options (${[...args.bins.map((b) => `--bin ${b}`), ...args.backendArgs].join(" ")}) apply only when that project's process starts.`,
        );
      }
      console.log(url);
      if (args.open) await openUrlInOs(url, launchRoot);
      return;
    }
    lock = acquireEntryStartLock();
    if (lock) break;
    if (Date.now() > deadline) {
      fail(
        "another code-viewer is starting the entry server and did not finish in time",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, START_POLL_MS));
  }
  // ロックを取った後にもう一度見る (取る直前に別の CLI が起動を終えていたら使う)。
  const recheck = await findRunningEntry();
  if (recheck.status === "running") {
    lock.release();
    await runEntry(argv);
    return;
  }

  const projects = createEntryProjects();
  const launchKey = projects.allow(launchRoot);
  const launchArgs = [
    ...args.bins.flatMap((bin) => ["--bin", bin]),
    ...args.backendArgs,
  ];
  const backends = createEntryBackends(
    defaultEntryBackendsDeps(process.pid, (root) =>
      root === launchRoot ? launchArgs : [],
    ),
  );
  const context: EntryContext = {
    url: "",
    startedAt: new Date().toISOString(),
    launchRoot,
    projects,
    backends,
    lastProject: createLastProject(launchRoot),
    paneListOptions: {
      worktreePaths: (root) => git.worktreePathsAsync(root),
    },
  };
  let server: Awaited<ReturnType<typeof startServer>>;
  try {
    server = await startServer({
      hostname: "127.0.0.1",
      port: args.port,
      fetch: (req) => handleEntryRequest(req, context),
    });
  } catch (error) {
    lock.release();
    fail(
      `code-viewer could not start the entry server on port ${args.port}:\n${formatErrorDetail(error)}`,
    );
  }
  const url = `http://127.0.0.1:${server.port}/`;
  context.url = url;
  try {
    writeEntryRecord({
      url,
      pid: process.pid,
      version: VERSION,
      started_at: context.startedAt,
    });
  } finally {
    lock.release();
  }

  await registerLaunchRoot(launchRoot);

  let shuttingDown = false;
  async function shutdown(exitCode = 0): Promise<void> {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    try {
      removeEntryRecord(process.pid);
    } catch (error) {
      exitCode = 1;
      console.error(
        `code-viewer entry record cleanup failed:\n${formatErrorDetail(error)}`,
      );
    }
    try {
      const [{ closeShellStreams }, { closeAllShellSessions }] =
        await Promise.all([
          import("../shell/handle"),
          import("../shell/session"),
        ]);
      closeShellStreams();
      const closed = await closeAllShellSessions();
      if (closed.status === "error") {
        exitCode = 1;
        console.error(
          `code-viewer shell close failed:\n${formatErrorDetail(closed.error)}`,
        );
      }
    } catch (error) {
      exitCode = 1;
      console.error(
        `code-viewer shell close failed:\n${formatErrorDetail(error)}`,
      );
    }
    const { stopAgentActivityWatch } = await import("../terminal/activity");
    stopAgentActivityWatch();
    try {
      await server.close();
    } catch (error) {
      console.warn(`code-viewer entry server close skipped: ${String(error)}`);
    }
    process.exit(exitCode);
  }
  process.on("uncaughtException", (error) => {
    console.error(
      "[code-viewer] uncaught exception (entry server kept running):",
      error,
    );
  });
  process.on("unhandledRejection", (reason) => {
    console.error(
      "[code-viewer] unhandled rejection (entry server kept running):",
      reason,
    );
  });
  process.on("exit", () => {
    if (shuttingDown) return;
    try {
      removeEntryRecord(process.pid);
    } catch (error) {
      process.exitCode = 1;
      console.error(
        `code-viewer entry record cleanup failed:\n${formatErrorDetail(error)}`,
      );
    }
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => void shutdown(0));
  }
  if (process.env.CODE_VIEWER_DEV === "1") {
    const parentPid = process.ppid;
    setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch {
        console.log("dev wrapper exited; shutting down the entry server");
        void shutdown(0);
      }
    }, 1000).unref();
  }
  // 開発中の読み直し (index.html・style.css・app.js) は裏の SSE が送る
  // (裏も CODE_VIEWER_DEV を受け継ぎ、startDevAssetReload を動かす)。

  const { startAgentActivityWatch } = await import("../terminal/activity");
  startAgentActivityWatch(launchRoot, context.paneListOptions);

  const openUrl = `${url}p/${launchKey}/`;
  console.log(`GDP_LISTEN_URL=${url}`);
  console.log(`code-viewer entry server: ${openUrl}`);
  if (args.open) await openUrlInOs(openUrl, launchRoot);
}

/** 起動したディレクトリを登録簿に載せる (git の中なら。載っていればそのまま)。 */
async function registerLaunchRoot(root: string): Promise<void> {
  if (git.repoRootResult(root).kind !== "root") return;
  try {
    await changeProjects({ action: "add", path: root }, root);
  } catch (error) {
    if (error instanceof ProjectRegistryError && error.code === "conflict")
      return;
    // 登録できなくても、起動したディレクトリは開ける (projects.allow 済み)。
    // 理由は起動の出力に全部出す。
    console.error(
      `code-viewer could not register ${root} as a project:\n${formatErrorDetail(error)}`,
    );
  }
}

type LastProject = {
  get(): string | null;
  remember(root: string): Promise<void>;
  /** 最後に覚えられなかった理由 (`/_entry` に出す)。 */
  error(): string;
};

function createLastProject(launchRoot: string): LastProject {
  let last: string | null = null;
  let failure = "";
  try {
    last = readUserSettings(userSettingsPath())?.lastProjectRoot ?? null;
  } catch (error) {
    failure = formatErrorDetail(error);
    console.error(`code-viewer could not read the last project:\n${failure}`);
  }
  last ??= launchRoot;
  let current: string | null = null;
  return {
    get: () => last,
    error: () => failure,
    async remember(root) {
      last = root;
      if (current === root) return;
      current = root;
      try {
        await patchUserSettings(
          userSettingsPath(),
          { lastProjectRoot: root },
          await loadAppSettingsState(root),
        );
        failure = "";
      } catch (error) {
        // 画面は出せる (覚えられないのは次の `/` の行き先だけ)。理由は残す。
        current = null;
        failure = formatErrorDetail(error);
        console.error(
          `code-viewer could not remember the last project ${root}:\n${failure}`,
        );
      }
    },
  };
}

type EntryContext = {
  url: string;
  startedAt: string;
  launchRoot: string;
  projects: EntryProjects;
  backends: EntryBackends;
  lastProject: LastProject;
  paneListOptions: ListTmuxPanesOptions;
};

function projectUrl(ctx: EntryContext, root: string, requestUrl: URL): string {
  return new URL(`/p/${ctx.projects.keyOf(root)}/`, requestUrl).href;
}

/** 前置きの無い画面の URL を、最後に開いたプロジェクトへ送る。 */
async function redirectToLastProject(
  ctx: EntryContext,
  url: URL,
  path: string,
): Promise<Response> {
  let root = ctx.lastProject.get() ?? ctx.launchRoot;
  const found = await ctx.projects.lookup(ctx.projects.keyOf(root));
  if (found.status !== "found") root = ctx.launchRoot;
  const key = ctx.projects.keyOf(root);
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/p/${key}${path}${url.search}`,
      "Cache-Control": "no-store",
    },
  });
}

/** 入口宛ての要求の、選んでいるプロジェクト (見出し)。無ければ null。 */
async function selectedRoot(
  ctx: EntryContext,
  req: Request,
): Promise<string | null> {
  const key = req.headers.get(PROJECT_HEADER);
  if (!key) return null;
  const found = await ctx.projects.lookup(key);
  if (found.status === "found") return found.root;
  console.warn(
    `[code-viewer] entry: the request names project ${key}, which is ${found.status === "error" ? `not resolvable (${found.error})` : "not known"}; using ${ctx.launchRoot}`,
  );
  return null;
}

async function readPathBody(
  req: Request,
  field: string,
): Promise<string | Response> {
  const body = await parseBoundedJsonBody(
    req,
    MAX_ENTRY_BODY_BYTES,
    "entry request too large",
  );
  if (body instanceof Response) return body;
  const value = (body as Record<string, unknown> | null)?.[field];
  if (typeof value !== "string" || !value || hasControlCharacter(value)) {
    return errorJson(400, "invalid", `${field} is required`);
  }
  return value;
}

async function handleEntryOpen(
  ctx: EntryContext,
  req: Request,
  url: URL,
): Promise<Response> {
  const path = await readPathBody(req, "path");
  if (path instanceof Response) return path;
  if (!path.startsWith("/"))
    return errorJson(400, "invalid", "path must be an absolute path");
  let dir: string;
  try {
    dir = realpathSync(path);
  } catch (error) {
    return errorJson(
      404,
      "not-found",
      `${path} does not exist: ${formatErrorDetail(error)}`,
    );
  }
  const repo = git.repoRootResult(dir);
  const root = repo.kind === "root" ? realpathSync(repo.root) : dir;
  if (repo.kind === "root") await registerLaunchRoot(root);
  const key = ctx.projects.allow(root);
  return json({ url: projectUrl(ctx, root, url), key, root });
}

function backendFailure(
  status: 502 | 503,
  key: string,
  root: string,
  target: { detail: string; log: string },
): Response {
  const body: EntryBackendFailure = {
    error:
      status === 502
        ? "the process for this project stopped"
        : "the process for this project did not start",
    code: status === 502 ? "backend-stopped" : "backend-start-failed",
    project: { key, root },
    detail: target.detail,
    log: target.log,
  };
  return json(body, status);
}

async function handleEntryRestart(
  ctx: EntryContext,
  req: Request,
): Promise<Response> {
  const key = await readPathBody(req, "key");
  if (key instanceof Response) return key;
  const found = await ctx.projects.lookup(key);
  if (found.status === "unknown")
    return errorJson(404, "unknown-project", `project ${key} is not known`);
  if (found.status === "error") return errorJson(500, "failed", found.error);
  const result = await ctx.backends.restart(found.root);
  if (result.status === "ok")
    return json({ ok: true, started: result.started });
  return backendFailure(503, key, found.root, result);
}

async function handleProjectPath(
  ctx: EntryContext,
  req: Request,
  url: URL,
): Promise<Response> {
  const match = /^\/p\/([^/]+)(\/.*)?$/.exec(url.pathname);
  if (!match) return textError("not found", 404);
  const key = match[1] ?? "";
  const rest = match[2];
  const found = await ctx.projects.lookup(key);
  if (found.status === "unknown") {
    return errorJson(
      404,
      "unknown-project",
      `project ${key} is not registered; open it from the project list or run code-viewer in its folder`,
      { project: { key } },
    );
  }
  if (found.status === "error") return errorJson(500, "failed", found.error);
  const root = found.root;
  if (!rest) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/p/${key}/${url.search}`,
        "Cache-Control": "no-store",
      },
    });
  }
  if (isAppEntryPath(rest)) {
    await ctx.lastProject.remember(root);
    // 画面を返している間に裏を起こし始める (最初の取得を待たせる時間を縮める)。
    // 失敗はその取得が 503 と理由で受け取る。
    void ctx.backends.target(root);
    return staticFile(rest) ?? textError("not found", 404);
  }
  const events = rest === "/events";
  const target = await ctx.backends.target(root, { events });
  if (target.status === "failed") return backendFailure(503, key, root, target);
  if (target.status === "stopped")
    return backendFailure(502, key, root, target);
  const result = await proxyToBackend(req, target.url, rest, url.search, {
    onBodyEnd: events ? ctx.backends.subscribe(root) : undefined,
  });
  if (result.status === "ok") return result.response;
  if (req.signal.aborted) return textError("the request was cancelled", 499);
  if (isConnectionFailure(result.error)) {
    const down = ctx.backends.noteUnreachable(root, result.error);
    if (down.status === "stopped") return backendFailure(502, key, root, down);
  }
  console.error(
    `[code-viewer] entry: forwarding ${req.method} ${url.pathname} failed`,
    result.error,
  );
  return errorJson(
    502,
    "proxy-failed",
    `forwarding ${req.method} ${rest} to the project process failed`,
    {
      project: { key, root },
      detail: formatErrorDetail(result.error),
      log: "",
    },
  );
}

async function handleEntryRequest(
  req: Request,
  ctx: EntryContext,
): Promise<Response> {
  if (!requestAllowed(req)) return textError("forbidden", 403);
  const url = new URL(req.url);
  const path = url.pathname;
  if (path === "/_entry" && req.method === "GET") {
    return json({
      role: "entry",
      pid: process.pid,
      version: VERSION,
      url: ctx.url,
      startedAt: ctx.startedAt,
      launchRoot: ctx.launchRoot,
      lastProjectError: ctx.lastProject.error(),
    });
  }
  if (path === "/_entry/open" || path === "/_entry/restart") {
    if (req.method !== "POST") return textError("method not allowed", 405);
    if (!sideEffectRequestAllowed(req)) return textError("forbidden", 403);
    return path === "/_entry/open"
      ? handleEntryOpen(ctx, req, url)
      : handleEntryRestart(ctx, req);
  }
  if (path === "/p" || path === "/p/")
    return redirectToLastProject(ctx, url, "/");
  if (path.startsWith("/p/")) return handleProjectPath(ctx, req, url);
  if (isAppEntryPath(path)) {
    return redirectToLastProject(ctx, url, path === "/index.html" ? "/" : path);
  }
  const asset = staticFile(path);
  if (asset) return asset;

  const isAgent = path.startsWith("/_agent/");
  const isTmux = path.startsWith("/_tmux/");
  const isShell = path.startsWith("/_shell/");
  const isWorktree = ENTRY_ONLY_WORKTREE_PATHS.has(path);
  if (!isAgent && !isTmux && !isShell && !isWorktree) {
    return textError("not found", 404);
  }
  const selected = await selectedRoot(ctx, req);
  const cwd = selected ?? ctx.launchRoot;
  if (isShell) {
    const { handleShellRoute } = await import("../shell/handle");
    return (
      (await handleShellRoute(req, url, cwd, sideEffectRequestAllowed)) ??
      textError("not found", 404)
    );
  }
  if (isTmux) {
    const { handleTmuxRoute } = await import("../tmux/handle");
    return (
      (await handleTmuxRoute(
        req,
        url,
        cwd,
        sideEffectRequestAllowed,
        ctx.paneListOptions,
      )) ?? textError("not found", 404)
    );
  }
  if (isWorktree) {
    const { handleWorktreeRoute } = await import("../worktree/handle");
    return (
      (await handleWorktreeRoute(req, url, cwd, 0, sideEffectRequestAllowed, {
        open: (worktree) => openWorktreeInEntry(ctx, worktree, url),
        stop: (worktree) => ctx.backends.stop(worktree),
      })) ?? textError("not found", 404)
    );
  }
  const { handleAgentRoute } = await import("../terminal/handle");
  return (
    (await handleAgentRoute(req, url, cwd, sideEffectRequestAllowed, {
      selectedRoot: selected ?? "",
      serverUrl: (root) => projectUrl(ctx, root, url),
      openProject: (root) => openProjectInEntry(ctx, root, url),
      stopProject: (root) =>
        stopLaunchedServer(root, selected ?? "", {
          ...defaultProjectServerDeps(),
          running: (target) => ctx.backends.running(target),
          stop: (target) => ctx.backends.stop(target),
        }),
    })) ?? textError("not found", 404)
  );
}

async function openProjectInEntry(
  ctx: EntryContext,
  root: string,
  requestUrl: URL,
): Promise<ProjectOpenResponse> {
  const found = await ctx.projects.lookup(ctx.projects.keyOf(root));
  if (found.status === "error")
    throw new ProjectRegistryError(found.error, "unreadable");
  if (found.status === "unknown") {
    throw new ProjectRegistryError(
      `${root} is not a registered project; register it before opening it`,
      "not-found",
    );
  }
  let target = await ctx.backends.target(root);
  if (target.status === "stopped") target = await ctx.backends.restart(root);
  if (target.status !== "ok") {
    throw new ProjectRegistryError(
      [target.detail, target.log].filter(Boolean).join("\n"),
      "failed",
    );
  }
  return {
    url: projectUrl(ctx, root, requestUrl),
    started: target.started,
  };
}

async function openWorktreeInEntry(
  ctx: EntryContext,
  path: string,
  requestUrl: URL,
): Promise<WorktreeOpenResult> {
  ctx.projects.allow(path);
  let target = await ctx.backends.target(path);
  if (target.status === "stopped") target = await ctx.backends.restart(path);
  if (target.status === "ok") {
    return {
      status: "ok",
      url: projectUrl(ctx, path, requestUrl),
      started: target.started,
    };
  }
  return {
    status: "error",
    error: new Error([target.detail, target.log].filter(Boolean).join("\n")),
  };
}
