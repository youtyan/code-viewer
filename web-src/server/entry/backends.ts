// 入口が取り次ぐ先 (プロジェクトごとの裏のプロセス) を起こす・覚える・止める。
//
// 裏は今のサーバそのもの (`--backend`。巡回しない・フックを受けない印付き)。
// 起こし方は作業ツリーを開く仕組み (worktree/open.ts) をそのまま使う:
// 起動ロック・登録簿に出るまで待つ・/_settings で本人確認・同じ根の要求は
// 1 本にまとめる。起こしている間の要求は同じ Promise を待つ。
//
// 覚えているのは「このプロセスの間に取り次いだ裏の URL と pid」だけ。入口を
// 起動し直すと空から始まり、最初の要求で登録簿から生きた裏を拾い直す
// (openWorktreeServer は動いているものがあれば起こさずにそれを返す)。
//
// 落ちた裏: 取り次ぎが接続を断られたら「止まった」と覚え、次の要求では
// 勝手に起こさず 502 にする (画面が再起動のボタンを出す)。SSE の繋ぎ直しは
// ブラウザが自動で繰り返すので、それで起こし直すのは 1 回まで。落ち続ける
// ものを起こし続けない。

import { formatErrorDetail } from "../../core/error-detail";
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
  | { status: "stopped"; detail: string; log: string }
  /** 起こせなかった (時間切れ・起動直後に終わった・確かめられない)。 */
  | { status: "failed"; detail: string; log: string };

type Controller = Pick<
  ReturnType<typeof createWorktreeServerController>,
  "openWorktreeServer" | "runningServerResult" | "stopWorktreeServer"
>;

export type EntryBackendsDeps = {
  entryPid: number;
  controller: Controller;
  logFile(root: string): string;
  logTail(file: string): string;
  registryPid(root: string): number | null;
  /** その根の裏に足す引数 (起動したディレクトリの `--bin` や git の差分の引数)。 */
  serverArgs(root: string): readonly string[];
};

export function defaultEntryBackendsDeps(
  entryPid: number,
  serverArgs: (root: string) => readonly string[],
): EntryBackendsDeps {
  return {
    entryPid,
    controller: createWorktreeServerController(),
    logFile: serverLogFile,
    logTail,
    registryPid: (root) => readServerRegistry(root)?.pid ?? null,
    serverArgs,
  };
}

export function createEntryBackends(deps: EntryBackendsDeps) {
  const live = new Map<string, { url: string; pid: number | null }>();
  const stopped = new Map<string, { detail: string; log: string }>();
  /** 落ちた後に SSE の繋ぎ直しで起こし直した根。2 回目は起こさない。 */
  const autoRestarted = new Set<string>();
  const subscribers = new Map<string, number>();

  async function start(root: string): Promise<BackendTarget> {
    const result = await deps.controller.openWorktreeServer(root, {
      port: 0,
      logFile: deps.logFile(root),
      backendOf: deps.entryPid,
      serverArgs: deps.serverArgs(root),
    });
    if (result.status === "ok") {
      let pid: number | null = null;
      try {
        pid = deps.registryPid(root);
      } catch (error) {
        // pid は落ちたかどうかの見分けにだけ使う。読めなければ取り次ぎの
        // 失敗 (接続拒否) だけで見分ける。理由はログに残す。
        console.error(
          `[code-viewer] entry: the server registry of ${root} could not be read`,
          error,
        );
      }
      live.set(root, { url: result.url, pid });
      stopped.delete(root);
      return { status: "ok", url: result.url, pid, started: result.started };
    }
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

  /**
   * 取り次ぐ先。動いていなければ起こす (落ちた後は起こさない。restart か、
   * SSE の繋ぎ直しの 1 回だけ)。
   */
  async function target(
    root: string,
    options: { events?: boolean } = {},
  ): Promise<BackendTarget> {
    const known = live.get(root);
    if (known) {
      return { status: "ok", url: known.url, pid: known.pid, started: false };
    }
    const down = stopped.get(root);
    if (down) {
      if (!options.events || autoRestarted.has(root)) {
        return { status: "stopped", ...down };
      }
      autoRestarted.add(root);
    }
    return start(root);
  }

  /** 画面の「再起動」。落ちた印と SSE の 1 回の分を戻して起こす。 */
  function restart(root: string): Promise<BackendTarget> {
    stopped.delete(root);
    autoRestarted.delete(root);
    live.delete(root);
    return start(root);
  }

  /** 取り次ぎが裏に繋がらなかった。落ちたと覚える。 */
  function noteUnreachable(root: string, error: unknown): BackendTarget {
    live.delete(root);
    const entry = {
      detail: `the project process for ${root} stopped (the entry server could not reach it):\n${formatErrorDetail(error)}`,
      log: deps.logTail(deps.logFile(root)),
    };
    stopped.set(root, entry);
    return { status: "stopped", ...entry };
  }

  function running(root: string): Promise<RunningWorktreeServerResult> {
    return deps.controller.runningServerResult(root);
  }

  /** 一覧のメニューから止めた。次に開けばまた起こす (落ちた扱いにしない)。 */
  async function stop(root: string): Promise<void> {
    await deps.controller.stopWorktreeServer(root);
    live.delete(root);
    stopped.delete(root);
    autoRestarted.delete(root);
  }

  /** SSE の購読を 1 本数える。返す関数で外す (何度呼んでも 1 回だけ)。 */
  function subscribe(root: string): () => void {
    subscribers.set(root, (subscribers.get(root) ?? 0) + 1);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = (subscribers.get(root) ?? 1) - 1;
      if (next > 0) subscribers.set(root, next);
      else subscribers.delete(root);
    };
  }

  return {
    target,
    restart,
    noteUnreachable,
    running,
    stop,
    subscribe,
    subscriberCount: (root: string) => subscribers.get(root) ?? 0,
  };
}

export type EntryBackends = ReturnType<typeof createEntryBackends>;
