import { live } from "lit/directives/live.js";
import { repeat } from "lit/directives/repeat.js";
import { html, nothing } from "lit/html.js";
import { apiUrl, projectKey } from "../core/api-url";

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

import { relativeTimeText } from "../core/blame";
import { formatErrorDetail, responseErrorMessage } from "../core/error-detail";
import {
  CHEVRON_DOWN_16_PATH,
  COPY_16_PATHS,
  FOLDER_ICON_PATHS,
  KEBAB_16_PATH,
} from "../core/icons";
import { projectDestination } from "../core/projects";
import type { AppRoute } from "../core/routes";
import type {
  CommitMeta,
  WorktreeActionResponse,
  WorktreeCommitsResponse,
  WorktreeDiffResponse,
  WorktreesResponse,
} from "../core/types";
import type { WorktreeFileChange, WorktreeItem } from "../core/worktree";
import { worktreeBranchError, worktreeNameError } from "../core/worktree";
import {
  type ContextMenuItem,
  closeContextMenu,
  showContextMenu,
} from "./context-menu";
import { attachStickyHScroll, detachStickyHScroll } from "./diff-hscroll";
import {
  adjacentRow,
  type FocusedListRow,
  focusedListRow,
  type ListRowKeys,
  onListRowKeys,
  syncListTabStop,
} from "./list-tab-stop";
import { enhanceMediaCard } from "./media-embed";
import { pageLanguage } from "./page-language";
import type { PageView } from "./page-view";
import { treeLevelPad } from "./tree-indent";
import { iconTemplate } from "./ui/icon";
import { setAttributeIfChanged } from "./ui/attributes";
import { detachedElement, renderOwned, templateElement } from "./ui/renderer";
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
  /**
   * #sidebar (#filelist。変更ファイルの一覧) の持ち主が変わる。true = この画面が
   * 作業ツリーの変更ファイルを書く。false = 一覧だけの表示で、#sidebar は使わない
   * (ファイル一覧は別の要素 #file-list なので、app.ts は今は何もしない)。
   */
  onSidebarOwner(owned: boolean): void;
  setStatus(status: "live" | "refreshing" | "error" | null): void;
  /**
   * フォルダを OS のファイルマネージャで開くボタン。Repository / Diff /
   * サイドバー / ソースの各画面と同じ app.ts の共有ファクトリを受け取る
   * (アイコン・クラス・失敗時の扱いを 1 箇所に保つため)。
   */
  createOpenPathButton(
    path: string,
    kind: "directory" | "file-parent",
    title?: string,
  ): HTMLButtonElement;
  /**
   * 同じ操作を、ボタンを介さずに実行する。メニューの項目にはボタンが無いので
   * こちらを使う。**失敗は理由を付けて投げる**ので、この画面のメッセージ欄に出せる。
   */
  openPathInOs(path: string, kind: "directory" | "file-parent"): Promise<void>;
  /**
   * 一覧のエージェント (全体ボードと同じもの)。作業ツリーの行に、そこで
   * 動いているエージェントの状態を出す。cwd が作業ツリーの中にあるものを
   * その行に数える。
   */
  getAgents(): WorktreeAgent[];
  /** エージェントの一覧が変わったら呼ぶ。戻り値は購読の解除。 */
  subscribeAgents(listener: () => void): () => void;
};

/** 作業ツリーの行に出すエージェント 1 つ。 */
export type WorktreeAgent = {
  /** ペインの cwd。 */
  path: string;
  /** 種類の名前 (claude / codex)。 */
  kind: string;
  state: "waiting" | "working" | "done" | "idle";
  /** 状態の名前 (「入力待ち」など)。 */
  stateLabel: string;
};

export type WorktreeView = PageView & {
  resetProject(): void;
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
  if (!res.ok) throw new Error(await responseErrorMessage(res, `POST ${path}`));
  return (await res.json()) as WorktreeActionResponse;
}

/** 失敗を console に出し、画面に出す「操作の失敗と理由の全文」を返す。 */
function failureMessage(operation: string, error: unknown): string {
  console.error(`[code-viewer] ${operation}`, error);
  return `${operation}\n${formatErrorDetail(error)}`;
}

/** ファイル 1 件を指す鍵。同じパスが未コミットと分岐後の両方に出るため。 */
function fileKey(file: WorktreeFileChange): string {
  return `${file.origin}:${file.path}`;
}

function matches(haystack: string, needle: string): boolean {
  return !needle || haystack.toLowerCase().includes(needle.toLowerCase());
}

/** 一覧やファイルの欄に挟む 1 行の知らせ。error は理由の全文 (赤)。 */
export type WorktreeNote = { text: string; error: boolean };

/** 文字列を写すボタン。押した後の印 (copied / failed) は押したボタンに付ける。 */
export type WorktreeCopyProps = {
  title: string;
  /** 文字つきならその文字。null はアイコンだけ。 */
  label: string | null;
  onCopy(button: HTMLButtonElement): void;
};

export type WorktreeWhen = { text: string; title: string };

/** 作業ツリーの一覧の 1 行。 */
export type WorktreeRowProps = {
  id: string;
  active: boolean;
  current: boolean;
  conflict: boolean;
  /** 見出しのブランチ (ブランチが無ければ「detached」の語)。 */
  heading: string;
  name: string;
  path: string;
  badges: { label: string; title: string }[];
  branch: { text: string; title: string | null };
  files: string;
  lastCommit: WorktreeWhen | null;
  lastTouched: WorktreeWhen | null;
  divergence: string;
  merge: WorktreeCopyProps | null;
  /** いちばん急ぐエージェント (more はほかの数)。居なければ null。 */
  agents: {
    state: string;
    label: string;
    more: number;
    title: string;
  } | null;
  open: {
    label: string;
    title: string;
    disabled: boolean;
    onClick(): void;
  } | null;
  menu: {
    title: string;
    label: string;
    onOpen(anchor: HTMLElement): void;
  } | null;
  error: string | null;
};

/** 左の一覧の箱 (#worktree-panel) の中。 */
export type WorktreePanelProps = {
  title: string;
  count: string | null;
  refresh: { label: string; title: string; onClick(): void };
  add: { label: string; title: string; onClick(): void };
  filter: { value: string; placeholder: string; onInput(value: string): void };
  notes: WorktreeNote[];
  overlaps: { text: string; title: string } | null;
  body:
    | { kind: "note"; note: WorktreeNote }
    | {
        kind: "list";
        columns: string[];
        label: string;
        rows: WorktreeRowProps[];
        onSelect(id: string): void;
        /** 一覧の下の説明 (メインの 1 本だけのとき)。 */
        footer: string | null;
      };
};

export type WorktreeFileProps = {
  path: string;
  key: string;
  status: string;
  statusTitle: string;
  label: string;
  depth: number;
  active: boolean;
  nameTitle: string;
  overlap: { count: number; title: string } | null;
};

/** 変更ファイルの欄 (#filelist) の 1 項目。フォルダは子を持つ。 */
export type WorktreeFileEntry =
  | { kind: "group"; text: string }
  | { kind: "legend"; text: string }
  | { kind: "note"; note: WorktreeNote }
  | {
      kind: "commit";
      subject: string;
      sha: string;
      author: string;
      when: WorktreeWhen;
    }
  | ({ kind: "file" } & WorktreeFileProps)
  | {
      kind: "dir";
      key: string;
      label: string;
      depth: number;
      collapsed: boolean;
      onToggle(event: Event): void;
      children: WorktreeFileEntry[];
    };

export type WorktreeAddFormProps = {
  intro: string;
  name: { label: string; placeholder: string; onInput(value: string): void };
  branch: { label: string; placeholder: string; hint: string };
  /** 作る場所 (置き場所が分からないときは null で出さない)。 */
  target: {
    label: string;
    path: string;
    hint: string;
    hintLabel: string;
  } | null;
};

export type WorktreeRemoveFormProps = {
  /** 本文の段落 (順に)。hint は小さい字。 */
  paragraphs: { text: string; hint: boolean }[];
  /** ロックの説明と［ロックを外す］(段落のどこに置くかは afterParagraph)。 */
  unlock: {
    afterParagraph: number;
    unlocked: boolean;
    unlockedText: string;
    note: string;
    command: string;
    label: string;
    busy: boolean;
    result: string;
    onUnlock(): void;
  } | null;
  /** 変更が残っている作業ツリーの警告と、確かめのチェック。 */
  dirty: { note: string; lose: string; force: string } | null;
};

export type WorktreeShellProps = {
  path: string;
  key: string;
  status: string;
  additions: number;
  deletions: number;
  loading: string;
};

/** 作業ツリーの画面 (createWorktreeView) の描き方。 */
export type WorktreeViewView = {
  panel(props: WorktreePanelProps): unknown;
  files(entries: readonly WorktreeFileEntry[]): unknown;
  addForm(props: WorktreeAddFormProps): unknown;
  removeForm(props: WorktreeRemoveFormProps): unknown;
  /** 差分の欄 (#diff) に出すもの。どれも 1 つの要素。 */
  diff: {
    intro(props: {
      title: string;
      paragraphs: string[];
      button: { label: string; onClick(): void };
    }): unknown;
    info(text: string, alert?: boolean): unknown;
    empty(props: {
      title: string;
      body: string;
      openFolder: HTMLElement | null;
      copy: WorktreeCopyProps | null;
    }): unknown;
    shell(props: WorktreeShellProps): unknown;
    truncated(props: {
      text: string;
      open: { label: string; onClick(): void };
    }): unknown;
    /** diff2html が描く箱。 */
    host(): unknown;
    mediaUnavailable(text: string): unknown;
  };
};

const noteTemplate = (note: WorktreeNote) =>
  html`<div
    class="history-status"
    role=${note.error ? "alert" : nothing}
    style=${note.error ? "color: var(--danger)" : nothing}
  >${note.text}</div>`;

const whenTemplate = (when: WorktreeWhen) =>
  html`<span class="when" title=${when.title}>${when.text}</span>`;

function copyTemplate(props: WorktreeCopyProps): unknown {
  return html`<button
    type="button"
    class=${props.label ? "gdp-btn gdp-btn-sm gdp-copy-path" : "gdp-file-header-icon gdp-copy-path"}
    title=${props.title}
    aria-label=${props.title}
    @click=${(event: Event) => {
      event.stopPropagation();
      props.onCopy(event.currentTarget as HTMLButtonElement);
    }}
  >${props.label ?? iconTemplate(COPY_16_PATHS, "octicon-copy")}</button>`;
}

/** Repository のツリーと同じフォルダのアイコン。開閉で形が変わる。 */
const folderTemplate = (collapsed: boolean) =>
  iconTemplate(
    collapsed ? FOLDER_ICON_PATHS.closed : FOLDER_ICON_PATHS.open,
    collapsed
      ? "octicon-file-directory-fill"
      : "octicon-file-directory-open-fill",
  );

function rowTemplate(row: WorktreeRowProps): unknown {
  const cls = [
    "history-item",
    row.active ? "active" : "",
    row.current ? "worktree-current" : "",
    row.conflict ? "worktree-conflict" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return html`<li
    class=${cls}
    data-wt=${row.id}
    aria-current=${row.active ? "true" : nothing}
  ><span class="worktree-row-head"><span class="worktree-row-branch"
        >${row.heading}</span
      ><span class="subject" title=${row.path}>${row.name}</span>${
        row.badges.length
          ? html`<span class="worktree-row-badges">${row.badges.map(
              (badge, index) =>
                html`${index ? " · " : nothing}<span
                    class="worktree-badge"
                    title=${badge.title}
                    >${badge.label}</span
                  >`,
            )}</span>`
          : nothing
      }</span><span class="worktree-row-path" title=${row.path}>${row.path}</span><span
      class="meta2 worktree-row-meta"
    ><span class="sha" title=${row.branch.title ?? nothing}>${row.branch.text}</span><span
        class="author worktree-row-files"
      >${row.files}</span>${row.lastCommit ? whenTemplate(row.lastCommit) : nothing}${
        row.lastTouched ? whenTemplate(row.lastTouched) : nothing
      }</span><span class="meta2 worktree-row-divergence"><span
        class="author worktree-row-compare"
        title=${row.divergence}
      >${row.divergence}</span>${row.merge ? copyTemplate(row.merge) : nothing}</span><span
      class="worktree-row-agents"
      title=${row.agents?.title ?? nothing}
    >${
      row.agents
        ? html`<i
              class=${`terminal-mark terminal-mark-${row.agents.state}`}
              aria-hidden="true"
            ></i><span
              class=${`worktree-row-agent-state worktree-row-agent-${row.agents.state}`}
              >${row.agents.label}</span
            >${
              row.agents.more > 0
                ? html`<span class="worktree-row-agent-more"
                    >+${row.agents.more}</span
                  >`
                : nothing
            }`
        : nothing
    }</span><span class="worktree-row-actions">${
      row.open
        ? html`<button
            type="button"
            class="gdp-btn worktree-row-open"
            title=${row.open.title}
            ?disabled=${row.open.disabled}
            @click=${(event: Event) => {
              // 行のクリック (選択) と混ぜない。
              event.stopPropagation();
              row.open?.onClick();
            }}
          >${row.open.label}</button>`
        : nothing
    }${
      row.menu
        ? html`<button
            type="button"
            class="worktree-row-menu"
            title=${row.menu.title}
            aria-label=${row.menu.label}
            aria-haspopup="menu"
            @click=${(event: Event) => {
              // 行のクリック (選択) と混ぜない。メニューを開くだけ。
              event.stopPropagation();
              row.menu?.onOpen(event.currentTarget as HTMLElement);
            }}
          >${iconTemplate(KEBAB_16_PATH, "octicon-kebab-horizontal")}</button>`
        : nothing
    }</span>${
      row.error
        ? html`<span class="meta2"><span class="author" style="color: var(--danger)"
              >${row.error}</span
            ></span>`
        : nothing
    }</li>`;
}

function fileTemplate(file: WorktreeFileProps): unknown {
  return html`<li
    class=${`tree-file${file.active ? " active" : ""}${file.overlap ? " worktree-overlap" : ""}`}
    tabindex="-1"
    data-path=${file.path}
    data-key=${file.key}
    data-type="blob"
    style=${`--lvl-pad: ${treeLevelPad(file.depth)}`}
  ><span class="chev-spacer"></span><span
      class=${`badge ${file.status}`}
      title=${file.statusTitle}
    >${file.status}</span><span class="name" title=${file.nameTitle}>${file.label}</span>${
      file.overlap
        ? html`<span class="stat worktree-overlap-count" title=${file.overlap.title}
            >${file.overlap.count}</span
          >`
        : nothing
    }</li>`;
}

function fileEntryTemplate(entry: WorktreeFileEntry): unknown {
  switch (entry.kind) {
    case "group":
      return html`<li class="worktree-file-group">${entry.text}</li>`;
    case "legend":
      return html`<li class="worktree-overlap-legend">${entry.text}</li>`;
    case "note":
      return noteTemplate(entry.note);
    case "commit":
      return html`<li class="history-item worktree-commit"><span
          class="subject"
          title=${entry.subject}
        >${entry.subject}</span><span class="meta2"><span class="sha"
            >${entry.sha}</span
          ><span class="author">${entry.author}</span>${whenTemplate(entry.when)}</span></li>`;
    case "file":
      return fileTemplate(entry);
    case "dir":
      // 子は .tree-dir の**兄弟**として置く。CSS が
      // `#filelist.tree .tree-dir.collapsed + .tree-children` で畳むため、
      // 中に入れると折りたたみが効かず、行も横に並んでしまう。
      return html`<li
          class=${entry.collapsed ? "tree-dir collapsed" : "tree-dir"}
          tabindex="-1"
          data-type="tree"
          data-worktree-dir=${entry.key}
          style=${`--lvl-pad: ${treeLevelPad(entry.depth)}`}
        ><span class="chev" @click=${entry.onToggle}>${iconTemplate(
          CHEVRON_DOWN_16_PATH,
          "octicon-chevron-down",
        )}</span><span class="dir-icon" @click=${entry.onToggle}>${folderTemplate(
          entry.collapsed,
        )}</span><span class="name" title=${entry.label}>${entry.label}</span></li
        ><ul class="tree-children">${entry.children.map(fileEntryTemplate)}</ul>`;
  }
}

export const DEFAULT_VIEW: WorktreeViewView = {
  panel: (props) => html`<div class="history-head"><span class="history-title"
        >${props.title}</span
      >${props.count === null ? nothing : html`<span class="worktree-count">${props.count}</span>`}<button
        type="button"
        class="gdp-btn gdp-btn-sm worktree-head-btn"
        title=${props.refresh.title}
        @click=${props.refresh.onClick}
      >${props.refresh.label}</button><button
        type="button"
        class="gdp-btn gdp-btn-sm worktree-head-btn worktree-head-add"
        title=${props.add.title}
        @click=${props.add.onClick}
      >${props.add.label}</button></div><div class="history-filter-wrap"><input
        class="history-filter"
        type="search"
        autocomplete="off"
        placeholder=${props.filter.placeholder}
        .value=${live(props.filter.value)}
        @input=${(event: Event) =>
          props.filter.onInput((event.currentTarget as HTMLInputElement).value)}
      /></div>${props.notes.map(noteTemplate)}${
        props.overlaps
          ? html`<div class="history-banner" title=${props.overlaps.title}>${props.overlaps.text}</div>`
          : nothing
      }${
        props.body.kind === "note"
          ? noteTemplate(props.body.note)
          : html`<div class="worktree-columns" aria-hidden="true">${props.body.columns.map(
              (label) => html`<span>${label}</span>`,
            )}</div><ol
                class="history-list"
                aria-label=${props.body.label}
                @click=${(event: Event) => {
                  const row = (
                    event.target as HTMLElement | null
                  )?.closest<HTMLElement>(".history-item");
                  const id = row?.dataset.wt;
                  if (id && props.body.kind === "list") props.body.onSelect(id);
                }}
              >${repeat(
                props.body.rows,
                (row) => row.id,
                (row) => rowTemplate(row),
              )}</ol>${props.body.footer === null ? nothing : noteTemplate({ text: props.body.footer, error: false })}`
      }`,
  files: (entries) => entries.map(fileEntryTemplate),
  addForm: (props) => html`<div class="worktree-form"><p class="worktree-hint"
      >${props.intro}</p
    ><label class="worktree-field"><span>${props.name.label}</span><input
        class="gdp-dialog-input"
        type="text"
        placeholder=${props.name.placeholder}
        @input=${(event: Event) =>
          props.name.onInput((event.currentTarget as HTMLInputElement).value)}
      /></label><label class="worktree-field"><span>${props.branch.label}</span><input
        class="gdp-dialog-input"
        type="text"
        placeholder=${props.branch.placeholder}
      /><span class="worktree-hint">${props.branch.hint}</span></label>${
        props.target
          ? html`<div class="worktree-target"><span class="worktree-target-label"
              >${props.target.label}</span
            ><span class="worktree-target-path" title=${props.target.path}
              >${props.target.path}</span
            ><span
              class="worktree-hint-mark"
              title=${props.target.hint}
              tabindex="0"
              role="note"
              aria-label=${`${props.target.hintLabel}: ${props.target.hint}`}
            >?</span></div>`
          : nothing
      }</div>`,
  removeForm: (props) => {
    const unlock = props.unlock;
    const unlockBlock = unlock
      ? unlock.unlocked
        ? html`<div class="worktree-unlock"><p class="worktree-hint">${unlock.unlockedText}</p></div>`
        : html`<div class="worktree-warn worktree-unlock"><p>${unlock.note}</p><pre
              class="worktree-unlock-command terminal-mono"
            >${unlock.command}</pre><button
              type="button"
              class="gdp-btn gdp-btn-sm"
              ?disabled=${unlock.busy}
              @click=${unlock.onUnlock}
            >${unlock.label}</button><p class="worktree-unlock-result">${unlock.result}</p></div>`
      : nothing;
    return html`<div class="worktree-form">${props.paragraphs.map(
      (paragraph, index) =>
        html`<p class=${paragraph.hint ? "worktree-hint" : nothing}>${paragraph.text}</p>${
          unlock && unlock.afterParagraph === index ? unlockBlock : nothing
        }`,
    )}${
      props.dirty
        ? html`<p class="worktree-warn"><span>! ${props.dirty.note}</span><br /><span
                >${props.dirty.lose}</span
              ></p><label class="worktree-check"><input type="checkbox" /><span
                >${props.dirty.force}</span
              ></label>`
        : nothing
    }</div>`;
  },
  diff: {
    intro: (
      props,
    ) => html`<div class="worktree-intro"><p class="worktree-intro-title"
        >${props.title}</p
      >${props.paragraphs.map((text) => html`<p>${text}</p>`)}<button
        type="button"
        class="gdp-btn gdp-btn-sm"
        @click=${props.button.onClick}
      >${props.button.label}</button></div>`,
    info: (text, alert = false) =>
      html`<div class="gdp-info" role=${alert ? "alert" : nothing}>${text}</div>`,
    empty: (props) => html`<div class="gdp-info worktree-empty-diff"><p
        >${props.title}</p
      ><p>${props.body}</p>${
        props.copy
          ? html`<span class="worktree-empty-diff-actions">${props.openFolder ?? nothing}${copyTemplate(props.copy)}</span>`
          : nothing
      }</div>`,
    shell: (props) => html`<div
      class="gdp-file-shell"
      data-path=${props.path}
      data-key=${props.key}
      data-status=${props.status}
    ><div class="gdp-shell-header"><span class=${`status-pill ${props.status}`}
          >${props.status}</span
        ><span class="path">${props.path}</span><span class="stats"><span
            class="a"
            >+${props.additions}</span
          ><span class="d">−${props.deletions}</span></span></div
      ><div class="gdp-shell-body"><div class="gdp-info">${props.loading}</div></div
    ></div>`,
    truncated: (
      props,
    ) => html`<div class="gdp-info worktree-diff-truncated"><span
        >${props.text}</span
      ><button type="button" class="gdp-btn gdp-btn-sm" @click=${props.open.onClick}
        >${props.open.label}</button
      ></div>`,
    host: () => html`<div></div>`,
    mediaUnavailable: (text) =>
      html`<div class="media-empty" role="alert">${text}</div>`,
  },
};

export function createWorktreeView(
  deps: WorktreeViewDeps,
  view: WorktreeViewView = DEFAULT_VIEW,
): WorktreeView {
  let mounted = false;
  let viewGeneration = 0;
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
  let commitsFor = "";
  let commits: CommitMeta[] = [];
  let commitsHasMore = false;
  let commitsLoading = false;
  let commitsError = "";
  /**
   * 今 #diff に積んであるもの (作業ツリー + 表示設定)。積み直すかの判断に使う。
   * null は「まだ一度も積んでいない」で、"" (未選択) とは別物。表示設定を
   * 含めるのは、topbar のトグルを動かしたら積み直す必要があるため。
   */
  let diffFor: string | null = null;
  let restoredRouteKey: string | null = null;
  let observer: IntersectionObserver | null = null;
  let unsubscribeAgents: (() => void) | null = null;
  /** 畳んだフォルダ (行の鍵)。一覧を描き直すと全部開く (前と同じ)。 */
  let collapsedDirs = new Set<string>();

  const listPanel = document.getElementById("worktree-panel");
  // 一覧と変更ファイルの行 (Tab の止まり場所と行の上のキー。views/list-tab-stop.ts)。
  // 変更ファイルは Files の木と同じ #filelist に描くので、この画面の行 (鍵か
  // フォルダの印を持つ行) だけを見る。
  const WORKTREE_ROW_SELECTOR = ".history-list > li.history-item";
  const FILE_ROW_SELECTOR =
    "#filelist li.tree-file[data-key], #filelist li.tree-dir[data-worktree-dir]";
  /** 行の上のキーを受けるのをやめる (画面を離れるとき)。 */
  let detachRowKeys: Array<() => void> = [];

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

  /** 木の全部のフォルダを畳む / 開く (サイドバーの「全部畳む / 開く」)。 */
  function setAllDirsCollapsed(collapsed: boolean): void {
    const list = document.getElementById("filelist");
    if (!list) return;
    collapsedDirs = new Set(
      collapsed
        ? [...list.querySelectorAll<HTMLElement>(".tree-dir")].map(
            (dir) => dir.dataset.worktreeDir ?? "",
          )
        : [],
    );
    drawFiles();
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
    viewGeneration++;
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
    // 行のエージェントの状態を追う (一覧だけ描き直す。差分は積み直さない)。
    unsubscribeAgents = deps.subscribeAgents(() => {
      if (mounted) renderList();
    });
    // 一覧と変更ファイルの行の上のキー (views/list-tab-stop.ts)。↑↓・Home / End
    // は行から行へフォーカスを移すだけ (選ぶと画面が切り替わるので、選ぶのは
    // Enter = 1 回押したのと同じ)。
    const fileList = document.getElementById("filelist");
    detachRowKeys = [
      ...(listPanel
        ? [
            onListRowKeys(
              listPanel,
              WORKTREE_ROW_SELECTOR,
              rowFocusKeys(() => worktreeRows()),
            ),
          ]
        : []),
      ...(fileList
        ? [
            onListRowKeys(
              fileList,
              FILE_ROW_SELECTOR,
              rowFocusKeys(() => shownFileRows()),
            ),
          ]
        : []),
    ];
    deps.setPageMode();
    deps.syncHeaderMenu();
  }

  function suspend(): void {
    // 進行中の読み込みの結果を捨てる。画面を離れた後に書き換えない。
    lifecycle++;
    viewGeneration++;
    // 開いたままのメニューは body 直下に居るので、この画面を畳んでも残る。
    closeContextMenu();
    observer?.disconnect();
    observer = null;
    diffFor = null;
    commitsFor = "";
    commits = [];
    commitsHasMore = false;
    commitsLoading = false;
    commitsError = "";
    restoredRouteKey = null;
    if (sseTimer !== null) {
      window.clearTimeout(sseTimer);
      sseTimer = null;
    }
    refreshRequested = false;
    if (listPanel) {
      listPanel.hidden = true;
      renderOwned(listPanel, nothing);
    }
    sidebarFilter()?.removeEventListener("input", onSidebarFilter);
    document
      .getElementById("filelist")
      ?.removeEventListener("click", onFileListClick);
    for (const detach of detachRowKeys) detach();
    detachRowKeys = [];
    for (const button of sidebarViewButtons()) {
      button.removeEventListener("click", onSidebarViewToggle);
    }
    document
      .getElementById("sb-expand-all")
      ?.removeEventListener("click", onExpandAll);
    document
      .getElementById("sb-collapse-all")
      ?.removeEventListener("click", onCollapseAll);
    const fileList = document.getElementById("filelist");
    if (fileList) renderOwned(fileList, nothing);
    collapsedDirs = new Set();
    document.getElementById("diff")?.replaceChildren();
    document.body.classList.remove("gdp-worktree-page");
    document.body.removeAttribute("data-worktree-overview");
    unsubscribeAgents?.();
    unsubscribeAgents = null;
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
        fetch(apiUrl("worktreeList")).then(async (res) => {
          if (!res.ok)
            throw new Error(
              await responseErrorMessage(res, "loading the worktree list"),
            );
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
      setMessage(failureMessage(text().loadFailed, error), true);
      deps.setStatus("error");
    } finally {
      if (isCurrent(seq)) {
        // 一覧が変われば中身も変わる。積み直す。
        diffFor = null;
        commitsFor = "";
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
    const viewGen = viewGeneration;
    const loop = (async () => {
      while (
        refreshRequested &&
        mounted &&
        route() &&
        viewGen === viewGeneration
      ) {
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

  async function switchToWorktree(item: WorktreeItem): Promise<void> {
    const seq = lifecycle;
    const viewGen = viewGeneration;
    busyPath = item.path;
    setMessage(text().opening);
    renderList();
    try {
      const result = await deps.trackLoad(
        postWorktreeAction(apiUrl("worktreeOpen"), { path: item.path }),
      );
      if (!result.url) throw new Error(text().openFailed);
      const url = projectDestination(result.url, "/");
      // 移るまで「開いています」を出したままにする (押し直しで 2 度起こさない)。
      window.location.assign(url);
    } catch (error) {
      busyPath = "";
      if (isCurrent(seq)) {
        const detail = failureMessage(text().openFailed, error);
        await refresh();
        if (mounted && viewGeneration === viewGen && route()) {
          const refreshDetail = message;
          setMessage(
            refreshDetail && refreshDetail !== detail
              ? `${detail}\n${refreshDetail}`
              : detail,
            true,
          );
          renderList();
        }
      }
    }
  }

  /**
   * 別タブは先に開いておく。URL が返ってくるまで待ってから window.open すると、
   * ユーザー操作から離れた呼び出しとしてポップアップブロックに掛かる。
   */
  function openBlankTab(): Window | null {
    // "noopener" を features に渡すと、仕様上 window.open は null を返す。
    // タブだけが about:blank のまま開き、URL を入れる先が無くなるので
    // 渡さない。参照は受け取ったうえで opener を切る。
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    return tab;
  }

  async function openWorktree(item: WorktreeItem): Promise<void> {
    if (busyPath) return;
    // 入口のサーバの下では、作業ツリーも 1 つのプロジェクトとして同じタブで
    // 移る (同じオリジンのまま。別のポートのタブを増やさない)。
    if (projectKey()) {
      await switchToWorktree(item);
      return;
    }
    const seq = lifecycle;
    const viewGen = viewGeneration;
    busyPath = item.path;
    setMessage(text().opening);
    renderList();
    let tab: Window | null = null;
    let completion: { detail: string; error: boolean } | null = null;
    try {
      tab = openBlankTab();
      const result = await deps.trackLoad(
        postWorktreeAction(apiUrl("worktreeOpen"), { path: item.path }),
      );
      if (!result.url) throw new Error(text().openFailed);
      const url = projectDestination(result.url, "/");
      if (tab) tab.location.href = url;
      // ブロックされてタブを開けなかったときは、URL を残して自分で開けるように
      // する (黙って何も起きないのが一番困る)。
      if (!tab) completion = { detail: url, error: true };
    } catch (error) {
      tab?.close();
      console.error("[code-viewer] opening the worktree failed", error);
      completion = {
        detail: `${text().openFailed}\n${formatErrorDetail(error)}`,
        error: true,
      };
    } finally {
      busyPath = "";
      if (isCurrent(seq)) {
        await refresh();
        if (completion && mounted && viewGeneration === viewGen && route()) {
          const refreshDetail = message;
          setMessage(
            refreshDetail && refreshDetail !== completion.detail
              ? `${completion.detail}\n${refreshDetail}`
              : completion.detail,
            completion.error || messageIsError,
          );
          renderList();
        }
      }
    }
  }

  async function addWorktree(): Promise<void> {
    const seq = lifecycle;
    const t = text();
    // 押す前に「どこに何ができるか」を実パスで見せる。置き場所はサーバ側で
    // <repoRoot>/.worktrees に固定なので、ここに出る値が確定した結果になる。
    // 取れていないときは行ごと出さない (嘘のパスを見せない)。
    // 追加先はリポジトリの中なので、放っておくと git status に未追跡として
    // 出続ける。.gitignore を書き換えるのはリポジトリ側の判断なので伝える
    // だけにするが、作るかどうかの判断には要らないので本文に並べない。
    const parent = data?.addParent || "";
    let typedName = "";
    const form = detachedElement(() =>
      view.addForm({
        // 何のための操作かを先に 1 行。未経験者はここで初めて意味を知る。
        intro: t.addDialog.intro,
        name: {
          label: t.addDialog.nameLabel,
          placeholder: t.addDialog.namePlaceholder,
          onInput: (value) => {
            typedName = value.trim();
            form.draw();
          },
        },
        branch: {
          label: t.addDialog.branchLabel,
          placeholder: t.addDialog.branchPlaceholder,
          hint: t.addDialog.branchHint,
        },
        target: parent
          ? {
              label: t.addDialog.targetLabel,
              path: typedName
                ? `${parent}/${typedName}`
                : t.addDialog.targetPending(parent),
              hint: t.gitignoreHint,
              hintLabel: t.addDialog.gitignoreLabel,
            }
          : null,
      }),
    );
    const body = form.element;
    const [nameInput, branchInput] = body.querySelectorAll("input");
    if (!nameInput || !branchInput)
      throw new Error("worktree add dialog: the inputs were not drawn");
    const name = { input: nameInput };
    const branch = { input: branchInput };

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
        postWorktreeAction(apiUrl("worktreeAdd"), submitted),
      );
      if (isCurrent(seq)) setMessage("");
      createdPath = result.path || "";
    } catch (error) {
      if (isCurrent(seq)) {
        setMessage(failureMessage(t.addFailed, error), true);
      }
    }
    // 作ったものをそのまま選ぶ。refresh が世代を進めるので先に選び、
    // 来た一覧がそれを選択状態で描く。
    if (isCurrent(seq) && createdPath) {
      navigate({ wt: createdPath });
    }
    if (isCurrent(seq)) await refresh();
  }

  /**
   * 消す画面の本文。ロックされていれば理由と実行するコマンド、［ロックを外す］を
   * 出す。外したらその欄を「外しました」に替え、そのまま消せる。失敗は git の
   * 出力を全部出す。
   */
  async function removeWorktree(item: WorktreeItem): Promise<void> {
    if (busyPath) return;
    const seq = lifecycle;
    const t = text();
    const paragraphs: { text: string; hint: boolean }[] = [];
    // フォルダが無い行は「消えます」とは言えない。管理情報の掃除であることを
    // 伝える別文面にする (サーバ側も remove ではなく prune に切り替わる)。
    // ロックされた作業ツリーは git worktree remove が断り、ロックされた登録は
    // prune が黙って飛ばす (サーバが 409 で返す)。押す前に理由と、その場で外す
    // 操作を、本文の 2 段目の後ろに出す。
    if (item.missing) {
      paragraphs.push(
        { text: t.removeDialog.missingBody(item.name), hint: false },
        { text: t.removeDialog.missingNote, hint: true },
      );
      // prune は対象を 1 本に絞れないので、同じ状態の登録が他にあれば
      // まとめて消えることを先に伝える。飛ばされるロック済みは数に入れない。
      const otherMissing = (data?.worktrees || []).filter(
        (candidate) =>
          candidate.missing && !candidate.locked && candidate.id !== item.id,
      ).length;
      if (otherMissing > 0)
        paragraphs.push({
          text: t.removeDialog.missingOthers(otherMissing),
          hint: true,
        });
    } else {
      paragraphs.push(
        { text: t.removeDialog.body(item.name), hint: false },
        { text: t.removeDialog.diskNote(item.path), hint: false },
      );
    }
    if (item.branch)
      paragraphs.push({
        text: t.removeDialog.branchNote(item.branch),
        hint: true,
      });
    const quoted = /[^\w./-]/.test(item.path)
      ? `'${item.path.split("'").join("'\\''")}'`
      : item.path;
    const unlock = { busy: false, unlocked: false, result: "" };
    // 警告は最初から見せる。チェックを入れたときに出現する形だと、読む前に
    // 押せてしまう。
    const dirty = !item.missing && item.changedCount > 0;
    const form = detachedElement(() =>
      view.removeForm({
        paragraphs,
        unlock: item.locked
          ? {
              afterParagraph: 1,
              unlocked: unlock.unlocked,
              unlockedText: t.removeDialog.unlocked,
              note: t.removeDialog.lockedNote,
              command: `git worktree unlock ${quoted}`,
              label: t.removeDialog.unlock,
              busy: unlock.busy,
              result: unlock.result,
              onUnlock: () => {
                unlock.busy = true;
                unlock.result = "";
                form.draw();
                void deps
                  .trackLoad(
                    postWorktreeAction(apiUrl("worktreeUnlock"), {
                      path: item.path,
                    }),
                  )
                  .then(() => {
                    unlock.unlocked = true;
                  })
                  .catch((error: unknown) => {
                    unlock.result = failureMessage(
                      t.removeDialog.unlockFailed,
                      error,
                    );
                  })
                  .finally(() => {
                    unlock.busy = false;
                    form.draw();
                  });
              },
            }
          : null,
        dirty: dirty
          ? {
              note: t.removeDialog.dirtyNote(item.changedCount),
              lose: t.removeDialog.dirtyLose,
              force: t.removeDialog.force,
            }
          : null,
      }),
    );
    const body = form.element;
    const force = dirty
      ? body.querySelector<HTMLInputElement>(".worktree-check input")
      : null;
    if (dirty && !force)
      throw new Error("worktree remove dialog: the confirmation was not drawn");

    const submitted = await showFormDialog<{ force: boolean }>({
      title: t.removeDialog.title,
      body,
      submitLabel: t.removeDialog.submit,
      cancelLabel: t.cancel,
      // フォルダごと消える不可逆の操作なので、確定は常に危険色。
      danger: true,
      // ［ロックを外す］は押すとすぐ git を書き換える。開いた直後の Enter で
      // 押されないよう、焦点は確認のチェックか［キャンセル］に置く。
      focusTarget: force,
      focusCancel: true,
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
        postWorktreeAction(apiUrl("worktreeRemove"), {
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
        setMessage(failureMessage(t.removeFailed, error), true);
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

  /**
   * 「フォルダを開く」。中身は app.ts の共有ファクトリがそのまま作る
   * (Repository / Diff / サイドバー / ソースと同じもの)。
   *
   * 案内カードでは文字つきにしたいので、同じボタンにラベルを足して枠だけ
   * 差し替える。**ここでボタンを作り直さない。** アイコン・失敗時の扱いが
   * app.ts 側だけ直されて、この画面が取り残される。
   */
  function openFolderButton(
    item: WorktreeItem,
    withLabel: boolean,
  ): HTMLButtonElement | null {
    // 渡すのはリポジトリからの相対パス (openPathArg の説明を読むこと)。
    // 開けない作業ツリーではボタンごと出さない。
    const arg = openPathArg(item);
    if (arg === null) return null;
    const t = text();
    const button = deps.createOpenPathButton(
      arg,
      "directory",
      t.actions.openFolderTitle,
    );
    if (withLabel) {
      button.className = "gdp-btn gdp-btn-sm gdp-open-path";
      button.textContent = t.actions.openFolder;
    }
    return button;
  }

  /**
   * 文字列 1 つをクリップボードへ写すボタン。押した後に変わるのは色だけで、
   * 箱の寸法は変えない (ui-surface「箱の寸法を状態で変えない」)。
   * label を渡すと文字つき、渡さなければアイコンだけになる。
   */
  /**
   * 文字列 1 つをクリップボードへ写すボタン。押した後に変わるのは色だけで、
   * 箱の寸法は変えない (ui-surface「箱の寸法を状態で変えない」)。
   * label を渡すと文字つき、渡さなければアイコンだけになる。
   */
  function copyProps(
    value: string,
    title: string,
    label?: string,
  ): WorktreeCopyProps {
    return {
      title,
      label: label ?? null,
      onCopy: (button) => {
        // 押したボタンへの一瞬の印 (状態の置き場ではない)。
        button.classList.remove("copied", "failed");
        void copyText(value).then((ok) => {
          button.classList.add(ok ? "copied" : "failed");
          window.setTimeout(
            () => button.classList.remove("copied", "failed"),
            1200,
          );
        });
      },
    };
  }

  /**
   * メニューから走らせる 1 回きりの操作。**失敗を黙って終わらせない。**
   * メニューの項目は押した瞬間に消えるので、色や disabled で結果を示せない。
   * 失敗したらこの画面のメッセージ欄に理由を出す。
   */
  async function runAction(
    run: () => Promise<boolean>,
    failure: string,
  ): Promise<void> {
    const seq = lifecycle;
    if (await run()) return;
    if (!isCurrent(seq)) return;
    setMessage(failure, true);
    renderList();
  }

  /** 失敗を投げる操作。理由はコンソールと、この画面のメッセージ欄に出す。 */
  async function runThrowingAction(
    run: () => Promise<void>,
    failure: string,
  ): Promise<void> {
    const seq = lifecycle;
    try {
      await run();
    } catch (error) {
      const message = failureMessage(failure, error);
      if (!isCurrent(seq)) return;
      setMessage(message, true);
      renderList();
    }
  }

  /**
   * クリップボードへ写す。**失敗を握り潰さない。** 呼び出し側が見た目を
   * 変えられるように成否を返し、理由はコンソールに残す (権限拒否など、
   * 画面の色だけでは何も分からないため)。
   */
  async function copyText(value: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (error) {
      console.error("[code-viewer] failed to copy to clipboard", error);
      return false;
    }
  }

  /** 「パスをコピー」。cd して作業を始めるためのもの。 */
  function copyPathProps(
    item: WorktreeItem,
    withLabel: boolean,
  ): WorktreeCopyProps {
    const t = text();
    return copyProps(
      item.path,
      t.actions.copyPathTitle,
      withLabel ? t.actions.copyPath : undefined,
    );
  }

  /**
   * 取り込むコマンド。**このアプリは実行しない。** 見るためのものなので、
   * リポジトリを書き換える操作は持たない。そのまま入る作業ツリーにだけ出す
   * (衝突する行に出しても押す意味が無い)。
   */
  function mergeCommand(
    item: WorktreeItem,
  ): { base: string; branch: string; command: string } | null {
    const divergence = item.divergence;
    if (divergence?.mergeState !== "clean") return null;
    if (!item.branch || !divergence.base) return null;
    return {
      base: divergence.base,
      branch: item.branch,
      command: `git switch ${divergence.base} && git merge ${item.branch}`,
    };
  }

  function copyMergeProps(item: WorktreeItem): WorktreeCopyProps | null {
    const merge = mergeCommand(item);
    if (!merge) return null;
    const t = text();
    return copyProps(
      merge.command,
      t.actions.copyMergeTitle(merge.base, merge.branch),
    );
  }

  /** 「開く」で起こしたサーバを止める。起動中の行にだけ出す。 */
  async function stopWorktreeServer(item: WorktreeItem): Promise<void> {
    if (busyPath) return;
    const seq = lifecycle;
    busyPath = item.path;
    renderList();
    try {
      await deps.trackLoad(
        postWorktreeAction(apiUrl("worktreeStop"), { path: item.path }),
      );
      if (isCurrent(seq)) setMessage("");
    } catch (error) {
      if (isCurrent(seq)) {
        setMessage(failureMessage(text().actions.stopFailed, error), true);
      }
    } finally {
      busyPath = "";
      if (isCurrent(seq)) await refresh();
    }
  }

  /**
   * `apiUrl("openPath")` (OS で開く要求) に渡す引数。
   *
   * **あのエンドポイントが取るのはリポジトリからの相対パスで、絶対パスは
   * 受け付けない** (`isSafePath` が `/` 始まりを弾き、先頭の `/` を削った
   * 結果を `<repoRoot>/…` として解決するため、絶対パスを渡すと必ず 404)。
   * 実パスをそのまま渡していて、ずっと開けていなかった。
   *
   * リポジトリの外に在る作業ツリー (displayPath が絶対パスのまま) は、この
   * 口では開けない。null を返し、メニューにも出さない。
   */
  function openPathArg(item: WorktreeItem): string | null {
    const shown = item.displayPath;
    if (shown === ".") return ""; // 本体はリポジトリのルート
    if (!shown || shown.startsWith("/") || shown.startsWith("\\")) return null;
    return shown;
  }

  /**
   * 行ごとの操作メニュー。**行の中にボタンを並べない。**
   *
   * 選んだ行の中に並べたら、選んだ瞬間にクリックした場所へボタンが現れて
   * 誤爆が怖いと言われ、一覧の上に固定したら今度は削除が画面の一番目立つ
   * ところに居座った。開くまで何も出さないメニューなら、どちらも起きない。
   *
   * 選択とは独立しているので、行を選ばずにその行の操作ができる。
   */
  function rowMenuItems(item: WorktreeItem): ContextMenuItem[] {
    const t = text();
    const items: ContextMenuItem[] = [];
    if (!item.missing && !item.bare) {
      const openArg = openPathArg(item);
      // リポジトリの外に在る作業ツリーは /_open_path では開けない。押せば
      // 必ず失敗するので、項目そのものを出さない (パスのコピーは出す)。
      if (openArg !== null) {
        items.push({
          label: t.actions.openFolder,
          title: t.actions.openFolderTitle,
          onSelect: () => {
            // メニューにはボタンが無いので、色を変えて伝えることができない。
            // 失敗はこの画面のメッセージ欄に出す (黙って終わるのが一番困る)。
            void runThrowingAction(
              () => deps.openPathInOs(openArg, "directory"),
              t.actions.openFolderFailed,
            );
          },
        });
      }
      items.push({
        label: t.actions.copyPath,
        title: t.actions.copyPathTitle,
        onSelect: () => {
          void runAction(() => copyText(item.path), t.actions.copyFailed);
        },
      });
      items.push({
        label: t.open,
        title: t.openTitle,
        disabled: !!busyPath,
        onSelect: () => {
          void openWorktree(item);
        },
      });
    }
    // 開いたタブが拡張などに阻まれることがある (ERR_BLOCKED_BY_CLIENT)。
    // その場合アプリ側からは何も分からないので、アドレスだけは必ず取り出せる
    // ようにしておく。別のブラウザやターミナルから開ける。
    if (item.serverUrl) {
      items.push({
        label: t.actions.copyServerUrl,
        title: t.actions.copyServerUrlTitle(item.serverUrl),
        onSelect: () => {
          // 入口の下では `/p/<鍵>/` の形で返るので、開ける URL にして写す。
          const address = projectDestination(item.serverUrl, "/");
          void runAction(() => copyText(address), t.actions.copyFailed);
        },
      });
    }
    // 起こしたサーバは親より長く生きる。止める口をここに置かないと、
    // 開いた本人にも止め方が無い。自分自身は止めさせない (サーバも 409)。
    if (item.serverUrl && !item.current) {
      items.push({
        label: t.actions.stopServer,
        title: t.actions.stopServerTitle,
        disabled: !!busyPath,
        onSelect: () => {
          void stopWorktreeServer(item);
        },
      });
    }
    const merge = mergeCommand(item);
    if (merge) {
      items.push({
        label: t.actions.copyMerge,
        title: t.actions.copyMergeTitle(merge.base, merge.branch),
        onSelect: () => {
          void runAction(() => copyText(merge.command), t.actions.copyFailed);
        },
      });
    }
    // 自分が映している作業ツリーは外させない。サーバも 409 で拒否する。
    if (!item.current) {
      if (items.length) items.push({ kind: "separator" });
      items.push({
        label: t.remove,
        title: t.removeTitle,
        danger: true,
        disabled: !!busyPath,
        onSelect: () => {
          void removeWorktree(item);
        },
      });
    }
    return items;
  }

  /**
   * その作業ツリーで動いているエージェント (cwd が中にあるもの)。作業ツリーが
   * 入れ子のときは、いちばん深い作業ツリーに数える。急ぐものを先に。
   */
  function agentsIn(item: WorktreeItem): WorktreeAgent[] {
    const worktrees = data?.worktrees ?? [];
    const inside = (path: string, root: string) =>
      path === root || path.startsWith(`${root.replace(/\/+$/, "")}/`);
    const rank = { waiting: 0, done: 1, working: 2, idle: 3 } as const;
    return deps
      .getAgents()
      .filter((agent) => {
        const owner = worktrees
          .filter((worktree) => inside(agent.path, worktree.path))
          .sort((a, b) => b.path.length - a.path.length)[0];
        return owner?.id === item.id;
      })
      .sort((a, b) => rank[a.state] - rank[b.state]);
  }

  /** 行のエージェントの欄: いちばん急ぐものの印と状態、ほかは数だけ。 */
  function agentsProps(item: WorktreeItem): WorktreeRowProps["agents"] {
    const agents = agentsIn(item);
    const first = agents[0];
    if (!first) return null;
    return {
      state: first.state,
      label: first.stateLabel,
      more: agents.length - 1,
      title: agents
        .map((agent) => `${agent.kind} · ${agent.stateLabel}`)
        .join("\n"),
    };
  }

  function whenOf(iso: string, format: (relative: string) => string) {
    const parsed = Date.parse(iso);
    return Number.isFinite(parsed)
      ? {
          text: format(
            relativeTimeText(Math.round(parsed / 1000), pageLanguage()),
          ),
          absolute: new Date(parsed).toLocaleString(pageLanguage()),
        }
      : { text: format(iso), absolute: null };
  }

  function rowProps(
    item: WorktreeItem,
    selected: string | undefined,
  ): WorktreeRowProps {
    const t = text();
    const commit = item.lastCommit;
    const committed = commit ? whenOf(commit.when, (value) => value) : null;
    // 最終更新は mtime ベース。コミットせずに置かれた作業ツリーでも動く。
    const touched = item.lastTouched
      ? whenOf(item.lastTouched, (value) => t.lastTouched(value))
      : null;
    const menuItems = rowMenuItems(item);
    return {
      id: item.id,
      active: item.id === selected,
      current: item.current,
      conflict: item.divergence?.mergeState === "conflict",
      // 1 段目: 見出しはブランチ (フォルダは 2 段目のパスで読める) + 名前 + 状態
      // バッジ (右寄せ)。
      heading: item.branch || t.badges.detached,
      name: item.name,
      // 2 段目: フォルダの場所。**displayPath (リポジトリからの相対) ではなく
      // 実パスを出す。** 相対だと本体の行が "." だけになる。全体は title に。
      path: item.path,
      badges: worktreeBadges(item),
      // 3 段目: ブランチ・変更数・最終コミット。ブランチが無い作業ツリーは
      // その旨を出し、理由を title に添える。
      branch: {
        text: item.branch || t.badges.detached,
        title: item.branch ? null : t.badges.detachedTitle,
      },
      files: item.fileCount ? t.files.heading(item.fileCount) : t.files.none,
      // ホバーでは件名と絶対日時の両方を出す。
      lastCommit:
        commit && committed
          ? {
              text: committed.text,
              title: committed.absolute
                ? `${commit.subject}\n${committed.absolute}`
                : commit.subject,
            }
          : null,
      lastTouched:
        touched && item.lastTouched
          ? { text: touched.text, title: touched.absolute ?? item.lastTouched }
          : null,
      // 4 段目: マージできるか + 位置関係。フル文は title に。そのまま入る行に
      // だけ、取り込むコマンドのコピー (アイコンだけ) を添える。
      divergence: divergenceSummary(item),
      merge: copyMergeProps(item),
      agents: agentsProps(item),
      // 操作: 「開く」と「…」。「…」は行を選ばなくても、その行に対して実行できる。
      // 「開く」は一覧だけのとき (何も選んでいない) にだけ置く。選んだ後の
      // 狭い一覧では今までどおり「…」だけ (選んだ瞬間にボタンが増えると誤爆する)。
      open:
        !selected && !item.missing && !item.bare
          ? {
              label: t.openShort,
              title: t.openTitle,
              disabled: !!busyPath,
              onClick: () => void openWorktree(item),
            }
          : null,
      // 行の右端の「…」。押すまで操作は 1 つも見えない。
      menu: menuItems.length
        ? {
            title: t.actions.menuTitle,
            label: t.actions.menuFor(item.name),
            onOpen: (anchor) => showContextMenu(anchor, rowMenuItems(item)),
          }
        : null,
      error: item.error || null,
    };
  }

  function panelProps(): WorktreePanelProps {
    const t = text();
    const notes: WorktreeNote[] = [];
    // 基準ブランチ名は各行の 4 段目に載るので、見つからなかったときだけ
    // 理由をここに出す。
    if (data && !data.baseBranch)
      notes.push({ text: t.baseUnknown, error: false });
    if (message) notes.push({ text: message, error: messageIsError });
    const overlaps = data?.overlaps || [];
    const head = {
      title: t.panes.worktrees,
      count: data?.worktrees.length
        ? t.panes.count(data.worktrees.length)
        : null,
      refresh: {
        label: t.refresh,
        title: t.refreshTitle,
        onClick: () => void refresh(),
      },
      // 作業ツリーを足すのはこの画面の主の操作 (ボタンの種類の主)。
      add: {
        label: t.add,
        title: t.addTitle,
        onClick: () => void addWorktree(),
      },
      filter: {
        value: worktreeFilter,
        placeholder: t.panes.filterWorktrees,
        onInput: (value: string) => {
          worktreeFilter = value;
          renderList();
        },
      },
      notes,
      overlaps: overlaps.length
        ? {
            text: `${t.overlaps.heading(overlaps.length)} — ${t.overlaps.intro}`,
            title: overlaps
              .map((overlap) =>
                t.overlaps.entry(
                  overlap.path,
                  overlap.worktreeIds.map((id) => worktreeLabel(id)),
                ),
              )
              .join("\n"),
          }
        : null,
    };
    const note = (text: string): WorktreePanelProps["body"] => ({
      kind: "note",
      note: { text, error: false },
    });
    if (!data) return { ...head, body: note(t.loading) };
    if (!data.worktrees.length) return { ...head, body: note(t.empty) };
    const items = data.worktrees.filter(
      (item) =>
        matches(item.name, worktreeFilter) ||
        matches(item.branch, worktreeFilter) ||
        matches(item.displayPath, worktreeFilter),
    );
    if (!items.length) return { ...head, body: note(t.panes.noWorktreeMatch) };
    const selected = route()?.wt;
    return {
      ...head,
      body: {
        kind: "list",
        columns: [
          t.columns.branch,
          t.columns.compared(data.baseBranch || ""),
          t.columns.changes,
          t.columns.agents,
          "",
        ],
        // 行の中にボタン (取り込みのコピー・「…」・「開く」) があるので listbox に
        // せず、並び (ol) のまま名前を付け、選んでいる行は aria-current で伝える。
        label: t.panes.worktrees,
        rows: items.map((item) => rowProps(item, selected)),
        // 別の作業ツリーへ移ったらファイル選択は持ち越さない。
        onSelect: (id) =>
          navigate({ wt: id, file: undefined, origin: undefined }),
        // メインの 1 本しか無いときは、この一覧に何が並ぶかを 1 行で伝える。
        footer: data.worktrees.length === 1 ? t.intro.listNote : null,
      },
    };
  }

  function renderList(): void {
    if (!listPanel) return;
    // 描き直す前に、行にあったフォーカスを控える (行が入れ替わったときに戻す)。
    // 頭の部品 (再読み込み・作成・絞り込み欄) は描き直しても同じ要素のまま。
    const focused = focusedListRow(
      listPanel,
      WORKTREE_ROW_SELECTOR,
      worktreeKey,
    );
    const props = panelProps();
    // 選んでいないときは一覧だけを画面いっぱいに出す (行は列にそろえる)。
    // 選ぶと今までどおり 一覧 → 変更ファイル → 差分。
    if (props.body.kind === "list")
      document.body.toggleAttribute("data-worktree-overview", !route()?.wt);
    renderOwned(listPanel, view.panel(props));
    const list = listPanel.querySelector<HTMLElement>(".history-list");
    if (!list) return;
    syncListTabStop(list, {
      rows: worktreeRows(),
      keyOf: worktreeKey,
      isActive: (row) => row.classList.contains("active"),
      actionSelector: "button, a[href]",
      focused,
      fallback: listPanel,
      memo: listPanel,
    });
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

  /**
   * パスを 1 段ずつ畳んだ木。並び (order) はファイルの並びで最初に出てきた順:
   * フォルダを先に寄せると、一覧を上から読む順と差分のカードの順が食い違った。
   */
  type FileTree = {
    dirs: Map<string, FileTree>;
    files: WorktreeFileChange[];
    order: Array<{ dir: string } | { file: WorktreeFileChange }>;
  };

  function emptyTree(): FileTree {
    return { dirs: new Map(), files: [], order: [] };
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
          node.order.push({ dir: name });
        }
        node = child;
      }
      node.files.push(file);
      node.order.push({ file });
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

  function fileProps(
    item: WorktreeItem,
    file: WorktreeFileChange,
    depth: number,
    label: string,
  ): WorktreeFileEntry {
    const t = text();
    const currentRoute = route();
    // 重なりは行末に「何本と重なっているか」の数で出す。色を変えると、
    // 重なりが多いリポジトリでは一覧がまるごと染まって読めなくなる。
    // .badge は M / A / D の 1 文字用の枠なので語も入れられない。
    const others = overlapOthers(item, file);
    return {
      kind: "file",
      path: file.path,
      key: fileKey(file),
      status: file.status,
      statusTitle: t.files.statusTitles[file.status] || file.status,
      label,
      depth,
      active:
        currentRoute?.file === file.path && currentRoute.origin === file.origin,
      nameTitle: others.length
        ? `${file.path}\n${t.files.overlapTitle(others)}`
        : file.path,
      overlap: others.length
        ? { count: others.length, title: t.files.overlapTitle(others) }
        : null,
    };
  }

  function treeEntries(
    item: WorktreeItem,
    node: FileTree,
    depth: number,
    path: string,
  ): WorktreeFileEntry[] {
    return node.order.map((entry): WorktreeFileEntry => {
      if ("file" in entry) {
        const parts = entry.file.path.split("/");
        return fileProps(
          item,
          entry.file,
          depth,
          parts[parts.length - 1] || entry.file.path,
        );
      }
      const rawChild = node.dirs.get(entry.dir);
      if (!rawChild) throw new Error(`worktree tree: ${entry.dir} has no node`);
      const [label, child] = collapseChain(entry.dir, rawChild);
      // 行の鍵 (描き直しをまたいでフォーカスを戻す)。区切り (未コミット /
      // コミット済み) ごとに同じフォルダが出るので、区切りから始める。
      const key = `${path}/${label}`;
      return {
        kind: "dir",
        key,
        label,
        depth,
        collapsed: collapsedDirs.has(key),
        onToggle: (event) => {
          event.stopPropagation();
          if (collapsedDirs.has(key)) collapsedDirs.delete(key);
          else collapsedDirs.add(key);
          // 畳んだ中に止まり場所があれば、見えている行へ移す。
          drawFiles();
        },
        children: treeEntries(item, child, depth + 1, key),
      };
    });
  }

  async function loadCommits(
    item: WorktreeItem,
    key: string,
    seq: number,
  ): Promise<void> {
    try {
      const next = await deps.trackLoad(
        fetch(
          `${apiUrl("worktreeCommits")}?${new URLSearchParams({ path: item.path }).toString()}`,
        ).then(async (res) => {
          if (!res.ok)
            throw new Error(
              await responseErrorMessage(res, "loading the worktree commits"),
            );
          return (await res.json()) as WorktreeCommitsResponse;
        }),
      );
      if (
        !isCurrent(seq) ||
        selectedWorktree()?.id !== item.id ||
        commitsFor !== key
      ) {
        return;
      }
      if (
        !Number.isInteger(next.generation) ||
        next.generation < acceptedServerGeneration
      ) {
        throw new Error(
          `stale worktree commit response generation ${next.generation}; current is ${acceptedServerGeneration}`,
        );
      }
      commits = next.commits;
      commitsHasMore = next.hasMore;
    } catch (error) {
      if (
        !isCurrent(seq) ||
        selectedWorktree()?.id !== item.id ||
        commitsFor !== key
      ) {
        return;
      }
      commitsError = failureMessage(text().commits.loadFailed, error);
    } finally {
      if (
        isCurrent(seq) &&
        selectedWorktree()?.id === item.id &&
        commitsFor === key
      ) {
        commitsLoading = false;
        renderFiles();
      }
    }
  }

  function commitEntries(item: WorktreeItem): WorktreeFileEntry[] {
    const divergence = item.divergence;
    if (!divergence || divergence.ahead < 1) return [];
    const key = `${item.id}|${item.branch}|${divergence.base}|${acceptedServerGeneration}`;
    if (commitsFor !== key) {
      commitsFor = key;
      commits = [];
      commitsHasMore = false;
      commitsLoading = true;
      commitsError = "";
      void loadCommits(item, key, lifecycle);
    }
    const t = text();
    const heading: WorktreeFileEntry = {
      kind: "group",
      text: t.commits.heading(divergence.base),
    };
    const note = (text: string, error = false): WorktreeFileEntry => ({
      kind: "note",
      note: { text, error },
    });
    if (commitsLoading) return [heading, note(t.commits.loading)];
    if (commitsError) return [heading, note(commitsError, true)];
    if (!commits.length) return [heading, note(t.commits.none)];
    return [
      heading,
      ...commits.map((commit): WorktreeFileEntry => {
        const when = whenOf(commit.when, (value) => value);
        return {
          kind: "commit",
          subject: commit.subject,
          sha: commit.sha.slice(0, 7),
          author: commit.author,
          when: { text: when.text, title: when.absolute ?? commit.when },
        };
      }),
      ...(commitsHasMore
        ? [note(t.commits.truncated(commits.length, divergence.ahead))]
        : []),
    ];
  }

  /** 一覧が変わった (選び直し・絞り込み・読み込み)。畳んだフォルダは全部開く。 */
  function renderFiles(): void {
    collapsedDirs = new Set();
    drawFiles();
  }

  function drawFiles(): void {
    const list = document.getElementById("filelist");
    // 描き直す前に、行にあったフォーカスを控える。
    const focused = list
      ? focusedListRow(list, FILE_ROW_SELECTOR, fileRowKey)
      : null;
    try {
      renderFileRows();
    } finally {
      if (list && selectedWorktree()) syncFileTabStop(list, focused);
    }
  }

  // ---- 行の Tab の止まり場所とキー ----

  function worktreeKey(row: HTMLElement): string {
    return row.dataset.wt ?? "";
  }

  function worktreeRows(): HTMLElement[] {
    return listPanel
      ? [...listPanel.querySelectorAll<HTMLElement>(WORKTREE_ROW_SELECTOR)]
      : [];
  }

  function fileRowKey(row: HTMLElement): string {
    return row.dataset.key ?? `dir:${row.dataset.worktreeDir ?? ""}`;
  }

  function fileRows(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>(FILE_ROW_SELECTOR)];
  }

  /** 畳んだフォルダの中に居ない行。 */
  function shownFileRows(): HTMLElement[] {
    return fileRows().filter((row) => {
      for (
        let parent = row.parentElement;
        parent && parent.id !== "filelist";
        parent = parent.parentElement
      ) {
        if (
          parent.classList.contains("tree-children") &&
          parent.previousElementSibling?.classList.contains("collapsed")
        )
          return false;
      }
      return true;
    });
  }

  /**
   * 変更ファイルの止まり場所と role。木なら tree (フォルダの子は group)、平らなら
   * listbox。区切りの見出し・コミットの行など、ファイルでない行は role を外す。
   */
  function syncFileTabStop(list: HTMLElement, focused?: FocusedListRow | null) {
    const t = text();
    const tree = list.classList.contains("tree");
    setAttributeIfChanged(list, "role", tree ? "tree" : "listbox");
    setAttributeIfChanged(list, "aria-label", t.panes.fileListLabel);
    const rows = fileRows();
    for (const item of list.querySelectorAll<HTMLElement>("li")) {
      if (rows.includes(item)) {
        setAttributeIfChanged(item, "role", tree ? "treeitem" : "option");
        if (item.dataset.worktreeDir !== undefined)
          setAttributeIfChanged(
            item,
            "aria-expanded",
            String(!item.classList.contains("collapsed")),
          );
      } else setAttributeIfChanged(item, "role", "none");
    }
    for (const group of list.querySelectorAll<HTMLElement>(".tree-children"))
      setAttributeIfChanged(group, "role", "group");
    syncListTabStop(list, {
      rows,
      shown: shownFileRows(),
      keyOf: fileRowKey,
      isActive: (row) => row.classList.contains("active"),
      ariaSelected: true,
      ...(focused === undefined ? {} : { focused }),
      fallback: document.getElementById("sidebar"),
    });
  }

  /**
   * 行の上のキー: ↑↓・Home / End は行から行へフォーカスを移すだけ (選ぶと画面が
   * 切り替わる)。Enter は 1 回押したのと同じ (フォルダは開閉)。
   */
  function rowFocusKeys(rows: () => HTMLElement[]): ListRowKeys {
    const focusRow = (row: HTMLElement | null | undefined) => row?.focus();
    return {
      ArrowDown: (row) => focusRow(adjacentRow(rows(), row, 1)),
      ArrowUp: (row) => focusRow(adjacentRow(rows(), row, -1)),
      Home: () => focusRow(rows()[0]),
      End: () => {
        const all = rows();
        focusRow(all[all.length - 1]);
      },
      Enter: (row) => {
        if (row.dataset.worktreeDir === undefined) {
          row.click();
          return;
        }
        // 開閉は chev の click (止まり場所の付け直しもそこで)。
        row.querySelector<HTMLElement>(".chev")?.click();
      },
    };
  }

  function renderFileRows(): void {
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
      setAttributeIfChanged(button, "aria-pressed", String(active));
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      ".sb-tree-action",
    )) {
      button.disabled = !tree;
    }
    const item = selectedWorktree();
    // 一覧だけのとき #sidebar (変更ファイルの一覧) は出さない。触らない。
    if (!item) {
      deps.onSidebarOwner(false);
      return;
    }
    deps.onSidebarOwner(true);
    // 見出しは app.ts の syncSidebarTitle と同じ「変更ファイル」。
    if (title) title.textContent = t.panes.fileListLabel;
    if (totals) totals.textContent = t.files.heading(item.fileCount);
    list.removeAttribute("data-diff-list");
    renderOwned(list, view.files(fileEntries(item, tree)));
  }

  function fileEntries(item: WorktreeItem, tree: boolean): WorktreeFileEntry[] {
    const t = text();
    const entries = commitEntries(item);
    const note = (text: string): WorktreeFileEntry => ({
      kind: "note",
      note: { text, error: false },
    });
    if (!item.fileCount) return [...entries, note(t.files.none)];
    const shown = visibleFiles(item);
    if (!shown.length) return [...entries, note(t.panes.noFileMatch)];
    // ⇄ が 1 つでも出るなら、その意味を先頭に置く。出ないなら置かない。
    if (shown.some((entry) => overlapOthers(item, entry).length > 0))
      entries.push({ kind: "legend", text: t.intro.overlapLegend });
    // ツリー用の CSS は #filelist.tree にぶら下がっている。
    for (const group of ["uncommitted", "committed"] as const) {
      const files = shown.filter((file) => file.origin === group);
      if (!files.length) continue;
      // 区切りの見出し。パスの行ではないので .tree-file の省略ルール
      // (nowrap + ellipsis) に乗せない。乗せると日本語が 1 文字ずつ縦に潰れる。
      entries.push({
        kind: "group",
        text: group === "uncommitted" ? t.files.uncommitted : t.files.committed,
      });
      if (tree) entries.push(...treeEntries(item, buildTree(files), 0, group));
      else
        entries.push(
          ...files.map((file) => fileProps(item, file, 0, file.path)),
        );
    }
    return entries;
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
        fetch(`${apiUrl("worktreeDiff")}?${params.toString()}`).then(
          async (response) => {
            if (!response.ok) {
              throw new Error(
                await responseErrorMessage(
                  response,
                  "loading the worktree diff",
                ),
              );
            }
            return (await response.json()) as WorktreeDiffResponse;
          },
        ),
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
      detachStickyHScroll(shell);
      body.replaceChildren();
      if (!res.diff.trim()) {
        body.replaceChildren(
          templateElement(view.diff.info(t.panes.diffEmpty)),
        );
      } else {
        // 差分が描けたら自前の見出しは畳む。diff2html が同じ内容の見出し
        // (パス・CHANGED・Viewed) を出すので、残すと 2 段になる。Diff
        // ビューアも描画後に .gdp-shell-header を隠している。
        // 読み込み中とエラー時は、どのファイルの話か分かるように残す。
        const head = shell.querySelector<HTMLElement>(".gdp-shell-header");
        if (head) head.style.display = "none";
        if (res.truncated) {
          // 全部見る入口 (行の右端の「開く」と同じ操作) を知らせの横に置く。
          body.appendChild(
            templateElement(
              view.diff.truncated({
                text: t.panes.diffTruncated(res.renderedHunks, res.totalHunks),
                open: { label: t.open, onClick: () => void openWorktree(item) },
              }),
            ),
          );
        }
        const host = templateElement(view.diff.host());
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
        // 長いカードでも横のスクロールバーを本文の下端に貼って見せる (Diff と同じ)。
        attachStickyHScroll(shell);
        enhanceMediaCard(
          {
            path: file.path,
            status:
              file.status === "A" || file.status === "U" || file.status === "R"
                ? "A"
                : file.status,
          },
          shell,
          {
            fileUrl: (side) =>
              `${apiUrl("worktreeFile")}?${new URLSearchParams({
                path: item.path,
                file: file.path,
                origin: file.origin,
                side,
              }).toString()}`,
            onMediaError: (_side, media) => {
              media.replaceWith(
                templateElement(
                  view.diff.mediaUnavailable(t.panes.mediaUnavailable),
                ),
              );
            },
          },
        );
      }
      shell.classList.add("loaded");
    } catch (error) {
      if (!isCurrent(seq) || !shell.isConnected) return;
      body.replaceChildren(
        templateElement(
          view.diff.info(failureMessage(t.panes.diffFailed, error), true),
        ),
      );
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
      // 出す。2 本目があるのに未選択なら、いつもの案内。説明は何も無い右ペインに
      // 出すので説明がノイズにならず、2 本目を作った時点で二度と出ない。
      diff.replaceChildren(
        templateElement(
          data && data.worktrees.length === 1
            ? view.diff.intro({
                title: t.intro.cardTitle,
                paragraphs: [
                  t.intro.cardWhat,
                  t.intro.cardWhy,
                  t.intro.cardHow,
                ],
                button: {
                  label: t.intro.cardButton,
                  onClick: () => void addWorktree(),
                },
              })
            : view.diff.info(t.panes.selectWorktree),
        ),
      );
      diffFor = "";
      return;
    }
    if (!item.fileCount) {
      // 空のままにせず、次にやること (そのフォルダで編集する) を書く。
      // リポジトリの外に在る作業ツリーは OS で開けない (パスは写せる)。
      const usable = !item.missing && !item.bare;
      diff.replaceChildren(
        templateElement(
          view.diff.empty({
            title: t.emptyDiff.title,
            body: t.emptyDiff.body(item.path),
            openFolder: usable ? openFolderButton(item, true) : null,
            copy: usable ? copyPathProps(item, true) : null,
          }),
        ),
      );
      diffFor = diffKey(item);
      return;
    }

    const files = visibleFiles(item);
    if (!files.length) {
      diff.replaceChildren(
        templateElement(view.diff.info(t.panes.noFileMatch)),
      );
      diffFor = diffKey(item);
      return;
    }
    const pending = new Map<HTMLElement, WorktreeFileChange>();
    for (const file of files) {
      const shell = templateElement(
        view.diff.shell({
          path: file.path,
          key: fileKey(file),
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          loading: t.panes.diffLoading,
        }),
      );
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
    resetProject() {
      suspend();
      data = null;
      acceptedServerGeneration = 0;
      refreshLoop = null;
      message = "";
      messageIsError = false;
      busyPath = "";
      worktreeFilter = "";
      fileFilter = "";
    },
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
