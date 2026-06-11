// Search palette (Ctrl+K file / Ctrl+G grep): overlay UI, ranked file
// matching, repo-wide grep, and result navigation. Extracted from app.ts.

import {
  getPanelFocusScope,
  type PanelFocusScope,
  restorePanelFocusScope,
  setPanelFocusScope,
} from "../core/focus-scope";
import {
  type FuzzyRange,
  fuzzyMatchPath,
  globMatchPath,
  isGlobPathQuery,
  rankPathMatches,
} from "../core/fuzzy-search";
import type { AppRoute } from "../core/routes";
import { limitPaletteResults, movePaletteSelection } from "../core/search-palette";
import type { FileMeta, FileSearchListResponse, GrepResponse } from "../core/types";

export type SearchPaletteDeps = {
  setRoute(route: AppRoute, replace?: boolean): void;
  currentRange(): { from: string; to: string };
  appendScopeParams(params: URLSearchParams): void;
  isAbortError(err: unknown): boolean;
  scrollToFile(path: string, line?: unknown): void;
  applySourceRouteToShell(): void;
  fileSourceTarget(file: FileMeta): { path: string; ref: string };
  renderStandaloneSource(target: {
    path: string;
    ref: string;
  }): Promise<unknown>;
  repoFileCacheKey(ref: string): string;
  trackLoad: <T>(promise: Promise<T>) => Promise<T>;
  getServerGeneration(): number;
  STATE: {
    route: AppRoute;
    files: FileMeta[];
    repoRef: string;
    to: string;
  };
};

export function createSearchPalette(deps: SearchPaletteDeps) {
  const {
    STATE,
    setRoute,
    currentRange,
    appendScopeParams,
    isAbortError,
    scrollToFile,
    applySourceRouteToShell,
    fileSourceTarget,
    renderStandaloneSource,
    repoFileCacheKey,
    trackLoad,
    getServerGeneration,
  } = deps;

  type PaletteMode = "file" | "grep";
  type PaletteFileItem = {
    kind: "file";
    path: string;
    old_path?: string;
    displayPath: string;
    ref: string;
    targetPath?: string;
    targetRef?: string;
    source: "diff" | "repo";
    ranges: FuzzyRange[];
  };
  type PaletteGrepItem = {
    kind: "grep";
    path: string;
    line: number;
    column: number;
    preview: string;
    ref: string;
    source: "diff" | "repo";
  };
  type PaletteItem = PaletteFileItem | PaletteGrepItem;
  type PaletteState = {
    root: HTMLElement;
    input: HTMLInputElement;
    controls: HTMLElement;
    list: HTMLElement;
    status: HTMLElement;
    mode: PaletteMode;
    grepRegex: boolean;
    selected: number;
    items: PaletteItem[];
    composing: boolean;
    controller?: AbortController;
    debounce?: number;
    diffSnapshot: FileMeta[];
    previousFocusScope: PanelFocusScope | null;
  };
  let PALETTE: PaletteState | null = null;
  const REPO_FILE_CACHE = new Map<string, FileSearchListResponse>();

  function paletteSource(): "diff" | "repo" {
    if (STATE.route.screen === "diff") return "diff";
    if (STATE.route.screen === "file" && STATE.route.view !== "blob")
      return "diff";
    return "repo";
  }

  function paletteRef(source: "diff" | "repo"): string {
    if (source === "diff")
      return STATE.to && STATE.to !== "worktree" ? STATE.to : "worktree";
    if (STATE.route.screen === "repo") return STATE.route.ref || "worktree";
    if (STATE.route.screen === "file") return STATE.route.ref || "worktree";
    return STATE.repoRef || "worktree";
  }

  function closeSearchPalette() {
    if (!PALETTE) return;
    const previousFocusScope = PALETTE.previousFocusScope;
    PALETTE.controller?.abort();
    if (PALETTE.debounce) window.clearTimeout(PALETTE.debounce);
    PALETTE.root.remove();
    PALETTE = null;
    restorePanelFocusScope(previousFocusScope);
  }

  function createPalette(mode: PaletteMode): PaletteState {
    const previousFocusScope = PALETTE
      ? PALETTE.previousFocusScope
      : getPanelFocusScope();
    closeSearchPalette();
    const root = document.createElement("div");
    root.className = "gdp-palette-backdrop";
    const dialog = document.createElement("div");
    dialog.className = "gdp-palette";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const label = document.createElement("div");
    label.className = "gdp-palette-label";
    label.textContent = mode === "file" ? "Files" : "Grep";
    const input = document.createElement("input");
    input.className = "gdp-palette-input";
    input.type = "search";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = mode === "file" ? "Search files" : "Search text";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", "gdp-palette-list");
    const status = document.createElement("div");
    status.className = "gdp-palette-status";
    const controls = document.createElement("div");
    controls.className = "gdp-palette-controls";
    const list = document.createElement("div");
    list.id = "gdp-palette-list";
    list.className = "gdp-palette-list";
    list.setAttribute("role", "listbox");
    dialog.append(label, input, controls, status, list);
    root.appendChild(dialog);
    document.body.appendChild(root);
    const state: PaletteState = {
      root,
      input,
      controls,
      list,
      status,
      mode,
      grepRegex: false,
      selected: -1,
      items: [],
      composing: false,
      diffSnapshot: [...STATE.files],
      previousFocusScope,
    };
    PALETTE = state;
    setPanelFocusScope(null);
    root.addEventListener("mousedown", (e) => {
      if (e.target === root) closeSearchPalette();
    });
    input.addEventListener("compositionstart", () => {
      state.composing = true;
    });
    input.addEventListener("compositionend", () => {
      state.composing = false;
    });
    input.addEventListener("input", () => updatePaletteResults(state));
    input.addEventListener("keydown", (e) => handlePaletteKeydown(e, state));
    input.focus();
    updatePaletteResults(state);
    return state;
  }

  function renderPaletteControls(state: PaletteState) {
    state.controls.innerHTML = "";
    if (state.mode === "file") {
      const hint = document.createElement("span");
      hint.className = "gdp-palette-mode-hint";
      hint.textContent = isGlobPathQuery(state.input.value)
        ? "Glob: * ? []"
        : "Fuzzy path search";
      state.controls.appendChild(hint);
      return;
    }
    const plain = document.createElement("button");
    plain.type = "button";
    plain.className = "gdp-palette-mode-button";
    plain.setAttribute("aria-pressed", String(!state.grepRegex));
    plain.textContent = "Plain";
    plain.addEventListener("mousedown", (e) => {
      e.preventDefault();
      state.grepRegex = false;
      renderPaletteControls(state);
      updatePaletteResults(state);
      state.input.focus();
    });
    const regex = document.createElement("button");
    regex.type = "button";
    regex.className = "gdp-palette-mode-button";
    regex.setAttribute("aria-pressed", String(state.grepRegex));
    regex.textContent = ".* Regex";
    regex.title = "Alt+R";
    regex.addEventListener("mousedown", (e) => {
      e.preventDefault();
      state.grepRegex = true;
      renderPaletteControls(state);
      updatePaletteResults(state);
      state.input.focus();
    });
    const hint = document.createElement("span");
    hint.className = "gdp-palette-mode-hint";
    hint.textContent = "Alt+R toggles regex";
    state.controls.append(plain, regex, hint);
  }

  function regexQueryIsValid(query: string): boolean {
    try {
      new RegExp(query);
      return true;
    } catch {
      return false;
    }
  }

  function appendHighlightedPath(
    parent: HTMLElement,
    path: string,
    ranges: FuzzyRange[],
  ) {
    let cursor = 0;
    for (const range of ranges) {
      if (range.start > cursor)
        parent.appendChild(
          document.createTextNode(path.slice(cursor, range.start)),
        );
      const mark = document.createElement("mark");
      mark.textContent = path.slice(range.start, range.end);
      parent.appendChild(mark);
      cursor = range.end;
    }
    if (cursor < path.length)
      parent.appendChild(document.createTextNode(path.slice(cursor)));
  }

  function renderPalette(state: PaletteState) {
    state.list.innerHTML = "";
    state.items.forEach((item, index) => {
      const row = document.createElement("button");
      row.type = "button";
      row.id = `gdp-palette-item-${index}`;
      row.className = "gdp-palette-row";
      row.setAttribute("role", "option");
      row.setAttribute(
        "aria-selected",
        index === state.selected ? "true" : "false",
      );
      const title = document.createElement("span");
      title.className = "gdp-palette-row-title";
      const detail = document.createElement("span");
      detail.className = "gdp-palette-row-detail";
      if (item.kind === "file") {
        title.textContent = item.path.split("/").pop() || item.path;
        appendHighlightedPath(detail, item.displayPath, item.ranges);
        if (item.old_path && item.displayPath !== item.old_path) {
          detail.appendChild(document.createTextNode(`  ${item.old_path}`));
        }
      } else {
        title.textContent = `${item.path}:${item.line}`;
        detail.textContent = item.preview;
      }
      row.append(title, detail);
      row.addEventListener("mouseenter", () => {
        state.selected = index;
        syncPaletteSelection(state);
      });
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        state.selected = index;
        selectPaletteItem(state);
      });
      state.list.appendChild(row);
    });
    syncPaletteSelection(state);
  }

  function syncPaletteSelection(state: PaletteState) {
    state.input.setAttribute(
      "aria-activedescendant",
      state.selected >= 0 ? `gdp-palette-item-${state.selected}` : "",
    );
    state.list
      .querySelectorAll<HTMLElement>(".gdp-palette-row")
      .forEach((row, index) => {
        row.setAttribute(
          "aria-selected",
          index === state.selected ? "true" : "false",
        );
        if (index === state.selected) row.scrollIntoView({ block: "nearest" });
      });
  }

  async function repoPaletteFiles(
    ref: string,
  ): Promise<FileSearchListResponse> {
    const cacheKey = repoFileCacheKey(ref);
    const cached = REPO_FILE_CACHE.get(cacheKey);
    if (cached && cached.generation === getServerGeneration()) return cached;
    const params = new URLSearchParams();
    params.set("ref", ref);
    appendScopeParams(params);
    const res = await trackLoad<FileSearchListResponse>(
      fetch(`/_files?${params.toString()}`).then((r) => {
        if (!r.ok) throw new Error("failed to load files");
        return r.json();
      }),
    );
    REPO_FILE_CACHE.set(cacheKey, res);
    return res;
  }

  function diffFilePaletteItems(
    state: PaletteState,
    query: string,
  ): PaletteFileItem[] {
    const matchPath = isGlobPathQuery(query) ? globMatchPath : fuzzyMatchPath;
    const candidates = state.diffSnapshot
      .map((file) => {
        const current = matchPath(query, file.path);
        const old = file.old_path ? matchPath(query, file.old_path) : null;
        const best =
          old && (!current || old.score > current.score)
            ? { match: old, displayPath: file.old_path || file.path }
            : current
              ? { match: current, displayPath: file.path }
              : null;
        return best ? { file, ...best } : null;
      })
      .filter(
        (
          item,
        ): item is {
          file: FileMeta;
          match: { score: number; ranges: FuzzyRange[] };
          displayPath: string;
        } => item !== null,
      )
      .sort(
        (a, b) =>
          b.match.score - a.match.score ||
          a.file.path.localeCompare(b.file.path),
      );
    return limitPaletteResults(candidates).map((candidate) => ({
      kind: "file",
      path: candidate.file.path,
      old_path: candidate.file.old_path,
      displayPath: candidate.displayPath,
      ref: paletteRef("diff"),
      targetPath: fileSourceTarget(candidate.file).path,
      targetRef: fileSourceTarget(candidate.file).ref,
      source: "diff",
      ranges: candidate.match.ranges,
    }));
  }

  async function updateFilePalette(state: PaletteState, query: string) {
    renderPaletteControls(state);
    const source = paletteSource();
    if (!query.trim()) {
      const base =
        source === "diff"
          ? state.diffSnapshot.map((file) => {
              const target = fileSourceTarget(file);
              return {
                kind: "file" as const,
                path: file.path,
                old_path: file.old_path,
                displayPath: file.path,
                ref: paletteRef(source),
                targetPath: target.path,
                targetRef: target.ref,
                source,
                ranges: [],
              };
            })
          : [];
      state.items = limitPaletteResults(base);
      state.selected = state.items.length ? 0 : -1;
      state.status.textContent =
        source === "diff"
          ? `${state.diffSnapshot.length} diff files`
          : "Type to search repository files";
      renderPalette(state);
      return;
    }
    if (source === "diff") {
      state.items = diffFilePaletteItems(state, query);
    } else {
      state.status.textContent = "Loading files...";
      const ref = paletteRef(source);
      const response = await repoPaletteFiles(ref);
      if (PALETTE !== state || state.input.value !== query) return;
      state.items = limitPaletteResults(
        rankPathMatches(query, response.files),
      ).map((match) => ({
        kind: "file",
        path: match.item.path,
        displayPath: match.item.path,
        ref,
        source,
        ranges: match.ranges,
      }));
    }
    state.selected = state.items.length ? 0 : -1;
    state.status.textContent = state.items.length
      ? `${state.items.length} results`
      : "No results";
    renderPalette(state);
  }

  function updateGrepPalette(state: PaletteState, query: string) {
    renderPaletteControls(state);
    state.controller?.abort();
    if (state.debounce) window.clearTimeout(state.debounce);
    if (!query.trim()) {
      state.items = [];
      state.selected = -1;
      state.status.textContent = "Type to grep";
      renderPalette(state);
      return;
    }
    if (state.grepRegex && !regexQueryIsValid(query)) {
      state.controller?.abort();
      state.items = [];
      state.selected = -1;
      state.status.textContent = "Invalid regular expression";
      renderPalette(state);
      return;
    }
    state.status.textContent = "Searching...";
    state.debounce = window.setTimeout(() => {
      const source = paletteSource();
      const ref = paletteRef(source);
      const params = new URLSearchParams();
      params.set("ref", ref);
      params.set("q", query);
      params.set("max", "200");
      if (state.grepRegex) params.set("regex", "1");
      appendScopeParams(params);
      if (source === "diff") {
        for (const file of state.diffSnapshot) params.append("path", file.path);
      }
      const controller = new AbortController();
      state.controller = controller;
      trackLoad<GrepResponse>(
        fetch(`/_grep?${params.toString()}`, {
          signal: controller.signal,
        }).then((r) => {
          if (!r.ok) throw new Error("grep failed");
          return r.json();
        }),
      )
        .then((response) => {
          if (PALETTE !== state || controller.signal.aborted) return;
          state.items = limitPaletteResults(
            response.matches.map((match) => ({
              kind: "grep" as const,
              path: match.path,
              line: match.line,
              column: match.column,
              preview: match.preview,
              ref,
              source,
            })),
          );
          state.selected = state.items.length ? 0 : -1;
          state.status.textContent =
            response.engine +
            (state.grepRegex ? " regex" : " plain") +
            (response.truncated ? " truncated" : "") +
            " - " +
            state.items.length +
            " results";
          renderPalette(state);
        })
        .catch((err) => {
          if (isAbortError(err)) return;
          state.status.textContent = "Search failed";
        });
    }, 80);
  }

  function updatePaletteResults(state: PaletteState) {
    const query = state.input.value;
    if (state.mode === "file") {
      updateFilePalette(state, query).catch(() => {
        state.status.textContent = "Search failed";
      });
    } else {
      updateGrepPalette(state, query);
    }
  }

  function selectPaletteItem(state: PaletteState) {
    const item = state.items[state.selected];
    if (!item) return;
    closeSearchPalette();
    if (item.kind === "file") {
      if (item.source === "diff") {
        if (STATE.route.screen === "file") {
          setRoute({
            screen: "file",
            path: item.targetPath || item.path,
            ref: item.targetRef || item.ref,
            range: currentRange(),
          });
          applySourceRouteToShell();
        } else {
          scrollToFile(item.path);
        }
      } else {
        setRoute({
          screen: "file",
          path: item.path,
          ref: item.ref,
          view: "blob",
          range: currentRange(),
        });
        renderStandaloneSource({ path: item.path, ref: item.ref });
      }
      return;
    }
    if (item.source === "diff") {
      setRoute({
        screen: "diff",
        range: currentRange(),
        path: item.path,
        line: item.line,
      });
      scrollToFile(item.path, item.line);
    } else {
      setRoute({
        screen: "file",
        path: item.path,
        ref: item.ref,
        view: "blob",
        line: item.line,
        range: currentRange(),
      });
      renderStandaloneSource({ path: item.path, ref: item.ref });
    }
  }

  function handlePaletteKeydown(e: KeyboardEvent, state: PaletteState) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSearchPalette();
      return;
    }
    if (e.key === "Enter") {
      if (state.composing) return;
      e.preventDefault();
      selectPaletteItem(state);
      return;
    }
    if (state.mode === "grep" && e.altKey && e.key.toLowerCase() === "r") {
      e.preventDefault();
      state.grepRegex = !state.grepRegex;
      updatePaletteResults(state);
      return;
    }
    const direction =
      e.key === "ArrowDown" || (e.ctrlKey && e.key.toLowerCase() === "n")
        ? 1
        : e.key === "ArrowUp" || (e.ctrlKey && e.key.toLowerCase() === "p")
          ? -1
          : 0;
    if (direction) {
      e.preventDefault();
      state.selected = movePaletteSelection(
        state.selected,
        state.items.length,
        direction,
      );
      syncPaletteSelection(state);
    }
  }

  function openSearchPalette(mode: PaletteMode) {
    createPalette(mode);
  }
  function isPaletteOpen() {
    return !!PALETTE;
  }
  function paletteMode(): PaletteMode | null {
    return PALETTE ? PALETTE.mode : null;
  }
  function clearRepoFileCache() {
    REPO_FILE_CACHE.clear();
  }

  return {
    openSearchPalette,
    closeSearchPalette,
    isPaletteOpen,
    paletteMode,
    clearRepoFileCache,
  };
}
