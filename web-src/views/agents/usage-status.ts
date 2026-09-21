// 最下段の左端の、アカウントごとの使用量。
//
//   ◇ claude  42% · resets 1h58m   ◇ codex  91% High
//
// 値はアカウントの一覧 (accounts-client) をそのまま使う。1 アカウント 1 つの
// 塊で、出すのは最初の枠 (5 時間枠があればそれ) だけ。ほかの枠と「いつの値か」
// はツールチップに書く (古い値を今の値のように見せない)。80% 以上は「注意」の
// 文字と琥珀色 (色だけに頼らない)。使用量と作業の状態は別の情報なので、状態の
// 印は付けない。押すと設定のアカウントの節へ移る。
//
// 読めないアカウントは出さない (理由は設定の節と全体ボードの帯に出る)。

import {
  type AccountStatus,
  usageIsStale,
  usageWindowViews,
} from "../../core/agent-accounts";
import type { AccountsClient } from "./accounts-client";
import { accountDisplayName } from "./accounts-dialogs";
import type { AgentsText } from "./i18n";

export type UsageStatusDeps = {
  root: HTMLElement;
  client: AccountsClient;
  getText(): AgentsText;
  openSettings(): void;
};

export function mountUsageStatus(deps: UsageStatusDeps): {
  localize(): void;
} {
  const { root } = deps;
  let lastSignature = "";

  function item(account: AccountStatus, now: number): HTMLElement | null {
    if (account.usage.status !== "ok") return null;
    const text = deps.getText();
    const t = text.accounts;
    const [first] = usageWindowViews(account.usage, now);
    if (!first) return null;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "usage-status-item";
    button.classList.toggle("warn", first.warn);
    const kind = document.createElement("span");
    kind.className = "usage-status-kind";
    kind.textContent = account.builtin
      ? account.agent
      : `${account.agent} · ${accountDisplayName(account, t)}`;
    const value = document.createElement("span");
    value.className = "usage-status-value";
    value.textContent = `${Math.round(first.window.usedPercent)}%`;
    button.append(kind, value);
    if (first.warn) {
      const warn = document.createElement("span");
      warn.className = "usage-status-warn";
      warn.textContent = t.warn;
      button.appendChild(warn);
    } else if (!first.expired && first.window.resetsAt > 0) {
      const reset = document.createElement("span");
      reset.className = "usage-status-reset";
      reset.textContent = t.resetsIn(t.duration(first.window.resetsAt - now));
      button.appendChild(reset);
    }
    const observedAt = account.usage.observedAt;
    const stale = usageIsStale(observedAt, now);
    button.classList.toggle("stale", stale);
    const lines = [
      `${account.agent} · ${accountDisplayName(account, t)}`,
      ...usageWindowViews(account.usage, now).map((view) =>
        [
          t.window(view.window),
          view.warn ? t.warn : "",
          view.expired
            ? t.resetPassed
            : view.window.resetsAt > 0
              ? t.resetsIn(t.duration(view.window.resetsAt - now))
              : "",
        ]
          .filter(Boolean)
          .join(" · "),
      ),
      observedAt > 0
        ? [
            stale
              ? t.observedStale(t.duration(now - observedAt))
              : now - observedAt < 60_000
                ? t.observedJustNow
                : t.observed(t.duration(now - observedAt)),
            t.observedTitle(new Date(observedAt).toLocaleString()),
          ].join(" · ")
        : "",
    ].filter(Boolean);
    button.title = text.sidebar.usageTitle(lines);
    button.setAttribute("aria-label", lines.join(", "));
    button.addEventListener("click", () => deps.openSettings());
    return button;
  }

  function render(force = false): void {
    const { data } = deps.client.snapshot();
    const now = Date.now();
    const next = JSON.stringify([
      deps.getText().sidebar.usageLabel,
      data?.accounts.map((account) => [
        account.id,
        account.name,
        account.usage,
      ]),
      // リセットまでの時間は分単位で変わる。
      Math.floor(now / 60_000),
    ]);
    if (!force && next === lastSignature) return;
    lastSignature = next;
    root.setAttribute("aria-label", deps.getText().sidebar.usageLabel);
    root.replaceChildren(
      ...(data?.accounts ?? [])
        .map((account) => item(account, now))
        .filter((node): node is HTMLElement => node !== null),
    );
  }

  deps.client.subscribe(() => render());
  // 取り直しが無い間も、リセットまでの時間は進む。
  window.setInterval(() => render(), 60_000);
  render(true);
  return { localize: () => render(true) };
}
