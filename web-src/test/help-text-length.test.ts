// ヘルプの本文の長さ。使う人が読む説明なので、1 段落・1 項目は短く、1 節も
// 短くする (以前の本文は 1 段落に寸法・判定の細部・キーの一覧を詰め込み、
// 読めなかった)。細部は畳んだ「詳しく」かヘルプの外 (README・reference) へ。
//
// 決まり (言語ごと):
//   - 1 段落・1 項目・表の 1 行: 日本語 120 文字・英語 240 文字まで
//   - 1 項目は 2 文まで
//   - 1 節の本文: 日本語 600 文字・英語 1200 文字まで。「詳しく」の中・見出し・
//     コマンド・画像・リンクの行は数えない
//   - 導入手順は 1 手順に 1 行の動作・画像 1 枚・説明 1 文まで
//   - 寸法 (px) を書かない
// ボタンの名前は本物の各画面の i18n の値で組む (help-guides.ts の helpLabels)。

import { describe, expect, test } from "vitest";
import type { HelpStepSpec, HelpText } from "../views/help-blocks";
import {
  type AppHelpLabels,
  HELP_SECTIONS,
  type HelpSection,
  helpContent,
  helpLabels,
} from "../views/help-guides";
import type {
  HelpBlock,
  HelpLanguage,
  HelpSectionContent,
} from "../views/help-page";

const LIMIT: Record<HelpLanguage, { paragraph: number; section: number }> = {
  en: { paragraph: 240, section: 1200 },
  ja: { paragraph: 120, section: 600 },
};

/** app だけが持つ名前 (本物は app.ts の UI_TEXT の値)。 */
const APP_LABELS: Record<HelpLanguage, AppHelpLabels> = {
  en: {
    diff: "Diff",
    history: "History",
    worktree: "Worktrees",
    tools: "Tools",
    split: "split",
    unified: "unified",
    ignoreWs: "ws",
    hideTests: "no test",
    paletteKey: "⌘K",
  },
  ja: {
    diff: "差分",
    history: "履歴",
    worktree: "作業ツリー",
    tools: "ツール",
    split: "分割",
    unified: "統合",
    ignoreWs: "空白",
    hideTests: "テスト非表示",
    paletteKey: "⌘K",
  },
};

function content(lang: HelpLanguage): Record<HelpSection, HelpSectionContent> {
  return helpContent(lang, helpLabels(lang, APP_LABELS[lang]), {
    openSection: () => undefined,
    openAccountsSettings: () => undefined,
    toggleKeyboardShortcuts: () => undefined,
  });
}

/** 画面に出る文字 (部品の中の文字をつなぐ)。 */
function plain(text: HelpText): string {
  return (Array.isArray(text) ? text : [text])
    .map((part) => {
      if (typeof part === "string") return part;
      if ("code" in part) return part.code;
      if ("key" in part) return part.key;
      if ("ui" in part) return part.ui;
      return part.link;
    })
    .join("");
}

/** 文の数。日本語は「。」、英語は . ! ? で数え、終わりの印が無い文も 1 つ。 */
function sentences(text: string, lang: HelpLanguage): number {
  const ends =
    lang === "ja"
      ? (text.match(/。/g) ?? []).length
      : (text.match(/[.!?](?=\s|$|\))/g) ?? []).length;
  const closed = lang === "ja" ? /。$/ : /[.!?]\)?$/;
  return ends + (closed.test(text.trim()) ? 0 : 1);
}

type Piece = { where: string; text: string; item: boolean; folded: boolean };

/** 節の中の文を全部 (畳んだ中も、印を付けて) 集める。 */
function pieces(section: HelpSection, body: HelpSectionContent): Piece[] {
  const out: Piece[] = [
    {
      where: `${section} intro`,
      text: plain(body.intro),
      item: false,
      folded: false,
    },
  ];
  const walk = (
    blocks: readonly HelpBlock[],
    where: string,
    folded: boolean,
  ) => {
    for (const block of blocks) {
      const add = (text: HelpText, item: boolean) =>
        out.push({ where, text: plain(text), item, folded });
      if (block.kind === "paragraph") add(block.text, false);
      if (block.kind === "list")
        for (const item of block.items) add(item, true);
      if (block.kind === "steps")
        for (const item of block.items)
          add(typeof item === "string" ? item : (item.text ?? ""), true);
      if (block.kind === "note")
        for (const paragraph of block.paragraphs) add(paragraph, false);
      if (block.kind === "table")
        for (const row of block.rows) add(row.map(plain).join(" "), true);
      if (block.kind === "install")
        for (const step of block.steps) add(step, true);
      if (block.kind === "details")
        walk(block.blocks, `${where} (details)`, true);
    }
  };
  walk(body.lead ?? [], `${section} lead`, false);
  for (const group of body.groups)
    walk(group.blocks, `${section} › ${group.title}`, false);
  return out;
}

describe.each<HelpLanguage>(["en", "ja"])("help text in %s", (lang) => {
  const sections = content(lang);
  const all = HELP_SECTIONS.flatMap((section) =>
    pieces(section, sections[section]),
  );

  test("every paragraph, item and table row is short enough", () => {
    expect(
      all
        .filter(({ text }) => [...text].length > LIMIT[lang].paragraph)
        .map(({ where, text }) => `${where}: ${[...text].length} ${text}`),
    ).toEqual([]);
  });

  test("every item is at most two sentences", () => {
    expect(
      all
        .filter(({ text, item }) => item && sentences(text, lang) > 2)
        .map(({ where, text }) => `${where}: ${text}`),
    ).toEqual([]);
  });

  test("every section body, without the folded details, is short enough", () => {
    expect(
      HELP_SECTIONS.map((section) => [
        section,
        pieces(section, sections[section])
          .filter(({ folded }) => !folded)
          .reduce((sum, { text }) => sum + [...text].length, 0),
      ]).filter(([, length]) => (length as number) > LIMIT[lang].section),
    ).toEqual([]);
  });

  test("no text gives sizes in pixels", () => {
    expect(
      all
        .filter(({ text }) => /\d+\s?px\b/.test(text))
        .map(({ where, text }) => `${where}: ${text}`),
    ).toEqual([]);
  });

  test("each getting-started step is one action, one capture and one sentence", () => {
    const steps = (sections["getting-started"].lead ?? []).flatMap((block) =>
      block.kind === "steps" ? block.items : [],
    ) as HelpStepSpec[];
    expect(
      steps
        .filter(
          (step) =>
            step.title === undefined ||
            (step.figures ?? []).length !== 1 ||
            sentences(plain(step.text ?? ""), lang) !== 1,
        )
        .map((step) => plain(step.title ?? "(no title)")),
    ).toEqual([]);
    expect(steps.length).toBe(10);
  });
});
