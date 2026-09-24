// 画面のテーマ (配色)。明暗 (html[data-theme]) とは別に選び、「テーマ × 明暗」で
// 20 通りになる。
//
// テーマは名前 (id) と表示名だけをここに持ち、色の値は web/style.css の名前の層に
// 置く (既定は :root と [data-theme="dark"]、ほかは [data-color-theme="<id>"] と
// [data-color-theme="<id>"][data-theme="dark"] の組でトークンを上書きする)。
// どの組もコントラストの下限を満たすことは color-themes-contrast.test.ts ほかが
// style.css の値で確かめる。
//
// 既定のテーマは html に属性を付けない (style.css の :root と [data-theme="dark"]
// のまま)。表示名はどれも一般の語で、他のプロジェクトの配色の名前は使わない。

export const COLOR_THEMES = [
  "default",
  "night-sea",
  "forest",
  "sand",
  "ink",
  "sakura",
  "moss",
  "mist",
  "amber",
  "indigo",
] as const;

export type ColorTheme = (typeof COLOR_THEMES)[number];

export const DEFAULT_COLOR_THEME: ColorTheme = "default";

export const COLOR_THEME_NAMES: Record<ColorTheme, { en: string; ja: string }> =
  {
    default: { en: "Default", ja: "既定" },
    "night-sea": { en: "Night sea", ja: "夜の海" },
    forest: { en: "Forest", ja: "森" },
    sand: { en: "Sand", ja: "砂" },
    ink: { en: "Ink wash", ja: "薄墨" },
    sakura: { en: "Blossom", ja: "桜" },
    moss: { en: "Moss", ja: "苔" },
    mist: { en: "Mist", ja: "霧" },
    amber: { en: "Amber", ja: "琥珀" },
    indigo: { en: "Indigo", ja: "藍" },
  };

export function isColorTheme(value: unknown): value is ColorTheme {
  return (
    typeof value === "string" &&
    (COLOR_THEMES as readonly string[]).includes(value)
  );
}

/**
 * 以前の設定の「ダークの色違い」(palette) を、近いテーマへ読み替える
 * (graphite = 無彩色 → 薄墨、warm = 暖かい灰色 → 砂)。既定の紫と、読めない値は
 * 読み替えない。
 */
export function colorThemeFromPalette(
  palette: unknown,
): ColorTheme | undefined {
  if (palette === "graphite") return "ink";
  if (palette === "warm") return "sand";
  return undefined;
}

/** html (や見本の箱) にテーマを付ける。既定は属性を外す。 */
export function applyColorTheme(element: HTMLElement, theme: ColorTheme): void {
  if (theme === DEFAULT_COLOR_THEME) delete element.dataset.colorTheme;
  else element.dataset.colorTheme = theme;
}
