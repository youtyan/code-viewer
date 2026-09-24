// 画面のテーマ (配色)。明暗 (html[data-theme]) とは別に選び、「テーマ × 明暗」の
// 組で決まる。
//
// テーマは名前 (id) と表示名だけをここに持ち、色の値は web/style.css の名前の層に
// 置く (既定は :root と [data-theme="dark"]、ほかは [data-color-theme="<id>"] と
// [data-color-theme="<id>"][data-theme="dark"] の組でトークンを上書きする)。
// どの組もコントラストの下限を満たすことは color-themes-contrast.test.ts ほかが
// style.css の値で確かめる。
//
// 既定のテーマは html に属性を付けない (style.css の :root と [data-theme="dark"]
// のまま)。表示名は一般の語にする。github だけは利用者がその名前で求めたもので、
// GitHub が公開している配色の値を写している (出典は style.css のその塊)。

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
  "github",
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
    github: { en: "GitHub", ja: "GitHub" },
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

/**
 * ターミナルの中の明暗。dark (既定) は画面がライトでもターミナルの中をそのテーマの
 * ダークで描く: claude・codex の画面・tmux の状態の行・シェルのプロンプトは暗い地を
 * 前提に色を決めていて、明るい地では薄い灰の文字や暗い面が読めない。match は
 * 画面の明暗に合わせる。
 */
export const TERMINAL_TONES = ["dark", "match"] as const;

export type TerminalTone = (typeof TERMINAL_TONES)[number];

export const DEFAULT_TERMINAL_TONE: TerminalTone = "dark";

export function isTerminalTone(value: unknown): value is TerminalTone {
  return (
    typeof value === "string" &&
    (TERMINAL_TONES as readonly string[]).includes(value)
  );
}

/**
 * html にターミナルの明暗を付ける。dark のとき style.css のダークの塊が、ターミナルの
 * 面 ([data-terminal-surface] の付いた箱) の中だけにも当たる。match は属性を外す。
 */
export function applyTerminalTone(
  element: HTMLElement,
  tone: TerminalTone,
): void {
  if (tone === "dark") element.dataset.terminalTone = "dark";
  else delete element.dataset.terminalTone;
}

/** html (や見本の箱) にテーマを付ける。既定は属性を外す。 */
export function applyColorTheme(element: HTMLElement, theme: ColorTheme): void {
  if (theme === DEFAULT_COLOR_THEME) delete element.dataset.colorTheme;
  else element.dataset.colorTheme = theme;
}
