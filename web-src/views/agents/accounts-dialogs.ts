// アカウントを足す・外す・ログインする・エージェントを起動する画面。
// エージェント一覧の帯と設定画面の節の両方から呼ぶ。
//
// 見た目は既存の部品だけを使う: 入力はワークツリーの追加の画面と同じ
// (worktree-form / worktree-field / gdp-dialog-input / seg)、確認の画面は
// フックの入れ外しと同じ (agent-hooks-dialog-*)。書く前に「どこに何が
// 作られ、何がどこへリンクされるか」を見せ、見せた計画をそのまま送る。

import {
  type AccountAgent,
  type AccountEntry,
  type AccountStatus,
  type AccountsResponse,
  type CreateAccountPlan,
  defaultLaunchSession,
  launchCommandLine,
  type RegisterAccountPlan,
  type ShareEntry,
  tmuxSessionName,
} from "../../core/agent-accounts";
import type { AgentOverviewResponse } from "../../core/agent-overview";
import { abbreviateHome } from "../../core/agent-overview";
import { showFormDialog } from "../ui-dialog";
import type { AccountsClient } from "./accounts-client";
import type { AccountsText } from "./accounts-i18n";

export type AccountDialogDeps = {
  client: AccountsClient;
  getText(): AccountsText;
  /** そのペインを下のターミナルパネルで開く。 */
  openPane(pane: string): void;
  /** エージェント一覧の最新 (件数・プロジェクト・セッションの既定に使う)。 */
  getOverview(): AgentOverviewResponse | null;
  /** このサーバのリポジトリ (一覧に無くても起動先に選べる)。 */
  serverRoot(): string;
  /** 一覧をすぐ取り直す (起動した行を出すため)。 */
  refreshOverview(): Promise<void>;
};

/** 要素を 1 つ作る (帯と設定の節も使う)。 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function field(label: string, control: HTMLElement, hint = ""): HTMLElement {
  const wrap = el("label", "worktree-field");
  wrap.append(el("span", "", label), control);
  if (hint) wrap.appendChild(el("span", "worktree-hint", hint));
  return wrap;
}

function input(value = "", placeholder = ""): HTMLInputElement {
  const node = el("input", "gdp-dialog-input");
  node.type = "text";
  node.value = value;
  node.placeholder = placeholder;
  node.spellcheck = false;
  return node;
}

function select(options: { value: string; label: string }[], value: string) {
  const node = el("select", "gdp-dialog-input");
  for (const option of options) {
    const item = el("option", "", option.label);
    item.value = option.value;
    node.appendChild(item);
  }
  node.value = value;
  return node;
}

/** 排他の選択 (既存の .seg)。 */
function segmented<T extends string>(
  choices: { value: T; label: string }[],
  initial: T,
  onChange?: (value: T) => void,
): { element: HTMLElement; value(): T } {
  const box = el("div", "seg");
  box.role = "radiogroup";
  let current = initial;
  const buttons = choices.map((choice) => {
    const button = el("button", "", choice.label);
    button.type = "button";
    button.role = "radio";
    button.addEventListener("click", () => {
      current = choice.value;
      sync();
      onChange?.(current);
    });
    box.appendChild(button);
    return { button, choice };
  });
  function sync() {
    for (const { button, choice } of buttons) {
      const on = choice.value === current;
      button.classList.toggle("active", on);
      button.setAttribute("aria-checked", String(on));
    }
  }
  sync();
  return { element: box, value: () => current };
}

/** 見出し付きの値。フックの確認の画面と同じ部品。 */
export function labeled(
  label: string,
  value: string,
  block = false,
): HTMLElement {
  const box = el(
    "div",
    block ? "agent-hooks-dialog-block" : "agent-hooks-dialog-field",
  );
  box.appendChild(el("span", "agent-hooks-dialog-label", label));
  const code = el(
    block ? "pre" : "code",
    block ? "agent-hooks-dialog-code terminal-mono" : "terminal-mono",
    value,
  );
  box.appendChild(code);
  return box;
}

function notes(lines: string[]): HTMLElement {
  const list = el("ul", "agent-hooks-dialog-notes");
  for (const line of lines) list.appendChild(el("li", "", line));
  return list;
}

/** 操作の結果の 1 文 (成功は status、失敗は alert)。 */
export function resultLine(result: { ok: boolean; text: string }): HTMLElement {
  const out = el(
    "p",
    `agent-hooks-result ${result.ok ? "agent-hooks-result-ok" : "agent-hooks-result-error"}`,
    result.text,
  );
  out.setAttribute("role", result.ok ? "status" : "alert");
  return out;
}

export function accountDisplayName(
  account: Pick<AccountEntry, "builtin" | "name">,
  text: AccountsText,
): string {
  return account.builtin ? text.defaultName : account.name;
}

/** そのアカウントで動いているペインの数。 */
export function runningCount(
  overview: AgentOverviewResponse | null,
  account: Pick<AccountEntry, "id">,
): number {
  return (overview?.panes ?? []).filter(
    (pane) =>
      pane.account &&
      (pane.account.kind === "default" || pane.account.kind === "registered") &&
      pane.account.id === account.id,
  ).length;
}

export type AccountDialogs = {
  add(prefill?: { agent: AccountAgent; path: string }): Promise<string | null>;
  remove(account: AccountStatus): Promise<string | null>;
  login(account: AccountEntry): Promise<string>;
  launch(options?: { project?: string }): Promise<string | null>;
};

export function createAccountDialogs(deps: AccountDialogDeps): AccountDialogs {
  function text(): AccountsText {
    return deps.getText();
  }

  /**
   * 作る前の確認。既定の設定ディレクトリの直下にあるものを 3 つに分けて
   * 見せ、共有するものを選ばせる。「作るリンク」は選択に合わせて変わる。
   * 選んだ名前はサーバでも検査する (画面の検査に頼らない)。
   */
  function createPlanBody(
    plan: CreateAccountPlan,
    home: string,
  ): { body: HTMLElement; selected(): string[] } {
    const t = text();
    const body = el("div", "agent-hooks-dialog");
    body.appendChild(
      labeled(t.createDir, abbreviateHome(plan.configDir, home)),
    );
    const boxes = new Map<string, HTMLInputElement>();
    const preview = el("pre", "agent-hooks-dialog-code terminal-mono");
    const displayName = (entry: ShareEntry) =>
      entry.directory ? `${entry.name}/` : entry.name;

    function group(
      title: string,
      entries: ShareEntry[],
      why: (entry: ShareEntry) => string,
    ): HTMLElement {
      const box = el("div", "agent-accounts-share");
      box.appendChild(el("span", "agent-hooks-dialog-label", title));
      const list = el("div", "agent-accounts-share-list");
      for (const entry of entries) {
        const item = el("label", "agent-accounts-share-item");
        const input = el("input");
        input.type = "checkbox";
        input.checked = entry.category === "shared";
        input.addEventListener("change", syncPreview);
        boxes.set(entry.name, input);
        const name = el("span", "terminal-mono", displayName(entry));
        name.title = entry.target;
        item.append(input, name);
        const reason = why(entry);
        if (reason)
          item.appendChild(el("span", "agent-accounts-share-why", reason));
        list.appendChild(item);
      }
      box.appendChild(list);
      return box;
    }

    const shared = plan.entries.filter((entry) => entry.category === "shared");
    const optional = plan.entries.filter(
      (entry) => entry.category === "optional",
    );
    const blocked = plan.entries.filter(
      (entry) => entry.category === "blocked",
    );
    if (shared.length > 0) {
      body.appendChild(group(t.shareShared, shared, () => ""));
    }
    if (optional.length > 0) {
      body.appendChild(
        group(t.shareOptional, optional, () => t.shareOptionalWhy),
      );
    }
    if (blocked.length > 0) {
      // 選べないものは畳んでおく (多くても画面を埋めない)。
      const details = el("details", "agent-hooks-dialog-details");
      details.appendChild(el("summary", "", t.shareBlocked(blocked.length)));
      details.appendChild(
        el(
          "pre",
          "agent-hooks-dialog-code terminal-mono",
          blocked
            .map(
              (entry) =>
                `${displayName(entry)}  — ${t.blockedWhy[entry.reason ?? "suspect"]}`,
            )
            .join("\n"),
        ),
      );
      body.appendChild(details);
    }
    const links = el("div", "agent-hooks-dialog-block");
    links.append(
      el("span", "agent-hooks-dialog-label", t.createLinks),
      preview,
    );
    body.appendChild(links);

    function selected(): string[] {
      return [...boxes]
        .filter(([, input]) => input.checked)
        .map(([name]) => name);
    }
    function syncPreview(): void {
      const chosen = new Set(selected());
      const lines = plan.entries
        .filter((entry) => chosen.has(entry.name))
        .map(
          (entry) =>
            `${displayName(entry)}  →  ${abbreviateHome(entry.target, home)}`,
        );
      preview.textContent = lines.length > 0 ? lines.join("\n") : t.shareNone;
    }
    syncPreview();

    const lines: string[] = [];
    if (plan.missingShared.length > 0) {
      lines.push(t.createLinkMissing(plan.missingShared.join(", ")));
    }
    if (plan.authKeysInShared.length > 0) {
      lines.push(t.createAuthKeys(plan.authKeysInShared.join(", ")));
    }
    lines.push(t.createAfter);
    body.appendChild(notes(lines));
    return { body, selected };
  }

  function registerPlanBody(plan: RegisterAccountPlan): HTMLElement {
    const t = text();
    const body = el("div", "agent-hooks-dialog");
    body.appendChild(labeled(t.addPath, plan.configDir));
    body.appendChild(notes([t.registerBody]));
    return body;
  }

  async function add(prefill?: {
    agent: AccountAgent;
    path: string;
  }): Promise<string | null> {
    const t = text();
    const home = deps.client.snapshot().data?.home ?? "";
    const body = el("div", "worktree-form");
    const kind = segmented<AccountAgent>(
      [
        { value: "claude", label: "claude" },
        { value: "codex", label: "codex" },
      ],
      prefill?.agent ?? "claude",
    );
    const name = input("", t.addNamePlaceholder);
    const modeHelp = el("span", "worktree-hint");
    const path = input(prefill?.path ?? "", "/");
    const pathField = field(t.addPath, path);
    const mode = segmented<"create" | "register">(
      [
        { value: "create", label: t.addModeCreate },
        { value: "register", label: t.addModeRegister },
      ],
      prefill ? "register" : "create",
      () => syncMode(),
    );
    function syncMode() {
      const creating = mode.value() === "create";
      modeHelp.textContent = creating
        ? t.addModeCreateHelp
        : t.addModeRegisterHelp;
      pathField.hidden = creating;
    }
    body.append(
      field(t.addKind, kind.element),
      field(t.addName, name),
      field(t.addMode, mode.element),
      modeHelp,
      pathField,
    );
    syncMode();
    const choice = await showFormDialog({
      title: t.addTitle,
      body,
      wide: true,
      submitLabel: t.addNext,
      cancelLabel: t.cancel,
      focusTarget: name,
      validate: () => {
        if (!name.value.trim()) return t.addNameRequired;
        if (mode.value() === "register" && !path.value.trim().startsWith("/")) {
          return t.addPathRequired;
        }
        return null;
      },
      submit: async () => {
        // 計画は書かない。失敗 (名前・パスの問題) はこの画面に出す。
        if (mode.value() === "create") {
          return {
            kind: "create" as const,
            plan: await deps.client.planCreate(kind.value(), name.value.trim()),
          };
        }
        return {
          kind: "register" as const,
          plan: await deps.client.planRegister(
            kind.value(),
            name.value.trim(),
            path.value.trim(),
          ),
        };
      },
    });
    if (!choice) return null;
    if (choice.kind === "create") {
      const plan = choice.plan;
      const view = createPlanBody(plan, home);
      const done = await showFormDialog({
        title: t.createTitle(plan.name),
        body: view.body,
        wide: true,
        submitLabel: t.createRun,
        cancelLabel: t.cancel,
        submit: async () => {
          await deps.client.create(plan, view.selected());
          return t.added(plan.name);
        },
      });
      return done;
    }
    const plan = choice.plan;
    if (!plan.exists || !plan.isDirectory) {
      await showFormDialog({
        title: t.registerTitle(plan.name),
        body: notes([
          plan.exists
            ? t.registerNotDir(plan.configDir)
            : t.registerMissing(plan.configDir),
        ]),
        submitLabel: t.close,
        cancelLabel: t.cancel,
        submit: () => null,
      });
      return null;
    }
    return showFormDialog({
      title: t.registerTitle(plan.name),
      body: registerPlanBody(plan),
      wide: true,
      submitLabel: t.registerRun,
      cancelLabel: t.cancel,
      submit: async () => {
        await deps.client.register(plan);
        return t.added(plan.name);
      },
    });
  }

  async function remove(account: AccountStatus): Promise<string | null> {
    const t = text();
    const running = runningCount(deps.getOverview(), account);
    const lines = [t.removeBody(account.configDir)];
    if (running > 0) lines.push(t.removeRunning(running));
    if (account.managed) lines.push(t.removeManaged(account.configDir));
    return showFormDialog({
      title: t.removeDialogTitle(account.name),
      body: notes(lines),
      wide: true,
      danger: true,
      submitLabel: t.removeConfirm,
      cancelLabel: t.cancel,
      submit: async () => {
        await deps.client.remove(account.id);
        return t.removed(account.name);
      },
    });
  }

  async function login(account: AccountEntry): Promise<string> {
    const t = text();
    const pane = await deps.client.login(account.id);
    deps.openPane(pane.paneId);
    return t.loginStarted(pane.session);
  }

  /** 起動先に選べるプロジェクト。一覧に出ているものと、このサーバのもの。 */
  function projectChoices(): { value: string; label: string }[] {
    const t = text();
    const home = deps.client.snapshot().data?.home ?? "";
    const root = deps.serverRoot();
    const out = new Map<string, string>();
    const serverName = root.split("/").filter(Boolean).pop() ?? root;
    if (root) out.set(root, t.currentServerProject(serverName));
    for (const project of deps.getOverview()?.projects ?? []) {
      if (!project.git || out.has(project.root)) continue;
      out.set(
        project.root,
        `${project.name}  ${abbreviateHome(project.root, home)}`,
      );
    }
    return [...out].map(([value, label]) => ({ value, label }));
  }

  async function launch(options: { project?: string } = {}) {
    const t = text();
    const data: AccountsResponse | null = deps.client.snapshot().data;
    const accounts = data?.accounts ?? [];
    const last = data?.lastLaunch ?? null;
    const projects = projectChoices();
    const body = el("div", "worktree-form");
    if (projects.length === 0) {
      body.appendChild(el("p", "worktree-hint", t.launchNoProjects));
    }
    const initialAgent: AccountAgent = last?.agent ?? "claude";
    const accountSelect = select([], "");
    const projectSelect = select(
      projects,
      options.project ??
        (last && projects.some((p) => p.value === last.project)
          ? last.project
          : (projects[0]?.value ?? "")),
    );
    const session = input();
    const sessionHint = el("span", "worktree-hint");
    const loginHint = el("span", "worktree-hint");
    const preview = el("code", "terminal-mono worktree-hint");
    const kind = segmented<AccountAgent>(
      [
        { value: "claude", label: "claude" },
        { value: "codex", label: "codex" },
      ],
      initialAgent,
      () => {
        fillAccounts();
        syncPreview();
      },
    );
    let sessionTouched = false;

    function fillAccounts() {
      const agent = kind.value();
      const choices = accounts
        .filter((account) => account.agent === agent)
        .map((account) => ({
          value: account.id,
          label: `${accountDisplayName(account, t)}  ${abbreviateHome(account.configDir, data?.home ?? "")}`,
        }));
      accountSelect.replaceChildren();
      for (const choice of choices) {
        const option = el("option", "", choice.label);
        option.value = choice.value;
        accountSelect.appendChild(option);
      }
      const remembered =
        last?.agent === agent &&
        choices.some((choice) => choice.value === last.accountId)
          ? last.accountId
          : (choices[0]?.value ?? "");
      accountSelect.value = remembered;
    }

    function syncSession() {
      if (sessionTouched) return;
      const project = projectSelect.value;
      const panes = deps.getOverview()?.panes ?? [];
      const name = project.split("/").filter(Boolean).pop() ?? "agents";
      const fallback =
        last?.project === project && last.session
          ? last.session
          : tmuxSessionName(name);
      session.value = defaultLaunchSession(project, panes, fallback).session;
    }

    function syncPreview() {
      const panes = deps.getOverview()?.panes ?? [];
      const exists = panes.some(
        (pane) => pane.session === session.value.trim(),
      );
      sessionHint.textContent = exists
        ? t.launchSessionExisting
        : t.launchSessionNew;
      const account = accounts.find((item) => item.id === accountSelect.value);
      const agent = kind.value();
      const command = data?.launchCommands[agent] ?? agent;
      preview.textContent = t.launchPreview(
        launchCommandLine(
          agent,
          !account || account.builtin ? null : account.configDir,
          command,
          data?.home ?? "",
        ),
      );
      loginHint.textContent =
        account?.login.state === "logged-out" ? t.launchNeedsLogin : "";
      loginHint.hidden = loginHint.textContent === "";
    }

    fillAccounts();
    syncSession();
    syncPreview();
    accountSelect.addEventListener("change", syncPreview);
    projectSelect.addEventListener("change", () => {
      syncSession();
      syncPreview();
    });
    session.addEventListener("input", () => {
      sessionTouched = true;
      syncPreview();
    });
    body.append(
      field(t.launchKind, kind.element),
      field(t.launchAccount, accountSelect),
      loginHint,
      field(t.launchProject, projectSelect),
      field(t.launchSession, session, ""),
      sessionHint,
      preview,
    );

    return showFormDialog({
      title: t.launchTitle,
      body,
      wide: true,
      submitLabel: t.launchRun,
      cancelLabel: t.cancel,
      focusTarget: accountSelect,
      validate: () => {
        if (!accountSelect.value || !projectSelect.value) {
          return t.launchNoProjects;
        }
        return session.value.trim() ? null : t.launchSession;
      },
      submit: async () => {
        const result = await deps.client.launch({
          accountId: accountSelect.value,
          project: projectSelect.value,
          session: session.value.trim(),
        });
        deps.openPane(result.paneId);
        await Promise.all([deps.refreshOverview(), deps.client.load()]);
        const message = t.launchStarted(result.session);
        return result.rememberError
          ? `${message}\n${t.launchRememberFailed}\n${result.rememberError}`
          : message;
      },
    });
  }

  return { add, remove, login, launch };
}
