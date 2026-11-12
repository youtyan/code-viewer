// ヘルプの本文の部品: 段落・箇条書き・番号つきの手順・画像・注意と補足・コマンド・
// キー・見出しつきの補足・表。見た目の決まり (幅・文字・行間・余白) は style.css の
// 「設定とヘルプのページの文字と部品」の節が持ち、ここは DOM の形だけを決める。本文を
// 書く側 (help-page.ts・help-guides.ts) は helpBlocks(lang) の関数を呼んで中身を入れる
// (.agents/skills/project-rules/references/ui-surface.md の「Help ページ」)。
//
// どの部品もテンプレートを返す。描くのは置く側 (本文・キーの小窓・入れ方の案内)。

import { ref } from "lit/directives/ref.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { until } from "lit/directives/until.js";
import { html, nothing, type TemplateResult } from "lit/html.js";
import { showCopyFailure, showHighlightFailure } from "../core/copy-failure";
import { errorWithCause } from "../core/error-detail";
import {
  ALERT_16_PATH,
  CHECK_16_PATHS,
  COPY_16_PATHS,
  INFO_16_PATH,
} from "../core/icons";
import {
  highlightToInnerHtml,
  loadShikiHighlighter,
} from "../core/shiki-loader";
import { HELP_CAPTURE_WIDTH, type HelpFigure } from "./help-images";
import type { HelpLanguage } from "./help-page";
import { terminalText } from "./terminal/i18n";
import { openImageLightbox } from "./terminal/image-lightbox";
import { defineElement } from "./ui/element";
import { iconTemplate } from "./ui/icon";

/**
 * 文の中に置けるもの。文字列はそのまま、`code` は等幅の短いコード、`key` は
 * キーキャップ 1 つ (⌘K のように組み合わせも 1 つ)、`ui` は画面のボタン・画面の
 * 名前 (太字。文字は各画面の i18n の値を渡す)、`link` は押すと open を呼ぶリンク
 * (href は中ボタン・コピー用)。
 */
export type HelpInline =
  | string
  | { code: string }
  | { key: string }
  | { ui: string }
  | { link: string; href: string; open?(): void };

/** 1 つの文。部品を並べるときは配列にする。 */
export type HelpText = HelpInline | readonly HelpInline[];

/**
 * 番号つきの手順の 1 つ。上から 1 行の動作 (title)・コマンド・画像・説明の文・
 * ほかの節へのリンクの順に置く。どれも省ける。title が無ければ説明の文が先頭の
 * 行になる (番号の丸の横。コマンドと画像はその下)。
 */
export type HelpStepSpec = {
  title?: HelpText;
  command?: string;
  figures?: readonly HelpFigure[];
  text?: HelpText;
  link?: HelpText;
};

export type HelpNoteKind = "warning" | "info";

type HelpBlocksText = {
  note: Record<HelpNoteKind, string>;
  subsection: string;
  copyCommand: string;
  /** キーの一覧の表の見出しの行。 */
  keyTableHead: readonly [string, string];
};

const HELP_BLOCKS_TEXT: Record<HelpLanguage, HelpBlocksText> = {
  en: {
    note: { warning: "Caution", info: "Note" },
    subsection: "Additional notes",
    copyCommand: "Copy the command",
    keyTableHead: ["Key", "Action"],
  },
  ja: {
    note: { warning: "注意", info: "補足" },
    subsection: "補足",
    copyCommand: "コマンドをコピー",
    keyTableHead: ["キー", "操作"],
  },
};

/** コピーできた印 (チェック) を出しておく時間。 */
const COPIED_MARK_MS = 1200;

export const CV_HELP_COMMAND_COPY = "cv-help-command-copy";

function inlineTemplate(part: HelpInline): unknown {
  if (typeof part === "string") return part;
  if ("code" in part) return html`<code>${part.code}</code>`;
  if ("key" in part) return helpKey(part.key);
  if ("ui" in part) return html`<b class="gdp-help-ui">${part.ui}</b>`;
  const open = part.open;
  if (!open)
    return html`<a href=${part.href} target="_blank" rel="noopener noreferrer"
      >${part.link}</a
    >`;
  return html`<a
    href=${part.href}
    @click=${(event: MouseEvent) => {
      // 中ボタン・⌘/Ctrl はブラウザに任せる (別のタブで開く)。
      if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      open();
    }}
  >${part.link}</a>`;
}

/** 文を並びにする (段落・手順・表の中で使う)。 */
export function helpInline(text: HelpText): unknown[] {
  return (Array.isArray(text) ? text : [text]).map(inlineTemplate);
}

/** キーキャップ 1 つ。 */
export function helpKey(key: string): TemplateResult {
  return html`<kbd class="gdp-help-key">${key}</kbd>`;
}

function paragraph(text: HelpText, className?: string): TemplateResult {
  return html`<p class=${className ?? nothing}>${helpInline(text)}</p>`;
}

/** 画像を覆いの上に大きく出す。同じ本文の画像を並びにして ←→ で移れる。 */
function openFigure(anchor: HTMLAnchorElement, lang: HelpLanguage): void {
  const scope = anchor.closest(".gdp-help-content") ?? anchor.parentElement;
  const anchors = scope
    ? [...scope.querySelectorAll<HTMLAnchorElement>("a.gdp-help-figure")]
    : [anchor];
  const images = anchors.map((item) => ({
    url: item.href,
    name: item.querySelector("img")?.alt ?? "",
  }));
  openImageLightbox(
    { images, index: Math.max(anchors.indexOf(anchor), 0) },
    terminalText(lang),
  );
}

function figure(lang: HelpLanguage, item: HelpFigure): TemplateResult {
  // 縦横の比で、画像が届く前から箱を取る (style.css の .gdp-help-figure)。
  return html`<a
    class="gdp-help-figure"
    href=${item.src}
    target="_blank"
    rel="noopener"
    style=${`--help-figure-ratio: ${HELP_CAPTURE_WIDTH / item.height};`}
    @click=${(event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey
      )
        return;
      event.preventDefault();
      openFigure(event.currentTarget as HTMLAnchorElement, lang);
    }}
  ><img src=${item.src} alt=${item.alt} loading="lazy" decoding="async"
  /></a>`;
}

/**
 * コマンドのコピーのボタン。写せたら印をチェックに替え、少ししたら戻す (形は
 * 変えず、印だけ替える。押した後にボタンの箱を動かさない)。
 */
export function defineCvHelpCommandCopy(): void {
  defineElement(
    CV_HELP_COMMAND_COPY,
    (Base) =>
      class extends Base {
        static props = ["text", "label"];
        declare text: string;
        declare label: string;
        #copied = false;

        #copy = async (event: Event) => {
          const button = event.currentTarget as HTMLButtonElement;
          try {
            await navigator.clipboard.writeText(this.text);
            this.#copied = true;
            this.renderNow();
            setTimeout(() => {
              this.#copied = false;
              this.renderNow();
            }, COPIED_MARK_MS);
          } catch (error) {
            showCopyFailure(
              button,
              "copying the help command failed",
              error,
              this.label,
              COPIED_MARK_MS,
            );
          }
        };

        protected template() {
          return html`<button
            type="button"
            class="gdp-help-command-copy"
            title=${this.label}
            aria-label=${this.label}
            data-copied=${this.#copied ? "true" : nothing}
            @click=${this.#copy}
          >${
            this.#copied
              ? iconTemplate(CHECK_16_PATHS, "octicon-check")
              : iconTemplate(COPY_16_PATHS, "octicon-copy")
          }</button>`;
        }
      },
  );
}

/**
 * コピーのボタンつきのコマンドの箱。ヘルプの本文と、画面で入れ方を出す所
 * (install-help.ts) が同じものを使う。色付けは届いてから差し替える (届くまでと
 * 失敗したときは、色の無いコードのまま。失敗は箱の title と console に出す)。
 */
export function command(
  lang: HelpLanguage,
  text: string,
  title?: string,
  language: "bash" | "json" = "bash",
): TemplateResult {
  defineCvHelpCommandCopy();
  let pre: HTMLElement | undefined;
  const plain = html`<code>${text}</code>`;
  const highlighted = loadShikiHighlighter({
    langs: ["bash", "json"],
    failureMode: "throw",
  })
    .then((highlighter) => {
      const code = highlightToInnerHtml(text, language, highlighter);
      if (!code && text)
        throw new Error(`No highlighted HTML for the ${language} help code`);
      return code ? unsafeHTML(code) : plain;
    })
    .catch((error: unknown) => {
      if (!pre)
        throw errorWithCause(
          `the ${language} help code was not drawn before highlighting finished`,
          error,
        );
      showHighlightFailure(
        pre,
        `Highlighting the ${language} help code failed`,
        error,
      );
      return plain;
    });
  const label = HELP_BLOCKS_TEXT[lang].copyCommand;
  return html`<div class="gdp-help-command">${
    title ? html`<div class="gdp-help-command-title">${title}</div>` : nothing
  }<div class="gdp-help-command-body"><pre
    data-language=${language}
    ${ref((element) => {
      if (element instanceof HTMLElement) pre = element;
    })}
  >${until(highlighted, plain)}</pre><cv-help-command-copy
    .text=${text}
    .label=${label}
  ></cv-help-command-copy></div></div>`;
}

function steps(
  lang: HelpLanguage,
  items: readonly (string | HelpStepSpec)[],
): TemplateResult {
  return html`<ol class="gdp-help-steps">${items.map((item) => {
    const spec: HelpStepSpec = typeof item === "string" ? { text: item } : item;
    const text =
      spec.text === undefined
        ? nothing
        : paragraph(spec.text, "gdp-help-step-text");
    const titled = spec.title !== undefined;
    return html`<li>${
      spec.title !== undefined
        ? paragraph(spec.title, "gdp-help-step-title")
        : text
    }${spec.command !== undefined ? command(lang, spec.command) : nothing}${(
      spec.figures ?? []
    ).map((entry) => figure(lang, entry))}${titled ? text : nothing}${
      spec.link !== undefined
        ? paragraph(spec.link, "gdp-help-step-link")
        : nothing
    }</li>`;
  })}</ol>`;
}

function note(
  lang: HelpLanguage,
  kind: HelpNoteKind,
  paragraphs: readonly HelpText[],
): TemplateResult {
  return html`<aside class="gdp-help-note" data-kind=${kind}><span
      class="gdp-help-note-icon"
    >${iconTemplate(
      kind === "warning" ? ALERT_16_PATH : INFO_16_PATH,
      "gdp-help-note-mark",
    )}</span><div class="gdp-help-note-body"><strong class="gdp-help-note-label"
        >${HELP_BLOCKS_TEXT[lang].note[kind]}</strong
      >${paragraphs.map((text) => paragraph(text))}</div></aside>`;
}

function subsection(
  lang: HelpLanguage,
  body: readonly unknown[],
  title?: string,
): TemplateResult {
  return html`<section class="gdp-help-subsection"><h4
      >${title ?? HELP_BLOCKS_TEXT[lang].subsection}</h4
    ><div class="gdp-help-subsection-body">${body}</div></section>`;
}

function list(items: readonly HelpText[]): TemplateResult {
  return html`<ul class="gdp-help-list">${items.map(
    (item) => html`<li>${helpInline(item)}</li>`,
  )}</ul>`;
}

/**
 * 行が多い表 (この行数から) は 1 行おきに薄い面を敷き、目で行を追えるようにする
 * (style.css の .ui-table-striped)。
 */
export const UI_TABLE_STRIPE_MIN_ROWS = 8;

/**
 * 表の決まり (style.css の .ui-table: 見出しの行・はっきりした行の区切り・長い表の縞)
 * で表を組む。rowHeaders なら各行の 1 つ目の欄は行の見出し (th)。
 */
function uiTable(
  head: readonly unknown[] | undefined,
  rows: readonly (readonly unknown[])[],
  options: { className: string; rowHeaders?: boolean },
): TemplateResult {
  const striped = rows.length >= UI_TABLE_STRIPE_MIN_ROWS;
  return html`<table
    class=${`ui-table ${options.className}${striped ? " ui-table-striped" : ""}`}
  >${
    head
      ? html`<thead><tr>${head.map(
          (cell) => html`<th scope="col">${cell}</th>`,
        )}</tr></thead>`
      : nothing
  }<tbody>${rows.map(
    (row) =>
      html`<tr>${row.map((cell, index) =>
        options.rowHeaders === true && index === 0
          ? html`<th scope="row">${cell}</th>`
          : html`<td>${cell}</td>`,
      )}</tr>`,
  )}</tbody></table>`;
}

function table(
  rows: readonly (readonly HelpText[])[],
  head?: readonly HelpText[],
): TemplateResult {
  return uiTable(
    head?.map(helpInline),
    rows.map((row) => row.map(helpInline)),
    { className: "gdp-help-table" },
  );
}

/**
 * キーの一覧の表 (ヘルプのキーボードショートカット・キーの小窓)。左の列はキー
 * (" / " で区切った押し方をキーキャップに分ける)、右の列は説明。head は見出しの行
 * (キー / 操作)。
 */
export function renderHelpTable(
  rows: Array<[string, string]>,
  head?: readonly [string, string],
): TemplateResult {
  return uiTable(
    head,
    rows.map(([keys, description]) => [
      keys
        .split(" / ")
        .flatMap((key, index) =>
          index > 0 ? [" / ", helpKey(key)] : [helpKey(key)],
        ),
      description,
    ]),
    { className: "ui-table-keys", rowHeaders: true },
  );
}

/** その言語のヘルプの部品。返す関数はどれも 1 つの要素のテンプレートを返す。 */
export function helpBlocks(lang: HelpLanguage) {
  return {
    paragraph: (text: HelpText) => paragraph(text),
    list,
    steps: (items: readonly (string | HelpStepSpec)[]) => steps(lang, items),
    figure: (item: HelpFigure) => figure(lang, item),
    note: (kind: HelpNoteKind, paragraphs: readonly HelpText[]) =>
      note(lang, kind, paragraphs),
    command: (text: string, title?: string, language?: "bash" | "json") =>
      command(lang, text, title, language),
    key: helpKey,
    subsection: (body: readonly unknown[], title?: string) =>
      subsection(lang, body, title),
    table,
    keyTable: (rows: Array<[string, string]>) =>
      renderHelpTable(rows, HELP_BLOCKS_TEXT[lang].keyTableHead),
  };
}
