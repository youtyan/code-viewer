// 全体ボードの presenter (views/agents/agents-presenter.ts) を、取得の係と
// プロジェクトの操作を偽物にして描く。全体ボードのテスト (agents-view-empty・
// agents-hook-hint) が使う。

import type { AgentHooksResponse, HookAgent } from "../core/agent-hooks";
import type {
  AgentOverviewResponse,
  AgentPane,
  AgentProjectInfo,
} from "../core/agent-overview";
import type { AgentMonitor } from "../views/agents/agent-monitor";
import { createAgentsPresenter } from "../views/agents/agents-presenter";
import type { AgentsBoardView, BoardOrder } from "../views/agents/agents-view";
import { agentsText } from "../views/agents/i18n";
import type { PanePreview } from "../views/agents/pane-preview";
import type { ProjectActions } from "../views/projects/project-actions";
import { overview as overviewWith } from "./_agents-sidebar-fixture";

export function overview(panes: AgentPane[]): AgentOverviewResponse {
  return {
    serverInstance: "sample",
    observedAt: 0,
    tmux: { available: true, running: true, error: "" },
    panes,
    projects: [],
    errors: [],
    registry: { projects: [], error: "", path: "/state/projects.json" },
  };
}

export async function mountBoard(
  panes: AgentPane[],
  lang: "en" | "ja" = "en",
  preview?: PanePreview,
  projects?: AgentProjectInfo[],
  extra: {
    permission?: "granted" | "denied" | "default" | "unsupported";
    tmux?: AgentOverviewResponse["tmux"];
    /** 表示を差し替える (presenter のテスト)。 */
    view?: AgentsBoardView;
    /** 並びを覚える所 (ユーザー単位の設定の代わり)。 */
    boardOrder?: { get(): BoardOrder | null; set(order: BoardOrder): void };
    /** サーバが覚えているピン (無ければ古い版のサーバ: 画面のメモリで留める)。 */
    serverPins?: string[];
    /** 留める・外すをサーバへ送ったとき。 */
    setPinned?: (pane: string, on: boolean) => void;
    /** フックの状態 (無ければまだ取っていない)。 */
    hooks?: AgentHooksResponse;
    /** フックの案内を閉じたときの中身 (無ければ閉じていない)。 */
    dismissed?: string;
    /** 設定の「直す」が直せたか (呼ばれたら calls に repair:<種類>)。 */
    repair?: boolean;
  } = {},
) {
  document.body.innerHTML = '<main id="content"></main>';
  const calls: string[] = [];
  const base = projects ? overviewWith(panes, projects) : overview(panes);
  const withTmux = extra.tmux ? { ...base, tmux: extra.tmux } : base;
  const snapshot = {
    overview: extra.serverPins
      ? { ...withTmux, pinned: extra.serverPins }
      : withTmux,
    error: "",
    notifyError: "",
    unread: new Map(),
    sawWaiting: false,
    permissionAsked: false,
  };
  const monitor: AgentMonitor = {
    start: () => undefined,
    refresh: async () => undefined,
    snapshot: () => snapshot,
    subscribe: () => () => undefined,
    markRead: () => undefined,
    markUnread: async () => undefined,
    setPinned: async (pane, on) => {
      extra.setPinned?.(pane, on);
      const pinned = snapshot.overview.pinned;
      if (!pinned) return;
      snapshot.overview = {
        ...snapshot.overview,
        pinned: on ? [...pinned, pane] : pinned.filter((item) => item !== pane),
      };
    },
    latest: () => ({ overview: snapshot.overview, error: snapshot.error }),
    receive: () => undefined,
    permission: () => extra.permission ?? "granted",
    requestPermission: async () => "granted",
  };
  const actions: ProjectActions = {
    activity: () => null,
    signature: () => "",
    dismiss: () => undefined,
    subscribe: () => () => undefined,
    open: async () => undefined,
    registerCurrent: async () => undefined,
    registerRoot: async () => undefined,
    registerByPath: async () => {
      calls.push("register");
    },
    unregister: async () => undefined,
    rename: async () => undefined,
    recolor: async () => undefined,
    move: async () => undefined,
    place: async () => undefined,
    stop: async () => undefined,
  };
  const view = createAgentsPresenter(
    {
      monitor,
      getText: () => agentsText(lang),
      setPageMode: () => undefined,
      syncHeaderMenu: () => undefined,
      openPane: () => undefined,
      openNotificationSettings: () => undefined,
      reloadPage: () => {
        calls.push("reload");
      },
      tmuxInstallHelp: () => {
        calls.push("tmux-help");
        const box = document.createElement("div");
        box.className = "sample-install-help";
        return box;
      },
      getHookStatus: () => extra.hooks ?? null,
      refreshHookStatus: async () => undefined,
      hookHintDismissed: () => extra.dismissed ?? null,
      dismissHookHint: (key) => {
        calls.push(`dismiss:${key}`);
      },
      repairHooks: async (agent: HookAgent) => {
        calls.push(`repair:${agent}`);
        return extra.repair ?? true;
      },
      openHookSettings: () => {
        calls.push("open-hook-settings");
      },
      accountsBand: {
        element: document.createElement("div"),
        render: () => undefined,
        signature: () => "",
      },
      getAccounts: () => null,
      launch: () => {
        calls.push("launch");
      },
      handoff: {
        handoff: (pane) => {
          calls.push(`handoff:${pane.id}`);
        },
        openHookHelp: () => {
          calls.push("hook-help");
        },
        hookState: () => null,
      },
      onVisibilityChange: () => undefined,
      projects: actions,
      preview,
      boardOrder: extra.boardOrder,
    },
    extra.view,
  );
  await view.enter();
  return { view, calls };
}
