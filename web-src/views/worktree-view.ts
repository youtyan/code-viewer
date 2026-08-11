// 作業ツリーの画面。骨格も行の見た目も History 画面のものをそのまま使う。
//
//   #worktree-panel  作業ツリー一覧   (#history-panel と同じ箱・同じ行)
//   #sidebar         変更ファイル一覧 (Repository と同じ .tree-file の行)
//   #diff            変更ファイル全部の差分を縦に並べる (.gdp-file-shell)
//
// **1 ファイルずつ開かせない。** History と同じで、選んだ作業ツリーの変更は
// 全部 #diff に積み、サイドバーのクリックはそこへのスクロールになる。中身は
// 見えたものから読む (History の遅延ロードと同じ考え)。
//
// 差分は**選ばれた作業ツリーを cwd にして** git を回した結果で、サーバ自身の
// 作業ツリーとは無関係 (server/worktree/handle.ts の handleDiffGet)。だから
// 1 つのサーバから全部の作業ツリーの中身が読める。

import { blameRelativeTime } from "../core/blame";
import {
  CHEVRON_DOWN_16_PATH,
  COPY_16_PATHS,
  FOLDER_ICON_PATHS,
  iconSvg,
  OPEN_EXTERNAL_16_PATH,
} from "../core/icons";
import type { AppRoute } from "../core/routes";
import type {
  WorktreeActionResponse,
  WorktreeDiffResponse,
  WorktreesResponse,
} from "../core/types";
import type { WorktreeFileChange, WorktreeItem } from "../core/worktree";
import { worktreeBranchError, worktreeNameError } from "../core/worktree";
import type { PageView } from "./page-view";
import { showFormDialog } from "./ui-dialog";
import type { WorktreeText } from "./worktree-i18n";

export type WorktreeRoute = Extract<AppRoute, { screen: "worktree" }>;

/** topbar のトグルが決める、差分の出し方。 */
export type WorktreeViewOptions = {
  layout: "line-by-line" | "side-by-side";
  ignoreWs: boolean;
  hideTests: boolean;
  syntax: boolean;
};

export type WorktreeViewDeps = {
  getRoute(): AppRoute;
  /** topbar の 統合/分割・空白・構文・テスト非表示。 */
  getOptions(): WorktreeViewOptions;
  /** そのパスをテストとみなすか。topbar の「テスト非表示」で使う。 */
  isTestPath(path: string): boolean;
  /** サイドバーの ツリー / 一覧。Repository のトグルと同じ値。 */
  getSidebarView(): "tree" | "flat";
  /**
   * 構文強調のハイライタを読み込む。遅延バンドルなので Promise で返る。
   * 読めなければ null。
   */
  loadHljs(): Promise<unknown>;
  setRoute(route: AppRoute, replace?: boolean): void;
  currentRange(): { from: string; to: string };
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  getText(): WorktreeText;
  setPageMode(): void;
  syncHeaderMenu(): void;
  setStatus(status: "live" | "refreshing" | "error" | null): void;
  /** app.ts の既存の仕組み (/_open_path) でフォルダを OS から開く。 */
  openPathInOs(
    path: string,
    kind: "directory" | "file-parent",
    button?: HTMLButtonElement,
  ): Promise<void>;
};

export type WorktreeView = PageView & {
  /** topbar Reload: mounted 済みでも一覧と差分を取り直す。 */
  reload(): Promise<void>;
  /** 統合/分割・構文・テスト非表示が変わったとき、表示中のカードへ反映する。 */
  displayOptionsChanged(): void;
};

/** SSE をまとめる待ち時間。保存 1 回で update が何本も飛ぶため。 */
const SSE_REFRESH_DELAY_MS = 400;

/** 画面の外どれくらい手前から差分を読み始めるか。History の感覚に合わせる。 */
const DIFF_PREFETCH_MARGIN = "600px";

/** 書き込み系は同一オリジン + このヘッダでしか通らない (server.md)。 */
const ACTION_HEADERS = {
  "Content-Type": "application/json",
  "X-Code-Viewer-Action": "1",
};

async function postWorktreeAction(
  path: string,
  body: Record<string, unknown>,
): Promise<WorktreeActionResponse> {
  const res = await fetch(path, {
    method: "POST",
    headers: ACTION_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text()) || `${res.status}`);
  return (await res.json()) as WorktreeActionResponse;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** ファイル 1 件を指す鍵。同じパスが未コミットと分岐後の両方に出るため。 */
function fileKey(file: WorktreeFileChange): string {
  return `${file.origin}:${file.path}`;
}

/** Repository のツリーと同じ折りたたみ矢印。 */
function chevronSvg(): string {
  return iconSvg("octicon-chevron-down", CHEVRON_DOWN_16_PATH);
}

/** 同じくフォルダのアイコン。開閉で形が変わる。 */
function folderSvg(collapsed: boolean): string {
  return iconSvg(
    collapsed
      ? "octicon-file-directory-fill"
      : "octicon-file-directory-open-fill",
    collapsed ? FOLDER_ICON_PATHS.closed : FOLDER_ICON_PATHS.open,
  );
}

function matches(haystack: string, needle: string): boolean {
  return !needle || haystack.toLowerCase().includes(needle.toLowerCase());
}

export function createWorktreeView(deps: WorktreeViewDeps): WorktreeView {
  let mounted = false;
  let lifecycle = 0;
  let acceptedServerGeneration = 0;
  let data: WorktreesResponse | null = null;
  let message = "";
  let messageIsError = false;
  let busyPath = "";
  let sseTimer: number | null = null;
  let refreshRequested = false;
  let refreshLoop: Promise<void> | null = null;
  let worktreeFilter = "";
  let fileFilter = "";
  /**
   * 今 #diff に積んであるもの (作業ツリー + 表示設定)。積み直すかの判断に使う。
   * null は「まだ一度も積んでいない」で、"" (未選択) とは別物。表示設定を
   * 含めるのは、topbar のトグルを動かしたら積み直す必要があるため。
   */
  let diffFor: string | null = null;
  let restoredRouteKey: string | null = null;
  let observer: IntersectionObserver | null = null;

  const listPanel = document.getElementById("worktree-panel");

  function text(): WorktreeText {
    return deps.getText();
  }

  function route(): WorktreeRoute | null {
    const current = deps.getRoute();
    return current.screen === "worktree" ? current : null;
  }

  function setMessage(next: string, isError = false): void {
    message = next;
    messageIsError = isError;
  }

  function isCurrent(seq: number): boolean {
    return mounted && seq === lifecycle && route() !== null;
  }

  /** 絞り込みは使い回す。作り直すと打っている最中に focus が飛ぶ。 */
  const worktreeFilterInput = (() => {
    const input = el("input", "history-filter");
    input.type = "search";
    input.autocomplete = "off";
    input.addEventListener("input", () => {
      worktreeFilter = input.value;
      renderList();
    });
    return input;
  })();

  function sidebarFilter(): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>("#sb-filter");
  }

  function onSidebarFilter(): void {
    fileFilter = sidebarFilter()?.value || "";
    renderFiles();
  }

  /**
   * ツリー / 一覧の切替。値そのものは Repository と同じ STATE が持つので、
   * ここは押されたら描き直すだけ (既定のハンドラが STATE を更新した後に走る)。
   */
  function onSidebarViewToggle(): void {
    // 既定のハンドラと同じクリックで走るため、STATE の更新後になるよう次の
    // タスクへ回す。
    window.setTimeout(() => renderFiles(), 0);
  }

  function setAllDirsCollapsed(collapsed: boolean): void {
    const list = document.getElementById("filelist");
    if (!list) return;
    for (const dir of list.querySelectorAll<HTMLElement>(".tree-dir")) {
      dir.classList.toggle("collapsed", collapsed);
      const icon = dir.querySelector<HTMLElement>(":scope > .dir-icon");
      if (icon) icon.innerHTML = folderSvg(collapsed);
    }
  }

  function onExpandAll(): void {
    setAllDirsCollapsed(false);
  }

  function onCollapseAll(): void {
    setAllDirsCollapsed(true);
  }

  function sidebarViewButtons(): HTMLElement[] {
    return Array.from(
      document.querySelectorAll<HTMLElement>(".sb-view-seg button"),
    );
  }

  function mount(): void {
    if (mounted || !listPanel) return;
    document.getElementById("empty")?.classList.add("hidden");
    document
      .getElementById("history-commit-info")
      ?.setAttribute("hidden", "true");
    listPanel.hidden = false;
    mounted = true;
    document.body.classList.add("gdp-worktree-page");
    // サイドバーの絞り込みはこの画面でも使う。既定のハンドラは STATE.files を
    // 見ていて作業ツリーの一覧には効かないので、こちらでも拾う。
    sidebarFilter()?.addEventListener("input", onSidebarFilter);
    document
      .getElementById("filelist")
      ?.addEventListener("click", onFileListClick);
    for (const button of sidebarViewButtons()) {
      button.addEventListener("click", onSidebarViewToggle);
    }
    document
      .getElementById("sb-expand-all")
      ?.addEventListener("click", onExpandAll);
    document
      .getElementById("sb-collapse-all")
      ?.addEventListener("click", onCollapseAll);
    deps.setPageMode();
    deps.syncHeaderMenu();
  }

  function suspend(): void {
    // 進行中の読み込みの結果を捨てる。画面を離れた後に書き換えない。
    lifecycle++;
    observer?.disconnect();
    observer = null;
    diffFor = null;
    restoredRouteKey = null;
    if (sseTimer !== null) {
      window.clearTimeout(sseTimer);
      sseTimer = null;
    }
    refreshRequested = false;
    if (listPanel) {
      listPanel.hidden = true;
      listPanel.replaceChildren();
    }
    sidebarFilter()?.removeEventListener("input", onSidebarFilter);
    document
      .getElementById("filelist")
      ?.removeEventListener("click", onFileListClick);
    for (const button of sidebarViewButtons()) {
      button.removeEventListener("click", onSidebarViewToggle);
    }
    document
      .getElementById("sb-expand-all")
      ?.removeEventListener("click", onExpandAll);
    document
      .getElementById("sb-collapse-all")
      ?.removeEventListener("click", onCollapseAll);
    document.getElementById("filelist")?.replaceChildren();
    document.getElementById("diff")?.replaceChildren();
    document.body.classList.remove("gdp-worktree-page");
    mounted = false;
  }

  // ---- 選択 ----

  function selectedWorktree(): WorktreeItem | null {
    const id = route()?.wt;
    if (!id || !data) return null;
    return data.worktrees.find((item) => item.id === id) || null;
  }

  function worktreeLabel(id: string): string {
    const item = data?.worktrees.find((candidate) => candidate.id === id);
    if (!item) return id;
    const sameName = data?.worktrees.filter(
      (candidate) => candidate.name === item.name,
    );
    return sameName && sameName.length > 1
      ? `${item.name} (${item.displayPath})`
      : item.name;
  }

  function navigate(next: Partial<WorktreeRoute>, replace = false): void {
    const current = route();
    if (!current) return;
    deps.setRoute(
      {
        screen: "worktree",
        ...(current.wt ? { wt: current.wt } : {}),
        ...(current.file ? { file: current.file } : {}),
        ...(current.origin ? { origin: current.origin } : {}),
        ...next,
        range: deps.currentRange(),
      },
      replace,
    );
  }

  // ---- 読み込み ----

  async function refreshOnce(): Promise<void> {
    if (!mounted || !route()) return;
    const seq = ++lifecycle;
    if (!data) setMessage(text().loading);
    renderList();
    deps.setStatus("refreshing");
    try {
      const next = await deps.trackLoad(
        fetch("/_worktree/list").then(async (res) => {
          if (!res.ok) throw new Error((await res.text()) || `${res.status}`);
          return (await res.json()) as WorktreesResponse;
        }),
      );
      if (!isCurrent(seq)) return;
      if (
        !Number.isInteger(next.generation) ||
        next.generation < acceptedServerGeneration
      ) {
        throw new Error(
          `stale worktree response generation ${next.generation}; current is ${acceptedServerGeneration}`,
        );
      }
      acceptedServerGeneration = next.generation;
      data = next;
      // 一覧そのものは返ったが git が文句を言った場合、行は出しつつ理由も出す。
      setMessage(next.error || "", !!next.error);
      deps.setStatus(next.error ? "error" : "live");
    } catch (error) {
      if (!isCurrent(seq)) return;
      setMessage(
        error instanceof Error ? error.message : text().loadFailed,
        true,
      );
      deps.setStatus("error");
    } finally {
      if (isCurrent(seq)) {
        // 一覧が変われば中身も変わる。積み直す。
        diffFor = null;
        render();
      }
    }
  }

  /**
   * SSE・Reload・generation 不一致が重なっても一覧取得は直列にする。実行中に
   * 来た要求は 1 回に畳み、現在の取得後にもう一度だけ最新状態を読む。
   */
  function refresh(): Promise<void> {
    if (!mounted || !route()) return Promise.resolve();
    refreshRequested = true;
    if (refreshLoop) return refreshLoop;
    const loop = (async () => {
      while (refreshRequested && mounted && route()) {
        refreshRequested = false;
        await refreshOnce();
      }
    })();
    const tracked = loop.finally(() => {
      if (refreshLoop === tracked) refreshLoop = null;
    });
    refreshLoop = tracked;
    return tracked;
  }

  // ---- 操作 ----

  /**
   * 別タブは先に開いておく。URL が返ってくるまで待ってから window.open すると、
   * ユーザー操作から離れた呼び出しとしてポップアップブロックに掛かる。
   */
  function openBlankTab(): Window | null {
    try {
      // "noopener" を features に渡すと、仕様上 window.open は null を返す。
      // タブだけが about:blank のまま開き、URL を入れる先が無くなるので
      // 渡さない。参照は受け取ったうえで opener を切る。
      const tab = window.open("", "_blank");
      if (tab) tab.opener = null;
      return tab;
    } catch {
      return null;
    }
  }

  async function openWorktree(item: WorktreeItem): Promise<void> {
    if (busyPath) return;
    const seq = lifecycle;
    busyPath = item.path;
    setMessage(text().opening);
    renderList();
    const tab = openBlankTab();
    try {
      const result = await deps.trackLoad(
        postWorktreeAction("/_worktree/open", { path: item.path }),
      );
      const url = result.url || "";
      if (!url) throw new Error(text().openFailed);
      if (tab) tab.location.href = url;
      // ブロックされてタブを開けなかったときは、URL を残して自分で開けるように
      // する (黙って何も起きないのが一番困る)。
      if (isCurrent(seq)) setMessage(tab ? "" : url, !tab);
    } catch (error) {
      tab?.close();
      if (isCurrent(seq)) {
        setMessage(
          error instanceof Error ? error.message : text().openFailed,
          true,
        );
      }
    } finally {
      busyPath = "";
      if (isCurrent(seq)) await refresh();
    }
  }

  function labeledInput(
    label: string,
    placeholder: string,
    hint?: string,
  ): { wrap: HTMLElement; input: HTMLInputElement } {
    const wrap = document.createElement("label");
    wrap.className = "worktree-field";
    wrap.appendChild(el("span", "", label));
    // 入力欄はダイアログ共通のクラス。
    const input = el("input", "gdp-dialog-input");
    input.type = "text";
    input.placeholder = placeholder;
    wrap.appendChild(input);
    if (hint) wrap.appendChild(el("span", "worktree-hint", hint));
    return { wrap, input };
  }

  async function addWorktree(): Promise<void> {
    const seq = lifecycle;
    const t = text();
    const body = el("div", "worktree-form");
    const name = labeledInput(
      t.addDialog.nameLabel,
      t.addDialog.namePlaceholder,
    );
    const branch = labeledInput(
      t.addDialog.branchLabel,
      t.addDialog.branchPlaceholder,
      t.addDialog.branchHint,
    );
    body.append(name.wrap, branch.wrap);
    if (data) {
      body.appendChild(
        el("p", "worktree-hint", t.addParentHint(data.addParent)),
      );
    }
    // 追加先はリポジトリの中なので、放っておくと git status に未追跡として
    // 出続ける。.gitignore を書き換えるのはリポジトリ側の判断なので伝えるだけ。
    body.appendChild(el("p", "worktree-hint", t.gitignoreHint));

    const submitted = await showFormDialog<{ name: string; branch: string }>({
      title: t.addDialog.title,
      body,
      submitLabel: t.addDialog.submit,
      cancelLabel: t.cancel,
      focusTarget: name.input,
      validate: () => {
        const nameError = worktreeNameError(name.input.value.trim());
        if (nameError) return t.nameErrors[nameError];
        const raw = branch.input.value.trim();
        if (!raw) return null;
        const branchError = worktreeBranchError(raw);
        return branchError ? t.nameErrors[branchError] : null;
      },
      submit: () => ({
        name: name.input.value.trim(),
        branch: branch.input.value.trim(),
      }),
    });
    if (!submitted) return;
    if (!isCurrent(seq)) return;

    let createdPath = "";
    try {
      const result = await deps.trackLoad(
        postWorktreeAction("/_worktree/add", submitted),
      );
      if (isCurrent(seq)) setMessage("");
      createdPath = result.path || "";
    } catch (error) {
      if (isCurrent(seq)) {
        setMessage(error instanceof Error ? error.message : t.addFailed, true);
      }
    }
    // 作ったものをそのまま選ぶ。refresh が世代を進めるので先に選び、
    // 来た一覧がそれを選択状態で描く。
    if (isCurrent(seq) && createdPath) {
      navigate({ wt: createdPath });
    }
    if (isCurrent(seq)) await refresh();
  }

  async function removeWorktree(item: WorktreeItem): Promise<void> {
    if (busyPath) return;
    const seq = lifecycle;
    const t = text();
    const body = el("div", "worktree-form");
    // フォルダが無い行は「消えます」とは言えない。管理情報の掃除であることを
    // 伝える別文面にする (サーバ側も remove ではなく prune に切り替わる)。
    if (item.missing) {
      body.appendChild(el("p", "", t.removeDialog.missingBody(item.name)));
      body.appendChild(el("p", "worktree-hint", t.removeDialog.missingNote));
      // prune は対象を 1 本に絞れないので、同じ状態の登録が他にあれば
      // まとめて消えることを先に伝える。
      const otherMissing = (data?.worktrees || []).filter(
        (candidate) => candidate.missing && candidate.id !== item.id,
      ).length;
      if (otherMissing > 0) {
        body.appendChild(
          el("p", "worktree-hint", t.removeDialog.missingOthers(otherMissing)),
        );
      }
    } else {
      body.appendChild(el("p", "", t.removeDialog.body(item.name)));
      body.appendChild(el("p", "", t.removeDialog.diskNote(item.path)));
    }
    if (item.branch) {
      body.appendChild(
        el("p", "worktree-hint", t.removeDialog.branchNote(item.branch)),
      );
    }
    let force: HTMLInputElement | null = null;
    if (!item.missing && item.changedCount > 0) {
      // 警告は最初から見せる。チェックを入れたときに出現する形だと、
      // 読む前に押せてしまう。
      const warn = el("p", "worktree-warn");
      warn.appendChild(
        el("span", "", `⚠ ${t.removeDialog.dirtyNote(item.changedCount)}`),
      );
      warn.appendChild(document.createElement("br"));
      warn.appendChild(el("span", "", t.removeDialog.dirtyLose));
      body.appendChild(warn);
      const forceWrap = document.createElement("label");
      forceWrap.className = "worktree-check";
      force = document.createElement("input");
      force.type = "checkbox";
      forceWrap.append(force, el("span", "", t.removeDialog.force));
      body.appendChild(forceWrap);
    }

    const submitted = await showFormDialog<{ force: boolean }>({
      title: t.removeDialog.title,
      body,
      submitLabel: t.removeDialog.submit,
      cancelLabel: t.cancel,
      // フォルダごと消える不可逆の操作なので、確定は常に危険色。
      danger: true,
      validate: () =>
        force && !force.checked ? t.removeDialog.forceRequired : null,
      submit: () => ({ force: force?.checked ?? false }),
    });
    if (!submitted) return;
    if (!isCurrent(seq)) return;

    busyPath = item.path;
    renderList();
    try {
      await deps.trackLoad(
        postWorktreeAction("/_worktree/remove", {
          path: item.path,
          force: submitted.force,
        }),
      );
      if (isCurrent(seq)) setMessage("");
      // 消した作業ツリーを選んだままにしない。
      if (isCurrent(seq) && route()?.wt === item.id) {
        navigate({ wt: undefined, file: undefined, origin: undefined }, true);
      }
    } catch (error) {
      if (isCurrent(seq)) {
        setMessage(
          error instanceof Error ? error.message : t.removeFailed,
          true,
        );
      }
    } finally {
      busyPath = "";
      if (isCurrent(seq)) await refresh();
    }
  }

  // ---- 左パネル: 作業ツリー一覧 ----

  /** そのファイルを触っている「自分以外」の作業ツリー名。 */
  function overlapOthers(
    item: WorktreeItem,
    file: WorktreeFileChange,
  ): string[] {
    const paths = new Set([file.path, file.oldPath].filter(Boolean));
    const ownerIds = new Set(
      (data?.overlaps || [])
        .filter((overlap) => paths.has(overlap.path))
        .flatMap((overlap) => overlap.worktreeIds),
    );
    return [...ownerIds]
      .filter((id) => id !== item.id)
      .map((id) => worktreeLabel(id));
  }

  /** 位置関係とマージ可否を 1 行の文にする。行の見た目は History のまま。 */
  function divergenceSummary(item: WorktreeItem): string {
    const t = text();
    const divergence = item.divergence;
    if (!divergence) return t.diverge.notComparable;
    const parts: string[] = [];
    // 狭い行で省略されても、一番大事な「マージできるか」が先に読めるように
    // 可否を前、位置関係を後に置く。
    // 「調べられなかった」を「衝突しない」と混ぜない。
    if (divergence.mergeState === "clean") {
      parts.push(t.merge.clean);
    } else if (divergence.mergeState === "conflict") {
      parts.push(t.merge.conflict(divergence.conflicts.length));
    } else {
      parts.push(t.merge.unknown);
    }
    if (divergence.ahead > 0) {
      parts.push(t.diverge.ahead(divergence.ahead, divergence.base));
    }
    if (divergence.behind > 0) {
      parts.push(t.diverge.behind(divergence.behind, divergence.base));
    }
    if (!divergence.ahead && !divergence.behind) {
      parts.push(t.diverge.even(divergence.base));
    }
    return parts.join(" · ");
  }

  /** 1 段目の右に出す状態バッジ。理由は title に入る。 */
  function worktreeBadges(
    item: WorktreeItem,
  ): Array<{ label: string; title: string }> {
    const t = text();
    const badges: Array<{ label: string; title: string }> = [];
    if (item.current) {
      badges.push({ label: t.badges.current, title: t.badges.currentTitle });
    }
    if (item.serverUrl) {
      badges.push({ label: t.badges.running, title: t.badges.runningTitle });
    }
    if (item.missing) badges.push({ label: t.badges.missing, title: "" });
    if (item.bare) {
      badges.push({ label: t.badges.bare, title: t.badges.bareTitle });
    }
    if (item.locked) {
      badges.push({ label: t.badges.locked, title: item.lockedReason });
    }
    if (item.prunable) {
      badges.push({ label: t.badges.prunable, title: t.badges.prunableTitle });
    }
    return badges;
  }

  function headButton(
    label: string,
    title: string,
    onClick: () => void,
  ): HTMLButtonElement {
    // 文字を入れるボタンは共通の .gdp-btn。History の .history-refresh は
    // 幅も高さも固定のアイコン枠なので、文字を入れると潰れる。
    const button = el("button", "gdp-btn gdp-btn-sm worktree-head-btn", label);
    button.type = "button";
    button.title = title;
    button.addEventListener("click", onClick);
    return button;
  }

  /**
   * 「フォルダを開く」。行の中ではアイコンだけ、案内カードでは文字つき。
   * 実体は app.ts が持つ /_open_path の呼び出しで、Finder / Explorer が開く。
   */
  function openFolderButton(
    item: WorktreeItem,
    withLabel: boolean,
  ): HTMLButtonElement {
    const t = text();
    const button = el(
      "button",
      withLabel
        ? "gdp-btn gdp-btn-sm gdp-open-path"
        : "gdp-file-header-icon gdp-open-path",
      withLabel ? t.actions.openFolder : undefined,
    );
    button.type = "button";
    button.title = t.actions.openFolderTitle;
    button.setAttribute("aria-label", t.actions.openFolderTitle);
    if (!withLabel) {
      button.innerHTML = iconSvg(
        "octicon-link-external",
        OPEN_EXTERNAL_16_PATH,
      );
    }
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      void deps.openPathInOs(item.path, "directory", button);
    });
    return button;
  }

  /** 「パスをコピー」。cd して作業を始めるためのもの。 */
  function copyPathButton(
    item: WorktreeItem,
    withLabel: boolean,
  ): HTMLButtonElement {
    const t = text();
    const button = el(
      "button",
      withLabel
        ? "gdp-btn gdp-btn-sm gdp-copy-path"
        : "gdp-file-header-icon gdp-copy-path",
      withLabel ? t.actions.copyPath : undefined,
    );
    button.type = "button";
    button.title = t.actions.copyPathTitle;
    button.setAttribute("aria-label", t.actions.copyPathTitle);
    if (!withLabel) {
      button.innerHTML = iconSvg("octicon-copy", COPY_16_PATHS);
    }
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      button.classList.remove("copied", "failed");
      try {
        await navigator.clipboard.writeText(item.path);
        button.classList.add("copied");
      } catch {
        button.classList.add("failed");
      }
      window.setTimeout(
        () => button.classList.remove("copied", "failed"),
        1200,
      );
    });
    return button;
  }

  /**
   * 選んだ行の内側に出す操作。行とボタンの間に距離があると「どれへの操作か」
   * を読み取らせることになるので、対象の行の中に入れる。
   */
  function rowActions(item: WorktreeItem): HTMLElement {
    const t = text();
    const actions = el("span", "worktree-row-actions");
    // 行そのもののクリック (選択) とボタンのクリックを分ける。
    actions.addEventListener("click", (event) => event.stopPropagation());
    if (!item.missing && !item.bare) {
      actions.appendChild(openFolderButton(item, false));
      actions.appendChild(copyPathButton(item, false));
      const open = headButton(t.open, t.openTitle, () => {
        void openWorktree(item);
      });
      open.disabled = !!busyPath;
      open.setAttribute("aria-busy", busyPath === item.path ? "true" : "false");
      actions.appendChild(open);
    }
    // 自分が映している作業ツリーは外させない。サーバも 409 で拒否する。
    if (!item.current) {
      const remove = headButton(t.remove, t.removeTitle, () => {
        void removeWorktree(item);
      });
      remove.disabled = !!busyPath;
      actions.appendChild(remove);
    }
    return actions;
  }

  function note(body: string, isError = false): HTMLElement {
    const node = el("div", "history-status", body);
    node.hidden = false;
    if (isError) {
      node.setAttribute("role", "alert");
      node.style.color = "var(--danger)";
    }
    return node;
  }

  function renderList(): void {
    if (!listPanel) return;
    const t = text();
    listPanel.replaceChildren();

    const head = el("div", "history-head");
    head.appendChild(el("span", "history-title", t.panes.worktrees));
    head.appendChild(
      headButton(t.refresh, t.refreshTitle, () => {
        void refresh();
      }),
    );
    head.appendChild(
      headButton(t.add, t.addTitle, () => {
        void addWorktree();
      }),
    );
    listPanel.appendChild(head);

    worktreeFilterInput.placeholder = t.panes.filterWorktrees;
    const filterWrap = el("div", "history-filter-wrap");
    filterWrap.appendChild(worktreeFilterInput);
    listPanel.appendChild(filterWrap);

    // 基準ブランチ名は各行の 4 段目に載るので、見つからなかったときだけ
    // 理由をここに出す。
    if (data && !data.baseBranch) {
      listPanel.appendChild(note(t.baseUnknown));
    }
    if (message) listPanel.appendChild(note(message, messageIsError));

    const overlaps = data?.overlaps || [];
    if (overlaps.length) {
      const banner = el("div", "history-banner");
      banner.hidden = false;
      banner.textContent = `${t.overlaps.heading(overlaps.length)} — ${t.overlaps.intro}`;
      banner.title = overlaps
        .map((overlap) =>
          t.overlaps.entry(
            overlap.path,
            overlap.worktreeIds.map((id) => worktreeLabel(id)),
          ),
        )
        .join("\n");
      listPanel.appendChild(banner);
    }

    if (!data) {
      listPanel.appendChild(note(t.loading));
      return;
    }
    if (!data.worktrees.length) {
      listPanel.appendChild(note(t.empty));
      return;
    }
    const items = data.worktrees.filter(
      (item) =>
        matches(item.name, worktreeFilter) ||
        matches(item.branch, worktreeFilter) ||
        matches(item.displayPath, worktreeFilter),
    );
    if (!items.length) {
      listPanel.appendChild(note(t.panes.noWorktreeMatch));
      return;
    }

    const list = el("ol", "history-list");
    const selected = route()?.wt;
    for (const item of items) {
      const row = el("li", "history-item");
      row.dataset.wt = item.id;
      if (item.id === selected) row.classList.add("active");
      if (item.divergence?.mergeState === "conflict") {
        row.classList.add("worktree-conflict");
      }

      // 1 段目: 名前 + 状態バッジ (右寄せ)。
      const head = el("span", "worktree-row-head");
      const subject = el("span", "subject", item.name);
      subject.title = item.path;
      head.appendChild(subject);
      const badges = worktreeBadges(item);
      if (badges.length) {
        const wrap = el("span", "worktree-row-badges");
        badges.forEach((badge, index) => {
          if (index) wrap.appendChild(document.createTextNode(" · "));
          const node = el("span", "worktree-badge", badge.label);
          node.title = badge.title;
          wrap.appendChild(node);
        });
        head.appendChild(wrap);
      }
      row.appendChild(head);

      // 2 段目: フォルダの場所。「それはどこのフォルダなのか」が一番知りたい
      // 情報なのでホバーに隠さない。長いときは頭側を省略し、フルパスは title。
      const pathLine = el("span", "worktree-row-path", item.displayPath);
      pathLine.title = item.path;
      row.appendChild(pathLine);

      // 3 段目: ブランチ・変更数・最終コミット。
      const meta = el("span", "meta2");
      meta.appendChild(el("span", "sha", item.branch || t.badges.detached));
      meta.appendChild(
        el(
          "span",
          "author",
          item.fileCount ? t.files.heading(item.fileCount) : t.files.none,
        ),
      );
      if (item.lastCommit) {
        const parsed = Date.parse(item.lastCommit.when);
        const when = el(
          "span",
          "when",
          Number.isFinite(parsed)
            ? blameRelativeTime(Math.round(parsed / 1000))
            : item.lastCommit.when,
        );
        // ホバーでは件名と絶対日時の両方を出す。
        when.title = Number.isFinite(parsed)
          ? `${item.lastCommit.subject}\n${new Date(parsed).toLocaleString()}`
          : item.lastCommit.subject;
        meta.appendChild(when);
      }
      // 最終更新は mtime ベース。コミットせずに置かれた作業ツリーでも動く。
      if (item.lastTouched) {
        const parsed = Date.parse(item.lastTouched);
        const when = el(
          "span",
          "when",
          Number.isFinite(parsed)
            ? t.lastTouched(blameRelativeTime(Math.round(parsed / 1000)))
            : t.lastTouched(item.lastTouched),
        );
        when.title = Number.isFinite(parsed)
          ? new Date(parsed).toLocaleString()
          : item.lastTouched;
        meta.appendChild(when);
      }
      row.appendChild(meta);

      // 4 段目: マージできるか + 位置関係。フル文は title に。
      const second = el("span", "meta2");
      const summary = divergenceSummary(item);
      const summaryText = el("span", "author", summary);
      summaryText.title = summary;
      second.appendChild(summaryText);
      row.appendChild(second);

      if (item.error) {
        const error = el("span", "meta2");
        const detail = el("span", "author", item.error);
        detail.style.color = "var(--danger)";
        error.appendChild(detail);
        row.appendChild(error);
      }

      // 操作は選んだ行の内側にだけ出す。
      if (item.id === selected) row.appendChild(rowActions(item));
      list.appendChild(row);
    }
    list.addEventListener("click", (event) => {
      const row = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        ".history-item",
      );
      const id = row?.dataset.wt;
      if (!id) return;
      // 別の作業ツリーへ移ったらファイル選択は持ち越さない。
      navigate({ wt: id, file: undefined, origin: undefined });
    });
    listPanel.appendChild(list);

    // メインの 1 本しか無いときは、この一覧に何が並ぶかを 1 行で伝える。
    if (data.worktrees.length === 1) {
      listPanel.appendChild(note(t.intro.listNote));
    }
  }

  /**
   * まだ 1 本も作っていないときの説明カード。何も無い右ペインに出すので
   * 説明がノイズにならず、2 本目を作った時点で二度と出ない (永続化しない)。
   */
  function introCard(): HTMLElement {
    const t = text();
    const card = el("div", "worktree-intro");
    card.appendChild(el("p", "worktree-intro-title", t.intro.cardTitle));
    card.appendChild(el("p", "", t.intro.cardWhat));
    card.appendChild(el("p", "", t.intro.cardWhy));
    card.appendChild(el("p", "", t.intro.cardHow));
    const button = el("button", "gdp-btn gdp-btn-sm", t.intro.cardButton);
    button.type = "button";
    button.addEventListener("click", () => {
      void addWorktree();
    });
    card.appendChild(button);
    return card;
  }

  /**
   * 画面に出すファイル。サイドバーの絞り込みと、topbar の「テスト非表示」を
   * 両方かけた結果。**一覧と差分で同じものを使う**ので、片方にだけテストが
   * 残るようなずれが起きない。
   */
  function visibleFiles(item: WorktreeItem): WorktreeFileChange[] {
    const hideTests = deps.getOptions().hideTests;
    return item.files.filter(
      (file) =>
        matches(file.path, fileFilter) &&
        !(hideTests && deps.isTestPath(file.path)),
    );
  }

  // ---- 中央: サイドバーの変更ファイル一覧 ----

  /** パスを 1 段ずつ畳んだ木。ディレクトリは Map で順序を保つ。 */
  type FileTree = {
    dirs: Map<string, FileTree>;
    files: WorktreeFileChange[];
  };

  function emptyTree(): FileTree {
    return { dirs: new Map(), files: [] };
  }

  function buildTree(files: WorktreeFileChange[]): FileTree {
    const root = emptyTree();
    for (const file of files) {
      const parts = file.path.split("/");
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const name = parts[i];
        let child = node.dirs.get(name);
        if (!child) {
          child = emptyTree();
          node.dirs.set(name, child);
        }
        node = child;
      }
      node.files.push(file);
    }
    return root;
  }

  /**
   * 中身が 1 ディレクトリだけの階層は畳んで `a/b/c` の 1 行にする。
   * Repository のツリーと同じ読み味にするため。
   */
  function collapseChain(name: string, node: FileTree): [string, FileTree] {
    let label = name;
    let current = node;
    while (current.files.length === 0 && current.dirs.size === 1) {
      const [childName, child] = [...current.dirs.entries()][0];
      label = `${label}/${childName}`;
      current = child;
    }
    return [label, current];
  }

  function fileRow(
    item: WorktreeItem,
    file: WorktreeFileChange,
    depth: number,
    label: string,
  ): HTMLLIElement {
    const t = text();
    const row = el("li", "tree-file");
    row.tabIndex = -1;
    row.dataset.path = file.path;
    row.dataset.key = fileKey(file);
    row.dataset.type = "blob";
    const currentRoute = route();
    if (
      currentRoute?.file === file.path &&
      currentRoute.origin === file.origin
    ) {
      row.classList.add("active");
    }
    row.style.setProperty("--lvl-pad", `${12 + depth * 14}px`);
    row.appendChild(el("span", "chev-spacer"));
    const badge = el("span", `badge ${file.status}`, file.status);
    badge.title = t.files.statusTitles[file.status] || file.status;
    row.appendChild(badge);
    const name = el("span", "name", label);
    name.title = file.path;
    row.appendChild(name);
    // 重なりは行末に「何本と重なっているか」の数で出す。色を変えると、
    // 重なりが多いリポジトリでは一覧がまるごと染まって読めなくなる
    // (実測: ある worktree 群では 147 ファイルが該当した)。
    // .badge は M / A / D の 1 文字用の枠なので語も入れられない。
    const others = overlapOthers(item, file);
    if (others.length) {
      row.classList.add("worktree-overlap");
      const mark = el(
        "span",
        "stat worktree-overlap-count",
        String(others.length),
      );
      mark.title = t.files.overlapTitle(others);
      row.appendChild(mark);
      name.title = `${file.path}\n${t.files.overlapTitle(others)}`;
    }
    return row;
  }

  function renderTreeInto(
    parent: HTMLElement,
    item: WorktreeItem,
    node: FileTree,
    depth: number,
  ): void {
    for (const [rawName, rawChild] of node.dirs) {
      const [label, child] = collapseChain(rawName, rawChild);
      const li = el("li", "tree-dir");
      li.tabIndex = -1;
      li.dataset.type = "tree";
      li.style.setProperty("--lvl-pad", `${12 + depth * 14}px`);
      const chev = el("span", "chev");
      chev.innerHTML = chevronSvg();
      const icon = el("span", "dir-icon");
      icon.innerHTML = folderSvg(false);
      const name = el("span", "name", label);
      name.title = label;
      li.append(chev, icon, name);
      const toggle = (event: Event) => {
        event.stopPropagation();
        const collapsed = li.classList.toggle("collapsed");
        icon.innerHTML = folderSvg(collapsed);
      };
      chev.addEventListener("click", toggle);
      icon.addEventListener("click", toggle);
      parent.appendChild(li);
      // 子は .tree-dir の**兄弟**として置く。CSS が
      // `#filelist.tree .tree-dir.collapsed + .tree-children` で畳むため、
      // 中に入れると折りたたみが効かず、行も横に並んでしまう。
      const children = el("ul", "tree-children");
      renderTreeInto(children, item, child, depth + 1);
      parent.appendChild(children);
    }
    for (const file of node.files) {
      const parts = file.path.split("/");
      parent.appendChild(
        fileRow(item, file, depth, parts[parts.length - 1] || file.path),
      );
    }
  }

  function renderFiles(): void {
    const t = text();
    const list = document.getElementById("filelist");
    const title = document.querySelector<HTMLElement>(".sb-title");
    const totals = document.getElementById("totals");
    if (!list) return;
    const tree = deps.getSidebarView() === "tree";
    list.classList.toggle("tree", tree);
    for (const button of sidebarViewButtons()) {
      const active = button.dataset.view === (tree ? "tree" : "flat");
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      ".sb-tree-action",
    )) {
      button.disabled = !tree;
    }
    if (title) title.textContent = t.panes.files;
    const item = selectedWorktree();
    if (totals) {
      totals.textContent = item ? t.files.heading(item.fileCount) : "";
    }
    list.replaceChildren();
    if (!item) {
      list.appendChild(note(t.panes.selectWorktree));
      return;
    }
    if (!item.fileCount) {
      list.appendChild(note(t.files.none));
      return;
    }
    const shown = visibleFiles(item);
    if (!shown.length) {
      list.appendChild(note(t.panes.noFileMatch));
      return;
    }
    // ⇄ が 1 つでも出るなら、その意味を先頭に置く。出ないなら置かない。
    if (shown.some((entry) => overlapOthers(item, entry).length > 0)) {
      list.appendChild(
        el("li", "worktree-overlap-legend", t.intro.overlapLegend),
      );
    }
    // ツリー用の CSS は #filelist.tree にぶら下がっている。
    for (const group of ["uncommitted", "committed"] as const) {
      const files = shown.filter((file) => file.origin === group);
      if (!files.length) continue;
      // 区切りの見出し。パスの行ではないので .tree-file の省略ルール
      // (nowrap + ellipsis) に乗せない。乗せると日本語が 1 文字ずつ縦に潰れる。
      list.appendChild(
        el(
          "li",
          "worktree-file-group",
          group === "uncommitted" ? t.files.uncommitted : t.files.committed,
        ),
      );
      if (tree) renderTreeInto(list, item, buildTree(files), 0);
      else {
        for (const file of files) {
          list.appendChild(fileRow(item, file, 0, file.path));
        }
      }
    }
  }

  /**
   * #filelist は画面をまたいで残る要素なので、listener は mount で 1 回だけ
   * 付ける。renderFiles のたびに足すと、絞り込みや SSE で描き直すたびに
   * ハンドラが増え、1 クリックで何度も route が動く。
   */
  function onFileListClick(event: Event): void {
    const row = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      ".tree-file",
    );
    const key = row?.dataset.key;
    if (!key) return;
    // History と同じで、クリックは「そこへ飛ぶ」。差分は既に全部積んである。
    const shell = document.querySelector<HTMLElement>(
      `#diff .gdp-file-shell[data-key="${CSS.escape(key)}"]`,
    );
    restoredRouteKey = key;
    shell?.scrollIntoView({ block: "start" });
    const [origin, ...rest] = key.split(":");
    navigate(
      {
        file: rest.join(":"),
        origin: origin === "committed" ? "committed" : "uncommitted",
      },
      true,
    );
  }

  // ---- 右: 変更ファイル全部の差分 ----

  /**
   * 今 #diff に積んであるものを表す鍵。作業ツリーだけでなく表示設定も入れる。
   * topbar のトグルを動かしたら積み直す必要があるため。
   */
  function diffKey(item: WorktreeItem | null): string {
    const options = deps.getOptions();
    return [
      item?.path || "",
      options.layout,
      options.ignoreWs ? "w" : "",
      options.hideTests ? "t" : "",
      options.syntax ? "s" : "",
      fileFilter,
    ].join("|");
  }

  async function loadShell(
    item: WorktreeItem,
    file: WorktreeFileChange,
    shell: HTMLElement,
  ): Promise<void> {
    const seq = lifecycle;
    const serverGeneration = acceptedServerGeneration;
    const renderKey = diffKey(item);
    const t = text();
    const body = shell.querySelector<HTMLElement>(".gdp-shell-body");
    if (!body) return;
    const params = new URLSearchParams({
      path: item.path,
      file: file.path,
      origin: file.origin,
    });
    // 未追跡は HEAD に無いので、サーバ側で --no-index に切り替えてもらう。
    if (file.status === "U") params.set("untracked", "1");
    // topbar の「空白」。Diff ビューアと同じキー。
    if (deps.getOptions().ignoreWs) params.set("ignore_ws", "1");
    try {
      const res = await deps.trackLoad(
        fetch(`/_worktree/diff?${params.toString()}`).then(async (response) => {
          if (!response.ok) {
            throw new Error((await response.text()) || `${response.status}`);
          }
          return (await response.json()) as WorktreeDiffResponse;
        }),
      );
      if (
        !isCurrent(seq) ||
        !shell.isConnected ||
        diffKey(item) !== renderKey
      ) {
        return;
      }
      // ここで generation は見ない。サーバの generation は「ファイルが動いた
      // 回数」で、こちらが投げたリクエストの世代ではない。一覧より新しければ
      // 捨てる / refresh する、という作りにすると、保存が続くリポジトリでは
      // refresh が lifecycle を進め、その refresh が積み直した差分がまた
      // 捨てられて、全ファイルが「読み込んでいます…」のまま止まる (実測)。
      //
      // 古い応答を捨てる仕事は、上の isCurrent(seq) と renderKey の比較が既に
      // している。一覧と差分のずれは SSE 経由の refresh が直す。
      // 「構文」が入っているときだけハイライタを待つ。切っていれば読まない。
      const options = deps.getOptions();
      const hljs = options.syntax ? await deps.loadHljs() : null;
      if (
        !isCurrent(seq) ||
        !shell.isConnected ||
        diffKey(item) !== renderKey
      ) {
        return;
      }
      body.replaceChildren();
      if (!res.diff.trim()) {
        body.appendChild(el("div", "gdp-info", t.panes.diffEmpty));
      } else {
        // 差分が描けたら自前の見出しは畳む。diff2html が同じ内容の見出し
        // (パス・CHANGED・Viewed) を出すので、残すと 2 段になる。Diff
        // ビューアも描画後に .gdp-shell-header を隠している。
        // 読み込み中とエラー時は、どのファイルの話か分かるように残す。
        const head = shell.querySelector<HTMLElement>(".gdp-shell-header");
        if (head) head.style.display = "none";
        if (res.truncated) {
          body.appendChild(
            el(
              "div",
              "gdp-info",
              t.panes.diffTruncated(res.renderedHunks, res.totalHunks),
            ),
          );
        }
        const host = el("div", "");
        body.appendChild(host);
        // 描画は Diff ビューアと同じ diff2html。設定も揃えてある。
        const ui = new window.Diff2HtmlUI(
          host,
          res.diff,
          {
            drawFileList: false,
            matching: "lines",
            // topbar の 統合 / 分割。
            outputFormat: options.layout,
            synchronisedScroll: true,
            // topbar の「構文」。diff2html 自身に塗らせる (Diff ビューアは
            // 巨大ファイル対策で自前の idle 描画を持つが、こちらは 1 本ぶんの
            // 変更が対象なのでライブラリに任せる)。
            highlight: !!hljs,
            fileListToggle: false,
            fileContentToggle: false,
          },
          hljs as ConstructorParameters<typeof window.Diff2HtmlUI>[3],
        );
        ui.draw();
      }
      shell.classList.add("loaded");
    } catch (error) {
      if (!isCurrent(seq) || !shell.isConnected) return;
      body.replaceChildren();
      const failure = el(
        "div",
        "gdp-info",
        error instanceof Error ? error.message : t.panes.diffFailed,
      );
      failure.setAttribute("role", "alert");
      body.appendChild(failure);
      shell.classList.add("loaded");
    }
  }

  function renderDiffs(): void {
    const t = text();
    const diff = document.getElementById("diff");
    if (!diff) return;
    const item = selectedWorktree();
    observer?.disconnect();
    observer = null;
    restoredRouteKey = null;
    diff.replaceChildren();
    if (!item) {
      // 1 本も作られていない (= メインだけ) なら、これが何の画面かの説明を
      // 出す。2 本目があるのに未選択なら、いつもの案内。
      if (data && data.worktrees.length === 1) {
        diff.appendChild(introCard());
      } else {
        diff.appendChild(el("div", "gdp-info", t.panes.selectWorktree));
      }
      diffFor = "";
      return;
    }
    if (!item.fileCount) {
      // 空のままにせず、次にやること (そのフォルダで編集する) を書く。
      const card = el("div", "gdp-info worktree-empty-diff");
      card.appendChild(el("p", "", t.emptyDiff.title));
      card.appendChild(el("p", "", t.emptyDiff.body(item.path)));
      if (!item.missing && !item.bare) {
        const buttons = el("span", "worktree-empty-diff-actions");
        buttons.appendChild(openFolderButton(item, true));
        buttons.appendChild(copyPathButton(item, true));
        card.appendChild(buttons);
      }
      diff.appendChild(card);
      diffFor = diffKey(item);
      return;
    }

    const files = visibleFiles(item);
    if (!files.length) {
      diff.appendChild(el("div", "gdp-info", t.panes.noFileMatch));
      diffFor = diffKey(item);
      return;
    }
    const pending = new Map<HTMLElement, WorktreeFileChange>();
    for (const file of files) {
      const shell = el("div", "gdp-file-shell");
      shell.dataset.path = file.path;
      shell.dataset.key = fileKey(file);
      shell.dataset.status = file.status;
      const head = el("div", "gdp-shell-header");
      head.appendChild(el("span", `status-pill ${file.status}`, file.status));
      head.appendChild(el("span", "path", file.path));
      const stats = el("span", "stats");
      stats.appendChild(el("span", "a", `+${file.additions}`));
      stats.appendChild(el("span", "d", `−${file.deletions}`));
      head.appendChild(stats);
      shell.appendChild(head);
      const body = el("div", "gdp-shell-body");
      body.appendChild(el("div", "gdp-info", t.panes.diffLoading));
      shell.appendChild(body);
      diff.appendChild(shell);
      pending.set(shell, file);
    }
    diffFor = diffKey(item);

    // 見えたものから読む。History と同じで、全部を一度に取りに行かない。
    if (typeof IntersectionObserver === "undefined") {
      for (const [shell, file] of pending) void loadShell(item, file, shell);
      return;
    }
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const shell = entry.target as HTMLElement;
          const file = pending.get(shell);
          if (!file) continue;
          pending.delete(shell);
          observer?.unobserve(shell);
          void loadShell(item, file, shell);
        }
      },
      { rootMargin: DIFF_PREFETCH_MARGIN },
    );
    for (const shell of pending.keys()) observer.observe(shell);
  }

  function render(): void {
    renderList();
    renderFiles();
    const item = selectedWorktree();
    // 同じ作業ツリーを映しているなら積み直さない (読み込み済みが消える)。
    if (diffKey(item) !== diffFor) renderDiffs();
    restoreRouteSelection();
  }

  function restoreRouteSelection(): void {
    const current = route();
    if (!current?.file || !current.origin) {
      restoredRouteKey = null;
      return;
    }
    const key = `${current.origin}:${current.file}`;
    if (key === restoredRouteKey) return;
    const shell = document.querySelector<HTMLElement>(
      `#diff .gdp-file-shell[data-key="${CSS.escape(key)}"]`,
    );
    if (!shell) return;
    restoredRouteKey = key;
    shell.scrollIntoView({ block: "start" });
  }

  return {
    async enter(): Promise<void> {
      if (deps.getRoute().screen !== "worktree") return;
      if (mounted) {
        render();
        return;
      }
      mount();
      // suspend 中に変更された可能性があるため、再入場時は必ず取り直す。
      await refresh();
    },
    suspend,
    reload(): Promise<void> {
      if (!mounted) return this.enter();
      return refresh();
    },
    displayOptionsChanged(): void {
      if (!mounted) return;
      diffFor = null;
      render();
    },
    handleSse(): void {
      if (!mounted) return;
      // 保存 1 回で何本もイベントが飛ぶので、最後の 1 回だけ引き直す。
      if (sseTimer !== null) window.clearTimeout(sseTimer);
      sseTimer = window.setTimeout(() => {
        sseTimer = null;
        void refresh();
      }, SSE_REFRESH_DELAY_MS);
    },
    localize(): void {
      if (!mounted) return;
      diffFor = null;
      render();
    },
  };
}
