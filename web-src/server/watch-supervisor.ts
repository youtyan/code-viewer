// Owns the watcher child process on behalf of the HTTP server.
//
// The contract that matters: this module must never block the parent's event
// loop, and must never wait for the child. A child whose event loop is stuck
// inside libuv's `uv__fsevents_close` (see watch-child.ts) will not answer
// SIGTERM and will not exit, so every wait here is bounded and ends in SIGKILL.
// The parent abandons it and starts a replacement.
import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import type { WatchChildConfig, WatchChildMessage } from "./watch-child";

export type WatchSupervisorOptions = {
  root: string;
  omitDirNames: string[];
  excludeNames: string[];
  maxWatchedDirectories: number;
  debounceMs?: number;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  onUpdate: (changedPaths?: string[]) => void;
  onWatchLimit?: (limit: number) => void;
  onError?: (error: unknown) => void;
  onPollOnly?: () => void;
  spawnFn?: typeof spawn;
  command?: string[];
  nowFn?: () => number;
  setTimeoutFn?: typeof setTimeout;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
};

export type WatchSupervisor = {
  close: () => void;
  pollOnly: () => boolean;
};

const DEFAULT_HEARTBEAT_MS = 5_000;
const DEFAULT_POLL_MS = 15_000;
// Three missed heartbeats before declaring the child lost. Two would fire on a
// single slow poll over a large worktree.
const HEARTBEAT_MISS_LIMIT = 3;
const KILL_GRACE_MS = 2_000;
// Two watcher-backed children failing in a row means the platform's watch
// mechanism is unusable right now (a wedged fseventsd looks exactly like this),
// so stop trying to watch and let polling carry the updates.
const WATCH_FAILURES_BEFORE_POLL_ONLY = 2;

// Re-runs this same program in its watch-child mode. In the published build the
// entry is one bundled file that already dispatches subcommands; in dev the
// server is started as preview.ts, which has no dispatch, so point at cli.ts
// beside it.
export function watchChildCommand(): string[] {
  const entry = process.argv[1] ?? "";
  const script = entry.endsWith(".ts")
    ? join(import.meta.dir, "cli.ts")
    : entry;
  return [process.argv[0], script, "watch-child"];
}

export function startWatchSupervisor(
  options: WatchSupervisorOptions,
): WatchSupervisor {
  const spawnChild = options.spawnFn || spawn;
  const now = options.nowFn || Date.now;
  const setTimer = options.setTimeoutFn || setTimeout;
  const setRepeating = options.setIntervalFn || setInterval;
  const clearRepeating = options.clearIntervalFn || clearInterval;
  const heartbeatMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  const command = options.command ?? watchChildCommand();

  let child: ChildProcess | null = null;
  let closed = false;
  let watchFailures = 0;
  let pollOnly = false;
  let sawReady = false;
  let lastSignalAt = now();
  let watchdog: ReturnType<typeof setInterval> | null = null;

  const report = (error: unknown) => options.onError?.(error);

  // Abandon, do not await. A child stuck in a native semaphore wait cannot run
  // its signal handler, so the only thing that reliably ends it is SIGKILL.
  const abandon = (victim: ChildProcess) => {
    victim.removeAllListeners?.();
    victim.stdout?.removeAllListeners?.();
    victim.stderr?.removeAllListeners?.();
    try {
      victim.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    const grace = setTimer(() => {
      try {
        victim.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }, KILL_GRACE_MS);
    grace.unref?.();
  };

  const handleMessage = (message: WatchChildMessage) => {
    lastSignalAt = now();
    if (message.type === "heartbeat") return;
    if (message.type === "ready") {
      // A child that came up with no watcher and was not asked to poll is not a
      // healthy child; count it so repeated failures degrade to poll-only.
      if (message.pollOnly || message.watching) {
        sawReady = true;
        watchFailures = 0;
      } else {
        watchFailures++;
      }
      return;
    }
    if (message.type === "update") {
      options.onUpdate(message.paths);
      return;
    }
    if (message.type === "watch-limit") {
      options.onWatchLimit?.(message.limit);
      return;
    }
    if (message.type === "warn") report(new Error(message.message));
  };

  const start = () => {
    if (closed) return;
    if (!pollOnly && watchFailures >= WATCH_FAILURES_BEFORE_POLL_ONLY) {
      pollOnly = true;
      options.onPollOnly?.();
    }
    const config: WatchChildConfig = {
      root: options.root,
      omitDirNames: options.omitDirNames,
      excludeNames: options.excludeNames,
      maxWatchedDirectories: options.maxWatchedDirectories,
      debounceMs: options.debounceMs ?? 250,
      pollIntervalMs,
      heartbeatIntervalMs: heartbeatMs,
      parentPid: process.pid,
      pollOnly,
    };

    let spawned: ChildProcess;
    try {
      spawned = spawnChild(command[0], command.slice(1), {
        cwd: options.root,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      report(error);
      return;
    }
    child = spawned;
    sawReady = false;
    lastSignalAt = now();

    try {
      spawned.stdin?.write(`${JSON.stringify(config)}\n`);
    } catch (error) {
      report(error);
    }

    let buffer = "";
    spawned.stdout?.setEncoding?.("utf8");
    spawned.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          try {
            handleMessage(JSON.parse(line) as WatchChildMessage);
          } catch {
            /* a partial or malformed line is not worth tearing the child down */
          }
        }
        newline = buffer.indexOf("\n");
      }
    });

    spawned.stderr?.setEncoding?.("utf8");
    spawned.stderr?.on("data", (chunk: string) => {
      const text = String(chunk).trim();
      if (text) console.warn(`[code-viewer] watch child: ${text}`);
    });

    spawned.on("error", (error) => report(error));
    spawned.on("exit", () => {
      if (closed || child !== spawned) return;
      if (!sawReady) watchFailures++;
      child = null;
      // Crash-looping must not spin the CPU; one heartbeat interval is a long
      // enough gap while keeping recovery quick.
      const retry = setTimer(start, heartbeatMs);
      retry.unref?.();
    });
  };

  start();

  watchdog = setRepeating(() => {
    if (closed || !child) return;
    if (now() - lastSignalAt < heartbeatMs * HEARTBEAT_MISS_LIMIT) return;
    // Silence means the child's loop is blocked — the exact failure this design
    // exists to survive. Replace it; the parent keeps serving either way.
    const victim = child;
    child = null;
    watchFailures++;
    report(new Error("watch child stopped reporting; restarting"));
    abandon(victim);
    start();
  }, heartbeatMs);
  watchdog.unref?.();

  return {
    close: () => {
      closed = true;
      if (watchdog) clearRepeating(watchdog);
      watchdog = null;
      const victim = child;
      child = null;
      if (victim) abandon(victim);
    },
    pollOnly: () => pollOnly,
  };
}
