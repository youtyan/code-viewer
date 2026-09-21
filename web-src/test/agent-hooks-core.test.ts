// フックの入れ外しの純ロジック。
//
// 守りたいのは 3 つ。ほかのツールのフックを 1 つも消さず順序も変えないこと、
// 何度入れても増えないこと、外すと入れる前の JSON に戻ること。

import { describe, expect, test } from "vitest";
import {
  AGENT_HOOK_MARKER,
  type AgentHookState,
  type AgentHookStatus,
  type AgentHooksResponse,
  agentEventForHook,
  agentsNeedingHooks,
  checkHookShape,
  detectJsonIndent,
  HOOK_SPECS,
  type HookAgent,
  hookEntriesState,
  hookGroupFor,
  type HookRowAction,
  type HookRowTone,
  hookRowAction,
  hookRowTone,
  planHookChange,
  serializeHookFile,
} from "../core/agent-hooks";
import type { AgentEvent } from "../core/agent-state";

const COMMAND = `/state/${AGENT_HOOK_MARKER} claude`;
const SPECS = HOOK_SPECS.claude;
const STOP_SPEC = { event: "Stop", timeout: 5, async: true };

/** ほかのツールが入れたフック。形はエージェントの公式の書式どおり。 */
const FOREIGN_STOP = {
  hooks: [{ type: "command", command: "sample-tool notify", timeout: 10 }],
};
const FOREIGN_PRE = {
  matcher: "Bash",
  hooks: [
    { type: "command", command: "sample-tool guard-a" },
    { type: "command", command: "sample-tool guard-b" },
  ],
};

type Json = Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("agentEventForHook", () => {
  test.each([
    ["claude", { hook_event_name: "SessionStart", source: "startup" }, "ready"],
    ["claude", { hook_event_name: "SessionStart", source: "compact" }, null],
    ["claude", { hook_event_name: "UserPromptSubmit", prompt: "x" }, "prompt"],
    ["claude", { hook_event_name: "PostToolUse" }, "progress"],
    [
      "claude",
      {
        hook_event_name: "Notification",
        notification_type: "permission_prompt",
      },
      "ask",
    ],
    [
      "claude",
      {
        hook_event_name: "Notification",
        notification_type: "elicitation_dialog",
      },
      "ask",
    ],
    [
      "claude",
      { hook_event_name: "Notification", notification_type: "idle_prompt" },
      null,
    ],
    ["claude", { hook_event_name: "Notification" }, null],
    ["claude", { hook_event_name: "Stop" }, "stop"],
    ["claude", { hook_event_name: "StopFailure" }, "stop"],
    ["claude", { hook_event_name: "SessionEnd" }, "exit"],
    ["claude", { hook_event_name: "PermissionRequest" }, null],
    ["claude", { hook_event_name: "PreToolUse" }, null],
    ["codex", { hook_event_name: "SessionStart", source: "resume" }, "ready"],
    ["codex", { hook_event_name: "SessionStart", source: "compact" }, null],
    ["codex", { hook_event_name: "UserPromptSubmit" }, "prompt"],
    ["codex", { hook_event_name: "PermissionRequest" }, "ask"],
    ["codex", { hook_event_name: "Stop" }, "stop"],
    ["codex", { hook_event_name: "Interrupt" }, "ready"],
    ["codex", { hook_event_name: "SessionEnd" }, "exit"],
    ["codex", { hook_event_name: "PostToolUse" }, null],
    ["codex", { hook_event_name: "Notification" }, null],
    ["codex", {}, null],
  ] satisfies [
    HookAgent,
    Json,
    AgentEvent | null,
  ][])("%s %j -> %s", (agent, input, expected) => {
    expect(agentEventForHook(agent, input)).toBe(expected);
  });

  test.each([
    "claude",
    "codex",
  ] satisfies HookAgent[])("%s: every installed hook is reported as some event", (agent) => {
    for (const spec of HOOK_SPECS[agent]) {
      expect(
        agentEventForHook(agent, {
          hook_event_name: spec.event,
          source: "startup",
          notification_type: "permission_prompt",
        }),
      ).not.toBeNull();
    }
  });
});

describe("checkHookShape", () => {
  test.each([
    { name: "empty object", root: {}, issues: [] },
    {
      name: "hooks object",
      root: { hooks: { Stop: [FOREIGN_STOP] } },
      issues: [],
    },
    { name: "empty event array", root: { hooks: { Stop: [] } }, issues: [] },
    {
      name: "group without hooks",
      root: { hooks: { Stop: [{}] } },
      issues: [],
    },
    { name: "array root", root: [], issues: ["$"] },
    { name: "null root", root: null, issues: ["$"] },
    { name: "string root", root: "x", issues: ["$"] },
    { name: "hooks as array", root: { hooks: [] }, issues: ["$.hooks"] },
    { name: "hooks as string", root: { hooks: "x" }, issues: ["$.hooks"] },
    {
      name: "event as object",
      root: { hooks: { Stop: {} } },
      issues: ["$.hooks.Stop"],
    },
    {
      name: "group as string",
      root: { hooks: { Stop: ["x"] } },
      issues: ["$.hooks.Stop[0]"],
    },
    {
      name: "group hooks as object",
      root: { hooks: { Stop: [{ hooks: {} }] } },
      issues: ["$.hooks.Stop[0].hooks"],
    },
    {
      name: "hook entry as number",
      root: { hooks: { Stop: [{ hooks: [1] }] } },
      issues: ["$.hooks.Stop[0].hooks[0]"],
    },
    {
      name: "every problem is listed",
      root: { hooks: { Stop: {}, Start: ["x", { hooks: 1 }] } },
      issues: ["$.hooks.Stop", "$.hooks.Start[0]", "$.hooks.Start[1].hooks"],
    },
  ])("$name", ({ root, issues }) => {
    expect(checkHookShape(root).map((issue) => issue.path)).toEqual(issues);
  });
});

describe("planHookChange", () => {
  const installed = (root: Json | null) =>
    planHookChange(root, "install", SPECS, COMMAND).next;

  test.each([
    { name: "file missing", root: null },
    { name: "no hooks key", root: { model: "sample" } },
    { name: "empty hooks", root: { hooks: {} } },
    {
      name: "other tools' hooks",
      root: {
        model: "sample",
        hooks: { PreToolUse: [FOREIGN_PRE], Stop: [FOREIGN_STOP] },
      },
    },
  ])("install adds every spec once and keeps the rest ($name)", ({ root }) => {
    const before = clone(root);
    const plan = planHookChange(root, "install", SPECS, COMMAND);
    expect(root).toEqual(before);
    expect(plan.changed).toBe(true);
    expect(plan.removed).toEqual([]);
    expect(plan.added.map((change) => change.event)).toEqual(
      SPECS.map((spec) => spec.event),
    );
    const hooks = plan.next.hooks as Record<string, Json[]>;
    for (const spec of SPECS) {
      expect(hooks[spec.event]?.[(hooks[spec.event]?.length ?? 0) - 1]).toEqual(
        hookGroupFor(spec, COMMAND),
      );
    }
    // ほかのツールのフックは同じ位置のまま。
    const beforeHooks = (root?.hooks ?? {}) as Record<string, Json[]>;
    for (const [event, groups] of Object.entries(beforeHooks)) {
      expect(hooks[event]?.slice(0, groups.length)).toEqual(groups);
    }
    for (const [key, value] of Object.entries(root ?? {})) {
      if (key !== "hooks") expect(plan.next[key]).toEqual(value);
    }
  });

  test.each([
    { name: "file missing", root: null, kept: 0 },
    { name: "empty hooks", root: { hooks: {} }, kept: 0 },
    {
      name: "other tools' hooks",
      root: { hooks: { PreToolUse: [FOREIGN_PRE], Stop: [FOREIGN_STOP] } },
      kept: 3,
    },
  ])("installing twice changes nothing ($name)", ({ root, kept }) => {
    const once = installed(root);
    const twice = planHookChange(once, "install", SPECS, COMMAND);
    expect(twice.changed).toBe(false);
    expect(twice.added).toEqual([]);
    expect(twice.removed).toEqual([]);
    expect(twice.next).toBe(once);
    expect(twice.kept).toBe(kept);
  });

  test.each([
    { name: "no hooks key", root: { model: "sample" } },
    {
      name: "other tools' hooks",
      root: { hooks: { PreToolUse: [FOREIGN_PRE], Stop: [FOREIGN_STOP] } },
    },
    {
      name: "a group that was already empty",
      root: { hooks: { Stop: [{ hooks: [] }] } },
    },
  ])("uninstall restores the original ($name)", ({ root }) => {
    const plan = planHookChange(installed(root), "uninstall", SPECS, COMMAND);
    expect(plan.changed).toBe(true);
    expect(plan.added).toEqual([]);
    expect(plan.removed.map((change) => change.event).sort()).toEqual(
      SPECS.map((spec) => spec.event).sort(),
    );
    expect(plan.next).toEqual(root);
  });

  // 入れる前から空だった入れ物は、入れた後には自分のもので埋まっている。
  // 外すときにはそれが「自分が空にした」ものと区別できないので片付く。
  // どちらが元の形だったかを覚える場所は設定ファイルの外に無い。
  test.each([
    { name: "empty hooks", root: { hooks: {} }, expected: {} },
    {
      name: "empty event next to another event",
      root: { hooks: { Stop: [], PreToolUse: [FOREIGN_PRE] } },
      expected: { hooks: { PreToolUse: [FOREIGN_PRE] } },
    },
  ])("containers that were empty before install are tidied on uninstall ($name)", ({
    root,
    expected,
  }) => {
    const plan = planHookChange(installed(root), "uninstall", SPECS, COMMAND);
    expect(plan.next).toEqual(expected);
  });

  test("uninstall keeps containers that are already empty", () => {
    const root = { hooks: { Stop: [], PreToolUse: [{ hooks: [] }] } };
    const plan = planHookChange(root, "uninstall", SPECS, COMMAND);
    expect(plan.changed).toBe(false);
    expect(plan.next).toEqual(root);
  });

  test("uninstall on a missing file leaves an empty object and changes nothing", () => {
    const plan = planHookChange(null, "uninstall", SPECS, COMMAND);
    expect(plan.changed).toBe(false);
    expect(plan.next).toEqual({});
  });

  test("uninstall removes only own entries from a group it shares", () => {
    const shared = {
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: "sample-tool first" },
              { type: "command", command: COMMAND },
              { type: "command", command: "sample-tool last" },
            ],
          },
        ],
      },
    };
    const plan = planHookChange(shared, "uninstall", SPECS, COMMAND);
    expect(plan.next).toEqual({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: "sample-tool first" },
              { type: "command", command: "sample-tool last" },
            ],
          },
        ],
      },
    });
    expect(plan.removed).toEqual([
      {
        event: "Stop",
        entry: { hooks: [{ type: "command", command: COMMAND }] },
      },
    ]);
    expect(plan.kept).toBe(2);
  });

  test("install replaces an outdated own entry instead of adding a second one", () => {
    const outdated = installed({ hooks: { Stop: [FOREIGN_STOP] } });
    const stop = (outdated.hooks as Record<string, Json[]>).Stop as Json[];
    stop[1] = {
      hooks: [
        { type: "command", command: `old/${AGENT_HOOK_MARKER}`, timeout: 1 },
      ],
    };
    const plan = planHookChange(outdated, "install", SPECS, COMMAND);
    expect(plan.removed.map((change) => change.event)).toEqual(["Stop"]);
    expect(plan.added.map((change) => change.event)).toEqual(["Stop"]);
    const next = (plan.next.hooks as Record<string, Json[]>).Stop;
    expect(next).toEqual([FOREIGN_STOP, hookGroupFor(STOP_SPEC, COMMAND)]);
  });

  test("install removes own entries left under events it no longer uses", () => {
    const root = {
      hooks: {
        PreToolUse: [
          FOREIGN_PRE,
          { hooks: [{ type: "command", command: COMMAND }] },
        ],
      },
    };
    const plan = planHookChange(root, "install", SPECS, COMMAND);
    expect(plan.removed.map((change) => change.event)).toEqual(["PreToolUse"]);
    expect((plan.next.hooks as Record<string, Json[]>).PreToolUse).toEqual([
      FOREIGN_PRE,
    ]);
  });

  test("install collapses a duplicated own entry to one", () => {
    const once = installed({});
    const hooks = once.hooks as Record<string, Json[]>;
    const group = hooks.Stop?.[0] as Json;
    hooks.Stop = [group, clone(group)];
    const plan = planHookChange(once, "install", SPECS, COMMAND);
    expect((plan.next.hooks as Record<string, Json[]>).Stop).toEqual([group]);
  });
});

describe("hookEntriesState", () => {
  test.each([
    { name: "missing file", root: null, expected: "none" },
    {
      name: "only other tools",
      root: { hooks: { Stop: [FOREIGN_STOP] } },
      expected: "none",
    },
    { name: "all installed", root: "installed", expected: "installed" },
    { name: "one removed by hand", root: "partial", expected: "partial" },
  ])("$name -> $expected", ({ root, expected }) => {
    let value: Json | null = root as Json | null;
    if (root === "installed" || root === "partial") {
      value = planHookChange({}, "install", SPECS, COMMAND).next;
      if (root === "partial") delete (value.hooks as Json).Stop;
    }
    expect(hookEntriesState(value, SPECS, COMMAND)).toBe(expected);
  });
});

describe("serializeHookFile", () => {
  test.each([
    { name: "two spaces", text: '{\n  "a": 1\n}\n', indent: "  " },
    { name: "four spaces", text: '{\n    "a": 1\n}\n', indent: "    " },
    { name: "tabs", text: '{\n\t"a": 1\n}\n', indent: "\t" },
    { name: "one line", text: '{"a":1}', indent: "  " },
  ])("detects the indent ($name)", ({ text, indent }) => {
    expect(detectJsonIndent(text)).toBe(indent);
  });

  test.each([
    { name: "keeps a trailing newline", original: '{\n  "a": 1\n}\n' },
    { name: "keeps no trailing newline", original: '{\n    "a": 1\n}' },
    { name: "keeps tabs", original: '{\n\t"a": [\n\t\t1\n\t]\n}\n' },
  ])("round-trips the original text ($name)", ({ original }) => {
    expect(serializeHookFile(JSON.parse(original), original)).toBe(original);
  });

  test("a new file uses two spaces and a trailing newline", () => {
    expect(serializeHookFile({ a: 1 }, null)).toBe('{\n  "a": 1\n}\n');
  });
});

describe("agentsNeedingHooks", () => {
  const row = (
    agent: HookAgent,
    state: AgentHookState,
    writeBlocked = "",
  ): AgentHookStatus => ({
    agent,
    configDir: `/cfg/${agent}`,
    path: `/cfg/${agent}/file.json`,
    realPath: `/cfg/${agent}/file.json`,
    symlink: false,
    state,
    detail: "",
    writeBlocked,
    kept: 0,
  });
  const status = (...agents: AgentHookStatus[]): AgentHooksResponse => ({
    home: "/home/sample",
    agents,
    launcher: { state: "missing", path: "/state/x", detail: "" },
    failures: { total: 0, recent: [], log: "/state/log" },
  });

  test.each([
    { name: "no status yet", kinds: ["claude"], rows: null, expected: [] },
    {
      name: "claude running, not set up",
      kinds: ["claude", null],
      rows: status(row("claude", "none"), row("codex", "none")),
      expected: ["claude"],
    },
    {
      name: "both running, partial and broken",
      kinds: ["codex", "claude"],
      rows: status(row("claude", "partial"), row("codex", "broken")),
      expected: ["claude", "codex"],
    },
    {
      name: "installed is not hinted",
      kinds: ["claude"],
      rows: status(row("claude", "installed")),
      expected: [],
    },
    {
      name: "an agent that is not running is not hinted",
      kinds: ["other", null],
      rows: status(row("claude", "none"), row("codex", "none")),
      expected: [],
    },
    {
      name: "unreadable or read-only files are fixed in settings, not hinted",
      kinds: ["claude", "codex"],
      rows: status(row("claude", "unreadable"), row("codex", "none", "ro")),
      expected: [],
    },
  ])("$name", ({ kinds, rows, expected }) => {
    expect(agentsNeedingHooks(kinds, rows)).toEqual(expected);
  });
});

describe("hookRowTone and hookRowAction", () => {
  const row = (state: AgentHookState, writeBlocked = ""): AgentHookStatus => ({
    agent: "claude",
    configDir: "/cfg",
    path: "/cfg/settings.json",
    realPath: "/store/settings.json",
    symlink: true,
    state,
    detail: "",
    writeBlocked,
    kept: 0,
  });

  // 書けないだけ (生成された設定ファイル) は異常にしない。読めない・形が
  // 違う・呼び先が無いは、書けるかどうかに関係なく異常のまま。
  test.each([
    { state: "none", blocked: "", tone: "plain", kind: "install" },
    { state: "partial", blocked: "", tone: "plain", kind: "repair" },
    { state: "installed", blocked: "", tone: "plain", kind: "uninstall" },
    { state: "broken", blocked: "", tone: "problem", kind: "repair" },
    { state: "unreadable", blocked: "", tone: "problem", kind: null },
    { state: "no-config-dir", blocked: "", tone: "plain", kind: null },
    { state: "none", blocked: "ro", tone: "generated", kind: "guide-install" },
    {
      state: "partial",
      blocked: "ro",
      tone: "generated",
      kind: "guide-install",
    },
    {
      state: "installed",
      blocked: "ro",
      tone: "generated",
      kind: "guide-uninstall",
    },
    { state: "broken", blocked: "ro", tone: "problem", kind: "repair" },
    { state: "unreadable", blocked: "ro", tone: "problem", kind: null },
  ] satisfies {
    state: AgentHookState;
    blocked: string;
    tone: HookRowTone;
    kind: HookRowAction["kind"] | null;
  }[])("$state (write blocked: '$blocked') -> $tone / $kind", ({
    state,
    blocked,
    tone,
    kind,
  }) => {
    expect(hookRowTone(row(state, blocked))).toBe(tone);
    expect(hookRowAction(row(state, blocked))?.kind ?? null).toBe(kind);
  });
});
