// アカウントを足す・外す・ログインする・エージェントを起動する画面。
// エージェント一覧の帯と設定画面の節の両方から呼ぶ。
//
// 見た目は既存の部品だけを使う: 入力はワークツリーの追加の画面と同じ
// (worktree-form / worktree-field / gdp-dialog-input / seg)、確認の画面は
// フックの入れ外しと同じ (agent-hooks-dialog-*)。書く前に「どこに何が
// 作られ、何がどこへリンクされるか」を見せ、見せた計画をそのまま送る。

import { ifDefined } from "lit/directives/if-defined.js";
import { live } from "lit/directives/live.js";
import { html, nothing, type TemplateResult } from "lit/html.js";
import {
  type AccountAgent,
  type AccountEntry,
  type AccountStatus,
  type AccountsResponse,
  type AccountTagIssue,
  type CreateAccountPlan,
  checkAccountTags,
  defaultLaunchSession,
  emptyAccountRegistry,
  handoffArgs,
  handoffPrompt,
  isAccountAgent,
  type LaunchResponse,
  launchCommandLine,
  MAX_ACCOUNT_TAG,
  MAX_ACCOUNT_TAGS,
  renameAccount,
  type ShareEntry,
  type StatusLinePlanResponse,
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
import { CHEVRON_DOWN_16_PATH, COPY_16_PATHS } from "../../core/icons";
import type { ProjectColor } from "../../core/project-colors";
import { iconTemplate } from "../ui/icon";
import { renderOwned, templateElement } from "../ui/renderer";
import { showFormDialog } from "../ui-dialog";
import { createAccountTagEditor } from "./account-tags";
import type { AccountsClient } from "./accounts-client";
import type { AccountsText } from "./accounts-i18n";
import { settingsDiffTemplate } from "./settings-diff";
import { usageMeterTemplate, usageObservedText } from "./usage-meter";

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

/**
 * ダイアログの本文の箱を作り、draw() で中身を描き直す係を返す。本文の中で
 * 選び直したときに、その場で描き直す (箱はダイアログの層が置く)。
 */
function dialogBody(
  className: string,
  template: () => unknown,
): { element: HTMLElement; draw(): void } {
  const element = templateElement(html`<div class=${className}></div>`);
  const draw = () => renderOwned(element, template());
  draw();
  return { element, draw };
}

function fieldTemplate(
  label: string,
  control: unknown,
  options: { hint?: string; hidden?: boolean } = {},
): TemplateResult {
  return html`<label class="worktree-field" ?hidden=${!!options.hidden}><span>${label}</span>${control}${
    options.hint
      ? html`<span class="worktree-hint">${options.hint}</span>`
      : nothing
  }</label>`;
}

/**
 * 起動の画面の 1 行: 左に見出し、右に選ぶもの (下に補足)。選ぶものが 1 つの
 * 入力なら label で包む。ボタンを並べたもの (種類・アカウント) は div にする。
 * label が指せるのは先頭のボタンだけで、happy-dom では押したボタンの代わりに
 * 先頭のボタンが押されていた。
 */
function launchRowTemplate(
  label: string,
  control: unknown,
  hint: unknown = nothing,
  tag: "label" | "div" = "label",
): TemplateResult {
  const inner = html`<span class="agent-launch-label">${label}</span><span
      class="agent-launch-value"
    >${control}${hint}</span>`;
  return tag === "label"
    ? html`<label class="agent-launch-row">${inner}</label>`
    : html`<div class="agent-launch-row">${inner}</div>`;
}

/** 文字の入力欄 (値は呼び出し側が持つ)。 */
function inputTemplate(options: {
  value: string;
  placeholder?: string;
  ariaLabel?: string;
  onInput(value: string): void;
}): TemplateResult {
  return html`<input
    class="gdp-dialog-input"
    type="text"
    spellcheck="false"
    placeholder=${options.placeholder ?? ""}
    aria-label=${ifDefined(options.ariaLabel)}
    .value=${live(options.value)}
    @input=${(event: Event) =>
      options.onInput((event.currentTarget as HTMLInputElement).value)}
  />`;
}

/** 排他の選択 (既存の .seg を radiogroup として)。 */
function radioSegTemplate<T extends string>(
  choices: { value: T; label: string }[],
  current: T,
  onPick: (value: T) => void,
): TemplateResult {
  return html`<div class="seg" role="radiogroup">${choices.map((choice) => {
    const on = choice.value === current;
    return html`<button
      type="button"
      role="radio"
      class=${on ? "active" : ""}
      aria-checked=${String(on)}
      @click=${() => onPick(choice.value)}
    >${choice.label}</button>`;
  })}</div>`;
}

/** 見出し付きの値。フックの確認の画面と同じ部品。 */
export function labeledTemplate(
  label: string,
  value: string,
  block = false,
  title?: string,
): TemplateResult {
  return html`<div
    class=${block ? "agent-hooks-dialog-block" : "agent-hooks-dialog-field"}
    title=${ifDefined(title)}
  ><span class="agent-hooks-dialog-label">${label}</span>${
    block
      ? html`<pre class="agent-hooks-dialog-code terminal-mono">${value}</pre>`
      : html`<code class="terminal-mono">${value}</code>`
  }</div>`;
}

export function notesTemplate(lines: string[]): TemplateResult {
  return html`<ul class="agent-hooks-dialog-notes">${lines.map(
    (line) => html`<li>${line}</li>`,
  )}</ul>`;
}

/** 操作の結果の 1 文 (成功は status、失敗は alert)。 */
export function resultLineTemplate(result: {
  ok: boolean;
  text: string;
}): TemplateResult {
  return html`<p
    class=${`agent-hooks-result ${result.ok ? "agent-hooks-result-ok" : "agent-hooks-result-error"}`}
    role=${result.ok ? "status" : "alert"}
  >${result.text}</p>`;
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
  /** タグの付け外し (既定のアカウントにも)。戻り値は結果の文 (やめたら null)。 */
  tags(account: AccountStatus): Promise<string | null>;
  login(account: AccountEntry): Promise<string>;
  launch(options?: LaunchOptions): Promise<string | null>;
  /**
   * そのアカウント・そのフォルダでエージェントを起こし、ターミナルのタブで
   * 前面に出す (確認の画面を出さない。「使用量を確かめる」が止まったとき)。
   */
  /** 戻り値は、このセッションの使用量を記録できない理由 (無ければ空)。 */
  openHere(account: AccountEntry, folder: string): Promise<string>;
  /** statusLine を包む・戻す確認の画面。戻り値は結果の文 (やめたら null)。 */
  statusLine(
    account: AccountStatus,
    action: "install" | "uninstall",
  ): Promise<string | null>;
};

/** 書けないファイルのとき、生成元に写す statusLine (JSON の欄 1 つ)。 */
export function statusLineCopyText(
  plan: Pick<StatusLinePlanResponse, "after">,
): string {
  return `"statusLine": ${JSON.stringify(plan.after ?? null, null, 2)}`;
}

/**
 * 起動はしたが、プロジェクトの statusLine を読めず使用量を記録できない
 * ことの知らせ (起動の結果に添える)。無ければ空。
 */
export function statusLineNotice(
  result: Pick<LaunchResponse, "statusLineError">,
  t: AccountsText,
): string[] {
  return result.statusLineError
    ? [t.launchStatusLineFailed, result.statusLineError]
    : [];
}

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
    const source = abbreviateHome(plan.defaultDir, home);
    const chosen = new Set(
      plan.entries
        .filter((entry) => entry.category === "shared")
        .map((entry) => entry.name),
    );
    /** 場所を写した結果 (共有するかを確かめられないもの)。 */
    const copied = new Map<string, string>();
    const displayName = (entry: ShareEntry) =>
      entry.directory ? `${entry.name}/` : entry.name;

    const copyLocation = (entry: ShareEntry, button: HTMLButtonElement) => {
      navigator.clipboard.writeText(entry.target).then(
        () => {
          copied.set(entry.name, t.copiedLocation);
          view.draw();
        },
        (error: unknown) => {
          showCopyFailure(
            button,
            "copying the location failed",
            error,
            entry.target,
            1500,
          );
          copied.set(
            entry.name,
            `${t.copyLocationFailed}: ${formatErrorDetail(error)}`,
          );
          view.draw();
        },
      );
    };

    function group(
      title: string,
      entries: ShareEntry[],
      why = "",
    ): TemplateResult {
      // 理由はまとまりに 1 回だけ (行ごとに同じ文を繰り返すと、名前が読めない)。
      return html`<div class="agent-accounts-share"><span class="agent-hooks-dialog-label">${title}</span>${
        why ? html`<p class="agent-accounts-share-why">${why}</p>` : nothing
      }<div class="agent-accounts-share-list">${entries.map((entry) => {
        const item = html`<label class="agent-accounts-share-item"><input
            type="checkbox"
            .checked=${live(chosen.has(entry.name))}
            @change=${(event: Event) => {
              if ((event.currentTarget as HTMLInputElement).checked)
                chosen.add(entry.name);
              else chosen.delete(entry.name);
              view.draw();
            }}
          /><span class="terminal-mono" title=${abbreviateHome(entry.target, home)}
            >${displayName(entry)}</span
          ></label>`;
        if (entry.category !== "optional") return item;
        // 中身を確かめられないもの: その場で場所 (絶対パス) を写せるようにする。
        return html`<div class="agent-accounts-share-row">${item}<button
            type="button"
            class="gdp-btn gdp-btn-sm"
            title=${entry.target}
            @click=${(event: MouseEvent) =>
              copyLocation(entry, event.currentTarget as HTMLButtonElement)}
          >${t.copyLocation}</button><span class="agent-accounts-share-copied" role="status"
            >${copied.get(entry.name) ?? ""}</span
          ></div>`;
      })}</div></div>`;
    }

    const shared = plan.entries.filter((entry) => entry.category === "shared");
    const optional = plan.entries.filter(
      (entry) => entry.category === "optional",
    );
    const blocked = plan.entries.filter(
      (entry) => entry.category === "blocked",
    );
    const lines: string[] = [];
    if (plan.missingShared.length > 0) {
      lines.push(t.createLinkMissing(plan.missingShared.join(", ")));
    }
    if (plan.authKeysInShared.length > 0) {
      lines.push(t.createAuthKeys(plan.authKeysInShared.join(", ")));
    }
    lines.push(t.createAfter);

    function selected(): string[] {
      return plan.entries
        .filter((entry) => chosen.has(entry.name))
        .map((entry) => entry.name);
    }

    const view = dialogBody("agent-hooks-dialog", () => {
      const links = plan.entries
        .filter((entry) => chosen.has(entry.name))
        .map(
          (entry) =>
            `${displayName(entry)}  →  ${abbreviateHome(entry.target, home)}`,
        );
      return html`${labeledTemplate(t.createDir, abbreviateHome(plan.configDir, home))}${labeledTemplate(
        t.createSource,
        source,
      )}<p class="agent-accounts-share-intro">${t.shareIntro(source)}</p>${
        shared.length > 0 ? group(t.shareShared, shared) : nothing
      }${
        optional.length > 0
          ? group(t.shareOptional, optional, t.shareOptionalWhy)
          : nothing
      }${
        blocked.length > 0
          ? // 選べないものは畳んでおく (多くても画面を埋めない)。
            html`<details class="agent-hooks-dialog-details"><summary>${t.shareBlocked(
              blocked.length,
            )}</summary><pre class="agent-hooks-dialog-code terminal-mono">${blocked
              .map(
                (entry) =>
                  `${displayName(entry)}  — ${t.blockedWhy[entry.reason ?? "suspect"]}`,
              )
              .join("\n")}</pre></details>`
          : nothing
      }<div class="agent-hooks-dialog-block"><span class="agent-hooks-dialog-label">${t.createLinks}</span><pre
        class="agent-hooks-dialog-code terminal-mono"
      >${links.length > 0 ? links.join("\n") : t.shareNone}</pre></div>${notesTemplate(lines)}`;
    });
    return { body: view.element, selected };
  }

  async function add(prefill?: {
    agent: AccountAgent;
    path: string;
  }): Promise<string | null> {
    const t = text();
    const home = deps.client.snapshot().data?.home ?? "";
    let kind: AccountAgent = prefill?.agent ?? "claude";
    let name = "";
    let path = prefill?.path ?? "";
    let mode: "create" | "register" = prefill ? "register" : "create";
    const view = dialogBody("worktree-form", () => {
      const creating = mode === "create";
      return html`${fieldTemplate(
        t.addKind,
        radioSegTemplate<AccountAgent>(
          [
            { value: "claude", label: "claude" },
            { value: "codex", label: "codex" },
          ],
          kind,
          (value) => {
            kind = value;
            view.draw();
          },
        ),
      )}${fieldTemplate(
        t.addName,
        inputTemplate({
          value: name,
          placeholder: t.addNamePlaceholder,
          onInput(value) {
            name = value;
          },
        }),
      )}${fieldTemplate(
        t.addMode,
        radioSegTemplate<"create" | "register">(
          [
            { value: "create", label: t.addModeCreate },
            { value: "register", label: t.addModeRegister },
          ],
          mode,
          (value) => {
            mode = value;
            view.draw();
          },
        ),
      )}<span class="worktree-hint">${creating ? t.addModeCreateHelp : t.addModeRegisterHelp}</span>${fieldTemplate(
        t.addPath,
        inputTemplate({
          value: path,
          placeholder: "/",
          onInput(value) {
            path = value;
          },
        }),
        { hidden: creating },
      )}`;
    });
    const nameInput = view.element.querySelectorAll<HTMLInputElement>(
      "input.gdp-dialog-input",
    )[0];
    const choice = await showFormDialog({
      title: t.addTitle,
      body: view.element,
      wide: true,
      submitLabel: t.addNext,
      cancelLabel: t.cancel,
      focusTarget: nameInput ?? null,
      validate: () => {
        if (!name.trim()) return t.addNameRequired;
        if (mode === "register" && !path.trim().startsWith("/")) {
          return t.addPathRequired;
        }
        return null;
      },
      submit: async () => {
        // 計画は書かない。失敗 (名前・パスの問題) はこの画面に出す。
        if (mode === "create") {
          return {
            kind: "create" as const,
            plan: await deps.client.planCreate(kind, name.trim()),
          };
        }
        return {
          kind: "register" as const,
          plan: await deps.client.planRegister(kind, name.trim(), path.trim()),
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
        submit: async () => deps.client.create(plan, view.selected()),
      });
      if (!done) return null;
      // 作り終えたら、その場でログインへ進める (カードの行を探させない)。
      const signIn = await showFormDialog({
        title: t.createdTitle(done.name),
        body: notesTemplate([t.createdBody]),
        submitLabel: t.createdSignIn,
        cancelLabel: t.createdLater,
        submit: () => login({ ...done, builtin: false }),
      });
      return signIn ? `${t.added(done.name)}\n${signIn}` : t.added(done.name);
    }
    const plan = choice.plan;
    if (!plan.exists || !plan.isDirectory) {
      await showFormDialog({
        title: t.registerTitle(plan.name),
        body: notesTemplate([
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
      body: html`<div class="agent-hooks-dialog">${labeledTemplate(
        t.addPath,
        plan.configDir,
      )}${notesTemplate([t.registerBody])}</div>`,
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
      body: notesTemplate(lines),
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
    let name = account.name;
    const view = dialogBody("worktree-form", () =>
      fieldTemplate(
        t.renameLabel,
        inputTemplate({
          value: name,
          ariaLabel: t.renameLabel,
          onInput(value) {
            name = value;
          },
        }),
      ),
    );
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
      body: view.element,
      focusTarget: view.element.querySelector<HTMLInputElement>("input"),
      submitLabel: t.renameConfirm,
      cancelLabel: t.cancel,
      validate: () => {
        const result = renameAccount(registry, account.id, name);
        if (result.ok !== false) return null;
        switch (result.code) {
          case "name":
            return result.issue === "empty" ? t.renameEmpty : null;
          case "reserved":
            return t.renameReserved(name.trim());
          case "duplicate":
            return t.renameDuplicate(result.existing, account.agent);
          default:
            // 一覧に無い・既定: サーバに送って、その理由を出す。
            return null;
        }
      },
      submit: async () => {
        const renamed = await deps.client.rename(account.id, name);
        return t.renamed(account.name, renamed.name);
      },
    });
  }

  /**
   * タグを付け外しする。入力欄に札が並び、打って Enter で足す
   * (views/agents/account-tags.ts の createAccountTagEditor)。押す前の検査は
   * サーバと同じ規則 (checkAccountTags)。
   */
  async function tags(account: AccountStatus): Promise<string | null> {
    const t = text();
    // 既定のアカウントはどちらも「既定」なので、種類を前に付ける。
    const display = `${account.agent} ${accountDisplayName(account, t)}`;
    const others = new Map<string, ProjectColor | null>();
    for (const entry of deps.client.snapshot().data?.accounts ?? []) {
      if (entry.id === account.id) continue;
      for (const tag of entry.tags ?? []) others.set(tag.name, tag.color);
    }
    const editor = createAccountTagEditor({
      tags: account.tags ?? [],
      others,
      text: t,
    });
    return showFormDialog({
      title: t.tagsDialogTitle(display),
      description: t.tagsDescription,
      body: editor.element,
      focusTarget: editor.input,
      submitLabel: t.tagsSave,
      cancelLabel: t.cancel,
      validate: () =>
        tagIssueText(
          checkAccountTags(editor.value().map((tag) => tag.name)),
          t,
        ),
      submit: async () => {
        await deps.client.setTags(account.id, editor.value());
        return t.tagsSaved(display);
      },
    });
  }

  /**
   * 起動先の tmux のセッションの既定: そのプロジェクトのペインがあるセッション、
   * 無ければ前回そのプロジェクトで使ったもの、それも無ければフォルダの名前。
   */
  function launchSessionFor(
    project: string,
    last: AccountsResponse["lastLaunch"],
  ): string {
    const panes = deps.getOverview()?.panes ?? [];
    const name = project.split("/").filter(Boolean).pop() ?? "agents";
    const fallback =
      last?.project === project && last.session
        ? last.session
        : tmuxSessionName(name);
    return defaultLaunchSession(project, panes, fallback).session;
  }

  /** statusLine を包む・戻す確認の画面の中身。 */
  function statusLineBody(plan: StatusLinePlanResponse): TemplateResult {
    const t = text();
    const home = deps.client.snapshot().data?.home ?? "";
    const short = (path: string) => abbreviateHome(path, home);
    if (plan.writeBlocked && plan.changed) {
      // 書けない (別の場所から生成される) ファイル: 写す内容を出し、確認の
      // ボタンでコピーする (フックの同じ画面と同じ作り)。
      return html`<div class="agent-hooks-dialog"><p>${t.statusLineBlocked}</p>${labeledTemplate(
        t.statusLineAfter,
        statusLineCopyText(plan),
        true,
      )}${labeledTemplate("", plan.writeBlocked, true)}</div>`;
    }
    const notes: string[] = [];
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
    // 書き込む先と、書く前と後の差分 (サーバが plan で作ったもの) が主役。
    return html`<div class="agent-hooks-dialog">${settingsDiffTemplate(
      plan,
      home,
      {
        file: t.statusLineFile,
        unchanged: t.statusLineNothing,
        drawFailed: t.statusLineDiffFailed,
      },
    )}${notesTemplate(notes)}</div>`;
  }

  /**
   * statusLine を包む・戻す確認の画面 (設定の使用量の行・全体ボードのカード)。
   * 書いたら一覧を読み直す (applyStatusLine)。書けないファイルなら、写す内容を
   * コピーする。
   */
  async function statusLine(
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
        ? t.statusLineCopy
        : action === "install"
          ? t.statusLineInstall.replace(/…$/, "")
          : t.statusLineUninstall.replace(/…$/, ""),
      cancelLabel: blocked ? t.close : t.cancel,
      submit: async () => {
        if (blocked) {
          await navigator.clipboard.writeText(statusLineCopyText(plan));
          return t.statusLineCopied;
        }
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

  async function openHere(
    account: AccountEntry,
    folder: string,
  ): Promise<string> {
    // 起動の画面の「起動」と同じ経路 (POST /_agent/launch → そのペインを開く)。
    const result = await deps.client.launch({
      accountId: account.id,
      project: folder,
      session: launchSessionFor(
        folder,
        deps.client.snapshot().data?.lastLaunch ?? null,
      ),
    });
    deps.openPane(result.paneId);
    await Promise.all([deps.refreshOverview(), deps.client.load()]);
    return statusLineNotice(result, text()).join("\n");
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
    let kind: AccountAgent = fromAgent ?? last?.agent ?? "claude";
    let selectedAccount = "";
    let project =
      handoffProject ||
      options.project ||
      (last && projects.some((p) => p.value === last.project)
        ? last.project
        : (projects[0]?.value ?? ""));
    // select は候補に無い値を持てない (先頭が選ばれる)。描いた後の値を正にする。
    if (!projects.some((p) => p.value === project))
      project = projects[0]?.value ?? "";
    let session = handoff?.session ?? "";
    let copyResult = "";
    const home = initialData?.home ?? "";
    // 引き継ぎのときは前の担当と同じセッション (新しいウィンドウ)。
    let sessionTouched = handoff !== null;

    /** 選んでいる種類のアカウント。 */
    function accountsOfKind(): AccountStatus[] {
      return (currentData()?.accounts ?? []).filter(
        (account) => account.agent === kind,
      );
    }

    /**
     * 種類を変えたときの既定の選択。引き継ぎなら前の担当と違うアカウント、
     * そうでなければ前回の起動のアカウント、無ければ先頭。
     */
    function chooseAccount() {
      const choices = accountsOfKind();
      const other = handoff
        ? choices.find((account) => account.id !== fromAccountId)
        : undefined;
      const remembered =
        last?.agent === kind &&
        choices.some((account) => account.id === last.accountId)
          ? last.accountId
          : "";
      selectedAccount = other?.id || remembered || (choices[0]?.id ?? "");
    }

    /** 1 アカウントの使用量 (未ログイン・取れないときは理由の 1 行)。 */
    function accountUsage(account: AccountStatus, now: number): TemplateResult {
      if (account.login.state === "logged-out") {
        return html`<span class="agent-launch-account-usage"><span class="agent-launch-account-status"
          >${t.login["logged-out"]}</span
        ></span>`;
      }
      const usage = account.usage;
      if (usage.status !== "ok") {
        return html`<span class="agent-launch-account-usage"><span
          class="agent-launch-account-status"
          title=${[t.usageReason[usage.reason], usage.detail]
            .filter(Boolean)
            .join("\n")}
        >${`${t.usageUnavailable} · ${t.usageReasonShort[usage.reason]}`}</span></span>`;
      }
      return html`<span class="agent-launch-account-usage">${usageWindowViews(
        usage,
        now,
      ).map((view) =>
        usageMeterTemplate(view, now, t, { reset: "remaining" }),
      )}</span>`;
    }

    /**
     * アカウントの一覧。各行に 5 時間・週の使用量と「いつの値か」を並べ、
     * 空いているアカウントを選びやすくする (部品は全体ボードの帯と同じ
     * usage-meter.ts)。行は radio で、上下の矢印で選び直せる。
     */
    function accountsTemplate(): unknown {
      const now = Date.now();
      const choices = accountsOfKind();
      if (choices.length === 0)
        return html`<span class="worktree-hint">${t.launchNoAccounts}</span>`;
      return choices.map((account) => {
        const on = account.id === selectedAccount;
        const observed = usageObservedText(
          account.usage,
          account.login,
          now,
          t,
        );
        return html`<button
          type="button"
          role="radio"
          class=${on ? "agent-launch-account active" : "agent-launch-account"}
          data-account=${account.id}
          aria-checked=${String(on)}
          tabindex=${on ? "0" : "-1"}
          @click=${() => pickAccount(account.id)}
          @keydown=${(event: KeyboardEvent) => {
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
          }}
        ><span class="agent-launch-account-head"><span class="agent-launch-account-name"
          >${accountDisplayName(account, t)}</span
        >${
          handoff && account.id === fromAccountId
            ? html`<span class="agent-launch-account-current">${t.handoffCurrent}</span>`
            : nothing
        }<span
          class=${`agent-launch-account-observed${observed.stale ? " stale" : ""}`}
          title=${ifDefined(observed.title || undefined)}
        >${observed.text}</span></span><span class="agent-launch-account-dir"
          >${abbreviateHome(account.configDir, currentData()?.home ?? "")}</span
        >${accountUsage(account, now)}</button>`;
      });
    }

    function selectedAccountItem(): HTMLElement | null {
      return view.element.querySelector<HTMLElement>(
        '.agent-launch-account[aria-checked="true"]',
      );
    }

    function pickAccount(id: string, focus = false) {
      selectedAccount = id;
      copyResult = "";
      view.draw();
      if (focus) selectedAccountItem()?.focus();
    }

    function syncSession() {
      if (sessionTouched) return;
      session = launchSessionFor(project, last);
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
     * 表示するコマンド。起動コマンドは開いた時点の写しではなく今の値
     * (別の画面で保存したものが、開き直すまで古いまま出ていた)。
     */
    function commandLine(): string {
      const current = currentData();
      const account = current?.accounts.find(
        (item) => item.id === selectedAccount,
      );
      const command = current?.launchCommands[kind] ?? kind;
      return launchCommandLine(
        kind,
        !account || account.builtin ? null : account.configDir,
        command,
        current?.home ?? "",
        handoffArgsFor(kind),
      );
    }

    function copyCommand(button: HTMLButtonElement): void {
      navigator.clipboard.writeText(commandLine()).then(
        () => {
          copyResult = t.launchCopied;
          view.draw();
        },
        (error: unknown) => {
          // ほかの画面のコピーと同じ形 (ボタンに失敗の見た目と理由、console に
          // 全体)。状態の行にも、message だけでなく名前と原因の連鎖を出す。
          showCopyFailure(
            button,
            "copying the launch command failed",
            error,
            t.launchCopy,
            1500,
          );
          copyResult = `${t.launchCopyFailed}: ${formatErrorDetail(error)}`;
          view.draw();
        },
      );
    }

    chooseAccount();
    syncSession();
    const view = dialogBody("agent-launch-form", () => {
      const panes = deps.getOverview()?.panes ?? [];
      const exists = panes.some((pane) => pane.session === session.trim());
      const account = currentData()?.accounts.find(
        (item) => item.id === selectedAccount,
      );
      const loginHint = launchLoginHint(account, t);
      const shownProject = projects.find((p) => p.value === project);
      const projectDetail = shownProject
        ? abbreviateHome(shownProject.value, home)
        : "";
      return html`${
        projects.length === 0
          ? html`<p class="worktree-hint">${t.launchNoProjects}</p>`
          : nothing
      }${
        handoff
          ? launchRowTemplate(
              t.handoffLog,
              html`<span class="agent-launch-log terminal-mono" title=${transcriptPath}
                >${abbreviateHome(transcriptPath, home)}</span
              >`,
              html`<span class="worktree-hint">${t.handoffLogHint}</span>`,
            )
          : nothing
      }${launchRowTemplate(
        t.launchKind,
        radioSegTemplate<AccountAgent>(
          [
            { value: "claude", label: "claude" },
            { value: "codex", label: "codex" },
          ],
          kind,
          (value) => {
            kind = value;
            chooseAccount();
            copyResult = "";
            view.draw();
          },
        ),
        nothing,
        "div",
      )}${launchRowTemplate(
        t.launchAccount,
        html`<div class="agent-launch-accounts" role="radiogroup" aria-label=${t.launchAccount}>${accountsTemplate()}</div>`,
        html`<span class="worktree-hint" ?hidden=${loginHint === ""}>${loginHint}</span>`,
        "div",
      )}${launchRowTemplate(
        t.launchProject,
        // 名前と補足 (場所) の 2 段で見せる選択の欄。選ぶのは下に重ねた本物の
        // select (キー操作・読み上げはそのまま)。
        html`<span class="agent-launch-choice"><span class="agent-launch-choice-name"
            >${shownProject?.label ?? ""}</span
          ><span class="agent-launch-choice-detail" ?hidden=${projectDetail === ""}
            >${projectDetail}</span
          ><span class="agent-launch-choice-chevron" aria-hidden="true">${iconTemplate(
            CHEVRON_DOWN_16_PATH,
            "octicon-chevron-down",
          )}</span><select
            class="gdp-dialog-input agent-launch-choice-select"
            .value=${live(project)}
            @change=${(event: Event) => {
              project = (event.currentTarget as HTMLSelectElement).value;
              syncSession();
              copyResult = "";
              view.draw();
            }}
          >${projects.map(
            (choice) =>
              html`<option value=${choice.value} ?selected=${choice.value === project}
                >${choice.label}</option
              >`,
          )}</select></span>`,
      )}${launchRowTemplate(
        t.launchSession,
        inputTemplate({
          value: session,
          onInput(value) {
            session = value;
            sessionTouched = true;
            copyResult = "";
            view.draw();
          },
        }),
        html`<span class="worktree-hint">${exists ? t.launchSessionExisting : t.launchSessionNew}</span>`,
      )}<div class="agent-launch-preview-block"><span class="agent-launch-label"
        >${t.launchPreviewLabel}</span
      ><div class="agent-launch-preview"><code class="agent-launch-preview-text terminal-mono"
        >${commandLine()}</code
      ><button
        type="button"
        class="agents-icon-action agent-launch-copy"
        title=${t.launchCopy}
        aria-label=${t.launchCopy}
        @click=${(event: MouseEvent) =>
          copyCommand(event.currentTarget as HTMLButtonElement)}
      >${iconTemplate(COPY_16_PATHS, "octicon-copy")}</button></div><span
        class="worktree-hint agent-launch-copy-result"
        role="status"
      >${copyResult}</span></div>`;
    });

    // 開いている間に届いた一覧 (周期の取り直し) で、表示するコマンドと
    // 使用量を合わせ直す (コピーの結果の表示は消さない)。開いた時点でも 1 回
    // 取り直す (別の画面での保存を待たずに拾う)。
    const unsubscribe = deps.client.subscribe(() => {
      const focused = view.element.contains(document.activeElement)
        ? document.activeElement
        : null;
      view.draw();
      if (focused instanceof HTMLElement && !focused.isConnected)
        selectedAccountItem()?.focus();
    });
    void deps.client.load({ background: true });
    return showFormDialog({
      title: handoff ? t.handoffDialogTitle : t.launchTitle,
      description: handoff
        ? t.handoffIntro(`${fromAgent} · ${fromAccountName}`)
        : t.launchIntro,
      body: view.element,
      wide: true,
      submitLabel: handoff ? t.handoffRun : t.launchRun,
      cancelLabel: t.cancel,
      focusTarget: selectedAccountItem(),
      validate: () => {
        if (!selectedAccount) return t.launchNoAccounts;
        if (!project) return t.launchNoProjects;
        return session.trim() ? null : t.launchSession;
      },
      submit: async () => {
        const result = await deps.client.launch({
          accountId: selectedAccount,
          project,
          session: session.trim(),
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
        return [
          t.launchStarted(result.session),
          ...(result.rememberError
            ? [t.launchRememberFailed, result.rememberError]
            : []),
          ...statusLineNotice(result, t),
        ].join("\n");
      },
    }).finally(unsubscribe);
  }

  return { add, remove, rename, tags, login, launch, openHere, statusLine };
}

/** タグの検査の結果を文にする (問題が無ければ null)。 */
function tagIssueText(
  issue: AccountTagIssue | null,
  t: AccountsText,
): string | null {
  if (!issue) return null;
  switch (issue.code) {
    case "empty":
      return t.tagEmpty;
    case "too-many":
      return t.tagTooMany(MAX_ACCOUNT_TAGS);
    case "too-long":
      return t.tagTooLong(issue.tag, MAX_ACCOUNT_TAG);
    case "control":
      return t.tagControl(issue.tag);
    case "duplicate":
      return t.tagDuplicate(issue.tag);
  }
}
