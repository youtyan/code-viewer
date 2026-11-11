import { csvParseRows, tsvParseRows } from "d3-dsv";
import { live } from "lit/directives/live.js";
import { html, nothing, type TemplateResult } from "lit/html.js";
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

export function renderDelimitedPreview(
  text: string,
  format: DelimitedPreviewFormat,
  getText: () => DelimitedPreviewText = () =>
    delimitedPreviewText("en", format),
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

  /** Escape で欄を空にする (空なら何もしない。外の Escape に渡す)。 */
  function clearOnEscape(event: KeyboardEvent, clear: () => void): void {
    const input = event.currentTarget as HTMLInputElement;
    if (isImeComposing(event) || event.key !== "Escape" || !input.value) return;
    clear();
    draw();
  }

  function sortHeaderTemplate(
    column: number,
    textValue: DelimitedPreviewText,
  ): TemplateResult {
    const columnLabel = localizedColumnLabel(column, textValue);
    const active = sortColumn === column ? sortDirection : null;
    const action =
      active === "asc"
        ? textValue.sortDescending(columnLabel)
        : active === "desc"
          ? textValue.clearSort(columnLabel)
          : textValue.sortAscending(columnLabel);
    return html`<th
      scope="col"
      aria-sort=${
        active === "asc"
          ? "ascending"
          : active === "desc"
            ? "descending"
            : "none"
      }
    ><button
      type="button"
      class="gdp-csv-sort-button"
      data-csv-sort-column=${String(column)}
      data-sort-direction=${active ?? "none"}
      title=${action}
      aria-label=${action}
      @click=${() => cycleSort(column)}
    ><span>${header[column] ?? ""}</span></button></th>`;
  }

  function filterTemplate(
    column: number,
    textValue: DelimitedPreviewText,
  ): TemplateResult {
    return html`<th><input
      type="search"
      class="gdp-csv-column-filter"
      data-csv-column-filter=${String(column)}
      autocomplete="off"
      spellcheck="false"
      placeholder=${textValue.columnFilterPlaceholder}
      aria-label=${textValue.columnFilterLabel(
        localizedColumnLabel(column, textValue),
      )}
      .value=${live(columnFilters[column])}
      @input=${(event: Event) => {
        columnFilters[column] = (event.currentTarget as HTMLInputElement).value;
        draw();
      }}
      @keydown=${(event: KeyboardEvent) =>
        clearOnEscape(event, () => {
          columnFilters[column] = "";
        })}
    /></th>`;
  }

  function previewTemplate(): TemplateResult {
    const textValue = getText();
    const shown = visibleRows();
    return html`<section class="gdp-csv-shell"><div
        class="gdp-csv-toolbar"
        aria-label=${textValue.searchLabel}
      ><span class="gdp-csv-search-icon" aria-hidden="true">${iconTemplate(
        SEARCH_16_PATH,
        "octicon-search",
      )}</span><input
        type="search"
        class="gdp-csv-search"
        autocomplete="off"
        spellcheck="false"
        placeholder=${textValue.searchPlaceholder}
        aria-label=${textValue.searchLabel}
        .value=${live(search)}
        @input=${(event: Event) => {
          search = (event.currentTarget as HTMLInputElement).value;
          draw();
        }}
        @keydown=${(event: KeyboardEvent) =>
          clearOnEscape(event, () => {
            search = "";
          })}
      /><span
        class="gdp-csv-result-count"
        role="status"
        aria-live="polite"
        aria-label=${textValue.resultCountLabel}
      >${textValue.resultCount(shown.length, dataRows.length)}</span><button
        type="button"
        class="gdp-csv-reset"
        title=${textValue.resetAction}
        aria-label=${textValue.resetAction}
        ?disabled=${activeStateCount() === 0}
        @click=${() => {
          search = "";
          columnFilters.fill("");
          sortColumn = null;
          sortDirection = null;
          draw();
          preview.querySelector<HTMLInputElement>(".gdp-csv-search")?.focus();
        }}
      >${textValue.resetLabel}</button></div><table class="gdp-csv-table"><thead><tr
            ><th class="gdp-csv-row-number" aria-hidden="true"></th>${columns.map(
              (column) => sortHeaderTemplate(column, textValue),
            )}</tr
          ><tr class="gdp-csv-filter-row"><th
              class="gdp-csv-row-number"
              aria-hidden="true"
            ></th>${columns.map((column) => filterTemplate(column, textValue))}</tr></thead
        ><tbody>${shown.map(
          (row) =>
            html`<tr><th class="gdp-csv-row-number" scope="row">${String(
              row.sourceIndex,
            )}</th>${row.cells.map((value) => html`<td>${value}</td>`)}</tr>`,
        )}${
          shown.length === 0
            ? html`<tr class="gdp-csv-empty-row"><td colspan=${columnCount + 1}
                >${textValue.noMatches}</td
              ></tr>`
            : nothing
        }</tbody></table></section>`;
  }

  function draw(): void {
    renderOwned(preview, previewTemplate());
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
