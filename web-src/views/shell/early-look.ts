// 骨格の見た目 (テーマ・左のサイドバーの畳み・幅) を、CSS より先に当てる
// ための控え。
//
// 本物の値は全プロジェクト共通の設定 (/_state/settings) にあり、app.js が
// 取りに行くまで分からない。その間に既定の見た目で描くと、ライトの人や
// サイドバーを畳んだ人には白い画面や崩れた骨格が一瞬見える。そこで、前回
// 当てた値をこのオリジンの localStorage に控え、web/index.html の head の
// 小さなスクリプトが読んで html に付ける (キーと形はそのスクリプトと揃える)。
//
// 控えはあくまで初回描画用。設定が読めたら app.ts がそちらで当て直す。
// 初めて開くオリジン (起こしたばかりのプロジェクトのサーバ) には控えが無い
// ので、そこだけは既定 (ダーク・開いたサイドバー) で描き始める。

export const EARLY_LOOK_STORAGE_KEY = "code-viewer:early-look";

export type EarlyLook = {
  theme: "light" | "dark";
  /** 既定の紫なら無し。 */
  palette?: string;
  navCollapsed: boolean;
  navWidth: number;
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
