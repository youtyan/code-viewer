// Markdown のプレビュー (core/markdown-preview.ts) が作る要素の形。本文は
// markdown-it が返した HTML で、ここではそれを入れる箱と、後から足す部品
// (チェックボックス・コードのコピー・目次・図の失敗の表示・図の拡大の窓) の形を持つ。

import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { html, nothing } from "lit/html.js";
import { CHECK_16_PATHS, COPY_16_PATHS } from "../core/icons";
import { iconTemplate } from "./ui/icon";

export type MarkdownTocEntry = { id: string; level: number; text: string };

export type MermaidErrorProps = {
  title: string;
  detail: string;
  /** 図の元の文。無いと「元の文」の欄を出さない。 */
  source: string;
  sourceLabel: string;
};

export type MermaidLightboxButton = {
  label: string;
  title: string;
  onPress: () => void;
};

export type MarkdownPreviewView = {
  /** 本文の箱。html は markdown-it が返したもの (無いときは空の箱)。 */
  body(html: string | null): unknown;
  /** 目次と本文を並べる枠。 */
  layout(toc: Element, body: Element): unknown;
  toc(label: string, entries: readonly MarkdownTocEntry[]): unknown;
  taskCheckbox(checked: boolean): unknown;
  /** コードのコピー。copied のあいだは済みの絵。 */
  codeCopy(props: {
    label: string;
    copied: boolean;
    onCopy: (button: HTMLButtonElement) => void;
  }): unknown;
  mermaidError(props: MermaidErrorProps): unknown;
  /** 図の拡大の窓。図 (svg) は写したものをそのまま置く。 */
  mermaidLightbox(props: {
    svg: SVGSVGElement;
    hint: string;
    buttons: readonly MermaidLightboxButton[];
  }): unknown;
};

export const DEFAULT_VIEW: MarkdownPreviewView = {
  body: (markup) =>
    html`<div class="gdp-markdown-preview markdown-body"
      >${markup === null ? nothing : unsafeHTML(markup)}</div
    >`,
  layout: (toc, body) =>
    html`<div class="gdp-markdown-layout">${toc}${body}</div>`,
  toc: (label, entries) =>
    html`<nav class="gdp-markdown-toc table-of-contents" aria-label=${label}
      ><ul
        >${entries.map(
          (entry) =>
            html`<li class=${`level-${entry.level}`}
              ><a
                href=${`#${encodeURIComponent(entry.id)}`}
                data-target=${entry.id}
                title=${entry.text}
                >${entry.text}</a
              ></li
            >`,
        )}</ul
      ></nav
    >`,
  taskCheckbox: (checked) =>
    html`<input type="checkbox" disabled .checked=${checked} />`,
  codeCopy: ({ label, copied, onCopy }) =>
    html`<button
      type="button"
      class="mkdp-code-copy"
      aria-label=${label}
      title=${label}
      @click=${(event: MouseEvent) =>
        onCopy(event.currentTarget as HTMLButtonElement)}
    >${
      copied
        ? iconTemplate(CHECK_16_PATHS, "octicon-check")
        : iconTemplate(COPY_16_PATHS, "octicon-copy")
    }</button>`,
  mermaidError: ({ title, detail, source, sourceLabel }) =>
    html`<div class="mkdp-mermaid-error"
      ><div class="mkdp-mermaid-error-title">${title}</div
      ><pre class="mkdp-mermaid-error-detail">${detail}</pre
      >${
        source
          ? html`<details class="mkdp-mermaid-error-srcwrap"
              ><summary>${sourceLabel}</summary
              ><pre class="mkdp-mermaid-error-source">${source}</pre></details
            >`
          : nothing
      }</div
    >`,
  mermaidLightbox: ({ svg, hint, buttons }) =>
    html`<div class="mkdp-lightbox"
      ><div class="mkdp-lightbox-stage">${svg}</div
      ><div class="mkdp-lightbox-toolbar"
        >${buttons.map(
          (button) =>
            html`<button
              type="button"
              title=${button.title}
              @click=${(event: MouseEvent) => {
                event.stopPropagation();
                button.onPress();
              }}
            >${button.label}</button>`,
        )}</div
      ><div class="mkdp-lightbox-hint">${hint}</div></div
    >`,
};
