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

import { html, nothing, type TemplateResult } from "lit/html.js";
import { live } from "lit/directives/live.js";
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
import { usageCheckBlock } from "./usage-check";

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

export function createAccountsSettings(
  deps: AccountsSettingsDeps,
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
  const commandValues: Record<AccountAgent, string> = { claude: "", codex: "" };
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

  function stateCell(account: AccountStatus): TemplateResult {
    const t = text();
    const shown = shownLoginState(account.login);
    return html`<span
      class=${`agent-accounts-state agent-accounts-state-${shown}`}
      role="cell"
    ><span class="agent-accounts-mark" aria-hidden="true">${
      shown === "in"
        ? iconTemplate(CHECK_16_PATHS, "agent-accounts-mark-icon")
        : shown === "unknown"
          ? "?"
          : nothing
    }</span><span class="agent-accounts-state-label">${t.loginShown[shown]}</span></span>`;
  }

  function emailCell(account: AccountStatus): TemplateResult {
    const t = text();
    const login = account.login;
    const who = login.state === "logged-in" ? login.who : "";
    return html`<span class="agent-accounts-email" role="cell"><span
      class="agent-accounts-address"
      title=${[who, login.method].filter(Boolean).join("\n")}
    >${who || t.noEmail}</span>${
      login.state === "logged-in" && login.plan
        ? html`<span class="agent-accounts-plan">${planLabel(login.plan)}</span>`
        : nothing
    }</span>`;
  }

  function checkedCell(account: AccountStatus): TemplateResult {
    const t = text();
    const pending = checking.has(account.id);
    return html`<span
      class="agent-accounts-checked"
      role="cell"
      title=${pending ? nothing : new Date(account.login.checkedAt).toLocaleString()}
    >${pending ? t.checking : agoText(account.login.checkedAt)}</span>`;
  }

  /** 2 段目の下に出す理由。無ければ何も出さない。 */
  function reasonLine(
    account: AccountStatus,
    home: string,
  ): TemplateResult | typeof nothing {
    const t = text();
    const login = account.login;
    const line = (problem: boolean, value: string) =>
      html`<p
        class=${problem ? "agent-hooks-detail agent-hooks-detail-problem" : "agent-hooks-detail"}
      >${value}</p>`;
    if (login.state === "unknown")
      return line(true, t.unknownWhy(login.detail));
    if (login.state === "no-config-dir")
      return account.builtin
        ? line(
            false,
            t.defaultNotSetUp(abbreviateHome(account.configDir, home)),
          )
        : line(true, t.noConfigDir(account.configDir));
    if (login.state === "logged-in" && login.setupDetail)
      return line(true, t.onboardingMarkFailed(login.setupDetail));
    if (login.state === "logged-in" && !login.who && login.whoDetail)
      return line(false, t.noEmailWhy(login.whoDetail));
    return nothing;
  }

  function actionButton(
    label: string,
    title: string,
    onClick: () => void,
  ): TemplateResult {
    return html`<button
      type="button"
      class="gdp-btn gdp-btn-sm"
      title=${title}
      ?disabled=${busy}
      @click=${onClick}
    >${label}</button>`;
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

  function headRow(): TemplateResult {
    const t = text();
    return html`<div class="agent-accounts-row agent-accounts-head ui-table-head" role="row">${[
      t.columns.account,
      t.columns.email,
      t.columns.state,
      t.columns.checked,
    ].map(
      (label) =>
        html`<span class="agent-accounts-head-cell" role="columnheader">${label}</span>`,
    )}</div>`;
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

  function accountRow(account: AccountStatus, home: string): TemplateResult {
    const t = text();
    const shown = shownLoginState(account.login);
    const display = accountDisplayName(account, t);
    const result = results.get(account.id);
    return html`<div
      class="agent-accounts-row ui-table-row"
      role="row"
      data-account=${account.id}
      data-login=${shown}
    ><span class="agent-accounts-name-cell" role="cell"><span class="agent-accounts-kind"
      >${account.agent}</span
    ><span class="agent-accounts-name">${display}</span>${accountTagListTemplate(account.tags)}</span
    >${emailCell(account)}${stateCell(account)}${checkedCell(account)}<span
      class="agent-accounts-actions"
      role="cell"
    >${actionButton(t.recheck, t.recheckTitle(display), () => recheck(account))}${
      // 既定のアカウントは設定ディレクトリが無くてもログインで作られる。
      shown === "out" && (account.exists || account.builtin)
        ? actionButton(
            t.loginButton,
            t.loginTitle(display),
            () => void run(account.id, () => deps.dialogs.login(account)),
          )
        : nothing
    }${actionButton(t.tags, t.tagsTitle(display), () =>
      runForSection(account.id, () => deps.dialogs.tags(account)),
    )}${
      account.builtin
        ? nothing
        : html`${actionButton(t.rename, t.renameTitle(account.name), () =>
            runForSection(account.id, () => deps.dialogs.rename(account)),
          )}${actionButton(t.remove, t.removeTitle(account.name), () =>
            runForSection(account.id, () => deps.dialogs.remove(account)),
          )}`
    }</span><span class="agent-accounts-path terminal-mono" title=${account.configDir}
      >${abbreviateHome(account.configDir, home)}</span
    >${reasonLine(account, home)}${result ? resultLineTemplate(result) : nothing}</div>`;
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
  ): { rows: TemplateResult[]; how: TemplateResult[] } {
    const t = text();
    const how: TemplateResult[] = t.usageIntro.map(
      (paragraph) => html`<p class="scope-settings-help">${paragraph}</p>`,
    );
    const rows: TemplateResult[] = [];
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
      const result = results.get(`statusline:${realPath}`);
      rows.push(html`<div class="agent-accounts-usage-row ui-table-row" data-usage=${tone}><span
        class="agent-accounts-usage-who"
      >${names}</span><span
        class="agent-accounts-usage-line"
        title=${received > 0 ? new Date(received).toLocaleString() : nothing}
      >${
        status.state === "unreadable"
          ? t.statusLine.unreadable
          : status.state === "no-config-dir"
            ? t.statusLine["no-config-dir"]
            : !on
              ? t.usageOff
              : received > 0
                ? t.usageReceiving(agoText(received))
                : t.usageWaiting
      }</span><span class="agent-accounts-actions">${
        canAct
          ? actionButton(
              action === "install"
                ? t.statusLineInstall
                : t.statusLineUninstall,
              t.statusLineDialogTitle(action),
              () =>
                void run(`statusline:${realPath}`, () =>
                  deps.dialogs.statusLine(first, action),
                ),
            )
          : nothing
      }</span>${
        // 使用量を確かめる (全体ボードのカードと同じ部品)。同じ設定ファイルを
        // 共有するアカウントが並ぶときは、ボタンに名前を添える。
        members.map(
          (member) =>
            usageCheckBlock(member, now(), deps.client, t, openers, {
              name:
                members.length > 1 ? accountDisplayName(member, t) : undefined,
            }) ?? nothing,
        )
      }${
        problems.length > 0
          ? html`<p class="agent-hooks-detail agent-hooks-detail-problem">${problems.join("\n")}</p>`
          : nothing
      }${result ? resultLineTemplate(result) : nothing}</div>`);
      const facts = [
        `${names}: ${t.statusLine[status.state]}`,
        t.usageFile(
          status.symlink
            ? `${abbreviateHome(status.path, home)} → ${abbreviateHome(realPath, home)}`
            : abbreviateHome(status.path, home),
        ),
      ];
      if (status.command) facts.push(t.statusLineCommand(status.command));
      how.push(
        html`<p class="agent-accounts-how-fact terminal-mono">${facts.join("\n")}</p>`,
      );
    }
    return { rows, how };
  }

  function sectionTemplate(): TemplateResult {
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
    return html`<strong class="agent-accounts-subtitle" id=${ACCOUNTS_SECTION_ID}>${t.sectionTitle}</strong><p
        class="scope-settings-help"
      >${t.sectionIntro}</p><p
        class="scope-settings-help scope-settings-refresh-error"
        ?hidden=${!data?.registryError}
      >${data?.registryError ? `${t.registryError(data.registryPath)}\n${data.registryError}` : ""}</p><div
        class="agent-accounts-table"
        role="table"
      >${
        data
          ? html`${headRow()}${data.accounts.map((account) => accountRow(account, data.home))}`
          : error
            ? nothing
            : html`<p class="scope-settings-help">${t.loading}</p>`
      }</div><div class="agent-accounts-add"><button
        type="button"
        class="gdp-btn gdp-btn-sm"
        ?disabled=${busy}
        @click=${() => runForSection("add", () => deps.dialogs.add())}
      >${t.add}</button></div><p
        class=${`agent-hooks-result ${sectionMessage?.ok === false ? "agent-hooks-result-error" : "agent-hooks-result-ok"}`}
        ?hidden=${!sectionMessage}
      >${sectionMessage?.text ?? ""}</p><div class="agent-accounts-subtitle-row"><strong
        class="agent-accounts-subtitle"
      >${t.usageTitle}</strong><button
        type="button"
        class="gdp-btn gdp-btn-sm agents-usage-refresh"
        title=${t.usageRefreshAuto}
        ?disabled=${refreshing || !data}
        @click=${() => void deps.client.checkAllUsage()}
      >${refreshing ? t.usageChecking : t.usageRefreshAll}</button></div><div
        class="agent-accounts-usage"
      >${usage?.rows ?? nothing}</div><details class="agent-accounts-how"><summary class=""
        >${t.usageHow}</summary
      ><div class="agent-accounts-how-body">${usage?.how ?? nothing}</div></details><details
        class="agent-hooks-failures"
        ?hidden=${!data || data.usageFailures.total === 0}
      ><summary class="">${data ? t.usageFailures(data.usageFailures.total) : ""}</summary><pre
        class="terminal-observation-errors"
      >${data ? data.usageFailures.recent.join("\n") : ""}</pre><div
        class="agent-hooks-failures-footer"
      ><p class="scope-settings-help">${data ? t.usageFailuresLog(data.usageFailures.log) : ""}</p><button
        type="button"
        class="gdp-btn gdp-btn-sm"
        @click=${() =>
          void run("failures", async () => {
            await deps.client.clearUsageFailures();
            return null;
          })}
      >${t.usageFailuresClear}</button></div></details><div class="agent-accounts-subtitle-row"><strong
        class="agent-accounts-subtitle"
      >${t.commandsTitle}</strong><span class="agent-accounts-unsaved" ?hidden=${!data || !commandsDirty()}
        >${t.commandsUnsaved}</span
      ></div><p class="scope-settings-help">${t.commandsIntro}</p><div class="agent-accounts-commands">${HOOK_AGENTS.map(
        (
          agent,
        ) => html`<label class="agent-accounts-command"><span class="agent-hooks-name">${agent}</span><input
          class="gdp-dialog-input"
          id=${agent === "claude" ? CLAUDE_LAUNCH_COMMAND_ID : nothing}
          type="text"
          spellcheck="false"
          data-agent=${agent}
          .value=${live(commandValues[agent])}
          @input=${(event: Event) => {
            commandValues[agent] = (
              event.currentTarget as HTMLInputElement
            ).value;
            commandsEdited = true;
            commandsChanged();
          }}
        /></label>`,
      )}<button
        type="button"
        class="gdp-btn gdp-btn-sm"
        ?disabled=${!data}
        @click=${() => {
          for (const agent of HOOK_AGENTS)
            commandValues[agent] = DEFAULT_COMMANDS[agent];
          commandsEdited = true;
          commandsChanged();
        }}
      >${t.commandsReset}</button></div><p
        class="scope-settings-help scope-settings-refresh-error"
        ?hidden=${!error}
      >${error ? `${t.bandLoadFailed}\n${error}` : ""}</p>`;
  }

  function render(): void {
    renderOwned(element, sectionTemplate());
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
