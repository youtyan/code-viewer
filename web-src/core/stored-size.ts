// ドラッグで変えた寸法 (一覧の幅など) をブラウザ側に覚える。
//
// 表示設定は .code-viewer 配下に置くのが基本だが、「その画面でどれくらい
// 引き伸ばしたか」は開いているブラウザの都合なので localStorage に置く。
//
// 範囲のクランプは呼び出し側の責任 (適用時と同じ上限・下限を使う)。ここは
// localStorage が触れない文脈でも操作を落とさないための包みだけを持つ。

import { errorWithCause } from "./error-detail";

export type StoredSizeReadResult =
  | { ok: true; value: number }
  | { ok: false; value: number; error: unknown };

export type StoredSizeWriteResult =
  | { ok: true }
  | { ok: false; error: unknown };

/** 保存済みの寸法を読む。未保存・壊れた値は fallback、保存領域の失敗は理由も返す。 */
export function readStoredSize(
  key: string,
  fallback: number,
): StoredSizeReadResult {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? Number(raw) : Number.NaN;
    return { ok: true, value: Number.isFinite(parsed) ? parsed : fallback };
  } catch (error) {
    return { ok: false, value: fallback, error };
  }
}

/** 寸法を保存する。保存領域の失敗は呼び出し側が表示できるよう理由を返す。 */
export function writeStoredSize(
  key: string,
  value: number,
): StoredSizeWriteResult {
  try {
    window.localStorage.setItem(key, String(value));
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

const reportedFailures = new Set<string>();

/**
 * 保存領域の失敗を元の例外ごと console.error に出す。寸法はドラッグのたびに
 * 読み書きするので、同じ操作の失敗は 1 回だけ出す。
 */
export function reportStoredSizeFailure(
  result: StoredSizeReadResult | StoredSizeWriteResult,
  operation: string,
): void {
  if (!("error" in result) || reportedFailures.has(operation)) return;
  reportedFailures.add(operation);
  console.error(errorWithCause(operation, result.error));
}
