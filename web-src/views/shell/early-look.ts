// 骨格の見た目 (テーマ・左のサイドバーの畳み・幅) と画面の並びの寸法を、
// 最初の描画より先に当てるための控え。
//
// 本物の値は全プロジェクト共通の設定 (/_state/settings) にあり、app.js が
// 取りに行くまで分からない。その間に既定の見た目で描くと、ライトの人や
// サイドバーを畳んだ人には白い画面や崩れた骨格が一瞬見える。そこで、前回
// 当てた値をこのオリジンの localStorage に控え、web/index.html の head の
// 小さなスクリプトが読んで html に付ける (キーと形はそのスクリプトと揃える)。
// 画面の並び (一覧の列・右の列・最下段の文言) は body の頭の早いスクリプト
// (#first-screen) が読む。
//
// 控えはあくまで初回描画用。設定が読めたら app.ts がそちらで当て直す。
// 入口のサーバの下ではプロジェクトを移ってもオリジンは同じなので、2 回目から
// は常に控えがある。控えが無いのは、そのオリジンで初めて開いたときと、
// 1 つで完結するサーバ (`--standalone`) を新しいポートで開いたときだけ
// (そこでは既定のダーク・開いたサイドバーで描き始める)。

export const EARLY_LOOK_STORAGE_KEY = "code-viewer:early-look";

export type EarlyLook = {
  theme: "light" | "dark";
  /** 既定の紫なら無し。 */
  palette?: string;
  navCollapsed: boolean;
  navWidth: number;
  /*
   * ここから下は body の頭の早いスクリプト (#first-screen) が読む。最初の描画で
   * 画面の並び (一覧の列の幅・右の列を畳むか・最下段の文言の幅) の場所を取る。
   */
  /** 画面の言語 (最下段の接続状態の文言の幅)。 */
  language?: "en" | "ja";
  /** 利用者が右の列を畳んでいる。 */
  sidebarHidden?: boolean;
  /** 変更ファイルの木 (#sidebar) の幅。 */
  sidebarWidth?: number;
  /** 一覧の列の利用者の幅。 */
  historyWidth?: number;
};

let current: EarlyLook | null = null;

export function rememberEarlyLook(patch: Partial<EarlyLook>): void {
  current = {
    theme: "dark",
    navCollapsed: false,
    navWidth: 0,
    ...current,
    ...patch,
  };
  try {
    window.localStorage.setItem(
      EARLY_LOOK_STORAGE_KEY,
      JSON.stringify(current),
    );
  } catch (error) {
    // 控えが書けない (localStorage が使えない文脈) ときは、初回描画が既定の
    // 見た目になるだけで、画面そのものは設定から正しく当たる。失敗は残す。
    console.warn("[code-viewer] could not remember the early look", error);
  }
}
