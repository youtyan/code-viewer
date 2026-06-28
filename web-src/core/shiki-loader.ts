// shiki を lazy import する共通ローダ。markdown-preview / SQL editor /
// session log の SQL 表示など、shiki を使う全モジュールから呼ばれる単一の
// エントリポイント。
//
// 同一 (langs, themes) の組合せはプロセス内で 1 度しかロードされない
// (Promise キャッシュ)。bundle 自体も import の同一 specifier で 1 度しか
// 評価されないため、複数 view が異なる lang セットで呼んでも shiki.js の
// バンドル本体は使い回される。
//
// ロード失敗時は null を返す (呼び出し側は plain text フォールバック)。

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

const cache = new Map<string, Promise<ShikiHighlighter | null>>();

export function loadShikiHighlighter(
  options: ShikiLoaderOptions,
): Promise<ShikiHighlighter | null> {
  // langs は順序差を消した上で key 化する (["sql","bash"] と ["bash","sql"]
  // を同じキャッシュエントリと見なす)。
  const key = JSON.stringify({
    themes: [...options.themes].sort(),
    langs: [...options.langs].sort(),
  });
  const cached = cache.get(key);
  if (cached) return cached;
  // Keep the import specifier non-literal so Bun does not pull shiki into
  // the main bundle.
  const promise = import(`/${"shiki.js"}`)
    .then((mod: unknown) =>
      (mod as ShikiModule).createHighlighter({
        themes: options.themes,
        langs: options.langs,
      }),
    )
    .catch(() => null);
  cache.set(key, promise);
  return promise;
}
