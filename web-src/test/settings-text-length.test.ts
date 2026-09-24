// 設定の画面の説明文の長さ。1 段落は日本語 120 文字・英語 240 文字まで。
// 長い説明が目立つ位置にあり、何のための設定か読み取れなかった (JSON の
// 判定ルールの節・フックの節)。細部は畳んだ中かヘルプへ回す。
//
// 対象は設定の画面が使う文言の表すべて: 設定のフォーム (viewer-settings-i18n)・
// フックの節・アカウントの節 (帯・確認の画面と共有の表なので表ごと)・
// ショートカットの節。段落は文字列の中の改行で分ける。文言を返す関数は、
// どの引数にも短い代わりの値 ("x") を渡して、文の部分だけを測る (差し込む
// パスや理由の長さは文言の書き方では決まらないため)。

import { describe, expect, test } from "vitest";
import { agentsText } from "../views/agents/i18n";
import { SHORTCUT_SETTINGS_TEXT } from "../views/help-keybinding-editor";
import { VIEWER_SETTINGS_TEXT } from "../views/viewer-settings-i18n";

type Language = "en" | "ja";

const LIMIT: Record<Language, number> = { en: 240, ja: 120 };

/**
 * 長さを測らない文言と、その理由。表の名前 + 欄の道筋で書く。
 */
const EXCEPTIONS: Record<string, string> = {
  "settings.agentRulesGuideExample": "JSON の入力例 (コード。文ではない)",
};

/**
 * どんな使われ方をしても "x" として文字列に埋まる、引数の代わり。
 * 文言の関数は引数の欄を読んだり (issue.line)、比べたり (count === 1) するので、
 * 何を読んでも自分を返し、文字列にすると "x" になる値にする。
 */
const PLACEHOLDER: unknown = new Proxy(() => PLACEHOLDER, {
  get: (_target, key) => (key === Symbol.toPrimitive ? () => "x" : PLACEHOLDER),
  apply: () => PLACEHOLDER,
});

/** 表の中の文言を、[道筋, 文字列] で全部集める。 */
function collect(value: unknown, path: string): Array<[string, string]> {
  if (typeof value === "string") return [[path, value]];
  if (typeof value === "function") {
    const args = Array.from(
      { length: Math.max(value.length, 1) },
      () => PLACEHOLDER,
    );
    return collect(String(value(...args)), `${path}()`);
  }
  if (Array.isArray(value))
    return value.flatMap((item, index) => collect(item, `${path}[${index}]`));
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, item]) =>
      collect(item, `${path}.${key}`),
    );
  return [];
}

function tables(lang: Language): Array<[string, unknown]> {
  return [
    ["settings", VIEWER_SETTINGS_TEXT[lang]],
    ["hooks", agentsText(lang).hooks],
    ["accounts", agentsText(lang).accounts],
    ["shortcuts", SHORTCUT_SETTINGS_TEXT[lang]],
  ];
}

/** 上限を超える段落を「道筋 (文字数)」で並べる。 */
function tooLong(lang: Language): string[] {
  return tables(lang).flatMap(([name, table]) =>
    collect(table, name)
      .filter(([path]) => !(path.replace(/\(\)$/, "") in EXCEPTIONS))
      .flatMap(([path, text]) =>
        text
          .split("\n")
          .map((paragraph) => [...paragraph].length)
          .filter((length) => length > LIMIT[lang])
          .map((length) => `${path} (${length})`),
      ),
  );
}

describe("settings text", () => {
  test.each<Language>([
    "en",
    "ja",
  ])("no paragraph in %s is longer than the limit", (lang) => {
    expect(tooLong(lang)).toEqual([]);
  });

  // 例外の一覧が古くならないように: 挙げた欄が実在する。
  test("every exception names a text that exists", () => {
    const paths = new Set(
      (["en", "ja"] as const).flatMap((lang) =>
        tables(lang).flatMap(([name, table]) =>
          collect(table, name).map(([path]) => path.replace(/\(\)$/, "")),
        ),
      ),
    );
    expect(Object.keys(EXCEPTIONS).filter((path) => !paths.has(path))).toEqual(
      [],
    );
  });
});
