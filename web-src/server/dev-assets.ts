import { basename } from 'node:path';

export type WatchFn = (
  path: string,
  options: { persistent?: boolean },
  listener: (eventType: string, filename: string | Buffer | null) => void,
) => unknown;

type DevAssetReloadOptions = {
  enabled: boolean;
  webRoot: string;
  watchedFiles: readonly string[];
  watch: WatchFn;
  sendReload: () => void;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  debounceMs?: number;
};

export function startDevAssetReload(options: DevAssetReloadOptions): boolean {
  if (!options.enabled) return false;
  const watched = new Set(options.watchedFiles);
  const setTimer = options.setTimeoutFn || setTimeout;
  const clearTimer = options.clearTimeoutFn || clearTimeout;
  const debounceMs = options.debounceMs ?? 150;
  let timer: ReturnType<typeof setTimeout> | null = null;

  options.watch(options.webRoot, { persistent: false }, (_event, filename) => {
    if (!filename || !watched.has(basename(filename.toString()))) return;
    if (timer) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      options.sendReload();
    }, debounceMs);
  });
  return true;
}
