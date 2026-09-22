// 差分のカードの「代わりの横スクロールバー」の計算。
//
// カードの横スクロールバーは本物ならカードの下端にある。80 行を超えるカードでは
// 上の方を読んでいる間それが画面に出てこず、マウスだけでは横に送れなかった。
// そこで、本物のスクロールバーを持つ薄い箱をカードの下端に sticky で置き
// (本文の箱の下端に貼り付く)、中身の横位置と同期する。ここはその数え方だけを
// 持つ (DOM に触らない。配線は views/diff-hscroll.ts)。

/** 横に動く箱の大きさ (scrollWidth / clientWidth)。 */
export type ScrollExtent = { scrollWidth: number; clientWidth: number };

/** 端数で 1px だけはみ出す箱がある。それは送れる幅として数えない。 */
const OVERFLOW_TOLERANCE = 1;

/** その箱が横に送れる最大の量 (0 以上)。 */
export function maxScrollLeft(extent: ScrollExtent): number {
  return Math.max(0, extent.scrollWidth - extent.clientWidth);
}

/**
 * 代わりのスクロールバーを出すか。中身が枠に収まっている (送れない) なら出さない
 * (空の帯がカードの下に残らないように)。
 */
export function needsProxyScrollbar(extent: ScrollExtent): boolean {
  return maxScrollLeft(extent) > OVERFLOW_TOLERANCE;
}

/**
 * 片方の横位置を、もう片方へ写す値。送れる範囲に収め、整数にする。
 * 写した先の今の値と同じなら null (書かない = scroll イベントを起こさない。
 * 互いに写し合って止まらなくなるのを防ぐ)。
 */
export function mirroredScrollLeft(
  sourceLeft: number,
  target: ScrollExtent & { scrollLeft: number },
): number | null {
  const next = Math.min(
    maxScrollLeft(target),
    Math.max(0, Math.round(sourceLeft)),
  );
  return Math.abs(next - target.scrollLeft) < 0.5 ? null : next;
}
