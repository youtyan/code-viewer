import { csvParseRows, tsvParseRows } from "d3-dsv";
import { live } from "lit/directives/live.js";
import { html, nothing } from "lit/html.js";
import { SEARCH_16_PATH } from "../core/icons";
import { isImeComposing } from "../core/keyboard";
import { createMediaPlayer } from "./media-player";
import { pageLanguage } from "./page-language";
import {
  type DelimitedPreviewFormat,
  type DelimitedPreviewText,
  delimitedPreviewText,
  SOURCE_READING_TEXT,
} from "./source-preview-i18n";
import { iconTemplate } from "./ui/icon";
import { renderOwned, templateElement } from "./ui/renderer";

export type DelimitedPreviewElement = HTMLElement & {
  localize(): void;
};

type SortDirection = "asc" | "desc";

type SearchProps = {
  placeholder: string;
  label: string;
  value: string;
  onInput(value: string): void;
  /** Escape で空にする (空なら何もしない。外の Escape に渡す)。 */
  onClear(): void;
};

/** 表の下見に描くもの。 */
export type DelimitedPreviewProps = {
  toolbarLabel: string;
  search: SearchProps;
  count: { text: string; label: string };
  reset: { label: string; title: string; disabled: boolean; onClick(): void };
  columns: {
    index: number;
    label: string;
    sort: {
      direction: SortDirection | "none";
      ariaSort: "ascending" | "descending" | "none";
      title: string;
      onClick(): void;
    };
    filter: SearchProps;
  }[];
  rows: { index: number; cells: string[] }[];
  /** 何も当たらないときの文 (当たれば null)。 */
  empty: string | null;
};

export type DelimitedPreviewView = (props: DelimitedPreviewProps) => unknown;

/** Escape で欄を空にする (空なら何もしない。外の Escape に渡す)。 */
function clearOnEscape(event: KeyboardEvent, clear: () => void): void {
  const input = event.currentTarget as HTMLInputElement;
  if (isImeComposing(event) || event.key !== "Escape" || !input.value) return;
  clear();
}

export const DEFAULT_VIEW: DelimitedPreviewView = (props) => html`<section
  class="gdp-csv-shell"
><div class="gdp-csv-toolbar" aria-label=${props.toolbarLabel}><span
      class="gdp-csv-search-icon"
      aria-hidden="true"
      >${iconTemplate(SEARCH_16_PATH, "octicon-search")}</span
    ><input
      type="search"
      class="gdp-csv-search"
      autocomplete="off"
      spellcheck="false"
      placeholder=${props.search.placeholder}
      aria-label=${props.search.label}
      .value=${live(props.search.value)}
      @input=${(event: Event) =>
        props.search.onInput((event.currentTarget as HTMLInputElement).value)}
      @keydown=${(event: KeyboardEvent) =>
        clearOnEscape(event, props.search.onClear)}
    /><span
      class="gdp-csv-result-count"
      role="status"
      aria-live="polite"
      aria-label=${props.count.label}
      >${props.count.text}</span
    ><button
      type="button"
      class="gdp-csv-reset"
      title=${props.reset.title}
      aria-label=${props.reset.title}
      ?disabled=${props.reset.disabled}
      @click=${props.reset.onClick}
    >${props.reset.label}</button></div
  ><table class="gdp-csv-table"><thead><tr
        ><th class="gdp-csv-row-number" aria-hidden="true"></th>${props.columns.map(
          (
            column,
          ) => html`<th scope="col" aria-sort=${column.sort.ariaSort}><button
              type="button"
              class="gdp-csv-sort-button"
              data-csv-sort-column=${String(column.index)}
              data-sort-direction=${column.sort.direction}
              title=${column.sort.title}
              aria-label=${column.sort.title}
              @click=${column.sort.onClick}
            ><span>${column.label}</span></button></th>`,
        )}</tr
      ><tr class="gdp-csv-filter-row"><th
          class="gdp-csv-row-number"
          aria-hidden="true"
        ></th>${props.columns.map(
          (column) => html`<th><input
              type="search"
              class="gdp-csv-column-filter"
              data-csv-column-filter=${String(column.index)}
              autocomplete="off"
              spellcheck="false"
              placeholder=${column.filter.placeholder}
              aria-label=${column.filter.label}
              .value=${live(column.filter.value)}
              @input=${(event: Event) =>
                column.filter.onInput(
                  (event.currentTarget as HTMLInputElement).value,
                )}
              @keydown=${(event: KeyboardEvent) =>
                clearOnEscape(event, column.filter.onClear)}
            /></th>`,
        )}</tr></thead
    ><tbody>${props.rows.map(
      (row) =>
        html`<tr><th class="gdp-csv-row-number" scope="row">${String(
          row.index,
        )}</th>${row.cells.map((value) => html`<td>${value}</td>`)}</tr>`,
    )}${
      props.empty !== null
        ? html`<tr class="gdp-csv-empty-row"><td colspan=${props.columns.length + 1}
            >${props.empty}</td
          ></tr>`
        : nothing
    }</tbody></table></section>`;

export function renderDelimitedPreview(
  text: string,
  format: DelimitedPreviewFormat,
  getText: () => DelimitedPreviewText = () =>
    delimitedPreviewText("en", format),
  view: DelimitedPreviewView = DEFAULT_VIEW,
): DelimitedPreviewElement {
  const preview: DelimitedPreviewElement = Object.assign(
    templateElement(html`<div class="gdp-csv-preview"></div>`),
    { localize: () => undefined },
  );
  const parseRows = format === "tsv" ? tsvParseRows : csvParseRows;
  const rows = parseRows(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  if (rows.length === 0) return preview;

  const columnCount = rows.reduce(
    (largest, row) => Math.max(largest, row.length),
    0,
  );
  const header = rows[0];
  const dataRows = rows.slice(1).map((row, index) => ({
    sourceIndex: index + 1,
    cells: Array.from(
      { length: columnCount },
      (_, column) => row[column] ?? "",
    ),
  }));
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  const columns = Array.from({ length: columnCount }, (_, column) => column);
  const columnFilters = columns.map(() => "");
  let search = "";
  let sortColumn: number | null = null;
  let sortDirection: SortDirection | null = null;

  function normalized(value: string): string {
    return value.trim().toLocaleLowerCase();
  }

  function activeStateCount(): number {
    return (
      (normalized(search) ? 1 : 0) +
      columnFilters.filter((value) => normalized(value)).length +
      (sortColumn === null ? 0 : 1)
    );
  }

  function localizedColumnLabel(
    column: number,
    textValue: DelimitedPreviewText,
  ) {
    return header[column] || textValue.columnLabel(column + 1);
  }

  function visibleRows() {
    const globalQuery = normalized(search);
    const filters = columnFilters.map(normalized);
    const filtered = dataRows.filter(
      (row) =>
        (!globalQuery ||
          row.cells.some((cell) =>
            cell.toLocaleLowerCase().includes(globalQuery),
          )) &&
        filters.every(
          (filter, column) =>
            !filter || row.cells[column].toLocaleLowerCase().includes(filter),
        ),
    );
    if (sortColumn === null || sortDirection === null) return filtered;
    const column = sortColumn;
    const direction = sortDirection;
    return [...filtered].sort((a, b) => {
      const aValue = a.cells[column];
      const bValue = b.cells[column];
      if (!aValue && bValue) return 1;
      if (aValue && !bValue) return -1;
      const compared = collator.compare(aValue, bValue);
      if (compared === 0) return a.sourceIndex - b.sourceIndex;
      return direction === "asc" ? compared : -compared;
    });
  }

  function cycleSort(column: number): void {
    if (sortColumn !== column) {
      sortColumn = column;
      sortDirection = "asc";
    } else if (sortDirection === "asc") {
      sortDirection = "desc";
    } else if (sortDirection === "desc") {
      sortColumn = null;
      sortDirection = null;
    } else {
      sortDirection = "asc";
    }
    draw();
  }

  function previewProps(): DelimitedPreviewProps {
    const textValue = getText();
    const shown = visibleRows();
    return {
      toolbarLabel: textValue.searchLabel,
      search: {
        placeholder: textValue.searchPlaceholder,
        label: textValue.searchLabel,
        value: search,
        onInput: (value) => {
          search = value;
          draw();
        },
        onClear: () => {
          search = "";
          draw();
        },
      },
      count: {
        text: textValue.resultCount(shown.length, dataRows.length),
        label: textValue.resultCountLabel,
      },
      reset: {
        label: textValue.resetLabel,
        title: textValue.resetAction,
        disabled: activeStateCount() === 0,
        onClick: () => {
          search = "";
          columnFilters.fill("");
          sortColumn = null;
          sortDirection = null;
          draw();
          preview.querySelector<HTMLInputElement>(".gdp-csv-search")?.focus();
        },
      },
      columns: columns.map((column) => {
        const columnLabel = localizedColumnLabel(column, textValue);
        const active = sortColumn === column ? sortDirection : null;
        return {
          index: column,
          label: header[column] ?? "",
          sort: {
            direction: active ?? "none",
            ariaSort:
              active === "asc"
                ? "ascending"
                : active === "desc"
                  ? "descending"
                  : "none",
            title:
              active === "asc"
                ? textValue.sortDescending(columnLabel)
                : active === "desc"
                  ? textValue.clearSort(columnLabel)
                  : textValue.sortAscending(columnLabel),
            onClick: () => cycleSort(column),
          },
          filter: {
            placeholder: textValue.columnFilterPlaceholder,
            label: textValue.columnFilterLabel(columnLabel),
            value: columnFilters[column] ?? "",
            onInput: (value) => {
              columnFilters[column] = value;
              draw();
            },
            onClear: () => {
              columnFilters[column] = "";
              draw();
            },
          },
        };
      }),
      rows: shown.map((row) => ({ index: row.sourceIndex, cells: row.cells })),
      empty: shown.length === 0 ? textValue.noMatches : null,
    };
  }

  function draw(): void {
    renderOwned(preview, view(previewProps()));
  }

  preview.localize = draw;
  draw();
  return preview;
}

export function renderHtmlPreviewFrame(
  title: string,
  html_: string,
  extraClass = "",
): HTMLElement {
  return templateElement(
    html`<div class=${["gdp-html-preview", extraClass].filter(Boolean).join(" ")}
      ><iframe
        title=${title}
        sandbox=""
        referrerpolicy="no-referrer"
        .srcdoc=${html_}
      ></iframe
    ></div>`,
  );
}

/** 画像・動画・音・PDF の埋め込み。 */
export function mediaEmbedTemplate(opts: {
  url: string;
  kind: string;
  title: string;
  onImageLoad?: (img: HTMLImageElement) => void;
}): unknown {
  if (opts.kind === "video" || opts.kind === "audio")
    return createMediaPlayer(opts.url, opts.kind, opts.title);
  if (opts.kind === "pdf")
    return html`<iframe src=${opts.url} title=${opts.title} loading="lazy"></iframe>`;
  const onImageLoad = opts.onImageLoad;
  return html`<img
    src=${opts.url}
    alt=""
    @load=${
      onImageLoad
        ? {
            handleEvent: (event: Event) =>
              onImageLoad(event.currentTarget as HTMLImageElement),
            once: true,
          }
        : nothing
    }
  />`;
}

export function appendMediaEmbed(
  view: HTMLElement,
  opts: {
    url: string;
    kind: string;
    title: string;
    onImageLoad?: (img: HTMLImageElement) => void;
  },
): void {
  view.appendChild(templateElement(mediaEmbedTemplate(opts)));
}

export function renderUnsupportedPreview(opts: {
  className?: string;
  message: string;
  extraChildren?: Node[];
}): HTMLElement {
  return templateElement(
    html`<div
      class=${["gdp-source-viewer unsupported", opts.className || ""]
        .filter(Boolean)
        .join(" ")}
    ><div class="gdp-source-unsupported-content"><strong
          class="gdp-source-unsupported-title"
          >${SOURCE_READING_TEXT[pageLanguage()].previewUnavailable}</strong
        ><div class="gdp-source-unsupported-message">${opts.message}</div>${
          opts.extraChildren ?? nothing
        }</div></div>`,
  );
}
