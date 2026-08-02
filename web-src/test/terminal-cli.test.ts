// `code-viewer terminal` の引数パース。
//
// この CLI はエージェントのフックから機械的に呼ばれるので、綴り違いを黙って
// 通すと状態が入らないまま画面が正しく見える。受け付ける値と弾く値を表で
// 固定しておく。サーバへの往復は cli-helpers 側の責務なのでここでは扱わない。

import { describe, expect, test } from "vitest";
import type { AgentStateRecord } from "../core/agent-state";
import { formatStateLine, parseTerminalArgs } from "../server/terminal-cli";

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
