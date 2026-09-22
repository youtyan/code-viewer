import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type {
  AgentOverviewResponse,
  AgentPane,
  AgentUnreadEntry,
} from "../core/agent-overview";
import { createAgentMonitor } from "../views/agents/agent-monitor";
import { agentsText } from "../views/agents/i18n";
import { agentPane } from "./_test-helpers";

function pane(id: string, state: AgentPane["state"]): AgentPane {
  return agentPane({
    id,
    state,
    path: "/work/sample-app",
    project: "/work/sample-app",
  });
}

function overview(
  panes: AgentPane[],
  unread: AgentUnreadEntry[],
): AgentOverviewResponse {
  return {
    serverInstance: "sample",
    observedAt: 0,
    tmux: { available: true, running: true, error: "" },
    panes,
    projects: [],
    errors: [],
    registry: { projects: [], error: "", path: "/state/projects.json" },
    unread,
  };
}

const created: string[] = [];
beforeEach(() => {
  created.length = 0;
  vi.stubGlobal(
    "Notification",
    class {
      static permission = "granted";
      constructor(_title: string, options: { tag: string }) {
        created.push(options.tag);
      }
      addEventListener(): void {
        // この表は通知を押す場面を見ない。
      }
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// 背面のタブは取り直しが間引かれ、作業中を見ないまま入力待ちになることがある。
// そのときはサーバの未読に新しく載った変化で通知する。開く前からの未読と、
// 既に知っている未読では通知しない。
test.each([
  {
    name: "a waiting the screen never saw working is notified from the server's unread",
    responses: [
      overview([], []),
      overview(
        [pane("%2", "waiting")],
        [{ pane: "%2", transition: "waiting" }],
      ),
    ],
    expected: ["code-viewer-agent:%2:waiting"],
  },
  {
    name: "unread already there when the page opens is not notified",
    responses: [
      overview(
        [pane("%2", "waiting")],
        [{ pane: "%2", transition: "waiting" }],
      ),
    ],
    expected: [],
  },
  {
    name: "the same unread on the next fetch is not notified again",
    responses: [
      overview([pane("%2", "working")], []),
      overview(
        [pane("%2", "waiting")],
        [{ pane: "%2", transition: "waiting" }],
      ),
      overview(
        [pane("%2", "waiting")],
        [{ pane: "%2", transition: "waiting" }],
      ),
    ],
    expected: ["code-viewer-agent:%2:waiting"],
  },
])("$name", async ({ responses, expected }) => {
  const queue = [...responses];
  vi.stubGlobal("fetch", async () => Response.json(queue.shift()));
  const monitor = createAgentMonitor({
    getText: () => agentsText("en"),
    getNotifySettings: () => ({ waiting: true, finished: true }),
    isViewing: () => false,
    onUnreadCountChange: () => undefined,
    onNotificationClick: () => undefined,
    actionHeaders: () => ({}),
  });
  for (const _ of responses) await monitor.refresh();
  expect(created).toEqual(expected);
});
