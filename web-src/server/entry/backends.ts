// 入口が取り次ぐ先 (プロジェクトごとの裏のプロセス) を起こす・覚える・止める。
//
// 裏は今のサーバそのもの (`--backend`。巡回しない・フックを受けない印付き)。
// 起こし方は作業ツリーを開く仕組み (worktree/open.ts) をそのまま使い、
// 同じ根の要求は 1 本の Promise にまとめる。
//
// 覚えているのは「このプロセスの間に取り次いだ裏の URL と pid」だけ。入口を
// 起動し直すと空から始まり、最初の要求で登録簿から生きた裏を拾い直す。
//
// 裏の状態 (BackendState) は 4 つ:
// - starting: 起こしている最中。要求は起き終わるのを待つ
// - running: 取り次げる
// - idle-stopped: 使われていないので入口が止めた。落ちた扱いにせず、次の
//   要求で黙って起こす
// - unreachable: 取り次ぎが接続を断られた (落ちた)。次の要求では勝手に
//   起こさず 502 にする (画面が再起動のボタンを出す)。SSE の繋ぎ直しは
//   ブラウザが自動で繰り返すので、それで起こし直すのは 1 回まで。落ち続ける
//   ものを起こし続けない
//
// アイドル停止: SSE の購読が 0 本・取り次ぎ中の要求 (ダウンロードなどの
// 流れ) が 0 本・最後の要求から idleStopMs 経った裏を止める。止めるのは
// 入口の裏 (登録簿の `backend`) だけで、利用者が起こした `--standalone` の
// サーバは止めない。ターミナル・未読・フックは入口に居るので、裏を止めても
// 消えない。

import { formatErrorDetail } from "../../core/error-detail";
import type { EntryBackendState } from "../../core/types";
import { serverLogFile } from "../projects/service";
import { readServerRegistry } from "../server-registry";
import {
  createWorktreeServerController,
  logTail,
  type RunningWorktreeServerResult,
} from "../worktree/open";

export type BackendTarget =
  | { status: "ok"; url: string; pid: number | null; started: boolean }
  /** 取り次いでいた裏が落ちた。画面の再起動のボタンか、SSE の 1 回で起こす。 */
  | { status: "unreachable"; detail: string; log: string }
  /** 起こせなかった (時間切れ・起動直後に終わった・確かめられない)。 */
  | { status: "failed"; detail: string; log: string };

type BackendRecord =
  | { state: "starting"; done: Promise<BackendTarget> }
  | {
      state: "running";
      url: string;
      pid: number | null;
      /** 入口の裏か (登録簿の `backend`)。違えばアイドル停止しない。 */
      backend: boolean;
      since: number;
    }
  /** アイドル停止の最中。終わるまで次の起動を待たせる。 */
  | { state: "stopping"; done: Promise<void> }
  | { state: "idle-stopped"; since: number }
  | { state: "unreachable"; detail: string; log: string };

type Controller = Pick<
  ReturnType<typeof createWorktreeServerController>,
  "openWorktreeServer" | "runningServerResult" | "stopWorktreeServer"
>;

export type EntryBackendsDeps = {
  entryPid: number;
  controller: Controller;
  logFile(root: string): string;
  logTail(file: string): string;
  /** 登録簿の pid と、入口の裏 (`--backend`) か。記録が無ければ null。 */
  registryEntry(root: string): { pid: number; backend: boolean } | null;
  /** その根の裏に足す引数 (起動したディレクトリの `--bin` や git の差分の引数)。 */
  serverArgs(root: string): readonly string[];
  /** 使われていない裏を止めるまでの時間。0 なら止めない。 */
  idleStopMs: number;
  now(): number;
  /** 入口のログへの 1 行 (停止・起こし直し)。 */
  log(line: string): void;
};

export function defaultEntryBackendsDeps(
  entryPid: number,
  serverArgs: (root: string) => readonly string[],
  idleStopMs: number,
): EntryBackendsDeps {
  return {
    entryPid,
    controller: createWorktreeServerController(),
    logFile: serverLogFile,
    logTail,
    registryEntry: (root) => {
      const entry = readServerRegistry(root);
      return entry ? { pid: entry.pid, backend: entry.backend === true } : null;
    },
    serverArgs,
    idleStopMs,
    now: Date.now,
    log: (line) => console.log(`[code-viewer] entry: ${line}`),
  };
}

/** ログに出す経過時間 (`12m 3s`)。 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

type Activity = { subscribers: number; streams: number; lastAt: number };

export function createEntryBackends(deps: EntryBackendsDeps) {
  const records = new Map<string, BackendRecord>();
  /** 落ちた後に SSE の繋ぎ直しで起こし直した根。2 回目は起こさない。 */
  const autoRestarted = new Set<string>();
  const activity = new Map<string, Activity>();

  function activityOf(root: string): Activity {
    let found = activity.get(root);
    if (!found) {
      found = { subscribers: 0, streams: 0, lastAt: deps.now() };
      activity.set(root, found);
    }
    return found;
  }

  function touch(root: string): void {
    activityOf(root).lastAt = deps.now();
  }

  async function finishStart(
    root: string,
    previous: BackendRecord | undefined,
  ): Promise<BackendTarget> {
    const result = await deps.controller.openWorktreeServer(root, {
      port: 0,
      logFile: deps.logFile(root),
      backendOf: deps.entryPid,
      serverArgs: deps.serverArgs(root),
    });
    touch(root);
    if (result.status === "ok") {
      let registered: { pid: number; backend: boolean } | null = null;
      try {
        registered = deps.registryEntry(root);
      } catch (error) {
        // pid は落ちたかどうかの見分けに、backend はアイドル停止してよいかに
        // 使う。読めなければ取り次ぎの失敗 (接続拒否) だけで見分け、止めない
        // 側に倒す。理由はログに残す。
        console.error(
          `[code-viewer] entry: the server registry of ${root} could not be read`,
          error,
        );
      }
      const pid = registered?.pid ?? null;
      records.set(root, {
        state: "running",
        url: result.url,
        pid,
        backend: registered?.backend === true,
        since: deps.now(),
      });
      return { status: "ok", url: result.url, pid, started: result.started };
    }
    // 落ちた後の起こし直し (SSE の 1 回) が失敗したら、落ちた印に戻す。
    // 戻さないと、次の普通の要求がまた起こしに行く。
    if (previous?.state === "unreachable") records.set(root, previous);
    else records.delete(root);
    const log = deps.logTail(deps.logFile(root));
    if (result.status === "missing") {
      return {
        status: "failed",
        detail: `the project folder ${root} does not exist`,
        log,
      };
    }
    if (result.status === "timeout") {
      return {
        status: "failed",
        detail: `the project process for ${root} did not start in time`,
        log,
      };
    }
    return {
      status: "failed",
      detail: `could not start the project process for ${root}:\n${formatErrorDetail(result.error)}`,
      log,
    };
  }

  function start(root: string): Promise<BackendTarget> {
    const done = finishStart(root, records.get(root));
    records.set(root, { state: "starting", done });
    return done;
  }

  /**
   * 取り次ぐ先。動いていなければ起こす (アイドル停止したものは黙って起こす。
   * 落ちた後は起こさない。restart か、SSE の繋ぎ直しの 1 回だけ)。
   */
  async function target(
    root: string,
    options: { events?: boolean } = {},
  ): Promise<BackendTarget> {
    touch(root);
    const known = records.get(root);
    if (known?.state === "running") {
      return { status: "ok", url: known.url, pid: known.pid, started: false };
    }
    if (known?.state === "starting") return known.done;
    if (known?.state === "stopping") {
      await known.done;
      return target(root, options);
    }
    if (known?.state === "unreachable") {
      if (!options.events || autoRestarted.has(root)) {
        return { status: "unreachable", detail: known.detail, log: known.log };
      }
      autoRestarted.add(root);
    }
    const started = await start(root);
    if (known?.state === "idle-stopped") {
      deps.log(
        started.status === "ok"
          ? `started the project process for ${root} again on request (stopped as idle ${formatDuration(deps.now() - known.since)} ago)`
          : `could not start the project process for ${root} again (stopped as idle ${formatDuration(deps.now() - known.since)} ago): ${started.detail}`,
      );
    }
    return started;
  }

  /**
   * 取り次ぐ要求の始まり。取り次ぎ先と、要求 (SSE なら購読) を数えから外す
   * 関数を返す。数えるのは取り次ぎ先が決まった同じ継続の中なので、その間に
   * アイドル停止が割り込まない。
   */
  async function acquire(
    root: string,
    options: { events?: boolean } = {},
  ): Promise<{ target: BackendTarget; release: (() => void) | null }> {
    const found = await target(root, options);
    if (found.status !== "ok") return { target: found, release: null };
    const counts = activityOf(root);
    const key = options.events ? "subscribers" : "streams";
    counts[key] += 1;
    let done = false;
    return {
      target: found,
      release: () => {
        if (done) return;
        done = true;
        counts[key] = Math.max(0, counts[key] - 1);
        counts.lastAt = deps.now();
      },
    };
  }

  /** 画面の「再起動」。落ちた印と SSE の 1 回の分を戻して起こす。 */
  async function restart(root: string): Promise<BackendTarget> {
    const known = records.get(root);
    if (known?.state === "stopping") await known.done;
    const was = records.get(root);
    autoRestarted.delete(root);
    records.delete(root);
    const started = await start(root);
    deps.log(
      `restart of the project process for ${root} (was ${was?.state ?? "absent"}): ${started.status === "ok" ? `running at ${started.url}` : `${started.status}: ${started.detail}`}`,
    );
    return started;
  }

  /** 取り次ぎが裏に繋がらなかった。落ちたと覚える。 */
  function noteUnreachable(root: string, error: unknown): BackendTarget {
    const was = records.get(root);
    const entry = {
      detail: `the project process for ${root} stopped (the entry server could not reach it):\n${formatErrorDetail(error)}`,
      log: deps.logTail(deps.logFile(root)),
    };
    records.set(root, { state: "unreachable", ...entry });
    deps.log(
      `the project process for ${root} is unreachable${was?.state === "running" ? ` (it ran ${formatDuration(deps.now() - was.since)})` : ""}`,
    );
    return { status: "unreachable", ...entry };
  }

  function running(root: string): Promise<RunningWorktreeServerResult> {
    return deps.controller.runningServerResult(root);
  }

  /** 一覧のメニューから止めた。次に開けばまた起こす (落ちた扱いにしない)。 */
  async function stop(root: string): Promise<void> {
    const known = records.get(root);
    if (known?.state === "stopping") await known.done;
    await deps.controller.stopWorktreeServer(root);
    records.delete(root);
    autoRestarted.delete(root);
  }

  /** 画面に見せる状態。このプロセスの間に一度も扱っていなければ absent。 */
  function state(root: string): EntryBackendState {
    const known = records.get(root);
    if (!known) return "absent";
    // 止めている最中は、次の要求で起こし直すので「止めた」と同じに見せる。
    if (known.state === "stopping") return "idle-stopped";
    return known.state;
  }

  /** 使われていない裏か (止めてよいか)。 */
  function idleFor(root: string, now: number): number | null {
    const known = records.get(root);
    if (known?.state !== "running" || !known.backend) return null;
    const counts = activityOf(root);
    if (counts.subscribers > 0 || counts.streams > 0) return null;
    const idle = now - counts.lastAt;
    return idle >= deps.idleStopMs ? idle : null;
  }

  async function stopIdle(root: string, idleMs: number): Promise<void> {
    const known = records.get(root);
    if (known?.state !== "running") return;
    // 止め終わるまでの Promise を「stopping」として置く。その間に来た要求は
    // これを待ってから起こし直す。この Promise は失敗しない (中で拾う)。
    const done = (async () => {
      try {
        await deps.controller.stopWorktreeServer(root);
        records.set(root, { state: "idle-stopped", since: deps.now() });
        deps.log(
          `stopped the project process for ${root} (idle: no subscribers or streams for ${formatDuration(idleMs)}; it ran ${formatDuration(deps.now() - known.since)})`,
        );
      } catch (error) {
        // 止められなかった。動いているものとして扱い続け、次に止めるのは
        // もう 1 周期使われなかったとき。理由は全部ログに出す。
        records.set(root, known);
        touch(root);
        console.error(
          `[code-viewer] entry: could not stop the idle project process for ${root}:\n${formatErrorDetail(error)}`,
        );
      }
    })();
    records.set(root, { state: "stopping", done });
    await done;
  }

  /** 使われていない裏を止める (入口が一定の間隔で呼ぶ)。 */
  async function stopIdleBackends(): Promise<void> {
    if (deps.idleStopMs <= 0) return;
    const now = deps.now();
    const idle: [string, number][] = [];
    for (const root of records.keys()) {
      const idleMs = idleFor(root, now);
      if (idleMs !== null) idle.push([root, idleMs]);
    }
    await Promise.all(idle.map(([root, idleMs]) => stopIdle(root, idleMs)));
  }

  return {
    target,
    acquire,
    restart,
    noteUnreachable,
    running,
    stop,
    state,
    stopIdleBackends,
    subscriberCount: (root: string) => activity.get(root)?.subscribers ?? 0,
    streamCount: (root: string) => activity.get(root)?.streams ?? 0,
  };
}

export type EntryBackends = ReturnType<typeof createEntryBackends>;
