// MCP から見える terminal 系 tool の振る舞い。
//
// 別のエージェントが状態を読み、本文を受け取り、自分の状態を申告する経路が
// これ。ここが黙って壊れると、受け渡しが成立していないことに誰も気付けない。
// tmux は環境依存なので、実際にペインを叩かない範囲だけを見る。

import { beforeEach, describe, expect, test } from "vitest";
import type { McpTool } from "../server/mcp";
import { defaultMcpTools } from "../server/mcp";
import {
  clearAgentStates,
  getAgentState,
} from "../server/terminal/agent-state";

const TOOLS: readonly McpTool[] = defaultMcpTools();
const PANE = "%12";
const SHELL = "shell-abc123";

function tool(name: string): McpTool {
  const found = TOOLS.find((entry) => entry.name === name);
  if (!found) throw new Error(`tool not registered: ${name}`);
  return found;
}

async function runTool(name: string, input: unknown) {
  return await tool(name).run(input);
}

function parseText(text: string): unknown {
  return JSON.parse(text);
}

beforeEach(() => {
  clearAgentStates();
});

describe("tool registration", () => {
  test.each([
    { name: "code_viewer_terminal_list" },
    { name: "code_viewer_terminal_capture" },
    { name: "code_viewer_terminal_state" },
  ])("$name is registered", ({ name }) => {
    expect(TOOLS.map((entry) => entry.name)).toContain(name);
  });

  test.each([
    { name: "capture requires a target", tool: "code_viewer_terminal_capture" },
    {
      name: "state requires target and event",
      tool: "code_viewer_terminal_state",
    },
  ])("$name", ({ tool: toolName }) => {
    expect(tool(toolName).inputSchema.required).toContain("target");
  });
});

describe("code_viewer_terminal_state", () => {
  test("records the reported event", async () => {
    const result = await runTool("code_viewer_terminal_state", {
      target: PANE,
      event: "ask",
      note: "waiting for approval",
    });
    expect(result.isError).toBeFalsy();
    expect(getAgentState(PANE)?.state).toBe("waiting");
    expect(getAgentState(PANE)?.note).toBe("waiting for approval");
  });

  test.each([
    { name: "rejects a bad target", input: { target: "pane12", event: "ask" } },
    { name: "rejects a missing target", input: { event: "ask" } },
    {
      name: "rejects an unknown event",
      input: { target: PANE, event: "blocked" },
    },
    {
      name: "rejects a state name as event",
      input: { target: PANE, event: "done" },
    },
    {
      name: "rejects a non-string note",
      input: { target: PANE, event: "ask", note: 12 },
    },
  ])("$name", async ({ input }) => {
    const result = await runTool("code_viewer_terminal_state", input);
    expect(result.isError).toBe(true);
    expect(getAgentState(PANE)).toBeNull();
  });
});

describe("code_viewer_terminal_list", () => {
  test("returns every reported target", async () => {
    await runTool("code_viewer_terminal_state", { target: PANE, event: "ask" });
    await runTool("code_viewer_terminal_state", {
      target: SHELL,
      event: "prompt",
    });
    const result = await runTool("code_viewer_terminal_list", {});
    const body = parseText(result.text) as { states: { target: string }[] };
    expect(body.states).toHaveLength(2);
  });

  test("attentionOnly keeps only the ones the human must handle", async () => {
    await runTool("code_viewer_terminal_state", { target: PANE, event: "ask" });
    await runTool("code_viewer_terminal_state", {
      target: SHELL,
      event: "prompt",
    });
    const result = await runTool("code_viewer_terminal_list", {
      attentionOnly: true,
    });
    const body = parseText(result.text) as { states: { target: string }[] };
    expect(body.states.map((s) => s.target)).toEqual([PANE]);
  });

  test("rejects a non-boolean attentionOnly", async () => {
    const result = await runTool("code_viewer_terminal_list", {
      attentionOnly: "yes",
    });
    expect(result.isError).toBe(true);
  });

  test("returns an empty list when nothing has reported", async () => {
    const result = await runTool("code_viewer_terminal_list", {});
    expect(parseText(result.text)).toEqual({ states: [] });
  });
});

describe("code_viewer_terminal_capture", () => {
  test.each([
    { name: "rejects a missing target", input: {} },
    { name: "rejects a bare name", input: { target: "pane12" } },
    {
      name: "rejects a shell metacharacter",
      input: { target: "shell-abc;id" },
    },
    {
      name: "rejects a non-string cursor",
      input: { target: PANE, cursor: 12 },
    },
    {
      name: "rejects a non-numeric history",
      input: { target: PANE, history: "500" },
    },
  ])("$name", async ({ input }) => {
    const result = await runTool("code_viewer_terminal_capture", input);
    expect(result.isError).toBe(true);
  });

  test("reports a shell that does not exist as an error", async () => {
    // シェルはこのプロセス内にしか無いので、tmux を触らずに確かめられる。
    const result = await runTool("code_viewer_terminal_capture", {
      target: SHELL,
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain(SHELL);
  });
});
