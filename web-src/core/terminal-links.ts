// ターミナルの画面の文字から、URL とファイルのパスを拾う (画像のパスは
// terminal-images.ts)。拾ったものはカーソルを載せると強調し、開く・コピーの帯を
// 出す (views/terminal/terminal-links-layer.ts)。
//
// - URL: `http://`・`https://` で始まるもの。文の終わりの句読点と閉じ括弧は
//   含めない
// - ファイルのパス: `/…`・`~/…`・`./…`・`../…` と、区切りを含む相対パス
//   (`src/app.ts`)。後ろの `:12`・`:12:3` は行と桁。ここでは形だけを見る。
//   実在するか (このプロジェクトの中のファイルか) はサーバに訊く
//   (`apiUrl("agentPaths")` の経路)
// - 端末の幅で折り返された (幅いっぱいの行と次の行の頭が続いている) ものも
//   1 つとして拾う (画像のパスの `findImagePathLinks` と同じ扱い)
//
// 拾う側 (ブラウザ) と確かめる側 (サーバ) が同じ形を見るように core に置く。

import type { PathLink } from "./terminal-images";

export type TerminalTextLinkKind = "url" | "file";

/** 画面の行の上の URL かファイルのパス。範囲の形は画像のパスと同じ。 */
export type TerminalTextLink = PathLink & {
  kind: TerminalTextLinkKind;
  /** ファイルのパスの、行と桁を除いた部分 (URL では candidate と同じ)。 */
  path: string;
  /** `:12` の行 (1 始まり)。 */
  line?: number;
  /** `:12:3` の桁 (1 始まり)。 */
  column?: number;
};

/** 画面のパスとして問い合わせる数の上限 (1 回)。 */
export const MAX_TERMINAL_PATH_QUERY = 32;

/** これより長い文字列はリンクにしない (拾い間違いの取り込みを止める)。 */
const MAX_LINK_LENGTH = 2048;

/**
 * URL。空白・引用符・山括弧・全角の字・枠の線 (│ など) で終わる。後ろに付いた
 * 句読点と、対にならない閉じ括弧は外す (trimUrl)。
 */
const URL_RE = /https?:\/\/[^\s"'`<>─-╿　-ヿ㐀-鿿＀-￯]+/gu;

/** パスの 1 つの区切りに使える字。 */
const SEGMENT = "[\\p{L}\\p{N}._@+-]+";

/**
 * ファイルのパス (行と桁つき)。前に文字・区切り・`:` が続いていれば拾わない
 * (URL の途中や `a/b/c` の途中から拾わない)。
 *
 * - `~/x`・`./x`・`../x` (区切りが 1 つでも拾う)
 * - `/a/b`・`a/b` (区切りを 1 つ以上含む)
 */
const FILE_RE = new RegExp(
  `(?<![\\p{L}\\p{N}._~+@%/:\\\\-])((?:~|\\.{1,2})/${SEGMENT}(?:/${SEGMENT})*|/?${SEGMENT}(?:/${SEGMENT})+)(?::(\\d+)(?::(\\d+))?)?`,
  "gu",
);

/** URL の後ろの、文の句読点と対にならない閉じ括弧を外す。 */
function trimUrl(url: string): string {
  let end = url.length;
  for (;;) {
    const last = url[end - 1];
    if (!last) break;
    if (".,;:!?".includes(last)) {
      end -= 1;
      continue;
    }
    const open = { ")": "(", "]": "[", "}": "{" }[last];
    if (open) {
      const body = url.slice(0, end);
      const opens = body.split(open).length - 1;
      const closes = body.split(last).length - 1;
      if (closes > opens) {
        end -= 1;
        continue;
      }
    }
    break;
  }
  return url.slice(0, end);
}

type Found = Omit<TerminalTextLink, "start" | "end"> & {
  index: number;
  length: number;
};

/** 1 本の文字列の中の URL とファイルのパス (重なるものは URL を取る)。 */
export function matchTextLinks(text: string): Found[] {
  const found: Found[] = [];
  for (const match of text.matchAll(URL_RE)) {
    const url = trimUrl(match[0]);
    if (url.length <= "https://".length || url.length > MAX_LINK_LENGTH)
      continue;
    found.push({
      kind: "url",
      candidate: url,
      path: url,
      index: match.index,
      length: url.length,
    });
  }
  const insideUrl = (index: number) =>
    found.some(
      (item) => index >= item.index && index < item.index + item.length,
    );
  for (const match of text.matchAll(FILE_RE)) {
    if (insideUrl(match.index)) continue;
    let path = match[1] ?? "";
    let full = match[0];
    // 文の終わりの点 (`src/app.ts.`) は含めない。行番号の無いときだけ。
    if (match[2] === undefined) {
      const trimmed = path.replace(/\.+$/, "");
      full = full.slice(0, full.length - (path.length - trimmed.length));
      path = trimmed;
    }
    if (!path || path.length > MAX_LINK_LENGTH) continue;
    const line = match[2] === undefined ? undefined : Number(match[2]);
    const column = match[3] === undefined ? undefined : Number(match[3]);
    found.push({
      kind: "file",
      candidate: full,
      path,
      ...(line !== undefined && line > 0 ? { line } : {}),
      ...(column !== undefined && column > 0 ? { column } : {}),
      index: match.index,
      length: full.length,
    });
  }
  return found.sort((a, b) => a.index - b.index);
}

/**
 * 画面の行の上の URL とファイルのパス。1 行の中にそのまま出ているものと、
 * 端末の幅で折り返されたもの (幅いっぱいの行と次の行を繋いで、境目をまたぐ
 * ものだけ) を拾う。
 *
 * @param lines 画面の各行 (上から順。行末の空白は落としたもの)
 * @param width 端末 (tmux ならペイン) の桁数。0 なら折り返しは見ない
 */
export function findTextLinks(
  lines: string[],
  width: number,
): TerminalTextLink[] {
  const links: TerminalTextLink[] = [];
  // 前の行から折り返して続いたリンクが、この行の頭のどこまでを使ったか。
  let continued = 0;
  for (let row = 0; row < lines.length; row += 1) {
    const line = lines[row] ?? "";
    const next = lines[row + 1];
    const wraps = width > 0 && line.length >= width && next !== undefined;
    const covered = continued;
    continued = 0;
    for (const found of matchTextLinks(line)) {
      // 行末まで続いていて次の行へ折り返すものは、繋いだ方で拾う。
      if (wraps && found.index + found.length >= line.length) continue;
      // 前の行から続いた部分の中は、この行だけでは拾わない。
      if (found.index < covered) continue;
      const { index, length, ...link } = found;
      links.push({
        ...link,
        start: { row, col: index },
        end: { row, col: index + length },
      });
    }
    if (!wraps || next === undefined) continue;
    for (const found of matchTextLinks(line + next)) {
      const end = found.index + found.length;
      if (found.index >= line.length || end <= line.length) continue;
      const { index, length: _length, ...link } = found;
      continued = Math.max(continued, end - line.length);
      links.push({
        ...link,
        start: { row, col: index },
        end: { row: row + 1, col: end - line.length },
      });
    }
  }
  return links;
}

/** `agentPaths` の応答の 1 件: 実在する、このプロジェクトの中のファイル。 */
export type TerminalPathHit = {
  /** 問い合わせた綴り (行と桁を除いた部分)。 */
  candidate: string;
  /** プロジェクトの根からの相対パス (code-viewer で開く宛先)。 */
  path: string;
  /** 実体の絶対パス (コピーする値)。 */
  absolute: string;
};

export type TerminalPathsResponse = {
  /** 実在してプロジェクトの中にあったものだけ。無いもの・外のものは入らない。 */
  files: TerminalPathHit[];
};
