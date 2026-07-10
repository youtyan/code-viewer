export function abortError(message = "operation aborted"): Error {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

export function throwIfAborted(
  signal?: AbortSignal,
  message = "operation aborted",
): void {
  if (signal?.aborted) throw abortError(message);
}

export function waitForAbortableResource<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  dispose: (resource: T) => void,
  message = "operation aborted",
): Promise<T> {
  const disposeSafely = (resource: T) => {
    try {
      dispose(resource);
    } catch {
      // Abort cleanup is best-effort; the abort error remains authoritative.
    }
  };
  if (!signal) return promise;
  if (signal.aborted) {
    void promise.then(disposeSafely, () => undefined);
    return Promise.reject(abortError(message));
  }
  return new Promise<T>((resolve, reject) => {
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      signal.removeEventListener("abort", onAbort);
      reject(abortError(message));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (resource) => {
        signal.removeEventListener("abort", onAbort);
        if (aborted) {
          disposeSafely(resource);
          return;
        }
        resolve(resource);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        if (!aborted) reject(error);
      },
    );
  });
}

export function isAbortLikeError(
  err: unknown,
  signal?: AbortSignal,
  extraTokens: string[] = [],
): boolean {
  if (signal?.aborted) return true;
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return true;
  const message = err.message.toLowerCase();
  return extraTokens.some((token) => message.includes(token.toLowerCase()));
}
