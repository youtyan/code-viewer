// codex を共有の裏のサーバ (daemon) なしで起こすか。
//
// codex は既定で、最初に起こした端末が始めた共有の裏のサーバ (`app-server
// --managed-daemon`) に後の codex をつなぐ。道具とフックはその裏のサーバの中で、
// 起こした端末の環境のまま走るので、2 つ目以降の codex のフックが送る
// `TMUX_PANE` は最初の端末のペインを指し、状態が別のペインに付く (2026-11-12 に
// 実際に確かめた。agents.md 4 の「codex の共有サーバ」)。code-viewer が起こす
// codex には `--no-daemon` を付けて、その codex の中で道具とフックを走らせる。
//
// 古い codex はこの引数を知らず、付けると起動に失敗する。`--help` に載っている
// 版のときだけ付ける。--help は起動のたびに走らせると遅いので、コマンドごとに
// しばらく覚える (codex を上げ下げしても、その間を過ぎれば訊き直す)。

import { formatErrorDetail } from "../../core/error-detail";
import { type RunResult, runAsync } from "../runtime";
import { agentCommandArgv } from "./launch";

export const CODEX_NO_DAEMON_ARG = "--no-daemon";
/** --help の答えを覚えておく間。 */
export const CODEX_HELP_CACHE_MS = 10 * 60_000;

/** codex の --help の文字から、--no-daemon を知っている版か。 */
export function codexKnowsNoDaemon(help: string): boolean {
  return /(^|\s)--no-daemon(\s|$)/m.test(help);
}

export type CodexDaemonDeps = {
  run(argv: string[], cwd: string): Promise<RunResult>;
  now(): number;
};

const known = new Map<string, { knows: boolean; at: number }>();

/**
 * 起動の引数の先頭に足すもの (`--no-daemon` か、何も無し)。--help を訊けなかった
 * ときは付けない (知らない版で付けると起動ごと失敗する) で、理由を console に出す。
 */
export async function codexDaemonArgs(
  command: string,
  cwd: string,
  deps: CodexDaemonDeps = {
    run: (argv, at) => runAsync(argv, at),
    now: Date.now,
  },
): Promise<string[]> {
  const cached = known.get(command);
  if (cached && deps.now() - cached.at < CODEX_HELP_CACHE_MS)
    return cached.knows ? [CODEX_NO_DAEMON_ARG] : [];
  let result: RunResult;
  try {
    result = await deps.run(agentCommandArgv(command, ["--help"]), cwd);
  } catch (error) {
    console.error(
      `[code-viewer] could not ask ${command} --help whether it knows ${CODEX_NO_DAEMON_ARG}; starting it without`,
      error,
    );
    return [];
  }
  if (result.code !== 0 || result.failure) {
    console.error(
      `[code-viewer] ${command} --help failed (exit ${result.code}); starting it without ${CODEX_NO_DAEMON_ARG}\n${formatErrorDetail(result.failure ?? result.stderr)}`,
    );
    return [];
  }
  const knows = codexKnowsNoDaemon(result.stdout);
  known.set(command, { knows, at: deps.now() });
  return knows ? [CODEX_NO_DAEMON_ARG] : [];
}

/** テストで覚えた答えを捨てる。 */
export function forgetCodexHelp(): void {
  known.clear();
}
