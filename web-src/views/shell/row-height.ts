// 一覧の 1 行の高さ (px)。左のサイドバー・ファイルのツリー・目次・変更
// ファイルの一覧が同じ値を使う。表示密度で変わる。
//
// 出所はここ 1 か所。ファイルのツリーの仮想表示は行の高さで位置を計算する
// ので TS に値が要る。CSS へは applySidebarFontSize が --ui-row-h として書き、
// style.css の html, body ブロックの --ui-row-h は JS 実行前の初回描画用の
// 既定だけ (ui-layout.md の「CSS と TypeScript に同じ数値を書かない」)。

import { TOUCH_MEDIA_QUERY } from "../../core/mobile-layout";
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

/**
 * 今の表示密度の行の高さ。密度は applySidebarFontSize が body の
 * data-sidebar-font-size に書く。まだ書かれていない (起動直後・テスト) ときは
 * style.css の --ui-row-h の既定と同じ regular。知らない値は投げる。
 */
export function currentRowHeight(): number {
  const size = document.body.dataset.sidebarFontSize;
  if (size === undefined) return ROW_HEIGHT.regular;
  if (!(size in ROW_HEIGHT)) {
    throw new Error(`unknown display density on body: ${JSON.stringify(size)}`);
  }
  return ROW_HEIGHT[size as ViewerFontSizeSetting];
}

/**
 * 指の画面で押せる最小の高さ (px)。指の画面でなければ 0。値の出所は style.css の
 * --sp-touch (JS の前の初回描画から効く)。仮想表示の木は行の位置を TS で数える
 * ので、行の高さをこの値より低くしないためにここで読む。px でなければ投げる。
 */
export function touchRowFloor(): number {
  if (!window.matchMedia(TOUCH_MEDIA_QUERY).matches) return 0;
  const value = getComputedStyle(document.body)
    .getPropertyValue("--sp-touch")
    .trim();
  const px = Number.parseFloat(value);
  if (!value.endsWith("px") || !Number.isFinite(px)) {
    throw new Error(
      `the touch target height --sp-touch is not a px length: ${JSON.stringify(value)}`,
    );
  }
  return px;
}
