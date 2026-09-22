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
    route.screen === "unknown"
  )
    return false;
  return true;
}

/**
 * 見えていなかった間 (SSE が切れていた・タブが背面だった) の変更の取り直し方。
 * その間の変更は通知が来ないので、戻ったときに必ず取り直す。
 * - "diff": 差分を読み直す (`load({ force: true })`)
 * - "files": Files の木と blob は差分を持たないので、変わったパスが不明な
 *   SSE の更新と同じ道 (`scheduleSseLoad(null)`) で取り直す
 * - null: 自動で読み直さない画面
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

export function createCatchUpGate(now: () => number, minIntervalMs: number) {
  let lastForceAt = 0;
  return function shouldRun(): boolean {
    const current = now();
    if (current - lastForceAt < minIntervalMs) return false;
    lastForceAt = current;
    return true;
  };
}
