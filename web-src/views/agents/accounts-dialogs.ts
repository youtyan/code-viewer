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
  emptyAccountRegistry,
  handoffArgs,
  handoffPrompt,
  isAccountAgent,
  launchCommandLine,
  type RegisterAccountPlan,
  renameAccount,
  type ShareEntry,
  tmuxSessionName,
  usageWindowViews,
} from "../../core/agent-accounts";
import type {
  AgentOverviewResponse,
  AgentPane,
} from "../../core/agent-overview";
import { abbreviateHome } from "../../core/agent-overview";
import { showCopyFailure } from "../../core/copy-failure";
import { formatErrorDetail } from "../../core/error-detail";
import { CHEVRON_DOWN_16_PATH, COPY_16_PATHS, iconSvg } from "../../core/icons";
import { showFormDialog } from "../ui-dialog";
import type { AccountsClient } from "./accounts-client";
import type { AccountsText } from "./accounts-i18n";
import { usageMeterRow, usageObservedText } from "./usage-meter";

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

/**
 * 起動の画面の 1 行: 左に見出し、右に選ぶもの (下に補足)。選ぶものが 1 つの
 * 入力なら label で包む。ボタンを並べたもの (種類・アカウント) は div にする。
 * label が指せるのは先頭のボタンだけで、happy-dom では押したボタンの代わりに
 * 先頭のボタンが押されていた。
 */
function launchRow(
  label: string,
  control: HTMLElement,
  hint?: HTMLElement,
  tag: "label" | "div" = "label",
): HTMLElement {
  const row = el(tag, "agent-launch-row");
  const value = el("span", "agent-launch-value");
  value.appendChild(control);
  if (hint) value.appendChild(hint);
  row.append(el("span", "agent-launch-label", label), value);
  return row;
}

function launchPreviewBlock(
  label: string,
  frame: HTMLElement,
  result: HTMLElement,
): HTMLElement {
  const box = el("div", "agent-launch-preview-block");
  box.append(el("span", "agent-launch-label", label), frame, result);
  return box;
}

/**
 * 名前と補足 (設定の場所・パス) の 2 段で見せる選択の欄 (絵の Account /
 * Project)。選ぶのは下に重ねた本物の select (キー操作・読み上げはそのまま)。
 */
function twoLineChoice(node: HTMLSelectElement): {
  element: HTMLElement;
  show(name: string, detail: string): void;
} {
  const box = el("span", "agent-launch-choice");
  const name = el("span", "agent-launch-choice-name");
  const detail = el("span", "agent-launch-choice-detail");
  const chevron = el("span", "agent-launch-choice-chevron");
  chevron.setAttribute("aria-hidden", "true");
  chevron.innerHTML = iconSvg("octicon-chevron-down", CHEVRON_DOWN_16_PATH);
  node.classList.add("agent-launch-choice-select");
  box.append(name, detail, chevron, node);
  return {
    element: box,
    show(nameText, detailText) {
      name.textContent = nameText;
      detail.textContent = detailText;
      detail.hidden = detailText === "";
    },
  };
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

/** 起動の画面で、選んだアカウントのログインについて先に言っておくこと。 */
function launchLoginHint(
  account: AccountStatus | undefined,
  t: AccountsText,
): string {
  switch (account?.login.state) {
    case "logged-out":
      return t.launchNeedsLogin;
    case "no-config-dir":
      return t.launchNotSetUp;
    case "unknown":
      return t.launchLoginUnknown(account.login.detail);
    default:
      return "";
  }
}

/**
 * ペインのエージェントが使っているアカウントの名前 (全体ボードの行と、
 * 引き継ぎの指示文の「前の担当」)。
 */
export function paneAccountName(
  pane: Pick<AgentPane, "account">,
  data: AccountsResponse | null,
  text: AccountsText,
): string {
  const account = pane.account;
  if (!account) return "";
  if (account.kind === "default") return text.defaultName;
  if (account.kind === "registered") {
    return (
      data?.accounts.find((item) => item.id === account.id)?.name ?? account.id
    );
  }
  return account.kind === "unregistered"
    ? text.unregistered
    : text.unknownAccount;
}

export function accountDisplayName(
  account: Pick<AccountEntry, "builtin" | "name">,
  text: AccountsText,
): string {
  return account.builtin ? text.defaultName : account.name;
}

/** プランの表示 (max → Max)。無ければ空。 */
export function planLabel(plan: string): string {
  return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : "";
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
  rename(account: AccountStatus): Promise<string | null>;
  login(account: AccountEntry): Promise<string>;
  launch(options?: LaunchOptions): Promise<string | null>;
};

export type LaunchOptions = {
  /** 選んでおくプロジェクト。 */
  project?: string;
  /**
   * 「別のアカウントで続ける」: 前の担当のペイン。会話記録の場所
   * (conversation.transcriptPath) を持つものだけを渡す (views/agents/handoff.ts)。
   */
  handoff?: AgentPane;
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
    const source = abbreviateHome(plan.defaultDir, home);
    body.appendChild(
      labeled(t.createDir, abbreviateHome(plan.configDir, home)),
    );
    body.appendChild(labeled(t.createSource, source));
    // 一覧の名前 (.cc-writes/ など) がどこの何かを、一覧の前に 1 回だけ言う。
    body.appendChild(
      el("p", "agent-accounts-share-intro", t.shareIntro(source)),
    );
    const boxes = new Map<string, HTMLInputElement>();
    const preview = el("pre", "agent-hooks-dialog-code terminal-mono");
    const displayName = (entry: ShareEntry) =>
      entry.directory ? `${entry.name}/` : entry.name;

    function group(
      title: string,
      entries: ShareEntry[],
      why = "",
    ): HTMLElement {
      const box = el("div", "agent-accounts-share");
      box.appendChild(el("span", "agent-hooks-dialog-label", title));
      // 理由はまとまりに 1 回だけ (行ごとに同じ文を繰り返すと、名前が読めない)。
      if (why) box.appendChild(el("p", "agent-accounts-share-why", why));
      const list = el("div", "agent-accounts-share-list");
      for (const entry of entries) {
        const item = el("label", "agent-accounts-share-item");
        const input = el("input");
        input.type = "checkbox";
        input.checked = entry.category === "shared";
        input.addEventListener("change", syncPreview);
        boxes.set(entry.name, input);
        const name = el("span", "terminal-mono", displayName(entry));
        name.title = abbreviateHome(entry.target, home);
        item.append(input, name);
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
      body.appendChild(group(t.shareShared, shared));
    }
    if (optional.length > 0) {
      body.appendChild(group(t.shareOptional, optional, t.shareOptionalWhy));
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

  /**
   * 表示名を変える。押す前の検査はサーバと同じ規則 (renameAccount) を、いま
   * 見えている一覧に当てる。一覧が古くてもサーバが同じ理由で断り、その理由は
   * ダイアログに出る。
   */
  async function rename(account: AccountStatus): Promise<string | null> {
    const t = text();
    const name = input(account.name);
    name.setAttribute("aria-label", t.renameLabel);
    const body = el("div", "worktree-form");
    body.appendChild(field(t.renameLabel, name));
    const listed = (deps.client.snapshot().data?.accounts ?? []).filter(
      (entry) => !entry.builtin,
    );
    const registry = {
      ...emptyAccountRegistry(),
      accounts: listed.map((entry) => ({
        id: entry.id,
        agent: entry.agent,
        name: entry.name,
        configDir: entry.configDir,
        managed: entry.managed,
        createdAt: 0,
      })),
    };
    return showFormDialog({
      title: t.renameDialogTitle(account.name),
      description: t.renameDescription,
      body,
      focusTarget: name,
      submitLabel: t.renameConfirm,
      cancelLabel: t.cancel,
      validate: () => {
        const result = renameAccount(registry, account.id, name.value);
        if (result.ok !== false) return null;
        switch (result.code) {
          case "name":
            return result.issue === "empty" ? t.renameEmpty : null;
          case "reserved":
            return t.renameReserved(name.value.trim());
          case "duplicate":
            return t.renameDuplicate(result.existing, account.agent);
          default:
            // 一覧に無い・既定: サーバに送って、その理由を出す。
            return null;
        }
      },
      submit: async () => {
        const renamed = await deps.client.rename(account.id, name.value);
        return t.renamed(account.name, renamed.name);
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

  async function launch(options: LaunchOptions = {}) {
    const t = text();
    const initialData: AccountsResponse | null = deps.client.snapshot().data;
    /** 開いている間に届いた一覧 (使用量・ログインの取り直し) を読む。 */
    const currentData = () => deps.client.snapshot().data ?? initialData;
    const last = initialData?.lastLaunch ?? null;
    const handoff = options.handoff ?? null;
    const transcriptPath = handoff?.conversation?.transcriptPath ?? "";
    if (handoff && !transcriptPath) {
      throw new Error(
        `launch dialog: ${handoff.id} has no conversation log to hand over`,
      );
    }
    const fromAgent =
      handoff && isAccountAgent(handoff.kind) ? handoff.kind : null;
    const fromAccountId =
      handoff?.account &&
      (handoff.account.kind === "default" ||
        handoff.account.kind === "registered")
        ? handoff.account.id
        : null;
    const fromAccountName = handoff
      ? paneAccountName(handoff, initialData, t)
      : "";
    const projects = projectChoices();
    // 引き継ぎは前の担当のフォルダで起動する (一覧に無ければ候補に足す)。
    const handoffProject = handoff
      ? handoff.conversation?.cwd || handoff.path
      : "";
    if (handoffProject && !projects.some((p) => p.value === handoffProject)) {
      projects.unshift({
        value: handoffProject,
        label: abbreviateHome(handoffProject, initialData?.home ?? ""),
      });
    }
    const body = el("div", "agent-launch-form");
    if (projects.length === 0) {
      body.appendChild(el("p", "worktree-hint", t.launchNoProjects));
    }
    const initialAgent: AccountAgent = fromAgent ?? last?.agent ?? "claude";
    let selectedAccount = "";
    const accountList = el("div", "agent-launch-accounts");
    accountList.role = "radiogroup";
    accountList.setAttribute("aria-label", t.launchAccount);
    const projectSelect = select(
      projects,
      handoffProject ||
        options.project ||
        (last && projects.some((p) => p.value === last.project)
          ? last.project
          : (projects[0]?.value ?? "")),
    );
    const projectChoice = twoLineChoice(projectSelect);
    const home = initialData?.home ?? "";
    /** 選んでいるプロジェクトを、欄の 2 段 (名前・場所) に出す。 */
    function syncProjectChoice() {
      const project = projects.find((p) => p.value === projectSelect.value);
      projectChoice.show(
        project?.label ?? "",
        project ? abbreviateHome(project.value, home) : "",
      );
    }
    const session = input(handoff?.session ?? "");
    const sessionHint = el("span", "worktree-hint");
    const loginHint = el("span", "worktree-hint");
    // 実行するコマンド。途中を隠さず、長ければ枠の中で横にスクロールする。
    const preview = el("code", "agent-launch-preview-text terminal-mono");
    const previewFrame = el("div", "agent-launch-preview");
    const copy = el("button", "agents-icon-action agent-launch-copy");
    copy.type = "button";
    copy.innerHTML = iconSvg("octicon-copy", COPY_16_PATHS);
    copy.title = t.launchCopy;
    copy.setAttribute("aria-label", t.launchCopy);
    const copyResult = el("span", "worktree-hint agent-launch-copy-result");
    copyResult.setAttribute("role", "status");
    copy.addEventListener("click", () => {
      navigator.clipboard.writeText(preview.textContent ?? "").then(
        () => {
          copyResult.textContent = t.launchCopied;
        },
        (error: unknown) => {
          // ほかの画面のコピーと同じ形 (ボタンに失敗の見た目と理由、console に
          // 全体)。状態の行にも、message だけでなく名前と原因の連鎖を出す。
          showCopyFailure(
            copy,
            "copying the launch command failed",
            error,
            t.launchCopy,
            1500,
          );
          copyResult.textContent = `${t.launchCopyFailed}: ${formatErrorDetail(error)}`;
        },
      );
    });
    previewFrame.append(preview, copy);
    const kind = segmented<AccountAgent>(
      [
        { value: "claude", label: "claude" },
        { value: "codex", label: "codex" },
      ],
      initialAgent,
      () => {
        chooseAccount();
        syncPreview();
      },
    );
    // 引き継ぎのときは前の担当と同じセッション (新しいウィンドウ)。
    let sessionTouched = handoff !== null;

    /** 選んでいる種類のアカウント。 */
    function accountsOfKind(): AccountStatus[] {
      return (currentData()?.accounts ?? []).filter(
        (account) => account.agent === kind.value(),
      );
    }

    /**
     * 種類を変えたときの既定の選択。引き継ぎなら前の担当と違うアカウント、
     * そうでなければ前回の起動のアカウント、無ければ先頭。
     */
    function chooseAccount() {
      const agent = kind.value();
      const choices = accountsOfKind();
      const other = handoff
        ? choices.find((account) => account.id !== fromAccountId)
        : undefined;
      const remembered =
        last?.agent === agent &&
        choices.some((account) => account.id === last.accountId)
          ? last.accountId
          : "";
      selectedAccount = other?.id || remembered || (choices[0]?.id ?? "");
    }

    /**
     * アカウントの一覧。各行に 5 時間・週の使用量と「いつの値か」を並べ、
     * 空いているアカウントを選びやすくする (部品は全体ボードの帯と同じ
     * usage-meter.ts)。行は radio で、上下の矢印で選び直せる。
     */
    function renderAccounts() {
      const now = Date.now();
      const choices = accountsOfKind();
      if (choices.length === 0) {
        accountList.replaceChildren(
          el("span", "worktree-hint", t.launchNoAccounts),
        );
        return;
      }
      const focused = accountList.contains(document.activeElement);
      const items = choices.map((account) => {
        const on = account.id === selectedAccount;
        const item = el("button", "agent-launch-account");
        item.type = "button";
        item.role = "radio";
        item.dataset.account = account.id;
        item.setAttribute("aria-checked", String(on));
        item.tabIndex = on ? 0 : -1;
        item.classList.toggle("active", on);
        const head = el("span", "agent-launch-account-head");
        head.appendChild(
          el(
            "span",
            "agent-launch-account-name",
            accountDisplayName(account, t),
          ),
        );
        if (handoff && account.id === fromAccountId) {
          head.appendChild(
            el("span", "agent-launch-account-current", t.handoffCurrent),
          );
        }
        const observed = usageObservedText(
          account.usage,
          account.login,
          now,
          t,
        );
        const when = el(
          "span",
          `agent-launch-account-observed${observed.stale ? " stale" : ""}`,
          observed.text,
        );
        if (observed.title) when.title = observed.title;
        head.appendChild(when);
        item.append(
          head,
          el(
            "span",
            "agent-launch-account-dir",
            abbreviateHome(account.configDir, currentData()?.home ?? ""),
          ),
          accountUsage(account, now),
        );
        item.addEventListener("click", () => pickAccount(account.id));
        item.addEventListener("keydown", (event) => {
          const step =
            event.key === "ArrowDown" || event.key === "ArrowRight"
              ? 1
              : event.key === "ArrowUp" || event.key === "ArrowLeft"
                ? -1
                : 0;
          if (step === 0) return;
          event.preventDefault();
          const index = choices.findIndex((c) => c.id === account.id);
          const next =
            choices[(index + step + choices.length) % choices.length];
          if (next) pickAccount(next.id, true);
        });
        return item;
      });
      accountList.replaceChildren(...items);
      if (focused) selectedAccountItem()?.focus();
    }

    /** 1 アカウントの使用量 (未ログイン・取れないときは理由の 1 行)。 */
    function accountUsage(account: AccountStatus, now: number): HTMLElement {
      const box = el("span", "agent-launch-account-usage");
      if (account.login.state === "logged-out") {
        box.appendChild(
          el("span", "agent-launch-account-status", t.login["logged-out"]),
        );
        return box;
      }
      const usage = account.usage;
      if (usage.status !== "ok") {
        const line = el(
          "span",
          "agent-launch-account-status",
          `${t.usageUnavailable} · ${t.usageReasonShort[usage.reason]}`,
        );
        line.title = [t.usageReason[usage.reason], usage.detail]
          .filter(Boolean)
          .join("\n");
        box.appendChild(line);
        return box;
      }
      for (const view of usageWindowViews(usage, now)) {
        box.appendChild(usageMeterRow(view, now, t, { reset: "remaining" }));
      }
      return box;
    }

    function selectedAccountItem(): HTMLElement | null {
      return accountList.querySelector<HTMLElement>(
        '.agent-launch-account[aria-checked="true"]',
      );
    }

    function pickAccount(id: string, focus = false) {
      selectedAccount = id;
      syncPreview();
      if (focus) selectedAccountItem()?.focus();
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

    /** 引き継ぎのときに起動コマンドの後ろに足す引数 (最初の指示など)。 */
    function handoffArgsFor(agent: AccountAgent): string[] {
      if (!fromAgent) return [];
      const prompt = handoffPrompt(t.language, {
        agent: fromAgent,
        account: fromAccountName,
        transcriptPath,
      });
      return handoffArgs(agent, prompt, transcriptPath);
    }

    /**
     * 表示するコマンドだけを描く。起動コマンドは開いた時点の写しではなく今の値
     * (別の画面で保存したものが、開き直すまで古いまま出ていた)。
     */
    function renderCommandPreview() {
      const current = currentData();
      const account = current?.accounts.find(
        (item) => item.id === selectedAccount,
      );
      const agent = kind.value();
      const command = current?.launchCommands[agent] ?? agent;
      preview.textContent = launchCommandLine(
        agent,
        !account || account.builtin ? null : account.configDir,
        command,
        current?.home ?? "",
        handoffArgsFor(agent),
      );
    }

    function syncPreview() {
      const panes = deps.getOverview()?.panes ?? [];
      const exists = panes.some(
        (pane) => pane.session === session.value.trim(),
      );
      sessionHint.textContent = exists
        ? t.launchSessionExisting
        : t.launchSessionNew;
      const account = currentData()?.accounts.find(
        (item) => item.id === selectedAccount,
      );
      renderAccounts();
      renderCommandPreview();
      copyResult.textContent = "";
      syncProjectChoice();
      loginHint.textContent = launchLoginHint(account, t);
      loginHint.hidden = loginHint.textContent === "";
    }

    chooseAccount();
    syncSession();
    syncPreview();
    projectSelect.addEventListener("change", () => {
      syncSession();
      syncPreview();
    });
    session.addEventListener("input", () => {
      sessionTouched = true;
      syncPreview();
    });
    if (handoff) {
      const log = el("span", "agent-launch-log terminal-mono");
      log.textContent = abbreviateHome(transcriptPath, home);
      log.title = transcriptPath;
      body.appendChild(
        launchRow(
          t.handoffLog,
          log,
          el("span", "worktree-hint", t.handoffLogHint),
        ),
      );
    }
    body.append(
      launchRow(t.launchKind, kind.element, undefined, "div"),
      launchRow(t.launchAccount, accountList, loginHint, "div"),
      launchRow(t.launchProject, projectChoice.element),
      launchRow(t.launchSession, session, sessionHint),
      launchPreviewBlock(t.launchPreviewLabel, previewFrame, copyResult),
    );

    // 開いている間に届いた一覧 (周期の取り直し) で、表示するコマンドと
    // 使用量を合わせ直す (コピーの結果の表示は消さない)。開いた時点でも 1 回
    // 取り直す (別の画面での保存を待たずに拾う)。
    const unsubscribe = deps.client.subscribe(() => {
      renderAccounts();
      renderCommandPreview();
    });
    void deps.client.load({ background: true });
    return showFormDialog({
      title: handoff ? t.handoffDialogTitle : t.launchTitle,
      description: handoff
        ? t.handoffIntro(`${fromAgent} · ${fromAccountName}`)
        : t.launchIntro,
      body,
      wide: true,
      submitLabel: handoff ? t.handoffRun : t.launchRun,
      cancelLabel: t.cancel,
      focusTarget: selectedAccountItem(),
      validate: () => {
        if (!selectedAccount) return t.launchNoAccounts;
        if (!projectSelect.value) return t.launchNoProjects;
        return session.value.trim() ? null : t.launchSession;
      },
      submit: async () => {
        const result = await deps.client.launch({
          accountId: selectedAccount,
          project: projectSelect.value,
          session: session.value.trim(),
          ...(handoff
            ? {
                handoff: {
                  pane: handoff.id,
                  language: t.language,
                  fromAccount: fromAccountName,
                },
              }
            : {}),
        });
        deps.openPane(result.paneId);
        await Promise.all([deps.refreshOverview(), deps.client.load()]);
        const message = t.launchStarted(result.session);
        return result.rememberError
          ? `${message}\n${t.launchRememberFailed}\n${result.rememberError}`
          : message;
      },
    }).finally(unsubscribe);
  }

  return { add, remove, rename, login, launch };
}
