// エージェント一覧の上に出す「アカウントの帯」。アカウント 1 つが 1 枚の
// カード (4 列): 種類・表示名・5 時間枠と週枠のバー・いつの値か・そのアカウント
// で動いているエージェントの数。ログインの状態とフックの状態はツールチップ。
//
//   Accounts 4 ▾                                                  Manage
//   ┌ claude       Default ┐ ┌ codex        Personal ┐
//   │ 5h    42%   ▰▰▱▱▱▱   │ │ Not signed in          │
//   │ week  81% High ▰▰▰▰▱ │ │ [Sign in]              │
//   │ as of 15m ago  1 run │ │ Checked just now       │
//
// 何も登録していない (既定だけ) で使用量も取れていないときは、帯を出さずに
// 「アカウントと使用量」への 1 行の入口だけにする (押し付けがましくしない)。
// 80% 以上は注意の色と「注意」の文字の両方で示す。値には必ず「いつの値か」
// を添え、古い値・リセット済みの値を今の値のように見せない。

import {
  type AccountStatus,
  type AccountsResponse,
  showPaneAccounts,
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
import {
  usageMeterRow,
  usageMixedText,
  usageObservedText,
} from "./usage-meter";

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

  /** ログインの状態の説明 (ツールチップと、ログイン済み以外の行)。 */
  function loginLines(account: AccountStatus): string[] {
    const t = text();
    const state = account.login.state;
    const who =
      state === "logged-in"
        ? t.loginWho(account.login.who, account.login.method)
        : account.login.detail;
    return [
      t.login[state],
      who,
      state === "logged-in" && !account.login.who ? t.loginUnknownWho : "",
    ].filter(Boolean);
  }

  function usageBlock(account: AccountStatus, now: number): HTMLElement {
    const t = text();
    const box = el("div", "agents-account-usage");
    const state = account.login.state;
    if (state === "logged-out") {
      // 未ログインには値を作らない (0% や空のバーで代用しない)。
      box.appendChild(el("span", "agents-account-status", t.login[state]));
      const login = el(
        "button",
        "agents-secondary agents-account-login-button",
        t.loginButton,
      );
      login.type = "button";
      login.title = t.loginTitle(accountDisplayName(account, t));
      login.disabled = busy;
      login.addEventListener(
        "click",
        () => void run(() => deps.dialogs.login(account)),
      );
      box.appendChild(login);
      return box;
    }
    if (state !== "logged-in") {
      const line = el(
        "span",
        `agents-account-status agents-account-login-${state}`,
        t.login[state],
      );
      line.title = loginLines(account).join("\n");
      box.appendChild(line);
    }
    const usage = account.usage;
    if (usage.status !== "ok") {
      const line = el("span", "agents-account-status", t.usageUnavailable);
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
      box.appendChild(usageMeterRow(view, now, t, { showReset: false }));
    }
    const mixed = usageMixedText(usage, now, t);
    if (mixed) {
      const note = el(
        "span",
        "agents-account-status agents-account-mixed",
        t.usageMixed,
      );
      note.title = mixed;
      box.appendChild(note);
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
    head.appendChild(el("span", "agents-account-kind", account.agent));
    const name = el(
      "button",
      "agents-account-name",
      accountDisplayName(account, t),
    );
    name.type = "button";
    name.title = [
      abbreviateHome(account.configDir, data.home),
      ...loginLines(account),
      t.hooksShort(deps.hookStateLabel(account.hooks)),
      t.bandManage,
    ].join("\n");
    name.addEventListener("click", () => deps.openSettings());
    head.appendChild(name);
    box.append(head, usageBlock(account, now));

    const foot = el("div", "agents-account-foot");
    const observed = usageObservedText(account.usage, account.login, now, t);
    const when = el(
      "span",
      `agents-account-observed${observed.stale ? " stale" : ""}`,
      observed.text,
    );
    if (observed.title) when.title = observed.title;
    const running = el(
      "span",
      "agents-account-running",
      t.agentsCount(runningCount(deps.getOverview(), account)),
    );
    running.title = t.hooksShort(deps.hookStateLabel(account.hooks));
    foot.append(when, running);
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
        el("span", "agents-account-kind", info.agent),
        el("span", "agents-account-name", t.unregistered),
      );
      const register = el("button", "agents-secondary", t.registerUnregistered);
      register.type = "button";
      register.title = t.registerUnregisteredTitle(path);
      register.disabled = busy;
      register.addEventListener(
        "click",
        () => void run(() => deps.dialogs.add({ agent: info.agent, path })),
      );
      const where = el("div", "agents-account-usage");
      where.appendChild(
        el(
          "span",
          "agents-account-path terminal-mono",
          abbreviateHome(path, home),
        ),
      );
      where.title = path;
      where.appendChild(register);
      const foot = el("div", "agents-account-foot");
      foot.append(
        el("span", "agents-account-observed"),
        el("span", "agents-account-running", t.agentsCount(info.count)),
      );
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
    const toggle = el("button", "agents-section-title agents-accounts-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.title = t.bandToggle(collapsed);
    const twisty = el("span", "terminal-tree-twisty agents-project-twisty");
    twisty.classList.toggle("collapsed", collapsed);
    twisty.innerHTML = iconSvg("octicon-chevron-down", CHEVRON_DOWN_16_PATH);
    twisty.setAttribute("aria-hidden", "true");
    const count = data ? data.accounts.length + unregistered.length : 0;
    toggle.append(
      el("span", "", t.bandTitle),
      el("span", "agents-chip", String(count)),
      twisty,
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
    const manage = el("button", "agents-text-action", t.bandManage);
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
