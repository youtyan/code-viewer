// 入力待ちの理由 (許可・質問・エラーで停止)。フックの入力から理由を取り出し
// (core/agent-hooks.ts)、申告として受けて記録し (server/terminal/)、行に出す
// (views/agents/agent-card.ts)。エラーで止まったターン (StopFailure) は完了に
// せず、画面の待機の判定でも消さない。

import "./_dom";
import { beforeEach, describe, expect, test } from "vitest";
import {
  agentAttentionForHook,
  agentEventForHook,
  type HookAgent,
} from "../core/agent-hooks";
import type { AgentAttention } from "../core/agent-state";
import {
  clearAgentStates,
  getAgentState,
  recordAgentState,
} from "../server/terminal/agent-state";
import { handleAgentRoute } from "../server/terminal/handle";
import { fillAgentCard } from "../views/agents/agent-card";
import { agentsText } from "../views/agents/i18n";
import { agentPane, postRoute } from "./_test-helpers";

const PANE = "%21";
const post = (body: unknown) =>
  postRoute(handleAgentRoute, "/_agent/state", body);

beforeEach(() => clearAgentStates());

describe("agentAttentionForHook", () => {
  test.each([
    [
      "claude",
      {
        hook_event_name: "StopFailure",
        error: "rate_limit",
        error_details: "429 Too Many Requests",
      },
      { kind: "error", reason: "rate_limit", detail: "429 Too Many Requests" },
    ],
    [
      "claude",
      { hook_event_name: "StopFailure" },
      { kind: "error", reason: "", detail: "" },
    ],
    [
      "claude",
      { hook_event_name: "StopFailure", error: 7, error_details: null },
      { kind: "error", reason: "", detail: "" },
    ],
    [
      "claude",
      {
        hook_event_name: "Notification",
        notification_type: "permission_prompt",
      },
      { kind: "permission", reason: "", detail: "" },
    ],
    [
      "claude",
      {
        hook_event_name: "Notification",
        notification_type: "elicitation_dialog",
      },
      { kind: "question", reason: "", detail: "" },
    ],
    [
      "codex",
      { hook_event_name: "PermissionRequest" },
      {
        kind: "permission",
        reason: "",
        detail: "",
      },
    ],
    ["claude", { hook_event_name: "Stop" }, null],
    [
      "claude",
      { hook_event_name: "Notification", notification_type: "idle_prompt" },
      null,
    ],
    ["claude", { hook_event_name: "PermissionRequest" }, null],
    ["codex", { hook_event_name: "StopFailure", error: "rate_limit" }, null],
    // opencode のプラグインが渡す許可と質問 (core/agent-hooks.ts の HOOK_SPECS)。
    [
      "opencode",
      { hook_event_name: "permission.asked" },
      { kind: "permission", reason: "", detail: "" },
    ],
    [
      "opencode",
      { hook_event_name: "permission.updated" },
      { kind: "permission", reason: "", detail: "" },
    ],
    [
      "opencode",
      { hook_event_name: "question.asked" },
      { kind: "question", reason: "", detail: "" },
    ],
    ["opencode", { hook_event_name: "permission.replied" }, null],
    ["opencode", { hook_event_name: "session.idle" }, null],
  ] satisfies [HookAgent, Record<string, unknown>, AgentAttention | null][])(
    "%s %j -> %j",
    (agent, input, expected) => {
      expect(agentAttentionForHook(agent, input)).toEqual(expected);
    },
  );

  test("a reason with control characters or past the limit is cleaned and cut", () => {
    const attention = agentAttentionForHook("claude", {
      hook_event_name: "StopFailure",
      error: "server_error",
      error_details: `line one\nline two${"x".repeat(400)}`,
    });
    expect(attention?.detail.startsWith("line one line two")).toBe(true);
    expect(attention?.detail.length).toBe(200);
  });

  test("every attention comes with an ask report", () => {
    expect(
      agentEventForHook("claude", {
        hook_event_name: "StopFailure",
        error: "rate_limit",
      }),
    ).toBe("ask");
  });
});

describe("the state report carries the attention", () => {
  const error: AgentAttention = {
    kind: "error",
    reason: "rate_limit",
    detail: "429 Too Many Requests",
  };

  test("a reported error stop is waiting with its reason", async () => {
    const res = await post({ target: PANE, event: "ask", attention: error });
    expect(res?.status).toBe(200);
    expect(getAgentState(PANE)).toMatchObject({
      state: "waiting",
      attention: error,
    });
  });

  test.each([
    { name: "unknown kind", value: { kind: "other", reason: "", detail: "" } },
    { name: "missing detail", value: { kind: "error", reason: "x" } },
    {
      name: "control character",
      value: { kind: "error", reason: "a\u0007", detail: "" },
    },
    {
      name: "too long",
      value: { kind: "error", reason: "x".repeat(201), detail: "" },
    },
    { name: "not an object", value: "error" },
  ])(
    "refuses a malformed attention ($name) without recording",
    async ({ value }) => {
      const res = await post({ target: PANE, event: "ask", attention: value });
      expect([res?.status, await res?.text(), getAgentState(PANE)]).toEqual([
        400,
        "invalid attention",
        null,
      ]);
    },
  );

  test("the screen's idle rule does not clear an error stop", () => {
    recordAgentState({ target: PANE, event: "prompt", source: "hook" });
    recordAgentState({
      target: PANE,
      event: "ask",
      source: "hook",
      attention: error,
    });
    recordAgentState({
      target: PANE,
      state: "idle",
      source: "screen",
      override: true,
    });
    expect(getAgentState(PANE)).toMatchObject({
      state: "waiting",
      attention: error,
    });
  });

  test("the screen can still move a permission wait on (answered on screen)", () => {
    recordAgentState({
      target: PANE,
      event: "ask",
      source: "hook",
      attention: { kind: "permission", reason: "", detail: "" },
    });
    recordAgentState({
      target: PANE,
      state: "idle",
      source: "screen",
      override: true,
    });
    const record = getAgentState(PANE);
    expect(record?.state).toBe("idle");
    expect(record?.attention).toBeUndefined();
  });

  test("the next prompt clears the reason", () => {
    recordAgentState({
      target: PANE,
      event: "ask",
      source: "hook",
      attention: error,
    });
    recordAgentState({ target: PANE, event: "prompt", source: "hook" });
    expect(getAgentState(PANE)?.state).toBe("working");
    expect(getAgentState(PANE)?.attention).toBeUndefined();
  });

  test("an ask without a reason drops the previous reason", () => {
    recordAgentState({
      target: PANE,
      event: "ask",
      source: "hook",
      attention: error,
    });
    recordAgentState({ target: PANE, event: "ask", source: "hook" });
    expect(getAgentState(PANE)?.attention).toBeUndefined();
  });
});

describe("the card names the reason instead of 'Needs input'", () => {
  function card(attention: AgentAttention | undefined, unread?: "waiting") {
    const row = document.createElement("button");
    fillAgentCard(
      row,
      agentPane({
        id: PANE,
        state: "waiting",
        title: "claude",
        ...(attention ? { attention } : {}),
      }),
      agentsText("en"),
      unread,
    );
    return {
      badge: row.querySelector(".agent-card-badge")?.textContent ?? null,
      state: row.querySelector(".agent-card-state")?.textContent ?? null,
      title: row.querySelector(".agent-card-state")?.getAttribute("title"),
    };
  }

  test.each([
    [undefined, "Needs input"],
    [{ kind: "permission", reason: "", detail: "" }, "Needs permission"],
    [{ kind: "question", reason: "", detail: "" }, "Has a question"],
    [
      { kind: "error", reason: "rate_limit", detail: "" },
      "Stopped on an error · rate_limit",
    ],
  ] satisfies [AgentAttention | undefined, string][])(
    "%j -> %s",
    (attention, expected) => {
      expect(card(attention).state).toBe(expected);
    },
  );

  test("the error's details go to the tooltip", () => {
    const shown = card({
      kind: "error",
      reason: "rate_limit",
      detail: "429 Too Many Requests",
    });
    expect(shown.title).toContain("rate_limit");
    expect(shown.title).toContain("429 Too Many Requests");
  });

  test("an unread error stop's badge names the reason", () => {
    expect(
      card({ kind: "error", reason: "rate_limit", detail: "" }, "waiting")
        .badge,
    ).toBe("Stopped on an error");
  });
});
