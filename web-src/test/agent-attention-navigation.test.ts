// 手が要るエージェント (入力待ち → 完了・未読) を順に開くキー
// (core/agent-overview.ts の nextAttentionPane と core/keymap.ts の割り当て)。

import { describe, expect, test } from "vitest";
import {
  type AgentPane,
  attentionPanes,
  nextAttentionPane,
} from "../core/agent-overview";
import { findKeymapConflicts, resolveKeymapAction } from "../core/keymap";
import { agentPane } from "./_test-helpers";

function pane(
  id: string,
  state: AgentPane["state"],
  label: string,
  kind: AgentPane["kind"] = "claude",
): AgentPane {
  return agentPane({ id, state, label, kind });
}

const PANES = [
  pane("%1", "working", "a:0.0"),
  pane("%2", "done", "a:0.1"),
  pane("%3", "waiting", "b:0.0"),
  pane("%4", "idle", "b:0.1"),
  pane("%5", "waiting", "a:1.0"),
  pane("%6", "done", "a:0.2", null),
];

describe("attentionPanes", () => {
  test("waiting first, then done, each in tmux place order; plain panes are not agents", () => {
    expect(attentionPanes(PANES).map((item) => item.id)).toEqual([
      "%5",
      "%3",
      "%2",
    ]);
  });
});

describe("nextAttentionPane", () => {
  test.each([
    { current: null, direction: 1, expected: "%5" },
    { current: null, direction: -1, expected: "%2" },
    { current: "%5", direction: 1, expected: "%3" },
    { current: "%3", direction: 1, expected: "%2" },
    { current: "%2", direction: 1, expected: "%5" },
    { current: "%5", direction: -1, expected: "%2" },
    // 見ていたものが読まれて待機に戻った・手の要らないものを見ている
    { current: "%4", direction: 1, expected: "%5" },
    { current: "%1", direction: -1, expected: "%2" },
  ] as const)(
    "from $current going $direction -> $expected",
    ({ current, direction, expected }) => {
      expect(nextAttentionPane(PANES, current, direction)?.id).toBe(expected);
    },
  );

  test("nothing needs you: null", () => {
    expect(
      nextAttentionPane([pane("%1", "working", "a:0.0")], null, 1),
    ).toBeNull();
  });

  test("only the one you are on: stays there", () => {
    expect(
      nextAttentionPane([pane("%1", "waiting", "a:0.0")], "%1", 1)?.id,
    ).toBe("%1");
  });
});

describe("the keys", () => {
  const press = (shift: boolean) =>
    resolveKeymapAction(
      { key: shift ? "N" : "n", shiftKey: shift },
      { scope: "main", editable: false, pendingG: true },
    );

  test("g n opens the next, g N the previous", () => {
    expect(press(false)).toBe("agent-next-attention");
    expect(press(true)).toBe("agent-previous-attention");
  });

  test("n alone keeps its meaning in the diff", () => {
    expect(
      resolveKeymapAction({ key: "n" }, { scope: "main", editable: false }),
    ).toBe("next-unviewed-file");
  });

  test("the default keys do not collide", () => {
    expect(findKeymapConflicts()).toEqual([]);
  });
});
