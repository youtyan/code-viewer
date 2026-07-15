// Repository browsing view: tree listing, breadcrumbs, context menu,
// new-folder / move-to-trash actions, upload panel, and the repo blob
// sidebar. Extracted from app.ts as a deps-injected factory.

import { normalizeNewDirectoryName } from "../core/directory-name";
import {
  fileNameClipboardText,
  filePathClipboardText,
} from "../core/file-path-copy";
import {
  COPY_16_PATHS,
  FILE_16_PATH,
  GIT_BRANCH_16_PATH,
  iconSvg,
  LINK_16_PATH,
  PLUS_16_PATH,
  TRASH_16_PATH,
} from "../core/icons";
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
import { sidebarAncestorDirs } from "./sidebar";
import {
  showAlertDialog,
  showConfirmDialog,
  showPromptDialog,
} from "./ui-dialog";

export type RepoViewDeps = {
  setRoute(route: AppRoute, replace?: boolean): void;
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
  trackLoad: <T>(promise: Promise<T>) => Promise<T>;
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
  moveFolderToTrashTitle(): string;
  uploadButtonLabel(): string;
  dropFilesIntoCopy(target: string): string;
  uploadFailedMessage(): string;
  emptyDirectoryLabel(): string;
  uploadConfirmText(
    count: number,
    target: string,
  ): { title: string; body: string; confirmLabel: string };
  sortColumnLabels(): { name: string; updated: string; size: string };
  repositoryFallback(): string;
  repositoryRootFallback(): string;
  commitEntryMeta(submodule: RepoTreeEntry["submodule"]): {
    label: string;
    title: string;
  };
  fileBadge(status?: string): HTMLElement;
  $: <T extends Element = HTMLElement>(sel: string) => T;
  STATE: {
    route: AppRoute;
    files: { path: string }[];
    syntaxHighlight: boolean;
  };
};

export function createRepoView(deps: RepoViewDeps) {
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
    trackLoad,
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
    moveFolderToTrashTitle,
    uploadButtonLabel,
    dropFilesIntoCopy,
    uploadFailedMessage,
    emptyDirectoryLabel,
    uploadConfirmText,
    sortColumnLabels,
    repositoryFallback,
    repositoryRootFallback,
    commitEntryMeta,
    fileBadge,
  } = deps;

  type RepoSortKey = "name" | "updated" | "size";

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
    const filelist = document.querySelector<HTMLElement>("#filelist");
    if (!filelist || !getSidebarOnFileClick()) return false;
    return !!filelist.querySelector("[data-path], [data-dirpath]");
  }

  function syncRepoTargetInput(ref: string) {
    const input = document.querySelector<HTMLInputElement>("#repo-target");
    const wrap = document.querySelector<HTMLElement>("#repo-target-wrap");
    if (!input || !wrap) return;
    const activeRef = activeRepoTreeRef();
    input.value = activeRef || ref || "worktree";
    wrap.hidden = activeRef == null;
    wrap.style.display = activeRef == null ? "none" : "";
    syncSidebarHeaderHeight();
  }

  function activeRepoTreeRef(): string | null {
    const fileRef = repoFileTargetFromRoute();
    if (fileRef != null) return fileRef || "worktree";
    if (STATE.route.screen === "repo") return STATE.route.ref || "worktree";
    return null;
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

  function fileEntryIcon(): string {
    return iconSvg("octicon-file", FILE_16_PATH);
  }

  function commitEntryIcon(): string {
    return iconSvg("octicon-git-branch", GIT_BRANCH_16_PATH);
  }

  function symlinkEntryIcon(): string {
    return iconSvg("octicon-link", LINK_16_PATH);
  }

  function isWorktreeRef(ref: string): boolean {
    return canTrashWorktreeRef(ref);
  }

  function repoEntryTypeIcon(
    entry: RepoTreeEntry,
    browsable: boolean,
    nonBrowsableCommit: boolean,
  ): HTMLElement {
    const icon = document.createElement("span");
    icon.className = browsable
      ? "dir-icon"
      : nonBrowsableCommit
        ? "d2h-icon-wrapper gdp-repo-row-gitlink-icon"
        : "d2h-icon-wrapper";
    if (browsable) setFolderIcon(icon, true);
    else
      icon.innerHTML = entry.is_symlink
        ? symlinkEntryIcon()
        : entry.type === "commit"
          ? commitEntryIcon()
          : fileEntryIcon();
    return icon;
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

  function closeRepoContextMenu() {
    document.querySelector<HTMLElement>(".gdp-context-menu")?.remove();
  }

  function confirmMoveToTrash(
    path: string,
    focusReturnTarget?: HTMLElement | null,
  ): Promise<boolean> {
    return showConfirmDialog({
      title: "Move to Trash?",
      body: `Move "${path}" to Trash?`,
      confirmLabel: "Move to Trash",
      danger: true,
      focusReturnTarget,
    });
  }

  function askNewDirectoryName(
    path: string,
    focusReturnTarget?: HTMLElement | null,
  ): Promise<string | null> {
    return showPromptDialog({
      title: "New Folder",
      body: `Create a folder in "${path || getProjectName() || "repository"}".`,
      placeholder: "Folder name",
      ariaLabel: "Folder name",
      confirmLabel: "Create",
      validate: (v) => normalizeNewDirectoryName(v),
      invalidMessage:
        "Use a folder name without slashes, control characters, . or ..",
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
      const res = await fetch("/_create_directory", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify({ dir: path, name }),
      });
      if (!res.ok) {
        showCreateDirectoryError(
          `Failed to create "${name}": ${await res.text()}`,
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

  function createCopyPathButton(path: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gdp-file-header-icon gdp-copy-path";
    button.title = "copy folder path";
    button.setAttribute("aria-label", "copy folder path");
    button.innerHTML = iconSvg("octicon-copy", COPY_16_PATHS);
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(filePathClipboardText(path));
        button.classList.add("copied");
        setTimeout(() => {
          button.classList.remove("copied");
        }, 1200);
      } catch {
        button.classList.add("failed");
        setTimeout(() => {
          button.classList.remove("failed");
        }, 1200);
      }
    });
    return button;
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
    closeRepoContextMenu();

    const menu = document.createElement("div");
    menu.className = "gdp-context-menu";
    const anchor = event.target as Element | null;
    const focusReturnTarget = anchor?.closest<HTMLElement>("li, .gdp-repo-row");
    const anchorRect = anchor
      ?.closest<HTMLElement>("li, .gdp-repo-row")
      ?.getBoundingClientRect();
    const anchorX =
      event.clientX > 0
        ? event.clientX
        : anchorRect?.left || window.innerWidth / 2;
    const anchorY =
      event.clientY > 0
        ? event.clientY
        : anchorRect?.bottom || window.innerHeight / 2;
    menu.style.left = `${anchorX}px`;
    menu.style.top = `${anchorY}px`;

    const copyPath = document.createElement("button");
    copyPath.type = "button";
    copyPath.textContent = "Copy Path";
    copyPath.addEventListener("click", async () => {
      closeRepoContextMenu();
      await copyRepoContextText(filePathClipboardText(entry.path));
    });
    const copyName = document.createElement("button");
    copyName.type = "button";
    copyName.textContent = "Copy Name";
    copyName.addEventListener("click", async () => {
      closeRepoContextMenu();
      await copyRepoContextText(fileNameClipboardText(entry.path));
    });
    const createDir = document.createElement("button");
    createDir.type = "button";
    createDir.textContent = "New Folder...";
    createDir.addEventListener("click", async () => {
      closeRepoContextMenu();
      const targetPath =
        entry.type === "blob" ? parentRepoPath(entry.path) : entry.path;
      await requestCreateDirectory(targetPath, onChanged, {
        focusReturnTarget,
      });
    });
    const trash = document.createElement("button");
    trash.type = "button";
    trash.className = "danger";
    trash.textContent = "Move to Trash...";
    trash.addEventListener("click", async () => {
      closeRepoContextMenu();
      await requestMoveToTrash(entry.path, onChanged, { focusReturnTarget });
    });
    menu.append(copyPath, copyName, createDir, trash);
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const left = Math.min(anchorX, window.innerWidth - rect.width - 8);
    const top = Math.min(anchorY, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    return true;
  }

  function sidebarTrashEntryFromEvent(event: MouseEvent): {
    path: string;
    type?: string;
    children_omitted_reason?: string;
  } | null {
    if (!isRepositorySidebarMode()) return null;
    const row = (event.target as Element | null)?.closest<HTMLElement>(
      "#filelist li",
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

  function createMoveToTrashButton(path: string, onDeleted: () => void) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gdp-file-header-icon gdp-trash-path";
    const trashTitle = moveFolderToTrashTitle();
    button.title = trashTitle;
    button.setAttribute("aria-label", trashTitle);
    button.innerHTML = iconSvg("octicon-trash", TRASH_16_PATH);
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await requestMoveToTrash(path, onDeleted, { focusReturnTarget: button });
    });
    return button;
  }

  function createNewFolderButton(
    path: string,
    onCreated: (createdPath: string) => void,
  ) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gdp-file-header-icon gdp-create-dir";
    const newFolderTitle = newFolderButtonTitle();
    button.title = newFolderTitle;
    button.setAttribute("aria-label", newFolderTitle);
    button.innerHTML = iconSvg("octicon-plus", PLUS_16_PATH);
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await requestCreateDirectory(path, onCreated, {
        focusReturnTarget: button,
      });
    });
    return button;
  }

  function createRepoUploadPanel(path: string): HTMLElement {
    const dropPanel = document.createElement("div");
    dropPanel.className = "gdp-upload-panel";

    const copy = document.createElement("div");
    copy.className = "gdp-upload-copy";
    copy.textContent = dropFilesIntoCopy(
      path || getProjectName() || repositoryFallback(),
    );

    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.hidden = true;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "gdp-btn gdp-btn-sm";
    button.textContent = uploadButtonLabel();
    button.addEventListener("click", () => input.click());
    const error = document.createElement("div");
    error.className = "gdp-upload-error";

    const fail = (message = uploadFailedMessage()) => {
      error.textContent = message;
      dropPanel.classList.add("failed");
      setTimeout(() => dropPanel.classList.remove("failed"), 1600);
    };

    input.addEventListener("change", async () => {
      try {
        if (input.files?.length) await uploadFiles(path, input.files);
        error.textContent = "";
      } catch (uploadError) {
        fail(
          uploadError instanceof Error
            ? uploadError.message
            : uploadFailedMessage(),
        );
      } finally {
        input.value = "";
      }
    });

    dropPanel.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropPanel.classList.add("dragging");
    });
    dropPanel.addEventListener("dragleave", () =>
      dropPanel.classList.remove("dragging"),
    );
    dropPanel.addEventListener("drop", async (event) => {
      event.preventDefault();
      dropPanel.classList.remove("dragging");
      try {
        const files = event.dataTransfer?.files;
        if (files?.length) await uploadFiles(path, files);
        error.textContent = "";
      } catch (uploadError) {
        fail(
          uploadError instanceof Error
            ? uploadError.message
            : uploadFailedMessage(),
        );
      }
    });

    dropPanel.append(copy, button, input, error);
    return dropPanel;
  }

  function repoRoute(ref: string, path: string): AppRoute {
    return {
      screen: "repo",
      ref: ref || "worktree",
      path,
      range: currentRange(),
    };
  }

  function createRepoBreadcrumb(target: string, path: string): HTMLElement {
    const nav = document.createElement("nav");
    nav.className = "gdp-file-breadcrumb gdp-repo-breadcrumb";
    const root = document.createElement("button");
    root.type = "button";
    root.className = path
      ? "gdp-file-breadcrumb-part"
      : "gdp-file-breadcrumb-current";
    root.textContent = getProjectName() || repositoryFallback();
    root.addEventListener("click", () => {
      setRoute(repoRoute(target, ""));
      loadRepo();
    });
    nav.appendChild(root);
    const parts = path ? path.split("/") : [];
    parts.forEach((part, index) => {
      const sep = document.createElement("span");
      sep.className = "gdp-file-breadcrumb-sep";
      sep.textContent = "/";
      nav.appendChild(sep);
      const currentPath = parts.slice(0, index + 1).join("/");
      const button = document.createElement("button");
      button.type = "button";
      button.className =
        index === parts.length - 1
          ? "gdp-file-breadcrumb-current"
          : "gdp-file-breadcrumb-part";
      button.textContent = part;
      button.disabled = index === parts.length - 1;
      button.addEventListener("click", () => {
        setRoute(repoRoute(target, currentPath));
        loadRepo();
      });
      nav.appendChild(button);
    });
    return nav;
  }

  async function renderRepo(meta: RepoTreeResponse) {
    setProjectName(meta.project || "");
    setPageMode();
    removeStandaloneSource();
    $("#empty").classList.add("hidden");
    $("#diff").replaceChildren();
    if (!isRepoSidebarReusable(meta.ref)) $("#totals").textContent = "";
    STATE.files = [];
    clearLoadQueue();
    renderRepoBlobSidebar(meta.path || "", meta.ref);

    const target = $("#diff");
    const shell = document.createElement("section");
    shell.className = "gdp-repo-shell";

    const toolbar = document.createElement("div");
    toolbar.className = "gdp-file-detail-header gdp-repo-toolbar";
    const pathHeader = document.createElement("div");
    pathHeader.className = "gdp-file-detail-path";
    pathHeader.appendChild(createRepoBreadcrumb(meta.ref, meta.path || ""));
    if (meta.path) pathHeader.appendChild(createCopyPathButton(meta.path));
    pathHeader.appendChild(
      createOpenPathButton(
        meta.path || "",
        "directory",
        openDirectoryInOsTitle(),
      ),
    );
    toolbar.appendChild(pathHeader);
    if (canTrashWorktreeRef(meta.ref)) {
      toolbar.appendChild(
        createNewFolderButton(meta.path || "", () => loadRepo()),
      );
      if (meta.path) {
        toolbar.appendChild(
          createMoveToTrashButton(meta.path, () => {
            const parent = meta.path.split("/").slice(0, -1).join("/");
            setRoute(repoRoute(meta.ref, parent));
            loadRepo();
          }),
        );
      }
    }
    shell.appendChild(toolbar);

    const listCard = document.createElement("section");
    listCard.className = "gdp-file-shell loaded gdp-repo-list-shell";
    const listWrapper = document.createElement("div");
    listWrapper.className = "d2h-file-wrapper";
    if (meta.ref === "worktree" || meta.ref === "") {
      listWrapper.appendChild(createRepoUploadPanel(meta.path || ""));
    }
    const sortHost = document.createElement("div");
    sortHost.className = "gdp-repo-sort-host";
    const list = document.createElement("div");
    list.className = "gdp-source-viewer gdp-repo-file-list";
    const renderRepoRows = (focusSortKey?: RepoSortKey) => {
      sortHost.replaceChildren(createRepoSortHeader(renderRepoRows));
      if (focusSortKey) {
        sortHost
          .querySelector<HTMLButtonElement>(
            `[data-repo-sort="${focusSortKey}"]`,
          )
          ?.focus();
      }
      list.replaceChildren();
      if (meta.path) {
        const parent = meta.path.split("/").slice(0, -1).join("/");
        const row = document.createElement("button");
        row.type = "button";
        row.className = "gdp-repo-row parent";
        const parentIcon = document.createElement("span");
        parentIcon.className = "dir-icon";
        setFolderIcon(parentIcon, false);
        const parentName = document.createElement("span");
        parentName.className = "name";
        parentName.textContent = "..";
        const parentKind = document.createElement("span");
        parentKind.className = "meta";
        parentKind.textContent = "";
        const parentSize = document.createElement("span");
        parentSize.className = "size";
        row.append(parentIcon, parentName, parentKind, parentSize);
        row.addEventListener("click", () => {
          setRoute(repoRoute(meta.ref, parent));
          loadRepo();
        });
        list.appendChild(row);
      }
      sortedRepoEntries(meta.entries, meta.ref).forEach((entry) => {
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
        const row = document.createElement("button");
        row.type = "button";
        row.className = nonBrowsableCommit
          ? `gdp-repo-row ${entry.type} gdp-repo-row-gitlink`
          : entry.is_symlink
            ? `gdp-repo-row ${entry.type} symlink-row${brokenSymlink ? " symlink-broken-row gdp-row-disabled" : ""}`
            : `gdp-repo-row ${entry.type}`;
        if (deletedEntry) row.classList.add("gdp-row-disabled");
        // A pending git change wins over the type icon, same precedence as
        // sidebar.ts createTreeFileRow uses for the diff view.
        const icon = entry.status
          ? fileBadge(entry.status)
          : repoEntryTypeIcon(entry, browsable, nonBrowsableCommit);
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = entry.name;
        if (nonBrowsableCommit) {
          row.title = commitEntryMeta(entry.submodule).title;
          row.setAttribute("aria-disabled", "true");
        } else if (brokenSymlink || deletedEntry) {
          row.setAttribute("aria-disabled", "true");
        }
        const metaBlock = createRepoEntryMeta(entry, browsable);
        const size = createRepoEntrySize(entry);
        row.append(icon, name, metaBlock, size);
        row.addEventListener("click", () => {
          if (brokenSymlink || deletedEntry) return;
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
        });
        row.addEventListener("contextmenu", (event) =>
          showRepoContextMenu(event, entry, meta.ref, () => loadRepo()),
        );
        list.appendChild(row);
      });
      if (!meta.entries.length) {
        const empty = document.createElement("div");
        empty.className = "gdp-repo-empty";
        empty.textContent = emptyDirectoryLabel();
        list.appendChild(empty);
      }
    };
    listWrapper.appendChild(sortHost);
    renderRepoRows();
    listWrapper.appendChild(list);
    listCard.appendChild(listWrapper);
    shell.appendChild(listCard);

    if (meta.readme?.text) {
      const readme = document.createElement("section");
      readme.className = "gdp-file-shell loaded gdp-repo-readme";
      const wrapper = document.createElement("div");
      wrapper.className = "d2h-file-wrapper";
      const readmeHeader = document.createElement("div");
      readmeHeader.className = "d2h-file-header";
      const nameWrapper = document.createElement("div");
      nameWrapper.className = "d2h-file-name-wrapper";
      const icon = document.createElement("span");
      icon.className = "d2h-icon-wrapper";
      icon.innerHTML = iconSvg("octicon-file", FILE_16_PATH);
      const name = document.createElement("span");
      name.className = "d2h-file-name";
      name.textContent = meta.readme.path;
      nameWrapper.append(icon, name);
      readmeHeader.appendChild(nameWrapper);
      wrapper.appendChild(readmeHeader);
      try {
        wrapper.appendChild(
          await renderMarkdownPreview(
            meta.readme.text,
            { path: meta.readme.path, ref: meta.ref },
            {
              syntaxHighlight: STATE.syntaxHighlight,
              onNavigateMarkdown: (path, ref) => {
                setRoute({
                  screen: "file",
                  path,
                  ref,
                  view: "blob",
                  range: currentRange(),
                });
                renderStandaloneSource({ path, ref });
              },
            },
          ),
        );
      } catch {
        const fallback = document.createElement("pre");
        fallback.className = "gdp-markdown-fallback";
        fallback.textContent = meta.readme.text;
        wrapper.appendChild(fallback);
      }
      readme.appendChild(wrapper);
      shell.appendChild(readme);
    }

    target.appendChild(shell);
    placeSidebarToggle();
  }

  function renderRepoBlobSidebar(currentPath: string, ref: string) {
    syncRepoTargetInput(ref);
    const normalizedRef = ref || "worktree";
    if (!isActiveRepoTreeRef(normalizedRef)) return Promise.resolve();
    if (isRepoSidebarReusable(normalizedRef)) {
      return activateRepoSidebarPath(currentPath);
    }
    if (REPO_SIDEBAR_LOAD && REPO_SIDEBAR_LOAD_REF === normalizedRef) {
      return REPO_SIDEBAR_LOAD.then(() => {
        if (!isActiveRepoTreeRef(normalizedRef)) return;
        if (!isRepoSidebarReusable(normalizedRef)) {
          invalidateRepoSidebar();
          return renderRepoBlobSidebar(currentPath, normalizedRef);
        }
        return activateRepoSidebarPath(currentPath);
      });
    }
    const params = new URLSearchParams();
    params.set("ref", normalizedRef);
    appendScopeParams(params);
    REPO_SIDEBAR_LOAD_REF = normalizedRef;
    const load = trackLoad<RepoTreeResponse>(
      fetch(`/_tree?${params.toString()}`).then((r) => {
        if (!r.ok) throw new Error("failed to load repository tree");
        return r.json();
      }),
    )
      .then(async (meta) => {
        if (!isActiveRepoTreeRef(normalizedRef)) return;
        const files = meta.entries.map(
          (entry, index) =>
            ({
              order: index + 1,
              path: entry.path,
              display_path: entry.path,
              type: canBrowseRepoEntry(entry, normalizedRef)
                ? "tree"
                : entry.type,
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
        setRepoSidebarRef(normalizedRef);
        renderSidebar(files, (file) => {
          if (file.type === "tree") {
            // See the click handler above: a committed-ref directory
            // symlink navigates via resolved_path, not its own path.
            setRoute(repoRoute(normalizedRef, file.resolved_path ?? file.path));
            loadRepo();
            return;
          }
          setRoute({
            screen: "file",
            path: file.path,
            ref: normalizedRef,
            view: "blob",
            range: currentRange(),
          });
          renderStandaloneSource({ path: file.path, ref: normalizedRef });
        });
        await activateRepoSidebarPath(currentPath);
      })
      .catch(() => {
        if (!isActiveRepoTreeRef(normalizedRef)) return;
        setRepoSidebarRef(null);
        renderSidebar([], undefined);
        $("#totals").textContent = "Cannot load tree";
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

  async function loadRepoSidebarAncestors(currentPath: string) {
    let loaded = false;
    for (const dirPath of sidebarAncestorDirs(currentPath)) {
      const row = getSidebarRowByPath(dirPath);
      if (row?.kind !== "dir" || !row.dir) continue;
      if (!shouldLazyLoadSidebarDir(row.dir)) continue;
      await ensureVirtualSidebarDirLoaded(row.dir);
      loaded = true;
    }
    if (loaded) rerenderVirtualSidebar();
  }

  async function activateRepoSidebarPath(currentPath: string) {
    await loadRepoSidebarAncestors(currentPath);
    markActive(currentPath, { reveal: true });
    applyFilter();
    const row = getSidebarRowByPath(currentPath);
    if (row?.kind === "dir" && row.dir && shouldLazyLoadSidebarDir(row.dir))
      ensureVirtualSidebarDirLoaded(row.dir).then(() => {
        if (getSidebarVirtualActivePath() === currentPath) {
          rerenderVirtualSidebar();
          scrollVirtualSidebarPathIntoView(currentPath);
        }
      });
  }

  function createRepoEntryMeta(
    entry: RepoTreeEntry,
    browsable: boolean,
  ): HTMLElement {
    const meta = document.createElement("span");
    meta.className = "meta";
    if (entry.type === "commit" && !browsable) {
      meta.classList.add("gdp-repo-row-gitlink-badge");
      const badge = commitEntryMeta(entry.submodule);
      meta.textContent = badge.label;
      meta.title = badge.title;
      return meta;
    }
    // A symlink destination is more useful at a glance than its mtime -
    // show it in place of the usual updated/created date.
    if (entry.is_symlink) {
      const broken = entry.symlink_target_type === "missing";
      meta.classList.add("symlink-target");
      if (broken) meta.classList.add("broken");
      meta.textContent = `→ ${entry.symlink_target || "?"}`;
      meta.title = broken
        ? `Broken symlink → ${entry.symlink_target || ""}`
        : `Symlink → ${entry.symlink_target || ""}`;
      return meta;
    }
    const updated = formatFileDate(entry.updated_at || entry.commit_updated_at);
    const created = formatFileDate(entry.created_at);
    if (browsable && updated) {
      meta.textContent = updated;
      if (created) meta.title = `Created ${created}`;
      return meta;
    }
    if (entry.type !== "blob") {
      meta.textContent = "-";
      return meta;
    }
    meta.textContent = updated ? updated : created ? created : "-";
    if (created) meta.title = `Created ${created}`;
    return meta;
  }

  function createRepoEntrySize(entry: RepoTreeEntry): HTMLElement {
    const size = document.createElement("span");
    size.className = "size";
    size.textContent =
      entry.type === "blob" && entry.size != null
        ? formatBytes(entry.size)
        : "";
    return size;
  }

  function repoEntryUpdatedTime(entry: RepoTreeEntry): number {
    const raw = entry.updated_at || entry.commit_updated_at || entry.created_at;
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
      if (REPO_SORT.key === "updated") {
        const aTime = repoEntryUpdatedTime(a);
        const bTime = repoEntryUpdatedTime(b);
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

  function createRepoSortHeader(
    onSortChange: (focusSortKey?: RepoSortKey) => void,
  ): HTMLElement {
    const header = document.createElement("div");
    header.className = "gdp-repo-sort-header";
    const spacer = document.createElement("span");
    spacer.className = "gdp-repo-sort-spacer";
    header.appendChild(spacer);
    const sortLabels = sortColumnLabels();
    const columns: Array<{ key: RepoSortKey; label: string }> = [
      { key: "name", label: sortLabels.name },
      { key: "updated", label: sortLabels.updated },
      { key: "size", label: sortLabels.size },
    ];
    columns.forEach((column) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.repoSort = column.key;
      button.textContent =
        column.label +
        (REPO_SORT.key === column.key
          ? REPO_SORT.direction === "asc"
            ? " ↑"
            : " ↓"
          : "");
      button.className = REPO_SORT.key === column.key ? "active" : "";
      button.addEventListener("click", () => {
        if (REPO_SORT.key === column.key) {
          REPO_SORT.direction = REPO_SORT.direction === "asc" ? "desc" : "asc";
        } else {
          REPO_SORT = {
            key: column.key,
            direction: column.key === "name" ? "asc" : "desc",
          };
        }
        onSortChange(column.key);
      });
      header.appendChild(button);
    });
    return header;
  }

  async function loadRawFileInfo(
    target: SourceFileTarget,
  ): Promise<RawFileInfo> {
    try {
      const res = await fetch(buildRawFileUrl(target), { method: "HEAD" });
      if (!res.ok) return {};
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
    } catch {
      return {};
    }
  }

  function createFileDetailMeta(
    target: SourceFileTarget,
    meta: RawFileInfo,
  ): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "gdp-file-detail-meta";
    const addItem = (label: string, value: string) => {
      if (!value) return;
      const item = document.createElement("span");
      item.className = "gdp-file-detail-meta-item";
      const labelEl = document.createElement("span");
      labelEl.className = "label";
      labelEl.textContent = label;
      const valueEl = document.createElement("span");
      valueEl.className = "value";
      valueEl.textContent = value;
      item.append(labelEl, valueEl);
      wrap.appendChild(item);
    };
    addItem("Size", meta.size == null ? "" : formatBytes(meta.size));
    addItem(
      "Updated",
      formatFileDate(meta.updated_at || meta.commit_updated_at),
    );
    addItem("Created", formatFileDate(meta.created_at));
    if (!wrap.childElementCount) {
      wrap.hidden = true;
      wrap.dataset.path = target.path;
    }
    return wrap;
  }

  function loadRepo(): Promise<void> {
    if (STATE.route.screen !== "repo") return Promise.resolve();
    setStatus("refreshing");
    const routeRef = STATE.route.ref || "worktree";
    const routePath = STATE.route.path || "";
    const params = new URLSearchParams();
    params.set("ref", routeRef);
    if (routePath) params.set("path", routePath);
    appendScopeParams(params);
    return trackLoad<RepoTreeResponse>(
      fetch(`/_tree?${params.toString()}`).then((r) => {
        if (!r.ok) throw new Error("failed to load repository tree");
        return r.json();
      }),
    )
      .then(async (data) => {
        if (!isActiveRepoRoute(routeRef, routePath)) return;
        await renderRepo(data);
        setStatus("live");
        syncHeaderMenu();
      })
      .catch(() => {
        if (!isActiveRepoRoute(routeRef, routePath)) return;
        setStatus("error");
      });
  }

  let creatingDirectory = false;

  function showTrashError(message: string) {
    void showAlertDialog({ title: "Trash failed", body: message });
  }

  function showCreateDirectoryError(message: string) {
    void showAlertDialog({ title: "New folder failed", body: message });
  }

  async function moveRepoPathToTrash(path: string) {
    const res = await fetch("/_trash_path", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Code-Viewer-Action": "1",
      },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) {
      showTrashError(`Failed to move "${path}" to Trash: ${await res.text()}`);
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
    const res = await fetch("/_upload_files", {
      method: "POST",
      headers: { "X-Code-Viewer-Action": "1" },
      body: form,
    });
    if (!res.ok) throw new Error(await res.text());
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

  return {
    loadRepo,
    createFileDetailMeta,
    createMoveToTrashButton,
    canTrashWorktreeRef,
    loadRawFileInfo,
    repoRoute,
    renderRepoBlobSidebar,
    syncRepoTargetInput,
    closeRepoContextMenu,
    handleSidebarContextMenu,
    fileEntryIcon,
    invalidateRepoSidebar,
    showTrashError,
  };
}
