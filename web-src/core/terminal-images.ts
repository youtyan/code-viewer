// ターミナルの出力に現れた画像のパスを拾う部分。
//
// エージェントが図やスクリーンショットを書き出したとき、画面に出るのはパス
// だけで中身は見えない。拾って帯に出せば、ターミナルを見たまま結果が分かる。
// 帯は貼り付けた画像と同じもの (terminal-screen.ts の addAttachment)。
//
// 拾う側 (ブラウザ) と配る側 (サーバ) が同じ判定を見るように core に置く。
// terminal-paste.ts と同じ理由で、許可する画像の種類を片方だけずらさない。

import { PASTE_IMAGE_TYPES } from "./terminal-paste";

/**
 * 帯に出す画像の拡張子。貼り付けで受ける種類と同じものに揃える (jpeg は jpg
 * の別綴り)。
 *
 * SVG を入れないのは貼り付けと同じ理由 (中に script を書ける)。配信する
 * /_file は拡張子で Content-Type を決めるので、ここを広げると配る種類まで
 * 変わる。
 */
export const TERMINAL_IMAGE_EXTENSIONS: readonly string[] = [
  ...new Set(Object.values(PASTE_IMAGE_TYPES)),
  "jpeg",
];

/**
 * 1 回の走査で拾う上限。画像パスだらけの出力でも走査が暴れないための歯止め
 * で、普段は届かない。帯に出す枚数の上限は表示側が別に持つ。
 */
export const MAX_TERMINAL_IMAGE_PATHS = 64;

/** 1 リクエストで問い合わせるパスの上限。 */
export const MAX_TERMINAL_IMAGE_QUERY = 16;

/** これより長い文字列はパスとして扱わない。拾い間違いの取り込みを止める。 */
const MAX_IMAGE_PATH_LENGTH = 1024;

/** 配信できると分かった画像 1 枚。 */
export type TerminalImageRef = {
  /**
   * 実体の絶対パス (symlink を解決した後)。表示の tooltip と、同じ 1 枚を
   * 二重に出さないための鍵に使う。
   */
  path: string;
  /**
   * 画面に出ていた綴り。実体のパスとは違うことがある (相対・symlink 経由・
   * /tmp と /private/tmp など)。画面のどこに出ているかを探すのはこちらで、
   * 実体のパスで探すと一致しない。
   */
  candidate: string;
  /** 表示に使う名前。 */
  name: string;
  /** そのまま img の src にできる URL。組み立てはサーバ側が持つ。 */
  url: string;
};

export type TerminalImagesResponse = { images: TerminalImageRef[] };

/**
 * 画面のどこにその綴りが出ているか。row は画面の上から 0 始まり。
 *
 * span は何行にまたがっているか (折り返していなければ 1)。画像を置くときは
 * ここを見て最終行の下に出す。先頭行の下に出すと、続きの行に重なってパスが
 * 読めなくなる。
 */
export type PathAnchor = {
  candidate: string;
  row: number;
  col: number;
  span: number;
};

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

/**
 * ANSI エスケープ。capture-pane は -e 付きで色を含むので、落としてから拾わ
 * ないと色付きのパスが途中で切れる。
 *
 * 拾うのは 3 種類。CSI (`ESC [ ... 終端`)、OSC (`ESC ] ... BEL` か
 * `ESC ] ... ESC \`)、それ以外の 2 文字もの。正規表現を文字列から組むのは、
 * 制御文字をリテラルで書くと lint に引っかかるため。
 */
const ANSI_RE = new RegExp(
  `${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|${ESC}[@-Z\\\\-_]`,
  "g",
);

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/**
 * パスに使える文字。文字・数字と、パスで普通に見かける記号だけにする。
 *
 * 引用符・括弧・コロン・カンマを外してあるので、`'/tmp/a.png'` や
 * `(see out.png)` のように囲まれていてもパスの部分だけが残る。tmux の TUI が
 * 描く罫線 (│ ╭ など) は記号カテゴリなので \p{L}\p{N} に入らず、勝手に
 * くっつかない。
 */
const PATH_CHAR = "[\\p{L}\\p{N}._~+@%/-]";

/** 拡張子の直前に来てよい文字。`.png` や `/.png` を単独で拾わないための縛り。 */
const NAME_CHAR = "[\\p{L}\\p{N}_~+@%-]";

const IMAGE_PATH_RE = new RegExp(
  `${PATH_CHAR}*${NAME_CHAR}\\.(?:${TERMINAL_IMAGE_EXTENSIONS.join("|")})(?![\\p{L}\\p{N}])`,
  "giu",
);

/**
 * 拡張子を見る。許可した種類でなければ null。
 *
 * パスの見た目だけで決める。実体の中身は配る側が読むときに分かるが、ここで
 * 弾いておけばファイルを触らずに済む。
 */
export function terminalImageExtension(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  const extension = path.slice(dot + 1).toLowerCase();
  return TERMINAL_IMAGE_EXTENSIONS.includes(extension) ? extension : null;
}

/** URL の一部を切り出したものは、ファイルのパスではない。 */
function looksLikeUrl(value: string): boolean {
  return value.startsWith("//") || value.includes("://");
}

/**
 * 本文から画像のパスらしきものを拾う。重複は落とす。
 *
 * ここで返すのはあくまで候補。実在するか・リポジトリの中かは配る側
 * (server/terminal/images.ts) が見る。拾い過ぎても、そこで落ちる。
 */
export function findImagePaths(
  text: string,
  limit = MAX_TERMINAL_IMAGE_PATHS,
): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(IMAGE_PATH_RE)) {
    const path = match[0];
    if (path.length > MAX_IMAGE_PATH_LENGTH) continue;
    if (looksLikeUrl(path)) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    found.push(path);
    if (found.length >= limit) break;
  }
  return found;
}

/**
 * tmux の画面で、折り返された行を繋ぐ。
 *
 * capture-pane は折り返しを改行として返すので、狭いペインでは長い絶対パスが
 * 必ず途中で割れる。幅いっぱいまで届いている行は、次の行の続きとみなす。
 *
 * 繋ぐと逆に壊れる並びもある (行末ちょうどで終わったパスの後ろに、無関係な
 * 次の行がくっつく)。だから呼び出し側は繋いだ形と元の形の両方を走査する。
 */
export function joinWrappedLines(text: string, width: number): string {
  if (!Number.isFinite(width) || width <= 0) return text;
  const lines = text.split("\n");
  const joined: string[] = [];
  let current: string | null = null;
  let previousLength = 0;
  for (const line of lines) {
    if (current === null) {
      current = line;
    } else if (previousLength >= width) {
      current += line;
    } else {
      joined.push(current);
      current = line;
    }
    previousLength = line.length;
  }
  if (current !== null) joined.push(current);
  return joined.join("\n");
}

/**
 * 行末で切られたパスを、次の行の頭と繋ぎ直した候補を作る。
 *
 * CLI は自分で折り返すことがあり、そのときは端末の折り返し (joinWrappedLines)
 * と形が違う。Claude Code の添付行が実際にこうなる。
 *
 * ```
 *   › [image] /tmp/session/scratchpad/ban (124.9KB)
 *             d2.png
 * ```
 *
 * 幅で見ても繋がらない (サイズ注記が末尾に入り、続きは字下げされている)。
 * そこで「その行にある最後のパス片」と「次の行の最初の語」だけを繋ぐ。空白は
 * パスに入らないので、注記も字下げもここで自然に落ちる。
 *
 * 当たらない組み合わせでは実在しない文字列ができるだけで、配る側の実在確認で
 * 落ちる。1 行に付き 1 候補までなので、増えるのは行数ぶん。
 */
export function joinBrokenPathLines(text: string): string {
  const lines = text.split("\n");
  const candidates: string[] = [];
  for (let i = 0; i + 1 < lines.length; i += 1) {
    const head = lastPathFragment(lines[i] ?? "");
    const tail = firstWord(lines[i + 1] ?? "");
    if (!head || !tail) continue;
    candidates.push(head.text + tail);
  }
  return candidates.join("\n");
}

/** その行にある「パスらしい最後の語」と、その語が始まる桁。無ければ null。 */
function lastPathFragment(
  line: string,
): { text: string; index: number } | null {
  let found: { text: string; index: number } | null = null;
  const words = /\S+/g;
  for (const match of line.matchAll(words)) {
    if (match[0].includes("/")) {
      found = { text: match[0], index: match.index ?? 0 };
    }
  }
  return found;
}

/** 行頭の空白を飛ばした最初の語。 */
function firstWord(line: string): string {
  return /\S+/.exec(line)?.[0] ?? "";
}

/**
 * ANSI を落とした本文から候補を拾う。行またぎの 2 形も合わせて見る。
 *
 * 繋いだ形だけを見ると、行末ちょうどで終わったパスの後ろに無関係な次の行が
 * くっついて消える。だから素のままの形も必ず走査する。
 *
 * @param width 端末の桁数。0 なら折り返し結合はしない (シェルの出力は
 *   PTY のバイト列そのものなので、端末側の折り返しは入っていない)
 */
export function findImagePathsInText(
  plain: string,
  width = 0,
  limit = MAX_TERMINAL_IMAGE_PATHS,
): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  const sources = [
    plain,
    width > 0 ? joinWrappedLines(plain, width) : "",
    joinBrokenPathLines(plain),
  ];
  for (const source of sources) {
    if (!source) continue;
    for (const path of findImagePaths(source, limit)) {
      if (seen.has(path)) continue;
      seen.add(path);
      merged.push(path);
      if (merged.length >= limit) return merged;
    }
  }
  return merged;
}

/**
 * いま画面に出ている綴りの位置を返す。画像をその場に重ねるのに使う。
 *
 * 探すのは「画面に出ている綴り」であって実体のパスではない。/tmp と
 * /private/tmp のように、実体と画面の文字は食い違う。
 *
 * 行またぎも見る。次の行にまたがっているときは、始まっている行に置く
 * (続きの行に置くと、パスの真ん中から画像がぶら下がって見える)。
 *
 * @param lines 画面の各行 (上から順、ANSI 除去済み)
 * @param candidates 画面で探す綴り
 */
export function findPathAnchors(
  lines: string[],
  candidates: string[],
): PathAnchor[] {
  const anchors: PathAnchor[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const anchor = firstAnchor(lines, candidate);
    if (anchor) anchors.push(anchor);
  }
  return anchors;
}

function firstAnchor(lines: string[], candidate: string): PathAnchor | null {
  for (let row = 0; row < lines.length; row += 1) {
    const line = lines[row] ?? "";
    const direct = line.indexOf(candidate);
    if (direct >= 0) return { candidate, row, col: direct, span: 1 };
    // 行またぎ。組み立て方は joinBrokenPathLines と同じで、行末のパス片と
    // 次の行の先頭語を繋ぐ (間に挟まる注記や字下げは空白なので落ちる)。
    const head = lastPathFragment(line);
    if (!head) continue;
    const tail = firstWord(lines[row + 1] ?? "");
    if (tail && head.text + tail === candidate) {
      return { candidate, row, col: head.index, span: 2 };
    }
  }
  return null;
}

/**
 * tmux の 1 フレームから候補を拾う。
 *
 * @param screen capture-pane の出力 (ANSI 付き)
 * @param width ペインの桁数。折り返しを繋ぐのに使う
 */
export function findScreenImagePaths(
  screen: string,
  width: number,
  limit = MAX_TERMINAL_IMAGE_PATHS,
): string[] {
  return findImagePathsInText(stripAnsi(screen), width, limit);
}
