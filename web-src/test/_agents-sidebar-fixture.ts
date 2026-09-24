// 左のサイドバーのテストで共有する組み立て (プロジェクトの情報・一覧の応答・
// 偽の取り直し)。agents-sidebar.test.ts と agents-sidebar-running-split.test.ts が使う。

import type {
  AgentOverviewResponse,
  AgentOverviewShell,
  AgentPane,
  AgentProjectInfo,
} from "../core/agent-overview";
import { PROJECT_COLORS } from "../core/project-colors";
import type {
  AgentMonitor,
  AgentMonitorSnapshot,
} from "../views/agents/agent-monitor";

/** プロジェクト 1 つ。order が null なら登録していない。 */
export function info(
  root: string,
  order: number | null,
  server: AgentProjectInfo["server"] = { status: "absent" },
): AgentProjectInfo {
  const name = root.slice(root.lastIndexOf("/") + 1);
  return {
    root,
    name,
    displayRoot: root,
    git: true,
    error: "",
    server,
    registered:
      order === null
        ? null
        : {
            root,
            name,
            order,
            color: PROJECT_COLORS[order % PROJECT_COLORS.length],
          },
  };
}

/** 一覧の応答。登録簿は登録したプロジェクトから作る。 */
export function overview(
  panes: AgentPane[],
  projects: AgentProjectInfo[],
  shells: AgentOverviewShell[] = [],
): AgentOverviewResponse {
  return {
    serverInstance: "sample",
    observedAt: 0,
    tmux: { available: true, running: true, error: "" },
    panes,
    projects,
    errors: [],
    registry: {
      projects: projects
        .filter((item) => item.registered)
        .map((item) => ({
          root: item.root,
          name: item.name,
          order: item.registered?.order ?? 0,
          color: item.registered?.color ?? "violet",
          port: null,
        })),
      error: "",
      path: "/state/projects.json",
    },
    shells,
  };
}

/** 偽の取り直し。publish で次の応答を配る。 */
export function fakeMonitor(
  initial: AgentOverviewResponse,
  notify: {
    sawWaiting?: boolean;
    permission?: ReturnType<AgentMonitor["permission"]>;
    permissionAsked?: boolean;
    requested?: ReturnType<AgentMonitor["permission"]>;
  } = {},
) {
  let snapshot: AgentMonitorSnapshot = {
    overview: initial,
    error: "",
    notifyError: "",
    unread: new Map(),
    sawWaiting: notify.sawWaiting ?? false,
    permissionAsked: notify.permissionAsked ?? false,
  };
  const listeners = new Set<() => void>();
  const monitor: AgentMonitor = {
    start: () => undefined,
    refresh: async () => undefined,
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    markRead: () => undefined,
    permission: () => notify.permission ?? "default",
    requestPermission: async () => {
      snapshot = { ...snapshot, permissionAsked: true };
      notify.permission = notify.requested ?? "default";
      return notify.permission;
    },
  };
  return {
    monitor,
    publish(next: AgentOverviewResponse) {
      snapshot = { ...snapshot, overview: next };
      for (const listener of listeners) listener();
    },
  };
}

/** scope の直下のプロジェクトの見出しの名前 (上から)。 */
export function projectNames(scope: Element): (string | null)[] {
  return [
    ...scope.querySelectorAll(":scope > .nav-project .nav-project-name"),
  ].map((el) => el.textContent);
}
