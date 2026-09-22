// reloadAgentScreenRules は、今日の差分でユーザー単位のファイルロック
// (withAgentScreenRulesLock、待つのは 5 秒まで) の中で読むようになった。
// 読めなかったときの catch が「既定のルールを有効にする」(activate) だった
// ので、ロックを待ちきれなかっただけ (別のプロセスが保存中・落ちたプロセスの
// ロックが 10 秒残っている) でも、入口の状態の判定が保存したルールから
// 既定のルールへ切り替わっていた。読み直しは設定画面を開くたびの
// GET /_agent/rules で走るので、画面を開いただけで判定が変わりえた。
// いまは前のルールのまま、GET は 503 と理由を返す。
// 状態ディレクトリは CODE_VIEWER_TEST_STATE_DIR (テストの隔離) に従う。

import { afterEach, describe, expect, test } from "vitest";
import {
  type AgentScreenRuleSet,
  DEFAULT_AGENT_SCREEN_RULES,
} from "../core/agent-screen";
import { resolvedFileLockPath, tryAcquireFileLock } from "../server/file-lock";
import { handleAgentRoute } from "../server/terminal/handle";
import {
  agentScreenRulesFilePath,
  getActiveAgentScreenRules,
  resetAgentScreenRules,
  resetAgentScreenRulesForTest,
  saveAgentScreenRules,
} from "../server/terminal/rules";

afterEach(async () => {
  await resetAgentScreenRules();
  resetAgentScreenRulesForTest();
});

describe("reloading terminal rules while another process holds their lock", () => {
  test("ロックを待ちきれなくても保存したルールのまま判定を続け、GET は 503 と理由を返す", async () => {
    resetAgentScreenRulesForTest();
    const saved: AgentScreenRuleSet = {
      ...DEFAULT_AGENT_SCREEN_RULES,
      rules: DEFAULT_AGENT_SCREEN_RULES.rules.slice(1),
    };
    await saveAgentScreenRules(saved);
    expect(getActiveAgentScreenRules()).toEqual(saved);

    // 別のプロセスが保存している最中 (生きた持ち主の新しいロック)。
    const held = tryAcquireFileLock(
      resolvedFileLockPath(agentScreenRulesFilePath()),
      { staleMs: 60_000 },
    );
    expect(held).not.toBeNull();
    try {
      const url = new URL("http://127.0.0.1:0/_agent/rules");
      const response = await handleAgentRoute(
        new Request(url),
        url,
        "/work/sample-app",
        () => true,
      );
      expect(response?.status).toBe(503);
      expect(await response?.json()).toMatchObject({
        errors: [{ path: "$", code: "reload_failed" }],
      });
    } finally {
      held?.release();
    }

    expect(getActiveAgentScreenRules()).toEqual(saved);
  });
});
