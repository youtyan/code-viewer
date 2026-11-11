// 子エージェントを親の下に並べる (tmux のペインのユーザーオプション @agent-parent)。
// code-viewer は読むだけで、自分が起こす引き継ぎにだけ付ける。

import "./_dom";
import { html, render } from "lit/html.js";
import { describe, expect, test } from "vitest";
import {
  type AgentPane,
  MAX_AGENT_DEPTH,
  nestAgentPanes,
} from "../core/agent-overview";
import { launchedPaneOptionArgs } from "../server/accounts/launch";
import { agentRowTemplate } from "../views/agents/agent-card";

const node = (id: string, parent?: string) => ({
  id,
  ...(parent ? { parent } : {}),
});

const shape = (panes: { id: string; parent?: string }[]) =>
  nestAgentPanes(panes).map(({ pane, depth }) => `${pane.id}:${depth}`);

describe("nestAgentPanes", () => {
  test("children go right under their parent, siblings keep their order", () => {
    expect(
      shape([
        node("%3", "%1"),
        node("%1"),
        node("%2"),
        node("%4", "%1"),
        node("%5", "%3"),
      ]),
    ).toEqual(["%1:0", "%3:1", "%5:2", "%4:1", "%2:0"]);
  });

  test("a parent not in the list (another project, gone) leaves the child where it was", () => {
    expect(shape([node("%1"), node("%2", "%9")])).toEqual(["%1:0", "%2:0"]);
  });

  test("a loop of parents is left flat", () => {
    expect(shape([node("%1", "%2"), node("%2", "%1"), node("%3")])).toEqual([
      "%1:0",
      "%2:0",
      "%3:0",
    ]);
  });

  test(`deep chains stop indenting at ${MAX_AGENT_DEPTH}`, () => {
    const chain = [node("%0")];
    for (let i = 1; i <= MAX_AGENT_DEPTH + 2; i++)
      chain.push(node(`%${i}`, `%${i - 1}`));
    expect(nestAgentPanes(chain).map(({ depth }) => depth)).toEqual([
      0, 1, 2, 3, 3, 3,
    ]);
  });

  test("every pane comes out once", () => {
    const panes = [node("%1"), node("%2", "%1"), node("%3", "%2")];
    expect(nestAgentPanes(panes)).toHaveLength(3);
  });
});

describe("the row of a child", () => {
  function row(depth?: number): HTMLElement {
    const host = document.createElement("div");
    render(
      agentRowTemplate({
        base: "nav-agent",
        id: "%2",
        state: "working" as AgentPane["state"],
        active: false,
        unread: false,
        title: "",
        previewName: "",
        card: html``,
        ...(depth === undefined ? {} : { depth }),
        onOpen: () => undefined,
        onMenu: () => undefined,
      }),
      host,
    );
    const button = host.querySelector<HTMLElement>("button");
    if (!button) throw new Error("no row");
    return button;
  }

  test("is marked with its depth for the indent", () => {
    const child = row(2);
    expect(child.dataset.agentDepth).toBe("2");
    expect(child.style.getPropertyValue("--agent-depth")).toBe("2");
  });

  test.each([undefined, 0])("a top-level row (%s) has no depth", (depth) => {
    expect(row(depth).hasAttribute("data-agent-depth")).toBe(false);
  });
});

describe("launchedPaneOptionArgs", () => {
  test("a known parent is written next to remain-on-exit, in one tmux call", () => {
    expect(launchedPaneOptionArgs("%7", "%2")).toEqual([
      "set-option",
      "-p",
      "-t",
      "%7",
      "remain-on-exit",
      "failed",
      ";",
      "set-option",
      "-p",
      "-t",
      "%7",
      "@agent-parent",
      "%2",
    ]);
  });

  test.each([undefined, "", "main:0", "%7"])("no parent for %j", (parent) => {
    expect(launchedPaneOptionArgs("%7", parent)).toEqual([
      "set-option",
      "-p",
      "-t",
      "%7",
      "remain-on-exit",
      "failed",
    ]);
  });
});
