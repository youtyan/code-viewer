// パンくず (プロジェクト / フォルダ / … / ファイル) が入りきらないとき、真ん中の
// 段を「…」1 つに畳む範囲を決める。DOM に触らない (配線は
// views/breadcrumb-fit.ts)。
//
// 何もしないと、各段が同じ割合で縮んで全部 1 文字 (「r / c / v / l / …」) に
// なり、どこにいるのか読めなくなった。先頭 (プロジェクト・一番上のフォルダ) と
// 末尾 2 段 (いるフォルダと今のファイル) は残し、先頭の次から順に畳む。

export type BreadcrumbWidths = {
  /** 各段の文字の幅 (縮める前)。先頭から順。 */
  parts: readonly number[];
  /** 区切り 1 つの幅 (前後の余白を含む)。 */
  separator: number;
  /** 畳んだ所に置く「…」の幅。 */
  ellipsis: number;
  /** パンくずに使える幅。 */
  available: number;
};

/** 畳む段の範囲 [from, to)。畳まなくてよければ null。 */
export type CollapsedRange = { from: number; to: number } | null;

/** 末尾で残す段の数 (いるフォルダと今のファイル)。 */
const KEEP_TAIL = 2;

function totalWidth(
  widths: BreadcrumbWidths,
  from: number,
  to: number,
): number {
  const { parts, separator, ellipsis } = widths;
  let total = 0;
  let items = 0;
  for (let index = 0; index < parts.length; index++) {
    if (index === from) {
      total += ellipsis;
      items++;
    }
    if (index >= from && index < to) continue;
    total += parts[index] ?? 0;
    items++;
  }
  return total + separator * Math.max(0, items - 1);
}

export function collapsedBreadcrumbRange(
  widths: BreadcrumbWidths,
): CollapsedRange {
  const count = widths.parts.length;
  if (totalWidth(widths, count, count) <= widths.available) return null;
  // 畳めるのは先頭の次から、末尾 2 段の手前まで。1 段も無ければ畳まない
  // (残りは各段の省略記号に任せる)。
  const last = count - KEEP_TAIL;
  if (last <= 1) return null;
  for (let to = 2; to <= last; to++) {
    if (totalWidth(widths, 1, to) <= widths.available) return { from: 1, to };
  }
  return { from: 1, to: last };
}
