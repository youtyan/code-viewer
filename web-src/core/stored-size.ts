// ドラッグで変えた寸法 (下パネルの高さ、一覧の幅など) をブラウザ側に覚える。
//
// 表示設定は .code-viewer 配下に置くのが基本だが、「その画面でどれくらい
// 引き伸ばしたか」は開いているブラウザの都合なので localStorage に置く。
//
// 範囲のクランプは呼び出し側の責任 (適用時と同じ上限・下限を使う)。ここは
// localStorage が触れない文脈でも操作を落とさないための包みだけを持つ。

/** 保存済みの寸法を読む。未保存・壊れた値・localStorage 不可なら fallback。 */
export function readStoredSize(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
    return fallback;
  }
}

/** 寸法を保存する。保存できなくても操作自体は成立させる。 */
export function writeStoredSize(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
}
