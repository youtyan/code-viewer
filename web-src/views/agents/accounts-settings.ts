// 設定画面の「アカウント」の分類の中身。見出しは分類の見出し (help-page) と
// 重ねず、ログイン・使用量・起動コマンドの 3 つの小見出しにする。
//
//   ログイン
//   アカウント     ログイン中のメールアドレス  状態           最後に確かめた時刻
//   claude 既定    a@example.com  Max          ✓ ログイン済み  たった今
//   ~/.claude      [確かめ直す]
//   codex  仕事用  —                          ○ 未ログイン    2分前
//   …/codex-work   [確かめ直す] [ログイン] [名前を変更] [外す]
//   claude 検証用  —                          ? 不明          たった今
//   …/dir          [確かめ直す] [タグ] [名前を変更] [外す]
//   (名前の後ろに付けたタグの札。タグはどのアカウントにも付けられる)
//   確かめられませんでした: claude auth status --json exited with 1: …
//   [アカウントを追加…]
//   使用量
//   claude · 既定  5 時間と週の使用量を受け取っています（最後に受け取った時刻: たった今）  [無効にする…]
//   [使用量を確かめる]（値が無い・古いとき。usage-check.ts）
//   ▸ 仕組み
//   起動コマンド  (未保存)
//   claude [claude    ]  codex [codex    ]  [起動コマンドを既定に戻す]
//
// ログインの状態とメールアドレスはサーバが CLI 自身に訊いたもの
// (server/accounts/login.ts)。画面は推測しない。状態は 3 つだけ出す
// (設定のディレクトリが無いのは未ログインとし、理由を行に書く)。
//
// 起動コマンドの保存はページの「変更を保存」1 つ (draft を viewer-settings に
// 渡す)。節の中に「保存」は置かない。
//
// statusLine の包み込みは設定ファイルごと (リンクで共有しているアカウントは
// 同じファイル) なので、実際に書くファイル (リンク先) ごとに 1 行にする。
// 確認の画面はフックの入れ外しと同じ部品・同じ作法 (書く前に差分を見せ、
// そのときの中身のハッシュを添えて書かせる)。

import { live } from "lit/directives/live.js";
import { html, nothing, type TemplateResult } from "lit/html.js";
import type {
  AccountAgent,
  AccountLogin,
  AccountStatus,
} from "../../core/agent-accounts";
import { HOOK_AGENTS } from "../../core/agent-hooks";
import { abbreviateHome } from "../../core/agent-overview";
import { formatErrorDetail } from "../../core/error-detail";
import { CHECK_16_PATHS } from "../../core/icons";
import { iconTemplate } from "../ui/icon";
import { renderOwned, templateElement } from "../ui/renderer";
import type { SettingsDraft } from "../viewer-settings";
import { accountTagListTemplate } from "./account-tags";
import type { AccountsClient } from "./accounts-client";
import {
  type AccountDialogs,
  accountDisplayName,
  planLabel,
  resultLineTemplate,
} from "./accounts-dialogs";
import type { AccountsText } from "./accounts-i18n";
import type { AgentHooksSettings } from "./agent-hooks-settings";
import {
  type UsageCheckProps,
  usageCheckProps,
  usageCheckTemplate,
} from "./usage-check";

export type AccountsSettingsDeps = {
  client: AccountsClient;
  dialogs: AccountDialogs;
  getText(): AccountsText;
  now?(): number;
};

/** 設定画面の節の形はフックの節と同じ。起動コマンドの下書きを足す。 */
export type AccountsSettings = AgentHooksSettings & { draft: SettingsDraft };

/** 見出しの id。帯の「管理」からここへ飛ぶ。 */
export const ACCOUNTS_SECTION_ID = "agent-accounts-section-title";

/** claude の起動コマンドの欄の id (使用量を確かめるの「起動コマンドを開く」の送り先)。 */
export const CLAUDE_LAUNCH_COMMAND_ID = "agent-accounts-command-claude";

/** 起動コマンドの既定 (登録簿に書かれていないとき)。 */
const DEFAULT_COMMANDS: Record<AccountAgent, string> = {
  claude: "claude",
  codex: "codex",
  opencode: "opencode",
};

type Result = { ok: boolean; text: string };

/** 画面に出す状態は 3 つ。設定のディレクトリが無いのは未ログイン。 */
export function shownLoginState(
  login: Pick<AccountLogin, "state">,
): "in" | "out" | "unknown" {
  if (login.state === "logged-in") return "in";
  if (login.state === "unknown") return "unknown";
  return "out";
}

/** 保存する値。空と既定の名前は「既定」(登録簿から外す) にする。 */
function commandToSave(agent: AccountAgent, value: string): string {
  const trimmed = value.trim();
  return trimmed === DEFAULT_COMMANDS[agent] ? "" : trimmed;
}

type ActionProps = { label: string; title: string; onClick(): void };

/** ログインの表の 1 行。 */
export type AccountsSettingsRowProps = {
  id: string;
  agent: AccountAgent;
  display: string;
  tags: AccountStatus["tags"];
  login: "in" | "out" | "unknown";
  stateLabel: string;
  email: { text: string; title: string; plan: string | null };
  checked: { text: string; title: string | null };
  actions: ActionProps[];
  path: { text: string; title: string };
  reason: { problem: boolean; text: string } | null;
  result: Result | null;
};

/** 使用量の 1 行 (実際に書く設定ファイルごと)。 */
export type AccountsUsageRowProps = {
  tone: "problem" | "on" | "waiting" | "off";
  who: string;
  line: { text: string; title: string | null };
  action: ActionProps | null;
  checks: UsageCheckProps[];
  problems: string | null;
  result: Result | null;
};

export type AccountsSettingsViewProps = {
  title: string;
  intro: string;
  registryError: string | null;
  table: { head: string[]; rows: AccountsSettingsRowProps[] } | null;
  loading: string | null;
  /** 操作の最中 (行のボタンと追加を押させない)。 */
  busy: boolean;
  add: { label: string; onClick(): void };
  sectionMessage: Result | null;
  usage: {
    title: string;
    refresh: {
      label: string;
      title: string;
      disabled: boolean;
      onClick(): void;
    };
    rows: AccountsUsageRowProps[];
    howLabel: string;
    paragraphs: string[];
    facts: string[];
    failures: {
      hidden: boolean;
      summary: string;
      lines: string;
      log: string;
      clearLabel: string;
      onClear(): void;
    };
  };
  commands: {
    title: string;
    unsaved: { label: string; shown: boolean };
    intro: string;
    items: {
      agent: AccountAgent;
      value: string;
      onInput(value: string): void;
    }[];
    reset: { label: string; disabled: boolean; onClick(): void };
  };
  error: string | null;
};

export type AccountsSettingsView = (
  props: AccountsSettingsViewProps,
) => unknown;

function actionButtonTemplate(
  action: ActionProps,
  busy: boolean,
): TemplateResult {
  return html`<button
    type="button"
    class="gdp-btn gdp-btn-sm"
    title=${action.title}
    ?disabled=${busy}
    @click=${action.onClick}
  >${action.label}</button>`;
}

function accountRowTemplate(
  row: AccountsSettingsRowProps,
  busy: boolean,
): TemplateResult {
  return html`<div
    class="agent-accounts-row ui-table-row"
    role="row"
    data-account=${row.id}
    data-login=${row.login}
  ><span class="agent-accounts-name-cell" role="cell"><span class="agent-accounts-kind"
    >${row.agent}</span
  ><span class="agent-accounts-name">${row.display}</span>${accountTagListTemplate(row.tags)}</span
  ><span class="agent-accounts-email" role="cell"><span
    class="agent-accounts-address"
    title=${row.email.title}
  >${row.email.text}</span>${
    row.email.plan
      ? html`<span class="agent-accounts-plan">${row.email.plan}</span>`
      : nothing
  }</span><span
    class=${`agent-accounts-state agent-accounts-state-${row.login}`}
    role="cell"
  ><span class="agent-accounts-mark" aria-hidden="true">${
    row.login === "in"
      ? iconTemplate(CHECK_16_PATHS, "agent-accounts-mark-icon")
      : row.login === "unknown"
        ? "?"
        : nothing
  }</span><span class="agent-accounts-state-label">${row.stateLabel}</span></span><span
    class="agent-accounts-checked"
    role="cell"
    title=${row.checked.title ?? nothing}
  >${row.checked.text}</span><span class="agent-accounts-actions" role="cell">${row.actions.map(
    (action) => actionButtonTemplate(action, busy),
  )}</span><span class="agent-accounts-path terminal-mono" title=${row.path.title}
    >${row.path.text}</span
  >${
    row.reason
      ? html`<p
          class=${row.reason.problem ? "agent-hooks-detail agent-hooks-detail-problem" : "agent-hooks-detail"}
        >${row.reason.text}</p>`
      : nothing
  }${row.result ? resultLineTemplate(row.result) : nothing}</div>`;
}

function usageRowTemplate(
  row: AccountsUsageRowProps,
  busy: boolean,
): TemplateResult {
  return html`<div class="agent-accounts-usage-row ui-table-row" data-usage=${row.tone}><span
    class="agent-accounts-usage-who"
  >${row.who}</span><span class="agent-accounts-usage-line" title=${row.line.title ?? nothing}
    >${row.line.text}</span
  ><span class="agent-accounts-actions">${
    row.action ? actionButtonTemplate(row.action, busy) : nothing
  }</span>${row.checks.map(usageCheckTemplate)}${
    row.problems
      ? html`<p class="agent-hooks-detail agent-hooks-detail-problem">${row.problems}</p>`
      : nothing
  }${row.result ? resultLineTemplate(row.result) : nothing}</div>`;
}

export const DEFAULT_VIEW: AccountsSettingsView = (props) => html`<strong
    class="agent-accounts-subtitle"
    id=${ACCOUNTS_SECTION_ID}
    >${props.title}</strong
  ><p class="scope-settings-help">${props.intro}</p><p
    class="scope-settings-help scope-settings-refresh-error"
    ?hidden=${!props.registryError}
  >${props.registryError ?? ""}</p><div class="agent-accounts-table" role="table">${
    props.table
      ? html`<div class="agent-accounts-row agent-accounts-head ui-table-head" role="row">${props.table.head.map(
          (label) =>
            html`<span class="agent-accounts-head-cell" role="columnheader">${label}</span>`,
        )}</div>${props.table.rows.map((row) => accountRowTemplate(row, props.busy))}`
      : props.loading
        ? html`<p class="scope-settings-help">${props.loading}</p>`
        : nothing
  }</div><div class="agent-accounts-add"><button
    type="button"
    class="gdp-btn gdp-btn-sm"
    ?disabled=${props.busy}
    @click=${props.add.onClick}
  >${props.add.label}</button></div><p
    class=${`agent-hooks-result ${props.sectionMessage?.ok === false ? "agent-hooks-result-error" : "agent-hooks-result-ok"}`}
    ?hidden=${!props.sectionMessage}
  >${props.sectionMessage?.text ?? ""}</p><div class="agent-accounts-subtitle-row"><strong
    class="agent-accounts-subtitle"
  >${props.usage.title}</strong><button
    type="button"
    class="gdp-btn gdp-btn-sm agents-usage-refresh"
    title=${props.usage.refresh.title}
    ?disabled=${props.usage.refresh.disabled}
    @click=${props.usage.refresh.onClick}
  >${props.usage.refresh.label}</button></div><div class="agent-accounts-usage">${props.usage.rows.map(
    (row) => usageRowTemplate(row, props.busy),
  )}</div><details class="agent-accounts-how"><summary class="">${props.usage.howLabel}</summary
    ><div class="agent-accounts-how-body">${props.usage.paragraphs.map(
      (paragraph) => html`<p class="scope-settings-help">${paragraph}</p>`,
    )}${props.usage.facts.map(
      (fact) =>
        html`<p class="agent-accounts-how-fact terminal-mono">${fact}</p>`,
    )}</div></details
  ><details class="agent-hooks-failures" ?hidden=${props.usage.failures.hidden}><summary
      class=""
      >${props.usage.failures.summary}</summary
    ><pre class="terminal-observation-errors">${props.usage.failures.lines}</pre><div
      class="agent-hooks-failures-footer"
    ><p class="scope-settings-help">${props.usage.failures.log}</p><button
      type="button"
      class="gdp-btn gdp-btn-sm"
      @click=${props.usage.failures.onClear}
    >${props.usage.failures.clearLabel}</button></div></details
  ><div class="agent-accounts-subtitle-row"><strong class="agent-accounts-subtitle"
      >${props.commands.title}</strong
    ><span class="agent-accounts-unsaved" ?hidden=${!props.commands.unsaved.shown}
      >${props.commands.unsaved.label}</span
    ></div
  ><p class="scope-settings-help">${props.commands.intro}</p><div class="agent-accounts-commands">${props.commands.items.map(
    (
      item,
    ) => html`<label class="agent-accounts-command"><span class="agent-hooks-name"
        >${item.agent}</span
      ><input
        class="gdp-dialog-input"
        id=${item.agent === "claude" ? CLAUDE_LAUNCH_COMMAND_ID : nothing}
        type="text"
        spellcheck="false"
        data-agent=${item.agent}
        .value=${live(item.value)}
        @input=${(event: Event) =>
          item.onInput((event.currentTarget as HTMLInputElement).value)}
      /></label>`,
  )}<button
    type="button"
    class="gdp-btn gdp-btn-sm"
    ?disabled=${props.commands.reset.disabled}
    @click=${props.commands.reset.onClick}
  >${props.commands.reset.label}</button></div><p
    class="scope-settings-help scope-settings-refresh-error"
    ?hidden=${!props.error}
  >${props.error ?? ""}</p>`;

export function createAccountsSettings(
  deps: AccountsSettingsDeps,
  view: AccountsSettingsView = DEFAULT_VIEW,
): AccountsSettings {
  const now = deps.now ?? Date.now;
  // 節の箱。設定のページが置き、中はここが描く。
  const element = templateElement(
    html`<div class="scope-settings-section agent-accounts-section"></div>`,
  );

  const results = new Map<string, Result>();
  /** 「確かめ直す」を押して答えを待っているアカウント。 */
  const checking = new Set<string>();
  let sectionMessage: Result | null = null;
  let busy = false;
  /** 起動コマンドの欄を利用者が触った (取り直しで上書きしない)。 */
  let commandsEdited = false;
  /** 起動コマンドの欄の値。 */
  const commandValues: Record<AccountAgent, string> = {
    claude: "",
    codex: "",
    opencode: "",
  };
  let release: (() => void) | null = null;
  const draftListeners = new Set<() => void>();

  function text(): AccountsText {
    return deps.getText();
  }

  function commandsDirty(): boolean {
    const saved = deps.client.snapshot().data?.launchCommands;
    if (!commandsEdited || !saved) return false;
    return HOOK_AGENTS.some(
      (agent) =>
        commandToSave(agent, commandValues[agent]) !==
        commandToSave(agent, saved[agent]),
    );
  }

  function commandsChanged(): void {
    render();
    for (const listener of draftListeners) listener();
  }

  async function run(key: string, action: () => Promise<string | null>) {
    if (busy) return;
    busy = true;
    results.delete(key);
    render();
    try {
      const out = await action();
      if (out) results.set(key, { ok: true, text: out });
    } catch (error) {
      console.error("[code-viewer] account action failed", error);
      results.set(key, { ok: false, text: formatErrorDetail(error) });
    } finally {
      busy = false;
      render();
    }
  }

  function agoText(at: number): string {
    const t = text();
    const elapsed = now() - at;
    return elapsed < 60_000
      ? t.checkedJustNow
      : t.checkedAgo(t.duration(elapsed));
  }

  /** 2 段目の下に出す理由。無ければ null。 */
  function reasonLine(
    account: AccountStatus,
    home: string,
  ): AccountsSettingsRowProps["reason"] {
    const t = text();
    const login = account.login;
    if (login.state === "unknown")
      return { problem: true, text: t.unknownWhy(login.detail) };
    if (login.state === "no-config-dir")
      return account.builtin
        ? {
            problem: false,
            text: t.defaultNotSetUp(abbreviateHome(account.configDir, home)),
          }
        : { problem: true, text: t.noConfigDir(account.configDir) };
    if (login.state === "logged-in" && login.setupDetail)
      return { problem: true, text: t.onboardingMarkFailed(login.setupDetail) };
    if (login.state === "logged-in" && !login.who && login.whoDetail)
      return { problem: false, text: t.noEmailWhy(login.whoDetail) };
    return null;
  }

  function recheck(account: AccountStatus): void {
    if (busy) return;
    checking.add(account.id);
    void run(account.id, async () => {
      try {
        await deps.client.load({ refreshLogin: true, account: account.id });
      } finally {
        checking.delete(account.id);
      }
      // 取り直しの失敗は一覧の読み込みの失敗として節の下に出る。
      const error = deps.client.snapshot().error;
      if (error) throw new Error(error);
      return null;
    });
  }

  /** 結果の文を節の下に出す操作 (追加・タグ・名前の変更・外す)。 */
  function runForSection(
    key: string,
    action: () => Promise<string | null>,
  ): void {
    void run(key, async () => {
      const out = await action();
      if (out) sectionMessage = { ok: true, text: out };
      return null;
    });
  }

  function accountRowProps(
    account: AccountStatus,
    home: string,
  ): AccountsSettingsRowProps {
    const t = text();
    const shown = shownLoginState(account.login);
    const display = accountDisplayName(account, t);
    const login = account.login;
    const who = login.state === "logged-in" ? login.who : "";
    const pending = checking.has(account.id);
    const actions: ActionProps[] = [
      {
        label: t.recheck,
        title: t.recheckTitle(display),
        onClick: () => recheck(account),
      },
    ];
    // 既定のアカウントは設定ディレクトリが無くてもログインで作られる。
    if (shown === "out" && (account.exists || account.builtin))
      actions.push({
        label: t.loginButton,
        title: t.loginTitle(display),
        onClick: () => void run(account.id, () => deps.dialogs.login(account)),
      });
    actions.push({
      label: t.tags,
      title: t.tagsTitle(display),
      onClick: () =>
        runForSection(account.id, () => deps.dialogs.tags(account)),
    });
    if (!account.builtin)
      actions.push(
        {
          label: t.rename,
          title: t.renameTitle(account.name),
          onClick: () =>
            runForSection(account.id, () => deps.dialogs.rename(account)),
        },
        {
          label: t.remove,
          title: t.removeTitle(account.name),
          onClick: () =>
            runForSection(account.id, () => deps.dialogs.remove(account)),
        },
      );
    return {
      id: account.id,
      agent: account.agent,
      display,
      tags: account.tags,
      login: shown,
      stateLabel: t.loginShown[shown],
      email: {
        text: who || t.noEmail,
        title: [who, login.method].filter(Boolean).join("\n"),
        plan:
          login.state === "logged-in" && login.plan
            ? planLabel(login.plan)
            : null,
      },
      checked: {
        text: pending ? t.checking : agoText(login.checkedAt),
        title: pending ? null : new Date(login.checkedAt).toLocaleString(),
      },
      actions,
      path: {
        text: abbreviateHome(account.configDir, home),
        title: account.configDir,
      },
      reason: reasonLine(account, home),
      result: results.get(account.id) ?? null,
    };
  }

  /** 使用量を確かめるの開く操作。起動コマンドの欄は同じページにある。 */
  const openers = {
    ...deps.dialogs,
    openLaunchCommands() {
      const input = element.querySelector<HTMLInputElement>(
        `#${CLAUDE_LAUNCH_COMMAND_ID}`,
      );
      input?.scrollIntoView({ block: "center" });
      input?.focus();
    },
  };

  /**
   * claude の設定ファイル (実際に書くファイル) ごとに 1 行。受け取れているかと
   * 最後に受け取った時刻だけを出し、仕組みと書き換えるファイルは「仕組み」の欄へ。
   */
  function usageParts(
    accounts: AccountStatus[],
    home: string,
  ): { rows: AccountsUsageRowProps[]; facts: string[] } {
    const t = text();
    const rows: AccountsUsageRowProps[] = [];
    const facts: string[] = [];
    const groups = new Map<string, AccountStatus[]>();
    for (const account of accounts) {
      if (account.agent !== "claude" || !account.statusLine) continue;
      const key = account.statusLine.realPath;
      groups.set(key, [...(groups.get(key) ?? []), account]);
    }
    for (const [realPath, members] of groups) {
      const first = members[0];
      const status = first?.statusLine;
      if (!first || !status) continue;
      const on = status.state === "wrapped" || status.state === "added";
      const received = Math.max(
        0,
        ...members.map((member) =>
          member.usage.status === "ok" ? member.usage.observedAt : 0,
        ),
      );
      const tone =
        status.state === "unreadable" || status.wrapperMissing
          ? "problem"
          : on
            ? received > 0
              ? "on"
              : "waiting"
            : "off";
      const names = `claude · ${members.map((member) => accountDisplayName(member, t)).join(", ")}`;
      const canAct =
        status.state !== "unreadable" && status.state !== "no-config-dir";
      const action = on && !status.wrapperMissing ? "uninstall" : "install";
      const problems: string[] = [];
      if (status.wrapperMissing) problems.push(t.statusLineWrapperMissing);
      if (status.detail) problems.push(status.detail);
      rows.push({
        tone,
        who: names,
        line: {
          text:
            status.state === "unreadable"
              ? t.statusLine.unreadable
              : status.state === "no-config-dir"
                ? t.statusLine["no-config-dir"]
                : !on
                  ? t.usageOff
                  : received > 0
                    ? t.usageReceiving(agoText(received))
                    : t.usageWaiting,
          title: received > 0 ? new Date(received).toLocaleString() : null,
        },
        action: canAct
          ? {
              label:
                action === "install"
                  ? t.statusLineInstall
                  : t.statusLineUninstall,
              title: t.statusLineDialogTitle(action),
              onClick: () =>
                void run(`statusline:${realPath}`, () =>
                  deps.dialogs.statusLine(first, action),
                ),
            }
          : null,
        // 使用量を確かめる (全体ボードのカードと同じ部品)。同じ設定ファイルを
        // 共有するアカウントが並ぶときは、ボタンに名前を添える。
        checks: members.flatMap(
          (member) =>
            usageCheckProps(member, now(), deps.client, t, openers, {
              name:
                members.length > 1 ? accountDisplayName(member, t) : undefined,
            }) ?? [],
        ),
        problems: problems.length > 0 ? problems.join("\n") : null,
        result: results.get(`statusline:${realPath}`) ?? null,
      });
      const lines = [
        `${names}: ${t.statusLine[status.state]}`,
        t.usageFile(
          status.symlink
            ? `${abbreviateHome(status.path, home)} → ${abbreviateHome(realPath, home)}`
            : abbreviateHome(status.path, home),
        ),
      ];
      if (status.command) lines.push(t.statusLineCommand(status.command));
      facts.push(lines.join("\n"));
    }
    return { rows, facts };
  }

  function viewProps(): AccountsSettingsViewProps {
    const t = text();
    const { data, error } = deps.client.snapshot();
    const refreshing =
      data?.accounts.some(
        (account) => deps.client.usageCheck(account.id)?.running,
      ) === true;
    if (data && !commandsEdited) {
      commandValues.claude = data.launchCommands.claude;
      commandValues.codex = data.launchCommands.codex;
    }
    const usage = data ? usageParts(data.accounts, data.home) : null;
    const failures = data?.usageFailures;
    return {
      title: t.sectionTitle,
      intro: t.sectionIntro,
      registryError: data?.registryError
        ? `${t.registryError(data.registryPath)}\n${data.registryError}`
        : null,
      table: data
        ? {
            head: [
              t.columns.account,
              t.columns.email,
              t.columns.state,
              t.columns.checked,
            ],
            rows: data.accounts.map((account) =>
              accountRowProps(account, data.home),
            ),
          }
        : null,
      loading: !data && !error ? t.loading : null,
      busy,
      add: {
        label: t.add,
        onClick: () => runForSection("add", () => deps.dialogs.add()),
      },
      sectionMessage,
      usage: {
        title: t.usageTitle,
        refresh: {
          label: refreshing ? t.usageChecking : t.usageRefreshAll,
          title: t.usageRefreshAuto,
          disabled: refreshing || !data,
          onClick: () => void deps.client.checkAllUsage(),
        },
        rows: usage?.rows ?? [],
        howLabel: t.usageHow,
        paragraphs: usage ? [...t.usageIntro] : [],
        facts: usage?.facts ?? [],
        failures: {
          hidden: !failures || failures.total === 0,
          summary: failures ? t.usageFailures(failures.total) : "",
          lines: failures ? failures.recent.join("\n") : "",
          log: failures ? t.usageFailuresLog(failures.log) : "",
          clearLabel: t.usageFailuresClear,
          onClear: () =>
            void run("failures", async () => {
              await deps.client.clearUsageFailures();
              return null;
            }),
        },
      },
      commands: {
        title: t.commandsTitle,
        unsaved: { label: t.commandsUnsaved, shown: !!data && commandsDirty() },
        intro: t.commandsIntro,
        items: HOOK_AGENTS.map((agent) => ({
          agent,
          value: commandValues[agent],
          onInput(value: string) {
            commandValues[agent] = value;
            commandsEdited = true;
            commandsChanged();
          },
        })),
        reset: {
          label: t.commandsReset,
          disabled: !data,
          onClick: () => {
            for (const agent of HOOK_AGENTS)
              commandValues[agent] = DEFAULT_COMMANDS[agent];
            commandsEdited = true;
            commandsChanged();
          },
        },
      },
      error: error ? `${t.bandLoadFailed}\n${error}` : null,
    };
  }

  function render(): void {
    renderOwned(element, view(viewProps()));
  }

  deps.client.subscribe(() => {
    if (element.isConnected) render();
    // 保存した値が変わると「未保存」かどうかも変わる。
    for (const listener of draftListeners) listener();
  });

  const draft: SettingsDraft = {
    dirty: commandsDirty,
    async save() {
      await deps.client.savePreferences({
        claude: commandToSave("claude", commandValues.claude),
        codex: commandToSave("codex", commandValues.codex),
        opencode: commandToSave("opencode", commandValues.opencode),
      });
      commandsEdited = false;
      render();
      commandsChanged();
    },
    subscribe(listener) {
      draftListeners.add(listener);
    },
  };

  async function refresh(): Promise<void> {
    // 節が画面にある間だけ周期で取り直す。外れたら次の refresh まで止める。
    release?.();
    release = deps.client.retain();
    const watch = () => {
      if (element.isConnected) {
        setTimeout(watch, 2000);
        return;
      }
      release?.();
      release = null;
    };
    setTimeout(watch, 2000);
    await deps.client.load();
  }

  render();
  return { element, refresh, localize: render, draft };
}
