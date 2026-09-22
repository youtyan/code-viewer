// 戻る/進むのために、履歴の項ごとの本文のスクロール位置を覚えておく入れ物。
//
// 本文は窓ではなく自分の箱 (#content) でスクロールするので、ブラウザは位置を
// 戻してくれない (窓の位置しか覚えない)。履歴の項に鍵を持たせ、その鍵で位置を
// 覚え、戻ったときに同じ鍵の位置へ戻す。
//
// 鍵が無い項 (この仕組みより前に積まれた項・外から来た項) は覚えない。位置が
// 分からないときは先頭 (0) から見せる。

/** 覚えておく項の数。古いものから捨てる。 */
const DEFAULT_LIMIT = 50;

export type ScrollMemory = {
  /** その項の位置を覚える。鍵が無ければ何もしない。 */
  remember(key: string | null, top: number): void;
  /** その項の位置。覚えていなければ 0。 */
  recall(key: string | null): number;
  /** 覚えている項の数 (検査用)。 */
  size(): number;
};

export function createScrollMemory(limit = DEFAULT_LIMIT): ScrollMemory {
  // Map は挿入順を保つので、あふれたら先頭 (一番古い項) を捨てる。
  const positions = new Map<string, number>();
  return {
    remember(key, top) {
      if (!key) return;
      // 覚え直したものは新しい扱いにする (一番古い項として捨てられないように)。
      positions.delete(key);
      positions.set(key, Math.max(0, Math.round(top)));
      while (positions.size > limit) {
        const oldest = positions.keys().next();
        if (oldest.done) break;
        positions.delete(oldest.value);
      }
    },
    recall(key) {
      if (!key) return 0;
      return positions.get(key) ?? 0;
    },
    size() {
      return positions.size;
    },
  };
}

/** 履歴の項の state から、この仕組みの鍵を読む。 */
export function scrollKeyOfHistoryState(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const key = (state as { scrollKey?: unknown }).scrollKey;
  return typeof key === "string" && key ? key : null;
}
