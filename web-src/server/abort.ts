export type LinkedAbortController = {
  signal: AbortSignal;
  abort(reason?: unknown): void;
  clearTimeout(): void;
  didTimeout(): boolean;
  cleanup(): void;
};

/** Parent cancellation and an optional timeout feeding one owned signal. */
export function createLinkedAbortController(
  parent?: AbortSignal,
  timeoutMs?: number,
): LinkedAbortController {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parent?.reason);
  let timedOut = false;
  if (parent?.aborted) {
    abortFromParent();
  } else {
    parent?.addEventListener("abort", abortFromParent, { once: true });
  }
  let timer =
    timeoutMs === undefined
      ? null
      : setTimeout(() => {
          timedOut = true;
          controller.abort(
            new Error(`operation timed out after ${timeoutMs}ms`),
          );
        }, timeoutMs);
  timer?.unref?.();
  const clearLinkedTimeout = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };
  return {
    signal: controller.signal,
    abort: (reason) => controller.abort(reason),
    clearTimeout: clearLinkedTimeout,
    didTimeout: () => timedOut,
    cleanup() {
      clearLinkedTimeout();
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
}
