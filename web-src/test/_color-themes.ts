// 10 テーマ × 明暗の、名前の層の値 (web/style.css のカスケードの結果)。
//
// 色の下限を確かめるテスト (コントラスト・フォーカスの輪・表の区切り・カード) は
// どれもこれで全部の組を回す。テーマの一覧は core/color-themes.ts から取るので、
// 一覧に足したテーマに style.css の塊が無ければ、どの組も既定の値のままになり
// color-themes-contrast.test.ts の「塊がある」検査で落ちる。
import { COLOR_THEMES, type ColorTheme } from "../core/color-themes";
import {
  baseRules,
  type CssRule,
  cascadedDeclarations,
  loadStyleSheet,
} from "./_css-fixture";

export type ThemeMode = "light" | "dark";

export type ThemeVariant = {
  theme: ColorTheme;
  mode: ThemeMode;
  /** テストの名前 (`forest dark` など)。 */
  name: string;
  /** その組で効く名前の層の値。 */
  vars: Map<string, string>;
};

/**
 * その組で効く塊の並び。後ほど強い: :root → [data-theme="dark"] →
 * テーマのライト → テーマのダーク (html に付く属性の組と同じ詳細度の順)。
 */
export function themeSelectors(theme: ColorTheme, mode: ThemeMode): string[] {
  const own =
    theme === "default"
      ? []
      : [
          `[data-color-theme="${theme}"]`,
          ...(mode === "dark"
            ? [`[data-color-theme="${theme}"][data-theme="dark"]`]
            : []),
        ];
  return [":root", ...(mode === "dark" ? ['[data-theme="dark"]'] : []), ...own];
}

export function themeVariants(
  rules: CssRule[] = baseRules(loadStyleSheet()),
): ThemeVariant[] {
  return COLOR_THEMES.flatMap((theme) =>
    (["light", "dark"] as const).map((mode) => {
      const vars = new Map<string, string>();
      for (const selector of themeSelectors(theme, mode))
        for (const [name, value] of cascadedDeclarations(
          rules,
          (candidate) => candidate === selector,
        ))
          vars.set(name, value);
      return { theme, mode, name: `${theme} ${mode}`, vars };
    }),
  );
}
