import type { AppRoute } from "./routes";

export function shouldAutoLoadForRoute(
  route: AppRoute,
  options: { historyWorktreeSelected?: boolean } = {},
): boolean {
  if (route.screen === "history")
    return options.historyWorktreeSelected === true;
  if (
    route.screen === "database" ||
    route.screen === "journal" ||
    route.screen === "help" ||
    route.screen === "unknown"
  )
    return false;
  return true;
}

export function shouldCatchUpDiff(
  route: AppRoute,
  options: { historyWorktreeSelected?: boolean } = {},
): boolean {
  return (
    shouldAutoLoadForRoute(route, options) &&
    route.screen !== "repo" &&
    !(route.screen === "file" && route.view === "blob")
  );
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
