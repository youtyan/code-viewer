import { apiUrl } from "../../core/api-url";
// プロジェクトの操作 (登録・外す・名前・並べ替え・開く・止める)。エージェント
// 一覧の見出しとヘッダの切替が同じものを使う。
//
// 開くは同じタブで移る。動いていなければ、登録したプロジェクトに限って
// サーバを起こしてから移る。起こしている間と失敗は、そのプロジェクトの鍵
// (root) ごとに覚えて、見出しが描く (失敗は理由の全文)。
//
// 書き込み系の fetch は X-Code-Viewer-Action を付ける (actionHeaders)。利用者の
// 操作で始まるので trackLoad を通す。起こしている途中で取り消されたら、
// サーバ側の起動は続くが画面は移らないので、失敗として理由を出す (もう一度
// 開けば、起きたサーバへそのまま移る)。

import type { AgentProjectInfo } from "../../core/agent-overview";
import { formatErrorDetail } from "../../core/error-detail";
import {
  decideProjectOpen,
  defaultProjectName,
  type ProjectOpenResponse,
  projectDestination,
} from "../../core/projects";
import { responseFailure } from "../agents/accounts-client";
import {
  showAlertDialog,
  showConfirmDialog,
  showPromptDialog,
} from "../ui-dialog";
import type { ProjectsText } from "./projects-i18n";

export type ProjectActionsDeps = {
  getText(): ProjectsText;
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  actionHeaders(): HeadersInit;
  /** 登録簿が変わった・サーバを起こした・止めた後に一覧を取り直す。 */
  refresh(): Promise<void>;
  /** 同じタブで移る (テストで差し替える)。 */
  navigate(url: string): void;
};

/** 見出しに出す、そのプロジェクトで進んでいること。 */
export type ProjectActivity =
  | { kind: "starting" }
  | { kind: "failed"; title: string; detail: string };

export type ProjectActions = {
  activity(root: string): ProjectActivity | null;
  /** 描き直しが要るかを比べるための値。 */
  signature(): string;
  dismiss(root: string): void;
  subscribe(listener: () => void): () => void;
  /**
   * path: 移り先の画面のパス (`/`・`/history` など)。
   * confirmRegister: 登録していないプロジェクトを「登録して開く」前に確かめる
   * か (既定は確かめる)。左のサイドバーの名前は押しただけで移る入口なので
   * 確かめない (登録は ⋯ のメニューから外せる)。
   */
  open(
    info: AgentProjectInfo,
    path: string,
    options?: { confirmRegister?: boolean },
  ): Promise<void>;
  registerCurrent(): Promise<void>;
  registerRoot(root: string): Promise<void>;
  registerByPath(): Promise<void>;
  unregister(info: AgentProjectInfo): Promise<void>;
  rename(info: AgentProjectInfo): Promise<void>;
  move(info: AgentProjectInfo, direction: -1 | 1): Promise<void>;
  stop(info: AgentProjectInfo): Promise<void>;
};

export function createProjectActions(deps: ProjectActionsDeps): ProjectActions {
  const activities = new Map<string, ProjectActivity>();
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const listener of listeners) listener();
  }

  function set(root: string, activity: ProjectActivity | null): void {
    if (activity) activities.set(root, activity);
    else activities.delete(root);
    emit();
  }

  async function post(path: string, body: unknown): Promise<unknown> {
    const res = await deps.trackLoad(
      fetch(path, {
        method: "POST",
        headers: deps.actionHeaders(),
        body: JSON.stringify(body),
      }),
    );
    if (!res.ok) throw await responseFailure(res, `POST ${path}`);
    return res.json();
  }

  /** 登録簿を変える。失敗は root (無ければ "") の失敗として見出しに出す。 */
  async function change(root: string, body: unknown): Promise<boolean> {
    try {
      await post(apiUrl("agentProjects"), body);
    } catch (cause) {
      console.error("[code-viewer] project change failed", cause);
      set(root, {
        kind: "failed",
        title: deps.getText().changeFailed,
        detail: formatErrorDetail(cause),
      });
      return false;
    }
    set(root, null);
    await deps.refresh();
    return true;
  }

  async function start(info: AgentProjectInfo, path: string): Promise<void> {
    const text = deps.getText();
    set(info.root, { kind: "starting" });
    let opened: ProjectOpenResponse;
    try {
      opened = (await post(apiUrl("agentProjectsOpen"), {
        root: info.root,
      })) as ProjectOpenResponse;
    } catch (cause) {
      console.error("[code-viewer] project open failed", cause);
      set(info.root, {
        kind: "failed",
        title: text.openFailed(info.name),
        detail: formatErrorDetail(cause),
      });
      return;
    }
    if (opened.portChanged) {
      await showAlertDialog({
        title: text.portChangedTitle,
        body: text.portChangedBody(
          opened.portChanged.from,
          opened.portChanged.to,
        ),
        confirmLabel: text.portChangedContinue,
      });
    }
    // 移るまで「起動中」を出したままにする (押し直しで 2 本目を起こさない)。
    deps.navigate(projectDestination(opened.url, path));
  }

  async function open(
    info: AgentProjectInfo,
    path: string,
    options: { confirmRegister?: boolean } = {},
  ): Promise<void> {
    if (activities.get(info.root)?.kind === "starting") return;
    const text = deps.getText();
    const decision = decideProjectOpen({
      server: info.server,
      registered: info.registered !== null,
      git: info.git,
    });
    if (decision.kind === "current") return;
    if (decision.kind === "navigate") {
      deps.navigate(projectDestination(decision.url, path));
      return;
    }
    if (decision.kind === "unavailable") {
      set(info.root, {
        kind: "failed",
        title: text.openFailed(info.name),
        detail: decision.reason,
      });
      return;
    }
    if (decision.kind === "register-first") {
      const ok =
        options.confirmRegister === false ||
        (await showConfirmDialog({
          title: text.registerFirstTitle,
          body: text.registerFirstBody(info.name, info.root),
          confirmLabel: text.registerAndOpen,
          cancelLabel: text.cancel,
        }));
      if (!ok) return;
      if (!(await change(info.root, { action: "add", path: info.root }))) {
        return;
      }
    }
    await start(info, path);
  }

  return {
    activity: (root) => activities.get(root) ?? null,
    signature: () => JSON.stringify([...activities]),
    dismiss: (root) => set(root, null),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open,
    async registerCurrent() {
      await change("", { action: "add", current: true });
    },
    async registerRoot(root) {
      await change(root, { action: "add", path: root });
    },
    async registerByPath() {
      const text = deps.getText();
      const path = await showPromptDialog({
        title: text.addPathTitle,
        body: `${text.addPathLabel}\n${text.addPathHint}`,
        placeholder: "/",
        ariaLabel: text.addPathLabel,
        confirmLabel: text.addPathSubmit,
        cancelLabel: text.cancel,
        validate: (value) => {
          const trimmed = value.trim();
          return trimmed.startsWith("/") ? trimmed : null;
        },
      });
      if (path) await change("", { action: "add", path });
    },
    async unregister(info) {
      const text = deps.getText();
      const ok = await showConfirmDialog({
        title: text.unregisterConfirmTitle(info.name),
        body: text.unregisterConfirmBody(info.root),
        confirmLabel: text.unregisterConfirm,
        cancelLabel: text.cancel,
      });
      if (ok) await change(info.root, { action: "remove", root: info.root });
    },
    async rename(info) {
      const text = deps.getText();
      const folder = defaultProjectName(info.root);
      const name = await showPromptDialog({
        title: text.renameTitle,
        body: text.renameHint(folder),
        defaultValue: info.name,
        ariaLabel: text.renameLabel,
        confirmLabel: text.save,
        cancelLabel: text.cancel,
        // 空はフォルダ名に戻す (送る値はフォルダ名)。
        validate: (value) => value.trim() || folder,
      });
      if (name !== null) {
        await change(info.root, { action: "rename", root: info.root, name });
      }
    },
    async move(info, direction) {
      await change(info.root, { action: "move", root: info.root, direction });
    },
    async stop(info) {
      const text = deps.getText();
      const ok = await showConfirmDialog({
        title: text.stopConfirmTitle(info.name),
        body: text.stopConfirmBody,
        confirmLabel: text.stopConfirm,
        cancelLabel: text.cancel,
        danger: true,
      });
      if (!ok) return;
      try {
        await post(apiUrl("agentProjectsStop"), { root: info.root });
      } catch (cause) {
        console.error("[code-viewer] project server stop failed", cause);
        set(info.root, {
          kind: "failed",
          title: text.stopFailed(info.name),
          detail: formatErrorDetail(cause),
        });
        return;
      }
      set(info.root, null);
      await deps.refresh();
    },
  };
}
