// Search results sheet: the result list of the Ctrl+G palette, kept open in the
// bottom panel (third tab next to Terminal / Tools) so it survives opening
// files. The query travels in the URL (?results=) and is re-run on reload.
// Toggles (regex / match case / whole word / no test) are the same persisted
// settings the palette uses, so both always search the same way.

import { buildGrepRequestParams, parseGrepQuery } from "../core/search-palette";
import type { GrepResponse } from "../core/types";
import {
  type SearchPaletteLanguage,
  searchPaletteText,
} from "./search-palette-i18n";

export type SearchResultsViewDeps = {
  $: <T extends Element = HTMLElement>(sel: string) => T | null;
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  getLanguage(): SearchPaletteLanguage;
  appendScopeParams(params: URLSearchParams): void;
  /** The ref the repository-wide search runs against. */
  getRef(): string;
  getServerGeneration(): number;
  isAbortError(err: unknown): boolean;
  getGrepRegex(): boolean;
  getGrepCaseSensitive(): boolean;
  getGrepWholeWord(): boolean;
  getGrepHideTests(): boolean;
  persistGrepSettings(patch: {
    grepRegex?: boolean;
    grepCaseSensitive?: boolean;
    grepWholeWord?: boolean;
    hideTests?: boolean;
  }): Promise<void>;
  /** Opens one hit (file at line, with the hit text to mark). */
  openMatch(match: { path: string; line: number; hl?: string }): void;
  /** Fired when a search runs; the app mirrors the query into the URL. */
  onQueryChange?(query: string): void;
};

export type SearchResultsViewHandle = {
  open(query?: string): void;
  close(): void;
  isOpen(): boolean;
  getQuery(): string;
  localize(): void;
};

const RESULTS_MAX = 500;

export function createSearchResultsView(
  deps: SearchResultsViewDeps,
): SearchResultsViewHandle {
  let mounted = false;
  let input: HTMLInputElement | null = null;
  let runButton: HTMLButtonElement | null = null;
  let controls: HTMLElement | null = null;
  let status: HTMLElement | null = null;
  let list: HTMLElement | null = null;
  let query = "";
  let controller: AbortController | null = null;
  let generation = 0;
  let settingsPending = false;
  let lastResponse: { response: GrepResponse; term: string } | null = null;
  // "path\0line" of the hit opened last, so the list shows where you are;
  // kept across re-runs of the same search when that hit is still listed.
  let activeKey = "";

  const text = () => searchPaletteText(deps.getLanguage());

  function host(): HTMLElement | null {
    return deps.$<HTMLElement>("#search-sheet");
  }

  function toggleButton(
    label: string,
    title: string,
    pressed: boolean,
    onToggle: () => void,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gdp-palette-mode-button";
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-pressed", String(pressed));
    button.disabled = settingsPending;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      onToggle();
    });
    return button;
  }

  async function updateFlag(
    patch: Parameters<SearchResultsViewDeps["persistGrepSettings"]>[0],
  ): Promise<void> {
    if (settingsPending) return;
    settingsPending = true;
    renderControls();
    try {
      await deps.persistGrepSettings(patch);
    } catch (err) {
      console.error("Failed to save search option", err);
      if (status)
        status.textContent = text().saveFailed(
          text().regexMode,
          err instanceof Error && err.message
            ? err.message
            : text().unknownError,
        );
    } finally {
      settingsPending = false;
      renderControls();
      if (query) run();
    }
  }

  function renderControls(): void {
    if (!controls) return;
    const current = text();
    controls.replaceChildren(
      toggleButton(
        current.plain,
        current.plain,
        !deps.getGrepRegex(),
        () => void updateFlag({ grepRegex: false }),
      ),
      toggleButton(
        current.regex,
        "Alt+R",
        deps.getGrepRegex(),
        () => void updateFlag({ grepRegex: true }),
      ),
      toggleButton(
        current.matchCase,
        current.matchCaseTitle,
        deps.getGrepCaseSensitive(),
        () =>
          void updateFlag({ grepCaseSensitive: !deps.getGrepCaseSensitive() }),
      ),
      toggleButton(
        current.wholeWord,
        current.wholeWordTitle,
        deps.getGrepWholeWord(),
        () => void updateFlag({ grepWholeWord: !deps.getGrepWholeWord() }),
      ),
      toggleButton(
        current.excludeTests,
        current.excludeTestsTitle,
        deps.getGrepHideTests(),
        () => void updateFlag({ hideTests: !deps.getGrepHideTests() }),
      ),
    );
  }

  function mount(): void {
    const el = host();
    if (!el || mounted) return;
    mounted = true;
    el.replaceChildren();
    const head = document.createElement("div");
    head.className = "search-results-head";
    input = document.createElement("input");
    input.type = "search";
    input.className = "search-results-input";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        run(input?.value ?? "");
      }
    });
    runButton = document.createElement("button");
    runButton.type = "button";
    runButton.className = "gdp-btn gdp-btn-sm search-results-run";
    runButton.addEventListener("click", () => run(input?.value ?? ""));
    controls = document.createElement("div");
    controls.className = "gdp-palette-controls search-results-controls";
    status = document.createElement("div");
    status.className = "gdp-palette-status search-results-status";
    head.append(input, runButton);
    list = document.createElement("div");
    list.className = "gdp-palette-list search-results-list";
    list.setAttribute("role", "listbox");
    el.append(head, controls, status, list);
    localize();
  }

  function renderResults(): void {
    if (!list || !status) return;
    list.replaceChildren();
    if (!lastResponse) {
      status.textContent = text().resultsIdle;
      return;
    }
    const { response, term } = lastResponse;
    const grouped = new Map<string, GrepResponse["matches"]>();
    for (const match of response.matches) {
      const bucket = grouped.get(match.path) ?? [];
      bucket.push(match);
      grouped.set(match.path, bucket);
    }
    for (const [path, matches] of grouped) {
      const group = document.createElement("section");
      group.className = "gdp-palette-file-group";
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", path);
      const heading = document.createElement("div");
      heading.className = "gdp-palette-file-heading";
      const name = document.createElement("span");
      name.className = "gdp-palette-file-heading-name";
      name.textContent = path;
      name.title = path;
      const count = document.createElement("span");
      count.className = "gdp-palette-file-heading-count";
      count.textContent = String(matches.length);
      heading.append(name, count);
      const rows = document.createElement("div");
      rows.className = "gdp-palette-file-matches";
      for (const match of matches) {
        const key = `${match.path}\0${match.line}`;
        const row = document.createElement("button");
        row.type = "button";
        row.className = "gdp-palette-row";
        row.setAttribute("role", "option");
        row.dataset.resultKey = key;
        row.setAttribute("aria-selected", String(key === activeKey));
        const title = document.createElement("span");
        title.className = "gdp-palette-row-title";
        title.textContent = text().line(match.line, match.column);
        const detail = document.createElement("span");
        detail.className = "gdp-palette-row-detail";
        detail.textContent = match.preview;
        row.append(title, detail);
        row.addEventListener("click", () => {
          setActiveRow(key);
          const hl = match.matchText || (deps.getGrepRegex() ? "" : term);
          deps.openMatch({
            path: match.path,
            line: match.line,
            ...(hl ? { hl } : {}),
          });
        });
        rows.appendChild(row);
      }
      group.append(heading, rows);
      list.appendChild(group);
    }
  }

  // Mark the opened hit in place (no list rebuild, so scroll stays put).
  function setActiveRow(key: string): void {
    activeKey = key;
    list?.querySelectorAll<HTMLElement>(".gdp-palette-row").forEach((row) => {
      row.setAttribute("aria-selected", String(row.dataset.resultKey === key));
    });
  }

  function run(nextQuery?: string): void {
    if (!mounted) return;
    if (nextQuery !== undefined) query = nextQuery.trim();
    if (input && input.value !== query) input.value = query;
    controller?.abort();
    controller = null;
    const parsed = parseGrepQuery(query);
    deps.onQueryChange?.(query);
    if (!parsed.term) {
      lastResponse = null;
      renderResults();
      return;
    }
    const myGeneration = ++generation;
    if (status) status.textContent = text().searching;
    const ref = deps.getRef();
    const regex = deps.getGrepRegex();
    const caseSensitive = deps.getGrepCaseSensitive();
    const wholeWord = deps.getGrepWholeWord();
    const hideTests = deps.getGrepHideTests();
    const params = buildGrepRequestParams({
      term: parsed.term,
      ref,
      regex,
      caseSensitive,
      wholeWord,
      hideTests,
      max: RESULTS_MAX,
    });
    deps.appendScopeParams(params);
    for (const scope of parsed.paths) params.append("path", scope);
    const abort = new AbortController();
    controller = abort;
    void deps
      .trackLoad<GrepResponse>(
        fetch(`/_grep?${params.toString()}`, { signal: abort.signal }).then(
          async (r) => {
            if (!r.ok)
              throw new Error(
                `grep request failed (${r.status}): ${await r.text()}`,
              );
            return r.json();
          },
        ),
      )
      .then((response) => {
        if (myGeneration !== generation || abort.signal.aborted) return;
        const current = deps.getServerGeneration();
        if (
          response.generation !== undefined &&
          current > 0 &&
          response.generation < current
        ) {
          lastResponse = null;
          renderResults();
          if (status) status.textContent = text().repositoryChanged;
          return;
        }
        lastResponse = { response, term: parsed.term };
        renderResults();
        if (status)
          status.textContent = `${text().grepSummary({
            engine: response.engine,
            regex,
            caseSensitive,
            wholeWord,
            testsExcluded: hideTests,
            truncated: response.truncated,
            count: response.matches.length,
            paths: parsed.paths,
          })} · ${text().resultsScope(ref)}`;
      })
      .catch((err: unknown) => {
        if (deps.isAbortError(err) || abort.signal.aborted) return;
        if (myGeneration !== generation) return;
        console.error("Search results request failed", err);
        lastResponse = null;
        renderResults();
        if (status)
          status.textContent = text().searchFailed(
            err instanceof Error && err.message
              ? err.message
              : text().unknownError,
          );
      });
  }

  function localize(): void {
    if (!mounted) return;
    const current = text();
    if (input) input.placeholder = current.resultsPlaceholder;
    if (runButton) {
      runButton.textContent = current.resultsRun;
      runButton.title = current.resultsRun;
    }
    host()?.setAttribute("aria-label", current.resultsTitle);
    renderControls();
    renderResults();
  }

  function isOpen(): boolean {
    const el = host();
    return !!el && !el.hidden;
  }

  return {
    open(nextQuery?: string) {
      const el = host();
      if (!el) return;
      mount();
      el.hidden = false;
      el.setAttribute("aria-hidden", "false");
      el.removeAttribute("inert");
      document.body.classList.add("search-sheet-open");
      if (nextQuery !== undefined && nextQuery !== query) run(nextQuery);
      else if (nextQuery === undefined && !lastResponse && query) run(query);
      else renderResults();
      input?.focus();
    },
    close() {
      const el = host();
      if (!el) return;
      el.hidden = true;
      el.setAttribute("aria-hidden", "true");
      el.setAttribute("inert", "");
      document.body.classList.remove("search-sheet-open");
      controller?.abort();
      controller = null;
    },
    isOpen,
    getQuery: () => query,
    localize,
  };
}
