// SP の 1 ペイン表示の「読む」画面。端末の升目 (xterm のバッファ) を、スマホの幅で
// 折り返せる行と、色の区切りに起こす。DOM には触らない (描くのは
// views/terminal/pane-view.ts)。
//
// ペインの幅は PC の分割のまま (100 桁以上) なので、升目のまま縮めると読めない。
// そこで:
// - 端末が折り返した行は 1 行に繋ぎ、ブラウザの幅で折り返し直す
// - 枠の線だけの行 (─ ━ ╭ ╮ など) は「線」として、折り返さずに幅で切る
// - `│ … │` で囲んだ行 (入力欄・道具の出力の枠) は、左右の枠を外して中身だけにする
// - 画面の下に `1. … 2. …` の選択肢が出ていれば拾い、押せるボタンにできるようにする
//
// 色は xterm と同じに見えるよう、xterm の既定のパレットにテーマの色を重ね、
// xterm の minimumContrastRatio と同じく、地に対して読める明るさまで文字の色を上げる。

import {
  contrastRatio,
  parseHexColor,
  relativeLuminance,
} from "./color-contrast";
import type { XtermBuffer, XtermBufferCell, XtermTheme } from "./xterm-loader";

/** 1 マスの飾り (CellStyle.flags のビット)。 */
export const STYLE = {
  bold: 1,
  italic: 2,
  dim: 4,
  underline: 8,
  inverse: 16,
  invisible: 32,
  strike: 64,
} as const;

/** 色の値: -1 = 既定、0〜255 = パレットの番号、RGB_COLOR 以上 = RGB_COLOR | 0xRRGGBB。 */
export const DEFAULT_COLOR = -1;
export const RGB_COLOR = 0x1000000;

export type CellStyle = { fg: number; bg: number; flags: number };

export type ReflowRun = { text: string; style: CellStyle };

export type ReflowLine = {
  /** バッファの何行目から何行目まで (end は含まない)。 */
  start: number;
  end: number;
  runs: ReflowRun[];
  /** 枠の線だけの行。折り返さず、幅で切って 1 行にする。 */
  rule: boolean;
};

export type PaneChoice = { key: string; label: string };

function colorOf(rgb: boolean, palette: boolean, value: number): number {
  if (rgb) return RGB_COLOR | value;
  if (palette) return value;
  return DEFAULT_COLOR;
}

export function cellStyle(cell: XtermBufferCell): CellStyle {
  return {
    fg: colorOf(cell.isFgRGB(), cell.isFgPalette(), cell.getFgColor()),
    bg: colorOf(cell.isBgRGB(), cell.isBgPalette(), cell.getBgColor()),
    flags:
      (cell.isBold() ? STYLE.bold : 0) |
      (cell.isItalic() ? STYLE.italic : 0) |
      (cell.isDim() ? STYLE.dim : 0) |
      (cell.isUnderline() ? STYLE.underline : 0) |
      (cell.isInverse() ? STYLE.inverse : 0) |
      (cell.isInvisible() ? STYLE.invisible : 0) |
      (cell.isStrikethrough() ? STYLE.strike : 0),
  };
}

// ai-dup-check: allow -- fp:画像の参照の比較 (image-tab.ts) と形が似ているだけで、比べる物が違う
function sameStyle(a: CellStyle, b: CellStyle): boolean {
  return a.fg === b.fg && a.bg === b.bg && a.flags === b.flags;
}

/** 行末で落としてよい空白か (地の色も下線も無い)。 */
function blank(text: string, style: CellStyle): boolean {
  return (
    text.trim() === "" &&
    style.bg === DEFAULT_COLOR &&
    (style.flags & (STYLE.inverse | STYLE.underline | STYLE.strike)) === 0
  );
}

const BOX_ONLY = /^[\s─-▟]+$/;
const FRAMED = /^\s*│.*│\s*$/;

function trimTrailing(runs: ReflowRun[]): ReflowRun[] {
  const out = runs.map((run) => ({ ...run }));
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (!blank(last.text, last.style)) {
      if (
        last.style.bg === DEFAULT_COLOR &&
        (last.style.flags & STYLE.inverse) === 0
      )
        last.text = last.text.replace(/\s+$/, "");
      break;
    }
    out.pop();
  }
  return out.filter((run) => run.text.length > 0);
}

/** `│ 中身 │` の左右の枠を外す。外せなければそのまま。 */
function unframe(runs: ReflowRun[]): ReflowRun[] {
  const text = runs.map((run) => run.text).join("");
  if (!FRAMED.test(text)) return runs;
  const out = runs.map((run) => ({ ...run }));
  // 左: 最初の │ と、その直後の空白 1 つ (前の字下げの空白も落とす)。
  for (const run of out) {
    const at = run.text.indexOf("│");
    if (at < 0) {
      if (run.text.trim() !== "") return runs;
      run.text = "";
      continue;
    }
    run.text = run.text.slice(at + 1).replace(/^ /, "");
    break;
  }
  // 右: 最後の │ と、その前の空白。
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const run = out[i];
    const at = run.text.lastIndexOf("│");
    if (at < 0) {
      if (run.text.trim() !== "") return runs;
      run.text = "";
      continue;
    }
    run.text = run.text.slice(0, at);
    break;
  }
  return trimTrailing(out.filter((run) => run.text.length > 0));
}

/**
 * バッファの start 行目から始まる 1 行 (折り返しで続く行を全部繋いだもの) を読む。
 * start が折り返しの続きの行なら、その行から読み始める (呼ぶ側が先頭を渡す)。
 */
export function readLogicalLine(
  buffer: XtermBuffer,
  start: number,
): ReflowLine {
  const runs: ReflowRun[] = [];
  let end = start;
  for (let y = start; y < buffer.length; y += 1) {
    const line = buffer.getLine(y);
    if (!line || (y > start && !line.isWrapped)) break;
    end = y + 1;
    for (let x = 0; x < line.length; x += 1) {
      const cell = line.getCell(x);
      if (!cell) break;
      // 全角の字の後ろ半分。字は前の桁が持っている。
      if (cell.getWidth() === 0) continue;
      const text = cell.getChars() || " ";
      const style = cellStyle(cell);
      const last = runs[runs.length - 1];
      if (last && sameStyle(last.style, style)) last.text += text;
      else runs.push({ text, style });
    }
  }
  const trimmed = trimTrailing(runs);
  const text = trimmed.map((run) => run.text).join("");
  const rule = text.trim() !== "" && BOX_ONLY.test(text);
  return {
    start,
    end: Math.max(end, start + 1),
    runs: rule ? trimmed : unframe(trimmed),
    rule,
  };
}

/** バッファの from 行目 (行の先頭) から to 行目の前までに始まる行を全部読む。 */
export function readLogicalLines(
  buffer: XtermBuffer,
  from: number,
  to: number,
): ReflowLine[] {
  const lines: ReflowLine[] = [];
  let y = from;
  while (y < to && y < buffer.length) {
    const line = readLogicalLine(buffer, y);
    lines.push(line);
    y = line.end;
  }
  return lines;
}

/** y 行目を含む行の先頭 (折り返しの続きなら、さかのぼった最初の行)。 */
export function logicalLineStart(buffer: XtermBuffer, y: number): number {
  let start = y;
  while (start > 0 && buffer.getLine(start)?.isWrapped) start -= 1;
  return start;
}

const CHOICE = /^\s*(?:[❯›>▶➤→]\s*)?([1-9])[.)]\s+(\S.*?)\s*$/;
/** 選択肢を探す範囲 (画面の下からの行数)。 */
const CHOICE_SCAN_LINES = 20;
const CHOICE_LABEL_MAX = 48;

/**
 * 画面の下の方に並んだ `1. はい` `2. いいえ` を拾う。1 から番号が続く 2 つ以上の
 * 並びのうち、いちばん下のものだけ。見つからなければ空。
 */
export function findChoices(lines: string[]): PaneChoice[] {
  let best: PaneChoice[] = [];
  let current: PaneChoice[] = [];
  for (const line of lines.slice(-CHOICE_SCAN_LINES)) {
    const match = CHOICE.exec(line);
    if (!match) continue;
    const number = Number(match[1]);
    const label =
      match[2].length > CHOICE_LABEL_MAX
        ? `${match[2].slice(0, CHOICE_LABEL_MAX - 1)}…`
        : match[2];
    if (number === 1) current = [{ key: "1", label }];
    else if (number === current.length + 1)
      current.push({ key: match[1], label });
    else current = [];
    if (current.length >= 2) best = [...current];
  }
  return best;
}

// xterm の既定の 16 色 (xterm.js の DEFAULT_ANSI_COLORS と同じ値)。テーマが持つ色は
// terminalPalette が上書きする。
const XTERM_ANSI = [
  "#2e3436",
  "#cc0000",
  "#4e9a06",
  "#c4a000",
  "#3465a4",
  "#75507b",
  "#06989a",
  "#d3d7cf",
  "#555753",
  "#ef2929",
  "#8ae234",
  "#fce94f",
  "#729fcf",
  "#ad7fa8",
  "#34e2e2",
  "#eeeeec",
];

const CUBE_STEPS = [0, 95, 135, 175, 215, 255];

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** 256 色のパレット。0〜15 は xterm の既定にテーマの色を重ね、残りは xterm の作り方。 */
export function terminalPalette(theme: XtermTheme): string[] {
  const ansi = [...XTERM_ANSI];
  const themed: Array<[number, string | undefined]> = [
    [1, theme.red],
    [2, theme.green],
    [3, theme.yellow],
    [5, theme.magenta],
    [7, theme.white],
    [15, theme.brightWhite],
  ];
  for (const [index, color] of themed) if (color) ansi[index] = color;
  const palette = [...ansi];
  for (let i = 0; i < 216; i += 1)
    palette.push(
      hex(
        CUBE_STEPS[Math.floor(i / 36)],
        CUBE_STEPS[Math.floor(i / 6) % 6],
        CUBE_STEPS[i % 6],
      ),
    );
  for (let i = 0; i < 24; i += 1) {
    const v = 8 + i * 10;
    palette.push(hex(v, v, v));
  }
  return palette;
}

/**
 * 地に対してコントラスト比が ratio に届くまで、文字の色を明るく (暗い地) /
 * 暗く (明るい地) する。色相はおおむね保つ。読めない色の形式ならそのまま。
 */
export function readableColor(
  color: string,
  background: string,
  ratio: number,
): string {
  const readable = /^#[0-9a-f]{6}$/i;
  if (!readable.test(color) || !readable.test(background)) return color;
  if (contrastRatio(color, background) >= ratio) return color;
  const fg = parseHexColor(color);
  const target = relativeLuminance(background) < 0.5 ? 255 : 0;
  for (let step = 1; step <= 10; step += 1) {
    const [r, g, b] = fg.map((v) => Math.round(v + ((target - v) * step) / 10));
    const mixed = hex(r, g, b);
    if (contrastRatio(mixed, background) >= ratio) return mixed;
  }
  return hex(target, target, target);
}

function colorValue(
  value: number,
  palette: string[],
  fallback: string,
): string {
  if (value === DEFAULT_COLOR) return fallback;
  if (value >= RGB_COLOR) {
    const rgb = value & 0xffffff;
    return hex((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255);
  }
  return palette[value] ?? fallback;
}

export type ReflowColors = {
  palette: string[];
  foreground: string;
  background: string;
  /** xterm の minimumContrastRatio と同じ値 (淡色はその半分)。 */
  minimumContrastRatio: number;
};

/** 1 つの区切りの見た目を、要素の style に当てる CSS の宣言にする。 */
export function runCss(style: CellStyle, colors: ReflowColors): string {
  let fg = colorValue(style.fg, colors.palette, colors.foreground);
  let bg = colorValue(style.bg, colors.palette, colors.background);
  if (style.flags & STYLE.inverse) [fg, bg] = [bg, fg];
  const ratio = colors.minimumContrastRatio / (style.flags & STYLE.dim ? 2 : 1);
  const parts = [`color:${readableColor(fg, bg, ratio)}`];
  if (style.bg !== DEFAULT_COLOR || style.flags & STYLE.inverse)
    parts.push(`background-color:${bg}`);
  if (style.flags & STYLE.bold) parts.push("font-weight:700");
  if (style.flags & STYLE.italic) parts.push("font-style:italic");
  const lines = [
    style.flags & STYLE.underline ? "underline" : "",
    style.flags & STYLE.strike ? "line-through" : "",
  ].filter(Boolean);
  if (lines.length) parts.push(`text-decoration:${lines.join(" ")}`);
  if (style.flags & STYLE.invisible) parts.push("visibility:hidden");
  return parts.join(";");
}
