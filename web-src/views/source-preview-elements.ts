import { csvParseRows, tsvParseRows } from "d3-dsv";
import { iconSvg, SEARCH_16_PATH } from "../core/icons";
import { isImeComposing } from "../core/keyboard";
import { createMediaPlayer } from "./media-player";
import {
  type DelimitedPreviewFormat,
  type DelimitedPreviewText,
  delimitedPreviewText,
} from "./source-preview-i18n";

export type DelimitedPreviewElement = HTMLElement & {
  localize(): void;
};

export function renderDelimitedPreview(
  text: string,
  format: DelimitedPreviewFormat,
  getText: () => DelimitedPreviewText = () =>
    delimitedPreviewText("en", format),
): DelimitedPreviewElement {
  const preview: DelimitedPreviewElement = Object.assign(
    document.createElement("div"),
    { localize: () => undefined },
  );
  preview.className = "gdp-csv-preview";
  const parseRows = format === "tsv" ? tsvParseRows : csvParseRows;
  const rows = parseRows(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  if (rows.length === 0) return preview;

  const columnCount = rows.reduce(
    (largest, row) => Math.max(largest, row.length),
    0,
  );
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
  const columnFilters = Array.from({ length: columnCount }, () => "");
  let sortColumn: number | null = null;
  let sortDirection: "asc" | "desc" | null = null;
  let visibleCount = dataRows.length;
  let emptyCell: HTMLTableCellElement | null = null;

  const shell = document.createElement("section");
  shell.className = "gdp-csv-shell";

  const toolbar = document.createElement("div");
  toolbar.className = "gdp-csv-toolbar";
  const searchIcon = document.createElement("span");
  searchIcon.className = "gdp-csv-search-icon";
  searchIcon.setAttribute("aria-hidden", "true");
  searchIcon.innerHTML = iconSvg("octicon-search", SEARCH_16_PATH);
  const search = document.createElement("input");
  search.type = "search";
  search.className = "gdp-csv-search";
  search.autocomplete = "off";
  search.spellcheck = false;
  const status = document.createElement("span");
  status.className = "gdp-csv-result-count";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "gdp-csv-reset";
  toolbar.append(searchIcon, search, status, reset);

  const table = document.createElement("table");
  table.className = "gdp-csv-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const corner = document.createElement("th");
  corner.className = "gdp-csv-row-number";
  corner.setAttribute("aria-hidden", "true");
  headRow.appendChild(corner);
  const sortHeaders: Array<{
    cell: HTMLTableCellElement;
    button: HTMLButtonElement;
    label: HTMLSpanElement;
  }> = [];
  for (let column = 0; column < columnCount; column++) {
    const th = document.createElement("th");
    th.scope = "col";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gdp-csv-sort-button";
    button.dataset.csvSortColumn = String(column);
    const label = document.createElement("span");
    label.textContent = rows[0][column] ?? "";
    button.appendChild(label);
    button.addEventListener("click", () => {
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
      renderBody();
      button.focus();
    });
    th.appendChild(button);
    headRow.appendChild(th);
    sortHeaders.push({ cell: th, button, label });
  }
  thead.appendChild(headRow);

  const filterRow = document.createElement("tr");
  filterRow.className = "gdp-csv-filter-row";
  const filterCorner = document.createElement("th");
  filterCorner.className = "gdp-csv-row-number";
  filterCorner.setAttribute("aria-hidden", "true");
  filterRow.appendChild(filterCorner);
  const filterInputs: HTMLInputElement[] = [];
  for (let column = 0; column < columnCount; column++) {
    const th = document.createElement("th");
    const input = document.createElement("input");
    input.type = "search";
    input.className = "gdp-csv-column-filter";
    input.dataset.csvColumnFilter = String(column);
    input.autocomplete = "off";
    input.spellcheck = false;
    input.addEventListener("input", () => {
      columnFilters[column] = input.value;
      renderBody();
    });
    input.addEventListener("keydown", (event) => {
      if (isImeComposing(event) || event.key !== "Escape" || !input.value)
        return;
      input.value = "";
      columnFilters[column] = "";
      renderBody();
    });
    th.appendChild(input);
    filterRow.appendChild(th);
    filterInputs.push(input);
  }
  thead.appendChild(filterRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  table.appendChild(tbody);
  shell.append(toolbar, table);
  preview.appendChild(shell);

  function normalized(value: string): string {
    return value.trim().toLocaleLowerCase();
  }

  function activeStateCount(): number {
    return (
      (normalized(search.value) ? 1 : 0) +
      columnFilters.filter((value) => normalized(value)).length +
      (sortColumn === null ? 0 : 1)
    );
  }

  function localizedColumnLabel(
    column: number,
    textValue: DelimitedPreviewText,
  ) {
    return rows[0][column] || textValue.columnLabel(column + 1);
  }

  function syncLocalizedText(): void {
    const textValue = getText();
    toolbar.setAttribute("aria-label", textValue.searchLabel);
    search.placeholder = textValue.searchPlaceholder;
    search.setAttribute("aria-label", textValue.searchLabel);
    reset.textContent = textValue.resetLabel;
    reset.title = textValue.resetAction;
    reset.setAttribute("aria-label", textValue.resetAction);
    status.textContent = textValue.resultCount(visibleCount, dataRows.length);
    status.setAttribute("aria-label", textValue.resultCountLabel);
    if (emptyCell) emptyCell.textContent = textValue.noMatches;

    sortHeaders.forEach(({ cell, button }, column) => {
      const columnLabel = localizedColumnLabel(column, textValue);
      const active = sortColumn === column ? sortDirection : null;
      cell.setAttribute(
        "aria-sort",
        active === "asc"
          ? "ascending"
          : active === "desc"
            ? "descending"
            : "none",
      );
      button.dataset.sortDirection = active ?? "none";
      const action =
        active === "asc"
          ? textValue.sortDescending(columnLabel)
          : active === "desc"
            ? textValue.clearSort(columnLabel)
            : textValue.sortAscending(columnLabel);
      button.title = action;
      button.setAttribute("aria-label", action);
    });
    filterInputs.forEach((input, column) => {
      const columnLabel = localizedColumnLabel(column, textValue);
      input.placeholder = textValue.columnFilterPlaceholder;
      input.setAttribute(
        "aria-label",
        textValue.columnFilterLabel(columnLabel),
      );
    });
  }

  function renderBody(): void {
    const globalQuery = normalized(search.value);
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
    const visibleRows =
      sortColumn === null || sortDirection === null
        ? filtered
        : [...filtered].sort((a, b) => {
            const aValue = a.cells[sortColumn];
            const bValue = b.cells[sortColumn];
            if (!aValue && bValue) return 1;
            if (aValue && !bValue) return -1;
            const compared = collator.compare(aValue, bValue);
            if (compared === 0) return a.sourceIndex - b.sourceIndex;
            return sortDirection === "asc" ? compared : -compared;
          });

    tbody.replaceChildren();
    emptyCell = null;
    for (const row of visibleRows) {
      const tr = document.createElement("tr");
      const rowNumber = document.createElement("th");
      rowNumber.className = "gdp-csv-row-number";
      rowNumber.scope = "row";
      rowNumber.textContent = String(row.sourceIndex);
      tr.appendChild(rowNumber);
      for (const value of row.cells) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    if (visibleRows.length === 0) {
      const tr = document.createElement("tr");
      tr.className = "gdp-csv-empty-row";
      emptyCell = document.createElement("td");
      emptyCell.colSpan = columnCount + 1;
      tr.appendChild(emptyCell);
      tbody.appendChild(tr);
    }
    visibleCount = visibleRows.length;
    reset.disabled = activeStateCount() === 0;
    syncLocalizedText();
  }

  search.addEventListener("input", renderBody);
  search.addEventListener("keydown", (event) => {
    if (isImeComposing(event) || event.key !== "Escape" || !search.value)
      return;
    search.value = "";
    renderBody();
  });
  reset.addEventListener("click", () => {
    search.value = "";
    columnFilters.fill("");
    filterInputs.forEach((input) => {
      input.value = "";
    });
    sortColumn = null;
    sortDirection = null;
    renderBody();
    search.focus();
  });
  preview.localize = syncLocalizedText;
  renderBody();
  return preview;
}

export function renderHtmlPreviewFrame(
  title: string,
  html: string,
  extraClass = "",
): HTMLElement {
  const preview = document.createElement("div");
  preview.className = ["gdp-html-preview", extraClass]
    .filter(Boolean)
    .join(" ");
  const frame = document.createElement("iframe");
  frame.title = title;
  frame.sandbox.value = "";
  frame.referrerPolicy = "no-referrer";
  frame.srcdoc = html;
  preview.appendChild(frame);
  return preview;
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
  if (opts.kind === "video" || opts.kind === "audio") {
    view.appendChild(createMediaPlayer(opts.url, opts.kind, opts.title));
  } else if (opts.kind === "pdf") {
    const frame = document.createElement("iframe");
    frame.src = opts.url;
    frame.title = opts.title;
    frame.loading = "lazy";
    view.appendChild(frame);
  } else {
    const img = document.createElement("img");
    img.src = opts.url;
    img.alt = "";
    if (opts.onImageLoad) {
      img.addEventListener("load", () => opts.onImageLoad?.(img), {
        once: true,
      });
    }
    view.appendChild(img);
  }
}

export function renderUnsupportedPreview(opts: {
  className?: string;
  message: string;
  extraChildren?: Node[];
}): HTMLElement {
  const view = document.createElement("div");
  view.className = ["gdp-source-viewer unsupported", opts.className || ""]
    .filter(Boolean)
    .join(" ");
  const content = document.createElement("div");
  content.className = "gdp-source-unsupported-content";
  const title = document.createElement("strong");
  title.className = "gdp-source-unsupported-title";
  title.textContent = "Preview unavailable";
  const message = document.createElement("div");
  message.className = "gdp-source-unsupported-message";
  message.textContent = opts.message;
  content.append(title, message, ...(opts.extraChildren || []));
  view.appendChild(content);
  return view;
}
