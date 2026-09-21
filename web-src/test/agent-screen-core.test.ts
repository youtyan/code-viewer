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

// 実画面の並び (本文 → 作業中の行 → 挟まる行 → 入力欄 → その下に積まれる行) を
// 中立な文言で組み立てる。入力欄の下の行数と挟まる行を変えても判定が変わらない
// ことを見る。
const RULE = "─".repeat(40);

function claudeScreen({
  status,
  between = [],
  prompt = "❯ ",
  statusLines = 2,
}: {
  status: string;
  between?: string[];
  prompt?: string;
  statusLines?: number;
}): string {
  return [
    "⏺ Sample answer.",
    "  Sample detail.",
    "",
    status,
    ...between,
    RULE,
    prompt,
    RULE,
    ...Array.from({ length: statusLines }, (_, i) => `  sample status ${i}`),
    "  ⏵⏵ sample mode on (shift+tab to cycle)",
  ].join("\n");
}

const TIP = "  ⎿  Tip: sample tip";
const QUEUED = [
  "❯ queued sample message",
  "  second line of the queued message",
  "  ctrl+x ctrl+s to send now",
];
const CODEX_NOISE = "⠁     ⠄        ⠈   ⢀";

describe("detectAgentScreen: 入力欄の下に行が積まれた画面", () => {
  test.each([
    {
      name: "作業中 (thinking あり、作業中の行が下から 8 行以内)",
      screen: claudeScreen({
        status: "✽ Sampling… (33s · ↓ 2.8k tokens · thinking with high effort)",
      }),
      expected: { state: "working", ruleId: "live_reasoning" },
    },
    {
      name: "作業中 (thinking なし)",
      screen: claudeScreen({
        status: "✶ Sampling… (30m 20s · ↓ 140.9k tokens)",
        between: [TIP],
      }),
      expected: { state: "working", ruleId: "live_spinner" },
    },
    {
      name: "作業中 (thinking あり、ステータスライン 3 行で 8 行の外)",
      screen: claudeScreen({
        status: "✳ Sampling… (20s · ↓ 1.6k tokens · thinking with high effort)",
        between: [TIP],
        statusLines: 3,
      }),
      expected: { state: "working", ruleId: "live_spinner" },
    },
    {
      name: "作業中 (ステータスライン 6 行)",
      screen: claudeScreen({
        status: "· Sampling… (2m 46s · ↓ 11.4k tokens)",
        statusLines: 6,
      }),
      expected: { state: "working", ruleId: "live_spinner" },
    },
    {
      name: "作業中 (積まれた送信待ちの文と、その編集案内が入力欄にある)",
      screen: claudeScreen({
        status: "✢ Sampling… (1m 11s · ↓ 1.5k tokens)",
        between: [TIP, ...QUEUED],
        prompt: "❯ Press up to edit queued messages",
      }),
      expected: { state: "working", ruleId: "live_spinner" },
    },
    {
      name: "作業中 (入力欄に予測入力の文字がある)",
      screen: claudeScreen({
        status: "✻ Sampling… (5s · ↓ 120 tokens)",
        prompt: "❯ sample predicted text",
        statusLines: 3,
      }),
      expected: { state: "working", ruleId: "live_spinner" },
    },
    {
      name: "作業中 (旧表示: 割り込み案内だけ)",
      screen: claudeScreen({ status: "✻ Sampling… (esc to interrupt)" }),
      expected: { state: "working", ruleId: "live_spinner" },
    },
    {
      name: "待機 (for … done の行と予測入力)",
      screen: claudeScreen({
        status: "✻ Sampled for 2m 42s · done 20:07",
        prompt: "❯ sample predicted text",
        statusLines: 3,
      }),
      expected: { state: "idle", ruleId: "prompt_box" },
    },
    {
      name: "待機 (for … done の後ろに実行中のシェル数)",
      screen: claudeScreen({
        status: "✻ Sampled for 2m 54s · done 22:39 · 1 shell still running",
      }),
      expected: { state: "idle", ruleId: "prompt_box" },
    },
    {
      name: "待機 (本文の行頭に … と括弧があっても字下げされていれば作業中にしない)",
      screen: claudeScreen({
        status: "  Calling sample-tool… (ctrl+o to expand)",
      }),
      expected: { state: "idle", ruleId: "prompt_box" },
    },
    {
      name: "待機 (ステータスライン 6 行で入力欄が 8 行の外)",
      screen: claudeScreen({
        status: "✻ Sampled for 12s · done 10:00",
        statusLines: 6,
      }),
      expected: { state: "idle", ruleId: "framed_prompt" },
    },
    {
      name: "入力待ち (作業中の行が残ったまま許可の確認)",
      screen: [
        "✶ Sampling… (12s · ↓ 1.2k tokens)",
        RULE,
        " Bash command",
        "   sample-command --flag",
        " Do you want to proceed?",
        " ❯ 1. Yes",
        "   2. Yes, and don't ask again for sample-command",
        "   3. No, and tell the agent what to do differently (esc)",
        "  sample status 0",
        "  sample status 1",
        "  sample status 2",
      ].join("\n"),
      expected: { state: "waiting", ruleId: "permission_request" },
    },
    {
      name: "入力待ち (作業中の行が残ったまま送信待ちの質問)",
      screen: [
        "✶ Sampling… (12s · ↓ 1.2k tokens)",
        " Sample question?",
        " ❯ 1. First option",
        "   2. Second option",
        " Enter to submit answer",
      ].join("\n"),
      expected: { state: "waiting", ruleId: "strong_input_request" },
    },
    {
      name: "入力待ち (選択の画面)",
      screen: [
        "✶ Sampling… (12s · ↓ 1.2k tokens)",
        " Pick one option",
        " ❯ 1. First option",
        "   2. Second option",
        " Enter to select · ↑/↓ to navigate · Esc to cancel",
      ].join("\n"),
      expected: { state: "waiting", ruleId: "interactive_form" },
    },
    {
      name: "codex の作業中 (入力欄の周りに点字の飾りがある)",
      screen: [
        "• Sample answer.",
        "• Working (2h 08m 08s • esc to interrupt)",
        CODEX_NOISE,
        `› Ask sample agent anything ${CODEX_NOISE}`,
        CODEX_NOISE,
        "  sample-model high · ~/sample · Working",
      ].join("\n"),
      title: "⠋ sample task",
      expected: { state: "working", ruleId: "title_spinner" },
    },
    {
      name: "codex の作業中 (タイトルに頼らず、送信待ちの文で作業中の行が下から離れる)",
      screen: [
        "• Sample answer.",
        "• Planning the change (41s • esc to interrupt)",
        "  ↳ queued sample message",
        "  second line of the queued message",
        CODEX_NOISE,
        `› Ask sample agent anything ${CODEX_NOISE}`,
        CODEX_NOISE,
        "  sample-model high · ~/sample",
      ].join("\n"),
      title: "sample task",
      expected: { state: "working", ruleId: "live_interrupt_hint" },
    },
    {
      name: "codex の待機 (入力欄の周りに点字の飾りがある)",
      screen: [
        "• Sample answer.",
        "  Worked for 10m 10s · done 10:18 PM",
        CODEX_NOISE,
        `›⠁Ask sample agent anything ${CODEX_NOISE}`,
        CODEX_NOISE,
        "  sample-model high · ~/sample · Ready",
      ].join("\n"),
      title: "sample task",
      expected: { state: "idle", ruleId: "input_composer" },
    },
    {
      name: "codex の入力待ち (実行の許可)",
      screen: [
        "  Would you like to run the following command?",
        "  $ sample-command --flag",
        "› 1. Yes, proceed (y)",
        "  2. No, and tell the agent what to do differently (esc)",
        "  Press enter to confirm or esc to cancel",
      ].join("\n"),
      title: "sample task",
      expected: { state: "waiting", ruleId: "interactive_form" },
    },
  ])("$name", ({ screen, title, expected }) => {
    expect(detectAgentScreen({ screen, title })).toMatchObject({
      kind: "state",
      ...expected,
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
