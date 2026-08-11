import { describe, expect, test } from "vitest";
import {
  type AgentScreenRuleSet,
  DEFAULT_AGENT_SCREEN_RULES,
  detectAgentScreen,
  parseAgentScreenRuleSet,
} from "../core/agent-screen";

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

describe("detectAgentScreen", () => {
  test.each([
    {
      name: "タイトルが入力要求なら待ち",
      input: { screen: "", title: "Action Required" },
      expected: {
        kind: "state",
        state: "waiting",
        ruleId: "title_requires_input",
      },
    },
    {
      name: "タイトルのスピナーは作業表示として検出する",
      input: { screen: "", title: "⠋ Working" },
      expected: { kind: "state", state: "working", ruleId: "title_spinner" },
    },
    {
      name: "確認フォームは待ち",
      input: { screen: "Review changes\nEnter to confirm\nEsc to cancel" },
      expected: { kind: "state", state: "waiting", ruleId: "interactive_form" },
    },
    {
      name: "送信待ちの質問は待ち",
      input: { screen: "Question\nEnter to submit answer" },
      expected: {
        kind: "state",
        state: "waiting",
        ruleId: "strong_input_request",
      },
    },
    {
      name: "許可の選択肢が見えていれば待ち",
      input: { screen: "Do you want to proceed?\n❯ Yes\n  No" },
      expected: {
        kind: "state",
        state: "waiting",
        ruleId: "permission_request",
      },
    },
    {
      name: "短い確認表記も待ち",
      input: { screen: "Continue? [y/n]" },
      expected: {
        kind: "state",
        state: "waiting",
        ruleId: "weak_input_request",
      },
    },
    {
      name: "作業表示を作業中の候補として検出する",
      input: {
        screen:
          "• Working (12s · esc to interrupt)\n› Continue\nexample status",
      },
      expected: {
        kind: "state",
        state: "working",
        ruleId: "live_working_status",
      },
    },
    {
      name: "入力欄が残っていても思考表示があれば作業中",
      input: {
        screen:
          "✢ Thinking… (12s · 120 tokens)\n────────\n❯ Continue\n────────",
      },
      expected: { kind: "state", state: "working", ruleId: "live_reasoning" },
    },
    {
      name: "作業表示のトークン数が次の行へ折り返されても作業中",
      input: {
        screen: "✶ Thinking…\n  · 120 tokens\n────────\n❯ Continue\n────────",
      },
      expected: { kind: "state", state: "working", ruleId: "live_reasoning" },
    },
    {
      name: "思考表示が残っていても確認フォームを優先する",
      input: {
        screen:
          "✢ Thinking… (12s · 120 tokens)\n❯ Yes\nEnter to confirm\nEsc to cancel",
      },
      expected: { kind: "state", state: "waiting", ruleId: "interactive_form" },
    },
    {
      name: "完了表示と入力欄だけなら待機",
      input: {
        screen: "✢ Finished (12s · 120 tokens)\n────────\n❯ Continue\n────────",
      },
      expected: { kind: "state", state: "idle", ruleId: "prompt_box" },
    },
    {
      name: "入力欄が見えていれば待機",
      input: { screen: "────────\n❯ Ask something\n────────" },
      expected: { kind: "state", state: "idle", ruleId: "prompt_box" },
    },
    {
      name: "最後の入力記号は待機",
      input: { screen: "Finished\n› " },
      expected: { kind: "state", state: "idle", ruleId: "last_prompt" },
    },
    {
      name: "ANSI色指定があっても判定する",
      input: { screen: `${ESC}[33mEnter to submit answer${ESC}[0m` },
      expected: {
        kind: "state",
        state: "waiting",
        ruleId: "strong_input_request",
      },
    },
    {
      name: "画面内のOSCタイトルを使う",
      input: { screen: `${ESC}]0;Action Required${BEL}body` },
      expected: {
        kind: "state",
        state: "waiting",
        ruleId: "title_requires_input",
      },
    },
    {
      name: "入力欄より確認フォームを優先する",
      input: { screen: "❯ Yes\nEnter to confirm\nEsc to cancel" },
      expected: { kind: "state", state: "waiting", ruleId: "interactive_form" },
    },
  ])("$name", ({ input, expected }) => {
    expect(detectAgentScreen(input)).toMatchObject(expected);
  });

  test("履歴表示中は状態を更新しない", () => {
    expect(
      detectAgentScreen({ screen: "Showing detailed transcript" }),
    ).toEqual({
      kind: "skip",
      ruleId: "transcript_view",
      priority: 1000,
    });
  });

  test("根拠になる表示が無ければ判定しない", () => {
    expect(detectAgentScreen({ screen: "ordinary command output" })).toEqual({
      kind: "none",
    });
  });

  test("設定したルールと同点時の先勝ちを使う", () => {
    const rules: AgentScreenRuleSet = {
      version: 1,
      rules: [
        {
          id: "first",
          state: "waiting",
          priority: 10,
          region: "whole_recent",
          contains: ["sample"],
        },
        {
          id: "second",
          state: "working",
          priority: 10,
          region: "whole_recent",
          contains: ["sample"],
        },
      ],
    };
    expect(detectAgentScreen({ screen: "SAMPLE" }, rules)).toEqual({
      kind: "state",
      state: "waiting",
      ruleId: "first",
      priority: 10,
    });
  });
});

describe("parseAgentScreenRuleSet", () => {
  test("既定ルールは設定ファイルとして妥当", () => {
    expect(parseAgentScreenRuleSet(DEFAULT_AGENT_SCREEN_RULES)).toEqual({
      ok: true,
      value: DEFAULT_AGENT_SCREEN_RULES,
    });
  });

  test("空のルール集で画面判定を無効化できる", () => {
    const result = parseAgentScreenRuleSet({ version: 1, rules: [] });
    expect(result).toEqual({ ok: true, value: { version: 1, rules: [] } });
  });

  test("複数箇所の設定エラーをすべて返す", () => {
    const result = parseAgentScreenRuleSet({
      version: 2,
      extra: true,
      rules: [
        {
          id: "Bad id",
          state: "unknown",
          priority: 1.5,
          region: "bottom_non_empty",
          lines: 0,
          contains: [],
          regex: ["("],
          typo: true,
        },
        {
          id: "same",
          state: "idle",
          priority: 1,
          region: "whole_recent",
          contains: ["one"],
        },
        {
          id: "same",
          state: "working",
          priority: 2,
          region: "whole_recent",
          contains: ["two"],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!("errors" in result)) throw new Error("expected invalid rule set");
    expect(result.errors.map((error) => [error.path, error.code])).toEqual(
      expect.arrayContaining([
        ["extra", "unknown_field"],
        ["version", "unsupported_version"],
        ["rules[0].typo", "unknown_field"],
        ["rules[0].contains", "invalid_length"],
        ["rules[0].regex[0]", "invalid_regex"],
        ["rules[0].id", "invalid_id"],
        ["rules[0].state", "invalid_state"],
        ["rules[0].priority", "invalid_priority"],
        ["rules[0].lines", "invalid_lines"],
        ["rules[2].id", "duplicate_id"],
      ]),
    );
  });

  test.each([
    { name: "入れ子の繰返し", pattern: "^(a+)+$" },
    { name: "繰返す選択肢", pattern: "^(a|aa)+$" },
    { name: "後方参照", pattern: "^(a+)\\1$" },
    { name: "複数の無制限繰返し", pattern: "^a+.*b$" },
    { name: "複数の範囲繰返し", pattern: "^a{0,100}a{0,100}$" },
    { name: "複数の省略可能文字", pattern: "^a?a?$" },
  ])("危険な正規表現を拒否する: $name", ({ pattern }) => {
    const result = parseAgentScreenRuleSet({
      version: 1,
      rules: [
        {
          id: "unsafe_pattern",
          state: "working",
          priority: 1,
          region: "whole_recent",
          regex: [pattern],
        },
      ],
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          path: "rules[0].regex[0]",
          code: "unsafe_regex",
        }),
      ],
    });
  });
});
