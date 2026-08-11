// shiki を lazy import する共通ローダ。markdown-preview / SQL editor /
// session log の SQL 表示など、shiki を使う全モジュールから呼ばれる単一の
// エントリポイント。
//
// 同一 (langs, themes) の組合せはプロセス内で 1 度しかロードされない
// (Promise キャッシュ)。bundle 自体も import の同一 specifier で 1 度しか
// 評価されないため、複数 view が異なる lang セットで呼んでも shiki.js の
// バンドル本体は使い回される。
//
// 通常はロード失敗時に null を返す。失敗を画面へ出す必要がある入力欄は
// failureMode: "throw" を使い、元の失敗を呼び出し側で保持する。

import { createBundleLoader } from "./lazy-bundle";

export type ShikiHighlighter = {
  codeToHtml: (
    code: string,
    options: {
      lang: string;
      themes: { light: string; dark: string };
      defaultColor: false;
    },
  ) => string;
};

export type ShikiLoaderOptions = {
  themes: string[];
  langs: string[];
  /** fallback は従来どおり null、throw は呼び出し側へ元の失敗を返す。 */
  failureMode?: "fallback" | "throw";
};

type ShikiModule = {
  createHighlighter: (options: ShikiLoaderOptions) => Promise<ShikiHighlighter>;
};

/** shiki の `<pre><code>…</code></pre>` 出力から、呼び出し側の自前 `<pre>` に
 * 流し込める innerHTML を取り出す。highlighter が null / code が空のときは
 * 空文字 (呼び出し側で textContent フォールバックする想定)。 */
export function highlightToInnerHtml(
  code: string,
  lang: string,
  highlighter: ShikiHighlighter | null,
): string {
  if (!highlighter || !code) return "";
  const html = highlighter.codeToHtml(code, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  });
  const template = document.createElement("template");
  template.innerHTML = html;
  const pre = template.content.querySelector("pre");
  return pre ? pre.innerHTML : "";
}

const loadShikiModule = createBundleLoader<ShikiModule>("shiki.js");
const cache = new Map<string, Promise<ShikiHighlighter | null>>();

export function loadShikiHighlighter(
  options: ShikiLoaderOptions,
): Promise<ShikiHighlighter | null> {
  // langs は順序差を消した上で key 化する (["sql","bash"] と ["bash","sql"]
  // を同じキャッシュエントリと見なす)。
  const key = JSON.stringify({
    themes: [...options.themes].sort(),
    langs: [...options.langs].sort(),
    failureMode: options.failureMode ?? "fallback",
  });
  const cached = cache.get(key);
  if (cached) return cached;
  const load = loadShikiModule().then((mod) =>
    mod.createHighlighter({
      themes: options.themes,
      langs: options.langs,
    }),
  );
  const promise =
    options.failureMode === "throw" ? load : load.catch(() => null);
  cache.set(key, promise);
  return promise;
}
