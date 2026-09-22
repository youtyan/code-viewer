// 未読をサーバのメモリに持つ (server/terminal/unread.ts)。画面を読み直しても
// 残り、見た・開いたで解ける。未読は状態の記録が変わった瞬間に進むので、
// 一覧 (noteAgentUnread) を取りに来ない間の変化も残る。
import { afterEach, describe, expect, test } from "vitest";
import type { AgentPane } from "../core/agent-overview";
import type { AgentState } from "../core/agent-state";
import {
  clearAgentStates,
  recordAgentState,
} from "../server/terminal/agent-state";
import {
  clearAgentUnread,
  noteAgentUnread,
  resetAgentUnread,
} from "../server/terminal/unread";

afterEach(() => {
  resetAgentUnread();
  clearAgentStates();
});

/** 巡回がそのペインの状態を記録した。 */
function observe(id: string, state: AgentState): void {
  recordAgentState({ target: id, state, source: "screen" });
}

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
    observe("%1", before);
    observe("%1", after);
    const unread = noteAgentUnread([pane("%1", after)]);
    expect(unread).toEqual(
      expected ? [{ pane: "%1", transition: expected }] : [],
    );
  });

  test("the first record is nothing (it cannot tell what just changed)", () => {
    observe("%1", "done");
    expect(noteAgentUnread([pane("%1", "done")])).toEqual([]);
  });

  test("a change seen only by the watch, with no listing in between, stays", () => {
    observe("%1", "idle");
    observe("%1", "working");
    observe("%1", "waiting");
    expect(noteAgentUnread([pane("%1", "waiting")])).toEqual([
      { pane: "%1", transition: "waiting" },
    ]);
  });

  test("stays across later listings (a reloaded page asks again) until cleared", () => {
    observe("%1", "working");
    observe("%1", "done");
    expect(noteAgentUnread([pane("%1", "done")])).toEqual([
      { pane: "%1", transition: "finished" },
    ]);
    expect(clearAgentUnread("%1")).toBe(true);
    expect(noteAgentUnread([pane("%1", "done")])).toEqual([]);
    expect(clearAgentUnread("%1")).toBe(false);
  });

  test("starting work again clears it", () => {
    observe("%1", "working");
    observe("%1", "waiting");
    observe("%1", "working");
    expect(noteAgentUnread([pane("%1", "working")])).toEqual([]);
  });
});
