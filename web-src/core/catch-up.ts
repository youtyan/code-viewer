import type { AppRoute } from "./routes";

export function shouldAutoLoadForRoute(
  route: AppRoute,
  options: { historyWorktreeSelected?: boolean } = {},
): boolean {
  if (route.screen === "history")
    return options.historyWorktreeSelected === true;
  if (route.screen === "diff")
    return (
      !route.range.from ||
      route.range.from === "worktree" ||
      !route.range.to ||
      route.range.to === "worktree"
    );
  if (
    route.screen === "database" ||
    route.screen === "journal" ||
    route.screen === "help" ||
    route.screen === "settings" ||
    route.screen === "unknown"
  )
    return false;
  return true;
}

/**
 * ファイルの変更の通知 (SSE の update をまとめた後) で読み直すもの。
 * - fileList: ファイル一覧はどの画面にも出ているので、本文の画面と関係なく
 *   自動更新の設定だけで決める (フォルダ表示のときだけ合わせていた間は、
 *   ファイルを開いている間に増えたファイルが一覧に出なかった)
 * - body: 本文を読み直す ("load")・帯で知らせる ("banner")・触らない (null)。
 *   ファイルを開いているときは、見ているファイルが変わったときだけ
 */
export function sseUpdatePlan(
  route: AppRoute,
  options: {
    autoUpdate: boolean;
    historyWorktreeSelected?: boolean;
    /** ファイルを開いていて、通知のパスがそのファイルに届かない。 */
    viewedFileUnchanged: boolean;
  },
): { fileList: boolean; body: "load" | "banner" | null } {
  const fileList = options.autoUpdate;
  if (options.viewedFileUnchanged || !shouldAutoLoadForRoute(route, options))
    return { fileList, body: null };
  return { fileList, body: options.autoUpdate ? "load" : "banner" };
}

/**
 * 見えていなかった間 (SSE が切れていた・タブが背面だった) の変更の取り直し方。
 * その間の変更は通知が来ないので、戻ったときに必ず取り直す。
 * - "diff": 差分を読み直す (`load({ force: true })`)
 * - "files": Files の木と blob は差分を持たないので、変わったパスが不明な
 *   SSE の更新と同じ道 (`scheduleSseLoad(null)`) で取り直す
 * - null: 本文を自動で読み直さない画面 (ファイル一覧は同じく `scheduleSseLoad(null)`)
 */
export function catchUpKind(
  route: AppRoute,
  options: { historyWorktreeSelected?: boolean } = {},
): "diff" | "files" | null {
  if (!shouldAutoLoadForRoute(route, options)) return null;
  if (
    route.screen === "repo" ||
    (route.screen === "file" && route.view === "blob")
  )
    return "files";
  return "diff";
}

/**
 * 取り直しのきっかけ。
 * - "reconnect": SSE を繋ぎ直した (入口を起こし直した直後を含む)。切れていた
 *   間の変更は通知が来ないので、**間引きを通さない**。間引くと、起こし直した
 *   直後の取り直しだけが落ちて古い表示が残る
 * - "visible": タブが前面に戻った・窓がフォーカスされた。短い間に続けて起きる
 *   ので間引く
 */
export type CatchUpReason = "reconnect" | "visible";

export function createCatchUpGate(now: () => number, minIntervalMs: number) {
  let lastRunAt = 0;
  return function shouldRun(reason: CatchUpReason): boolean {
    const current = now();
    if (reason !== "reconnect" && current - lastRunAt < minIntervalMs) {
      return false;
    }
    lastRunAt = current;
    return true;
  };
}
