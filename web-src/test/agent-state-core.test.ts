// エージェントの状態を表す純粋な型と遷移規則。
//
// 画面の見落としに直結するのは「done を idle と混ぜないこと」なので、
// 出来事 → 状態の対応と、人間の番かどうかの判定を表で固定する。

import { describe, expect, test } from "vitest";
import {
  AGENT_EVENTS,
  AGENT_STATES,
  type AgentEvent,
  type AgentState,
  agentStateForEvent,
  agentStateFromActivity,
  isAgentEvent,
  isAgentState,
  needsAttention,
} from "../core/agent-state";

describe("agentStateForEvent", () => {
  test.each([
    { name: "指示を受けたら稼働", event: "prompt", expected: "working" },
    { name: "ツールを動かしたら稼働", event: "progress", expected: "working" },
    { name: "質問で止まったら待ち", event: "ask", expected: "waiting" },
    { name: "ターンが終わったら未読", event: "stop", expected: "done" },
    { name: "セッションが閉じたら停止", event: "exit", expected: "idle" },
  ] satisfies {
    name: string;
    event: AgentEvent;
    expected: AgentState;
  }[])("$name", ({ event, expected }) => {
    expect(agentStateForEvent(event)).toBe(expected);
  });

  test("すべての出来事に対応が定義されている", () => {
    for (const event of AGENT_EVENTS) {
      expect(AGENT_STATES).toContain(agentStateForEvent(event));
    }
  });

  // read だけは遷移前の状態を見る。未読を解くためだけの出来事なので、稼働中や
  // 入力待ちの対象を人間が覗いても状態は動かない。
  test.each([
    { name: "未読を読んだら停止になる", current: "done", expected: "idle" },
    {
      name: "稼働中を読んでも稼働のまま",
      current: "working",
      expected: "working",
    },
    {
      name: "入力待ちを読んでも待ちのまま",
      current: "waiting",
      expected: "waiting",
    },
    { name: "停止を読んでも停止のまま", current: "idle", expected: "idle" },
  ] satisfies {
    name: string;
    current: AgentState;
    expected: AgentState;
  }[])("$name", ({ current, expected }) => {
    expect(agentStateForEvent("read", current)).toBe(expected);
  });

  test("状態が分からない対象を読んだら停止として扱う", () => {
    expect(agentStateForEvent("read", null)).toBe("idle");
  });
});

describe("needsAttention", () => {
  test.each([
    { name: "待ちは人間の番", state: "waiting", expected: true },
    { name: "未読も人間の番", state: "done", expected: true },
    { name: "稼働中は人間の番ではない", state: "working", expected: false },
    { name: "停止は人間の番ではない", state: "idle", expected: false },
  ] satisfies {
    name: string;
    state: AgentState;
    expected: boolean;
  }[])("$name", ({ state, expected }) => {
    expect(needsAttention(state)).toBe(expected);
  });
});

describe("agentStateFromActivity", () => {
  // 出力の動きしか見ていないので、止まった理由までは決めない。待ちにも未読
  // にも倒さず idle にする、という約束をここで固定する。
  test.each([
    {
      name: "変化があれば稼働",
      changed: true,
      quietMs: 0,
      idleAfterMs: 1000,
      expected: "working",
    },
    {
      name: "変化があれば静かでも稼働",
      changed: true,
      quietMs: 9999,
      idleAfterMs: 1000,
      expected: "working",
    },
    {
      name: "境界の直前はまだ稼働",
      changed: false,
      quietMs: 999,
      idleAfterMs: 1000,
      expected: "working",
    },
    {
      name: "境界ちょうどで停止",
      changed: false,
      quietMs: 1000,
      idleAfterMs: 1000,
      expected: "idle",
    },
    {
      name: "境界を超えたら停止",
      changed: false,
      quietMs: 1001,
      idleAfterMs: 1000,
      expected: "idle",
    },
  ] satisfies {
    name: string;
    changed: boolean;
    quietMs: number;
    idleAfterMs: number;
    expected: AgentState;
  }[])("$name", ({ changed, quietMs, idleAfterMs, expected }) => {
    expect(agentStateFromActivity(changed, quietMs, idleAfterMs)).toBe(
      expected,
    );
  });

  test("待ちにも未読にも倒さない", () => {
    const guesses = [
      agentStateFromActivity(true, 0, 1000),
      agentStateFromActivity(false, 5000, 1000),
    ];
    expect(guesses).not.toContain("waiting");
    expect(guesses).not.toContain("done");
  });
});

describe("isAgentState / isAgentEvent", () => {
  test.each([
    { name: "既知の状態を通す", value: "waiting", expected: true },
    { name: "既知の状態を通す (done)", value: "done", expected: true },
    { name: "未知の文字列を弾く", value: "blocked", expected: false },
    { name: "空文字を弾く", value: "", expected: false },
    { name: "数値を弾く", value: 1, expected: false },
    { name: "null を弾く", value: null, expected: false },
    { name: "undefined を弾く", value: undefined, expected: false },
  ])("$name", ({ value, expected }) => {
    expect(isAgentState(value)).toBe(expected);
  });

  test.each([
    { name: "既知の出来事を通す", value: "ask", expected: true },
    { name: "既知の出来事を通す (exit)", value: "exit", expected: true },
    { name: "状態名は出来事ではない", value: "waiting", expected: false },
    { name: "空文字を弾く", value: "", expected: false },
    { name: "オブジェクトを弾く", value: {}, expected: false },
    { name: "null を弾く", value: null, expected: false },
  ])("$name", ({ value, expected }) => {
    expect(isAgentEvent(value)).toBe(expected);
  });
});
