// ヘッダ右側の件数表示「入力待ち n  作業中 n」。どの画面にいても見える。
//
// 入力待ちが 1 件以上のときだけ注意の色にする。0 件のときは目立たせない
// (いつも騒がしい表示は誰も見なくなる)。数字の桁は固定幅で持たせ、件数が
// 変わってもボタンの大きさと位置が動かないようにする。
//
// 押すとエージェント一覧へ。入力待ちが 1 件だけなら、そのペインを直接開く。

import { headerAgentCounts } from "../../core/agent-overview";
import type { AgentMonitor } from "./agent-monitor";
import type { AgentsText } from "./i18n";

export type AgentStatusDeps = {
  monitor: AgentMonitor;
  getText(): AgentsText;
  openList(): void;
  openPane(pane: string): void;
};

function item(state: "waiting" | "working"): {
  el: HTMLElement;
  label: HTMLElement;
  count: HTMLElement;
} {
  const el = document.createElement("span");
  el.className = `agent-status-item agent-status-${state}`;
  const mark = document.createElement("i");
  mark.className = `terminal-mark terminal-mark-${state}`;
  mark.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.className = "agent-status-label";
  const count = document.createElement("span");
  count.className = "agent-status-count";
  el.append(mark, label, count);
  return { el, label, count };
}

export function mountAgentStatus(
  button: HTMLButtonElement,
  deps: AgentStatusDeps,
): { localize(): void } {
  const waiting = item("waiting");
  const working = item("working");
  button.replaceChildren(waiting.el, working.el);

  function render(): void {
    const text = deps.getText();
    const { overview, error } = deps.monitor.snapshot();
    const panes = overview?.panes ?? [];
    const counts = headerAgentCounts(panes);
    waiting.label.textContent = text.headerWaiting;
    working.label.textContent = text.headerWorking;
    // 取れていないときは数えられない。0 と出すと「誰も待っていない」と読める。
    waiting.count.textContent = overview ? String(counts.waiting) : "–";
    working.count.textContent = overview ? String(counts.working) : "–";
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
