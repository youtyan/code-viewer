import { errorWithCauses } from "../core/error-detail";

export type SseClientOperation = "send" | "heartbeat" | "close";

function isExpectedSseDisconnect(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const item = current as {
      code?: unknown;
      name?: unknown;
      message?: unknown;
    };
    if (
      item.code === "EPIPE" ||
      item.code === "ECONNRESET" ||
      item.code === "ERR_STREAM_DESTROYED" ||
      item.name === "AbortError" ||
      (item.code === "ERR_INVALID_STATE" &&
        typeof item.message === "string" &&
        /closed|closing|cancelled/i.test(item.message))
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function applySseClientOperation<T>(
  clients: Iterable<T>,
  operation: SseClientOperation,
  remove: (client: T) => void,
  apply: (client: T) => void,
): void {
  const failures: unknown[] = [];
  for (const client of clients) {
    try {
      apply(client);
    } catch (error) {
      remove(client);
      const disconnected = isExpectedSseDisconnect(error);
      console.error(
        disconnected
          ? `[code-viewer] SSE client disconnected during ${operation}:`
          : `[code-viewer] SSE client ${operation} failed:`,
        error,
      );
      if (!disconnected) failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw errorWithCauses(`SSE client ${operation} failed`, failures);
  }
}
