// 全体ボードの上のフックの案内 (views/agents/agents-presenter.ts の hookHintProps)。
// 未設定なら「有効にできます」、入っているが古い (一部だけ)・呼び先が無いなら
// 「入れ直しが要る」と言い、その場で入れ直すボタンを出す。閉じた案内は、閉じた
// ときと中身が変われば出し直す。

import "./_dom";
import { describe, expect, test } from "vitest";
import type {
  AgentHookState,
  AgentHookStatus,
  AgentHooksResponse,
  HookAgent,
} from "../core/agent-hooks";
import { HOOK_HINT_DISMISSED_LEGACY, hookHintKey } from "../core/agent-hooks";
import { agentsText } from "../views/agents/i18n";
import { flushRenders } from "../views/ui/render-queue";
import { mountBoard } from "./_agents-board";
import { agentPane } from "./_test-helpers";

function row(
  agent: HookAgent,
  state: AgentHookState,
  writeBlocked = "",
): AgentHookStatus {
  return {
    agent,
    configDir: `/cfg/${agent}`,
    path: `/cfg/${agent}/file`,
    realPath: `/cfg/${agent}/file`,
    symlink: false,
    state,
    detail: "",
    writeBlocked,
    kept: 0,
  };
}

function status(...agents: AgentHookStatus[]): AgentHooksResponse {
  return {
    home: "/home/sample",
    agents,
    launcher: { state: "ok", path: "/state/launcher", detail: "" },
    failures: { total: 0, recent: [], log: "/state/log" },
  };
}

const PANES = [
  agentPane({ id: "%1", kind: "opencode", command: "opencode" }),
  agentPane({ id: "%2", kind: "claude", command: "claude" }),
];

function hint(): HTMLElement {
  const element = document.querySelector<HTMLElement>(".agents-hook-hint");
  if (!element) throw new Error("no hook hint on the board");
  return element;
}

function buttons(element: HTMLElement): string[] {
  return [...element.querySelectorAll<HTMLButtonElement>("button")]
    .map((button) => button.textContent ?? "")
    .filter(Boolean);
}

describe("the hook hint on the board", () => {
  test.each([
    {
      name: "not set up: the hint as before, no reinstall button",
      hooks: status(row("opencode", "none"), row("claude", "installed")),
      lang: "en" as const,
      text: agentsText("en").hookHint("opencode"),
      repairs: [] as string[],
    },
    {
      name: "out of date: says it needs reinstalling and offers it in place",
      hooks: status(row("opencode", "partial"), row("claude", "installed")),
      lang: "en" as const,
      text: agentsText("en").hookHintStale("opencode"),
      repairs: [agentsText("en").hookHintRepair("opencode")],
    },
    {
      name: "日本語: 呼び先が無い",
      hooks: status(row("opencode", "broken"), row("claude", "installed")),
      lang: "ja" as const,
      text: agentsText("ja").hookHintStale("opencode"),
      repairs: [agentsText("ja").hookHintRepair("opencode")],
    },
    {
      name: "one out of date and one not set up",
      hooks: status(row("opencode", "partial"), row("claude", "none")),
      lang: "en" as const,
      text: `${agentsText("en").hookHintStale("opencode")} ${agentsText("en").hookHint("claude")}`,
      repairs: [agentsText("en").hookHintRepair("opencode")],
    },
  ])("$name", async ({ hooks, lang, text, repairs }) => {
    await mountBoard(PANES, lang, undefined, undefined, { hooks });
    const element = hint();
    expect(element.hidden).toBe(false);
    expect(element.querySelector(".agents-hook-hint-text")?.textContent).toBe(
      text,
    );
    expect(
      [...element.querySelectorAll(".agents-hook-hint-repair")].map(
        (button) => button.textContent,
      ),
    ).toEqual(repairs);
    expect(buttons(element)).toContain(agentsText(lang).hookHintOpen);
  });

  test("reinstalling runs the settings' repair for that agent, from the board", async () => {
    const { calls } = await mountBoard(PANES, "en", undefined, undefined, {
      hooks: status(row("opencode", "partial")),
      repair: true,
    });
    hint()
      .querySelector<HTMLButtonElement>(".agents-hook-hint-repair")
      ?.click();
    await Promise.resolve();
    expect(calls).toEqual(["repair:opencode"]);
  });

  test("when the settings cannot repair it, the board goes to the settings instead", async () => {
    const { calls } = await mountBoard(PANES, "en", undefined, undefined, {
      hooks: status(row("opencode", "partial")),
      repair: false,
    });
    hint()
      .querySelector<HTMLButtonElement>(".agents-hook-hint-repair")
      ?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(["repair:opencode", "open-hook-settings"]);
  });

  test("Hide this remembers what was shown", async () => {
    const { calls } = await mountBoard(PANES, "en", undefined, undefined, {
      hooks: status(row("opencode", "partial"), row("claude", "none")),
    });
    hint().querySelector<HTMLButtonElement>(".agents-hook-hint-close")?.click();
    expect(calls).toEqual(["dismiss:claude:none,opencode:partial"]);
  });

  test.each([
    {
      name: "hidden while it shows what was hidden",
      hooks: status(row("opencode", "none")),
      dismissed: hookHintKey([{ agent: "opencode", state: "none" }]),
      shown: false,
    },
    {
      name: "hidden for not set up, shown again once the hooks are out of date",
      hooks: status(row("opencode", "partial")),
      dismissed: hookHintKey([{ agent: "opencode", state: "none" }]),
      shown: true,
    },
    {
      name: "an old dismissal (a plain yes) still hides the not-set-up hint",
      hooks: status(row("opencode", "none")),
      dismissed: HOOK_HINT_DISMISSED_LEGACY,
      shown: false,
    },
    {
      name: "an old dismissal does not hide out-of-date hooks",
      hooks: status(row("opencode", "broken")),
      dismissed: HOOK_HINT_DISMISSED_LEGACY,
      shown: true,
    },
  ])("$name", async ({ hooks, dismissed, shown }) => {
    await mountBoard(PANES, "en", undefined, undefined, { hooks, dismissed });
    await flushRenders();
    expect(hint().hidden).toBe(!shown);
  });
});
