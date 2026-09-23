// プロジェクトの色と頭文字 (純関数)。
//
// 各プロジェクトに色 1 つと頭文字 2 文字を付け、左のサイドバーの見出し・全体
// ボード・切替の小窓・通知・インストールした窓の上端の帯で同じものを使う。
// 色だけに頼らない (色の見分けにくい人・同じ色が 2 つ出たとき) ので、頭文字を
// いつも一緒に出す。
//
// 色は名前 (id) だけをここに持ち、値は web/style.css の名前の層
// (`--project-<id>`、頭文字の色は `--project-ink`) に明るい配色と暗い配色の
// 1 組ずつ置く。四角の地と頭文字の差 4.5:1 以上は project-colors.test.ts が
// style.css の値で確かめる。
//
// 並びは配る順。隣どうしを離れた色相にしてあるので、登録した順に配ると続けて
// 登録したプロジェクトが似た色にならない。1 色目の violet はアプリのアクセント
// (紫) と同じ系統で、見分けにくい色を避ける代わりにアクセントを 1 色目として扱う。

export const PROJECT_COLORS = [
  "violet",
  "green",
  "orange",
  "blue",
  "amber",
  "pink",
  "cyan",
  "red",
  "olive",
] as const;

export type ProjectColor = (typeof PROJECT_COLORS)[number];

export function isProjectColor(value: unknown): value is ProjectColor {
  return (
    typeof value === "string" &&
    (PROJECT_COLORS as readonly string[]).includes(value)
  );
}

/**
 * 次に配る色。まだ誰も使っていない色の最初、全部使っていれば使っている数が
 * いちばん少ない色の最初。外したプロジェクトの色は、次に登録したものに回る
 * (使っている数から消えるので)。
 */
export function nextProjectColor(
  used: readonly (ProjectColor | undefined)[],
): ProjectColor {
  const counts = new Map<ProjectColor, number>();
  for (const color of used) {
    if (color) counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  let best: ProjectColor = PROJECT_COLORS[0];
  for (const color of PROJECT_COLORS) {
    if ((counts.get(color) ?? 0) < (counts.get(best) ?? 0)) best = color;
  }
  return best;
}

/**
 * 色の無いものに、並びの順で配る (前の版で登録したもの)。既に付いている色は
 * 変えない。全部付いていれば同じ配列を返す (書かなくてよいと分かるように)。
 */
export function withProjectColors<T extends { color?: ProjectColor }>(
  items: readonly T[],
): readonly (T & { color: ProjectColor })[] {
  if (items.every((item) => item.color)) {
    return items as readonly (T & { color: ProjectColor })[];
  }
  const used = items.map((item) => item.color);
  return items.map((item, index) => {
    if (item.color) return item as T & { color: ProjectColor };
    const color = nextProjectColor(used);
    used[index] = color;
    return { ...item, color };
  });
}

/**
 * 名前の区切り (英数字と文字以外・小文字から大文字への境目・大文字の続きの
 * 終わり) で分けた語。
 */
function nameWords(name: string): string[] {
  const words: string[] = [];
  for (const chunk of name.match(/[\p{L}\p{N}]+/gu) ?? []) {
    words.push(
      ...chunk.split(/(?<=\p{Ll})(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/u),
    );
  }
  return words;
}

/**
 * 頭文字 2 文字。語が 2 つ以上なら最初の 2 語の頭 (`code-viewer` → CV、
 * `sample-v2` → SV、`codeViewer` → CV)、1 語ならその先頭 2 文字
 * (`notebook` → NO)。英字は大文字にする。語が無い名前 (記号だけ) は
 * 名前の先頭 2 文字。
 */
export function projectInitials(name: string): string {
  const words = nameWords(name);
  const letters =
    words.length >= 2
      ? [Array.from(words[0])[0], Array.from(words[1])[0]]
      : Array.from(words[0] ?? name.trim()).slice(0, 2);
  return letters.join("").toUpperCase();
}
