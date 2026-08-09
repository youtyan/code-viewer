// shiki を lazy import する共通ローダ。markdown-preview / SQL editor /
// session log の SQL 表示など、shiki を使う全モジュールから呼ばれる単一の
// エントリポイント。
//
// 同一 (langs, themes) の組合せはプロセス内で 1 度しかロードされない
// (Promise キャッシュ)。bundle 自体も import の同一 specifier で 1 度しか
// 評価されないため、複数 view が異なる lang セットで呼んでも shiki.js の
// バンドル本体は使い回される。
//
// ロード失敗時は原因を呼び出し側へ伝播する。

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
const cache = new Map<string, Promise<ShikiHighlighter>>();

export function loadShikiHighlighter(
  options: ShikiLoaderOptions,
): Promise<ShikiHighlighter> {
  // langs は順序差を消した上で key 化する (["sql","bash"] と ["bash","sql"]
  // を同じキャッシュエントリと見なす)。
  const key = JSON.stringify({
    themes: [...options.themes].sort(),
    langs: [...options.langs].sort(),
  });
  const cached = cache.get(key);
  if (cached) return cached;
  const promise = loadShikiModule().then((mod) =>
    mod.createHighlighter({
      themes: options.themes,
      langs: options.langs,
    }),
  );
  cache.set(key, promise);
  return promise;
}
