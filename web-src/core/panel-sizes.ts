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
 * History のコミットの一覧 (#history-panel。作業ツリーの一覧 #worktree-panel も
 * 同じ幅を使う)。既定は件名が読める幅: 一覧の列が狭いと時刻・ハッシュに
 * 場所を取られて件名が数文字で切れる。
 */
export const HISTORY_WIDTH: PanelSize = { default: 440, min: 220, max: 800 };

/** 画面下のパネル (Terminal / Tools / Search) の高さ。 */
export const APP_PANEL_HEIGHT: PanelSize = {
  default: 210,
  min: 160,
  max: 1400,
};

export function clampPanelSize(size: PanelSize, value: number): number {
  return Math.max(size.min, Math.min(size.max, value));
}
