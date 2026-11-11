// 全体ボードの「急ぐ順」(core/agent-overview.ts の groupAgentPanesByUrgency)。
// プロジェクトをまたいで、入力待ち → 完了 → 作業中 → 待機。段の中は変わったのが
// 新しい順で、変わった瞬間を見ていないもの (updatedAt 0) は後ろ、同じなら場所の順。

import { describe, expect, test } from "vitest";
import {
  type AgentPane,
  groupAgentPanesByUrgency,
} from "../core/agent-overview";
import { agentPane } from "./_test-helpers";

const pane = (
  id: string,
  state: AgentPane["state"],
  updatedAt: number,
  label = `a:0.${id.slice(1)}`,
) => agentPane({ id, state, updatedAt, label });

describe("groupAgentPanesByUrgency", () => {
  test("states in order of urgency, empty ones left out", () => {
    expect(
      groupAgentPanesByUrgency([
        pane("%1", "idle", 5),
        pane("%2", "working", 5),
        pane("%3", "waiting", 5),
      ]).map((group) => group.state),
    ).toEqual(["waiting", "working", "idle"]);
  });

  test("newest change first; unseen changes last; ties by place", () => {
    expect(
      groupAgentPanesByUrgency([
        pane("%1", "waiting", 0, "b:0.0"),
        pane("%2", "waiting", 100),
        pane("%3", "waiting", 300),
        pane("%4", "waiting", 0, "a:0.0"),
      ])[0]?.panes.map((item) => item.id),
    ).toEqual(["%3", "%2", "%4", "%1"]);
  });
});
