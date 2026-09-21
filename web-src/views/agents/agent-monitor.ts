// どの画面にいてもエージェントの状態を追いかける役。
//
// /_agent/overview を一定間隔で取り直し、前回との差から「作業中 → 入力待ち」
// 「作業中 → 止まった」を拾って、未読の印・タブのタイトルの件数・ブラウザの
// 通知に流す。エージェント一覧の画面とヘッダの件数表示は、ここが持っている
// 最新の結果を購読して描くだけにする (取り直しを画面ごとに持たない)。
//
// タブが裏にあっても止めない。通知が要るのはむしろそのときなので。ただし
// ブラウザは裏のタブのタイマーを間引くので、長く裏にあると取り直しの間隔は
// 延びる。
//
// 変化の判定・未読・通知の条件は core/agent-overview の純関数に置き、ここは
// 取得とブラウザ API の出し入れだけを持つ。

import {
  type AgentNotifySettings,
  type AgentOverviewResponse,
  type AgentPane,
  type AgentTransition,
  nextAgentUnread,
  paneTaskText,
  shouldNotifyAgent,
} from "../../core/agent-overview";
import type { AgentState } from "../../core/agent-state";
import {
  formatErrorDetail,
  responseErrorMessage,
} from "../../core/error-detail";
import { BACKGROUND_REQUEST_HEADER } from "../../core/network-activity";
import type { TmuxPaneId } from "../../core/tmux";
import type { AgentsText } from "./i18n";

/**
 * 取り直す間隔。サーバの巡回 (terminal/activity.ts) と合わせて、状態が
 * 変わってから画面に出るまでを 5 秒以内に収めるための値。
 */
export const AGENT_MONITOR_INTERVAL_MS = 1500;

export type NotificationPermissionState =
  | "granted"
  | "denied"
  | "default"
  | "unsupported";

export type AgentMonitorSnapshot = {
  /** まだ 1 度も取れていなければ null。 */
  overview: AgentOverviewResponse | null;
  /** 最後の取得の失敗。空なら成功。 */
  error: string;
  /** 通知を出せなかった理由。空なら問題なし。 */
  notifyError: string;
  unread: ReadonlyMap<TmuxPaneId, AgentTransition>;
};

export type AgentMonitorDeps = {
  getText(): AgentsText;
  getNotifySettings(): AgentNotifySettings;
  /** タブが前面で、そのペインをいまターミナルで見ているか。 */
  isViewing(pane: AgentPane): boolean;
  onUnreadCountChange(count: number): void;
  /** 通知を押されたとき。そのペインを開く。 */
  onNotificationClick(pane: AgentPane): void;
  actionHeaders(): HeadersInit;
};

export type AgentMonitor = {
  start(): void;
  refresh(): Promise<void>;
  snapshot(): AgentMonitorSnapshot;
  subscribe(listener: () => void): () => void;
  /** 開いた・選んだ。未読を解く。 */
  markRead(pane: TmuxPaneId): void;
  permission(): NotificationPermissionState;
  requestPermission(): Promise<NotificationPermissionState>;
};

function notificationApi(): typeof Notification | null {
  return typeof Notification === "function" ? Notification : null;
}

export function createAgentMonitor(deps: AgentMonitorDeps): AgentMonitor {
  let overview: AgentOverviewResponse | null = null;
  let error = "";
  let notifyError = "";
  let unread = new Map<TmuxPaneId, AgentTransition>();
  /** 前回の状態。最初の取得の前は null (何も起きたことにしない)。 */
  let previous: Map<TmuxPaneId, AgentState> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  function emit(): void {
    deps.onUnreadCountChange(unread.size);
    for (const listener of listeners) listener();
  }

  function permission(): NotificationPermissionState {
    const api = notificationApi();
    return api ? api.permission : "unsupported";
  }

  function notify(pane: AgentPane, transition: AgentTransition): void {
    const api = notificationApi();
    if (!api) return;
    const text = deps.getText();
    const project =
      overview?.projects.find((info) => info.root === pane.project)?.name ??
      pane.project;
    const title =
      transition === "waiting"
        ? text.notifyWaitingTitle(project)
        : text.notifyFinishedTitle(project);
    // 同じペインの同じ変化は 1 枚に畳む。同じサーバを複数のタブで開いて
    // いても、OS の通知が重ならない。
    const notification = new api(title, {
      body: `${paneTaskText(pane)}\n${pane.label}`,
      tag: `code-viewer-agent:${pane.id}:${transition}`,
    });
    notification.addEventListener("click", () => {
      window.focus();
      notification.close();
      deps.onNotificationClick(pane);
    });
  }

  function apply(next: AgentOverviewResponse): void {
    // 別のサーバ (再起動した後) の応答は、前回と比べずに最初の取得として扱う。
    if (overview && overview.serverInstance !== next.serverInstance) {
      previous = null;
    }
    const update = nextAgentUnread(unread, previous, next.panes, (pane) =>
      deps.isViewing(pane),
    );
    const failures: string[] = [];
    const context = {
      settings: deps.getNotifySettings(),
      permission: permission(),
    };
    for (const { pane, transition } of update.transitions) {
      if (
        !shouldNotifyAgent(transition, {
          ...context,
          viewing: deps.isViewing(pane),
        })
      )
        continue;
      try {
        notify(pane, transition);
      } catch (cause) {
        // 通知が出せなくても一覧の更新は止めない。理由は画面に出す。
        console.error("[code-viewer] agent notification failed", cause);
        failures.push(`${pane.label}: ${formatErrorDetail(cause)}`);
      }
    }
    notifyError = failures.join("\n");
    unread = update.unread;
    previous = new Map(next.panes.map((pane) => [pane.id, pane.state]));
    overview = next;
  }

  /**
   * 取れなかったときは、前の結果を出し続けない (件数も一覧も「分からない」に
   * する)。比べる元も捨てる。戻ってきたサーバが再起動したものでも、戻った
   * 直後の状態を「変化」と取り違えないため。
   */
  function forget(message: string): void {
    error = message;
    overview = null;
    previous = null;
  }

  async function load(): Promise<void> {
    try {
      // 裏の取り直し。通信中の表示と取消の対象から外す (network-activity)。
      const res = await fetch("/_agent/overview", {
        headers: { [BACKGROUND_REQUEST_HEADER]: "1" },
      });
      if (!res.ok) {
        forget(await responseErrorMessage(res, deps.getText().loadFailed));
        emit();
        return;
      }
      const next = (await res.json()) as AgentOverviewResponse;
      error = "";
      apply(next);
    } catch (cause) {
      console.error("[code-viewer] agent overview refresh failed", cause);
      forget(`${deps.getText().loadFailed}\n${formatErrorDetail(cause)}`);
    }
    emit();
  }

  function refresh(): Promise<void> {
    // 取り直しが重なったら、走っているものの結果を待つ。前の応答が後から
    // 届いて新しい結果を巻き戻すことがない。
    inFlight ??= load().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function schedule(): void {
    timer = setTimeout(() => {
      void refresh().finally(schedule);
    }, AGENT_MONITOR_INTERVAL_MS);
  }

  async function markReadOnServer(pane: TmuxPaneId): Promise<void> {
    // 申告の done は、読んだと伝えるまでサーバ側で残り続ける (ターミナルの
    // 「読んだ」ボタンと同じ経路)。
    const res = await fetch("/_agent/state", {
      method: "POST",
      headers: {
        ...deps.actionHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ target: pane, event: "read", at: Date.now() }),
    });
    if (!res.ok) throw new Error(await responseErrorMessage(res, "read"));
  }

  return {
    start() {
      if (timer !== null) return;
      void refresh();
      schedule();
    },
    refresh,
    snapshot: () => ({ overview, error, notifyError, unread }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    markRead(pane) {
      const current = overview?.panes.find((item) => item.id === pane);
      const hadUnread = unread.delete(pane);
      if (current?.state === "done") {
        markReadOnServer(pane).then(
          () => refresh(),
          (cause: unknown) => {
            console.error("[code-viewer] agent mark-read failed", cause);
            error = formatErrorDetail(cause);
            emit();
          },
        );
      }
      if (hadUnread) emit();
    },
    permission,
    async requestPermission() {
      const api = notificationApi();
      if (!api) return "unsupported";
      const result = await api.requestPermission();
      emit();
      return result;
    },
  };
}
