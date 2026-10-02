// `code-viewer terminal` の引数パース。
//
// この CLI はエージェントのフックから機械的に呼ばれるので、綴り違いを黙って
// 通すと状態が入らないまま画面が正しく見える。受け付ける値と弾く値を表で
// 固定しておく。サーバへの往復は cli-helpers 側の責務なのでここでは扱わない。

import { afterEach, describe, expect, test, vi } from "vitest";
import type { AgentStateRecord } from "../core/agent-state";
import {
  formatStateLine,
  parseTerminalArgs,
  runTerminalCli,
} from "../server/terminal-cli";

describe("parseTerminalArgs — サブコマンドの選択", () => {
  test.each([
    { name: "引数なしはヘルプ", argv: [], mode: "help" },
    { name: "help はヘルプ", argv: ["help"], mode: "help" },
    { name: "--help はヘルプ", argv: ["--help"], mode: "help" },
    { name: "-h はヘルプ", argv: ["-h"], mode: "help" },
    {
      name: "agent-help はエージェント向けガイド",
      argv: ["agent-help"],
      mode: "agent-help",
    },
    { name: "list は一覧", argv: ["list"], mode: "list" },
  ])("$name", ({ argv, mode }) => {
    const parsed = parseTerminalArgs(argv);
    expect(parsed.ok).toBe(true);
    if (parsed.ok === true) expect(parsed.args.command.mode).toBe(mode);
  });

  test("未知のサブコマンドを弾く", () => {
    const parsed = parseTerminalArgs(["attach"]);
    expect(parsed.ok).toBe(false);
    if (parsed.ok === false) {
      expect(parsed.error).toContain("unknown terminal subcommand");
    }
  });
});

describe("parseTerminalArgs — state", () => {
  test.each([
    { name: "prompt を受ける", event: "prompt" },
    { name: "progress を受ける", event: "progress" },
    { name: "ask を受ける", event: "ask" },
    { name: "stop を受ける", event: "stop" },
    { name: "exit を受ける", event: "exit" },
  ])("$name", ({ event }) => {
    const parsed = parseTerminalArgs([
      "state",
      "--target",
      "%12",
      "--event",
      event,
    ]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok === true && parsed.args.command.mode === "state") {
      expect(parsed.args.command.event).toBe(event);
      expect(parsed.args.command.target).toBe("%12");
    }
  });

  test.each([
    {
      name: "未知の出来事を弾く",
      argv: ["state", "--target", "%12", "--event", "blocked"],
      contains: "--event must be one of",
    },
    {
      name: "状態名を出来事として渡すのを弾く",
      argv: ["state", "--target", "%12", "--event", "waiting"],
      contains: "--event must be one of",
    },
    {
      name: "target 抜けを弾く",
      argv: ["state", "--event", "ask"],
      contains: "--target is required",
    },
    {
      name: "event 抜けを弾く",
      argv: ["state", "--target", "%12"],
      contains: "--event is required",
    },
    {
      name: "値の無いフラグを弾く",
      argv: ["state", "--target"],
      contains: "--target requires a value",
    },
    {
      name: "未知のオプションを弾く",
      argv: ["state", "--target", "%12", "--event", "ask", "--force"],
      contains: "unknown option",
    },
  ])("$name", ({ argv, contains }) => {
    const parsed = parseTerminalArgs(argv);
    expect(parsed.ok).toBe(false);
    if (parsed.ok === false) expect(parsed.error).toContain(contains);
  });

  test("指示文と一言を受け取る", () => {
    const parsed = parseTerminalArgs([
      "state",
      "--target",
      "shell-abc123",
      "--event",
      "ask",
      "--prompt",
      "run the failing test",
      "--note",
      "waiting for approval",
    ]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok === true && parsed.args.command.mode === "state") {
      expect(parsed.args.command.prompt).toBe("run the failing test");
      expect(parsed.args.command.note).toBe("waiting for approval");
    }
  });
});

describe("parseTerminalArgs — capture", () => {
  test("カーソルと履歴行数を受け取る", () => {
    const parsed = parseTerminalArgs([
      "capture",
      "--target",
      "%12",
      "--cursor",
      "t420.1f9k",
      "--history",
      "120",
      "--json",
    ]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok === true && parsed.args.command.mode === "capture") {
      expect(parsed.args.command.cursor).toBe("t420.1f9k");
      expect(parsed.args.command.history).toBe(120);
      expect(parsed.args.command.json).toBe(true);
    }
  });

  test("カーソル省略時は null", () => {
    const parsed = parseTerminalArgs(["capture", "--target", "%12"]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok === true && parsed.args.command.mode === "capture") {
      expect(parsed.args.command.cursor).toBeNull();
      expect(parsed.args.command.history).toBeNull();
    }
  });

  test.each([
    { name: "境界: 0 行を受ける", value: "0", expected: 0 },
    { name: "境界: 1 行を受ける", value: "1", expected: 1 },
  ])("$name", ({ value, expected }) => {
    const parsed = parseTerminalArgs([
      "capture",
      "--target",
      "%12",
      "--history",
      value,
    ]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok === true && parsed.args.command.mode === "capture") {
      expect(parsed.args.command.history).toBe(expected);
    }
  });

  test.each([
    { name: "境界: -1 行を弾く", value: "-1" },
    { name: "数値でない行数を弾く", value: "many" },
    { name: "空の行数を弾く", value: "" },
  ])("$name", ({ value }) => {
    const parsed = parseTerminalArgs([
      "capture",
      "--target",
      "%12",
      "--history",
      value,
    ]);
    expect(parsed.ok).toBe(false);
    if (parsed.ok === false) {
      expect(parsed.error).toContain(
        "--history must be a non-negative integer",
      );
    }
  });
});

describe("parseTerminalArgs — 共通オプション", () => {
  test("--cwd と --server を受け取る", () => {
    const parsed = parseTerminalArgs([
      "list",
      "--cwd",
      "/tmp/repo",
      "--server",
      "http://127.0.0.1:5000",
    ]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok === true) {
      expect(parsed.args.cwd).toBe("/tmp/repo");
      expect(parsed.args.server).toBe("http://127.0.0.1:5000");
    }
  });

  test("--attention を受け取る", () => {
    const parsed = parseTerminalArgs(["list", "--attention"]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok === true && parsed.args.command.mode === "list") {
      expect(parsed.args.command.attentionOnly).toBe(true);
    }
  });
});

describe("formatStateLine", () => {
  const record = (over: Partial<AgentStateRecord>): AgentStateRecord => ({
    target: "%12",
    state: "waiting",
    source: "hook",
    updatedAt: 0,
    changeObserved: true,
    lastPrompt: "",
    note: "",
    ...over,
  });

  test.each([
    { name: "待ちには印を付ける", state: "waiting", marked: true },
    { name: "未読にも印を付ける", state: "done", marked: true },
    { name: "稼働には印を付けない", state: "working", marked: false },
    { name: "停止には印を付けない", state: "idle", marked: false },
  ] satisfies {
    name: string;
    state: AgentStateRecord["state"];
    marked: boolean;
  }[])("$name", ({ state, marked }) => {
    expect(formatStateLine(record({ state })).startsWith("*")).toBe(marked);
  });

  test("一言があれば一言を、無ければ指示文を出す", () => {
    expect(formatStateLine(record({ note: "checking CI" }))).toContain(
      "checking CI",
    );
    expect(
      formatStateLine(record({ lastPrompt: "run the failing test" })),
    ).toContain("run the failing test");
  });
});

// 直す前は `states ?? []`・`content ?? ""` で、形の違う応答を「端末なし」・
// 空の本文と出して exit 0 で終わっていた。
describe("runTerminalCli — 形の違う応答", () => {
  const SERVER = "http://127.0.0.1:65535";
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test.each([
    {
      name: "list: states が無い",
      argv: ["list"],
      body: { errors: [] },
      expected: `terminal list: GET ${SERVER}/_agent/states answered without states and errors lists: {"errors":[]}`,
    },
    {
      name: "list: errors が無い",
      argv: ["list"],
      body: { states: [] },
      expected: `terminal list: GET ${SERVER}/_agent/states answered without states and errors lists: {"states":[]}`,
    },
    {
      name: "list: null",
      argv: ["list"],
      body: null,
      expected: `terminal list: GET ${SERVER}/_agent/states answered without states and errors lists: null`,
    },
    {
      name: "capture: content が無い",
      argv: ["capture", "--target", "shell-abc123"],
      body: { cursor: "c1" },
      expected: `terminal capture: GET ${SERVER}/_agent/capture?target=shell-abc123 answered without content and cursor strings: {"cursor":"c1"}`,
    },
    {
      name: "capture: cursor が無い",
      argv: ["capture", "--target", "shell-abc123", "--json"],
      body: { content: "sample output" },
      expected: `terminal capture: GET ${SERVER}/_agent/capture?target=shell-abc123 answered without content and cursor strings: {"content":"sample output"}`,
    },
    {
      name: "capture: null",
      argv: ["capture", "--target", "shell-abc123"],
      body: null,
      expected: `terminal capture: GET ${SERVER}/_agent/capture?target=shell-abc123 answered without content and cursor strings: null`,
    },
  ])(
    "$name なら URL と本文を出して exit 1",
    async ({ argv, body, expected }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(body)),
      );
      const logs: string[] = [];
      const errs: string[] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => {
        logs.push(args.join(" "));
      });
      vi.spyOn(console, "error").mockImplementation((...args) => {
        errs.push(args.join(" "));
      });
      vi.spyOn(process, "exit").mockImplementation((code) => {
        throw new Error(`exit ${code}`);
      });
      await expect(
        runTerminalCli([...argv, "--server", SERVER]),
      ).rejects.toThrow("exit 1");
      expect({ logs, errs }).toEqual({ logs: [], errs: [expected] });
    },
  );
});

// サーバは申告の本文を 32 KB で断る。長い --prompt / --note はサーバと同じ
// 2000 文字に切ってから送る (直す前は 413 で終わっていた)。
test("runTerminalCli state clips --prompt and --note to the server's limit", async () => {
  const SERVER = "http://127.0.0.1:65535";
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
    Response.json({ states: [], errors: [] }),
  );
  vi.stubGlobal("fetch", fetchMock);
  try {
    await runTerminalCli([
      "state",
      "--target",
      "%12",
      "--event",
      "ask",
      "--prompt",
      "p".repeat(40_000),
      "--note",
      "n".repeat(40_000),
      "--server",
      SERVER,
    ]);
    expect(
      fetchMock.mock.calls
        .filter(([, init]) => init?.method === "POST")
        .map(([url, init]) => ({ url, body: JSON.parse(String(init?.body)) })),
    ).toEqual([
      {
        url: `${SERVER}/_agent/state`,
        body: {
          target: "%12",
          event: "ask",
          at: expect.any(Number),
          lastPrompt: "p".repeat(2000),
          note: "n".repeat(2000),
        },
      },
    ]);
  } finally {
    vi.unstubAllGlobals();
  }
});
