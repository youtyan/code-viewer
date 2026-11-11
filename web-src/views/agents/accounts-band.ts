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

import { ifDefined } from "lit/directives/if-defined.js";
import { html, nothing, type TemplateResult } from "lit/html.js";
import {
  type AccountStatus,
  type AccountsResponse,
  showPaneAccounts,
  type UsageWindowView,
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
import {
  type UsageCheckProps,
  usageCheckMenuItem,
  usageCheckProps,
  usageCheckTemplate,
} from "./usage-check";
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

type ButtonProps = { label: string; title: string; onClick(): void };

/** カードの使用量の欄: ログインのボタン・取れない理由・棒。 */
export type AccountsBandUsageProps =
  | { kind: "login"; login: ButtonProps }
  | {
      kind: "unavailable";
      label: string;
      short: string;
      why: string;
      enable: ButtonProps | null;
    }
  | {
      kind: "meters";
      windows: UsageWindowView[];
      now: number;
      text: AccountsText;
      mixed: { label: string; title: string } | null;
    };

export type AccountsBandCardProps = {
  id: string;
  agent: string;
  warn: boolean;
  name: { text: string; title: string; onClick(): void };
  tags: AccountStatus["tags"];
  plan: string | null;
  menu: { title: string; onOpen(anchor: HTMLElement): void } | null;
  who: { text: string; title: string; state: string | null };
  usage: AccountsBandUsageProps;
  check: UsageCheckProps | null;
  observed: { text: string; title: string; stale: boolean };
  running: { text: string; title: string };
};

export type AccountsBandUnregisteredProps = {
  agent: string;
  label: string;
  path: { text: string; title: string };
  register: ButtonProps;
  running: string;
};

export type AccountsBandViewProps =
  | {
      kind: "entry";
      entry: ButtonProps;
      /** 読めなかった理由 (無ければ null)。 */
      problem: string | null;
    }
  | {
      kind: "band";
      busy: boolean;
      problem: string | null;
      head: {
        title: string;
        count: number;
        collapsed: boolean;
        toggleTitle: string;
        onToggle(): void;
        refresh: ButtonProps & { disabled: boolean };
        manage: { label: string; onClick(): void };
      };
      cards: AccountsBandCardProps[] | null;
      unregistered: AccountsBandUnregisteredProps[];
      message: { ok: boolean; text: string } | null;
    };

export type AccountsBandView = (props: AccountsBandViewProps) => unknown;

function problemTemplate(title: string): TemplateResult {
  return html`<span class="agents-server-problem" title=${title} aria-label=${title}>!</span>`;
}

function usageTemplate(
  usage: AccountsBandUsageProps,
  busy: boolean,
): TemplateResult {
  if (usage.kind === "login")
    // 未ログインには値を作らない (0% や空のバーで代用しない)。状態は 2 行目。
    return html`<div class="agents-account-usage"><button
      type="button"
      class="agents-secondary agents-account-login-button"
      title=${usage.login.title}
      ?disabled=${busy}
      @click=${usage.login.onClick}
    >${usage.login.label}</button></div>`;
  if (usage.kind === "unavailable")
    // カードには短い理由だけ。全文 (と読めなかった詳細) はツールチップ。
    return html`<div class="agents-account-usage"><span
        class="agents-account-status"
        title=${usage.why}
      >${usage.label}</span><span class="agents-account-usage-why" title=${usage.why}
        >${usage.short}</span
      >${
        usage.enable
          ? html`<button
              type="button"
              class="agents-secondary agents-account-enable-usage"
              title=${usage.enable.title}
              ?disabled=${busy}
              @click=${usage.enable.onClick}
            >${usage.enable.label}</button>`
          : nothing
      }</div>`;
  return html`<div class="agents-account-usage">${usage.windows.map((window) =>
    usageMeterTemplate(window, usage.now, usage.text, { reset: "clock" }),
  )}${
    usage.mixed
      ? html`<span class="agents-account-status agents-account-mixed" title=${usage.mixed.title}
          >${usage.mixed.label}</span
        >`
      : nothing
  }</div>`;
}

function cardTemplate(
  card: AccountsBandCardProps,
  busy: boolean,
): TemplateResult {
  // 1 行目: 種類・利用者が付けた名前 (既定は「既定」)・プラン・⋯。
  return html`<div
    class=${card.warn ? "agents-account-card warn" : "agents-account-card"}
    data-account=${card.id}
    data-agent=${card.agent}
  ><div class="agents-account-card-head"><span class="agents-account-kind">${card.agent}</span><button
    type="button"
    class="agents-account-name"
    title=${card.name.title}
    @click=${card.name.onClick}
  >${card.name.text}</button>${accountTagListTemplate(card.tags)}<span
    class="agents-spacer"
  ></span>${
    card.plan
      ? html`<span class="agents-account-plan">${card.plan}</span>`
      : nothing
  }${
    card.menu
      ? html`<button
          type="button"
          class="agents-icon-action agents-account-menu"
          title=${card.menu.title}
          aria-label=${card.menu.title}
          aria-haspopup="menu"
          ?disabled=${busy}
          @click=${(event: MouseEvent) => {
            // 文書全体の click で閉じる処理に、開いたばかりのメニューを閉じさせない
            // (全体ボードのプロジェクトの ⋯ と同じ)。
            event.stopPropagation();
            card.menu?.onOpen(event.currentTarget as HTMLElement);
          }}
        >${iconTemplate(KEBAB_16_PATH, "octicon-kebab-horizontal")}</button>`
      : nothing
  }</div><span
    class=${`agents-account-who${card.who.state ? ` agents-account-login-${card.who.state}` : ""}`}
    title=${card.who.title}
  >${card.who.text}</span>${usageTemplate(card.usage, busy)}${
    card.check ? usageCheckTemplate(card.check) : nothing
  }<div class="agents-account-foot"><span
    class=${`agents-account-observed${card.observed.stale ? " stale" : ""}`}
    title=${ifDefined(card.observed.title || undefined)}
  >${card.observed.text}</span><span class="agents-account-running" title=${card.running.title}
    >${card.running.text}</span
  ></div></div>`;
}

function unregisteredTemplate(
  card: AccountsBandUnregisteredProps,
  busy: boolean,
): TemplateResult {
  return html`<div
    class="agents-account-card agents-account-card-unregistered"
    data-agent=${card.agent}
  ><div class="agents-account-card-head"><span class="agents-account-kind">${card.agent}</span><span
    class="agents-account-name"
  >${card.label}</span></div><div class="agents-account-usage" title=${card.path.title}><span
    class="agents-account-path terminal-mono"
  >${card.path.text}</span><button
    type="button"
    class="agents-secondary"
    title=${card.register.title}
    ?disabled=${busy}
    @click=${card.register.onClick}
  >${card.register.label}</button></div><div class="agents-account-foot"><span
    class="agents-account-observed"
  ></span><span class="agents-account-running">${card.running}</span></div></div>`;
}

export const DEFAULT_VIEW: AccountsBandView = (props) => {
  if (props.kind === "entry")
    // 入口の 1 行だけ。読めなかったときは理由を添える (黙って消さない)。
    return html`<button
        type="button"
        class="agents-accounts-entry"
        title=${props.entry.title}
        @click=${props.entry.onClick}
      >${props.entry.label}</button>${
        props.problem ? problemTemplate(props.problem) : nothing
      }`;
  const head = props.head;
  return html`<div class="agents-accounts-head"><button
      type="button"
      class="agents-section-title agents-accounts-toggle"
      aria-expanded=${String(!head.collapsed)}
      title=${head.toggleTitle}
      @click=${head.onToggle}
    ><span class="">${head.title}</span><span class="agents-chip">${head.count}</span><span
      class=${head.collapsed ? "terminal-tree-twisty agents-project-twisty collapsed" : "terminal-tree-twisty agents-project-twisty"}
      aria-hidden="true"
    >${iconTemplate(CHEVRON_DOWN_16_PATH, "octicon-chevron-down")}</span></button>${
      props.problem ? problemTemplate(props.problem) : nothing
    }<span class="agents-spacer"></span><button
      type="button"
      class="agents-text-action agents-usage-refresh"
      title=${head.refresh.title}
      ?disabled=${head.refresh.disabled}
      @click=${head.refresh.onClick}
    >${head.refresh.label}</button><button
      type="button"
      class="agents-text-action"
      @click=${head.manage.onClick}
    >${head.manage.label}</button></div>${
      props.cards
        ? html`<div class="agents-accounts-cards">${props.cards.map((card) =>
            cardTemplate(card, props.busy),
          )}${props.unregistered.map((card) =>
            unregisteredTemplate(card, props.busy),
          )}</div>`
        : nothing
    }${props.message ? resultLineTemplate(props.message) : nothing}`;
};

export function createAccountsBand(
  deps: AccountsBandDeps,
  view: AccountsBandView = DEFAULT_VIEW,
): AccountsBand {
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

  function usageProps(
    account: AccountStatus,
    now: number,
  ): AccountsBandUsageProps {
    const t = text();
    const state = account.login.state;
    if (
      state === "logged-out" ||
      (state === "no-config-dir" && account.builtin)
    )
      return {
        kind: "login",
        login: {
          label: t.loginButton,
          title: t.loginTitle(accountDisplayName(account, t)),
          onClick: () => void run(() => deps.dialogs.login(account)),
        },
      };
    const usage = account.usage;
    if (usage.status !== "ok") {
      // 包んでいない: その場で statusLine の確認の画面 (差分つき) を開く。
      // 有効にしたら一覧を読み直すので、カードは値を待つ形に替わる。
      const status = account.statusLine;
      const enable =
        usage.reason === "not-wrapped" &&
        status &&
        status.state !== "unreadable" &&
        status.state !== "no-config-dir";
      return {
        kind: "unavailable",
        label: t.usageUnavailable,
        short: t.usageReasonShort[usage.reason],
        why: [t.usageReason[usage.reason], usage.detail]
          .filter(Boolean)
          .join("\n"),
        enable: enable
          ? {
              label: t.usageEnable,
              title: t.statusLineDialogTitle("install"),
              onClick: () =>
                void run(() => deps.dialogs.statusLine(account, "install")),
            }
          : null,
      };
    }
    const mixed = usageMixedText(usage, now, t);
    return {
      kind: "meters",
      windows: usageWindowViews(usage, now),
      now,
      text: t,
      mixed: mixed ? { label: t.usageMixed, title: mixed } : null,
    };
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

  function cardProps(
    account: AccountStatus,
    data: AccountsResponse,
    now: number,
  ): AccountsBandCardProps {
    const t = text();
    const plan = planLabel(account.login.plan);
    const observed = usageObservedText(account.usage, account.login, now, t);
    const login = account.login;
    const signedIn = login.state === "logged-in";
    const hooks = t.hooksShort(deps.hookStateLabel(account.hooks));
    return {
      id: account.id,
      agent: account.agent,
      warn:
        account.usage.status === "ok" &&
        usageWindowViews(account.usage, now).some((window) => window.warn),
      name: {
        text: accountDisplayName(account, t),
        title: [
          abbreviateHome(account.configDir, data.home),
          ...loginLines(account),
          hooks,
          t.bandManage,
        ].join("\n"),
        onClick: () => deps.openSettings(),
      },
      tags: account.tags,
      plan: signedIn && plan ? plan : null,
      // ⋯: claude なら使用量を確かめる。登録したアカウントなら名前の変更・
      // 外す (既定のアカウントは変えられない)。どちらも無ければ出さない。
      menu:
        account.agent === "claude" || !account.builtin
          ? {
              title: t.bandMenu(accountDisplayName(account, t)),
              onOpen: (anchor) => openMenu(account, anchor),
            }
          : null,
      // 2 行目: ログイン中のメールアドレス。無ければログインの状態を短く書く
      // (全文はツールチップ)。
      who: {
        text: signedIn ? login.who || t.cardNoEmail : t.login[login.state],
        title: loginLines(account).join("\n"),
        state: signedIn ? null : login.state,
      },
      usage: usageProps(account, now),
      check: usageCheckProps(account, now, deps.client, t, {
        ...deps.dialogs,
        openLaunchCommands: deps.openLaunchCommands,
      }),
      observed,
      running: {
        text: t.agentsCount(runningCount(deps.getOverview(), account)),
        title: hooks,
      },
    };
  }

  /** 登録簿に無い設定ディレクトリで動いているもの。登録の入口を出す。 */
  function unregisteredCards(): AccountsBandUnregisteredProps[] {
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
      return {
        agent: info.agent,
        label: t.unregistered,
        path: { text: abbreviateHome(path, home), title: path },
        register: {
          label: t.registerUnregistered,
          title: t.registerUnregisteredTitle(path),
          onClick: () =>
            void run(() => deps.dialogs.add({ agent: info.agent, path })),
        },
        running: t.agentsCount(info.count),
      };
    });
  }

  function viewProps(): AccountsBandViewProps {
    const t = text();
    const { data, error } = deps.client.snapshot();
    const now = (deps.now ?? Date.now)();
    const unregistered = unregisteredCards();
    const problem = error ? `${t.bandLoadFailed}\n${error}` : null;
    if (!(accountsBandVisible(data) || unregistered.length > 0))
      return {
        kind: "entry",
        entry: {
          label: t.bandEntry,
          title: t.bandEntryTitle,
          onClick: () => deps.openSettings(),
        },
        problem,
      };
    const collapsed = deps.isCollapsed();
    const refreshing =
      data?.accounts.some(
        (account) => deps.client.usageCheck(account.id)?.running,
      ) === true;
    return {
      kind: "band",
      busy,
      problem,
      head: {
        title: t.bandTitle,
        count: data ? data.accounts.length + unregistered.length : 0,
        collapsed,
        toggleTitle: t.bandToggle(collapsed),
        onToggle: () => deps.setCollapsed(!collapsed),
        refresh: {
          label: refreshing ? t.usageChecking : t.usageRefreshAll,
          title: t.usageRefreshAuto,
          disabled: refreshing || !data,
          onClick: () => void deps.client.checkAllUsage(),
        },
        manage: { label: t.bandManage, onClick: () => deps.openSettings() },
      },
      cards:
        !collapsed && data
          ? data.accounts.map((account) => cardProps(account, data, now))
          : null,
      unregistered,
      message,
    };
  }

  function render(): void {
    const props = viewProps();
    element.classList.toggle("entry", props.kind === "entry");
    renderOwned(element, view(props));
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
