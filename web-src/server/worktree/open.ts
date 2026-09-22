// 別の作業ツリー (と、登録したプロジェクト) で code-viewer を開く。
//
// 起動したサーバは親より長く動くため、registry で本人確認し、worktree 削除時に
// 停止する。起動途中の Promise は実パスごとに共有し、同じ要求が重なっても
// 子プロセスは 1 本だけ作る。
//
// 起こしたサーバには LAUNCHED_BY_ENV を渡す。サーバはそれを登録簿に
// `launched: true` として残し (preview.ts)、エージェント一覧は「code-viewer が
// 起こしたサーバ」だけを止められるようにする。

import { type ChildProcess, spawn } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  errorWithCause,
  errorWithCauses,
  formatErrorDetail,
} from "../../core/error-detail";
import type { SettingsResponse } from "../../core/types";
import { createLinkedAbortController } from "../abort";
import { isEntryToken } from "../entry/entry-file";
import {
  acquireServerStartLock,
  parseServerRegistryUrl,
  readServerRegistry,
  removeServerRegistry,
  type ServerRegistryEntry,
} from "../server-registry";

/** 起こしたサーバに渡す印。サーバは読んだらすぐ自分の環境から消す。 */
export const LAUNCHED_BY_ENV = "CODE_VIEWER_LAUNCHED_BY";

export type WorktreeOpenResult =
  | { status: "ok"; url: string; started: boolean }
  | { status: "missing" }
  | { status: "timeout" }
  | { status: "error"; error: unknown };

export type RunningWorktreeServerResult =
  | {
      status: "running";
      url: string;
      pid: number;
      launched: boolean;
      backend?: boolean;
    }
  | { status: "absent" }
  | { status: "unreachable"; error: unknown }
  | { status: "invalid"; error: unknown };

export type RunningWorktreeServerOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type SpawnOptions = {
  /** 待ち受けるポート。無ければ 0 (OS が選ぶ)。 */
  port?: number;
  /**
   * 子の標準出力とエラー出力を書くファイル。起動に失敗したとき、その末尾を
   * 理由として返す。無ければ捨てる。
   */
  logFile?: string;
  /**
   * 入口のサーバの pid。渡すと、子は入口の裏のプロセス (`--backend`) として
   * 起き、入口が居なくなったら自分で終わる。無ければ今までどおりの 1 つで
   * 完結したサーバ (`--standalone`)。
   */
  backendOf?: number;
  /** `backendOf` の入口が起動ごとに作る本人確認 token。 */
  backendToken?: string;
  /** 子に足す引数 (`--bin`・git の差分の引数など)。 */
  serverArgs?: readonly string[];
};

type SpawnedServer = {
  onError(listener: (error: Error) => void): void;
  /** 登録簿に出る前に終わったことを知る。 */
  onExit(listener: (code: number | null, signal: string | null) => void): void;
  terminate(): Promise<void>;
  unref(): void;
};

type WorktreeServerRuntime = {
  delay(ms: number): Promise<void>;
  fetch(input: string, init: RequestInit): Promise<Response>;
  now(): number;
  pollIntervalMs: number;
  spawnServer(path: string, options: SpawnOptions): SpawnedServer;
  startTimeoutMs: number;
  terminatePid(pid: number): Promise<void>;
};

const START_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 150;
const HEALTH_TIMEOUT_MS = 1_500;
const STOP_GRACE_MS = 2_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (errno(error) === "ESRCH") return false;
    if (errno(error) === "EPERM") return true;
    throw error;
  }
}

/** 登録簿の鍵 (実パス。無いパスはそのまま)。起こす側と確かめる側で揃える。 */
export function registryKey(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if (errno(error) === "ENOENT") return path;
    throw error;
  }
}

function settingsIdentity(value: unknown): SettingsResponse["server"] | null {
  if (!value || typeof value !== "object") return null;
  const server = (value as { server?: unknown }).server;
  if (!server || typeof server !== "object") return null;
  const identity = server as Record<string, unknown>;
  if (
    !Number.isInteger(identity.pid) ||
    (identity.pid as number) < 1 ||
    typeof identity.root !== "string" ||
    !identity.root
  ) {
    return null;
  }
  return { pid: identity.pid as number, root: identity.root };
}

async function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    const onClose = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    const finish = (exited: boolean) => {
      clearTimeout(timer);
      child.off("close", onClose);
      resolve(exited);
    };
    child.once("close", onClose);
  });
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  if (await waitForChildExit(child, STOP_GRACE_MS)) return;
  child.kill("SIGKILL");
  if (!(await waitForChildExit(child, STOP_GRACE_MS))) {
    throw new Error("spawned worktree server did not stop after SIGKILL");
  }
}

function spawnServer(path: string, options: SpawnOptions): SpawnedServer {
  const entry = process.argv[1];
  if (!entry) throw new Error("cannot locate code-viewer entry point");
  const ownerError = backendOwnerOptionsError(options);
  if (ownerError) throw ownerError;
  const out = options.logFile ? openLogFile(options.logFile) : "ignore";
  let child: ChildProcess;
  try {
    child = spawn(
      process.execPath,
      [
        ...process.execArgv,
        entry,
        "--cwd",
        path,
        "--port",
        String(options.port ?? 0),
        ...(options.backendOf === undefined
          ? ["--standalone"]
          : [
              "--backend",
              "--entry-pid",
              String(options.backendOf),
              "--entry-token",
              options.backendToken as string,
            ]),
        ...(options.serverArgs ?? []),
      ],
      {
        cwd: path,
        detached: true,
        stdio: ["ignore", out, out],
        env: { ...process.env, [LAUNCHED_BY_ENV]: "code-viewer" },
      },
    );
  } finally {
    // 子が自分の複製を持ったので、親の分は閉じる。
    if (typeof out === "number") closeSync(out);
  }
  return {
    onError(listener) {
      child.once("error", listener);
    },
    onExit(listener) {
      child.once("exit", listener);
    },
    terminate: () => terminateChild(child),
    unref: () => child.unref(),
  };
}

function backendOwnerOptionsError(options: SpawnOptions): Error | null {
  if (options.backendOf === undefined && options.backendToken === undefined) {
    return null;
  }
  if (
    !Number.isInteger(options.backendOf) ||
    (options.backendOf as number) < 1 ||
    !isEntryToken(options.backendToken)
  ) {
    return new Error(
      "a project process requires both a valid entry pid and entry token",
    );
  }
  return null;
}

function openLogFile(file: string): number {
  mkdirSync(dirname(file), { recursive: true });
  return openSync(file, "w", 0o600);
}

/** 起動に失敗したときの理由に添える、子の出力の末尾。 */
const LOG_TAIL_BYTES = 8_000;

export function logTail(file: string | undefined): string {
  if (!file) return "";
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    return `(the server output ${file} could not be read: ${formatErrorDetail(error)})`;
  }
  const tail =
    text.length > LOG_TAIL_BYTES ? text.slice(-LOG_TAIL_BYTES) : text;
  return tail.trim()
    ? `server output (${file}):\n${tail.trimEnd()}`
    : `the server wrote nothing to ${file}`;
}

async function signalProcess(
  pid: number,
  signal: NodeJS.Signals,
): Promise<void> {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (errno(error) === "ESRCH") return;
    throw error;
  }
}

async function terminatePid(pid: number): Promise<void> {
  await signalProcess(pid, "SIGTERM");
  const deadline = Date.now() + STOP_GRACE_MS;
  while (processAlive(pid) && Date.now() < deadline) await delay(50);
  if (!processAlive(pid)) return;
  await signalProcess(pid, "SIGKILL");
  const killDeadline = Date.now() + STOP_GRACE_MS;
  while (processAlive(pid) && Date.now() < killDeadline) await delay(50);
  if (processAlive(pid)) {
    throw new Error(`worktree server process ${pid} did not stop`);
  }
}

const DEFAULT_RUNTIME: WorktreeServerRuntime = {
  delay,
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  pollIntervalMs: POLL_INTERVAL_MS,
  spawnServer,
  startTimeoutMs: START_TIMEOUT_MS,
  terminatePid,
};

export function createWorktreeServerController(
  overrides: Partial<WorktreeServerRuntime> = {},
) {
  const runtime = { ...DEFAULT_RUNTIME, ...overrides };
  const opening = new Map<string, Promise<WorktreeOpenResult>>();

  async function runningServerResult(
    path: string,
    options: RunningWorktreeServerOptions = {},
  ): Promise<RunningWorktreeServerResult> {
    let key: string;
    let entry: ServerRegistryEntry | null;
    try {
      key = registryKey(path);
      entry = readServerRegistry(key);
    } catch (error) {
      return { status: "invalid", error };
    }
    if (!entry) return { status: "absent" };
    if (entry.root !== key) {
      return {
        status: "invalid",
        error: new Error("server registry root does not match its file key"),
      };
    }
    let url: URL;
    try {
      url = parseServerRegistryUrl(entry.url);
      if (!processAlive(entry.pid)) return { status: "absent" };
    } catch (error) {
      return { status: "invalid", error };
    }
    let response: Response;
    const healthAbort = createLinkedAbortController(
      options.signal,
      options.timeoutMs ?? HEALTH_TIMEOUT_MS,
    );
    try {
      response = await runtime.fetch(new URL("_settings", url).href, {
        redirect: "error",
        signal: healthAbort.signal,
      });
    } catch (error) {
      return { status: "unreachable", error };
    } finally {
      healthAbort.cleanup();
    }
    if (!response.ok) {
      return {
        status: "unreachable",
        error: new Error(
          `registered server health check returned ${response.status}`,
        ),
      };
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      return {
        status: "invalid",
        error: errorWithCause(
          "registered server returned invalid settings",
          error,
        ),
      };
    }
    const identity = settingsIdentity(body);
    if (!identity || identity.pid !== entry.pid || identity.root !== key) {
      return {
        status: "invalid",
        error: new Error(
          "registered server identity does not match the registry",
        ),
      };
    }
    return {
      status: "running",
      url: url.href,
      pid: entry.pid,
      launched: entry.launched === true,
      backend: entry.backend === true,
    };
  }

  async function reuseRunningServer(
    existing: Extract<RunningWorktreeServerResult, { status: "running" }>,
    options: SpawnOptions,
  ): Promise<WorktreeOpenResult> {
    const ownerError = backendOwnerOptionsError(options);
    if (ownerError) return { status: "error", error: ownerError };
    if (options.backendOf === undefined || !existing.backend) {
      return { status: "ok", url: existing.url, started: false };
    }
    const url = new URL(existing.url);
    const adoptionAbort = createLinkedAbortController(
      undefined,
      HEALTH_TIMEOUT_MS,
    );
    let response: Response;
    try {
      response = await runtime.fetch(new URL("_entry/adopt", url).href, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: url.origin,
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify({
          pid: options.backendOf,
          token: options.backendToken,
        }),
        redirect: "error",
        signal: adoptionAbort.signal,
      });
    } catch (error) {
      return {
        status: "error",
        error: errorWithCause(
          "could not tell the existing project process about the new entry owner",
          error,
        ),
      };
    } finally {
      adoptionAbort.cleanup();
    }
    const detail = await response.text();
    if (response.status === 404) {
      return {
        status: "error",
        error: new Error(
          `a project process of another version is running at ${existing.url} (pid ${existing.pid}); it does not support entry token adoption. Stop it, then try again.\n${detail}`,
        ),
      };
    }
    if (!response.ok) {
      return {
        status: "error",
        error: new Error(
          `the existing project process refused the new entry owner (HTTP ${response.status}):\n${detail}`,
        ),
      };
    }
    return { status: "ok", url: existing.url, started: false };
  }

  async function spawnWhileLocked(
    key: string,
    deadline: number,
    options: SpawnOptions,
  ): Promise<WorktreeOpenResult> {
    const existing = await runningServerResult(key);
    if (existing.status === "running") {
      return reuseRunningServer(existing, options);
    }
    if (existing.status === "invalid" || existing.status === "unreachable") {
      return { status: "error", error: existing.error };
    }

    let child: SpawnedServer;
    try {
      child = runtime.spawnServer(key, options);
    } catch (error) {
      return { status: "error", error };
    }
    let spawnError: Error | null = null;
    child.onError((error) => {
      spawnError = error;
    });
    // 登録簿に出る前に終わった (ポートが使えない・リポジトリが読めない等)。
    // 時間切れまで待たず、子の出力の末尾を理由にしてすぐ返す。
    let exited: Error | null = null;
    child.onExit((code, signal) => {
      exited = new Error(
        [
          `the code-viewer server for ${key} exited before it was ready (${
            signal ? `signal ${signal}` : `exit code ${code}`
          })`,
          logTail(options.logFile),
        ]
          .filter(Boolean)
          .join("\n"),
      );
    });
    child.unref();

    const stopAfterFailure = async (
      result: Exclude<WorktreeOpenResult, { status: "ok" }>,
    ): Promise<WorktreeOpenResult> => {
      try {
        await child.terminate();
        return result;
      } catch (error) {
        const startupError =
          result.status === "error"
            ? result.error
            : new Error(`worktree server startup ended with ${result.status}`);
        return {
          status: "error",
          error: errorWithCauses(
            "failed to stop an unsuccessful worktree server",
            [startupError, error],
          ),
        };
      }
    };

    try {
      while (runtime.now() < deadline) {
        await runtime.delay(runtime.pollIntervalMs);
        if (spawnError) {
          return stopAfterFailure({ status: "error", error: spawnError });
        }
        if (exited) return { status: "error", error: exited };
        const found = await runningServerResult(key);
        if (found.status === "running") {
          return { status: "ok", url: found.url, started: true };
        }
        if (found.status === "invalid") {
          return stopAfterFailure({ status: "error", error: found.error });
        }
      }
      const tail = logTail(options.logFile);
      return stopAfterFailure(
        tail
          ? {
              status: "error",
              error: new Error(
                `the code-viewer server for ${key} was not ready within ${Math.round(runtime.startTimeoutMs / 1000)} seconds\n${tail}`,
              ),
            }
          : { status: "timeout" },
      );
    } catch (error) {
      return stopAfterFailure({ status: "error", error });
    }
  }

  async function doOpen(
    path: string,
    options: SpawnOptions,
  ): Promise<WorktreeOpenResult> {
    const ownerError = backendOwnerOptionsError(options);
    if (ownerError) return { status: "error", error: ownerError };
    let key: string;
    try {
      key = realpathSync(path);
    } catch (error) {
      if (errno(error) === "ENOENT") return { status: "missing" };
      return { status: "error", error };
    }
    const deadline = runtime.now() + runtime.startTimeoutMs;
    while (runtime.now() < deadline) {
      const existing = await runningServerResult(key);
      if (existing.status === "running") {
        return reuseRunningServer(existing, options);
      }
      if (existing.status === "invalid" || existing.status === "unreachable") {
        return { status: "error", error: existing.error };
      }

      let lock: ReturnType<typeof acquireServerStartLock>;
      try {
        lock = acquireServerStartLock(key, runtime.now());
      } catch (error) {
        return { status: "error", error };
      }
      if (!lock) {
        try {
          await runtime.delay(runtime.pollIntervalMs);
        } catch (error) {
          return { status: "error", error };
        }
        continue;
      }

      let result: WorktreeOpenResult;
      try {
        result = await spawnWhileLocked(key, deadline, options);
      } catch (error) {
        result = { status: "error", error };
      }
      try {
        lock.release();
      } catch (error) {
        return {
          status: "error",
          error:
            result.status === "error"
              ? errorWithCauses(
                  "worktree server start and lock release both failed",
                  [result.error, error],
                )
              : errorWithCause(
                  "worktree server start lock could not be released",
                  error,
                ),
        };
      }
      return result;
    }
    return { status: "timeout" };
  }

  function openWorktreeServer(
    path: string,
    options: SpawnOptions = {},
  ): Promise<WorktreeOpenResult> {
    let key: string;
    try {
      key = registryKey(path);
    } catch (error) {
      return Promise.resolve({ status: "error", error });
    }
    const pending = opening.get(key);
    if (pending) return pending;
    const started = doOpen(path, options).finally(() => {
      if (opening.get(key) === started) opening.delete(key);
    });
    opening.set(key, started);
    return started;
  }

  async function stopWorktreeServer(path: string): Promise<void> {
    const key = registryKey(path);
    const pending = opening.get(key);
    if (pending) await pending;
    const running = await runningServerResult(key);
    if (running.status === "absent") return;
    if (running.status !== "running") throw running.error;
    await runtime.terminatePid(running.pid);
    removeServerRegistry(key, running.pid);
  }

  return { openWorktreeServer, runningServerResult, stopWorktreeServer };
}

const DEFAULT_CONTROLLER = createWorktreeServerController();

export const openWorktreeServer = DEFAULT_CONTROLLER.openWorktreeServer;
export const runningServerResult = DEFAULT_CONTROLLER.runningServerResult;
export const stopWorktreeServer = DEFAULT_CONTROLLER.stopWorktreeServer;
