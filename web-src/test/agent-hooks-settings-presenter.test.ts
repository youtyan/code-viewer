// エージェント連携の節の presenter (views/agents/agent-hooks-settings.ts)。表示を
// 記録する view に差し替え、サーバの答えから view に渡す値と、押したときに
// サーバへ送るものを見る。表示そのものは既定の view に描かせる (ダイアログの
// 中身を描くため)。パスはすべて架空。

import "./_dom";
import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  AgentHookPlanResponse,
  AgentHooksResponse,
  HookAgent,
} from "../core/agent-hooks";
import {
  type AgentHooksPlanBodyProps,
  type AgentHooksSectionProps,
  createAgentHooksSettings,
  DEFAULT_VIEW,
} from "../views/agents/agent-hooks-settings";
import { agentsText } from "../views/agents/i18n";
import { closeOpenDialog } from "./_dialog-helpers";

afterEach(() => {
  closeOpenDialog();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const HOME = "/home/sample";

function row(agent: HookAgent) {
  const path = `${HOME}/.${agent}/${agent === "claude" ? "settings.json" : "hooks.json"}`;
  return {
    agent,
    configDir: `${HOME}/.${agent}`,
    path,
    realPath: path,
    symlink: false,
    state: "none" as const,
    detail: "",
    writeBlocked: "",
    kept: 0,
  };
}

const STATUS: AgentHooksResponse = {
  home: HOME,
  agents: [row("claude"), row("codex")],
  launcher: { state: "ok", path: `${HOME}/launcher`, detail: "" },
  failures: { total: 0, recent: [], log: "" },
};

const PLAN: AgentHookPlanResponse = {
  agent: "claude",
  action: "install",
  path: row("claude").path,
  realPath: row("claude").path,
  symlink: false,
  fileExists: true,
  added: [],
  removed: [],
  kept: 2,
  changed: true,
  backupPath: null,
  diff: "",
  formattingChanged: false,
  launcher: { path: `${HOME}/launcher`, write: false },
  writeBlocked: "",
  baseHash: "0".repeat(64),
  fileIdentity: "sample",
};

function setup() {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      const body = url.startsWith("/_agent/hooks/plan") ? PLAN : STATUS;
      return Response.json(body);
    }),
  );
  const sections: AgentHooksSectionProps[] = [];
  const plans: AgentHooksPlanBodyProps[] = [];
  const section = createAgentHooksSettings(
    {
      getText: () => agentsText("en").hooks,
      trackLoad: (promise) => promise,
      actionHeaders: () => ({}),
      onChanged: () => undefined,
      helpLink: () => ({ label: "Help › sample", href: "/help" }),
      openHelp: () => undefined,
      openAgent: () => Promise.resolve(""),
    },
    {
      section: (props) => {
        sections.push(props);
        return DEFAULT_VIEW.section(props);
      },
      planBody: (props) => {
        plans.push(props);
        return DEFAULT_VIEW.planBody(props);
      },
    },
  );
  document.body.appendChild(section.element);
  return { section, sections, plans, requests };
}

function last<T>(items: T[]): T | undefined {
  return items[items.length - 1];
}

describe("the agent hooks presenter", () => {
  test("gives the view one row per agent, with the home folder shortened", async () => {
    const { section, sections } = setup();
    await section.refresh();
    const shown = last(sections);
    const text = agentsText("en").hooks;
    expect(
      shown?.rows?.map((item) => [
        item.agent,
        item.stateLabel,
        item.path.text,
        item.action?.label,
      ]),
    ).toEqual([
      [
        "claude",
        text.state.none,
        "~/.claude/settings.json",
        text.action.install,
      ],
      ["codex", text.state.none, "~/.codex/hooks.json", text.action.install],
    ]);
  });

  test("pressing a row's action asks the server for a plan and shows it as a diff", async () => {
    const { section, sections, plans, requests } = setup();
    await section.refresh();
    const action = last(sections)?.rows?.[0]?.action;
    action?.onClick(document.body);
    await vi.waitFor(() => expect(plans.length).toBe(1));
    expect([
      requests.some((url) => url.startsWith("/_agent/hooks/plan?agent=claude")),
      plans[0]?.kind,
      last(sections)?.rows?.[1]?.action?.disabled,
    ]).toEqual([true, "diff", true]);
  });
});
