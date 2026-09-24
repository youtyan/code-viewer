// shiki に渡すこのアプリのテーマ。色は値ではなく名前の層の CSS 変数
// (`var(--syntax-*)`) にし、テーマ (core/color-themes.ts) と明暗を替えると
// ハイライトの色も CSS だけで替わる (ハイライトし直さない)。
//
// どの文法の部分をどの種類として塗るかは、shiki に同梱の github-dark の割り当て
// (tokenColors の scope) をそのまま借り、色だけを種類の名前へ差し替える。
// highlight.js の面 (差分など) の種類分けも同じ表に合わせてある (style.css の
// diff2html の節)。同じ種類はどの画面でも同じ名前を読む
// (shiki-theme.test.ts と diff-code-contrast.test.ts)。
//
// 明暗で同じテーマを使う (themes: { light, dark } の両方にこれを渡す) ので、
// 出力の span は `--shiki-light` と `--shiki-dark` に同じ var() を持ち、
// style.css の既存の規則 (`color: var(--shiki-light)` など) がそのまま効く。

export const SHIKI_THEME_NAME = "code-viewer";

/** codeToHtml に渡すテーマ。明暗とも同じ (色は CSS 変数なので明暗で替わる)。 */
export const SHIKI_THEMES = {
  light: SHIKI_THEME_NAME,
  dark: SHIKI_THEME_NAME,
} as const;

type TokenColor = {
  scope?: string | string[];
  settings: { foreground?: string; fontStyle?: string; background?: string };
};

export type ShikiThemeSource = {
  tokenColors?: TokenColor[];
};

export type ShikiTheme = {
  name: string;
  type: "dark";
  colors: Record<string, string>;
  tokenColors: TokenColor[];
};

/**
 * github-dark の色 → 種類の名前。キーワード・タグ名 / 文字列・正規表現 /
 * 定数・数値・組み込み・プロパティ名・見出し / 関数名・クラス名 / コメント /
 * 変数・記号。
 */
export const SHIKI_COLOR_TOKENS: Readonly<Record<string, string>> = {
  "#f97583": "--syntax-keyword",
  "#85e89d": "--syntax-keyword",
  "#9ecbff": "--syntax-string",
  "#dbedff": "--syntax-string",
  "#79b8ff": "--syntax-type",
  "#b392f0": "--syntax-function",
  "#6a737d": "--syntax-comment",
  "#e1e4e8": "--syntax-text",
  "#ffab70": "--syntax-text",
  // 括弧の強調・改行の印・無視された行 (ほとんど出ない)。
  "#d1d5da": "--syntax-text",
  "#24292e": "--syntax-text",
  "#2f363d": "--syntax-comment",
  // 壊れた書き方・削除の印。
  "#fdaeb7": "--diff-del-fg",
};

/** 差分の印は色ではなく scope で見分ける (追加は github ではタグ名と同じ色)。 */
const SCOPE_TOKENS: ReadonlyArray<[RegExp, string]> = [
  [/^markup\.inserted|punctuation\.definition\.inserted/, "--diff-add-fg"],
  [/^markup\.deleted|punctuation\.definition\.deleted/, "--diff-del-fg"],
];

function scopes(item: TokenColor): string[] {
  if (!item.scope) return [];
  return Array.isArray(item.scope) ? item.scope : [item.scope];
}

function tokenFor(item: TokenColor): string {
  for (const [pattern, token] of SCOPE_TOKENS)
    if (scopes(item).some((scope) => pattern.test(scope))) return token;
  const color = item.settings.foreground?.toLowerCase() ?? "";
  const token = SHIKI_COLOR_TOKENS[color];
  if (!token)
    throw new Error(
      `shiki theme: no syntax token for ${color} (scopes: ${scopes(item).join(", ")})`,
    );
  return token;
}

/**
 * github-dark (shiki に同梱のテーマ) から、このアプリのテーマを作る。対応の無い
 * 色があれば投げる (同梱のテーマが変わったら表を足す)。
 */
export function codeViewerShikiTheme(source: ShikiThemeSource): ShikiTheme {
  if (!source.tokenColors?.length)
    throw new Error("shiki theme: the source theme has no tokenColors");
  return {
    name: SHIKI_THEME_NAME,
    type: "dark",
    colors: {
      "editor.foreground": "var(--syntax-text)",
      "editor.background": "var(--color-code)",
    },
    tokenColors: source.tokenColors.map((item) => {
      if (!item.settings.foreground) return item;
      return {
        ...item,
        settings: { ...item.settings, foreground: `var(${tokenFor(item)})` },
      };
    }),
  };
}
