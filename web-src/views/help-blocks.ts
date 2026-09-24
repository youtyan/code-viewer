// ヘルプの本文の部品: 段落・箇条書き・番号つきの手順・画像・注意と補足・コマンド・
// キー・畳める「詳しく」・表。見た目の決まり (幅・文字・行間・余白) は style.css の
// 「設定とヘルプのページの文字と部品」の節が持ち、ここは DOM の形だけを決める。本文を
// 書く側 (help-page.ts・help-guides.ts) は helpBlocks(lang) の関数を呼んで中身を入れる
// (.agents/skills/project-rules/references/ui-surface.md の「Help ページ」)。

import { showCopyFailure } from "../core/copy-failure";
import {
  ALERT_16_PATH,
  CHECK_16_PATHS,
  COPY_16_PATHS,
  INFO_16_PATH,
  iconSvg,
} from "../core/icons";
import type { HelpFigure } from "./help-images";
import type { HelpLanguage } from "./help-page";
import { terminalText } from "./terminal/i18n";
import { openImageLightbox } from "./terminal/image-lightbox";

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
  | { link: string; href: string; open(): void };

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
  details: string;
  copyCommand: string;
  /** キーの一覧の表の見出しの行。 */
  keyTableHead: readonly [string, string];
};

const HELP_BLOCKS_TEXT: Record<HelpLanguage, HelpBlocksText> = {
  en: {
    note: { warning: "Caution", info: "Note" },
    details: "More details",
    copyCommand: "Copy the command",
    keyTableHead: ["Key", "Action"],
  },
  ja: {
    note: { warning: "注意", info: "補足" },
    details: "詳しく",
    copyCommand: "コマンドをコピー",
    keyTableHead: ["キー", "操作"],
  },
};

/** コピーできた印 (チェック) を出しておく時間。 */
const COPIED_MARK_MS = 1200;

function inlineNode(part: HelpInline): Node {
  if (typeof part === "string") return document.createTextNode(part);
  if ("code" in part) {
    const code = document.createElement("code");
    code.textContent = part.code;
    return code;
  }
  if ("key" in part) return helpKey(part.key);
  if ("ui" in part) {
    const name = document.createElement("b");
    name.className = "gdp-help-ui";
    name.textContent = part.ui;
    return name;
  }
  const link = document.createElement("a");
  link.href = part.href;
  link.textContent = part.link;
  link.addEventListener("click", (event) => {
    // 中ボタン・⌘/Ctrl はブラウザに任せる (別のタブで開く)。
    if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    part.open();
  });
  return link;
}

/** 文を DOM の並びにする (段落・手順・表の中で使う)。 */
export function helpInline(text: HelpText): Node[] {
  return (Array.isArray(text) ? text : [text]).map(inlineNode);
}

/** キーキャップ 1 つ。 */
export function helpKey(key: string): HTMLElement {
  const kbd = document.createElement("kbd");
  kbd.className = "gdp-help-key";
  kbd.textContent = key;
  return kbd;
}

function paragraph(text: HelpText, className?: string): HTMLParagraphElement {
  const p = document.createElement("p");
  if (className) p.className = className;
  p.append(...helpInline(text));
  return p;
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

function figure(lang: HelpLanguage, item: HelpFigure): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = "gdp-help-figure";
  link.href = item.src;
  link.target = "_blank";
  link.rel = "noopener";
  const img = document.createElement("img");
  img.src = item.src;
  img.alt = item.alt;
  img.loading = "lazy";
  img.decoding = "async";
  link.appendChild(img);
  link.addEventListener("click", (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey)
      return;
    event.preventDefault();
    openFigure(link, lang);
  });
  return link;
}

function command(
  lang: HelpLanguage,
  text: string,
  title?: string,
): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "gdp-help-command";
  if (title) {
    const head = document.createElement("div");
    head.className = "gdp-help-command-title";
    head.textContent = title;
    wrap.appendChild(head);
  }
  const body = document.createElement("div");
  body.className = "gdp-help-command-body";
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = text;
  pre.appendChild(code);
  const label = HELP_BLOCKS_TEXT[lang].copyCommand;
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "gdp-help-command-copy";
  copy.title = label;
  copy.setAttribute("aria-label", label);
  copy.innerHTML = iconSvg("octicon-copy", COPY_16_PATHS);
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      // 形は変えず、印だけ替える (押した後にボタンの箱を動かさない)。
      copy.innerHTML = iconSvg("octicon-check", CHECK_16_PATHS);
      copy.dataset.copied = "true";
      setTimeout(() => {
        copy.innerHTML = iconSvg("octicon-copy", COPY_16_PATHS);
        delete copy.dataset.copied;
      }, COPIED_MARK_MS);
    } catch (error) {
      showCopyFailure(
        copy,
        "copying the help command failed",
        error,
        label,
        COPIED_MARK_MS,
      );
    }
  });
  body.append(pre, copy);
  wrap.appendChild(body);
  return wrap;
}

function steps(
  lang: HelpLanguage,
  items: readonly (string | HelpStepSpec)[],
): HTMLOListElement {
  const ol = document.createElement("ol");
  ol.className = "gdp-help-steps";
  for (const item of items) {
    const spec: HelpStepSpec = typeof item === "string" ? { text: item } : item;
    const li = document.createElement("li");
    const text =
      spec.text === undefined
        ? null
        : paragraph(spec.text, "gdp-help-step-text");
    if (spec.title !== undefined)
      li.appendChild(paragraph(spec.title, "gdp-help-step-title"));
    else if (text) li.appendChild(text);
    if (spec.command !== undefined) li.appendChild(command(lang, spec.command));
    for (const item of spec.figures ?? []) li.appendChild(figure(lang, item));
    if (spec.title !== undefined && text) li.appendChild(text);
    if (spec.link !== undefined)
      li.appendChild(paragraph(spec.link, "gdp-help-step-link"));
    ol.appendChild(li);
  }
  return ol;
}

function note(
  lang: HelpLanguage,
  kind: HelpNoteKind,
  paragraphs: readonly HelpText[],
): HTMLElement {
  const aside = document.createElement("aside");
  aside.className = "gdp-help-note";
  aside.dataset.kind = kind;
  const icon = document.createElement("span");
  icon.className = "gdp-help-note-icon";
  icon.innerHTML = iconSvg(
    "gdp-help-note-mark",
    kind === "warning" ? ALERT_16_PATH : INFO_16_PATH,
  );
  const content = document.createElement("div");
  content.className = "gdp-help-note-body";
  const label = document.createElement("strong");
  label.className = "gdp-help-note-label";
  label.textContent = HELP_BLOCKS_TEXT[lang].note[kind];
  content.append(label, ...paragraphs.map((text) => paragraph(text)));
  aside.append(icon, content);
  return aside;
}

function details(
  lang: HelpLanguage,
  body: readonly HTMLElement[],
  summary?: string,
): HTMLDetailsElement {
  const box = document.createElement("details");
  box.className = "gdp-help-details";
  const head = document.createElement("summary");
  head.textContent = summary ?? HELP_BLOCKS_TEXT[lang].details;
  const inner = document.createElement("div");
  inner.className = "gdp-help-details-body";
  inner.append(...body);
  box.append(head, inner);
  return box;
}

function list(items: readonly HelpText[]): HTMLUListElement {
  const ul = document.createElement("ul");
  ul.className = "gdp-help-list";
  for (const item of items) {
    const li = document.createElement("li");
    li.append(...helpInline(item));
    ul.appendChild(li);
  }
  return ul;
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
  head: readonly (readonly Node[])[] | undefined,
  rows: readonly (readonly (readonly Node[])[])[],
  options: { className: string; rowHeaders?: boolean },
): HTMLTableElement {
  const element = document.createElement("table");
  element.className = `ui-table ${options.className}`;
  element.classList.toggle(
    "ui-table-striped",
    rows.length >= UI_TABLE_STRIPE_MIN_ROWS,
  );
  if (head) {
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    for (const cell of head) {
      const th = document.createElement("th");
      th.scope = "col";
      th.append(...cell);
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    element.appendChild(thead);
  }
  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    row.forEach((cell, index) => {
      const header = options.rowHeaders === true && index === 0;
      const box = document.createElement(header ? "th" : "td");
      if (header) box.setAttribute("scope", "row");
      box.append(...cell);
      tr.appendChild(box);
    });
    tbody.appendChild(tr);
  }
  element.appendChild(tbody);
  return element;
}

function table(
  rows: readonly (readonly HelpText[])[],
  head?: readonly HelpText[],
): HTMLTableElement {
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
): HTMLTableElement {
  return uiTable(
    head?.map((label) => [document.createTextNode(label)]),
    rows.map(([keys, description]) => [
      keys
        .split(" / ")
        .flatMap((key, index) =>
          index > 0
            ? [document.createTextNode(" / "), helpKey(key)]
            : [helpKey(key)],
        ),
      [document.createTextNode(description)],
    ]),
    { className: "ui-table-keys", rowHeaders: true },
  );
}

/** その言語のヘルプの部品。返す関数はどれも 1 つの要素を返す。 */
export function helpBlocks(lang: HelpLanguage) {
  return {
    paragraph: (text: HelpText) => paragraph(text),
    list,
    steps: (items: readonly (string | HelpStepSpec)[]) => steps(lang, items),
    figure: (item: HelpFigure) => figure(lang, item),
    note: (kind: HelpNoteKind, paragraphs: readonly HelpText[]) =>
      note(lang, kind, paragraphs),
    command: (text: string, title?: string) => command(lang, text, title),
    key: helpKey,
    details: (body: readonly HTMLElement[], summary?: string) =>
      details(lang, body, summary),
    table,
    keyTable: (rows: Array<[string, string]>) =>
      renderHelpTable(rows, HELP_BLOCKS_TEXT[lang].keyTableHead),
  };
}
