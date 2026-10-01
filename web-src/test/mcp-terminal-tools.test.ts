// MCP から見える terminal 系 tool の振る舞い。
//
// 別のエージェントが状態を読み、本文を受け取り、自分の状態を申告する経路が
// これ。ここが黙って壊れると、受け渡しが成立していないことに誰も気付けない。
// tmux は環境依存なので、実際にペインを叩かない範囲だけを見る。

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { errorWithCause } from "../core/error-detail";
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
    expect(parseText(result.text)).toEqual({ states: [], errors: [] });
  });
});

// 入口の裏では、状態を持つ入口に聞く (経路そのものは entry-server.test.ts)。
// 入口が分からないとき、このプロセスの空の記録に黙って落ちない。
describe("when the server holding the terminal state is not known", () => {
  const unknown = defaultMcpTools({
    terminalServer: () => ({ status: "error", message: "sample reason" }),
  });
  test.each([
    {
      name: "code_viewer_terminal_list",
      input: {},
      operation: "terminal list",
    },
    {
      name: "code_viewer_terminal_capture",
      input: { target: SHELL },
      operation: "terminal capture",
    },
    {
      name: "code_viewer_terminal_state",
      input: { target: PANE, event: "ask" },
      operation: "terminal state",
    },
  ])("$name says why", async ({ name, input, operation }) => {
    const found = unknown.find((entry) => entry.name === name);
    expect(await found?.run(input)).toEqual({
      text: `${operation}: sample reason`,
      isError: true,
    });
    expect(getAgentState(PANE)).toBeNull();
  });
});

// 聞いた先が答えないとき・形の違う答えを返したときも、どの要求で何が
// 起きたかを全部残す。空の一覧や空の本文として読まない。
describe("when asking the server that holds the terminal state", () => {
  const SERVER = "http://127.0.0.1:9";
  const STATES = `${SERVER}/_agent/states`;
  const tools = (signal?: AbortSignal) =>
    defaultMcpTools({
      terminalServer: () => ({ status: "ok", url: SERVER }),
      signal,
    });
  const run = (signal: AbortSignal | undefined, name: string, input: unknown) =>
    tools(signal)
      .find((entry) => entry.name === name)
      ?.run(input);
  const neverTimesOut = () => new AbortController().signal;
  const timedOut = () =>
    AbortSignal.abort(
      new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError",
      ),
    );
  const rejectWithSignalReason = async (
    _url: string,
    init: RequestInit,
  ): Promise<Response> => {
    throw init.signal?.reason;
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test.each([
    {
      name: "a refused connection keeps the whole cause chain",
      timeout: neverTimesOut,
      request: undefined,
      answer: async (): Promise<Response> => {
        throw errorWithCause(
          "fetch failed",
          Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9"), {
            code: "ECONNREFUSED",
          }),
        );
      },
      expected: `Error: terminal list: GET ${STATES} failed\nCaused by: Error: fetch failed\nCaused by: Error: connect ECONNREFUSED 127.0.0.1:9\nDetails: {"code":"ECONNREFUSED"}`,
    },
    {
      name: "no answer within the time limit names the request",
      timeout: timedOut,
      request: undefined,
      answer: rejectWithSignalReason,
      expected: `Error: terminal list: GET ${STATES} did not finish within 10 seconds\nCaused by: TimeoutError: The operation was aborted due to timeout`,
    },
    {
      name: "the MCP client going away stops the request",
      timeout: neverTimesOut,
      request: AbortSignal.abort(),
      answer: rejectWithSignalReason,
      expected: `Error: terminal list: GET ${STATES} failed\nCaused by: AbortError: This operation was aborted`,
    },
    {
      name: "a 2xx body that is not JSON",
      timeout: neverTimesOut,
      request: undefined,
      answer: async () => new Response("<html>"),
      expected: `Error: terminal list: GET ${STATES} answered HTTP 200 with a body that is not JSON: <html>\nCaused by: SyntaxError: Unexpected token '<', "<html>" is not valid JSON`,
    },
    {
      name: "a list without the states and errors arrays",
      timeout: neverTimesOut,
      request: undefined,
      answer: async () => Response.json({ states: [] }),
      expected: `terminal list: GET ${STATES} answered without states and errors lists: {"states":[]}`,
    },
  ])("$name", async ({ timeout, request, answer, expected }) => {
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout());
    vi.stubGlobal("fetch", vi.fn(answer));
    expect(await run(request, "code_viewer_terminal_list", {})).toEqual({
      text: expected,
      isError: true,
    });
  });

  test.each([
    {
      name: "history above the maximum is clamped, the cursor is forwarded",
      input: { target: SHELL, cursor: "c1", history: 99999 },
      url: `${SERVER}/_agent/capture?target=shell-abc123&cursor=c1&history=5000`,
    },
    {
      name: "history below zero is clamped to zero",
      input: { target: SHELL, history: -3 },
      url: `${SERVER}/_agent/capture?target=shell-abc123&history=0`,
    },
    {
      name: "a fractional history is truncated",
      input: { target: SHELL, history: 12.7 },
      url: `${SERVER}/_agent/capture?target=shell-abc123&history=12`,
    },
    {
      name: "an omitted history is left to the server",
      input: { target: SHELL },
      url: `${SERVER}/_agent/capture?target=shell-abc123`,
    },
  ])("capture: $name", async ({ input, url }) => {
    const body = {
      target: SHELL,
      kind: "shell",
      content: "sample output",
      cursor: "c2",
      reset: false,
    };
    const fetchMock = vi.fn(async (_url: string) => Response.json(body));
    vi.stubGlobal("fetch", fetchMock);
    expect(await run(undefined, "code_viewer_terminal_capture", input)).toEqual(
      { text: JSON.stringify(body, null, 2) },
    );
    expect(fetchMock.mock.calls.map(([called]) => called)).toEqual([url]);
  });

  // 入口の申告の口は本文を 32 KB で断る。長い指示文で、入口の下でだけ 413 に
  // ならないよう、サーバと同じ長さに切ってから送る。
  test("state: long texts are clipped to the server's limit before sending", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await run(undefined, "code_viewer_terminal_state", {
      target: PANE,
      event: "ask",
      lastPrompt: "p".repeat(40_000),
      note: "n".repeat(40_000),
    });
    expect(
      fetchMock.mock.calls.map(([url, init]) => ({
        url,
        body: JSON.parse(String(init.body)),
      })),
    ).toEqual([
      {
        url: `${SERVER}/_agent/state`,
        body: {
          target: PANE,
          event: "ask",
          at: expect.any(Number),
          lastPrompt: "p".repeat(2000),
          note: "n".repeat(2000),
        },
      },
    ]);
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
