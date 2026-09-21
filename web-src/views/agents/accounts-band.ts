// エージェント一覧の上に出す「アカウントの帯」。アカウント 1 つが 1 枚の
// 小さなカード: 種類・表示名・ログインの状態・5 時間枠と週枠の % と
// リセットまでの時間・いつの値か・そのアカウントで動いているエージェントの
// 数・フックの状態。
//
//   ▾ アカウント 4                                                   管理
//   ┌ claude 既定 ● ログイン済み ┐ ┌ claude 仕事用 ○ 未ログイン [ログイン] ┐
//   │ 5時間 42% あと2時間13分    │ │ 使用量を取得できません ⓘ            │
//   │ 週 81% 注意                │ │                                     │
//   │ 3分前の値 · 2 件実行中 · …  │ │ 0 件実行中 · フック: 未設定          │
//
// 何も登録していない (既定だけ) で使用量も取れていないときは、帯を出さずに
// 「アカウントと使用量」への 1 行の入口だけにする (押し付けがましくしない)。
// 80% 以上は注意の色と「注意」の文字の両方で示す。値には必ず「いつの値か」
// を添え、古い値・リセット済みの値を今の値のように見せない。

import {
  type AccountStatus,
  type AccountsResponse,
  showPaneAccounts,
  usageIsStale,
  usageWindowViews,
} from "../../core/agent-accounts";
import type { AgentHookState } from "../../core/agent-hooks";
import {
  type AgentOverviewResponse,
  abbreviateHome,
} from "../../core/agent-overview";
import { CHEVRON_DOWN_16_PATH, iconSvg } from "../../core/icons";
import type { AccountsClient } from "./accounts-client";
import {
  type AccountDialogs,
  accountDisplayName,
  el,
  resultLine,
  runningCount,
} from "./accounts-dialogs";
import type { AccountsText } from "./accounts-i18n";

export type AccountsBandDeps = {
  client: AccountsClient;
  dialogs: AccountDialogs;
  getText(): AccountsText;
  hookStateLabel(state: AgentHookState): string;
  getOverview(): AgentOverviewResponse | null;
  isCollapsed(): boolean;
  setCollapsed(collapsed: boolean): void;
  /** 設定画面のアカウントの節へ。 */
  openSettings(): void;
  /** 描き直しを頼む (結果の文を出した後など)。 */
  requestRender(): void;
};

export type AccountsBand = {
  element: HTMLElement;
  render(): void;
  /** 描き直しの要否を決める文字列。 */
  signature(): string;
};

/** 帯を出すか。登録アカウントがあるか、使用量が 1 つでも取れているとき。 */
export function accountsBandVisible(data: AccountsResponse | null): boolean {
  if (!data) return false;
  if (data.accounts.some((account) => !account.builtin)) return true;
  return data.accounts.some((account) => account.usage.status === "ok");
}

export function createAccountsBand(deps: AccountsBandDeps): AccountsBand {
  const element = el("section", "agents-accounts");
  let message: { ok: boolean; text: string } | null = null;
  let busy = false;

  function text(): AccountsText {
    return deps.getText();
  }

  async function run(action: () => Promise<string | null>): Promise<void> {
    if (busy) return;
    busy = true;
    message = null;
    deps.requestRender();
    try {
      const result = await action();
      if (result) message = { ok: true, text: result };
    } catch (error) {
      console.error("[code-viewer] account action failed", error);
      message = {
        ok: false,
        text: error instanceof Error ? error.message : String(error),
      };
    } finally {
      busy = false;
      deps.requestRender();
    }
  }

  function loginLabel(account: AccountStatus): HTMLElement {
    const t = text();
    const state = account.login.state;
    const label = el(
      "span",
      `agents-account-login agents-account-login-${state}`,
    );
    const mark = el("i", "agent-hooks-mark");
    mark.setAttribute("aria-hidden", "true");
    label.append(mark, t.login[state]);
    const who =
      state === "logged-in"
        ? t.loginWho(account.login.who, account.login.method)
        : account.login.detail;
    label.title = [
      t.login[state],
      who,
      state === "logged-in" && !account.login.who ? t.loginUnknownWho : "",
    ]
      .filter(Boolean)
      .join("\n");
    return label;
  }

  function usageBlock(account: AccountStatus, now: number): HTMLElement {
    const t = text();
    const box = el("div", "agents-account-usage");
    const usage = account.usage;
    if (usage.status !== "ok") {
      const line = el("span", "agents-account-usage-none", t.usageUnavailable);
      line.title = [t.usageReason[usage.reason], usage.detail]
        .filter(Boolean)
        .join("\n");
      // カードには短い理由だけ。全文 (と読めなかった詳細) はツールチップ。
      const why = el(
        "span",
        "agents-account-usage-why",
        t.usageReasonShort[usage.reason],
      );
      why.title = line.title;
      box.append(line, why);
      return box;
    }
    for (const view of usageWindowViews(usage, now)) {
      const row = el("span", "agents-account-window");
      row.classList.toggle("warn", view.warn);
      row.classList.toggle("expired", view.expired);
      const value = el(
        "span",
        "agents-account-window-value",
        t.window(view.window),
      );
      row.appendChild(value);
      if (view.warn) row.appendChild(el("span", "agents-account-warn", t.warn));
      const reset = view.expired
        ? t.resetPassed
        : view.window.resetsAt > 0
          ? t.resetsIn(t.duration(view.window.resetsAt - now))
          : "";
      if (reset) row.appendChild(el("span", "agents-account-reset", reset));
      if (view.window.resetsAt > 0) {
        row.title = new Date(view.window.resetsAt).toLocaleString();
      }
      box.appendChild(row);
    }
    return box;
  }

  function card(account: AccountStatus, data: AccountsResponse, now: number) {
    const t = text();
    const box = el("div", "agents-account-card");
    box.dataset.account = account.id;
    const warn =
      account.usage.status === "ok" &&
      usageWindowViews(account.usage, now).some((view) => view.warn);
    box.classList.toggle("warn", warn);

    const head = el("div", "agents-account-card-head");
    head.append(
      el("span", `agents-kind agents-kind-${account.agent}`, account.agent),
    );
    const name = el(
      "button",
      "agents-account-name",
      accountDisplayName(account, t),
    );
    name.type = "button";
    name.title = `${abbreviateHome(account.configDir, data.home)}\n${t.bandManage}`;
    name.addEventListener("click", () => deps.openSettings());
    head.append(name, loginLabel(account));
    if (account.login.state === "logged-out") {
      const login = el(
        "button",
        "gdp-btn gdp-btn-sm agents-account-login-button",
        t.loginButton,
      );
      login.type = "button";
      login.title = t.loginTitle(accountDisplayName(account, t));
      login.disabled = busy;
      login.addEventListener(
        "click",
        () => void run(() => deps.dialogs.login(account)),
      );
      head.appendChild(login);
    }
    box.append(head, usageBlock(account, now));

    const foot = el("div", "agents-account-foot");
    const parts: HTMLElement[] = [];
    const observedAt = account.usage.observedAt;
    if (observedAt > 0) {
      const ago = t.duration(now - observedAt);
      const stale = usageIsStale(observedAt, now);
      const when = el(
        "span",
        `agents-account-observed${stale ? " stale" : ""}`,
        stale
          ? t.observedStale(ago)
          : now - observedAt < 60_000
            ? t.observedJustNow
            : t.observed(ago),
      );
      when.title = t.observedTitle(new Date(observedAt).toLocaleString());
      parts.push(when);
    }
    parts.push(
      el("span", "", t.agentsCount(runningCount(deps.getOverview(), account))),
    );
    parts.push(
      el("span", "", t.hooksShort(deps.hookStateLabel(account.hooks))),
    );
    for (const [index, part] of parts.entries()) {
      if (index > 0) foot.appendChild(el("span", "agents-account-sep", "·"));
      foot.appendChild(part);
    }
    box.appendChild(foot);
    return box;
  }

  /** 登録簿に無い設定ディレクトリで動いているもの。登録の入口を出す。 */
  function unregisteredCards(): HTMLElement[] {
    const t = text();
    const seen = new Map<
      string,
      { agent: "claude" | "codex"; count: number }
    >();
    for (const pane of deps.getOverview()?.panes ?? []) {
      if (pane.account?.kind !== "unregistered") continue;
      if (pane.kind !== "claude" && pane.kind !== "codex") continue;
      const key = `${pane.kind}\n${pane.account.configDir}`;
      const hit = seen.get(key) ?? { agent: pane.kind, count: 0 };
      hit.count += 1;
      seen.set(key, hit);
    }
    const home = deps.client.snapshot().data?.home ?? "";
    return [...seen].map(([key, info]) => {
      const path = key.slice(key.indexOf("\n") + 1);
      const box = el(
        "div",
        "agents-account-card agents-account-card-unregistered",
      );
      const head = el("div", "agents-account-card-head");
      head.append(
        el("span", `agents-kind agents-kind-${info.agent}`, info.agent),
        el("span", "agents-account-name", t.unregistered),
      );
      const register = el(
        "button",
        "gdp-btn gdp-btn-sm",
        t.registerUnregistered,
      );
      register.type = "button";
      register.title = t.registerUnregisteredTitle(path);
      register.disabled = busy;
      register.addEventListener(
        "click",
        () => void run(() => deps.dialogs.add({ agent: info.agent, path })),
      );
      head.appendChild(register);
      const where = el(
        "div",
        "agents-account-usage terminal-mono",
        abbreviateHome(path, home),
      );
      where.title = path;
      const foot = el("div", "agents-account-foot", t.agentsCount(info.count));
      box.append(head, where, foot);
      return box;
    });
  }

  function render(): void {
    const t = text();
    const { data, error } = deps.client.snapshot();
    const now = Date.now();
    element.replaceChildren();
    const unregistered = unregisteredCards();
    const visible = accountsBandVisible(data) || unregistered.length > 0;
    element.classList.toggle("entry", !visible);
    if (!visible) {
      // 入口の 1 行だけ。読めなかったときは理由を添える (黙って消さない)。
      const entry = el("button", "agents-accounts-entry", t.bandEntry);
      entry.type = "button";
      entry.title = t.bandEntryTitle;
      entry.addEventListener("click", () => deps.openSettings());
      element.appendChild(entry);
      if (error) {
        const problem = el("span", "agents-server-problem", "!");
        problem.title = `${t.bandLoadFailed}\n${error}`;
        problem.setAttribute("aria-label", problem.title);
        element.appendChild(problem);
      }
      return;
    }
    const collapsed = deps.isCollapsed();
    const head = el("div", "agents-accounts-head");
    const toggle = el("button", "agents-accounts-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.title = t.bandToggle(collapsed);
    const twisty = el("span", "terminal-tree-twisty");
    twisty.classList.toggle("collapsed", collapsed);
    twisty.innerHTML = iconSvg("octicon-chevron-down", CHEVRON_DOWN_16_PATH);
    twisty.setAttribute("aria-hidden", "true");
    const count = data ? data.accounts.length + unregistered.length : 0;
    toggle.append(
      twisty,
      el("span", "agents-accounts-title", t.bandTitle),
      el("span", "agents-filter-count", String(count)),
    );
    toggle.addEventListener("click", () => deps.setCollapsed(!collapsed));
    head.appendChild(toggle);
    if (error) {
      const problem = el("span", "agents-server-problem", "!");
      problem.title = `${t.bandLoadFailed}\n${error}`;
      problem.setAttribute("aria-label", problem.title);
      head.appendChild(problem);
    }
    head.appendChild(el("span", "agents-spacer"));
    const manage = el("button", "agents-accounts-manage", t.bandManage);
    manage.type = "button";
    manage.addEventListener("click", () => deps.openSettings());
    head.appendChild(manage);
    element.appendChild(head);
    if (!collapsed && data) {
      const cards = el("div", "agents-accounts-cards");
      for (const account of data.accounts) {
        cards.appendChild(card(account, data, now));
      }
      for (const extra of unregistered) cards.appendChild(extra);
      element.appendChild(cards);
    }
    if (message) element.appendChild(resultLine(message));
  }

  return {
    element,
    render,
    signature() {
      const { data, error } = deps.client.snapshot();
      return JSON.stringify([
        data,
        error,
        message,
        busy,
        deps.isCollapsed(),
        showPaneAccounts(0, deps.getOverview()?.panes ?? []),
        (deps.getOverview()?.panes ?? []).map((pane) => pane.account),
      ]);
    },
  };
}
