// File watching runs here, in a child process, and never in the HTTP server.
//
// Why: on macOS `FSWatcher.close()` ends up in libuv's `uv__fsevents_close`,
// which signals the CoreFoundation thread and then blocks on `uv_sem_wait`
// until that thread answers. When `fseventsd` is wedged (it can sit at 100% CPU
// for days) the CF thread is itself stuck inside `FSEventStreamStart` waiting on
// a Mach reply, so the semaphore is never posted and the whole event loop stops.
// Every HTTP request then hangs forever while the port still accepts
// connections. There is no non-blocking close in Node — AbortSignal calls the
// same close — so the only way to keep serving is to put the watcher in a
// process the parent can abandon and SIGKILL.
//
// This process therefore never calls close() on a watcher, not even on exit:
// exiting is enough, the OS reclaims the handles.
import { createHash } from "node:crypto";
import { createReadStream, lstatSync } from "node:fs";
import { join } from "node:path";
import { runAsync } from "./runtime";
import { isSkippableSearchPath } from "./search";
import {
  startWorktreeUpdateWatch,
  supportsNativeRecursiveWatch,
} from "./worktree-watcher";

export type WatchChildConfig = {
  root: string;
  omitDirNames: string[];
  excludeNames: string[];
  maxWatchedDirectories: number;
  debounceMs: number;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  // The parent can be SIGKILLed — a crash, a force quit, a test teardown — and
  // then it never gets the chance to kill this child. Nobody else would notice,
  // so the child watches for the parent's disappearance itself.
  parentPid: number;
  // Set by the supervisor after a watcher-backed child failed to come up, so a
  // broken fseventsd degrades to polling instead of losing updates entirely.
  pollOnly: boolean;
};

export type WatchChildMessage =
  | { type: "ready"; watching: boolean; pollOnly: boolean }
  | { type: "heartbeat" }
  | { type: "update"; paths?: string[] }
  | { type: "watch-limit"; limit: number }
  | { type: "warn"; message: string };

// Hashing every changed file would be pointless work on a large binary; past
// this size the identity falls back to size and mtime, which is what the rest of
// the viewer already relies on for cache busting.
const MAX_HASHED_FILE_BYTES = 4 * 1024 * 1024;

function send(message: WatchChildMessage): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function readConfigLine(): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const stdin = process.stdin;
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      stdin.off("data", onData);
      stdin.off("end", onEnd);
      resolve(buffer.slice(0, newline));
    };
    const onEnd = () => {
      stdin.off("data", onData);
      reject(new Error("watch child: stdin closed before config arrived"));
    };
    stdin.on("data", onData);
    stdin.on("end", onEnd);
  });
}

function hashFile(path: string): Promise<string> {
  return new Promise((resolve) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    // An unreadable file still has to produce a stable-per-state value, and
    // "error" is itself a state change worth reporting.
    stream.on("error", () => resolve("unreadable"));
  });
}

type WorktreeSnapshot = {
  head: string;
  entries: Map<string, string>;
};

// Parses `git status --porcelain=v2 -z`. Records are NUL-terminated, and a
// rename record ("2 ") carries its original path as one extra NUL-separated
// field, so that field must be consumed rather than read as a new record.
export function parsePorcelainV2(raw: string): {
  head: string;
  entries: Array<{ path: string; status: string }>;
} {
  const records = raw.split("\0");
  let head = "";
  const entries: Array<{ path: string; status: string }> = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    if (record.startsWith("# branch.oid ")) {
      head = record.slice("# branch.oid ".length);
      continue;
    }
    if (record.startsWith("# ")) continue;
    const kind = record[0];
    // The metadata fields are positional and space-separated; the path is
    // everything after them and may itself contain spaces.
    //   1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>              -> 8 fields
    //   2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>   -> 9 fields
    //   u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>    -> 10 fields
    if (kind === "1" || kind === "2" || kind === "u") {
      const metaCount = kind === "1" ? 8 : kind === "2" ? 9 : 10;
      const status = record.split(" ").slice(0, metaCount).join(" ");
      entries.push({ path: record.slice(status.length + 1), status });
      // A rename carries its original path as the next NUL-separated field.
      if (kind === "2") i++;
      continue;
    }
    if (kind === "?" || kind === "!") {
      entries.push({ path: record.slice(2), status: kind });
    }
  }
  return { head, entries };
}

async function readWorktreeSnapshot(
  config: WatchChildConfig,
): Promise<WorktreeSnapshot | null> {
  // --no-optional-locks keeps a background poll from fighting the user's git for
  // the index lock. core.fsmonitor=false matters more: if the user has a
  // filesystem monitor configured, git status would answer from the very
  // notification mechanism this poll exists to distrust.
  const result = await runAsync(
    [
      "git",
      "--no-optional-locks",
      "-c",
      "core.fsmonitor=false",
      "status",
      "--porcelain=v2",
      "-z",
      "--branch",
      "--untracked-files=all",
    ],
    config.root,
    { timeout: 60_000 },
  );
  if (result.code !== 0) return null;
  const parsed = parsePorcelainV2(result.stdout);
  const entries = new Map<string, string>();
  for (const entry of parsed.entries) {
    if (!entry.path) continue;
    if (
      isSkippableSearchPath(
        entry.path,
        config.omitDirNames,
        config.excludeNames,
      )
    )
      continue;
    entries.set(entry.path, await pathSignature(config.root, entry));
  }
  return { head: parsed.head, entries };
}

async function pathSignature(
  root: string,
  entry: { path: string; status: string },
): Promise<string> {
  const full = join(root, entry.path);
  let stats: ReturnType<typeof lstatSync>;
  try {
    stats = lstatSync(full);
  } catch {
    // Deleted on disk: the status line alone identifies this state.
    return `${entry.status}:absent`;
  }
  const base = `${entry.status}:${stats.size}:${stats.mtimeMs}:${stats.mode}`;
  // git status reports "changed" without saying how, so two different edits of
  // the same file can produce an identical status line. Content has to be part
  // of the signature or a re-edit of an already-modified file goes unnoticed.
  if (stats.isFile() && stats.size <= MAX_HASHED_FILE_BYTES) {
    return `${base}:${await hashFile(full)}`;
  }
  return base;
}

function snapshotDiff(
  previous: WorktreeSnapshot,
  next: WorktreeSnapshot,
): { full: boolean; paths: string[] } {
  // A HEAD move rewrites the meaning of every diff on screen.
  if (previous.head !== next.head) return { full: true, paths: [] };
  const paths: string[] = [];
  for (const [path, signature] of next.entries) {
    if (previous.entries.get(path) !== signature) paths.push(path);
  }
  for (const path of previous.entries.keys()) {
    if (!next.entries.has(path)) paths.push(path);
  }
  return { full: false, paths };
}

export async function runWatchChild(): Promise<void> {
  const config = JSON.parse(await readConfigLine()) as WatchChildConfig;

  // The parent holds the write end of this stdin, so stdin ending means the
  // parent is gone — including when it was SIGKILLed and got no chance to clean
  // up. This fires immediately, unlike the pid poll below, which is only the
  // backstop for a stdin that somehow stays open.
  process.stdin.on("end", () => process.exit(0));
  process.stdin.on("close", () => process.exit(0));

  // Never close watchers, here or anywhere: close() is the deadlock. Exiting
  // hands the handles back to the OS, which cannot block.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => process.exit(0));
  }

  let watching = false;
  if (!config.pollOnly) {
    const recursive = supportsNativeRecursiveWatch(process.platform);
    const watch = startWorktreeUpdateWatch({
      root: config.root,
      omitDirNames: config.omitDirNames,
      excludeNames: config.excludeNames,
      recursive,
      initialScanMode: recursive ? "sync" : "async",
      maxWatchedDirectories: config.maxWatchedDirectories,
      debounceMs: config.debounceMs,
      onUpdate: (paths) => send({ type: "update", paths }),
      onWatchLimit: (limit) => send({ type: "watch-limit", limit }),
      onError: (error) =>
        send({
          type: "warn",
          message: error instanceof Error ? error.message : String(error),
        }),
    });
    watching = watch.started;
  }

  send({ type: "ready", watching, pollOnly: config.pollOnly });

  setInterval(
    () => send({ type: "heartbeat" }),
    config.heartbeatIntervalMs,
  ).unref?.();

  // Signal 0 only probes for existence. Without this, a force-killed parent
  // would leave this process watching the worktree forever.
  setInterval(() => {
    try {
      process.kill(config.parentPid, 0);
    } catch {
      process.exit(0);
    }
  }, config.heartbeatIntervalMs);

  // The poll is not a fallback for a dead watcher only. libuv discards the
  // FSEvents UserDropped/KernelDropped/RootChanged flags before the event
  // reaches JS (src/unix/fsevents.c drops everything in kFSEventsSystem), so a
  // running watcher cannot tell us it lost events. Reconciling on a timer is the
  // only way to converge on the real state.
  // Deliberately not taken at startup: `git status --untracked-files=all` walks
  // the whole worktree, and doing that while the server is answering its first
  // requests measurably slowed them down. The first poll establishes the
  // baseline instead.
  let snapshot: WorktreeSnapshot | null = null;
  let baselineEstablished = false;
  const poll = async () => {
    const next = await readWorktreeSnapshot(config);
    if (!next) return;
    if (!snapshot) {
      snapshot = next;
      // The first baseline has not observed anything change, so it must not
      // trigger a refresh. A baseline re-established after failures is
      // different: the screen may have gone stale in the meantime.
      if (baselineEstablished) send({ type: "update" });
      baselineEstablished = true;
      return;
    }
    const diff = snapshotDiff(snapshot, next);
    snapshot = next;
    if (diff.full) {
      send({ type: "update" });
      return;
    }
    if (diff.paths.length) send({ type: "update", paths: diff.paths });
  };
  setInterval(() => {
    void poll().catch((error) =>
      send({
        type: "warn",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }, config.pollIntervalMs);
}
