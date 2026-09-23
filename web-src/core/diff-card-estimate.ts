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
// 描いた直後の高さを見積もる。最後のハンクの後の「下へ広げる」行は、描いた後に
// ファイルの残りを問い合わせてから足すので入れない (入れると、描いた瞬間に
// 縮んでから伸びる 2 回の動きになる)。

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
  return Math.round(headerHeight + rows * rowHeight + gapRows * gapRowHeight);
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
    if (mark === " ") {
      flushBlock();
      current.basis.context += 1;
    } else if (mark === "-") {
      // 削除の後に追加が来たら、次のかたまりの削除は新しいかたまり。
      if (current.adds > 0) flushBlock();
      current.dels += 1;
    } else if (mark === "+") {
      current.adds += 1;
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
