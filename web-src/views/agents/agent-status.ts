// ヘッダ右側の件数表示「入力待ち n  作業中 n」。どの画面にいても見える。
//
// 入力待ちが 1 件以上のときだけ注意の色にする。0 件のときは目立たせない
// (いつも騒がしい表示は誰も見なくなる)。数字の桁は固定幅で持たせ、件数が
// 変わってもボタンの大きさと位置が動かないようにする。
//
// 押すとエージェント一覧へ。入力待ちが 1 件だけなら、そのペインを直接開く。

import { html } from "lit/html.js";
import { headerAgentCounts } from "../../core/agent-overview";
import { renderOwned } from "../ui/renderer";
import type { AgentMonitor } from "./agent-monitor";
import type { AgentsText } from "./i18n";

export type AgentStatusDeps = {
  monitor: AgentMonitor;
  getText(): AgentsText;
  openList(): void;
  openPane(pane: string): void;
};

/** 件数の欄に描くもの (入力待ち・作業中の順)。 */
export type AgentStatusProps = {
  items: { state: "waiting" | "working"; label: string; count: string }[];
};

export type AgentStatusView = (props: AgentStatusProps) => unknown;

export const DEFAULT_VIEW: AgentStatusView = (props) =>
  props.items.map(
    (
      item,
    ) => html`<span class=${`agent-status-item agent-status-${item.state}`}><i
        class=${`terminal-mark terminal-mark-${item.state}`}
        aria-hidden="true"
      ></i><span class="agent-status-label">${item.label}</span><span
        class="agent-status-count"
      >${item.count}</span></span>`,
  );

export function mountAgentStatus(
  button: HTMLButtonElement,
  deps: AgentStatusDeps,
  view: AgentStatusView = DEFAULT_VIEW,
): { localize(): void } {
  function render(): void {
    const text = deps.getText();
    const { overview, error } = deps.monitor.snapshot();
    const panes = overview?.panes ?? [];
    const counts = headerAgentCounts(panes);
    // 取れていないときは数えられない。0 と出すと「誰も待っていない」と読める。
    renderOwned(
      button,
      view({
        items: [
          {
            state: "waiting",
            label: text.headerWaiting,
            count: overview ? String(counts.waiting) : "–",
          },
          {
            state: "working",
            label: text.headerWorking,
            count: overview ? String(counts.working) : "–",
          },
        ],
      }),
    );

    button.classList.toggle("agent-status-attention", counts.waiting > 0);
    button.classList.toggle("agent-status-busy", counts.working > 0);
    button.classList.toggle("agent-status-error", error !== "");
    const title = error
      ? text.headerFailed(error)
      : text.headerTitle(counts.waiting, counts.working);
    button.title = title;
    button.setAttribute("aria-label", title);
    button.hidden = false;
  }

  button.addEventListener("click", () => {
    const panes = deps.monitor.snapshot().overview?.panes ?? [];
    const waitingPanes = panes.filter(
      (pane) => pane.kind !== null && pane.state === "waiting",
    );
    const [only] = waitingPanes;
    if (only && waitingPanes.length === 1) deps.openPane(only.id);
    else deps.openList();
  });

  deps.monitor.subscribe(render);
  render();
  return { localize: render };
}
