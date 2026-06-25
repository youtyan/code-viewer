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
