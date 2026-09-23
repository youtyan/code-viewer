// 骨格の見た目 (テーマ・左のサイドバーの畳み・幅) と画面の並びの寸法を、
// 最初の描画より先に当てるための控え。
//
// 本物の値は全プロジェクト共通の設定 (/_state/settings) にあり、app.js が
// 取りに行くまで分からない。その間に既定の見た目で描くと、ライトの人や
// サイドバーを畳んだ人には白い画面や崩れた骨格が一瞬見える。そこで、前回
// 当てた値をこのオリジンの localStorage に控え、web/index.html の head の
// 小さなスクリプトが読んで html に付ける (キーと形はそのスクリプトと揃える)。
// 画面の並び (一覧の列・最下段の文言) は body の頭の早いスクリプト
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
   * 画面の並び (一覧の列の幅・ファイル一覧を畳むか・最下段の文言の幅) の場所を取る。
   */
  /** 画面の言語 (最下段の接続状態の文言の幅)。 */
  language?: "en" | "ja";
  /** 利用者がファイル一覧を畳んでいる。 */
  sidebarHidden?: boolean;
  /** ファイル一覧 (と History・作業ツリーの変更ファイルの一覧) の幅。 */
  sidebarWidth?: number;
  /** 一覧の列の利用者の幅。 */
  historyWidth?: number;
};

let current: EarlyLook | null = null;

/**
 * 控えを読む (起動の途中で、早いスクリプトが付けた印が利用者の畳みか幅による
 * 畳みかを見分ける)。控えが無ければ look は null。localStorage が使えない文脈
 * では ok: false と理由を返す (読む側が、控えが無いときの扱いに落として理由を
 * 残す。core/stored-size.ts と同じ形)。
 */
export function readEarlyLook():
  | { ok: true; look: Partial<EarlyLook> | null }
  | { ok: false; error: unknown } {
  try {
    const raw = window.localStorage.getItem(EARLY_LOOK_STORAGE_KEY);
    return {
      ok: true,
      look: raw ? (JSON.parse(raw) as Partial<EarlyLook>) : null,
    };
  } catch (error) {
    return { ok: false, error };
  }
}

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
