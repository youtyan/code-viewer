// 設定画面の「アカウント」の節。
//
//   アカウント
//   claude  既定    ● ログイン済み  ~/.claude                       [ログイン]
//   claude  仕事用  ○ 未ログイン    ~/.local/state/…/claude-work     [ログイン] [名前を変更] [外す]
//   codex   既定    ● ログイン済み  ~/.codex
//   [アカウントを追加…]
//   claude の使用量
//   ~/.claude/settings.json → …   ● 有効（包んでいます）  [無効にする…]
//   起動コマンド  claude [claude    ]  codex [codex    ]  [保存]
//
// statusLine の包み込みは設定ファイルごと (リンクで共有しているアカウントは
// 同じファイル) なので、実際に書くファイル (リンク先) ごとに 1 行にする。
// 確認の画面はフックの入れ外しと同じ部品・同じ作法 (書く前に差分を見せ、
// そのときの中身のハッシュを添えて書かせる)。

import type {
  AccountStatus,
  StatusLinePlanResponse,
} from "../../core/agent-accounts";
import { abbreviateHome } from "../../core/agent-overview";
import { formatErrorDetail } from "../../core/error-detail";
import { showFormDialog } from "../ui-dialog";
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
};

/** 設定画面の節の形はフックの節と同じ。 */
export type AccountsSettings = AgentHooksSettings;

/** 見出しの id。帯の「管理」からここへ飛ぶ。 */
export const ACCOUNTS_SECTION_ID = "agent-accounts-section-title";

type Result = { ok: boolean; text: string };

function json(value: unknown, none: string): string {
  return value === null || value === undefined
    ? none
    : JSON.stringify(value, null, 2);
}

export function createAccountsSettings(
  deps: AccountsSettingsDeps,
): AccountsSettings {
  const element = el("div", "scope-settings-section agent-accounts-section");
  const title = el("strong", "scope-settings-section-title");
  title.id = ACCOUNTS_SECTION_ID;
  const intro = el("p", "scope-settings-help");
  const registryError = el(
    "p",
    "scope-settings-help scope-settings-refresh-error",
  );
  const rows = el("div", "agent-hooks-rows");
  const addRow = el("div", "agent-accounts-add");
  const addButton = el("button", "gdp-btn gdp-btn-sm");
  addButton.type = "button";
  addRow.appendChild(addButton);
  const usageTitle = el("strong", "agent-accounts-subtitle");
  const usageIntro = el("p", "scope-settings-help");
  const usageRows = el("div", "agent-hooks-rows");
  const failures = el("details", "agent-hooks-failures");
  const failuresSummary = el("summary");
  const failuresBody = el("pre", "terminal-observation-errors");
  const failuresFooter = el("div", "agent-hooks-failures-footer");
  const failuresLog = el("p", "scope-settings-help");
  const failuresClear = el("button", "gdp-btn gdp-btn-sm");
  failuresClear.type = "button";
  failuresFooter.append(failuresLog, failuresClear);
  failures.append(failuresSummary, failuresBody, failuresFooter);
  const commandsTitle = el("strong", "agent-accounts-subtitle");
  const commandsIntro = el("p", "scope-settings-help");
  const commandsRow = el("div", "agent-accounts-commands");
  const commandInputs = {
    claude: el("input", "gdp-dialog-input"),
    codex: el("input", "gdp-dialog-input"),
  };
  const commandsSave = el("button", "gdp-btn gdp-btn-sm");
  commandsSave.type = "button";
  for (const [agent, input] of Object.entries(commandInputs)) {
    input.type = "text";
    input.spellcheck = false;
    input.dataset.agent = agent;
    const wrap = el("label", "agent-accounts-command");
    wrap.append(el("span", "agent-hooks-name", agent), input);
    commandsRow.appendChild(wrap);
  }
  commandsRow.appendChild(commandsSave);
  const loadError = el("p", "scope-settings-help scope-settings-refresh-error");
  const sectionResult = el("p", "agent-hooks-result");
  element.append(
    title,
    intro,
    registryError,
    rows,
    addRow,
    sectionResult,
    usageTitle,
    usageIntro,
    usageRows,
    failures,
    commandsTitle,
    commandsIntro,
    commandsRow,
    loadError,
  );

  const results = new Map<string, Result>();
  let sectionMessage: Result | null = null;
  let busy = false;
  let commandsDirty = false;
  let release: (() => void) | null = null;

  function text(): AccountsText {
    return deps.getText();
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

  function stateLabel(account: AccountStatus): HTMLElement {
    const t = text();
    const state = account.login.state;
    const label = el(
      "span",
      `agent-hooks-state agents-account-login agents-account-login-${state}`,
    );
    const mark = el("i", "agent-hooks-mark");
    mark.setAttribute("aria-hidden", "true");
    const who =
      state === "logged-in"
        ? t.loginWho(account.login.who, account.login.method)
        : t.login[state];
    label.append(mark, who);
    label.title = [
      t.login[state],
      account.login.detail,
      state === "logged-in" && !account.login.who ? t.loginUnknownWho : "",
    ]
      .filter(Boolean)
      .join("\n");
    return label;
  }

  function accountRow(account: AccountStatus, home: string): HTMLElement {
    const t = text();
    const box = el("div", "agent-hooks-row agent-accounts-row");
    box.dataset.account = account.id;
    const name = el(
      "span",
      "agent-accounts-name",
      accountDisplayName(account, t),
    );
    const path = el(
      "span",
      "agent-hooks-path terminal-mono",
      abbreviateHome(account.configDir, home),
    );
    path.title = account.configDir;
    const actions = el("span", "agent-accounts-actions");
    // 既定のアカウントは設定ディレクトリが無くてもログインで作られる。
    if (
      account.login.state !== "logged-in" &&
      (account.exists || account.builtin)
    ) {
      const login = el("button", "gdp-btn gdp-btn-sm", t.loginButton);
      login.type = "button";
      login.title = t.loginTitle(accountDisplayName(account, t));
      login.disabled = busy;
      login.addEventListener(
        "click",
        () => void run(account.id, () => deps.dialogs.login(account)),
      );
      actions.appendChild(login);
    }
    if (!account.builtin) {
      const rename = el("button", "gdp-btn gdp-btn-sm", t.rename);
      rename.type = "button";
      rename.title = t.renameTitle(account.name);
      rename.disabled = busy;
      rename.addEventListener(
        "click",
        () =>
          void run(account.id, async () => {
            const out = await deps.dialogs.rename(account);
            if (out) sectionMessage = { ok: true, text: out };
            return null;
          }),
      );
      actions.appendChild(rename);
      const remove = el("button", "gdp-btn gdp-btn-sm", t.remove);
      remove.type = "button";
      remove.title = t.removeTitle(account.name);
      remove.disabled = busy;
      remove.addEventListener(
        "click",
        () =>
          void run(account.id, async () => {
            const out = await deps.dialogs.remove(account);
            if (out) sectionMessage = { ok: true, text: out };
            return null;
          }),
      );
      actions.appendChild(remove);
    }
    box.append(
      el("span", "agent-hooks-name", account.agent),
      name,
      stateLabel(account),
      path,
      actions,
    );
    if (!account.exists && account.login.state === "no-config-dir") {
      box.appendChild(
        account.builtin
          ? el(
              "p",
              "agent-hooks-detail",
              t.defaultNotSetUp(abbreviateHome(account.configDir, home)),
            )
          : el(
              "p",
              "agent-hooks-detail agent-hooks-detail-problem",
              t.noConfigDir(account.configDir),
            ),
      );
    }
    const result = results.get(account.id);
    if (result) box.appendChild(resultLine(result));
    return box;
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

  /** claude の設定ファイル (実際に書くファイル) ごとに 1 行。 */
  function renderUsage(accounts: AccountStatus[], home: string): void {
    const t = text();
    usageRows.replaceChildren();
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
      const box = el("div", "agent-hooks-row agent-accounts-usage-row");
      const on = status.state === "wrapped" || status.state === "added";
      const state = el(
        "span",
        `agent-hooks-state agent-hooks-state-${on ? "installed" : status.state === "unreadable" ? "unreadable" : "none"}`,
      );
      const mark = el("i", "agent-hooks-mark");
      mark.setAttribute("aria-hidden", "true");
      state.append(mark, t.statusLine[status.state]);
      const path = el(
        "span",
        "agent-hooks-path terminal-mono",
        status.symlink
          ? `${abbreviateHome(status.path, home)} → ${abbreviateHome(realPath, home)}`
          : abbreviateHome(status.path, home),
      );
      path.title = [status.path, realPath].join("\n");
      const actions = el("span", "agent-accounts-actions");
      const canAct =
        status.state !== "unreadable" && status.state !== "no-config-dir";
      if (canAct) {
        const action = on && !status.wrapperMissing ? "uninstall" : "install";
        const button = el(
          "button",
          "gdp-btn gdp-btn-sm",
          action === "install" ? t.statusLineInstall : t.statusLineUninstall,
        );
        button.type = "button";
        button.disabled = busy;
        button.addEventListener(
          "click",
          () =>
            void run(`statusline:${realPath}`, () =>
              reviewStatusLine(first, action),
            ),
        );
        actions.appendChild(button);
      }
      box.append(
        el("span", "agent-hooks-name", "claude"),
        el(
          "span",
          "agent-accounts-name",
          members.map((member) => accountDisplayName(member, t)).join(", "),
        ),
        state,
        path,
        actions,
      );
      const details: string[] = [];
      if (status.command) details.push(t.statusLineCommand(status.command));
      if (status.wrapperMissing) details.push(t.statusLineWrapperMissing);
      if (status.detail) details.push(status.detail);
      if (details.length > 0) {
        box.appendChild(
          el(
            "p",
            `agent-hooks-detail${status.state === "unreadable" || status.wrapperMissing ? " agent-hooks-detail-problem" : ""}`,
            details.join("\n"),
          ),
        );
      }
      const result = results.get(`statusline:${realPath}`);
      if (result) box.appendChild(resultLine(result));
      usageRows.appendChild(box);
    }
  }

  function render(): void {
    const t = text();
    const { data, error } = deps.client.snapshot();
    title.textContent = t.sectionTitle;
    intro.textContent = t.sectionIntro;
    addButton.textContent = t.add;
    addButton.disabled = busy;
    usageTitle.textContent = t.usageTitle;
    usageIntro.textContent = t.usageIntro;
    commandsTitle.textContent = t.commandsTitle;
    commandsIntro.textContent = t.commandsIntro;
    commandsSave.textContent = t.commandsSave;
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
    rows.replaceChildren();
    if (!data) {
      if (!error) rows.appendChild(el("p", "scope-settings-help", t.loading));
      usageRows.replaceChildren();
      failures.hidden = true;
      return;
    }
    for (const account of data.accounts) {
      rows.appendChild(accountRow(account, data.home));
    }
    renderUsage(data.accounts, data.home);
    failures.hidden = data.usageFailures.total === 0;
    failuresSummary.textContent = t.usageFailures(data.usageFailures.total);
    failuresBody.textContent = data.usageFailures.recent.join("\n");
    failuresLog.textContent = t.usageFailuresLog(data.usageFailures.log);
    if (!commandsDirty) {
      commandInputs.claude.value = data.launchCommands.claude;
      commandInputs.codex.value = data.launchCommands.codex;
    }
    commandsSave.disabled = busy || !commandsDirty;
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
      commandsDirty = true;
      commandsSave.disabled = busy;
    });
  }
  commandsSave.addEventListener(
    "click",
    () =>
      void run("commands", async () => {
        await deps.client.savePreferences({
          claude: commandInputs.claude.value,
          codex: commandInputs.codex.value,
        });
        commandsDirty = false;
        sectionMessage = { ok: true, text: text().commandsSaved };
        return null;
      }),
  );
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
  });

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
  return { element, refresh, localize: render };
}
