import type { AppRoute } from './routes';

export function shouldCatchUpDiff(route: AppRoute): boolean {
  return route.screen !== 'repo' && !(route.screen === 'file' && route.view === 'blob');
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
