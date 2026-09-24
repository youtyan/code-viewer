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
//   …/dir          [確かめ直す] [名前を変更] [外す]
//   確かめられませんでした: claude auth status --json exited with 1: …
//   [アカウントを追加…]
//   使用量
//   claude · 既定  5 時間と週の使用量を受け取っています（最後に受け取った時刻: たった今）  [無効にする…]
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

import type {
  AccountAgent,
  AccountLogin,
  AccountStatus,
  StatusLinePlanResponse,
} from "../../core/agent-accounts";
import { HOOK_AGENTS } from "../../core/agent-hooks";
import { abbreviateHome } from "../../core/agent-overview";
import { formatErrorDetail } from "../../core/error-detail";
import { CHECK_16_PATHS, iconSvg } from "../../core/icons";
import { showFormDialog } from "../ui-dialog";
import type { SettingsDraft } from "../viewer-settings";
import type { AccountsClient } from "./accounts-client";
import {
  type AccountDialogs,
  accountDisplayName,
  el,
  labeled,
  resultLine,
} from "./accounts-dialogs";
import type { AccountsText } from "./accounts-i18n";
import type { AgentHooksSettings } from "./agent-hooks-settings";

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

function json(value: unknown, none: string): string {
  return value === null || value === undefined
    ? none
    : JSON.stringify(value, null, 2);
}

/** 保存する値。空と既定の名前は「既定」(登録簿から外す) にする。 */
function commandToSave(agent: AccountAgent, value: string): string {
  const trimmed = value.trim();
  return trimmed === DEFAULT_COMMANDS[agent] ? "" : trimmed;
}

function planLabel(plan: string): string {
  return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : "";
}

export function createAccountsSettings(
  deps: AccountsSettingsDeps,
): AccountsSettings {
  const now = deps.now ?? Date.now;
  const element = el("div", "scope-settings-section agent-accounts-section");
  const title = el("strong", "agent-accounts-subtitle");
  title.id = ACCOUNTS_SECTION_ID;
  const intro = el("p", "scope-settings-help");
  const registryError = el(
    "p",
    "scope-settings-help scope-settings-refresh-error",
  );
  const table = el("div", "agent-accounts-table");
  table.setAttribute("role", "table");
  const addRow = el("div", "agent-accounts-add");
  const addButton = el("button", "gdp-btn gdp-btn-sm");
  addButton.type = "button";
  addRow.appendChild(addButton);
  const usageTitle = el("strong", "agent-accounts-subtitle");
  const usageRows = el("div", "agent-accounts-usage");
  const usageHow = el("details", "agent-accounts-how");
  const usageHowSummary = el("summary");
  const usageHowBody = el("div", "agent-accounts-how-body");
  usageHow.append(usageHowSummary, usageHowBody);
  const failures = el("details", "agent-hooks-failures");
  const failuresSummary = el("summary");
  const failuresBody = el("pre", "terminal-observation-errors");
  const failuresFooter = el("div", "agent-hooks-failures-footer");
  const failuresLog = el("p", "scope-settings-help");
  const failuresClear = el("button", "gdp-btn gdp-btn-sm");
  failuresClear.type = "button";
  failuresFooter.append(failuresLog, failuresClear);
  failures.append(failuresSummary, failuresBody, failuresFooter);
  const commandsHead = el("div", "agent-accounts-subtitle-row");
  const commandsTitle = el("strong", "agent-accounts-subtitle");
  const commandsUnsaved = el("span", "agent-accounts-unsaved");
  commandsHead.append(commandsTitle, commandsUnsaved);
  const commandsIntro = el("p", "scope-settings-help");
  const commandsRow = el("div", "agent-accounts-commands");
  const commandInputs: Record<AccountAgent, HTMLInputElement> = {
    claude: el("input", "gdp-dialog-input"),
    codex: el("input", "gdp-dialog-input"),
  };
  const commandsReset = el("button", "gdp-btn gdp-btn-sm");
  commandsReset.type = "button";
  for (const [agent, input] of Object.entries(commandInputs)) {
    input.type = "text";
    input.spellcheck = false;
    input.dataset.agent = agent;
    const wrap = el("label", "agent-accounts-command");
    wrap.append(el("span", "agent-hooks-name", agent), input);
    commandsRow.appendChild(wrap);
  }
  commandsRow.appendChild(commandsReset);
  const loadError = el("p", "scope-settings-help scope-settings-refresh-error");
  const sectionResult = el("p", "agent-hooks-result");
  element.append(
    title,
    intro,
    registryError,
    table,
    addRow,
    sectionResult,
    usageTitle,
    usageRows,
    usageHow,
    failures,
    commandsHead,
    commandsIntro,
    commandsRow,
    loadError,
  );

  const results = new Map<string, Result>();
  /** 「確かめ直す」を押して答えを待っているアカウント。 */
  const checking = new Set<string>();
  let sectionMessage: Result | null = null;
  let busy = false;
  /** 起動コマンドの欄を利用者が触った (取り直しで上書きしない)。 */
  let commandsEdited = false;
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
        commandToSave(agent, commandInputs[agent].value) !==
        commandToSave(agent, saved[agent]),
    );
  }

  function commandsChanged(): void {
    commandsUnsaved.hidden = !commandsDirty();
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

  function stateCell(account: AccountStatus): HTMLElement {
    const t = text();
    const shown = shownLoginState(account.login);
    const cell = el(
      "span",
      `agent-accounts-state agent-accounts-state-${shown}`,
    );
    cell.setAttribute("role", "cell");
    let mark: HTMLElement;
    if (shown === "in") {
      const holder = el("span", "agent-accounts-mark");
      holder.innerHTML = iconSvg("agent-accounts-mark-icon", CHECK_16_PATHS);
      mark = holder;
    } else {
      mark = el("span", "agent-accounts-mark", shown === "unknown" ? "?" : "");
    }
    mark.setAttribute("aria-hidden", "true");
    cell.append(
      mark,
      el("span", "agent-accounts-state-label", t.loginShown[shown]),
    );
    return cell;
  }

  function emailCell(account: AccountStatus): HTMLElement {
    const t = text();
    const cell = el("span", "agent-accounts-email");
    cell.setAttribute("role", "cell");
    const login = account.login;
    const who = login.state === "logged-in" ? login.who : "";
    const address = el("span", "agent-accounts-address", who || t.noEmail);
    address.title = [who, login.method].filter(Boolean).join("\n");
    cell.appendChild(address);
    if (login.state === "logged-in" && login.plan) {
      cell.appendChild(
        el("span", "agent-accounts-plan", planLabel(login.plan)),
      );
    }
    return cell;
  }

  function checkedCell(account: AccountStatus): HTMLElement {
    const t = text();
    const pending = checking.has(account.id);
    const cell = el(
      "span",
      "agent-accounts-checked",
      pending ? t.checking : agoText(account.login.checkedAt),
    );
    cell.setAttribute("role", "cell");
    if (!pending)
      cell.title = new Date(account.login.checkedAt).toLocaleString();
    return cell;
  }

  /** 2 段目の下に出す理由。無ければ null。 */
  function reasonLine(
    account: AccountStatus,
    home: string,
  ): HTMLElement | null {
    const t = text();
    const login = account.login;
    if (login.state === "unknown") {
      return el(
        "p",
        "agent-hooks-detail agent-hooks-detail-problem",
        t.unknownWhy(login.detail),
      );
    }
    if (login.state === "no-config-dir") {
      return account.builtin
        ? el(
            "p",
            "agent-hooks-detail",
            t.defaultNotSetUp(abbreviateHome(account.configDir, home)),
          )
        : el(
            "p",
            "agent-hooks-detail agent-hooks-detail-problem",
            t.noConfigDir(account.configDir),
          );
    }
    if (login.state === "logged-in" && !login.who && login.whoDetail) {
      return el("p", "agent-hooks-detail", t.noEmailWhy(login.whoDetail));
    }
    return null;
  }

  function actionButton(
    label: string,
    title: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = el("button", "gdp-btn gdp-btn-sm", label);
    button.type = "button";
    button.title = title;
    button.disabled = busy;
    button.addEventListener("click", onClick);
    return button;
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

  function headRow(): HTMLElement {
    const t = text();
    const row = el("div", "agent-accounts-row agent-accounts-head");
    row.setAttribute("role", "row");
    for (const label of [
      t.columns.account,
      t.columns.email,
      t.columns.state,
      t.columns.checked,
    ]) {
      const cell = el("span", "agent-accounts-head-cell", label);
      cell.setAttribute("role", "columnheader");
      row.appendChild(cell);
    }
    return row;
  }

  function accountRow(account: AccountStatus, home: string): HTMLElement {
    const t = text();
    const shown = shownLoginState(account.login);
    const row = el("div", "agent-accounts-row");
    row.setAttribute("role", "row");
    row.dataset.account = account.id;
    row.dataset.login = shown;
    const name = el("span", "agent-accounts-name-cell");
    name.setAttribute("role", "cell");
    name.append(
      el("span", "agent-accounts-kind", account.agent),
      el("span", "agent-accounts-name", accountDisplayName(account, t)),
    );
    const actions = el("span", "agent-accounts-actions");
    actions.setAttribute("role", "cell");
    const display = accountDisplayName(account, t);
    actions.appendChild(
      actionButton(t.recheck, t.recheckTitle(display), () => recheck(account)),
    );
    // 既定のアカウントは設定ディレクトリが無くてもログインで作られる。
    if (shown === "out" && (account.exists || account.builtin)) {
      actions.appendChild(
        actionButton(
          t.loginButton,
          t.loginTitle(display),
          () => void run(account.id, () => deps.dialogs.login(account)),
        ),
      );
    }
    if (!account.builtin) {
      actions.appendChild(
        actionButton(
          t.rename,
          t.renameTitle(account.name),
          () =>
            void run(account.id, async () => {
              const out = await deps.dialogs.rename(account);
              if (out) sectionMessage = { ok: true, text: out };
              return null;
            }),
        ),
      );
      actions.appendChild(
        actionButton(
          t.remove,
          t.removeTitle(account.name),
          () =>
            void run(account.id, async () => {
              const out = await deps.dialogs.remove(account);
              if (out) sectionMessage = { ok: true, text: out };
              return null;
            }),
        ),
      );
    }
    const path = el(
      "span",
      "agent-accounts-path terminal-mono",
      abbreviateHome(account.configDir, home),
    );
    path.title = account.configDir;
    row.append(
      name,
      emailCell(account),
      stateCell(account),
      checkedCell(account),
      actions,
      path,
    );
    const reason = reasonLine(account, home);
    if (reason) row.appendChild(reason);
    const result = results.get(account.id);
    if (result) row.appendChild(resultLine(result));
    return row;
  }

  function statusLineBody(plan: StatusLinePlanResponse): HTMLElement {
    const t = text();
    const home = deps.client.snapshot().data?.home ?? "";
    const short = (path: string) => abbreviateHome(path, home);
    const body = el("div", "agent-hooks-dialog");
    if (plan.writeBlocked && plan.changed) {
      body.appendChild(el("p", "", t.statusLineBlocked));
      body.appendChild(
        labeled(t.statusLineAfter, json(plan.after, t.statusLineNone), true),
      );
      body.appendChild(labeled("", plan.writeBlocked, true));
      return body;
    }
    body.appendChild(labeled(t.statusLineFile, short(plan.path)));
    if (plan.symlink) {
      body.appendChild(labeled(t.statusLineLinkTarget, short(plan.realPath)));
    }
    body.appendChild(
      labeled(t.statusLineBefore, json(plan.before, t.statusLineNone), true),
    );
    body.appendChild(
      labeled(t.statusLineAfter, json(plan.after, t.statusLineNone), true),
    );
    const notes: string[] = [];
    if (!plan.changed) notes.push(t.statusLineNothing);
    if (plan.changed) {
      notes.push(
        plan.backupPath
          ? t.statusLineBackup(
              short(plan.backupPath).replace(
                /-\d{8}-\d{6}$/,
                "-<YYYYMMDD-HHMMSS>",
              ),
            )
          : t.statusLineNewFile,
      );
      if (plan.formattingChanged) notes.push(t.statusLineFormatting);
    }
    if (plan.action === "install") {
      if (plan.wrapper.write)
        notes.push(t.statusLineWrapper(short(plan.wrapper.path)));
      notes.push(t.statusLineSaves(short(plan.usageDir)));
      notes.push(t.statusLineRestore);
    }
    notes.push(t.statusLineEffect);
    const list = el("ul", "agent-hooks-dialog-notes");
    for (const note of notes) list.appendChild(el("li", "", note));
    body.appendChild(list);
    return body;
  }

  async function reviewStatusLine(
    account: AccountStatus,
    action: "install" | "uninstall",
  ): Promise<string | null> {
    const t = text();
    const plan = await deps.client.planStatusLine(account.id, action);
    const blocked = plan.writeBlocked !== "" && plan.changed;
    return showFormDialog({
      title: t.statusLineDialogTitle(action),
      body: statusLineBody(plan),
      wide: true,
      danger: false,
      submitLabel: blocked
        ? t.close
        : action === "install"
          ? t.statusLineInstall.replace(/…$/, "")
          : t.statusLineUninstall.replace(/…$/, ""),
      cancelLabel: t.cancel,
      submit: async () => {
        if (blocked) return null;
        const result = await deps.client.applyStatusLine(plan, account.id);
        const lines = [
          result.changed ? t.statusLineApplied[action] : t.statusLineUnchanged,
        ];
        if (result.backupPath) lines.push(t.backupAt(result.backupPath));
        if (result.wrapperWritten)
          lines.push(t.statusLineWrapper(plan.wrapper.path));
        return lines.join("\n");
      },
    });
  }

  /**
   * claude の設定ファイル (実際に書くファイル) ごとに 1 行。受け取れているかと
   * 最後に受け取った時刻だけを出し、仕組みと書き換えるファイルは「仕組み」の欄へ。
   */
  function renderUsage(accounts: AccountStatus[], home: string): void {
    const t = text();
    usageRows.replaceChildren();
    const how: HTMLElement[] = t.usageIntro.map((paragraph) =>
      el("p", "scope-settings-help", paragraph),
    );
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
      const box = el("div", "agent-accounts-usage-row");
      box.dataset.usage = tone;
      const names = el(
        "span",
        "agent-accounts-usage-who",
        `claude · ${members.map((member) => accountDisplayName(member, t)).join(", ")}`,
      );
      const line = el(
        "span",
        "agent-accounts-usage-line",
        status.state === "unreadable"
          ? t.statusLine.unreadable
          : status.state === "no-config-dir"
            ? t.statusLine["no-config-dir"]
            : !on
              ? t.usageOff
              : received > 0
                ? t.usageReceiving(agoText(received))
                : t.usageWaiting,
      );
      if (received > 0) line.title = new Date(received).toLocaleString();
      const actions = el("span", "agent-accounts-actions");
      const canAct =
        status.state !== "unreadable" && status.state !== "no-config-dir";
      if (canAct) {
        const action = on && !status.wrapperMissing ? "uninstall" : "install";
        actions.appendChild(
          actionButton(
            action === "install" ? t.statusLineInstall : t.statusLineUninstall,
            t.statusLineDialogTitle(action),
            () =>
              void run(`statusline:${realPath}`, () =>
                reviewStatusLine(first, action),
              ),
          ),
        );
      }
      box.append(names, line, actions);
      const problems: string[] = [];
      if (status.wrapperMissing) problems.push(t.statusLineWrapperMissing);
      if (status.detail) problems.push(status.detail);
      if (problems.length > 0) {
        box.appendChild(
          el(
            "p",
            "agent-hooks-detail agent-hooks-detail-problem",
            problems.join("\n"),
          ),
        );
      }
      const result = results.get(`statusline:${realPath}`);
      if (result) box.appendChild(resultLine(result));
      usageRows.appendChild(box);
      const facts = [
        `claude · ${members.map((member) => accountDisplayName(member, t)).join(", ")}: ${t.statusLine[status.state]}`,
        t.usageFile(
          status.symlink
            ? `${abbreviateHome(status.path, home)} → ${abbreviateHome(realPath, home)}`
            : abbreviateHome(status.path, home),
        ),
      ];
      if (status.command) facts.push(t.statusLineCommand(status.command));
      how.push(
        el("p", "agent-accounts-how-fact terminal-mono", facts.join("\n")),
      );
    }
    usageHowBody.replaceChildren(...how);
  }

  function render(): void {
    const t = text();
    const { data, error } = deps.client.snapshot();
    title.textContent = t.sectionTitle;
    intro.textContent = t.sectionIntro;
    addButton.textContent = t.add;
    addButton.disabled = busy;
    usageTitle.textContent = t.usageTitle;
    usageHowSummary.textContent = t.usageHow;
    commandsTitle.textContent = t.commandsTitle;
    commandsUnsaved.textContent = t.commandsUnsaved;
    commandsIntro.textContent = t.commandsIntro;
    commandsReset.textContent = t.commandsReset;
    commandsReset.disabled = !data;
    failuresClear.textContent = t.usageFailuresClear;
    loadError.hidden = !error;
    loadError.textContent = error ? `${t.bandLoadFailed}\n${error}` : "";
    registryError.hidden = !data?.registryError;
    registryError.textContent = data?.registryError
      ? `${t.registryError(data.registryPath)}\n${data.registryError}`
      : "";
    sectionResult.hidden = !sectionMessage;
    sectionResult.className = `agent-hooks-result ${sectionMessage?.ok === false ? "agent-hooks-result-error" : "agent-hooks-result-ok"}`;
    sectionResult.textContent = sectionMessage?.text ?? "";
    table.replaceChildren();
    if (!data) {
      if (!error) table.appendChild(el("p", "scope-settings-help", t.loading));
      usageRows.replaceChildren();
      failures.hidden = true;
      commandsUnsaved.hidden = true;
      return;
    }
    table.appendChild(headRow());
    for (const account of data.accounts) {
      table.appendChild(accountRow(account, data.home));
    }
    renderUsage(data.accounts, data.home);
    failures.hidden = data.usageFailures.total === 0;
    failuresSummary.textContent = t.usageFailures(data.usageFailures.total);
    failuresBody.textContent = data.usageFailures.recent.join("\n");
    failuresLog.textContent = t.usageFailuresLog(data.usageFailures.log);
    if (!commandsEdited) {
      commandInputs.claude.value = data.launchCommands.claude;
      commandInputs.codex.value = data.launchCommands.codex;
    }
    commandsUnsaved.hidden = !commandsDirty();
  }

  addButton.addEventListener(
    "click",
    () =>
      void run("add", async () => {
        const out = await deps.dialogs.add();
        if (out) sectionMessage = { ok: true, text: out };
        return null;
      }),
  );
  for (const input of Object.values(commandInputs)) {
    input.addEventListener("input", () => {
      commandsEdited = true;
      commandsChanged();
    });
  }
  commandsReset.addEventListener("click", () => {
    for (const agent of HOOK_AGENTS) {
      commandInputs[agent].value = DEFAULT_COMMANDS[agent];
    }
    commandsEdited = true;
    commandsChanged();
  });
  failuresClear.addEventListener(
    "click",
    () =>
      void run("failures", async () => {
        await deps.client.clearUsageFailures();
        return null;
      }),
  );
  deps.client.subscribe(() => {
    if (element.isConnected) render();
    // 保存した値が変わると「未保存」かどうかも変わる。
    for (const listener of draftListeners) listener();
  });

  const draft: SettingsDraft = {
    dirty: commandsDirty,
    async save() {
      await deps.client.savePreferences({
        claude: commandToSave("claude", commandInputs.claude.value),
        codex: commandToSave("codex", commandInputs.codex.value),
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
