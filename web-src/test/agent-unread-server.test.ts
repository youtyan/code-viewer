// 未読をサーバのメモリに持つ (server/terminal/unread.ts)。画面を読み直しても
// 残り、見た・開いたで解ける。
import { afterEach, describe, expect, test } from "vitest";
import type { AgentPane } from "../core/agent-overview";
import type { AgentState } from "../core/agent-state";
import {
  clearAgentUnread,
  noteAgentUnread,
  resetAgentUnreadForTest,
} from "../server/terminal/unread";

afterEach(() => resetAgentUnreadForTest());

function pane(id: string, state: AgentState): AgentPane {
  return {
    id,
    label: id,
    session: "sample",
    title: "",
    command: "claude",
    path: "/work/sample",
    kind: "claude",
    state,
    source: "hook",
    updatedAt: 0,
    watchedSince: 0,
    project: "/work/sample",
    worktree: "",
    shownInShell: "",
    account: null,
  } as AgentPane;
}

describe("unread kept by the server", () => {
  test.each<[string, AgentState, AgentState, string | null]>([
    ["working → waiting", "working", "waiting", "waiting"],
    ["working → done", "working", "done", "finished"],
    ["working → idle", "working", "idle", "finished"],
    ["idle → waiting", "idle", "waiting", null],
    ["waiting → waiting", "waiting", "waiting", null],
  ])("%s", (_label, before, after, expected) => {
    noteAgentUnread([pane("%1", before)]);
    const unread = noteAgentUnread([pane("%1", after)]);
    expect(unread).toEqual(
      expected ? [{ pane: "%1", transition: expected }] : [],
    );
  });

  test("the first listing records nothing (it cannot tell what just changed)", () => {
    expect(noteAgentUnread([pane("%1", "done")])).toEqual([]);
  });

  test("stays across later listings (a reloaded page asks again) until cleared", () => {
    noteAgentUnread([pane("%1", "working")]);
    noteAgentUnread([pane("%1", "done")]);
    expect(noteAgentUnread([pane("%1", "done")])).toEqual([
      { pane: "%1", transition: "finished" },
    ]);
    expect(clearAgentUnread("%1")).toBe(true);
    expect(noteAgentUnread([pane("%1", "done")])).toEqual([]);
    expect(clearAgentUnread("%1")).toBe(false);
  });

  test("starting work again clears it", () => {
    noteAgentUnread([pane("%1", "working")]);
    noteAgentUnread([pane("%1", "waiting")]);
    expect(noteAgentUnread([pane("%1", "working")])).toEqual([]);
  });
});
