// Diff のカードの高さの見積もり (中身が届くまでカードが取る高さ)。
//
// 見積もりが実際と違うと、中身が届いたときにカードの高さが変わり、下のカードが
// 動く (レイアウトシフト)。前は `(追加 + 削除 + 10) × 22px` で、文脈を 10 行と
// 置いていたので短いファイルで 3〜4 倍に見積もっていた (264px → 実際 68px)。
//
// サーバは差分の本文からファイルごとの材料 (DiffRowBasis) を数えて返し、画面は
// 自分の実際の寸法 (1 行の高さ・見出しの高さ・広げるボタンの高さ。密度で変わる)
// を当てて高さを出す。材料が無いとき (予算を超えた・古い応答) は、追加・削除と
// 分かる範囲のハンクの数・ファイルの行数から数え直す。
//
// 描いた直後の高さを見積もる。最後のハンクの後の「下へ広げる」行は、行が続く
// 見込みのときだけ入れる (tail_more)。横に長い行があると貼り付く横スクロール
// バーの行 (views/diff-hscroll.ts) が出るので、サーバが幅を取りうる行を選んで
// 返し (widest)、画面が実際の字体でその幅を測って、出るかを前もって決める。

import { needsProxyScrollbar } from "./hscroll-proxy";

/** ファイルごとの材料。サーバが差分の本文から数える (`diffRowBasisFromText`)。 */
export type DiffRowBasis = {
  /** ハンクの数 (`@@` の数)。 */
  hunks: number;
  /** 文脈の行 (変わっていない行) の数。 */
  context: number;
  /**
   * 左右に並べたときの変更の行の数。変更のかたまり (続いた削除と追加) ごとの
   * max(削除, 追加) の和。1 列に並べるときは追加 + 削除。
   */
  split_changes: number;
  /** 最初のハンクが新しい側の 2 行目以降から始まるか (上へ広げるボタンが 1 段出る)。 */
  lead_gap: boolean;
  /**
   * 最後のハンクの後ろの文脈が 3 行ちょうどか (= まだ行が続く見込み。git は
   * 変更の後ろに文脈を 3 行まで付け、ファイルの終わりで切れると 3 行未満になる)。
   * 見込みなら画面は最後の「下へ広げる」行を描いた時点で置く
   * (views/hunk-expand.ts)。無い (古い応答・追跡外) ときは false と同じ。
   */
  tail_more?: boolean;
  /** 横に一番長くなりうる行 (横のスクロールバーが出るかを画面が決める)。 */
  widest?: DiffWidestLines;
};

/**
 * 横に一番長くなりうる行 (`widestLines`)。画面はこれだけを実際の字体で測る。
 * 行は差分の印 (`+` `-` ` `) を外した本文。
 */
export type DiffWidestLines = {
  /** 古い側の表 (文脈と削除) の行。 */
  old: string[];
  /** 新しい側の表 (文脈と追加) の行。 */
  new: string[];
  /** ハンクの見出しの行 (`@@ … @@ 関数名`)。左右の表示では古い側の表にだけ出る。 */
  head: string[];
};

export type DiffCardLayout = "side-by-side" | "line-by-line";

/** 画面の実際の寸法 (px)。密度で変わるので画面が測って渡す。 */
export type DiffCardMetrics = {
  /** 差分の 1 行の高さ (描いた表の行の実際の高さ)。 */
  rowHeight: number;
  /** ファイルの見出し (`.d2h-file-header`) の高さ。 */
  headerHeight: number;
  /** ハンクの区切りの広げるボタン 1 段の高さ (`--code-line-height`)。 */
  gapRowHeight: number;
  /** 最後のハンクの後ろの「下へ広げる」行の高さ。測れなければ 0 (入れない)。 */
  trailingRowHeight?: number;
  /** 横のスクロールバーの判定に使う寸法。測れなければ無し (バーの行を入れない)。 */
  hscroll?: DiffCardHScrollMetrics;
};

export type DiffCardHScrollMetrics = {
  /** 貼り付く横スクロールバーの行 (`.gdp-hscroll`) の高さ。 */
  rowHeight: number;
  /**
   * 表ごとの、行の本文が使える幅 (表の枠の幅から行番号・印・余白を引いたもの)。
   * 左右の表示は [古い側, 新しい側]、1 列は [表]。
   */
  lineRoom: number[];
  /** ハンクの見出しの文字が使える幅 (見出しは最初の表にだけ出る)。 */
  headRoom: number;
  /** 行の本文の幅 (px。画面の字体で測る)。 */
  lineWidth: (text: string) => number;
  /** ハンクの見出しの文字の幅 (px)。 */
  headWidth: (text: string) => number;
};

export type DiffCardEstimateInput = {
  additions: number;
  deletions: number;
  /** git の状態の 1 文字 (A: 新規・D: 削除・M: 変更・R: 改名…)。 */
  status?: string;
  binary?: boolean;
  /** サーバが数えた材料。あればこれを使う。 */
  basis?: DiffRowBasis | null;
  /** 材料が無いときのハンクの数 (分からなければ 1)。 */
  hunks?: number;
  /** 材料が無いときの新しい側のファイルの行数 (分かる範囲。文脈の頭打ちに使う)。 */
  fileLines?: number | null;
  layout: DiffCardLayout;
  metrics: DiffCardMetrics;
};

/** git が変更の前後に付ける文脈の行 (既定の -U3)。 */
export const DIFF_CONTEXT_LINES = 3;

/**
 * 材料が無いときの材料。文脈は「ハンクごとに前後 3 行、ファイルの長さで頭打ち」。
 * 変更のかたまりの形は分からないので、左右の行は max(追加, 削除) と置く。
 */
export function fallbackDiffRowBasis(input: {
  additions: number;
  deletions: number;
  status?: string;
  hunks?: number;
  fileLines?: number | null;
}): DiffRowBasis {
  const additions = Math.max(0, input.additions);
  const deletions = Math.max(0, input.deletions);
  const changed = additions + deletions;
  const hunks = changed === 0 ? 0 : Math.max(1, input.hunks ?? 1);
  const unchanged =
    input.fileLines == null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, input.fileLines - additions);
  // 新規と削除 (ファイルごと) は 1 つのハンクがファイル全体で、文脈が無い。
  const whole = input.status === "A" || input.status === "D" || unchanged === 0;
  const context = whole
    ? 0
    : Math.min(hunks * DIFF_CONTEXT_LINES * 2, unchanged);
  return {
    hunks,
    context,
    split_changes: Math.max(additions, deletions),
    lead_gap: !whole,
  };
}

/**
 * 描いた直後のカードの高さ (px)。二進と、ハンクの無い差分 (改名だけ・モードだけ)
 * は行から数えられないので null (呼び出し側はサーバの固定の見積もりを使う)。
 */
export function estimateDiffCardHeight(
  input: DiffCardEstimateInput,
): number | null {
  if (input.binary) return null;
  const basis = input.basis ?? fallbackDiffRowBasis(input);
  if (basis.hunks === 0) return null;
  const changes =
    input.layout === "side-by-side"
      ? basis.split_changes
      : Math.max(0, input.additions) + Math.max(0, input.deletions);
  const rows = basis.context + changes;
  // 区切り: 最初のハンクの上は、ファイルの途中から始まるときだけ 1 段。2 つ目
  // 以降のハンクの上は、前のハンクとの間を上下に広げる 2 段
  // (views/hunk-expand.ts の attachExpandControls)。
  const gapRows = (basis.lead_gap ? 1 : 0) + (basis.hunks - 1) * 2;
  const { rowHeight, headerHeight, gapRowHeight } = input.metrics;
  // 最後の「下へ広げる」行は、行が続く見込みのときに描いた時点で置かれる
  // (削除したファイルには新しい側が無いので置かない)。
  const trailing =
    basis.tail_more && input.status !== "D"
      ? (input.metrics.trailingRowHeight ?? 0)
      : 0;
  const { hscroll } = input.metrics;
  const scrollbar =
    hscroll && diffCardScrollsSideways(basis.widest, input.layout, hscroll)
      ? hscroll.rowHeight
      : 0;
  return Math.round(
    headerHeight +
      rows * rowHeight +
      gapRows * gapRowHeight +
      trailing +
      scrollbar,
  );
}

/**
 * 描いたカードに貼り付く横スクロールバーが出るか。バーを出す判定
 * (`needsProxyScrollbar`) に、行の幅と表の枠の幅の代わりに、本文の幅と本文が
 * 使える幅を渡す (どちらも行番号・印・余白の分だけ小さいので差は同じ)。
 */
export function diffCardScrollsSideways(
  widest: DiffWidestLines | undefined,
  layout: DiffCardLayout,
  hscroll: DiffCardHScrollMetrics,
): boolean {
  if (!widest) return false;
  const over = (width: number, room: number) =>
    needsProxyScrollbar({ scrollWidth: width, clientWidth: room });
  if (
    widest.head.some((line) => over(hscroll.headWidth(line), hscroll.headRoom))
  )
    return true;
  const tables =
    layout === "side-by-side"
      ? [widest.old, widest.new]
      : [[...widest.old, ...widest.new]];
  if (tables.length !== hscroll.lineRoom.length)
    throw new Error(
      `diff card width measured for ${hscroll.lineRoom.length} tables, but ${layout} draws ${tables.length}`,
    );
  return tables.some((lines, i) =>
    lines.some((line) => over(hscroll.lineWidth(line), hscroll.lineRoom[i])),
  );
}

/**
 * 行の本文の幅 (px)。タブは次の止まり (tab-size × 空白の幅ごと) まで進め、
 * 止まりまで空白の半分に足りなければその次の止まりまで進める (ブラウザの決まり)。
 */
export function tabbedTextWidth(
  text: string,
  measure: (text: string) => number,
  tabSize: number,
): number {
  const [first, ...rest] = text.split("\t");
  const space = measure(" ");
  const stop = tabSize * space;
  let x = measure(first);
  for (const part of rest) {
    let next = (Math.floor(x / stop) + 1) * stop;
    if (next - x < space / 2) next += stop;
    x = next + measure(part);
  }
  return x;
}

/** 候補の行の数と、1 行の文字の数の上限 (応答を大きくしない)。 */
const WIDEST_LINE_LIMIT = 8;
const WIDEST_TEXT_LIMIT = 1000;

/** 幅の無い字 (結合文字・ZWJ などの書式の字)。 */
const ZERO_WIDTH_CHAR = /\p{M}|\p{Cf}/u;
/** 等幅の字体に無く、全角で描かれる字 (CJK・かな・ハングル・全角・絵文字)。 */
const WIDE_CHAR =
  /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u;

/** 字の種類ごとの数 [ASCII, タブ, 全角, その他]。 */
function charKindCounts(text: string): number[] {
  const counts = [0, 0, 0, 0];
  for (const ch of text) {
    if (ch === "\t") counts[1] += 1;
    else if (ch <= "\u007f") counts[0] += 1;
    else if (WIDE_CHAR.test(ch)) counts[2] += 1;
    else if (!ZERO_WIDTH_CHAR.test(ch)) counts[3] += 1;
  }
  return counts;
}

/**
 * 字の幅が分からなくても、一番幅を取りうる行。字を 4 種類 (ASCII・タブ・全角・
 * その他) に分けて数え、どの種類でも別の行以下の行は外す (字の幅がどうでも、
 * その行より広くならない)。残りが多ければ、おおよその幅の広い順に上限まで。
 */
export function widestLines(lines: readonly string[]): string[] {
  const kept: { text: string; counts: number[] }[] = [];
  const covers = (a: number[], b: number[]) => a.every((n, i) => n >= b[i]);
  for (const text of lines) {
    const counts = charKindCounts(text);
    if (kept.some((k) => covers(k.counts, counts))) continue;
    for (let i = kept.length - 1; i >= 0; i--)
      if (covers(counts, kept[i].counts)) kept.splice(i, 1);
    kept.push({ text, counts });
  }
  const rough = ([ascii, tab, wide, other]: number[]) =>
    ascii + tab * 4 + wide * 2 + other;
  return kept
    .sort((a, b) => rough(b.counts) - rough(a.counts))
    .slice(0, WIDEST_LINE_LIMIT)
    .map((k) => k.text.slice(0, WIDEST_TEXT_LIMIT));
}

/**
 * `git diff` の本文から、ファイルごとの材料を数える。鍵は新しい側のパス
 * (削除なら古い側)。`--- ` / `+++ ` はハンクの外でだけ見出しとして読む
 * (ハンクの中の `---` で始まる行は、`--` で始まる行の削除)。
 */
export function diffRowBasisFromText(
  diffText: string,
): Map<string, DiffRowBasis> {
  const out = new Map<string, DiffRowBasis>();
  let current: {
    oldPath: string | null;
    newPath: string | null;
    basis: DiffRowBasis;
    inHunk: boolean;
    dels: number;
    adds: number;
    /** いまのハンクの終わりに続いている文脈の行の数。 */
    tail: number;
    /** 表ごとの行の本文 (候補を選ぶため。ファイルの終わりで捨てる)。 */
    lines: { old: string[]; new: string[]; head: string[] };
  } | null = null;
  const flushBlock = () => {
    if (!current) return;
    current.basis.split_changes += Math.max(current.dels, current.adds);
    current.dels = 0;
    current.adds = 0;
  };
  const flushFile = () => {
    if (!current) return;
    flushBlock();
    // 新しい側が無い (削除) ときは続きも無い。
    current.basis.tail_more =
      current.newPath !== null &&
      current.basis.hunks > 0 &&
      current.tail >= DIFF_CONTEXT_LINES;
    const { lines } = current;
    current.basis.widest = {
      old: widestLines(lines.old),
      new: widestLines(lines.new),
      head: widestLines(lines.head),
    };
    const key = current.newPath ?? current.oldPath;
    if (key !== null) out.set(key, current.basis);
    current = null;
  };
  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flushFile();
      const same = samePathFromGitHeader(line.slice("diff --git ".length));
      current = {
        oldPath: same,
        newPath: same,
        basis: { hunks: 0, context: 0, split_changes: 0, lead_gap: false },
        inHunk: false,
        dels: 0,
        adds: 0,
        tail: 0,
        lines: { old: [], new: [], head: [] },
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("@@")) {
      flushBlock();
      const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (!header)
        throw new Error(`unreadable hunk header in git diff: ${line}`);
      if (current.basis.hunks === 0)
        current.basis.lead_gap = Number(header[1]) >= 2;
      current.basis.hunks += 1;
      current.inHunk = true;
      current.tail = 0;
      current.lines.head.push(line);
      continue;
    }
    if (!current.inHunk) {
      // 二進と改名だけの差分には --- / +++ が無いので、改名の行からも取る。
      if (line.startsWith("rename to ") || line.startsWith("copy to "))
        current.newPath = diffPath(line.slice(line.indexOf(" to ") + 4), "");
      else if (line.startsWith("--- "))
        current.oldPath = diffPath(line.slice(4), "a/");
      else if (line.startsWith("+++ "))
        current.newPath = diffPath(line.slice(4), "b/");
      continue;
    }
    const mark = line[0];
    // CRLF のファイルの行の終わりの CR は描かれない。
    const text = line.slice(1).replace(/\r$/, "");
    if (mark === " ") {
      flushBlock();
      current.basis.context += 1;
      current.tail += 1;
      current.lines.old.push(text);
      current.lines.new.push(text);
    } else if (mark === "-") {
      // 削除の後に追加が来たら、次のかたまりの削除は新しいかたまり。
      if (current.adds > 0) flushBlock();
      current.dels += 1;
      current.tail = 0;
      current.lines.old.push(text);
    } else if (mark === "+") {
      current.adds += 1;
      current.tail = 0;
      current.lines.new.push(text);
    }
    // `\ No newline at end of file` と、本文の最後の空行は行に数えない。
  }
  flushFile();
  return out;
}

/**
 * `diff --git a/P b/P` の P (左右が同じときだけ。改名は左右が違い、空白を含む
 * パスでは区切りが決まらないので null)。
 */
function samePathFromGitHeader(rest: string): string | null {
  if (rest.startsWith('"')) {
    const match = /^("(?:[^"\\]|\\.)*") ("(?:[^"\\]|\\.)*")$/.exec(rest);
    if (!match) return null;
    const left = unquoteGitPath(match[1]);
    const right = unquoteGitPath(match[2]);
    return left.slice(2) === right.slice(2) ? right.slice(2) : null;
  }
  if (rest.length % 2 === 0) return null;
  const half = (rest.length - 1) / 2;
  const left = rest.slice(0, half);
  const right = rest.slice(half + 1);
  if (!left.startsWith("a/") || !right.startsWith("b/")) return null;
  return left.slice(2) === right.slice(2) ? right.slice(2) : null;
}

/** 見出しのパス (`a/x`・`"b/\303\244"`・`/dev/null`) を、前置きを外したパスに。 */
function diffPath(raw: string, prefix: string): string | null {
  // git は見出しのパスの後ろにタブを付けることがある (空白を含むパス)。
  const trimmed = raw.replace(/\t$/, "");
  if (trimmed === "/dev/null") return null;
  const path = trimmed.startsWith('"') ? unquoteGitPath(trimmed) : trimmed;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/** git の C 風の引用 (`"\t"`・`"\""`・8 進の UTF-8 の並び) を外す。 */
export function unquoteGitPath(quoted: string): string {
  if (!quoted.startsWith('"') || !quoted.endsWith('"') || quoted.length < 2)
    throw new Error(`not a quoted git path: ${quoted}`);
  const body = quoted.slice(1, -1);
  const bytes: number[] = [];
  const escapes: Record<string, number> = {
    a: 7,
    b: 8,
    t: 9,
    n: 10,
    v: 11,
    f: 12,
    r: 13,
    '"': 34,
    "\\": 92,
  };
  const encoder = new TextEncoder();
  for (let i = 0; i < body.length; i++) {
    const codePoint = body.codePointAt(i);
    if (codePoint === undefined) break;
    if (codePoint !== 92) {
      // 引用の中でも、8 進にされない文字 (core.quotepath=false の非 ASCII) は
      // そのまま入っている。サロゲートペアは 2 つで 1 文字。
      const ch = String.fromCodePoint(codePoint);
      bytes.push(...encoder.encode(ch));
      i += ch.length - 1;
      continue;
    }
    const next = body[i + 1];
    if (next === undefined)
      throw new Error(`dangling escape in git path: ${quoted}`);
    if (/[0-7]/.test(next)) {
      const octal = body.slice(i + 1, i + 4);
      if (!/^[0-7]{3}$/.test(octal))
        throw new Error(`bad octal escape in git path: ${quoted}`);
      bytes.push(Number.parseInt(octal, 8));
      i += 3;
      continue;
    }
    const code = escapes[next];
    if (code === undefined)
      throw new Error(`unknown escape \\${next} in git path: ${quoted}`);
    bytes.push(code);
    i += 1;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(
    new Uint8Array(bytes),
  );
}
