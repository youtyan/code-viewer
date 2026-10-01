// Claude Code と Codex の、code-viewer が動作を確かめた版。
//
// code-viewer はこの 2 つの CLI の外から見える振る舞い (フックの出来事と欄・
// statusLine の JSON・画面の文言・ログインと使用量のコマンド・設定ファイルの
// 場所) に頼っていて、版が上がると黙って外れることがある。版が変わったら
// .agents/skills/project-agent-cli-upgrade/SKILL.md の点検を通し、通した版だけを
// ここに書く。doctor (server/doctor.ts の checkAgentClis) が手元の版と並べて出す。

import type { HookAgent } from "./agent-hooks";

export type CheckedAgentCli = {
  /** `<起動コマンド> --version` が出す版。 */
  version: string;
  /** 点検を通した日 (YYYY-MM-DD)。 */
  checkedOn: string;
};

export const CHECKED_AGENT_CLI_VERSIONS: Record<HookAgent, CheckedAgentCli> = {
  claude: { version: "2.1.286", checkedOn: "2026-10-02" },
  codex: { version: "0.159.3", checkedOn: "2026-10-02" },
};

/**
 * `--version` の出力の中の版 (`2.1.286 (Claude Code)`・`codex-cli 0.159.3`)。
 * 対話シェルを通すので前に端末向けの文字列が付くことがある。無ければ null。
 */
export function agentCliVersionIn(output: string): string | null {
  return /\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?/.exec(output)?.[0] ?? null;
}
