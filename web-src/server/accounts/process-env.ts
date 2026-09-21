// tmux のペインで動いている claude / codex が、どの設定ディレクトリ
// (= アカウント) で動いているかを、プロセスの環境変数から求める。
//
// 取り出すのは CLAUDE_CONFIG_DIR と CODEX_HOME の 2 つだけ。プロセスの
// 環境変数にはユーザーの API キーなどが入っているので、ps の出力は
// pickAccountEnv に通したらすぐ捨てる。ほかの変数は保持しない・返さない・
// ログに出さない・エラーメッセージに含めない (失敗の説明に使うのは終了
// コードと stderr だけ。stdout は使わない)。
//
// 頻度を抑える: ペインの (シェルの pid, 前面のコマンド名) が前回と同じで、
// 調べてから PROBE_TTL_MS 以内なら調べ直さない。調べるときも、そのとき
// 必要なペインをまとめて ps 2 回 (プロセスの親子の一覧と、見つけたエージェント
// の環境変数) で済ませる。同じコマンド名のまま別の環境で起動し直した場合は、
// 最大 PROBE_TTL_MS 遅れて反映される。

import { basename } from "node:path";
import { pickAccountEnv } from "../../core/agent-accounts";
import { runAsync } from "../runtime";

/** 調べ直すまでの間。コマンド名が変わったらすぐ調べ直す。 */
export const PROBE_TTL_MS = 30_000;
const PS_TIMEOUT_MS = 3000;

export type ProcessRow = { pid: number; ppid: number; comm: string };

export type AccountEnv = Partial<
  Record<"CLAUDE_CONFIG_DIR" | "CODEX_HOME", string>
>;

export type ProcessEnvDeps = {
  /** 全プロセスの pid・親・実行ファイル名。環境変数は含まない。 */
  listProcesses(): Promise<ProcessRow[]>;
  /** pid ごとに、2 つの変数だけを取り出したもの。 */
  readAccountEnv(pids: number[]): Promise<Map<number, AccountEnv>>;
  now(): number;
};

export type ProbeTarget = {
  id: string;
  /** ペインのシェルの pid (tmux の pane_pid)。 */
  pid: number;
  /** tmux の pane_current_command (前面のプロセスの名前)。 */
  command: string;
};

export type ProbeResult =
  | { status: "ok"; env: AccountEnv }
  | { status: "error"; reason: string };

function psFailure(
  operation: string,
  result: { code: number; stderr: string },
) {
  return new Error(
    `${operation} exited with ${result.code}${
      result.stderr ? `\nstderr: ${result.stderr.trim()}` : ""
    }`,
  );
}

export function parseProcessRows(stdout: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!match?.[3]) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      comm: match[3].trim(),
    });
  }
  return rows;
}

/**
 * `ps eww -o pid=,command=` の出力から、pid ごとに 2 つの変数だけを残す。
 * 入力はここで捨てる。
 */
export function parseAccountEnvLines(stdout: string): Map<number, AccountEnv> {
  const out = new Map<number, AccountEnv>();
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s/.exec(line);
    if (!match) continue;
    out.set(Number(match[1]), pickAccountEnv(line.slice(match[0].length - 1)));
  }
  return out;
}

export const DEFAULT_PROCESS_ENV_DEPS: ProcessEnvDeps = {
  async listProcesses() {
    const result = await runAsync(["ps", "-A", "-o", "pid=,ppid=,comm="], "/", {
      timeout: PS_TIMEOUT_MS,
    });
    if (result.code !== 0) throw psFailure("ps -A", result);
    return parseProcessRows(result.stdout);
  },
  async readAccountEnv(pids) {
    if (pids.length === 0) return new Map();
    const result = await runAsync(
      ["ps", "eww", "-o", "pid=,command=", "-p", pids.join(",")],
      "/",
      { timeout: PS_TIMEOUT_MS },
    );
    // 1 つでも終わっていると ps は 1 を返す。残りの行は使える。
    if (result.code !== 0 && result.code !== 1) {
      throw psFailure("ps eww", result);
    }
    return parseAccountEnvLines(result.stdout);
  },
  now: Date.now,
};

/**
 * ペインのシェルの子孫から、前面のコマンド名と同じ名前のプロセスを
 * 探す (ペインのプロセス自身、無ければ子孫のうちいちばん浅いもの)。tmux の pane_current_command は前面の
 * プロセスの実行ファイル名なので、claude の単体版なら版番号の名前になる。
 */
export function findAgentProcess(
  rows: readonly ProcessRow[],
  panePid: number,
  command: string,
): number | null {
  const children = new Map<number, ProcessRow[]>();
  for (const row of rows) {
    const list = children.get(row.ppid) ?? [];
    list.push(row);
    children.set(row.ppid, list);
  }
  // シェルが exec してエージェントになった (`sh -c claude` など) ときは、
  // ペインのプロセスそのものがエージェント。
  const self = rows.find((row) => row.pid === panePid);
  if (self && basename(self.comm) === command) return self.pid;
  let level = children.get(panePid) ?? [];
  const seen = new Set<number>([panePid]);
  while (level.length > 0) {
    const found = level.find((row) => basename(row.comm) === command);
    if (found) return found.pid;
    const next: ProcessRow[] = [];
    for (const row of level) {
      if (seen.has(row.pid)) continue;
      seen.add(row.pid);
      next.push(...(children.get(row.pid) ?? []));
    }
    level = next;
  }
  return null;
}

export type ProcessEnvProber = {
  probe(targets: readonly ProbeTarget[]): Promise<Map<string, ProbeResult>>;
  /** 呼び出し回数 (計測用)。 */
  stats(): { listCalls: number; envCalls: number };
};

export function createProcessEnvProber(
  deps: ProcessEnvDeps = DEFAULT_PROCESS_ENV_DEPS,
  ttlMs: number = PROBE_TTL_MS,
): ProcessEnvProber {
  const cache = new Map<
    string,
    { key: string; at: number; result: ProbeResult }
  >();
  let listCalls = 0;
  let envCalls = 0;

  /**
   * stale のペインを調べて覚える。失敗も結果として覚える (次の期限まで
   * 同じ失敗で ps を呼び続けない)。例外は投げない。
   */
  async function refresh(
    stale: readonly ProbeTarget[],
    now: number,
  ): Promise<Map<string, ProbeResult>> {
    const out = new Map<string, ProbeResult>();
    const remember = (target: ProbeTarget, result: ProbeResult) => {
      cache.set(target.id, {
        key: `${target.pid}:${target.command}`,
        at: now,
        result,
      });
      out.set(target.id, result);
    };

    let rows: ProcessRow[];
    try {
      listCalls += 1;
      rows = await deps.listProcesses();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const target of stale) remember(target, { status: "error", reason });
      return out;
    }
    const agentPid = new Map<string, number>();
    for (const target of stale) {
      const pid =
        target.pid > 0
          ? findAgentProcess(rows, target.pid, target.command)
          : null;
      if (pid === null) {
        remember(target, {
          status: "error",
          reason: `no process named ${target.command} under the pane's shell (pid ${target.pid})`,
        });
      } else {
        agentPid.set(target.id, pid);
      }
    }
    if (agentPid.size === 0) return out;
    let envs: Map<number, AccountEnv>;
    try {
      envCalls += 1;
      envs = await deps.readAccountEnv([...new Set(agentPid.values())]);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const target of stale) {
        if (agentPid.has(target.id))
          remember(target, { status: "error", reason });
      }
      return out;
    }
    for (const target of stale) {
      const pid = agentPid.get(target.id);
      if (pid === undefined) continue;
      const env = envs.get(pid);
      remember(
        target,
        env
          ? { status: "ok", env }
          : {
              status: "error",
              reason: `process ${pid} ended before its environment was read`,
            },
      );
    }
    return out;
  }

  /** 裏で調べ直している最中の 1 回。重ねて呼ばない。 */
  let background: Promise<unknown> | null = null;

  async function probe(
    targets: readonly ProbeTarget[],
  ): Promise<Map<string, ProbeResult>> {
    const now = deps.now();
    const out = new Map<string, ProbeResult>();
    /** 覚えていない (新しい・コマンドが変わった) ペイン。待って調べる。 */
    const unknown: ProbeTarget[] = [];
    /** 覚えているが古いペイン。前の結果を返し、裏で調べ直す。 */
    const old: ProbeTarget[] = [];
    const live = new Set(targets.map((target) => target.id));
    for (const id of [...cache.keys()]) if (!live.has(id)) cache.delete(id);
    for (const target of targets) {
      const key = `${target.pid}:${target.command}`;
      const hit = cache.get(target.id);
      if (!hit || hit.key !== key) {
        unknown.push(target);
        continue;
      }
      out.set(target.id, hit.result);
      if (now - hit.at >= ttlMs) old.push(target);
    }
    if (unknown.length === 0 && old.length === 0) return out;
    // どうせ ps を呼ぶので、期限の半分を過ぎたものも一緒に調べ直す。
    // ペインごとに期限がずれて、別々の回に ps を呼ぶのを防ぐ。
    for (const target of targets) {
      if (unknown.includes(target) || old.includes(target)) continue;
      const hit = cache.get(target.id);
      if (hit && now - hit.at >= ttlMs / 2) old.push(target);
    }
    if (unknown.length === 0) {
      // 一覧の応答を ps (数百 ms かかることがある) で待たせない。
      background ??= refresh(old, now)
        .catch((error: unknown) => {
          // refresh は失敗を結果として覚えるので、ここに来るのは想定外の
          // 例外だけ。黙って捨てず、行に理由として出す。
          console.error("[code-viewer] account probe failed", error);
          const reason = error instanceof Error ? error.message : String(error);
          for (const target of old) {
            cache.set(target.id, {
              key: `${target.pid}:${target.command}`,
              at: now,
              result: { status: "error", reason },
            });
          }
        })
        .finally(() => {
          background = null;
        });
      return out;
    }
    const fresh = await refresh([...unknown, ...old], now);
    for (const [id, result] of fresh) out.set(id, result);
    return out;
  }

  return {
    probe,
    stats: () => ({ listCalls, envCalls }),
  };
}
