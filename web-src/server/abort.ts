export type LinkedAbortController = {
  signal: AbortSignal;
  abort(): void;
  cleanup(): void;
};

/** Parent cancellation and an optional timeout feeding one owned signal. */
export function createLinkedAbortController(
  parent?: AbortSignal,
  timeoutMs?: number,
): LinkedAbortController {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parent?.reason);
  if (parent?.aborted) {
    abortFromParent();
  } else {
    parent?.addEventListener("abort", abortFromParent, { once: true });
  }
  const timer =
    timeoutMs === undefined
      ? null
      : setTimeout(
          () =>
            controller.abort(
              new Error(`operation timed out after ${timeoutMs}ms`),
            ),
          timeoutMs,
        );
  timer?.unref?.();
  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    cleanup() {
      if (timer) clearTimeout(timer);
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
}
