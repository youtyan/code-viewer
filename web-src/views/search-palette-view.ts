// ファイル・文字の検索のパレットの表示。search-palette-ui.ts (presenter) が
// 渡す値 (PaletteViewProps) だけから、重ね合わせの層に描く。

import { html, nothing, type TemplateResult } from "lit/html.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { live } from "lit/directives/live.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { FuzzyRange } from "../core/fuzzy-search";
import { FILE_16_PATH, SEARCH_16_PATH } from "../core/icons";
import { iconTemplate } from "./ui/icon";

export type PaletteRowProps =
  | {
      kind: "command";
      index: number;
      iconHtml: string;
      title: string;
      ranges: FuzzyRange[];
      detail: string;
      status: string | null;
      statusTone: string | undefined;
      shortcut: string | null;
    }
  | {
      kind: "file";
      index: number;
      name: string;
      path: string;
      ranges: FuzzyRange[];
      oldPath: string | null;
    }
  | { kind: "grep"; index: number; title: string; preview: string };

export type PaletteListEntry =
  | { kind: "heading"; text: string }
  | { kind: "row"; row: PaletteRowProps }
  | {
      kind: "file-group";
      path: string;
      count: number;
      rows: PaletteRowProps[];
    };

export type PaletteToggle = {
  label: string;
  title?: string;
  pressed: boolean;
  disabled: boolean;
  onPress(): void;
};

export type PaletteViewProps = {
  mode: "file" | "grep";
  width: number | null;
  height: number | null;
  modeSwitch: { mode: "file" | "grep"; label: string; title: string }[];
  /** 開いたときの入力 (打った文字は欄が持つ)。 */
  initialQuery: string;
  placeholder: string;
  controls: PaletteToggle[];
  pin: { label: string; title: string } | null;
  hint: string;
  status: unknown;
  entries: PaletteListEntry[];
  selected: number;
  previewLabel: string;
  footer: { keys: string; label: string }[];
  resizeWidthLabel: string;
  resizeHeightLabel: string;
  onBackdropMouseDown(event: MouseEvent): void;
  onSwitchMode(mode: "file" | "grep"): void;
  onInput(): void;
  onKeydown(event: KeyboardEvent): void;
  onCompositionStart(): void;
  onCompositionEnd(): void;
  onPin(): void;
  onRowPointer(index: number, event: MouseEvent): void;
  onRowMouseDown(index: number, event: MouseEvent): void;
  onRowOpen(index: number, event: MouseEvent): void;
};

function highlighted(text: string, ranges: FuzzyRange[]): unknown[] {
  const parts: unknown[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) parts.push(text.slice(cursor, range.start));
    parts.push(html`<mark>${text.slice(range.start, range.end)}</mark>`);
    cursor = range.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function rowTemplate(
  props: PaletteViewProps,
  row: PaletteRowProps,
): TemplateResult {
  const content =
    row.kind === "command"
      ? html`<span class="gdp-palette-row-icon">${unsafeHTML(row.iconHtml)}</span
          ><span class="gdp-palette-row-title">${highlighted(row.title, row.ranges)}</span
          ><span class="gdp-palette-row-detail">${row.detail}</span>${
            row.status
              ? html`<span
                  class="gdp-palette-row-status"
                  data-tone=${ifDefined(row.statusTone || undefined)}
                >${row.status}</span>`
              : nothing
          }${
            row.shortcut
              ? html`<kbd class="gdp-palette-row-key">${row.shortcut}</kbd>`
              : nothing
          }`
      : row.kind === "file"
        ? html`<span class="gdp-palette-row-icon">${iconTemplate(FILE_16_PATH, "gdp-palette-icon")}</span
            ><span class="gdp-palette-row-title">${row.name}</span
            ><span class="gdp-palette-row-detail">${highlighted(row.path, row.ranges)}${
              row.oldPath ? `  ${row.oldPath}` : nothing
            }</span>`
        : html`<span class="gdp-palette-row-title">${row.title}</span
            ><span class="gdp-palette-row-detail">${row.preview}</span>`;
  return html`<button
    type="button"
    id=${`gdp-palette-item-${row.index}`}
    data-palette-index=${row.index}
    class=${`gdp-palette-row gdp-palette-row-${row.kind}`}
    role="option"
    aria-selected=${row.index === props.selected ? "true" : "false"}
    @mousemove=${(event: MouseEvent) => props.onRowPointer(row.index, event)}
    @mousedown=${(event: MouseEvent) => props.onRowMouseDown(row.index, event)}
    @click=${(event: MouseEvent) => props.onRowOpen(row.index, event)}
    @auxclick=${(event: MouseEvent) => props.onRowOpen(row.index, event)}
  >${content}</button>`;
}

function entryTemplate(
  props: PaletteViewProps,
  entry: PaletteListEntry,
): unknown {
  if (entry.kind === "heading")
    return html`<div class="gdp-palette-group-heading" role="presentation">${entry.text}</div>`;
  if (entry.kind === "row") return rowTemplate(props, entry.row);
  return html`<section
    class="gdp-palette-file-group"
    role="group"
    aria-label=${entry.path}
  ><div class="gdp-palette-file-heading"><span
    class="gdp-palette-file-heading-name"
    title=${entry.path}
  >${entry.path}</span><span class="gdp-palette-file-heading-count">${entry.count}</span></div><div
    class="gdp-palette-file-matches"
  >${entry.rows.map((row) => rowTemplate(props, row))}</div></section>`;
}

function toggleTemplate(toggle: PaletteToggle): TemplateResult {
  return html`<button
    type="button"
    class="gdp-palette-mode-button"
    aria-pressed=${String(toggle.pressed)}
    title=${ifDefined(toggle.title || undefined)}
    ?disabled=${toggle.disabled}
    @mousedown=${(event: MouseEvent) => {
      event.preventDefault();
      toggle.onPress();
    }}
  >${toggle.label}</button>`;
}

/** パレットの既定の表示。 */
export function paletteTemplate(props: PaletteViewProps): TemplateResult {
  const style = [
    props.width === null ? "" : `width: ${props.width}px;`,
    props.height === null ? "" : `height: ${props.height}px;`,
  ].join(" ");
  return html`<div
    class="gdp-palette-backdrop gdp-palette-backdrop-wide"
    @mousedown=${(event: MouseEvent) => props.onBackdropMouseDown(event)}
  ><div
    class=${props.mode === "grep" ? "gdp-palette gdp-palette-wide gdp-palette-grep" : "gdp-palette gdp-palette-wide"}
    role="dialog"
    aria-modal="true"
    style=${ifDefined(style.trim() || undefined)}
  ><div class="gdp-palette-label">${props.modeSwitch.map(
    (item) => html`<button
      type="button"
      class="gdp-palette-mode-button gdp-palette-mode-switch"
      aria-pressed=${String(item.mode === props.mode)}
      title=${item.title}
      @mousedown=${(event: MouseEvent) => {
        event.preventDefault();
        props.onSwitchMode(item.mode);
      }}
    >${item.label}</button>`,
  )}</div><div class="gdp-palette-input-row">${iconTemplate(SEARCH_16_PATH, "gdp-palette-input-icon")}<input
    class="gdp-palette-input"
    type="search"
    autocomplete="off"
    spellcheck="false"
    placeholder=${props.placeholder}
    role="combobox"
    aria-expanded="true"
    aria-controls="gdp-palette-list"
    aria-label=${props.placeholder}
    aria-activedescendant=${live(props.selected >= 0 ? `gdp-palette-item-${props.selected}` : "")}
    .value=${props.initialQuery}
    @compositionstart=${() => props.onCompositionStart()}
    @compositionend=${() => props.onCompositionEnd()}
    @input=${() => props.onInput()}
    @keydown=${(event: KeyboardEvent) => props.onKeydown(event)}
  /><kbd class="gdp-palette-input-key">Esc</kbd></div><div class="gdp-palette-controls">${props.controls.map(
    toggleTemplate,
  )}${
    props.pin
      ? html`<button
          type="button"
          class="gdp-palette-mode-button gdp-palette-pin"
          title=${props.pin.title}
          @mousedown=${(event: MouseEvent) => {
            event.preventDefault();
            props.onPin();
          }}
        >${props.pin.label}</button>`
      : nothing
  }<span class="gdp-palette-mode-hint">${props.hint}</span></div><div class="gdp-palette-status">${props.status}</div><div
    class="gdp-palette-body"
  ><div id="gdp-palette-list" class="gdp-palette-list" role="listbox">${props.entries.map(
    (entry) => entryTemplate(props, entry),
  )}</div><div data-palette-preview aria-label=${props.previewLabel}></div></div><div
    class="gdp-palette-footer"
  >${props.footer.map(
    (item) =>
      html`<span class="gdp-palette-footer-hint"><kbd>${item.keys}</kbd>${item.label}</span>`,
  )}</div><div
    class="gdp-palette-resizer gdp-palette-resizer-x"
    role="separator"
    tabindex="0"
    aria-orientation="vertical"
    aria-label=${props.resizeWidthLabel}
  ></div><div
    class="gdp-palette-resizer gdp-palette-resizer-y"
    role="separator"
    tabindex="0"
    aria-orientation="horizontal"
    aria-label=${props.resizeHeightLabel}
  ></div></div></div>`;
}
