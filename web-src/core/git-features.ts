// git のリポジトリでないプロジェクト (git の外のフォルダを登録したもの) で、使えない
// 画面と操作を決める。DOM に触らない。どの入口 (画面の入口の列・タブの ＋・
// グループの ▾・キー・パレット・URL) も、この 1 か所の答えで押せなくする。

import type { AppRoute } from "./routes";
import type { GitRepositoryState } from "./types";

/**
 * git の機能を使えなくするか。"outside" (git の外と分かっている) だけ。
 * "unknown" (git が無い・所有権のエラーなど) は今までどおり git を呼び、その
 * 失敗を画面に出す (git の外と決めつけて隠さない)。
 */
export function gitFeaturesUnavailable(state: GitRepositoryState): boolean {
  return state === "outside";
}

/** git が無いと開けない画面 (ページのタブ・画面の入口)。 */
export const GIT_ONLY_PAGES = ["diff", "history", "worktree"] as const;

export function pageNeedsGit(page: string): boolean {
  return (GIT_ONLY_PAGES as readonly string[]).includes(page);
}

/** git が要る画面へ移るキーの操作 (core/keymap.ts)。パレットの行も同じ操作を使う。 */
export const GIT_SCREEN_ACTIONS = [
  "goto-diff",
  "goto-history",
  "goto-worktrees",
] as const;

export function actionNeedsGit(action: string): boolean {
  return (GIT_SCREEN_ACTIONS as readonly string[]).includes(action);
}

/**
 * その route を出すのに git が要るか。差分・履歴・作業ツリーの画面、ファイルの
 * blame と履歴、作業ツリー (worktree) 以外の ref のファイル一覧とファイル。
 */
export function routeNeedsGit(route: AppRoute): boolean {
  if (pageNeedsGit(route.screen)) return true;
  if (route.screen === "repo") return refNeedsGit(route.ref);
  if (route.screen === "file")
    return (
      route.view === "blame" ||
      route.view === "history" ||
      refNeedsGit(route.ref)
    );
  return false;
}

function refNeedsGit(ref: string): boolean {
  return !!ref && ref !== "worktree";
}
