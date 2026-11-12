// tmux のペインの前面のコマンドがインタプリタ (node・bun など) のとき、その
// プロセスの引数から中のプログラム (claude・codex・opencode) を当てる。npm で
// 入れた claude は node として動き、フックを入れていないと一覧に出なかった。
// 決まりそのもの (引数の読み方) は core/agent-overview.ts の agentKindFromArgs。
//
// 読むのは `ps -o pid=,args=` (引数だけ。環境変数は読まない: e を付けない)。
// 引数にもトークンなどが入りうるので、当てた種類だけを残し、引数そのものは
// 覚えない・返さない・ログや失敗の説明に載せない (説明に使うのは終了コードと
// stderr だけ)。
//
// 頻度: コマンドがインタプリタのペインだけを、ペイン (シェルの pid) か前面の
// コマンドが前回と変わったときだけ調べ、結果を覚える。一覧の取り直しのたびに
// ps を起こさない。調べられなかったときは覚えず (次の取り直しでもう一度)、
// 理由を一覧の errors に出し、種類は今までどおりの判定 (コマンド名と申告) に
// 任せる。

import {
  agentKindFromArgs,
  isInterpreterCommand,
  type ProcessAgentKind,
} from "../../core/agent-overview";
import { errorWithCause } from "../../core/error-detail";
import {
  DEFAULT_PROCESS_ENV_DEPS,
  findAgentProcess,
  type ProbeTarget,
  type ProcessRow,
} from "../accounts/process-env";
import { runAsync } from "../runtime";

const PS_TIMEOUT_MS = 3000;

export type ProcessKindDeps = {
  /** 全プロセスの pid・親・実行ファイル名 (process-env.ts と同じ)。 */
  listProcesses(): Promise<ProcessRow[]>;
  /** pid ごとの引数の 1 行。終わっていたプロセスは入らない。 */
  readArgs(pids: number[]): Promise<Map<number, string>>;
};

/** `ps -o pid=,args=` の出力を pid ごとの引数にする。 */
export function parseProcessArgs(stdout: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (match?.[2] !== undefined) out.set(Number(match[1]), match[2]);
  }
  return out;
}

export const DEFAULT_PROCESS_KIND_DEPS: ProcessKindDeps = {
  listProcesses: DEFAULT_PROCESS_ENV_DEPS.listProcesses,
  async readArgs(pids) {
    if (pids.length === 0) return new Map();
    const result = await runAsync(
      ["ps", "-o", "pid=,args=", "-p", pids.join(",")],
      "/",
      { timeout: PS_TIMEOUT_MS },
    );
    // 1 つでも終わっていると ps は 1 を返す。残りの行は使える。
    if (result.code !== 0 && result.code !== 1) {
      throw new Error(
        `ps -o pid=,args= exited with ${result.code}${
          result.stderr ? `\nstderr: ${result.stderr.trim()}` : ""
        } (stdout ${result.stdout.length} bytes, not shown)`,
      );
    }
    return parseProcessArgs(result.stdout);
  },
};

/** 調べられなかったペイン 1 つ。 */
export type ProcessKindError = { target: string; error: unknown };

export type ProcessKindResult = {
  /** インタプリタのペインだけ。当てられなかったものは null。 */
  kinds: Map<string, ProcessAgentKind | null>;
  errors: ProcessKindError[];
};

export type ProcessKindProber = {
  probe(targets: readonly ProbeTarget[]): Promise<ProcessKindResult>;
  /** ps を呼んだ回数 (テストと計測用)。 */
  stats(): { listCalls: number; argsCalls: number };
};

export function createProcessKindProber(
  deps: ProcessKindDeps = DEFAULT_PROCESS_KIND_DEPS,
): ProcessKindProber {
  const cache = new Map<
    string,
    { key: string; kind: ProcessAgentKind | null }
  >();
  let listCalls = 0;
  let argsCalls = 0;
  const keyOf = (target: ProbeTarget) => `${target.pid}:${target.command}`;

  return {
    stats: () => ({ listCalls, argsCalls }),
    async probe(targets) {
      const wanted = targets.filter((target) =>
        isInterpreterCommand(target.command),
      );
      const wantedIds = new Set(wanted.map((target) => target.id));
      for (const id of [...cache.keys()]) {
        if (!wantedIds.has(id)) cache.delete(id);
      }
      const stale = wanted.filter(
        (target) => cache.get(target.id)?.key !== keyOf(target),
      );
      const errors: ProcessKindError[] = [];
      if (stale.length > 0) {
        try {
          listCalls += 1;
          const rows = await deps.listProcesses();
          const pids = new Map<string, number>();
          for (const target of stale) {
            const pid =
              target.pid > 0
                ? findAgentProcess(rows, target.pid, target.command)
                : null;
            if (pid === null) {
              errors.push({
                target: target.id,
                error: new Error(
                  `no process named ${target.command} under the pane's shell (pid ${target.pid})`,
                ),
              });
            } else {
              pids.set(target.id, pid);
            }
          }
          if (pids.size > 0) {
            argsCalls += 1;
            const args = await deps.readArgs([...new Set(pids.values())]);
            for (const target of stale) {
              const pid = pids.get(target.id);
              if (pid === undefined) continue;
              const line = args.get(pid);
              if (line === undefined) {
                errors.push({
                  target: target.id,
                  error: new Error(
                    `the ${target.command} process ${pid} ended before its arguments were read`,
                  ),
                });
                continue;
              }
              cache.set(target.id, {
                key: keyOf(target),
                kind: agentKindFromArgs(line),
              });
            }
          }
        } catch (error) {
          for (const target of stale) {
            if (cache.get(target.id)?.key === keyOf(target)) continue;
            errors.push({
              target: target.id,
              error: errorWithCause(
                `could not read the processes of ${target.id}`,
                error,
              ),
            });
          }
        }
      }
      const kinds = new Map<string, ProcessAgentKind | null>();
      for (const target of wanted) {
        const hit = cache.get(target.id);
        if (hit?.key === keyOf(target)) kinds.set(target.id, hit.kind);
      }
      return { kinds, errors };
    },
  };
}
