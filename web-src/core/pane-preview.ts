// エージェントの行に載せたときに出す「シェルの中の覗き窓」の決まり。DOM に
// 触らない。描く・問い合わせるのは views/agents/pane-preview.ts。
//
// 中身は既存の GET /_agent/capture (履歴 0 行 = 今の画面) をそのまま使う。
// 色は付けず、画面の下から PANE_PREVIEW_LINES 行を文字で出す。

import { stripAnsi } from "./terminal-images";

/** 載せてから出すまで。通りすがりの行で問い合わせない。 */
export const PANE_PREVIEW_DELAY_MS = 400;
/** 出している間の取り直しの間隔 (前の応答が返ってから数える)。 */
export const PANE_PREVIEW_REFRESH_MS = 1000;
/** 出す行数。窓の高さはこの行数で決まり、中身で伸び縮みしない。 */
export const PANE_PREVIEW_LINES = 24;
/** 行と窓の間・画面の端との間 (px)。 */
export const PANE_PREVIEW_GAP = 8;

/**
 * 画面の文字から、窓に出す行。色の指定を外し、下の空行 (tmux は画面の高さ
 * ぶんの行を返すので、入力欄より下が空で埋まる) を落としてから下の lines 行。
 */
export function panePreviewLines(content: string, lines: number): string[] {
  const all = stripAnsi(content).replace(/\r/g, "").split("\n");
  let end = all.length;
  while (end > 0 && (all[end - 1] ?? "").trim() === "") end -= 1;
  return all.slice(Math.max(0, end - lines), end).map((line) => line.trimEnd());
}

export type PanePreviewPlacement =
  /** 行の右 (左のサイドバー。一覧の外の本文の上に重ねる)。 */
  | "right"
  /** 行の下 (全体ボード。行が横に長いので、下の行の上に重ねる)。 */
  | "below";

export type PreviewRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/**
 * 窓の左上。右に出すものは行の上端にそろえ、下にはみ出すなら上へ寄せる。
 * 下に出すものは入らなければ行の上に出す。どちらも画面の中に収める。
 */
export function panePreviewPosition(input: {
  anchor: PreviewRect;
  size: { width: number; height: number };
  viewport: { width: number; height: number };
  placement: PanePreviewPlacement;
}): { left: number; top: number } {
  const { anchor, size, viewport } = input;
  const gap = PANE_PREVIEW_GAP;
  const clamp = (value: number, max: number) =>
    Math.max(gap, Math.min(value, max));
  const maxLeft = viewport.width - size.width - gap;
  const maxTop = viewport.height - size.height - gap;
  if (input.placement === "right") {
    return {
      left: clamp(anchor.right + gap, maxLeft),
      top: clamp(anchor.top, maxTop),
    };
  }
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - size.height;
  const top = below <= maxTop || above < gap ? below : above;
  return { left: clamp(anchor.left, maxLeft), top: clamp(top, maxTop) };
}
