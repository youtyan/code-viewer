// ターミナルの出力に現れた画像のパスを拾う部分。
//
// エージェントが図やスクリーンショットを書き出したとき、画面に出るのはパス
// だけで中身は見えない。拾ってターミナルの右の棚に並べれば、ターミナルを
// 見たまま結果が分かる (views/terminal/image-shelf.ts)。
//
// 拾う側 (ブラウザ) と配る側 (サーバ) が同じ判定を見るように core に置く。
// terminal-paste.ts と同じ理由で、許可する画像の種類を片方だけずらさない。

import { PASTE_IMAGE_TYPES } from "./terminal-paste";

/**
 * 棚に出す画像の拡張子。貼り付けで受ける種類と同じものに揃える (jpeg は jpg
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
 * で、普段は届かない。棚に並べる枚数の上限は MAX_SHELF_IMAGES。
 */
export const MAX_TERMINAL_IMAGE_PATHS = 64;

/** 1 リクエストで問い合わせるパスの上限。 */
export const MAX_TERMINAL_IMAGE_QUERY = 16;

/**
 * 棚 (terminal-screen.ts の画像の棚) に並べる上限。溢れたら古いものから
 * 落とす。棚はスクロールするので帯の頃より多く持てるが、1 ペインで際限なく
 * 溜めない。
 */
export const MAX_SHELF_IMAGES = 50;

/**
 * 履歴をさかのぼって拾うときに、1 回の走査で集める候補の上限。新しい順に
 * 並べ替えてから MAX_TERMINAL_IMAGE_PATHS 件に絞るので、ここで先に絞ると
 * 古い候補だけが残る。
 */
const MAX_HISTORY_IMAGE_CANDIDATES = 1024;

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
  /**
   * そのまま img の src にできる URL。組み立てはサーバ側が持つ。更新時刻と
   * 大きさを含むので、同じ名前で上書きされれば URL も変わる。
   */
  url: string;
  bytes: number;
  /** ファイルの更新時刻 (ms)。同じ名前で上書きされたことをこれで知る。 */
  mtimeMs: number;
};

/**
 * 配れなかった理由。1 種類 (null) に潰さない: 棚は「読めなかった」項目を
 * 理由つきで出す。
 *
 * - invalid: 文字列でない・空・NUL 入り
 * - unsupported: 拡張子が対象外 (SVG など)
 * - missing: 実在しない
 * - not-file: 通常のファイルでない (ディレクトリ・名前付きパイプ)
 * - empty: 0 バイト
 * - too-large: 上限バイト数を超える
 * - unreadable: 権限などで読めない (detail に理由)
 */
export const TERMINAL_IMAGE_REJECT_REASONS = [
  "invalid",
  "unsupported",
  "missing",
  "not-file",
  "empty",
  "too-large",
  "unreadable",
] as const;

export type TerminalImageRejectReason =
  (typeof TERMINAL_IMAGE_REJECT_REASONS)[number];

/** 配れなかった候補 1 つ。 */
export type TerminalImageRejection = {
  candidate: string;
  /** 解いた先の絶対パス (実体まで解けていればそれ)。invalid では空。 */
  path: string;
  name: string;
  reason: TerminalImageRejectReason;
  /** 大きさが分かったとき (too-large)。 */
  bytes?: number;
  /** unreadable のときの OS のエラー (コードとメッセージ)。 */
  detail?: string;
};

/**
 * 相対パスをどこから解いたか。pane は tmux のペインの作業場所
 * (`pane_current_path`)、shell はブラウザのシェルを起こした場所、repo は
 * このサーバのリポジトリの根。error はペインの作業場所を引こうとして失敗した
 * 理由 (その間は shell か repo で解いている)。
 */
export type TerminalImageBase = {
  source: "pane" | "shell" | "repo";
  cwd: string;
  error?: string;
};

export type TerminalImagesResponse = {
  images: TerminalImageRef[];
  rejected: TerminalImageRejection[];
  base: TerminalImageBase;
};

/**
 * 繋いだときに 1 回だけ、そのペインの tmux の履歴をさかのぼって拾った結果。
 * images と rejected は新しい順。pane はシェルが tmux のどのペインを映して
 * いたか (tmux を映していなければ null で、そのときは何も拾わない)。
 */
export type TerminalImageHistoryResponse = TerminalImagesResponse & {
  pane: string | null;
  /**
   * 走査で拾った候補 (新しい順)。images と rejected は別の配列なので、棚は
   * この順で 1 列に並べ直してから番号を振る。
   */
  candidates: string[];
  /** 実際に走査した行数 (履歴 + 画面)。 */
  lines: number;
};

/**
 * 画面の行の上で、画像パスが出ている範囲。row は渡した行の 0 始まり、col は
 * その行の文字列の添字 (マス目ではない)。end は含まない。2 行にまたがる
 * ときは start と end の row が違う。
 */
export type PathLink = {
  candidate: string;
  start: { row: number; col: number };
  end: { row: number; col: number };
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

const EXTENSIONS = TERMINAL_IMAGE_EXTENSIONS.join("|");

/**
 * シェルの流儀で空白を `\ ` と書いたパスも 1 本として拾う (`ls` や補完が
 * この形で出す)。候補にするときは `\` を外す。
 */
const IMAGE_PATH_RE = new RegExp(
  `(?:${PATH_CHAR}|\\\\ )*${NAME_CHAR}\\.(?:${EXTENSIONS})(?![\\p{L}\\p{N}])`,
  "giu",
);

/**
 * 引用符で囲まれた、空白を含みうるパス。`'/tmp/my shots/a b.png'` のように
 * 引用符で囲むのは、空白入りのパスを渡すときの普通の書き方。
 *
 * パスの形で始まるもの (`/` `~/` `./` `../`) に限る。`"see out.png"` のような
 * 引用された文まで 1 本にすると、肝心の `out.png` が拾えなくなる。
 */
const QUOTED_IMAGE_PATH_RE = new RegExp(
  `(['"])((?:/|~/|\\./|\\.\\./)[^'"\\n]*?${NAME_CHAR}\\.(?:${EXTENSIONS}))\\1`,
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

/** 本文の中で見つけた 1 本。index と length は本文の添字 (綴りそのもの)。 */
type ImagePathMatch = { path: string; index: number; length: number };

/**
 * 本文の中の画像パスを、出てくる順に位置つきで返す。重複はそのまま。
 *
 * 引用符つきを先に拾い、その範囲を空白で塗ってから素の形を拾う。塗らないと
 * `'/tmp/a b.png'` から `b.png` も別に拾ってしまう。
 */
function matchImagePaths(text: string): ImagePathMatch[] {
  const matches: ImagePathMatch[] = [];
  let rest = text;
  for (const match of text.matchAll(QUOTED_IMAGE_PATH_RE)) {
    const path = match[2] ?? "";
    // 引用符の内側の位置。
    const index = (match.index ?? 0) + 1;
    matches.push({ path, index, length: path.length });
    rest =
      rest.slice(0, index) +
      " ".repeat(path.length) +
      rest.slice(index + path.length);
  }
  for (const match of rest.matchAll(IMAGE_PATH_RE)) {
    const spelled = match[0];
    matches.push({
      path: spelled.split("\\ ").join(" "),
      index: match.index ?? 0,
      length: spelled.length,
    });
  }
  return matches
    .filter(
      (match) =>
        match.path.length <= MAX_IMAGE_PATH_LENGTH && !looksLikeUrl(match.path),
    )
    .sort((a, b) => a.index - b.index);
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
  for (const { path } of matchImagePaths(text)) {
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
 * 履歴 (tmux の capture-pane) から候補を拾い、新しい順 (後に出てきたものが先)
 * に並べる。棚は新しい順に並べるので、最初に出てきた順のままだと古い画像
 * ばかりが上限の枠を取る。
 *
 * 位置は最後に出てきた場所で決める。素の本文に無い候補 (折り返しを繋いで
 * できたもの) は、繋いだ本文での位置を使う (繋ぐのは改行を外すだけなので、
 * 前後関係は崩れない)。どちらにも無い候補 (CLI が割った行を組み直したもの)
 * は最も古い扱いにする。
 *
 * @param plain ANSI を落とした本文
 * @param width ペインの桁数
 */
export function findImagePathsNewestFirst(
  plain: string,
  width: number,
  limit = MAX_TERMINAL_IMAGE_PATHS,
): string[] {
  const candidates = findImagePathsInText(
    plain,
    width,
    MAX_HISTORY_IMAGE_CANDIDATES,
  );
  const joined = width > 0 ? joinWrappedLines(plain, width) : plain;
  const position = (candidate: string) => {
    const direct = plain.lastIndexOf(candidate);
    return direct >= 0 ? direct : joined.lastIndexOf(candidate);
  };
  return candidates
    .map((candidate) => ({ candidate, at: position(candidate) }))
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map((item) => item.candidate);
}

/**
 * 画面の行の上で、知っている画像パスが出ている範囲を返す。xterm のリンク
 * (terminal-screen.ts の registerLinkProvider) に渡し、カーソルが載ったら棚の
 * 同じ画像を強調するのに使う。
 *
 * 探す形は 3 つ。拾うとき (findImagePathsInText) と同じ形にそろえる。
 *
 * - 1 行の中にそのまま出ている
 * - 端末の幅で折り返された (幅いっぱいの行と次の行の頭が続いている)
 * - CLI が自分で割った (行末のパス片と次の行の最初の語。間の注記や字下げは
 *   空白なので落ちる)
 *
 * @param lines 画面の各行 (上から順)
 * @param width 端末の桁数。0 なら幅の折り返しは見ない
 * @param isKnown 棚にある綴りか。知らない綴りはリンクにしない (押しても開く
 *   ものが無い)
 */
export function findImagePathLinks(
  lines: string[],
  width: number,
  isKnown: (candidate: string) => boolean,
): PathLink[] {
  const links: PathLink[] = [];
  const seen = new Set<string>();
  const push = (link: PathLink) => {
    const key = `${link.start.row}:${link.start.col}:${link.end.row}:${link.end.col}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push(link);
  };
  for (let row = 0; row < lines.length; row += 1) {
    const line = lines[row] ?? "";
    for (const match of matchImagePaths(line)) {
      if (!isKnown(match.path)) continue;
      push({
        candidate: match.path,
        start: { row, col: match.index },
        end: { row, col: match.index + match.length },
      });
    }
    const next = lines[row + 1];
    if (next === undefined) continue;
    // 端末の幅で折り返された行。つないだ本文で、境目をまたぐものだけを見る。
    if (width > 0 && line.length >= width) {
      for (const match of matchImagePaths(line + next)) {
        const end = match.index + match.length;
        if (match.index >= line.length || end <= line.length) continue;
        if (!isKnown(match.path)) continue;
        push({
          candidate: match.path,
          start: { row, col: match.index },
          end: { row: row + 1, col: end - line.length },
        });
      }
    }
    // CLI が自分で割った行。
    const head = lastPathFragment(line);
    const tail = /\S+/.exec(next);
    if (!head || !tail) continue;
    const joined = head.text + tail[0];
    for (const match of matchImagePaths(joined)) {
      const end = match.index + match.length;
      if (end <= head.text.length || match.index >= head.text.length) continue;
      if (!isKnown(match.path)) continue;
      push({
        candidate: match.path,
        start: { row, col: head.index + match.index },
        end: { row: row + 1, col: tail.index + end - head.text.length },
      });
    }
  }
  return links;
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
