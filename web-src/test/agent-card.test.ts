// エージェントのカード (views/agents/agent-card.ts)。左のサイドバーと全体ボードが
// 同じものを使う。1 行目 = 状態の印・名前・札、2 行目 = 補足、右端 = 未読の点。
// 札は見ていない間に入力待ちになった・終わったものだけで、札があるときは補足に
// 状態の語を繰り返さない。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { AgentTransition } from "../core/agent-overview";
import type { AgentState } from "../core/agent-state";
import { fillAgentCard } from "../views/agents/agent-card";
import { agentsText } from "../views/agents/i18n";
import { agentPane } from "./_test-helpers";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

function card(
  options: {
    state?: AgentState;
    title?: string;
    worktree?: string;
    unread?: AgentTransition;
    extra?: string[];
    lang?: "en" | "ja";
  } = {},
) {
  const row = document.createElement("button");
  const extra = (options.extra ?? []).map((value) => {
    const item = document.createElement("span");
    item.className = "sample-extra";
    item.textContent = value;
    return item;
  });
  fillAgentCard(
    row,
    agentPane({
      id: "%1",
      state: options.state ?? "working",
      title: options.title ?? "✳ Review plan",
      worktree: options.worktree ?? "",
    }),
    agentsText(options.lang ?? "en"),
    options.unread,
    extra,
  );
  return {
    parts: [...row.children].map((child) => child.className),
    name: row.querySelector(".agent-card-name")?.textContent,
    badge: row.querySelector(".agent-card-badge")?.textContent ?? null,
    meta: row.querySelector(".agent-card-meta")?.textContent,
  };
}

describe("the card is two lines: mark, heading (name + badge), details", () => {
  test("the parts, in order", () => {
    expect(card().parts).toEqual([
      "terminal-mark terminal-mark-working",
      "agent-card-head",
      "agent-card-meta",
      "agent-card-unread",
    ]);
  });

  test.each([
    [
      "a task: the task is the name, the kind leads the details",
      { title: "✳ Review plan" },
      { name: "Review plan", badge: null, meta: "claude · Working · –" },
    ],
    [
      "no task: the kind is the name",
      { title: "claude", state: "idle" as const },
      { name: "claude", badge: null, meta: "Idle · –" },
    ],
    [
      "a worktree follows the time",
      { worktree: "feature-sample" },
      {
        name: "Review plan",
        badge: null,
        meta: "claude · Working · – · feature-sample",
      },
    ],
    [
      "started waiting while away: the badge says so, the details do not repeat it",
      { state: "waiting" as const, unread: "waiting" as const },
      { name: "Review plan", badge: "Needs input", meta: "claude · –" },
    ],
    [
      "finished while away",
      { state: "done" as const, unread: "finished" as const },
      { name: "Review plan", badge: "Done", meta: "claude · –" },
    ],
    [
      "Japanese",
      {
        state: "done" as const,
        unread: "finished" as const,
        lang: "ja" as const,
      },
      { name: "Review plan", badge: "完了", meta: "claude · –" },
    ],
    [
      "the board adds its own items; an empty one is skipped",
      { extra: ["", "work:0.0"] },
      {
        name: "Review plan",
        badge: null,
        meta: "claude · Working · – · work:0.0",
      },
    ],
  ])("%s", (_name, options, expected) => {
    const { name, badge, meta } = card(options);
    expect({ name, badge, meta }).toEqual(expected);
  });
});
