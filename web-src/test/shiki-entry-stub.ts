// UIテストは構文色付け以外の描画を最小DOMで検証する。別バンドルの読込は
// 保留のままにし、色付け完了後のDOM更新を各テストへ混ぜない。
export function createHighlighter(): Promise<never> {
  return new Promise<never>(() => undefined);
}
