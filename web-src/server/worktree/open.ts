// 別の作業ツリーで code-viewer を開く。
//
// 起動したサーバは親より長く動くため、registry で本人確認し、worktree 削除時に
// 停止する。起動途中の Promise は実パスごとに共有し、同じ要求が重なっても
// 子プロセスは 1 本だけ作る。

import { type ChildProcess, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { errorWithCause, errorWithCauses } from "../../core/error-detail";
import type { SettingsResponse } from "../../core/types";
import { createLinkedAbortController } from "../abort";
import {
  acquireServerStartLock,
  readServerRegistry,
  removeServerRegistry,
  type ServerRegistryEntry,
} from "../server-registry";

export type WorktreeOpenResult =
  | { status: "ok"; url: string; started: boolean }
  | { status: "missing" }
  | { status: "timeout" }
  | { status: "error"; error: unknown };

export type RunningWorktreeServerResult =
  | { status: "running"; url: string; pid: number }
  | { status: "absent" }
  | { status: "unreachable"; error: unknown }
  | { status: "invalid"; error: unknown };

export type RunningWorktreeServerOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

type SpawnedServer = {
  onError(listener: (error: Error) => void): void;
  terminate(): Promise<void>;
  unref(): void;
};

type WorktreeServerRuntime = {
  delay(ms: number): Promise<void>;
  fetch(input: string, init: RequestInit): Promise<Response>;
  now(): number;
  pollIntervalMs: number;
  spawnServer(path: string): SpawnedServer;
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

function registryKey(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if (errno(error) === "ENOENT") return path;
    throw error;
  }
}

function registryUrl(entry: ServerRegistryEntry): URL {
  let url: URL;
  try {
    url = new URL(entry.url);
  } catch (error) {
    throw errorWithCause("server registry contains an invalid URL", error);
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("server registry URL must be an HTTP loopback root URL");
  }
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("server registry URL has an invalid port");
  }
  return url;
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

function spawnServer(path: string): SpawnedServer {
  const entry = process.argv[1];
  if (!entry) throw new Error("cannot locate code-viewer entry point");
  const child = spawn(
    process.execPath,
    [...process.execArgv, entry, "--cwd", path, "--port", "0"],
    { cwd: path, detached: true, stdio: "ignore", env: process.env },
  );
  return {
    onError(listener) {
      child.once("error", listener);
    },
    terminate: () => terminateChild(child),
    unref: () => child.unref(),
  };
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
      url = registryUrl(entry);
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
    return { status: "running", url: url.href, pid: entry.pid };
  }

  async function spawnWhileLocked(
    key: string,
    deadline: number,
  ): Promise<WorktreeOpenResult> {
    const existing = await runningServerResult(key);
    if (existing.status === "running") {
      return { status: "ok", url: existing.url, started: false };
    }
    if (existing.status === "invalid" || existing.status === "unreachable") {
      return { status: "error", error: existing.error };
    }

    let child: SpawnedServer;
    try {
      child = runtime.spawnServer(key);
    } catch (error) {
      return { status: "error", error };
    }
    let spawnError: Error | null = null;
    child.onError((error) => {
      spawnError = error;
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
        const found = await runningServerResult(key);
        if (found.status === "running") {
          return { status: "ok", url: found.url, started: true };
        }
        if (found.status === "invalid") {
          return stopAfterFailure({ status: "error", error: found.error });
        }
      }
      return stopAfterFailure({ status: "timeout" });
    } catch (error) {
      return stopAfterFailure({ status: "error", error });
    }
  }

  async function doOpen(path: string): Promise<WorktreeOpenResult> {
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
        return { status: "ok", url: existing.url, started: false };
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
        result = await spawnWhileLocked(key, deadline);
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

  function openWorktreeServer(path: string): Promise<WorktreeOpenResult> {
    let key: string;
    try {
      key = registryKey(path);
    } catch (error) {
      return Promise.resolve({ status: "error", error });
    }
    const pending = opening.get(key);
    if (pending) return pending;
    const started = doOpen(path).finally(() => {
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
