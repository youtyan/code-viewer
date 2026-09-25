// フックを入れた結果の下の［claude を開く］［codex を開く］(views/agents/agent-hooks-settings.ts)。
// 「codex で /hooks を開いて信頼してください」と言うだけにせず、その場で開けるように
// する。サーバの答え (一覧・計画・書き込み) は偽の fetch で返す。パスはすべて架空。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type {
  AgentHookApplyResponse,
  AgentHookPlanResponse,
  AgentHooksResponse,
  HookAgent,
} from "../core/agent-hooks";
import { createAgentHooksSettings } from "../views/agents/agent-hooks-settings";
import { agentsText } from "../views/agents/i18n";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const HOME = "/home/sample";

function status(agent: HookAgent, state: "none" | "installed") {
  const dir = `${HOME}/.${agent}`;
  return {
    agent,
    configDir: dir,
    path: `${dir}/${agent === "claude" ? "settings.json" : "hooks.json"}`,
    realPath: `${dir}/${agent === "claude" ? "settings.json" : "hooks.json"}`,
    symlink: false,
    state,
    detail: "",
    writeBlocked: "",
    kept: 0,
  };
}

function hooks(state: "none" | "installed"): AgentHooksResponse {
  return {
    home: HOME,
    agents: [status("claude", state), status("codex", state)],
    launcher: { state: "ok", path: `${HOME}/launcher`, detail: "" },
    failures: { total: 0, recent: [], log: "" },
  };
}

function plan(agent: HookAgent): AgentHookPlanResponse {
  const file = status(agent, "none").path;
  return {
    agent,
    action: "install",
    path: file,
    realPath: file,
    symlink: false,
    fileExists: true,
    added: [],
    removed: [],
    kept: 0,
    changed: true,
    backupPath: `${file}.code-viewer-backup-20260101-000000`,
    diff: "",
    formattingChanged: false,
    launcher: {
      path: `${HOME}/.local/state/code-viewer/launcher`,
      write: false,
    },
    writeBlocked: "",
    baseHash: "0".repeat(64),
    fileIdentity: "sample",
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function installed(
  agent: HookAgent,
  openAgent: (agent: HookAgent) => Promise<string>,
  beforeConfirm: () => void = () => undefined,
  backupPath: string | null = null,
) {
  let current = hooks("none");
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          headers: { "Content-Type": "application/json" },
        });
      if (url.startsWith("/_agent/hooks/plan")) return json(plan(agent));
      if (url.startsWith("/_agent/hooks/apply") && init?.method === "POST") {
        current = hooks("installed");
        const result: AgentHookApplyResponse = {
          path: plan(agent).path,
          changed: true,
          backupPath,
          launcherWritten: false,
        };
        return json(result);
      }
      if (url.startsWith("/_agent/hooks")) return json(current);
      throw new Error(`unexpected request ${url}`);
    },
  });
  const section = createAgentHooksSettings({
    getText: () => agentsText("ja").hooks,
    trackLoad: (promise) => promise,
    actionHeaders: () => ({}),
    onChanged: () => undefined,
    helpLink: () => ({ label: "ヘルプ", href: "/help" }),
    openHelp: () => undefined,
    openAgent,
  });
  document.body.appendChild(section.element);
  await section.refresh();
  const row = [
    ...section.element.querySelectorAll<HTMLElement>(".agent-hooks-row"),
  ].find((item) => item.textContent?.includes(agent));
  row?.querySelector<HTMLButtonElement>(".agent-hooks-action")?.click();
  await settle();
  beforeConfirm();
  document
    .querySelector<HTMLButtonElement>(".gdp-dialog .gdp-dialog-confirm")
    ?.click();
  await settle();
  const after = [
    ...section.element.querySelectorAll<HTMLElement>(".agent-hooks-row"),
  ].find((item) => item.textContent?.includes(agent));
  if (!after) throw new Error(`no ${agent} row`);
  return after;
}

describe("after installing the hooks: open the agent right there", () => {
  const text = agentsText("ja").hooks;

  test.each([
    { agent: "claude", words: text.afterInstall.claude },
    { agent: "codex", words: text.afterInstall.codex },
  ] as const)("$agent", async ({ agent, words }) => {
    const opened: HookAgent[] = [];
    const row = await installed(agent, async (target) => {
      opened.push(target);
      return "";
    });
    // 結果の文は状況 + 押すと何が済むか。命令だけにしない。
    expect(row.querySelector(".agent-hooks-result")?.textContent).toContain(
      words,
    );
    const open = row.querySelector<HTMLButtonElement>(
      ".agent-hooks-open button",
    );
    expect(open?.textContent).toBe(text.openAgent[agent]);
    open?.click();
    await settle();
    expect(opened).toEqual([agent]);
    expect(
      row.ownerDocument.querySelector(
        ".agent-hooks-open .agent-hooks-result-ok",
      )?.textContent,
    ).toBe(text.openedAgent(agent));
  });

  test("a failure to open says why, in full", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await installed("codex", async () => {
      throw new Error("start the agent (HTTP 500): sample failure");
    });
    document
      .querySelector<HTMLButtonElement>(".agent-hooks-open button")
      ?.click();
    await settle();
    const failure =
      document.querySelector(".agent-hooks-open .agent-hooks-result-error")
        ?.textContent ?? "";
    expect(failure).toContain(text.openAgentFailed("codex"));
    expect(failure).toContain("start the agent (HTTP 500): sample failure");
  });

  test("the confirmation shows paths under the home as ~ (like the statusLine one)", async () => {
    let seen = "";
    await installed(
      "claude",
      async () => "",
      () => {
        seen = document.querySelector(".gdp-dialog")?.textContent ?? "";
      },
    );
    expect(seen).toContain("~/.claude/settings.json");
    expect(seen).toContain(
      text.dialogBackup(
        "~/.claude/settings.json.code-viewer-backup-<YYYYMMDD-HHMMSS>",
      ),
    );
    expect(seen).not.toContain(`${HOME}/.claude`);
  });

  test("the result also shows the backup under the home as ~", async () => {
    const backup = `${HOME}/.claude/settings.json.code-viewer-backup-20260101-000000`;
    const row = await installed(
      "claude",
      async () => "",
      () => undefined,
      backup,
    );
    const result = row.querySelector(".agent-hooks-result")?.textContent ?? "";
    expect(result).toContain(
      text.backupAt(
        "~/.claude/settings.json.code-viewer-backup-20260101-000000",
      ),
    );
    expect(result).not.toContain(backup);
  });
});
