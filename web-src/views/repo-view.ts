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
  iconSvg,
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
    input.value = ref || "worktree";
    wrap.hidden = !(
      STATE.route.screen === "file" && STATE.route.view === "blob"
    );
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

  function closeRepoContextMenu() {
    document.querySelector<HTMLElement>(".gdp-context-menu")?.remove();
  }

  function closeTrashDialog() {
    document.querySelector<HTMLElement>(".gdp-trash-dialog-backdrop")?.remove();
  }

  function createTrashDialog(
    title: string,
    body: string,
    actions: HTMLElement[],
  ) {
    closeTrashDialog();
    const backdrop = document.createElement("div");
    backdrop.className = "gdp-trash-dialog-backdrop";
    const dialog = document.createElement("div");
    dialog.className = "gdp-trash-dialog";
    const titleId = "gdp-trash-dialog-title";
    const bodyId = "gdp-trash-dialog-body";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", titleId);
    dialog.setAttribute("aria-describedby", bodyId);
    const heading = document.createElement("div");
    heading.id = titleId;
    heading.className = "gdp-trash-dialog-title";
    heading.textContent = title;
    const message = document.createElement("div");
    message.id = bodyId;
    message.className = "gdp-trash-dialog-body";
    message.textContent = body;
    const actionRow = document.createElement("div");
    actionRow.className = "gdp-trash-dialog-actions";
    actionRow.append(...actions);
    dialog.append(heading, message, actionRow);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function confirmMoveToTrash(
    path: string,
    focusReturnTarget?: HTMLElement | null,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const previousFocus =
        focusReturnTarget || (document.activeElement as HTMLElement | null);
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "gdp-btn gdp-btn-sm";
      cancel.textContent = "Cancel";
      const move = document.createElement("button");
      move.type = "button";
      move.className = "gdp-btn gdp-btn-sm gdp-trash-dialog-danger";
      move.textContent = "Move to Trash";
      const done = (ok: boolean) => {
        document.removeEventListener("keydown", onKeydown);
        closeTrashDialog();
        previousFocus?.focus?.();
        resolve(ok);
      };
      const onKeydown = (event: KeyboardEvent) => {
        if (isImeComposing(event)) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          done(false);
          return;
        }
        if (event.key !== "Tab") return;
        const focusables = [cancel, move];
        const index = focusables.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        if (index < 0) {
          event.preventDefault();
          focusables[0].focus();
          return;
        }
        if (event.shiftKey && index <= 0) {
          event.preventDefault();
          focusables[focusables.length - 1].focus();
        } else if (!event.shiftKey && index === focusables.length - 1) {
          event.preventDefault();
          focusables[0].focus();
        }
      };
      cancel.addEventListener("click", () => done(false));
      move.addEventListener("click", () => done(true));
      const backdrop = createTrashDialog(
        "Move to Trash?",
        `Move "${path}" to Trash?`,
        [cancel, move],
      );
      backdrop.addEventListener("pointerdown", (event) => {
        if (event.target === backdrop) done(false);
      });
      document.addEventListener("keydown", onKeydown);
      cancel.focus();
    });
  }

  function askNewDirectoryName(
    path: string,
    focusReturnTarget?: HTMLElement | null,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const previousFocus =
        focusReturnTarget || (document.activeElement as HTMLElement | null);
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "gdp-btn gdp-btn-sm";
      cancel.textContent = "Cancel";
      const create = document.createElement("button");
      create.type = "button";
      create.className = "gdp-btn gdp-btn-sm";
      create.textContent = "Create";
      const input = document.createElement("input");
      input.className = "gdp-create-dir-input";
      input.type = "text";
      input.autocomplete = "off";
      input.placeholder = "Folder name";
      input.setAttribute("aria-label", "Folder name");
      const error = document.createElement("div");
      error.className = "gdp-create-dir-error";
      error.setAttribute("role", "alert");
      const syncValidity = () => {
        const valid = !!normalizeNewDirectoryName(input.value);
        create.disabled = !valid;
        error.textContent =
          input.value && !valid
            ? "Use a folder name without slashes, control characters, . or .."
            : "";
        return valid;
      };
      const done = (name: string | null) => {
        document.removeEventListener("keydown", onKeydown);
        closeTrashDialog();
        previousFocus?.focus?.();
        resolve(name);
      };
      const submit = () => {
        const name = normalizeNewDirectoryName(input.value);
        if (!name) {
          syncValidity();
          input.focus();
          return;
        }
        done(name);
      };
      const onKeydown = (event: KeyboardEvent) => {
        if (isImeComposing(event)) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          done(null);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          submit();
          return;
        }
        if (event.key !== "Tab") return;
        const focusables = [input, cancel, create];
        const index = focusables.indexOf(
          document.activeElement as HTMLInputElement | HTMLButtonElement,
        );
        if (index < 0) {
          event.preventDefault();
          focusables[0].focus();
          return;
        }
        if (event.shiftKey && index <= 0) {
          event.preventDefault();
          focusables[focusables.length - 1].focus();
        } else if (!event.shiftKey && index === focusables.length - 1) {
          event.preventDefault();
          focusables[0].focus();
        }
      };
      cancel.addEventListener("click", () => done(null));
      create.addEventListener("click", submit);
      input.addEventListener("input", syncValidity);
      create.disabled = true;
      const backdrop = createTrashDialog(
        "New Folder",
        `Create a folder in "${path || getProjectName() || "repository"}".`,
        [cancel, create],
      );
      const body = backdrop.querySelector<HTMLElement>(
        ".gdp-trash-dialog-body",
      );
      body?.append(input, error);
      backdrop.addEventListener("pointerdown", (event) => {
        if (event.target === backdrop) done(null);
      });
      document.addEventListener("keydown", onKeydown);
      input.focus();
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
    if (document.querySelector(".gdp-trash-dialog-backdrop")) return false;
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
    button.title = "move folder to Trash";
    button.setAttribute("aria-label", "move folder to Trash");
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
    button.title = "new folder";
    button.setAttribute("aria-label", "new folder");
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
    copy.textContent = `Drop files into ${path || getProjectName() || "repository"}`;

    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.hidden = true;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "gdp-btn gdp-btn-sm";
    button.textContent = "Upload files";
    button.addEventListener("click", () => input.click());
    const error = document.createElement("div");
    error.className = "gdp-upload-error";

    const fail = (message = "Upload failed") => {
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
          uploadError instanceof Error ? uploadError.message : "Upload failed",
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
          uploadError instanceof Error ? uploadError.message : "Upload failed",
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
    root.textContent = getProjectName() || "repository";
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
        "open this folder in OS",
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
      sortedRepoEntries(meta.entries).forEach((entry) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = `gdp-repo-row ${entry.type}`;
        const icon = document.createElement("span");
        icon.className =
          entry.type === "tree" ? "dir-icon" : "d2h-icon-wrapper";
        if (entry.type === "tree") setFolderIcon(icon, true);
        else icon.innerHTML = fileEntryIcon();
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = entry.name;
        const metaBlock = createRepoEntryMeta(entry);
        const size = createRepoEntrySize(entry);
        row.append(icon, name, metaBlock, size);
        row.addEventListener("click", () => {
          if (entry.type === "tree") {
            setRoute(repoRoute(meta.ref, entry.path));
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
        empty.textContent = "No files in this directory.";
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
      activateRepoSidebarPath(currentPath);
      return Promise.resolve();
    }
    if (REPO_SIDEBAR_LOAD && REPO_SIDEBAR_LOAD_REF === normalizedRef) {
      return REPO_SIDEBAR_LOAD.then(() => {
        if (!isActiveRepoTreeRef(normalizedRef)) return;
        if (!isRepoSidebarReusable(normalizedRef)) {
          invalidateRepoSidebar();
          return renderRepoBlobSidebar(currentPath, normalizedRef);
        }
        activateRepoSidebarPath(currentPath);
      });
    }
    const params = new URLSearchParams();
    params.set("ref", normalizedRef);
    params.set("recursive", "1");
    appendScopeParams(params);
    REPO_SIDEBAR_LOAD_REF = normalizedRef;
    const load = trackLoad<RepoTreeResponse>(
      fetch(`/_tree?${params.toString()}`).then((r) => {
        if (!r.ok) throw new Error("failed to load repository tree");
        return r.json();
      }),
    )
      .then((meta) => {
        if (!isActiveRepoTreeRef(normalizedRef)) return;
        const files = meta.entries.map(
          (entry, index) =>
            ({
              order: index + 1,
              path: entry.path,
              display_path: entry.path,
              type: entry.type,
              children_omitted: entry.children_omitted,
              children_omitted_reason: entry.children_omitted_reason,
            }) satisfies SidebarItem,
        );
        setRepoSidebarRef(normalizedRef);
        renderSidebar(files, (file) => {
          if (file.type === "tree") {
            setRoute(repoRoute(normalizedRef, file.path));
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
        activateRepoSidebarPath(currentPath);
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

  function activateRepoSidebarPath(currentPath: string) {
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

  function createRepoEntryMeta(entry: RepoTreeEntry): HTMLElement {
    const meta = document.createElement("span");
    meta.className = "meta";
    const updated = formatFileDate(entry.updated_at || entry.commit_updated_at);
    const created = formatFileDate(entry.created_at);
    if (entry.type === "tree" && updated) {
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

  function sortedRepoEntries(entries: RepoTreeEntry[]): RepoTreeEntry[] {
    const direction = REPO_SORT.direction === "asc" ? 1 : -1;
    return [...entries].sort((a, b) => {
      if (REPO_SORT.key === "name" && a.type !== b.type) {
        if (a.type === "tree") return -1;
        if (b.type === "tree") return 1;
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
    const columns: Array<{ key: RepoSortKey; label: string }> = [
      { key: "name", label: "Name" },
      { key: "updated", label: "Updated" },
      { key: "size", label: "Size" },
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
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "gdp-btn gdp-btn-sm";
    ok.textContent = "OK";
    ok.addEventListener("click", closeTrashDialog);
    createTrashDialog("Trash failed", message, [ok]);
    ok.focus();
  }

  function showCreateDirectoryError(message: string) {
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "gdp-btn gdp-btn-sm";
    ok.textContent = "OK";
    ok.addEventListener("click", closeTrashDialog);
    createTrashDialog("New folder failed", message, [ok]);
    ok.focus();
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
    const label = path || getProjectName() || "repository root";
    if (
      !window.confirm(
        "Upload " +
          list.length +
          " file" +
          (list.length === 1 ? "" : "s") +
          " into " +
          label +
          "?",
      )
    )
      return;

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
