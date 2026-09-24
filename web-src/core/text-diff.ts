// 設定ファイルに書く前と後の unified diff。フック・statusLine を入れる・外す
// 確認の画面に出す (サーバが plan で作る。画面は diff2html でこのアプリの差分と
// 同じ見た目に描くだけで、推測しない)。
//
// 設定ファイルは数十〜数百行なので、行の最長共通部分列を表で求める。表が
// 大きすぎるとき (MAX_TABLE_CELLS を超える) は、全部を消して全部を足す 1 つの
// 塊にする (差分としては正しいが、最小ではない)。

/** 前後にそえる変わらない行の数 (git と同じ)。 */
const CONTEXT_LINES = 3;
/** 最長共通部分列の表の上限 (行数の積)。 */
const MAX_TABLE_CELLS = 4_000_000;

type Op = { kind: " " | "-" | "+"; text: string };

function linesOf(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return lines;
}

function editScript(before: string[], after: string[]): Op[] {
  const n = before.length;
  const m = after.length;
  if (n * m > MAX_TABLE_CELLS) {
    return [
      ...before.map((text) => ({ kind: "-" as const, text })),
      ...after.map((text) => ({ kind: "+" as const, text })),
    ];
  }
  // lengths[i][j] = before[i..] と after[j..] の最長共通部分列の長さ。
  const width = m + 1;
  const lengths = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lengths[i * width + j] =
        before[i] === after[j]
          ? (lengths[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(
              lengths[(i + 1) * width + j] ?? 0,
              lengths[i * width + j + 1] ?? 0,
            );
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && before[i] === after[j]) {
      ops.push({ kind: " ", text: before[i] ?? "" });
      i += 1;
      j += 1;
    } else if (
      // 同じ長さなら消す行を先に出す (git と同じ並び)。
      i < n &&
      (j >= m ||
        (lengths[(i + 1) * width + j] ?? 0) >=
          (lengths[i * width + j + 1] ?? 0))
    ) {
      ops.push({ kind: "-", text: before[i] ?? "" });
      i += 1;
    } else {
      ops.push({ kind: "+", text: after[j] ?? "" });
      j += 1;
    }
  }
  return ops;
}

function range(start: number, count: number): string {
  // 行の無い側は git と同じく「直前の行番号,0」。
  const from = count === 0 ? start - 1 : start;
  return count === 1 ? `${from}` : `${from},${count}`;
}

/**
 * before (ファイルが無ければ null) から after への unified diff。見出しの
 * 名前は name。変わらなければ空文字。
 */
export function unifiedDiff(
  before: string | null,
  after: string,
  name: string,
): string {
  if ((before ?? "") === after && before !== null) return "";
  const ops = editScript(linesOf(before ?? ""), linesOf(after));
  if (ops.every((op) => op.kind === " ")) return "";
  // 変わった行の前後 CONTEXT_LINES 行を含む範囲を塊にまとめる。
  const keep = ops.map(() => false);
  ops.forEach((op, index) => {
    if (op.kind === " ") return;
    for (
      let k = Math.max(0, index - CONTEXT_LINES);
      k <= Math.min(ops.length - 1, index + CONTEXT_LINES);
      k += 1
    ) {
      keep[k] = true;
    }
  });
  const out = [
    `diff --git a/${name} b/${name}`,
    before === null ? "--- /dev/null" : `--- a/${name}`,
    `+++ b/${name}`,
  ];
  let oldLine = 1;
  let newLine = 1;
  let index = 0;
  while (index < ops.length) {
    if (!keep[index]) {
      const op = ops[index];
      if (op?.kind !== "+") oldLine += 1;
      if (op?.kind !== "-") newLine += 1;
      index += 1;
      continue;
    }
    const body: string[] = [];
    const oldStart = oldLine;
    const newStart = newLine;
    let oldCount = 0;
    let newCount = 0;
    for (let op = ops[index]; op && keep[index]; op = ops[index]) {
      body.push(`${op.kind}${op.text}`);
      if (op.kind !== "+") {
        oldCount += 1;
        oldLine += 1;
      }
      if (op.kind !== "-") {
        newCount += 1;
        newLine += 1;
      }
      index += 1;
    }
    out.push(
      `@@ -${range(oldStart, oldCount)} +${range(newStart, newCount)} @@`,
      ...body,
    );
  }
  return `${out.join("\n")}\n`;
}
