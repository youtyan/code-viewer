// エージェントを共有の裏のサーバなしで起こす引数。
//
// codex と opencode 2 は既定で、最初に起こした端末が始めた共有の裏のサーバに
// 後のものをつなぐ。道具とフック (opencode はプラグイン) はその裏のサーバの中で、
// 起こした端末の環境のまま走るので、2 つ目以降のフックが送る `TMUX_PANE` は
// 最初の端末のペインを指し、状態が別のペインに付く。
//
// - codex: 裏のサーバは `app-server --managed-daemon`。`--no-daemon` を付けると、
//   その codex の中で道具とフックを走らせる (2026-11-12 に codex 0.167.1 で確かめた。
//   agents.md 4 の「codex の共有の裏のサーバ」)
// - opencode: 2 の裏のサーバは `opencode serve --service`。端末を閉じても残り、
//   最初の端末の TMUX_PANE を持ち続ける。`--standalone` を付けると、その opencode
//   の子 (`serve --stdio`) でプラグインが動き、終わると片付けが呼ばれる (2026-11-13
//   に 2.2.7 で確かめた)。code-viewer のプラグインは裏のサーバの中では申告しない
//   (core/agent-hooks.ts の opencodePluginSource)。opencode 1 には裏のサーバも
//   この引数も無い
//
// code-viewer が起こすものに付ける。ログインの状態を訊く `opencode auth list` にも
// 付ける (付けないと、裏のサーバが無いときに code-viewer の環境で起こしてしまう)。
//
// 古い版はこの引数を知らず、付けると失敗する。`--help` に載っている版のときだけ
// 付ける。--help は起動のたびに走らせると遅いので、コマンドごとにしばらく覚える
// (CLI を上げ下げしても、その間を過ぎれば訊き直す)。

import type { AccountAgent } from "../../core/agent-accounts";
import { formatErrorDetail } from "../../core/error-detail";
import { type RunResult, runAsync } from "../runtime";
import { agentCommandArgv } from "./launch";

/** 種類ごとの、共有の裏のサーバを使わない引数。無い種類は何も付けない。 */
export const SHARED_SERVER_OFF_ARGS: Readonly<
  Partial<Record<AccountAgent, string>>
> = { codex: "--no-daemon", opencode: "--standalone" };
/** --help の答えを覚えておく間。 */
export const AGENT_HELP_CACHE_MS = 10 * 60_000;
/**
 * --help を待つ上限。起動コマンドがラッパーで、--help で終わらない (そのまま
 * 対話を始める) と、起動の要求ごと止まる (砂場の偽の codex で実際に止まった)。
 */
export const AGENT_HELP_TIMEOUT_MS = 5_000;

/** --help の文字に、その引数がそのままの綴りで載っているか。 */
export function helpListsFlag(help: string, flag: string): boolean {
  return help.split(/\s+/).includes(flag);
}

export type SharedServerDeps = {
  run(argv: string[], cwd: string): Promise<RunResult>;
  now(): number;
};

const known = new Map<string, { knows: boolean; at: number }>();

/**
 * 起動・ログインの状態の確認の引数に足すもの (`--no-daemon` / `--standalone` か、
 * 何も無し)。--help を訊けなかったときは付けない (知らない版で付けると起動ごと
 * 失敗する) で、理由を console に出す。
 */
export async function sharedServerArgs(
  agent: AccountAgent,
  command: string,
  cwd: string,
  deps: SharedServerDeps = {
    run: (argv, at) => runAsync(argv, at, { timeout: AGENT_HELP_TIMEOUT_MS }),
    now: Date.now,
  },
): Promise<string[]> {
  const flag = SHARED_SERVER_OFF_ARGS[agent];
  if (!flag) return [];
  const key = `${agent}\n${command}`;
  const cached = known.get(key);
  if (cached && deps.now() - cached.at < AGENT_HELP_CACHE_MS)
    return cached.knows ? [flag] : [];
  let result: RunResult;
  try {
    result = await deps.run(agentCommandArgv(command, ["--help"]), cwd);
  } catch (error) {
    console.error(
      `[code-viewer] could not ask ${command} --help whether it knows ${flag}; running it without`,
      error,
    );
    return [];
  }
  if (result.code !== 0 || result.failure) {
    console.error(
      `[code-viewer] ${command} --help failed (exit ${result.code}); running it without ${flag}\n${formatErrorDetail(result.failure ?? result.stderr)}`,
    );
    // 答えない・失敗するコマンドを起動のたびに待たない (覚えておく間だけ)。
    known.set(key, { knows: false, at: deps.now() });
    return [];
  }
  const knows = helpListsFlag(result.stdout, flag);
  known.set(key, { knows, at: deps.now() });
  return knows ? [flag] : [];
}

/** テストで覚えた答えを捨てる。 */
export function forgetAgentHelp(): void {
  known.clear();
}
