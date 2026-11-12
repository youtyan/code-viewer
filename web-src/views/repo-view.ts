import { live } from "lit/directives/live.js";
import { ref } from "lit/directives/ref.js";
import { html, nothing, type TemplateResult } from "lit/html.js";
import { apiUrl } from "../core/api-url";
// Repository browsing view: tree listing, breadcrumbs, context menu,
// new-folder / move-to-trash actions, upload panel, and the repo blob
// sidebar. Extracted from app.ts as a deps-injected factory.

import { normalizeNewDirectoryName } from "../core/directory-name";
import {
  errorWithCause,
  formatErrorDetail,
  responseErrorMessage,
} from "../core/error-detail";
import {
  fileNameClipboardText,
  filePathClipboardText,
} from "../core/file-path-copy";
import { mainScrollBox } from "../core/focus-scope";
import {
  COPY_16_PATHS,
  FILE_16_PATH,
  GIT_BRANCH_16_PATH,
  LINK_16_PATH,
  PLUS_16_PATH,
  TRASH_16_PATH,
} from "../core/icons";
import { isImeComposing } from "../core/keyboard";
import { renderMarkdownPreview } from "../core/markdown-preview";
import {
  type AppRoute,
  buildRawFileUrl,
  type SourceFileTarget,
} from "../core/routes";
import { formatBytes, formatFileDate } from "../core/source-meta";
import type {
  RawFileInfo,
  RepoTreeEntry,
  RepoTreeResponse,
  SidebarItem,
  UndoActionResponse,
} from "../core/types";
import { TREE_WITHOUT_COMMIT_DATES } from "../core/types";
import { fitBreadcrumb } from "./breadcrumb-fit";
import { type ContextMenuItem, showContextMenu } from "./context-menu";
import { fileRouteKeepingActiveView } from "./file-shell";
import {
  type MarkdownLinkNavigationDeps,
  openMarkdownLink,
} from "./markdown-link-navigation";
import { type RepoViewLanguage, repoViewText } from "./repo-view-i18n";
import { createRepositoryWebLink as renderRepositoryWebLink } from "./repository-web-link";
import { sidebarAncestorDirs } from "./sidebar";
import { iconTemplate } from "./ui/icon";
import { renderOwned, templateElement } from "./ui/renderer";
import {
  showAlertDialog,
  showConfirmDialog,
  showPromptDialog,
} from "./ui-dialog";

export type RepoViewDeps = {
  setRoute(route: AppRoute, replace?: boolean): void;
  /**
   * 木のファイルの右クリックの「新しいタブで開く」(木の行の中ボタンと同じ) と
   * 「右に分割して開く」(面を右に分けて開く。ui-surface.md のタブの決まり)。
   */
  openTreeFileAs(path: string, intent: "new-tab" | "split"): void;
  setPageMode(): void;
  setStatus(s: "live" | "refreshing" | "error" | null): void;
  setProjectName(project: string): void;
  currentRange(): { from: string; to: string };
  appendScopeParams(params: URLSearchParams): void;
  markActive(path: string, options?: { reveal?: boolean }): void;
  applyFilter(): void;
  renderSidebar(
    files: SidebarItem[],
    onFileClick?: (file: SidebarItem) => void,
  ): void;
  refreshRepoSidebarTree(files: SidebarItem[]): Promise<void>;
  rerenderVirtualSidebar(): void;
  ensureVirtualSidebarDirLoaded(dir: unknown): Promise<void>;
  scrollVirtualSidebarPathIntoView(path: string): void;
  shouldLazyLoadSidebarDir(dir: unknown): boolean;
  setFolderIcon(el: HTMLElement, collapsed: boolean): void;
  isRepositorySidebarMode(): boolean;
  placeSidebarToggle(): void;
  createOpenPathButton(
    path: string,
    kind: "directory" | "file-parent",
    title?: string,
  ): HTMLElement;
  removeStandaloneSource(): void;
  renderStandaloneSource(target: SourceFileTarget): Promise<unknown>;
  repoFileTargetFromRoute(): string | null;
  /**
   * Files とファイルの画面の外 (Diff・History・Data など) でファイル一覧に出す
   * ref。ファイル一覧はどの画面でも出している。
   */
  filesColumnRef(): string | null;
  trackLoad: <T>(promise: Promise<T>) => Promise<T>;
  isAbortError(err: unknown): boolean;
  setRepoSidebarRef(ref: string | null): void;
  getSidebarOnFileClick(): unknown;
  syncHeaderMenu(): void;
  getSidebarRowByPath(
    path: string,
  ): { kind?: string; dir?: unknown } | undefined;
  getSidebarVirtualActivePath(): string | null;
  pushUndo(undo: UndoActionResponse): void;
  getRepoSidebarRef(): string | null;
  getProjectName(): string;
  clearLoadQueue(): void;
  syncSidebarHeaderHeight(): void;
  newFolderButtonTitle(): string;
  openDirectoryInOsTitle(): string;
  /** ゴミ箱へ移すボタンの名前 (ファイルとフォルダで言い分ける)。 */
  moveToTrashTitle(kind: "file" | "folder"): string;
  uploadButtonLabel(): string;
  dropFilesIntoCopy(target: string): string;
  uploadFailedMessage(): string;
  emptyDirectoryLabel(): string;
  uploadConfirmText(
    count: number,
    target: string,
  ): { title: string; body: string; confirmLabel: string };
  sortColumnLabels(): {
    name: string;
    updated: string;
    committed: string;
    size: string;
    committedHint: string;
    updatedHint: string;
    noCommit: string;
    filterPlaceholder: string;
    clearFilter: string;
    noMatches: string;
    entryCount: (visible: number, total: number) => string;
  };
  repositoryFallback(): string;
  repositoryRootFallback(): string;
  commitEntryMeta(submodule: RepoTreeEntry["submodule"]): {
    label: string;
    title: string;
  };
  repositoryWebTarget(
    path: string,
    ref: string,
  ): { url: string; provider: "github" | "web" } | null;
  openGithubLabel(): string;
  openRepositoryWebLabel(): string;
  folderHistoryLabel(): string;
  folderHistoryTitle(): string;
  // Opens the commit log restricted to `path` (a directory; "" = root).
  openFolderHistory(ref: string, path: string): void;
  fileBadge(status?: string): HTMLElement;
  $: <T extends Element = HTMLElement>(sel: string) => T;
  STATE: {
    route: AppRoute;
    files: { path: string }[];
    syntaxHighlight: boolean;
    language: RepoViewLanguage;
  };
};

type ButtonProps = {
  label: string;
  title: string;
  onClick(button: HTMLElement): void;
};

/** フォルダ表示の 1 行。 */
export type RepoRowProps = {
  className: string;
  title: string | null;
  disabled: boolean;
  /** 左の印: フォルダ・状態の札・種類の絵。 */
  icon:
    | { kind: "folder" }
    | { kind: "badge"; element: HTMLElement }
    | { kind: "type"; type: "link" | "commit" | "file"; gitlink: boolean };
  name: { text: string; title: string };
  /** フォルダの名前の横の状態の札 (無ければ null)。 */
  badge: HTMLElement | null;
  committed: { text: string; title: string; dateTime: string | null };
  meta: { className: string; text: string; title: string };
  size: string;
  onOpen(): void;
  onContextMenu(event: MouseEvent): void;
};

/** 一覧の範囲 (絞り込み・並べ替え・行)。 */
export type RepoListProps = {
  filter: {
    placeholder: string;
    value: string;
    count: string;
    clear: { label: string; disabled: boolean };
    onInput(value: string): void;
    onClear(): void;
  };
  /** 落とす・選ぶでファイルを足す枠 (作業ツリーのときだけ)。 */
  upload: {
    copy: string;
    button: string;
    dragging: boolean;
    failed: boolean;
    error: string;
    onDragOver(): void;
    onDragLeave(): void;
    onFiles(files: FileList): void;
  } | null;
  sort: {
    key: string;
    label: string;
    title: string | null;
    active: boolean;
    onClick(): void;
  }[];
  parent: { onClick(): void } | null;
  rows: RepoRowProps[];
  empty: string | null;
  /** フォルダの絵を描く (左のファイル一覧と同じ絵)。 */
  drawFolderIcon(element: HTMLElement, collapsed: boolean): void;
};

/** フォルダ表示の枠 (見出しの行・一覧の箱・README)。 */
export type RepoShellProps = {
  breadcrumb: {
    parts: { label: string; current: boolean; onClick(): void }[];
    fullPath: string;
  };
  copyPath: ButtonProps | null;
  openPath: HTMLElement;
  webLink: HTMLElement | null;
  history: { label: string; title: string; onClick(): void };
  newFolder: ButtonProps | null;
  trash: ButtonProps | null;
  readme: {
    path: string;
    body:
      | { kind: "preview"; element: HTMLElement }
      | { kind: "failed"; lead: string; detail: string; text: string };
  } | null;
};

export type RepoFileDetailMetaProps = {
  label: string;
  failed: boolean;
  items: { label: string; value: string }[];
  /** 何も無ければ隠す (そのときの対象のパス)。 */
  emptyPath: string | null;
};

export type RepoView = {
  shell(props: RepoShellProps): unknown;
  list(props: RepoListProps): unknown;
  trashButton(props: ButtonProps): unknown;
  fileDetailMeta(props: RepoFileDetailMetaProps): unknown;
  error(text: string): unknown;
};

function iconButtonTemplate(
  props: ButtonProps,
  className: string,
  icon: unknown,
): TemplateResult {
  return html`<button
    type="button"
    class=${className}
    title=${props.title}
    aria-label=${props.title}
    @click=${(event: MouseEvent) => {
      event.stopPropagation();
      props.onClick(event.currentTarget as HTMLElement);
    }}
  >${icon}</button>`;
}

function rowTemplate(row: RepoRowProps, props: RepoListProps): TemplateResult {
  const folderIcon = ref((element) => {
    if (element instanceof HTMLElement) props.drawFolderIcon(element, true);
  });
  const name = html`<span class="name" title=${row.name.title}>${row.name.text}</span>`;
  return html`<button
    type="button"
    class=${row.className}
    title=${row.title ?? nothing}
    aria-disabled=${row.disabled ? "true" : nothing}
    @click=${row.onOpen}
    @contextmenu=${row.onContextMenu}
  >${
    row.icon.kind === "folder"
      ? html`<span class="dir-icon" ${folderIcon}></span>`
      : row.icon.kind === "badge"
        ? row.icon.element
        : html`<span
            class=${row.icon.gitlink ? "d2h-icon-wrapper gdp-repo-row-gitlink-icon" : "d2h-icon-wrapper"}
          >${
            row.icon.type === "link"
              ? iconTemplate(LINK_16_PATH, "octicon-link")
              : row.icon.type === "commit"
                ? iconTemplate(GIT_BRANCH_16_PATH, "octicon-git-branch")
                : iconTemplate(FILE_16_PATH, "octicon-file")
          }</span>`
  }${
    // Keep status badges beside the name so date columns stay aligned.
    row.badge ? html`<span class="name-cell">${name}${row.badge}</span>` : name
  }<time
    class="commit-date"
    datetime=${row.committed.dateTime ?? nothing}
    title=${row.committed.title}
  >${row.committed.text}</time><span class=${row.meta.className} title=${row.meta.title}
    >${row.meta.text}</span
  ><span class="size">${row.size}</span></button>`;
}

function uploadTemplate(
  upload: NonNullable<RepoListProps["upload"]>,
): TemplateResult {
  const cls = [
    "gdp-upload-panel",
    upload.dragging ? "dragging" : "",
    upload.failed ? "failed" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return html`<div
    class=${cls}
    @dragover=${(event: DragEvent) => {
      event.preventDefault();
      upload.onDragOver();
    }}
    @dragleave=${upload.onDragLeave}
    @drop=${(event: DragEvent) => {
      event.preventDefault();
      upload.onDragLeave();
      const files = event.dataTransfer?.files;
      if (files?.length) upload.onFiles(files);
    }}
  ><div class="gdp-upload-copy">${upload.copy}</div><button
    type="button"
    class="gdp-btn gdp-btn-sm"
    @click=${(event: MouseEvent) =>
      (event.currentTarget as HTMLElement).parentElement
        ?.querySelector<HTMLInputElement>("input[type=file]")
        ?.click()}
  >${upload.button}</button><input
    type="file"
    multiple
    hidden
    @change=${(event: Event) => {
      const input = event.currentTarget as HTMLInputElement;
      if (input.files?.length) upload.onFiles(input.files);
      input.value = "";
    }}
  /><div class="gdp-upload-error">${upload.error}</div></div>`;
}

export const DEFAULT_VIEW: RepoView = {
  shell: (props) => html`<section class="gdp-repo-shell"><div
      class="gdp-file-detail-header gdp-repo-toolbar"
    ><div class="gdp-file-detail-path"><nav
          class="gdp-file-breadcrumb gdp-repo-breadcrumb"
          ${ref((nav) => {
            // 深いフォルダで入りきらないときは真ん中の段を「…」に畳む。
            if (nav instanceof HTMLElement)
              fitBreadcrumb(nav, props.breadcrumb.fullPath);
          })}
        >${props.breadcrumb.parts.map(
          (part, index) => html`${
            index > 0
              ? html`<span class="gdp-file-breadcrumb-sep">/</span>`
              : nothing
          }<button
              type="button"
              class=${part.current ? "gdp-file-breadcrumb-current" : "gdp-file-breadcrumb-part"}
              ?disabled=${part.current && index > 0}
              @click=${part.onClick}
            >${part.label}</button>`,
        )}</nav>${
          props.copyPath
            ? iconButtonTemplate(
                props.copyPath,
                "gdp-file-header-icon gdp-copy-path",
                iconTemplate(COPY_16_PATHS, "octicon-copy"),
              )
            : nothing
        }${props.openPath}</div>${props.webLink ?? nothing}<button
        type="button"
        class="gdp-btn gdp-btn-sm gdp-repo-history-btn"
        title=${props.history.title}
        @click=${props.history.onClick}
      >${props.history.label}</button>${
        props.newFolder
          ? iconButtonTemplate(
              props.newFolder,
              "gdp-file-header-icon gdp-create-dir",
              iconTemplate(PLUS_16_PATH, "octicon-plus"),
            )
          : nothing
      }${
        props.trash
          ? iconButtonTemplate(
              props.trash,
              "gdp-file-header-icon gdp-trash-path",
              iconTemplate(TRASH_16_PATH, "octicon-trash"),
            )
          : nothing
      }</div><section class="gdp-file-shell loaded gdp-repo-list-shell"><div
        class="d2h-file-wrapper"
      ></div></section>${
        props.readme
          ? html`<section class="gdp-file-shell loaded gdp-repo-readme"><div
              class="d2h-file-wrapper"
            ><div class="d2h-file-header"><div class="d2h-file-name-wrapper"><span
                    class="d2h-icon-wrapper"
                  >${iconTemplate(FILE_16_PATH, "octicon-file")}</span><span
                    class="d2h-file-name"
                  >${props.readme.path}</span></div></div>${
                    props.readme.body.kind === "preview"
                      ? props.readme.body.element
                      : // 生の文字に落として読めるようにするが、落ちた理由も並べて残す。
                        html`<div class="gdp-markdown-fallback-reason"><p>${props.readme.body.lead}</p><pre
                          >${props.readme.body.detail}</pre
                        ></div><pre class="gdp-markdown-fallback">${props.readme.body.text}</pre>`
                  }</div></section>`
          : nothing
      }</section>`,
  list: (props) => html`<div class="gdp-repo-search-bar"><input
      type="search"
      class="gdp-repo-filter"
      placeholder=${props.filter.placeholder}
      aria-label=${props.filter.placeholder}
      .value=${live(props.filter.value)}
      @input=${(event: Event) =>
        props.filter.onInput((event.currentTarget as HTMLInputElement).value)}
      @keydown=${(event: KeyboardEvent) => {
        if (isImeComposing(event)) return;
        const input = event.currentTarget as HTMLInputElement;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          props.filter.onClear();
          input.focus();
        } else if (event.key === "ArrowDown" || event.key === "Enter") {
          const first = input
            .closest(".d2h-file-wrapper")
            ?.querySelector<HTMLButtonElement>(
              ".gdp-repo-file-list .gdp-repo-row:not(.parent):not([aria-disabled='true'])",
            );
          if (!first) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Enter") first.click();
          else first.focus();
        }
      }}
    /><span class="gdp-repo-result-count" aria-live="polite">${props.filter.count}</span
    ><button
      type="button"
      class="gdp-btn gdp-btn-sm gdp-repo-filter-clear"
      ?disabled=${props.filter.clear.disabled}
      @click=${(event: MouseEvent) => {
        props.filter.onClear();
        (event.currentTarget as HTMLElement)
          .closest(".gdp-repo-search-bar")
          ?.querySelector<HTMLInputElement>(".gdp-repo-filter")
          ?.focus();
      }}
    >${props.filter.clear.label}</button>${
      props.upload ? uploadTemplate(props.upload) : nothing
    }</div><div class="gdp-repo-sort-host"><div class="gdp-repo-sort-header"><span
          class="gdp-repo-sort-spacer"
        ></span>${props.sort.map(
          (column) => html`<button
            type="button"
            data-repo-sort=${column.key}
            title=${column.title ?? nothing}
            class=${column.active ? "active" : ""}
            @click=${(event: MouseEvent) => {
              const host = (event.currentTarget as HTMLElement).closest(
                ".gdp-repo-sort-host",
              );
              column.onClick();
              host
                ?.querySelector<HTMLButtonElement>(
                  `[data-repo-sort="${column.key}"]`,
                )
                ?.focus();
            }}
          >${column.label}</button>`,
        )}</div></div
    ><div class="gdp-source-viewer gdp-repo-file-list">${
      props.parent
        ? html`<button
            type="button"
            class="gdp-repo-row parent"
            @click=${props.parent.onClick}
          ><span
              class="dir-icon"
              ${ref((element) => {
                if (element instanceof HTMLElement)
                  props.drawFolderIcon(element, false);
              })}
            ></span
            ><span class="name">..</span><span></span><span class="meta"></span><span
              class="size"
            ></span></button>`
        : nothing
    }${props.rows.map((row) => rowTemplate(row, props))}${
      props.empty !== null
        ? html`<div class="gdp-repo-empty">${props.empty}</div>`
        : nothing
    }</div>`,
  trashButton: (props) =>
    iconButtonTemplate(
      props,
      "gdp-file-header-icon gdp-trash-path",
      iconTemplate(TRASH_16_PATH, "octicon-trash"),
    ),
  // 大きさ・日時は補助の情報なので行としては出さず、パンくずの横の小さな
  // 情報のボタンに入れる (hover かフォーカスで一覧が出る。style.css の
  // 文書の面の節)。
  fileDetailMeta: (props) => html`<div
    class=${props.failed ? "gdp-file-detail-meta failed" : "gdp-file-detail-meta"}
    tabindex="0"
    aria-label=${props.label}
    ?hidden=${props.emptyPath !== null}
    data-path=${props.emptyPath ?? nothing}
  ><span class="gdp-file-detail-meta-icon" aria-hidden="true">i</span><span
      class="gdp-file-detail-meta-list"
      >${props.items.map(
        (item) =>
          html`<span class="gdp-file-detail-meta-item"><span class="label"
              >${item.label}</span
            ><span class="value">${item.value}</span></span
          >`,
      )}</span
    ></div
  >`,
  error: (text) => html`<pre class="gdp-repo-error" role="alert">${text}</pre>`,
};

export function createRepoView(
  deps: RepoViewDeps,
  view: RepoView = DEFAULT_VIEW,
) {
  const {
    $,
    STATE,
    setRoute,
    setPageMode,
    setStatus,
    setProjectName,
    currentRange,
    appendScopeParams,
    markActive,
    applyFilter,
    renderSidebar,
    refreshRepoSidebarTree,
    rerenderVirtualSidebar,
    ensureVirtualSidebarDirLoaded,
    scrollVirtualSidebarPathIntoView,
    shouldLazyLoadSidebarDir,
    setFolderIcon,
    isRepositorySidebarMode,
    placeSidebarToggle,
    createOpenPathButton,
    removeStandaloneSource,
    renderStandaloneSource,
    repoFileTargetFromRoute,
    filesColumnRef,
    trackLoad,
    isAbortError,
    syncSidebarHeaderHeight,
    clearLoadQueue,
    getProjectName,
    getRepoSidebarRef,
    setRepoSidebarRef,
    getSidebarOnFileClick,
    syncHeaderMenu,
    getSidebarRowByPath,
    getSidebarVirtualActivePath,
    pushUndo,
    newFolderButtonTitle,
    openDirectoryInOsTitle,
    moveToTrashTitle,
    uploadButtonLabel,
    dropFilesIntoCopy,
    uploadFailedMessage,
    emptyDirectoryLabel,
    uploadConfirmText,
    sortColumnLabels,
    repositoryFallback,
    repositoryRootFallback,
    commitEntryMeta,
    repositoryWebTarget,
    openGithubLabel,
    openRepositoryWebLabel,
    folderHistoryLabel,
    folderHistoryTitle,
    openFolderHistory,
    fileBadge,
  } = deps;

  type RepoSortKey = "name" | "updated" | "committed" | "size";

  type RepoSortDirection = "asc" | "desc";

  let REPO_SORT: { key: RepoSortKey; direction: RepoSortDirection } = {
    key: "name",
    direction: "asc",
  };

  function isRepoSidebarReusable(ref: string): boolean {
    return (
      getRepoSidebarRef() === (ref || "worktree") &&
      isRepositorySidebarMode() &&
      isRepoSidebarDomReusable()
    );
  }

  function isRepoSidebarDomReusable(): boolean {
    const filelist = document.querySelector<HTMLElement>("#file-list-rows");
    if (!filelist || !getSidebarOnFileClick()) return false;
    return !!filelist.querySelector("[data-path], [data-dirpath]");
  }

  function syncRepoTargetInput(ref: string) {
    const input = document.querySelector<HTMLInputElement>("#repo-target");
    const wrap = document.querySelector<HTMLElement>("#repo-target-wrap");
    if (!input || !wrap) return;
    const activeRef = activeRepoTreeRef();
    input.value = activeRef || ref || "worktree";
    // 既定 (worktree) のときはツリーの頭で小さなアイコンだけにし、ほかの ref を
    // 選んでいるときは値を出す (style.css のツリーの頭の節)。
    wrap.dataset.defaultRef = String(input.value === "worktree");
    wrap.hidden = activeRef == null;
    wrap.style.display = activeRef == null ? "none" : "";
    syncSidebarHeaderHeight();
  }

  function activeRepoTreeRef(): string | null {
    const fileRef = repoFileTargetFromRoute();
    if (fileRef != null) return fileRef || "worktree";
    if (STATE.route.screen === "repo") return STATE.route.ref || "worktree";
    return filesColumnRef();
  }

  function isActiveRepoTreeRef(ref: string) {
    return activeRepoTreeRef() === (ref || "worktree");
  }

  function isActiveRepoRoute(ref: string, path: string) {
    return (
      STATE.route.screen === "repo" &&
      (STATE.route.ref || "worktree") === (ref || "worktree") &&
      (STATE.route.path || "") === path
    );
  }

  function isWorktreeRef(ref: string): boolean {
    return canTrashWorktreeRef(ref);
  }

  /** フォルダの絵を描く ref (絵は左のファイル一覧と同じものをそこが描く)。 */
  function entryIcon(
    entry: RepoTreeEntry,
    browsable: boolean,
    nonBrowsableCommit: boolean,
  ): RepoRowProps["icon"] {
    if (browsable) return { kind: "folder" };
    return {
      kind: "type",
      type: entry.is_symlink
        ? "link"
        : entry.type === "commit"
          ? "commit"
          : "file",
      gitlink: nonBrowsableCommit,
    };
  }

  function canBrowseRepoEntry(
    entry: { type?: string; submodule?: true },
    ref: string,
  ): boolean {
    return (
      entry.type === "tree" ||
      (entry.type === "commit" && isWorktreeRef(ref) && !entry.submodule)
    );
  }

  function confirmMoveToTrash(
    path: string,
    focusReturnTarget?: HTMLElement | null,
  ): Promise<boolean> {
    const text = repoViewText(STATE.language);
    return showConfirmDialog({
      title: text.moveToTrashTitle,
      body: text.moveToTrashBody(path),
      confirmLabel: text.moveToTrash,
      danger: true,
      focusReturnTarget,
    });
  }

  function askNewDirectoryName(
    path: string,
    focusReturnTarget?: HTMLElement | null,
  ): Promise<string | null> {
    const text = repoViewText(STATE.language);
    return showPromptDialog({
      title: text.newFolder,
      body: text.newFolderBody(path || getProjectName() || "repository"),
      placeholder: text.folderName,
      ariaLabel: text.folderName,
      confirmLabel: text.create,
      validate: (v) => normalizeNewDirectoryName(v),
      invalidMessage: text.invalidFolderName,
      focusReturnTarget,
    });
  }

  async function requestCreateDirectory(
    path: string,
    onCreated: (createdPath: string) => void,
    options: { focusReturnTarget?: HTMLElement | null } = {},
  ) {
    if (creatingDirectory) return;
    const name = await askNewDirectoryName(path, options.focusReturnTarget);
    if (!name) return;
    creatingDirectory = true;
    try {
      const res = await fetch(apiUrl("createDirectory"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify({ dir: path, name }),
      });
      if (!res.ok) {
        showCreateDirectoryError(
          repoViewText(STATE.language).createFailed(
            name,
            await responseErrorMessage(res, "creating the folder"),
          ),
        );
        return;
      }
      const body = (await res.json()) as { path?: string };
      onCreated(body.path || (path ? `${path}/${name}` : name));
    } finally {
      creatingDirectory = false;
    }
  }

  async function requestMoveToTrash(
    path: string,
    onMoved: () => void,
    options: { focusReturnTarget?: HTMLElement | null } = {},
  ) {
    if (!(await confirmMoveToTrash(path, options.focusReturnTarget))) return;
    if (await moveRepoPathToTrash(path)) onMoved();
  }

  function canTrashWorktreeRef(ref: string) {
    return ref === "worktree" || ref === "";
  }

  function parentRepoPath(path: string): string {
    return path.split("/").slice(0, -1).join("/");
  }

  async function copyRepoContextText(text: string) {
    if (!text) return;
    await navigator.clipboard.writeText(text);
  }

  function copyPathProps(path: string): ButtonProps {
    const label = repoViewText(STATE.language).copyFolderPath;
    return {
      label,
      title: label,
      onClick: async (button) => {
        try {
          await navigator.clipboard.writeText(filePathClipboardText(path));
          button.classList.add("copied");
          setTimeout(() => {
            button.classList.remove("copied");
          }, 1200);
        } catch (error) {
          console.error("[code-viewer] copy folder path failed", path, error);
          // 理由は押した場所の title に出す (箱の寸法は変えない)。
          const idleTitle = button.title;
          button.title = repoViewText(STATE.language).copyPathFailed(
            formatErrorDetail(error),
          );
          button.classList.add("failed");
          setTimeout(() => {
            button.classList.remove("failed");
            button.title = idleTitle;
          }, 1200);
        }
      },
    };
  }

  function createRepositoryWebLink(
    path: string,
    ref: string,
  ): HTMLAnchorElement | null {
    const target = repositoryWebTarget(path, ref);
    if (!target) return null;
    const label =
      target.provider === "github"
        ? openGithubLabel()
        : openRepositoryWebLabel();
    return renderRepositoryWebLink(target, label);
  }

  function showRepoContextMenu(
    event: MouseEvent,
    entry: {
      path: string;
      type?: string;
      children_omitted_reason?: string;
    },
    ref: string,
    onChanged: () => void,
  ): boolean {
    if (document.querySelector(".gdp-dialog-backdrop")) return false;
    if (!canTrashWorktreeRef(ref)) return false;
    if (entry.children_omitted_reason === "internal") return false;
    if (entry.type !== "tree" && entry.type !== "blob") return false;
    event.preventDefault();

    // 開く・閉じるは context-menu.ts に任せる (同時に 1 枚・外を押す / Escape で
    // 閉じる・キーの受け手の後始末)。ここで要素だけを消すと、別の場所で開いた
    // メニューまで消し、キーとスクロールの受け手が残った。
    const row =
      (event.target as Element | null)?.closest<HTMLElement>(
        "li, .gdp-repo-row",
      ) ?? null;
    const rowRect = row?.getBoundingClientRect();
    const at = {
      x:
        event.clientX > 0
          ? event.clientX
          : rowRect?.left || window.innerWidth / 2,
      y:
        event.clientY > 0
          ? event.clientY
          : rowRect?.bottom || window.innerHeight / 2,
    };

    const text = repoViewText(STATE.language);
    const items: ContextMenuItem[] =
      entry.type === "blob"
        ? [
            {
              label: text.openInNewTab,
              onSelect: () => deps.openTreeFileAs(entry.path, "new-tab"),
            },
            {
              label: text.openToTheRight,
              onSelect: () => deps.openTreeFileAs(entry.path, "split"),
            },
          ]
        : [];
    items.push(
      {
        label: text.copyPath,
        onSelect: () =>
          void copyRepoContextText(filePathClipboardText(entry.path)),
      },
      {
        label: text.copyName,
        onSelect: () =>
          void copyRepoContextText(fileNameClipboardText(entry.path)),
      },
      {
        label: text.newFolderMenu,
        onSelect: () =>
          void requestCreateDirectory(
            entry.type === "blob" ? parentRepoPath(entry.path) : entry.path,
            onChanged,
            { focusReturnTarget: row },
          ),
      },
      {
        label: text.moveToTrashMenu,
        danger: true,
        onSelect: () =>
          void requestMoveToTrash(entry.path, onChanged, {
            focusReturnTarget: row,
          }),
      },
    );
    showContextMenu(row ?? document.body, items, { at, focusReturn: row });
    return true;
  }

  function sidebarTrashEntryFromEvent(event: MouseEvent): {
    path: string;
    type?: string;
    children_omitted_reason?: string;
  } | null {
    if (!isRepositorySidebarMode()) return null;
    const row = (event.target as Element | null)?.closest<HTMLElement>(
      "#file-list-rows li",
    );
    if (!row) return null;
    const path = row.dataset.path || row.dataset.dirpath || "";
    if (!path) return null;
    return {
      path,
      type: row.dataset.type,
      children_omitted_reason: row.dataset.childrenOmittedReason,
    };
  }

  function handleSidebarContextMenu(event: MouseEvent) {
    const entry = sidebarTrashEntryFromEvent(event);
    if (!entry) return;
    if (
      showRepoContextMenu(event, entry, getRepoSidebarRef() || "worktree", () =>
        loadRepo(),
      )
    )
      markActive(entry.path);
  }

  function trashProps(
    path: string,
    kind: "file" | "folder",
    onDeleted: () => void,
  ): ButtonProps {
    const trashTitle = moveToTrashTitle(kind);
    return {
      label: trashTitle,
      title: trashTitle,
      onClick: async (button) => {
        await requestMoveToTrash(path, onDeleted, {
          focusReturnTarget: button,
        });
      },
    };
  }

  /** まだ命令的に組む呼び手 (ファイルの見出し) へ渡す形。 */
  function createMoveToTrashButton(
    path: string,
    kind: "file" | "folder",
    onDeleted: () => void,
  ): HTMLButtonElement {
    return templateElement<HTMLButtonElement>(
      view.trashButton(trashProps(path, kind, onDeleted)),
    );
  }

  function newFolderProps(
    path: string,
    onCreated: (createdPath: string) => void,
  ): ButtonProps {
    const newFolderTitle = newFolderButtonTitle();
    return {
      label: newFolderTitle,
      title: newFolderTitle,
      onClick: async (button) => {
        await requestCreateDirectory(path, onCreated, {
          focusReturnTarget: button,
        });
      },
    };
  }

  function repoRoute(ref: string, path: string): AppRoute {
    return {
      screen: "repo",
      ref: ref || "worktree",
      path,
      range: currentRange(),
    };
  }

  function markdownLinkNavigationDeps(): MarkdownLinkNavigationDeps {
    return {
      setRoute,
      currentRange,
      loadRepo,
      repoRoute,
      renderStandaloneSource,
      trackLoad,
      isAbortError,
    };
  }

  function breadcrumbProps(
    target: string,
    path: string,
  ): RepoShellProps["breadcrumb"] {
    const rootName = getProjectName() || repositoryFallback();
    const parts = path ? path.split("/") : [];
    const open = (to: string) => {
      setRoute(repoRoute(target, to));
      loadRepo();
    };
    return {
      parts: [
        { label: rootName, current: !path, onClick: () => open("") },
        ...parts.map((part, index) => ({
          label: part,
          current: index === parts.length - 1,
          onClick: () => open(parts.slice(0, index + 1).join("/")),
        })),
      ],
      fullPath: [rootName, ...parts].filter(Boolean).join("/"),
    };
  }

  let projectGeneration = 0;
  let REPO_RENDER_SIGNATURE = "";
  let REPO_RENDER_SEQ = 0;
  let REPO_RENDER_LOCATION = "";

  async function renderRepo(meta: RepoTreeResponse) {
    const myRender = ++REPO_RENDER_SEQ;
    setProjectName(meta.project || "");
    setPageMode();
    removeStandaloneSource();
    $("#empty").classList.add("hidden");
    if (!isRepoSidebarReusable(meta.ref))
      $("#file-list-totals").textContent = "";
    STATE.files = [];
    clearLoadQueue();
    renderRepoBlobSidebar(meta.path || "", meta.ref);

    const target = $("#diff");
    // 同じ内容のままなら組み立て直さない。SSE のたびに一覧と README を作り
    // 直すと表示がガクつくだけで得るものがない。ソート状態やイベントも保たれる。
    const signature = JSON.stringify(meta);
    if (
      signature === REPO_RENDER_SIGNATURE &&
      target.querySelector(":scope > .gdp-repo-shell")
    ) {
      placeSidebarToggle();
      return;
    }
    const location = `${meta.ref || "worktree"}\0${meta.path || ""}`;
    let query =
      location === REPO_RENDER_LOCATION
        ? target.querySelector<HTMLInputElement>(".gdp-repo-filter")?.value ||
          ""
        : "";
    const upload = { dragging: false, failed: false, error: "" };
    let listHost: HTMLElement | null = null;
    const drawList = () => {
      if (listHost) renderOwned(listHost, view.list(listProps()));
    };
    const openEntry = (entry: RepoTreeEntry, browsable: boolean) => {
      if (browsable) {
        // A committed-ref directory symlink cannot be browsed at its
        // own path (git ls-tree does not resolve it) - resolved_path
        // is the real repo-relative path to navigate to instead.
        setRoute(repoRoute(meta.ref, entry.resolved_path ?? entry.path));
        loadRepo();
      } else if (entry.type === "blob") {
        setRoute({
          screen: "file",
          path: entry.path,
          ref: meta.ref,
          view: "blob",
          range: currentRange(),
        });
        renderStandaloneSource({ path: entry.path, ref: meta.ref });
      }
    };
    const rowProps = (entry: RepoTreeEntry): RepoRowProps => {
      const browsable = canBrowseRepoEntry(entry, meta.ref);
      // commit 型で非 browsable (submodule または非 worktree ref) は、見た目は
      // フォルダ/ファイルに近いが実際には開けない。通常行と混同されないよう
      // 専用クラスで区別する (cursor/アイコン色/meta chip 化はCSS側)。
      const nonBrowsableCommit = entry.type === "commit" && !browsable;
      // A symlink whose target is missing/outside the repo still resolves
      // to type "blob" server-side (see attachTreeEntryMetadata) - not
      // browsable, and opening it would just 404, so this is disabled the
      // same way a non-browsable commit entry is.
      const brokenSymlink =
        !!entry.is_symlink && entry.symlink_target_type === "missing";
      // A "D" (deleted) entry is synthesized from git status - it has no
      // filesystem content left to open (see deletedTreeEntriesForPath in
      // preview.ts), so it is shown badged but disabled, same as a broken
      // symlink.
      const deletedEntry = entry.status === "D";
      const base = nonBrowsableCommit
        ? `gdp-repo-row ${entry.type} gdp-repo-row-gitlink`
        : entry.is_symlink
          ? `gdp-repo-row ${entry.type} symlink-row${brokenSymlink ? " symlink-broken-row gdp-row-disabled" : ""}`
          : `gdp-repo-row ${entry.type}`;
      // A directory keeps its folder icon and carries the badge beside the
      // name instead - a whole-directory status (untracked/ignored) must
      // not cost the one cue that tells a folder from a file. For files the
      // badge replaces the type icon, same precedence as sidebar.ts
      // createTreeFileRow uses for the diff view.
      const directoryRow = entry.type === "tree";
      const labels = sortColumnLabels();
      return {
        className:
          deletedEntry && !base.includes("gdp-row-disabled")
            ? `${base} gdp-row-disabled`
            : base,
        title: nonBrowsableCommit
          ? commitEntryMeta(entry.submodule).title
          : null,
        disabled: nonBrowsableCommit || brokenSymlink || deletedEntry,
        icon:
          entry.status && !directoryRow
            ? { kind: "badge", element: fileBadge(entry.status) }
            : entryIcon(entry, browsable, nonBrowsableCommit),
        name: { text: entry.name, title: entry.path },
        badge: directoryRow && entry.status ? fileBadge(entry.status) : null,
        committed: {
          text:
            formatFileDate(entry.commit_updated_at, STATE.language) ||
            labels.noCommit,
          title: entry.commit_updated_at
            ? `${labels.committedHint}\n${entry.commit_updated_at}`
            : labels.committedHint,
          dateTime: entry.commit_updated_at || null,
        },
        meta: entryMetaProps(entry, browsable, meta.ref),
        size:
          entry.type === "blob" && entry.size != null
            ? formatBytes(entry.size)
            : "",
        onOpen: () => {
          if (brokenSymlink || deletedEntry) return;
          openEntry(entry, browsable);
        },
        onContextMenu: (event) =>
          void showRepoContextMenu(event, entry, meta.ref, () => loadRepo()),
      };
    };
    const uploadProps = (path: string): RepoListProps["upload"] => {
      const fail = (uploadError: unknown) => {
        console.error(
          "[code-viewer] uploading files failed",
          path,
          uploadError,
        );
        upload.error = `${uploadFailedMessage()}\n${formatErrorDetail(uploadError)}`;
        upload.failed = true;
        drawList();
        setTimeout(() => {
          upload.failed = false;
          drawList();
        }, 1600);
      };
      return {
        copy: dropFilesIntoCopy(
          path || getProjectName() || repositoryFallback(),
        ),
        button: uploadButtonLabel(),
        dragging: upload.dragging,
        failed: upload.failed,
        error: upload.error,
        onDragOver: () => {
          if (upload.dragging) return;
          upload.dragging = true;
          drawList();
        },
        onDragLeave: () => {
          if (!upload.dragging) return;
          upload.dragging = false;
          drawList();
        },
        onFiles: async (files) => {
          try {
            await uploadFiles(path, files);
            upload.error = "";
            drawList();
          } catch (uploadError) {
            fail(uploadError);
          }
        },
      };
    };
    const listProps = (): RepoListProps => {
      const labels = sortColumnLabels();
      const needle = query.trim().toLowerCase();
      const entries = meta.entries.filter((entry) =>
        entry.name.toLowerCase().includes(needle),
      );
      const parent = meta.path
        ? meta.path.split("/").slice(0, -1).join("/")
        : null;
      const sortColumns: Array<{
        key: RepoSortKey;
        label: string;
        title: string | null;
      }> = [
        { key: "name", label: labels.name, title: null },
        {
          key: "committed",
          label: labels.committed,
          title: labels.committedHint,
        },
        { key: "updated", label: labels.updated, title: labels.updatedHint },
        { key: "size", label: labels.size, title: null },
      ];
      return {
        filter: {
          placeholder: labels.filterPlaceholder,
          value: query,
          count: labels.entryCount(entries.length, meta.entries.length),
          clear: { label: labels.clearFilter, disabled: !query },
          onInput: (value) => {
            query = value;
            drawList();
          },
          onClear: () => {
            query = "";
            drawList();
          },
        },
        upload:
          meta.ref === "worktree" || meta.ref === ""
            ? uploadProps(meta.path || "")
            : null,
        sort: sortColumns.map((column) => {
          const active = REPO_SORT.key === column.key;
          return {
            key: column.key,
            label:
              column.label +
              (active ? (REPO_SORT.direction === "asc" ? " ↑" : " ↓") : ""),
            title: column.title,
            active,
            onClick: () => {
              if (REPO_SORT.key === column.key) {
                REPO_SORT.direction =
                  REPO_SORT.direction === "asc" ? "desc" : "asc";
              } else {
                REPO_SORT = {
                  key: column.key,
                  direction: column.key === "name" ? "asc" : "desc",
                };
              }
              drawList();
            },
          };
        }),
        parent:
          parent === null
            ? null
            : {
                onClick: () => {
                  setRoute(repoRoute(meta.ref, parent));
                  loadRepo();
                },
              },
        rows: sortedRepoEntries(entries, meta.ref).map(rowProps),
        empty: entries.length
          ? null
          : needle
            ? labels.noMatches
            : emptyDirectoryLabel(),
        drawFolderIcon: setFolderIcon,
      };
    };

    let readme: RepoShellProps["readme"] = null;
    if (meta.readme?.text) {
      try {
        readme = {
          path: meta.readme.path,
          body: {
            kind: "preview",
            element: await renderMarkdownPreview(
              meta.readme.text,
              { path: meta.readme.path, ref: meta.ref },
              {
                syntaxHighlight: STATE.syntaxHighlight,
                onNavigateMarkdown: (link) =>
                  void openMarkdownLink(link, markdownLinkNavigationDeps()),
              },
            ),
          },
        };
      } catch (error) {
        console.error(
          "[code-viewer] README markdown render failed",
          meta.readme.path,
          error,
        );
        readme = {
          path: meta.readme.path,
          body: {
            kind: "failed",
            lead: repoViewText(STATE.language).readmeRenderFailed,
            detail: formatErrorDetail(error),
            text: meta.readme.text,
          },
        };
      }
    }

    const trashable = canTrashWorktreeRef(meta.ref);
    const shell = templateElement(
      view.shell({
        breadcrumb: breadcrumbProps(meta.ref, meta.path || ""),
        copyPath: meta.path ? copyPathProps(meta.path) : null,
        openPath: createOpenPathButton(
          meta.path || "",
          "directory",
          openDirectoryInOsTitle(),
        ),
        webLink: createRepositoryWebLink(meta.path || "", meta.ref),
        history: {
          label: folderHistoryLabel(),
          title: folderHistoryTitle(),
          onClick: () => openFolderHistory(meta.ref, meta.path || ""),
        },
        newFolder: trashable
          ? newFolderProps(meta.path || "", () => loadRepo())
          : null,
        trash:
          trashable && meta.path
            ? trashProps(meta.path, "folder", () => {
                const parent = meta.path.split("/").slice(0, -1).join("/");
                setRoute(repoRoute(meta.ref, parent));
                loadRepo();
              })
            : null,
        readme,
      }),
    );
    listHost = shell.querySelector<HTMLElement>(
      ".gdp-repo-list-shell > .d2h-file-wrapper",
    );
    drawList();

    // README の markdown レンダ (await) 中に別ビューへ移動したか、より新しい
    // renderRepo が始まっていたら、この応答は破棄する。古い応答が後から
    // replaceChildren すると、開いたばかりのファイルビュー (renderStandaloneSource
    // が prepend した blob カード) や新しい一覧を丸ごと消してしまう。
    if (
      myRender !== REPO_RENDER_SEQ ||
      !isActiveRepoRoute(meta.ref || "worktree", meta.path || "")
    )
      return;
    // shell を組み立て終えてから一括で差し替える。先に消してしまうと README の
    // markdown レンダリング待ちの間ページが白抜けしてガクつく。
    REPO_RENDER_SIGNATURE = signature;
    const sameLocation = location === REPO_RENDER_LOCATION;
    REPO_RENDER_LOCATION = location;
    // 位置を持っているのは本文の箱 (窓は動かない)。
    const box = mainScrollBox();
    const savedScroll = box?.scrollTop ?? 0;
    target.replaceChildren(shell);
    // 同じディレクトリの再描画 (SSE 更新) なら読んでいた位置を保ち、別の
    // ディレクトリへ移動したときは先頭から表示する。
    if (box) box.scrollTop = sameLocation ? savedScroll : 0;
    placeSidebarToggle();
  }

  function repoTreeEntriesToSidebarItems(
    entries: RepoTreeEntry[],
    ref: string,
  ): SidebarItem[] {
    return entries.map(
      (entry, index) =>
        ({
          order: index + 1,
          path: entry.path,
          display_path: entry.path,
          type: canBrowseRepoEntry(entry, ref) ? "tree" : entry.type,
          submodule: entry.submodule,
          children_omitted: entry.children_omitted,
          children_omitted_reason: entry.children_omitted_reason,
          is_symlink: entry.is_symlink,
          symlink_target: entry.symlink_target,
          symlink_target_type: entry.symlink_target_type,
          resolved_path: entry.resolved_path,
          status: entry.status,
        }) satisfies SidebarItem,
    );
  }

  function renderRepoBlobSidebar(currentPath: string, ref: string) {
    const project = projectGeneration;
    syncRepoTargetInput(ref);
    const normalizedRef = ref || "worktree";
    if (project !== projectGeneration || !isActiveRepoTreeRef(normalizedRef))
      return Promise.resolve();
    if (isRepoSidebarReusable(normalizedRef)) {
      return activateRepoSidebarPath(currentPath);
    }
    if (REPO_SIDEBAR_LOAD && REPO_SIDEBAR_LOAD_REF === normalizedRef) {
      return REPO_SIDEBAR_LOAD.then(() => {
        if (
          project !== projectGeneration ||
          !isActiveRepoTreeRef(normalizedRef)
        )
          return;
        if (!isRepoSidebarReusable(normalizedRef)) {
          invalidateRepoSidebar();
          return renderRepoBlobSidebar(currentPath, normalizedRef);
        }
        return activateRepoSidebarPath(currentPath);
      });
    }
    const params = new URLSearchParams();
    params.set("ref", normalizedRef);
    params.set(...TREE_WITHOUT_COMMIT_DATES);
    appendScopeParams(params);
    REPO_SIDEBAR_LOAD_REF = normalizedRef;
    const load = trackLoad<RepoTreeResponse>(
      // 成功時は r.json() をそのまま返す (async にすると 1 手遅れ、loadRepo の
      // 直後に木がまだ描かれていない)。失敗時だけ本文を読んで理由にする。
      fetch(`${apiUrl("tree")}?${params.toString()}`).then((r) =>
        r.ok
          ? r.json()
          : responseErrorMessage(r, "load repository tree").then((message) => {
              throw new Error(message);
            }),
      ),
    )
      .then(async (meta) => {
        if (
          project !== projectGeneration ||
          !isActiveRepoTreeRef(normalizedRef)
        )
          return;
        const files = repoTreeEntriesToSidebarItems(
          meta.entries,
          normalizedRef,
        );
        setRepoSidebarRef(normalizedRef);
        renderSidebar(files, (file) => {
          if (file.type === "tree") {
            // See the click handler above: a committed-ref directory
            // symlink navigates via resolved_path, not its own path.
            setRoute(repoRoute(normalizedRef, file.resolved_path ?? file.path));
            loadRepo();
            return;
          }
          const fileRoute = fileRouteKeepingActiveView(
            STATE.route,
            { path: file.path, ref: normalizedRef },
            currentRange(),
          );
          setRoute(fileRoute);
          // blame / history は setRoute 内の dispatchFileRoute が描画する。
          if (fileRoute.view === "blob")
            renderStandaloneSource({ path: file.path, ref: normalizedRef });
        });
        await activateRepoSidebarPath(currentPath);
      })
      .catch((error) => {
        if (
          project !== projectGeneration ||
          !isActiveRepoTreeRef(normalizedRef)
        )
          return;
        console.error(
          "[code-viewer] repository tree load failed",
          normalizedRef,
          error,
        );
        setRepoSidebarRef(null);
        renderSidebar([], undefined);
        // 件数の枠 (#file-list-totals) は幅の決まった枠なので、1 行の文言はそのまま出し、理由の
        // 全文 (cause の連鎖ごと) は title に置く。
        const totals = $("#file-list-totals");
        totals.textContent = repoViewText(STATE.language).cannotLoadTree;
        totals.title = formatErrorDetail(error);
      })
      .finally(() => {
        if (REPO_SIDEBAR_LOAD === load) {
          REPO_SIDEBAR_LOAD_REF = null;
          REPO_SIDEBAR_LOAD = null;
        }
      });
    REPO_SIDEBAR_LOAD = load;
    return load;
  }

  /**
   * Files とファイルの画面の外でファイル一覧を出す。同じ ref で読み込み済みなら
   * 何もしない (選んでいる行もスクロールも動かさない)。
   */
  function ensureFileList(ref: string): Promise<void> {
    const normalizedRef = ref || "worktree";
    if (isRepoSidebarReusable(normalizedRef)) {
      syncRepoTargetInput(normalizedRef);
      return Promise.resolve();
    }
    return renderRepoBlobSidebar(
      getSidebarVirtualActivePath() || "",
      normalizedRef,
    );
  }

  async function loadRepoSidebarAncestors(currentPath: string) {
    const project = projectGeneration;
    let loaded = false;
    for (const dirPath of sidebarAncestorDirs(currentPath)) {
      const row = getSidebarRowByPath(dirPath);
      if (row?.kind !== "dir" || !row.dir) continue;
      if (!shouldLazyLoadSidebarDir(row.dir)) continue;
      await ensureVirtualSidebarDirLoaded(row.dir);
      if (project !== projectGeneration) return;
      loaded = true;
    }
    if (loaded) rerenderVirtualSidebar();
  }

  async function activateRepoSidebarPath(currentPath: string) {
    const project = projectGeneration;
    // 同じ path の再 activate (SSE リフレッシュや同一ディレクトリの再描画)
    // ではユーザーが動かしたサイドバーのスクロール位置を奪わない。reveal は
    // ナビゲーションで path が変わったときだけ。
    const reveal = getSidebarVirtualActivePath() !== currentPath;
    await loadRepoSidebarAncestors(currentPath);
    if (project !== projectGeneration) return;
    markActive(currentPath, { reveal });
    applyFilter();
    const row = getSidebarRowByPath(currentPath);
    if (row?.kind === "dir" && row.dir && shouldLazyLoadSidebarDir(row.dir))
      ensureVirtualSidebarDirLoaded(row.dir).then(() => {
        if (
          project === projectGeneration &&
          getSidebarVirtualActivePath() === currentPath
        ) {
          rerenderVirtualSidebar();
          if (reveal) scrollVirtualSidebarPathIntoView(currentPath);
        }
      });
  }

  function entryMetaProps(
    entry: RepoTreeEntry,
    browsable: boolean,
    ref: string,
  ): RepoRowProps["meta"] {
    if (entry.type === "commit" && !browsable) {
      const badge = commitEntryMeta(entry.submodule);
      return {
        className: "meta gdp-repo-row-gitlink-badge",
        text: badge.label,
        title: badge.title,
      };
    }
    // A symlink destination is more useful at a glance than its mtime -
    // show it in place of the usual updated/created date.
    if (entry.is_symlink) {
      const broken = entry.symlink_target_type === "missing";
      const text = repoViewText(STATE.language);
      return {
        className: broken
          ? "meta symlink-target broken"
          : "meta symlink-target",
        text: `→ ${entry.symlink_target || "?"}`,
        title: broken
          ? text.brokenSymlink(entry.symlink_target || "")
          : text.symlink(entry.symlink_target || ""),
      };
    }
    const updated = formatFileDate(
      ref === "worktree" || ref === "" ? entry.updated_at : undefined,
      STATE.language,
    );
    const created = formatFileDate(entry.created_at, STATE.language);
    const hint = sortColumnLabels().updatedHint;
    const withCreated = created ? `${hint}\nCreated ${created}` : hint;
    if (browsable && updated)
      return { className: "meta", text: updated, title: withCreated };
    if (entry.type !== "blob")
      return { className: "meta", text: "-", title: hint };
    return { className: "meta", text: updated || "-", title: withCreated };
  }

  function repoEntryDateTime(entry: RepoTreeEntry, ref: string): number {
    const raw =
      REPO_SORT.key === "committed"
        ? entry.commit_updated_at
        : ref === "worktree" || ref === ""
          ? entry.updated_at
          : undefined;
    if (!raw) return -1;
    const time = new Date(raw).getTime();
    return Number.isNaN(time) ? -1 : time;
  }

  function sortedRepoEntries(
    entries: RepoTreeEntry[],
    ref = "worktree",
  ): RepoTreeEntry[] {
    const direction = REPO_SORT.direction === "asc" ? 1 : -1;
    return [...entries].sort((a, b) => {
      const aBrowsable = canBrowseRepoEntry(a, ref);
      const bBrowsable = canBrowseRepoEntry(b, ref);
      if (REPO_SORT.key === "name" && aBrowsable !== bBrowsable) {
        if (aBrowsable) return -1;
        if (bBrowsable) return 1;
      }
      let result = 0;
      if (REPO_SORT.key === "updated" || REPO_SORT.key === "committed") {
        const aTime = repoEntryDateTime(a, ref);
        const bTime = repoEntryDateTime(b, ref);
        if (aTime < 0 && bTime >= 0) return 1;
        if (bTime < 0 && aTime >= 0) return -1;
        result = aTime - bTime;
      } else if (REPO_SORT.key === "size") {
        if (a.size == null && b.size != null) return 1;
        if (b.size == null && a.size != null) return -1;
        result = (a.size ?? 0) - (b.size ?? 0);
      } else {
        result = a.name.localeCompare(b.name);
      }
      if (result === 0) result = a.name.localeCompare(b.name);
      return result * direction;
    });
  }

  /**
   * 同じファイルの HEAD を同時に何本も出さない。1 回の表示で、見出しの情報・
   * 表示の種類の判定・変化の検知 (app.ts の署名) が同じ URL を同時に 3 本
   * 出していた。終わった要求は覚えない (次に聞いたときは取り直す)。
   */
  const RAW_FILE_INFO_IN_FLIGHT = new Map<string, Promise<RawFileInfo>>();

  /** url を渡すと、その URL で聞く (別のプロジェクトのファイル。app.ts)。 */
  function loadRawFileInfo(
    target: SourceFileTarget,
    url: string = buildRawFileUrl(target),
  ): Promise<RawFileInfo> {
    const inFlight = RAW_FILE_INFO_IN_FLIGHT.get(url);
    if (inFlight) return inFlight;
    const request = requestRawFileInfo(target, url).finally(() => {
      if (RAW_FILE_INFO_IN_FLIGHT.get(url) === request)
        RAW_FILE_INFO_IN_FLIGHT.delete(url);
    });
    RAW_FILE_INFO_IN_FLIGHT.set(url, request);
    return request;
  }

  async function requestRawFileInfo(
    target: SourceFileTarget,
    url: string,
  ): Promise<RawFileInfo> {
    try {
      const res = await fetch(url, { method: "HEAD" });
      // 404 は「その ref にファイルが無い」という確定状態。取得失敗の {} と
      // 区別して返す (SSE 再描画ゲートが削除を変化として検知するため)。
      if (res.status === 404) return { missing: true };
      if (!res.ok) {
        // HEAD なので本文は無い。状態と対象を理由に残す。
        return {
          error:
            `HEAD ${target.path} (${target.ref}) failed: ${res.status} ${res.statusText}`.trim(),
        };
      }
      const rawSize = res.headers.get("content-length");
      const size = rawSize == null ? NaN : Number(rawSize);
      return {
        size: rawSize != null && Number.isFinite(size) ? size : undefined,
        type: res.headers.get("content-type") || undefined,
        created_at: res.headers.get("x-code-viewer-created-at") || undefined,
        updated_at: res.headers.get("x-code-viewer-updated-at") || undefined,
        commit_updated_at:
          res.headers.get("x-code-viewer-commit-updated-at") || undefined,
      };
    } catch (error) {
      const failure = errorWithCause(
        `could not read the details of ${target.path} (${target.ref})`,
        error,
      );
      console.error("[code-viewer] file details failed", failure);
      return { error: formatErrorDetail(failure) };
    }
  }

  function createFileDetailMeta(
    target: SourceFileTarget,
    meta: RawFileInfo,
  ): HTMLElement {
    const text = repoViewText(STATE.language);
    const items: Array<{ label: string; value: string }> = [
      {
        label: text.size,
        value: meta.size == null ? "" : formatBytes(meta.size),
      },
      {
        label: text.updated,
        value: formatFileDate(
          meta.updated_at || meta.commit_updated_at,
          STATE.language,
        ),
      },
      {
        label: text.created,
        value: formatFileDate(meta.created_at, STATE.language),
      },
    ];
    // 取れなかったことは「情報が無い」と区別して、ボタンの中に理由つきで出す。
    if (meta.error)
      items.push({ label: text.detailsFailed, value: meta.error });
    const shown = items.filter((item) => item.value);
    return templateElement(
      view.fileDetailMeta({
        label: text.fileDetails,
        failed: !!meta.error,
        items: shown,
        emptyPath: shown.length === 0 ? target.path : null,
      }),
    );
  }

  let repoLoadSequence = 0;
  function loadRepo(): Promise<void> {
    if (STATE.route.screen !== "repo") return Promise.resolve();
    const myLoad = ++repoLoadSequence;
    setStatus("refreshing");
    const routeRef = STATE.route.ref || "worktree";
    const routePath = STATE.route.path || "";
    const params = new URLSearchParams();
    params.set("ref", routeRef);
    if (routePath) params.set("path", routePath);
    appendScopeParams(params);
    return trackLoad<RepoTreeResponse>(
      fetch(`${apiUrl("tree")}?${params.toString()}`).then(async (r) => {
        if (!r.ok)
          throw errorWithCause(
            `Repository listing failed (${r.status}): ${routeRef}:${routePath}`,
            await r.text(),
          );
        return r.json();
      }),
    )
      .then(async (data) => {
        if (
          myLoad !== repoLoadSequence ||
          !isActiveRepoRoute(routeRef, routePath)
        )
          return;
        await renderRepo(data);
        setStatus("live");
        syncHeaderMenu();
      })
      .catch((error) => {
        if (
          myLoad !== repoLoadSequence ||
          !isActiveRepoRoute(routeRef, routePath)
        )
          return;
        if (isAbortError(error)) {
          setStatus(null);
          return;
        }
        setStatus("error");
        console.error(error);
        $("#diff").querySelector(".gdp-repo-error")?.remove();
        $("#diff").prepend(
          templateElement(view.error(formatErrorDetail(error))),
        );
      });
  }

  let creatingDirectory = false;

  function showTrashError(message: string) {
    void showAlertDialog({
      title: repoViewText(STATE.language).trashFailed,
      body: message,
    });
  }

  function showCreateDirectoryError(message: string) {
    void showAlertDialog({
      title: repoViewText(STATE.language).newFolderFailed,
      body: message,
    });
  }

  async function moveRepoPathToTrash(path: string) {
    const res = await fetch(apiUrl("trashPath"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Code-Viewer-Action": "1",
      },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) {
      showTrashError(
        await responseErrorMessage(res, `moving "${path}" to Trash`),
      );
      return false;
    }
    const body = (await res.json()) as { undo?: UndoActionResponse };
    if (body.undo) pushUndo(body.undo);
    return true;
  }

  async function uploadFiles(path: string, files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    const label = path || getProjectName() || repositoryRootFallback();
    const confirmText = uploadConfirmText(list.length, label);
    const ok = await showConfirmDialog({
      title: confirmText.title,
      body: confirmText.body,
      confirmLabel: confirmText.confirmLabel,
    });
    if (!ok) return;

    const form = new FormData();
    form.set("dir", path);
    list.forEach((file) => {
      form.append("files", file, file.name);
    });
    const res = await fetch(apiUrl("uploadFiles"), {
      method: "POST",
      headers: { "X-Code-Viewer-Action": "1" },
      body: form,
    });
    if (!res.ok)
      throw new Error(await responseErrorMessage(res, "uploading files"));
    invalidateRepoSidebar();
    await loadRepo();
  }

  function invalidateRepoSidebar() {
    setRepoSidebarRef(null);
    REPO_SIDEBAR_LOAD_REF = null;
    REPO_SIDEBAR_LOAD = null;
  }

  let REPO_SIDEBAR_LOAD_REF: string | null = null;
  let REPO_SIDEBAR_LOAD: Promise<void> | null = null;

  let REPO_SIDEBAR_REFRESHING = false;
  let REPO_SIDEBAR_REFRESH_QUEUED = false;

  // ファイル一覧をサーバーの最新ツリーに合わせる (再読み込みのボタン)。
  // invalidateRepoSidebar + 全再構築と違い、既存 DOM とスクロール位置を温存する。
  // 進行中に次の更新が来たら完了後にもう一度だけ走らせ、取りこぼさない。
  // 取り直せなかったら今のツリーは残し、失敗を投げる (ボタンが理由を出す)。
  async function refreshRepoSidebar(): Promise<void> {
    const project = projectGeneration;
    const ref = activeRepoTreeRef();
    if (ref == null) return;
    if (!isRepoSidebarReusable(ref)) {
      // 温存できる DOM が無いときだけ従来の全構築パスに任せる
      invalidateRepoSidebar();
      await renderRepoBlobSidebar(
        STATE.route.screen === "repo" ? STATE.route.path || "" : "",
        ref,
      );
      return;
    }
    if (REPO_SIDEBAR_REFRESHING) {
      REPO_SIDEBAR_REFRESH_QUEUED = true;
      return;
    }
    REPO_SIDEBAR_REFRESHING = true;
    try {
      const params = new URLSearchParams();
      params.set("ref", ref);
      params.set(...TREE_WITHOUT_COMMIT_DATES);
      appendScopeParams(params);
      const meta = await trackLoad<RepoTreeResponse>(
        fetch(`${apiUrl("tree")}?${params.toString()}`).then(async (r) => {
          if (!r.ok) {
            throw new Error(
              await responseErrorMessage(r, "refresh repository tree"),
            );
          }
          return r.json();
        }),
      );
      // fetch 中に ref 切替や画面遷移で前提が崩れていたら適用しない
      if (
        project !== projectGeneration ||
        !isActiveRepoTreeRef(ref) ||
        !isRepoSidebarReusable(ref)
      )
        return;
      await refreshRepoSidebarTree(
        repoTreeEntriesToSidebarItems(meta.entries, ref),
      );
    } catch (error) {
      if (project !== projectGeneration && isAbortError(error)) {
        console.info(
          "[code-viewer] repository refresh cancelled after project switch",
          error,
        );
        return;
      }
      throw errorWithCause(`refresh the file list (${ref})`, error);
    } finally {
      if (project === projectGeneration) {
        REPO_SIDEBAR_REFRESHING = false;
        if (REPO_SIDEBAR_REFRESH_QUEUED) {
          REPO_SIDEBAR_REFRESH_QUEUED = false;
          followRepoSidebar();
        }
      }
    }
  }

  // ファイルの変更の通知で、待たずにファイル一覧を合わせる。取り直しは次の
  // 通知か再読み込みのボタンで追いつくので、失敗は console に全文を残すだけ。
  function followRepoSidebar(): void {
    refreshRepoSidebar().catch((error: unknown) => {
      console.error("[code-viewer] file list refresh failed", error);
    });
  }

  return {
    loadRepo,
    createFileDetailMeta,
    createMoveToTrashButton,
    canTrashWorktreeRef,
    loadRawFileInfo,
    repoRoute,
    renderRepoBlobSidebar,
    ensureFileList,
    syncRepoTargetInput,
    handleSidebarContextMenu,
    invalidateRepoSidebar,
    resetProject() {
      projectGeneration++;
      REPO_SIDEBAR_REFRESHING = false;
      REPO_SIDEBAR_REFRESH_QUEUED = false;
      repoLoadSequence++;
      REPO_RENDER_SEQ++;
      REPO_RENDER_SIGNATURE = "";
      REPO_RENDER_LOCATION = "";
      RAW_FILE_INFO_IN_FLIGHT.clear();
      invalidateRepoSidebar();
    },
    refreshRepoSidebar,
    followRepoSidebar,
    showTrashError,
  };
}
