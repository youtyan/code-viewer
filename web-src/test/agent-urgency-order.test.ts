// 全体ボードの「急ぐ順」(core/agent-overview.ts の groupAgentPanesByUrgency)。
// プロジェクトをまたいで、入力待ち → 完了 → 作業中 → 待機。段の中は変わったのが
// 新しい順で、変わった瞬間を見ていないもの (updatedAt 0) は後ろ、同じなら場所の順。

import { describe, expect, test } from "vitest";
import {
  type AgentPane,
  groupAgentPanesByUrgency,
  groupAgentTreesByUrgency,
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

// 子エージェント (@agent-parent) を親の下に保ったまま、木ごと段に入れる版。
describe("groupAgentTreesByUrgency", () => {
  const child = (
    id: string,
    parent: string,
    state: AgentPane["state"],
    updatedAt: number,
  ) => ({ ...pane(id, state, updatedAt), parent });
  const sections = (panes: AgentPane[]) =>
    groupAgentTreesByUrgency(panes).map((group) => [
      group.state,
      group.rows.map(({ pane, depth }) => `${pane.id}@${depth}`),
    ]);

  test("without parents it is the same as the flat order", () => {
    const panes = [
      pane("%1", "waiting", 0, "b:0.0"),
      pane("%2", "idle", 100),
      pane("%3", "waiting", 300),
      pane("%4", "done", 50),
      pane("%5", "working", 0, "a:0.0"),
    ];
    expect(sections(panes)).toEqual(
      groupAgentPanesByUrgency(panes).map((group) => [
        group.state,
        group.panes.map((item) => `${item.id}@0`),
      ]),
    );
  });

  test("a worker that needs input lifts its whole tree into the waiting section, still under its parent", () => {
    expect(
      sections([
        pane("%1", "working", 10),
        child("%2", "%1", "waiting", 20),
        child("%3", "%1", "idle", 5),
        pane("%4", "done", 30),
      ]),
    ).toEqual([
      ["waiting", ["%1@0", "%2@1", "%3@1"]],
      ["done", ["%4@0"]],
    ]);
  });

  test("trees in one section are ordered by when their most urgent member changed", () => {
    expect(
      sections([
        pane("%1", "idle", 500),
        child("%2", "%1", "waiting", 10),
        pane("%3", "waiting", 20),
      ]),
    ).toEqual([["waiting", ["%3@0", "%1@0", "%2@1"]]]);
  });
});
