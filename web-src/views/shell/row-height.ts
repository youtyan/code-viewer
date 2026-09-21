// 一覧の 1 行の高さ (px)。左のサイドバー・ファイルのツリー・目次・変更
// ファイルの一覧が同じ値を使う。表示密度で変わる。
//
// 出所はここ 1 か所。ファイルのツリーの仮想表示は行の高さで位置を計算する
// ので TS に値が要る。CSS へは applySidebarFontSize が --ui-row-h として書き、
// style.css の html, body ブロックの --ui-row-h は JS 実行前の初回描画用の
// 既定だけ (ui-layout.md の「CSS と TypeScript に同じ数値を書かない」)。

import type { ViewerFontSizeSetting } from "../../core/types";

export const ROW_HEIGHT: Record<ViewerFontSizeSetting, number> = {
  compact: 28,
  regular: 30,
  large: 34,
  xlarge: 38,
};

export function rowHeightFor(size: ViewerFontSizeSetting): number {
  return ROW_HEIGHT[size];
}
