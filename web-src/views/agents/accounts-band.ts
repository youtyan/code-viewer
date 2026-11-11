// エージェント一覧の上に出す「アカウントの帯」。アカウント 1 つが 1 枚の
// カード: 種類・利用者が付けた名前・プラン・ログイン中のメールアドレス・
// 5 時間枠と週枠 (棒・割合・戻る時刻)・いつの値か・そのアカウントで動いている
// エージェントの数。フックの状態と設定ディレクトリは名前のツールチップ。
//
//   Accounts 4 ▾                                                  Manage
//   ┌ Claude  work           Max  ⋯ ┐ ┌ Codex  Default              ┐
//   │ user@example.com                │ │ Not signed in               │
//   │ 5h    ▰▰▱▱▱▱   16%  resets 06:10│ │ [Sign in]                   │
//   │ week  ▰▱▱▱▱▱    3%  resets Thu …│ │                             │
//   │ as of 3m ago             0 run  │ │ Checked just now    0 run   │
//
// claude のカードは、値が無い・古いとき「使用量を確かめる」を出す (部品は
// usage-check.ts。設定の使用量の行と同じ)。⋯ のメニューにも同じ項目を置く。
// 何も登録していない (既定だけ) で使用量も取れていないときは、帯を出さずに
// 「アカウントと使用量」への 1 行の入口だけにする (押し付けがましくしない)。
// 80% 以上は注意の色と「注意」の文字の両方で示す。値には必ず「いつの値か」
// を添え、古い値・リセット済みの値を今の値のように見せない。

import { html, nothing, type TemplateResult } from "lit/html.js";
import { ifDefined } from "lit/directives/if-defined.js";
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
import { formatErrorDetail } from "../../core/error-detail";
import { CHEVRON_DOWN_16_PATH, KEBAB_16_PATH } from "../../core/icons";
import { showContextMenu } from "../context-menu";
import { iconTemplate } from "../ui/icon";
import { renderOwned, templateElement } from "../ui/renderer";
import { accountTagListTemplate } from "./account-tags";
import type { AccountsClient } from "./accounts-client";
import {
  type AccountDialogs,
  accountDisplayName,
  planLabel,
  resultLineTemplate,
  runningCount,
} from "./accounts-dialogs";
import type { AccountsText } from "./accounts-i18n";
import { usageCheckBlock, usageCheckMenuItem } from "./usage-check";
import {
  usageMeterTemplate,
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
  /** 設定のアカウントの起動コマンドの欄へ移り、焦点を当てる。 */
  openLaunchCommands(): void;
  /** 今の時刻 (テストで差し替える)。 */
  now?(): number;
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
  // 帯の箱。全体ボードが一覧の上に置き、中はここが描く。
  const element = templateElement(
    html`<section class="agents-accounts"></section>`,
  );
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
        text: formatErrorDetail(error),
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

  /**
   * 2 行目: ログイン中のメールアドレス。無ければログインの状態を短く書く
   * (全文はツールチップ)。
   */
  function whoLine(account: AccountStatus): TemplateResult {
    const t = text();
    const login = account.login;
    const signedIn = login.state === "logged-in";
    return html`<span
      class=${`agents-account-who${signedIn ? "" : ` agents-account-login-${login.state}`}`}
      title=${loginLines(account).join("\n")}
    >${signedIn ? login.who || t.cardNoEmail : t.login[login.state]}</span>`;
  }

  function usageBlock(account: AccountStatus, now: number): TemplateResult {
    const t = text();
    const state = account.login.state;
    if (
      state === "logged-out" ||
      (state === "no-config-dir" && account.builtin)
    ) {
      // 未ログインには値を作らない (0% や空のバーで代用しない)。状態は 2 行目。
      return html`<div class="agents-account-usage"><button
        type="button"
        class="agents-secondary agents-account-login-button"
        title=${t.loginTitle(accountDisplayName(account, t))}
        ?disabled=${busy}
        @click=${() => void run(() => deps.dialogs.login(account))}
      >${t.loginButton}</button></div>`;
    }
    const usage = account.usage;
    if (usage.status !== "ok") {
      const why = [t.usageReason[usage.reason], usage.detail]
        .filter(Boolean)
        .join("\n");
      // 包んでいない: その場で statusLine の確認の画面 (差分つき) を開く。
      // 有効にしたら一覧を読み直すので、カードは値を待つ形に替わる。
      const status = account.statusLine;
      const enable =
        usage.reason === "not-wrapped" &&
        status &&
        status.state !== "unreadable" &&
        status.state !== "no-config-dir";
      // カードには短い理由だけ。全文 (と読めなかった詳細) はツールチップ。
      return html`<div class="agents-account-usage"><span
          class="agents-account-status"
          title=${why}
        >${t.usageUnavailable}</span><span class="agents-account-usage-why" title=${why}
          >${t.usageReasonShort[usage.reason]}</span
        >${
          enable
            ? html`<button
                type="button"
                class="agents-secondary agents-account-enable-usage"
                title=${t.statusLineDialogTitle("install")}
                ?disabled=${busy}
                @click=${() =>
                  void run(() => deps.dialogs.statusLine(account, "install"))}
              >${t.usageEnable}</button>`
            : nothing
        }</div>`;
    }
    const mixed = usageMixedText(usage, now, t);
    return html`<div class="agents-account-usage">${usageWindowViews(
      usage,
      now,
    ).map((view) => usageMeterTemplate(view, now, t, { reset: "clock" }))}${
      mixed
        ? html`<span class="agents-account-status agents-account-mixed" title=${mixed}
            >${t.usageMixed}</span
          >`
        : nothing
    }</div>`;
  }

  function openMenu(account: AccountStatus, menu: HTMLElement): void {
    const t = text();
    const check = usageCheckMenuItem(account, deps.client, t);
    showContextMenu(menu, [
      ...(check ? [check] : []),
      ...(account.builtin
        ? []
        : [
            {
              label: `${t.rename}…`,
              title: t.renameTitle(account.name),
              onSelect: () => void run(() => deps.dialogs.rename(account)),
            },
            {
              label: `${t.remove}…`,
              title: t.removeTitle(account.name),
              danger: true,
              onSelect: () => void run(() => deps.dialogs.remove(account)),
            },
          ]),
    ]);
  }

  function card(
    account: AccountStatus,
    data: AccountsResponse,
    now: number,
  ): TemplateResult {
    const t = text();
    const warn =
      account.usage.status === "ok" &&
      usageWindowViews(account.usage, now).some((view) => view.warn);
    const plan = planLabel(account.login.plan);
    const observed = usageObservedText(account.usage, account.login, now, t);
    const menuTitle = t.bandMenu(accountDisplayName(account, t));
    // 1 行目: 種類・利用者が付けた名前 (既定は「既定」)・プラン・⋯。
    // ⋯: claude なら使用量を確かめる。登録したアカウントなら名前の変更・
    // 外す (既定のアカウントは変えられない)。どちらも無ければ出さない。
    return html`<div
      class=${warn ? "agents-account-card warn" : "agents-account-card"}
      data-account=${account.id}
      data-agent=${account.agent}
    ><div class="agents-account-card-head"><span class="agents-account-kind">${account.agent}</span><button
      type="button"
      class="agents-account-name"
      title=${[
        abbreviateHome(account.configDir, data.home),
        ...loginLines(account),
        t.hooksShort(deps.hookStateLabel(account.hooks)),
        t.bandManage,
      ].join("\n")}
      @click=${() => deps.openSettings()}
    >${accountDisplayName(account, t)}</button>${accountTagListTemplate(account.tags)}<span
      class="agents-spacer"
    ></span>${
      account.login.state === "logged-in" && plan
        ? html`<span class="agents-account-plan">${plan}</span>`
        : nothing
    }${
      account.agent === "claude" || !account.builtin
        ? html`<button
            type="button"
            class="agents-icon-action agents-account-menu"
            title=${menuTitle}
            aria-label=${menuTitle}
            aria-haspopup="menu"
            ?disabled=${busy}
            @click=${(event: MouseEvent) => {
              // 文書全体の click で閉じる処理に、開いたばかりのメニューを閉じさせない
              // (全体ボードのプロジェクトの ⋯ と同じ)。
              event.stopPropagation();
              openMenu(account, event.currentTarget as HTMLElement);
            }}
          >${iconTemplate(KEBAB_16_PATH, "octicon-kebab-horizontal")}</button>`
        : nothing
    }</div>${whoLine(account)}${usageBlock(account, now)}${
      usageCheckBlock(account, now, deps.client, t, {
        ...deps.dialogs,
        openLaunchCommands: deps.openLaunchCommands,
      }) ?? nothing
    }<div class="agents-account-foot"><span
      class=${`agents-account-observed${observed.stale ? " stale" : ""}`}
      title=${ifDefined(observed.title || undefined)}
    >${observed.text}</span><span
      class="agents-account-running"
      title=${t.hooksShort(deps.hookStateLabel(account.hooks))}
    >${t.agentsCount(runningCount(deps.getOverview(), account))}</span></div></div>`;
  }

  /** 登録簿に無い設定ディレクトリで動いているもの。登録の入口を出す。 */
  function unregisteredCards(): TemplateResult[] {
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
      return html`<div
        class="agents-account-card agents-account-card-unregistered"
        data-agent=${info.agent}
      ><div class="agents-account-card-head"><span class="agents-account-kind">${info.agent}</span><span
        class="agents-account-name"
      >${t.unregistered}</span></div><div class="agents-account-usage" title=${path}><span
        class="agents-account-path terminal-mono"
      >${abbreviateHome(path, home)}</span><button
        type="button"
        class="agents-secondary"
        title=${t.registerUnregisteredTitle(path)}
        ?disabled=${busy}
        @click=${() =>
          void run(() => deps.dialogs.add({ agent: info.agent, path }))}
      >${t.registerUnregistered}</button></div><div class="agents-account-foot"><span
        class="agents-account-observed"
      ></span><span class="agents-account-running">${t.agentsCount(info.count)}</span></div></div>`;
    });
  }

  function problemTemplate(error: string): TemplateResult {
    const title = `${text().bandLoadFailed}\n${error}`;
    return html`<span class="agents-server-problem" title=${title} aria-label=${title}>!</span>`;
  }

  function bandTemplate(): TemplateResult {
    const t = text();
    const { data, error } = deps.client.snapshot();
    const now = (deps.now ?? Date.now)();
    const unregistered = unregisteredCards();
    const visible = accountsBandVisible(data) || unregistered.length > 0;
    if (!visible)
      // 入口の 1 行だけ。読めなかったときは理由を添える (黙って消さない)。
      return html`<button
          type="button"
          class="agents-accounts-entry"
          title=${t.bandEntryTitle}
          @click=${() => deps.openSettings()}
        >${t.bandEntry}</button>${error ? problemTemplate(error) : nothing}`;
    const collapsed = deps.isCollapsed();
    const count = data ? data.accounts.length + unregistered.length : 0;
    const refreshing =
      data?.accounts.some(
        (account) => deps.client.usageCheck(account.id)?.running,
      ) === true;
    return html`<div class="agents-accounts-head"><button
        type="button"
        class="agents-section-title agents-accounts-toggle"
        aria-expanded=${String(!collapsed)}
        title=${t.bandToggle(collapsed)}
        @click=${() => deps.setCollapsed(!collapsed)}
      ><span class="">${t.bandTitle}</span><span class="agents-chip">${count}</span><span
        class=${collapsed ? "terminal-tree-twisty agents-project-twisty collapsed" : "terminal-tree-twisty agents-project-twisty"}
        aria-hidden="true"
      >${iconTemplate(CHEVRON_DOWN_16_PATH, "octicon-chevron-down")}</span></button>${
        error ? problemTemplate(error) : nothing
      }<span class="agents-spacer"></span><button
        type="button"
        class="agents-text-action agents-usage-refresh"
        title=${t.usageRefreshAuto}
        ?disabled=${refreshing || !data}
        @click=${() => void deps.client.checkAllUsage()}
      >${refreshing ? t.usageChecking : t.usageRefreshAll}</button><button
        type="button"
        class="agents-text-action"
        @click=${() => deps.openSettings()}
      >${t.bandManage}</button></div>${
        !collapsed && data
          ? html`<div class="agents-accounts-cards">${data.accounts.map(
              (account) => card(account, data, now),
            )}${unregistered}</div>`
          : nothing
      }${message ? resultLineTemplate(message) : nothing}`;
  }

  function render(): void {
    const { data } = deps.client.snapshot();
    const visible = accountsBandVisible(data) || unregisteredCards().length > 0;
    element.classList.toggle("entry", !visible);
    renderOwned(element, bandTemplate());
  }

  return {
    element,
    render,
    signature() {
      const { data, error } = deps.client.snapshot();
      return JSON.stringify([
        data,
        error,
        (data?.accounts ?? []).map((account) =>
          deps.client.usageCheck(account.id),
        ),
        message,
        busy,
        deps.isCollapsed(),
        showPaneAccounts(0, deps.getOverview()?.panes ?? []),
        (deps.getOverview()?.panes ?? []).map((pane) => pane.account),
      ]);
    },
  };
}
