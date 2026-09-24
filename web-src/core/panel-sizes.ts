// 利用者が幅を変えられる骨格の枠の、既定・下限・上限。
//
// 画面 (適用と保存値の読み込み) とサーバ (設定ファイルの検査) が同じ値を
// 使うよう、ここ 1 か所に置く。CSS には JS 実行前の初回描画用の既定だけを
// 書く (ui-layout.md の「CSS と TypeScript に同じ数値を書かない」)。

export type PanelSize = { default: number; min: number; max: number };

/** 左のサイドバー (プロジェクトとエージェント)。 */
export const NAV_WIDTH: PanelSize = { default: 280, min: 220, max: 440 };

/** ファイルのツリー (#sidebar)。 */
export const SIDEBAR_WIDTH: PanelSize = { default: 240, min: 180, max: 900 };

/**
 * 本文の左の一覧の列 (Diff の変更ファイル #sidebar・History のコミット
 * #history-panel・選んでいる作業ツリーの #worktree-panel。3 つで同じ幅)。
 * 名前と設定の鍵 (historyWidth) は、この列が History の一覧だけだった頃のまま。
 * 下限は詰めた幅 (core/list-column.ts) を兼ねる: 題と札だけが読める幅。
 */
export const HISTORY_WIDTH: PanelSize = { default: 320, min: 240, max: 800 };

/**
 * ターミナルの画像の棚を右・左に置いたときの幅。既定はサムネイルが見分けられ、
 * 名前が 1 行で読める幅。
 */
export const TERMINAL_IMAGE_SHELF_WIDTH: PanelSize = {
  default: 220,
  min: 160,
  max: 480,
};

/** 同じく下・上に置いたときの高さ (見出しの行・サムネイル・名前と時刻の 2 行)。 */
export const TERMINAL_IMAGE_SHELF_HEIGHT: PanelSize = {
  default: 180,
  min: 140,
  max: 400,
};

export function clampPanelSize(size: PanelSize, value: number): number {
  return Math.max(size.min, Math.min(size.max, value));
}
