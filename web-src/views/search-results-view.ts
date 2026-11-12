import { live } from "lit/directives/live.js";
import { html, nothing } from "lit/html.js";
import { apiUrl } from "../core/api-url";
import { formatErrorDetail } from "../core/error-detail";

// Search results sheet: the result list of the Ctrl+G palette, kept open in the
// Search tab of the main area so it survives opening files. The query travels
// in the URL (/search?q=) and is re-run on reload.
// Toggles (regex / match case / whole word / no test) are the same persisted
// settings the palette uses, so both always search the same way.

import { SEARCH_16_PATH } from "../core/icons";
import { linkOpenIntent, type OpenIntent } from "../core/link-click";
import { buildGrepRequestParams, parseGrepQuery } from "../core/search-palette";
import type { GrepResponse } from "../core/types";
import {
  type SearchPaletteLanguage,
  searchPaletteText,
} from "./search-palette-i18n";
import { type EmptyStateOptions, emptyStateTemplate } from "./ui/empty-state";
import { renderOwned } from "./ui/renderer";

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
  /**
   * Opens one hit (file at line, with the hit text to mark). intent is how it
   * was pressed (the tab rules in ui-surface.md: preview / kept tab / other side).
   */
  openMatch(
    match: { path: string; line: number; hl?: string },
    intent: OpenIntent,
  ): void;
  /** Fired when a search runs; the app mirrors the query into the URL. */
  onQueryChange?(query: string): void;
};

export type SearchResultsViewHandle = {
  open(query?: string): void;
  close(): void;
  isOpen(): boolean;
  getQuery(): string;
  resetProject(): void;
  localize(): void;
};

/** 検索の欄の上の切り替え (正規表現・大文字小文字・単語・テストを除く)。 */
export type SearchToggleProps = {
  label: string;
  title: string;
  pressed: boolean;
  disabled: boolean;
  onToggle(): void;
};

export type SearchResultRowProps = {
  key: string;
  title: string;
  detail: string;
  selected: boolean;
  /** 押し方 (クリック・中ボタン・ダブルクリック) ごとに開く。 */
  onOpen(event: MouseEvent): void;
};

/** 検索の結果の画面 (#search-sheet) の中。 */
export type SearchResultsProps = {
  input: {
    value: string;
    placeholder: string;
    onInput(value: string): void;
    /** 欄の今の語で探す (Enter と［検索］)。 */
    onRun(value: string): void;
  };
  runLabel: string;
  toggles: SearchToggleProps[];
  /** 件数や理由の 1 行。again は「もう一度探す」を添えるとき。 */
  status: { text: string; again: { label: string; onClick(): void } | null };
  /** 検索する前・当たらなかったときの案内 (一覧の外)。 */
  idle: EmptyStateOptions | null;
  groups: { path: string; rows: SearchResultRowProps[] }[];
};

export type SearchResultsView = (props: SearchResultsProps) => unknown;

export const DEFAULT_VIEW: SearchResultsView = (props) => html`<div
    class="search-results-head"
  ><input
      type="search"
      class="search-results-input"
      autocomplete="off"
      spellcheck="false"
      placeholder=${props.input.placeholder}
      aria-label=${props.input.placeholder}
      .value=${live(props.input.value)}
      @input=${(event: Event) =>
        props.input.onInput((event.currentTarget as HTMLInputElement).value)}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        props.input.onRun((event.currentTarget as HTMLInputElement).value);
      }}
    /><button
      type="button"
      class="gdp-btn gdp-btn-sm search-results-run"
      title=${props.runLabel}
      @click=${(event: Event) =>
        props.input.onRun(
          (event.currentTarget as HTMLElement)
            .closest(".search-results-head")
            ?.querySelector<HTMLInputElement>(".search-results-input")?.value ??
            "",
        )}
    >${props.runLabel}</button></div
  ><div class="gdp-palette-controls search-results-controls">${props.toggles.map(
    (toggle) => html`<button
      type="button"
      class="gdp-palette-mode-button"
      title=${toggle.title}
      aria-pressed=${String(toggle.pressed)}
      ?disabled=${toggle.disabled}
      @click=${(event: Event) => {
        event.preventDefault();
        toggle.onToggle();
      }}
    >${toggle.label}</button>`,
  )}</div
  ><div class="gdp-palette-status search-results-status">${
    props.status.again
      ? html`${props.status.text} <button
            type="button"
            class="gdp-palette-status-action"
            @click=${props.status.again.onClick}
          >${props.status.again.label}</button>`
      : props.status.text
  }</div
  ><div class="search-results-idle">${
    props.idle ? emptyStateTemplate(props.idle) : nothing
  }</div
  ><div class="gdp-palette-list search-results-list" role="listbox">${props.groups.map(
    (group) => html`<section
      class="gdp-palette-file-group"
      role="group"
      aria-label=${group.path}
    ><div class="gdp-palette-file-heading"><span
          class="gdp-palette-file-heading-name"
          title=${group.path}
        >${group.path}</span><span class="gdp-palette-file-heading-count"
          >${group.rows.length}</span
        ></div
      ><div class="gdp-palette-file-matches">${group.rows.map(
        (row) => html`<button
          type="button"
          class="gdp-palette-row"
          role="option"
          data-result-key=${row.key}
          aria-selected=${String(row.selected)}
          @click=${row.onOpen}
          @auxclick=${row.onOpen}
          @dblclick=${row.onOpen}
        ><span class="gdp-palette-row-title">${row.title}</span><span
            class="gdp-palette-row-detail"
          >${row.detail}</span></button>`,
      )}</div></section>`,
  )}</div>`;

const RESULTS_MAX = 500;

export function createSearchResultsView(
  deps: SearchResultsViewDeps,
  view: SearchResultsView = DEFAULT_VIEW,
): SearchResultsViewHandle {
  let mounted = false;
  /** 欄に打っている語 (まだ探していないものも)。 */
  let draft = "";
  let query = "";
  let controller: AbortController | null = null;
  let generation = 0;
  let settingsPending = false;
  let lastResponse: { response: GrepResponse; term: string } | null = null;
  /** 件数・理由の 1 行。changed は「リポジトリが変わった」で、探し直しを添える。 */
  let status: { kind: "text"; text: string } | { kind: "changed" } = {
    kind: "text",
    text: "",
  };
  /** 探している間は「検索する前」の案内を出さない (結果が届いたときに案内の
   * 高さぶん一覧が上へ跳ねていた)。 */
  let searching = false;
  // "path\0line" of the hit opened last, so the list shows where you are;
  // kept across re-runs of the same search when that hit is still listed.
  let activeKey = "";

  const text = () => searchPaletteText(deps.getLanguage());

  function host(): HTMLElement | null {
    return deps.$<HTMLElement>("#search-sheet");
  }

  async function updateFlag(
    patch: Parameters<SearchResultsViewDeps["persistGrepSettings"]>[0],
  ): Promise<void> {
    if (settingsPending) return;
    settingsPending = true;
    draw();
    try {
      await deps.persistGrepSettings(patch);
    } catch (err) {
      console.error("Failed to save search option", err);
      status = {
        kind: "text",
        text: text().saveFailed(text().regexMode, formatErrorDetail(err)),
      };
    } finally {
      settingsPending = false;
      draw();
      if (query) run();
    }
  }

  function toggles(): SearchToggleProps[] {
    const current = text();
    const toggle = (
      label: string,
      title: string,
      pressed: boolean,
      onToggle: () => void,
    ): SearchToggleProps => ({
      label,
      title,
      pressed,
      disabled: settingsPending,
      onToggle,
    });
    return [
      toggle(
        current.plain,
        current.plain,
        !deps.getGrepRegex(),
        () => void updateFlag({ grepRegex: false }),
      ),
      toggle(
        current.regex,
        "Alt+R",
        deps.getGrepRegex(),
        () => void updateFlag({ grepRegex: true }),
      ),
      toggle(
        current.matchCase,
        current.matchCaseTitle,
        deps.getGrepCaseSensitive(),
        () =>
          void updateFlag({ grepCaseSensitive: !deps.getGrepCaseSensitive() }),
      ),
      toggle(
        current.wholeWord,
        current.wholeWordTitle,
        deps.getGrepWholeWord(),
        () => void updateFlag({ grepWholeWord: !deps.getGrepWholeWord() }),
      ),
      toggle(
        current.excludeTests,
        current.excludeTestsTitle,
        deps.getGrepHideTests(),
        () => void updateFlag({ hideTests: !deps.getGrepHideTests() }),
      ),
    ];
  }

  function idleState(): EmptyStateOptions | null {
    const current = text();
    if (searching) return null;
    // 検索する前: 何をするか (一行と補足) と主なキー。件数の欄は空。
    if (!lastResponse)
      return {
        icon: SEARCH_16_PATH,
        title: current.resultsIdle,
        hint: current.resultsIdleHint,
        keys: [
          { keys: "Enter", label: current.resultsIdleKeys.run },
          { keys: "⌘G", label: current.resultsIdleKeys.anywhere },
          { keys: "⌘K", label: current.resultsIdleKeys.openFile },
        ],
        keysLabel: current.resultsIdleKeysLabel,
        compact: true,
      };
    // 当たらなかったら、件数の欄の「0 件」だけで画面が空にならないよう一言出す。
    if (lastResponse.response.matches.length === 0)
      return {
        icon: SEARCH_16_PATH,
        title: current.resultsNone,
        compact: true,
      };
    return null;
  }

  function groups(): SearchResultsProps["groups"] {
    if (!lastResponse) return [];
    const { response, term } = lastResponse;
    const grouped = new Map<string, GrepResponse["matches"]>();
    for (const match of response.matches) {
      const bucket = grouped.get(match.path) ?? [];
      bucket.push(match);
      grouped.set(match.path, bucket);
    }
    return [...grouped].map(([path, matches]) => ({
      path,
      rows: matches.map((match) => {
        const key = `${match.path}\0${match.line}`;
        return {
          key,
          title: text().line(match.line, match.column),
          detail: match.preview,
          selected: key === activeKey,
          onOpen: (event: MouseEvent) => {
            const intent = linkOpenIntent(event);
            if (intent === null) return;
            event.preventDefault();
            // 開いた行に印を付ける (一覧は作り直さないので、スクロールはそのまま)。
            activeKey = key;
            draw();
            const hl = match.matchText || (deps.getGrepRegex() ? "" : term);
            deps.openMatch(
              { path: match.path, line: match.line, ...(hl ? { hl } : {}) },
              intent,
            );
          },
        };
      }),
    }));
  }

  function draw(): void {
    const el = host();
    if (!el || !mounted) return;
    const current = text();
    el.setAttribute("aria-label", current.resultsTitle);
    renderOwned(
      el,
      view({
        input: {
          value: draft,
          placeholder: current.resultsPlaceholder,
          onInput: (value) => {
            draft = value;
          },
          onRun: (value) => run(value),
        },
        runLabel: current.resultsRun,
        toggles: toggles(),
        status:
          status.kind === "changed"
            ? {
                // 同じ語・同じ条件で検索し直すボタンを添える。
                text: current.repositoryChanged,
                again: {
                  label: current.searchAgain,
                  onClick: () => run(query),
                },
              }
            : { text: status.text, again: null },
        idle: idleState(),
        groups: groups(),
      }),
    );
  }

  function mount(): void {
    if (!host() || mounted) return;
    mounted = true;
    draw();
  }

  function setStatus(next: string): void {
    status = { kind: "text", text: next };
  }

  function run(nextQuery?: string): void {
    if (!mounted) return;
    if (nextQuery !== undefined) query = nextQuery.trim();
    draft = query;
    controller?.abort();
    controller = null;
    const parsed = parseGrepQuery(query);
    deps.onQueryChange?.(query);
    if (!parsed.term) {
      lastResponse = null;
      searching = false;
      setStatus("");
      draw();
      return;
    }
    const myGeneration = ++generation;
    setStatus(text().searching);
    searching = true;
    draw();
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
        fetch(`${apiUrl("grep")}?${params.toString()}`, {
          signal: abort.signal,
        }).then(async (r) => {
          if (!r.ok)
            throw new Error(
              `grep request failed (${r.status}): ${await r.text()}`,
            );
          return r.json();
        }),
      )
      .then((response) => {
        if (myGeneration !== generation || abort.signal.aborted) return;
        searching = false;
        const current = deps.getServerGeneration();
        if (
          response.generation !== undefined &&
          current > 0 &&
          response.generation < current
        ) {
          lastResponse = null;
          status = { kind: "changed" };
          draw();
          return;
        }
        lastResponse = { response, term: parsed.term };
        setStatus(
          `${text().grepSummary({
            engine: response.engine,
            regex,
            caseSensitive,
            wholeWord,
            testsExcluded: hideTests,
            truncated: response.truncated,
            count: response.matches.length,
            paths: parsed.paths,
          })} · ${text().resultsScope(ref)}`,
        );
        draw();
      })
      .catch((err: unknown) => {
        if (deps.isAbortError(err) || abort.signal.aborted) return;
        if (myGeneration !== generation) return;
        console.error("Search results request failed", err);
        searching = false;
        lastResponse = null;
        setStatus(text().searchFailed(formatErrorDetail(err)));
        draw();
      });
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
      else draw();
      el.querySelector<HTMLInputElement>(".search-results-input")?.focus();
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
    resetProject() {
      generation++;
      controller?.abort();
      controller = null;
      lastResponse = null;
      searching = false;
      query = "";
      draft = "";
      activeKey = "";
      draw();
    },
    getQuery: () => query,
    localize: draw,
  };
}
