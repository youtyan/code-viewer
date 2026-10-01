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
  /**
   * 折り返した 2 行目以降を揃える桁 (文の始まり。箇条書きなら頭の後ろ)。
   * readParagraphs だけが付ける。
   */
  hang?: number;
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

/**
 * 端末の 1 行の字の詰まり方。アプリがペインの幅で入れた改行かを見分けるのに使う
 * (幅は升目の数。全角は 2)。
 */
type RowShape = {
  /** 最初の字の桁。 */
  indent: number;
  /** 文の始まりの桁 (箇条書きの頭 `- ` `1. ` などの後ろ。無ければ indent)。 */
  textStart: number;
  /** 最後の字の右端の桁。 */
  width: number;
  /** 箇条書きの頭で始まる。 */
  marker: boolean;
  /** 枠の線だけ・`│` の枠で始まる。 */
  boxed: boolean;
  firstToken: number;
  lastToken: number;
  firstWide: boolean;
  lastWide: boolean;
  last: string;
};

const LIST_MARKER = /^(?:[-*•・⏺⎿]|\d{1,3}[.)])$/;

function rowShape(buffer: XtermBuffer, y: number): RowShape | null {
  const line = buffer.getLine(y);
  if (!line) return null;
  const cells: { x: number; text: string; width: number }[] = [];
  for (let x = 0; x < line.length; x += 1) {
    const cell = line.getCell(x);
    if (!cell) break;
    const width = cell.getWidth();
    if (width === 0) continue;
    cells.push({ x, text: cell.getChars() || " ", width });
  }
  const filled = cells.filter((cell) => cell.text !== " ");
  const head = filled[0];
  const tail = filled[filled.length - 1];
  if (!head || !tail) return null;
  // 語 = 空白で区切った字の並び。
  const tokens: { start: number; end: number; text: string }[] = [];
  for (const cell of cells) {
    const open = tokens[tokens.length - 1];
    if (cell.text === " ") continue;
    if (open && open.end === cell.x) {
      open.end = cell.x + cell.width;
      open.text += cell.text;
    } else
      tokens.push({ start: cell.x, end: cell.x + cell.width, text: cell.text });
  }
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  const marker = !!first && LIST_MARKER.test(first.text) && tokens.length > 1;
  const text = cells.map((cell) => cell.text).join("");
  return {
    indent: head.x,
    textStart: marker ? tokens[1].start : head.x,
    width: tail.x + tail.width,
    marker,
    boxed: BOX_ONLY.test(text) || head.text === "│",
    firstToken: first ? first.end - first.start : 0,
    lastToken: last ? last.end - last.start : 0,
    firstWide: head.width === 2,
    lastWide: tail.width === 2,
    last: tail.text,
  };
}

/**
 * 罫線を探す、行から下 (無ければ上) の範囲 (行の数)。高さの低いペインでは、
 * 罫線が数百行おきにしか過去の行に残らなかった。
 */
const RULE_SEARCH_ROWS = 2000;

/** y 行目が左端からの罫線 (Claude Code の入力欄の上下の線) なら、その長さ。 */
function ruleWidth(buffer: XtermBuffer, y: number): number | null {
  const line = buffer.getLine(y);
  if (!line) return null;
  if (line.getCell(0)?.getChars() !== "─") return null;
  let end = 0;
  while (end < line.length && line.getCell(end)?.getChars() === "─") end += 1;
  return end >= 2 ? end : null;
}

/**
 * 行を書いたときのペインの幅。ペインの幅は後から変わる (59 桁が 210 桁に) が、
 * 過去の行は書いたときの幅で改行されている。その行の下で最初に出てくる罫線
 * (Claude Code が入力欄の上下に幅いっぱいに引く) の長さを、その時の幅とみなす。
 * 罫線が無ければ今の幅 (cols)。続けて聞く行が近いので、見つけた範囲を覚える。
 */
function wrapWidths(buffer: XtermBuffer, cols: number): (y: number) => number {
  let known = { from: -1, to: -1, width: cols };
  return (y) => {
    if (y >= known.from && y <= known.to) return known.width;
    const limit = Math.min(buffer.length, y + RULE_SEARCH_ROWS);
    for (let row = y; row < limit; row += 1) {
      const width = ruleWidth(buffer, row);
      if (width === null) continue;
      known = { from: y, to: row, width };
      return width;
    }
    // 下に無ければ上の近いもの。y から limit までに罫線は無いので、その間は同じ答え。
    let width = cols;
    for (let row = y - 1; row >= Math.max(0, y - RULE_SEARCH_ROWS); row -= 1) {
      const found = ruleWidth(buffer, row);
      if (found === null) continue;
      width = found;
      break;
    }
    known = { from: y, to: limit - 1, width };
    return width;
  };
}

/**
 * 行 [prevStart, prevEnd) の後ろの nextStart 行目からの行が、アプリがペインの幅で
 * 入れた改行の続きか。続きなら繋ぎ方 ("join" はそのまま、"space" は空白を挟む)。
 *
 * 続きとみなすのは、次の行が前の行の文の始まりと同じ字下げで、箇条書きの頭や
 * 枠でなく、前の行の右端に次の語が入る余りが無かったとき (入る余りがあれば、
 * アプリがわざと改行した)。全角どうし・長い語の途中で切れたときは空白を挟まない。
 */
function continuation(
  buffer: XtermBuffer,
  prevStart: number,
  prevEnd: number,
  nextStart: number,
  widthAt: (y: number) => number,
): "join" | "space" | null {
  const head = rowShape(buffer, prevStart);
  const tail = rowShape(buffer, prevEnd - 1);
  const next = rowShape(buffer, nextStart);
  if (!head || !tail || !next) return null;
  if (head.boxed || next.boxed || next.marker) return null;
  if (tail.last === "…" || next.indent !== head.textStart) return null;
  const cols = widthAt(prevEnd - 1);
  const gap = cols - tail.width;
  if (gap < 0 || (gap > 1 && next.firstToken + 1 <= gap)) return null;
  // 全角どうしは字の間で折られている。全角と半角の境目は空白で折られている
  // (日本語の文の中の半角の語は空白で区切って書く)。
  if (tail.lastWide && next.firstWide) return "join";
  if (tail.lastWide || next.firstWide) return "space";
  if (gap <= 1 && tail.lastToken >= cols - head.textStart - 1) return "join";
  return "space";
}

/**
 * from 行目から to 行目の前までの行を、アプリがペインの幅で入れた改行を繋いだ
 * 段落にして読む (読む画面。スマホの幅で折り返し直すので、ペインの幅の改行が
 * 残ると行の端が細切れになった)。cols はペインの桁。
 */
export function readParagraphs(
  buffer: XtermBuffer,
  from: number,
  to: number,
  cols: number,
): ReflowLine[] {
  const out: ReflowLine[] = [];
  const widthAt = wrapWidths(buffer, cols);
  for (const read of readLogicalLines(buffer, from, to)) {
    const line = read.rule
      ? read
      : { ...read, hang: rowShape(buffer, read.start)?.textStart ?? 0 };
    const prev = out[out.length - 1];
    const how =
      prev && !prev.rule && !line.rule
        ? continuation(buffer, prev.start, prev.end, line.start, widthAt)
        : null;
    if (!prev || !how) {
      out.push(line);
      continue;
    }
    const runs = line.runs.map((run) => ({ ...run }));
    if (runs[0]) runs[0].text = runs[0].text.replace(/^\s+/, "");
    out[out.length - 1] = {
      ...prev,
      end: line.end,
      runs: [
        ...prev.runs,
        ...(how === "space"
          ? [
              {
                text: " ",
                style: { fg: DEFAULT_COLOR, bg: DEFAULT_COLOR, flags: 0 },
              },
            ]
          : []),
        ...runs.filter((run) => run.text.length > 0),
      ],
    };
  }
  return out;
}

/** y 行目を含む段落 (readParagraphs の 1 行) の先頭の行。 */
export function paragraphStart(
  buffer: XtermBuffer,
  y: number,
  cols: number,
): number {
  const widthAt = wrapWidths(buffer, cols);
  let start = logicalLineStart(buffer, y);
  while (start > 0) {
    const prevStart = logicalLineStart(buffer, start - 1);
    if (!continuation(buffer, prevStart, start, start, widthAt)) break;
    start = prevStart;
  }
  return start;
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
