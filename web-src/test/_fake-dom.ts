// 各テストファイルが独立した FakeElement を持っており (フィールド構成・
// textContent/innerHTML setter が異なるため統合困難)、メソッド本体だけが偶然
// 似てしまっている。listener 配列管理と closest 走査の純関数版を提供して
// 共通化し、各メソッドは 1 行委譲にする。

export function removeListenerFrom<L>(
  listeners: Record<string, L[]>,
  event: string,
  listener: L,
): void {
  listeners[event] = (listeners[event] || []).filter((c) => c !== listener);
}

// FakeElement.closest 用。各クラスの `parentElement` プロパティを duck-typing
// で辿る (型は緩く unknown 経由で読み取り。呼び出し側で <FakeElement> を指定
// する想定)。1 行委譲で書けるようにパラメータは selector だけ受け取る。
export function closestFor<T extends { matches(selector: string): boolean }>(
  start: T,
  selector: string,
): T | null {
  let n: T | null = start;
  while (n) {
    if (n.matches(selector)) return n;
    n = (n as unknown as { parentElement: T | null }).parentElement;
  }
  return null;
}
