export type NetworkActivityState = {
  inFlight: number;
  cancellable: number;
};

type FetchTarget = {
  fetch: typeof fetch;
};

type NetworkActivityOptions = {
  onChange?: (state: NetworkActivityState) => void;
  /**
   * すべての fetch (裏の取り直しも) の前に URL と見出しを整える。入口の
   * サーバの下で、前置きとプロジェクトの鍵を足す (core/api-url.ts の
   * projectRequest)。
   */
  prepareRequest?: (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
  ) => { input: RequestInfo | URL; init?: RequestInit };
  /** すべての fetch の応答を見る (本文は読まない。読むなら clone する)。 */
  onResponse?: (response: Response) => void;
};

/**
 * 裏で定期的に取り直すだけのリクエストに付ける印 (値は "1")。
 *
 * これが付いた fetch は、通信中の表示 (#load-bar・取消ボタン) に数えず、
 * 取消 (cancelAll) の対象にもしない。数秒おきの取り直しを数えると、どの画面
 * にいても表示が点滅し続け、利用者が押した取消で関係の無い取り直しまで止まる。
 * 付けてよいのは、失敗しても次の周期で取り直せる読み取りだけ。
 */
export const BACKGROUND_REQUEST_HEADER = "X-Code-Viewer-Background";

/**
 * 途中で止めてはいけない書き込みに付ける印 (値は "1")。ターミナルの打鍵と
 * 寸法の送信のように、利用者の操作そのものを運ぶ要求。
 *
 * 画面を切り替えたときの取消 (cancelAll) で打鍵が捨てられると、打った文字が
 * 黙って消える。これが付いた fetch は取消の対象にも通信中の表示にも数えない
 * (打鍵のたびに表示が点滅しないように)。BACKGROUND_REQUEST_HEADER と違って
 * 書き込みに付けてよいが、利用者の操作で始まる読み取りには付けない。
 */
export const UNINTERRUPTIBLE_REQUEST_HEADER = "X-Code-Viewer-Uninterruptible";

function isBackgroundRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): boolean {
  const fromInit = new Headers(init?.headers);
  const marked = (headers: Headers) =>
    headers.get(BACKGROUND_REQUEST_HEADER) === "1" ||
    headers.get(UNINTERRUPTIBLE_REQUEST_HEADER) === "1";
  if (marked(fromInit)) return true;
  return (
    typeof Request !== "undefined" &&
    input instanceof Request &&
    marked(input.headers)
  );
}

function abortReason(message: string): Error | DOMException {
  return typeof DOMException === "function"
    ? new DOMException(message, "AbortError")
    : new Error(message);
}

function signalReason(signal: AbortSignal): unknown {
  return "reason" in signal ? signal.reason : abortReason("aborted");
}

export function createNetworkActivityTracker(
  options: NetworkActivityOptions = {},
) {
  let inFlight = 0;
  let nextRequestId = 0;
  const cancellableRequests = new Map<number, AbortController>();

  const state = (): NetworkActivityState => ({
    inFlight,
    cancellable: cancellableRequests.size,
  });

  const notify = () => options.onChange?.(state());

  function begin() {
    inFlight++;
    notify();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      inFlight = Math.max(0, inFlight - 1);
      notify();
    };
  }

  function track<T>(promise: PromiseLike<T>): Promise<T> {
    const end = begin();
    return Promise.resolve(promise).finally(end);
  }

  function linkSignal(
    source: AbortSignal | null | undefined,
    target: AbortController,
    cleanup: Array<() => void>,
  ) {
    if (!source) return;
    if (source.aborted) {
      target.abort(signalReason(source));
      return;
    }
    const onAbort = () => target.abort(signalReason(source));
    source.addEventListener("abort", onAbort, { once: true });
    cleanup.push(() => source.removeEventListener("abort", onAbort));
  }

  function requestSignalFromInput(
    input: RequestInfo | URL,
  ): AbortSignal | null {
    return typeof Request !== "undefined" && input instanceof Request
      ? input.signal
      : null;
  }

  function makeTrackedFetch(baseFetch: typeof fetch): typeof fetch {
    const originalFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const prepared = options.prepareRequest
        ? options.prepareRequest(input, init)
        : { input, init };
      const pending = baseFetch(prepared.input, prepared.init);
      const inspect = options.onResponse;
      if (!inspect) return pending;
      return Promise.resolve(pending).then((response) => {
        inspect(response);
        return response;
      });
    }) as typeof fetch;
    return ((input: RequestInfo | URL, init?: RequestInit) => {
      if (isBackgroundRequest(input, init)) return originalFetch(input, init);
      const end = begin();
      const requestId = ++nextRequestId;
      const requestController = new AbortController();
      const cleanup: Array<() => void> = [];

      cancellableRequests.set(requestId, requestController);
      linkSignal(requestSignalFromInput(input), requestController, cleanup);
      linkSignal(init?.signal, requestController, cleanup);
      notify();

      const finish = () => {
        cancellableRequests.delete(requestId);
        for (const fn of cleanup) fn();
        end();
      };

      try {
        const trackedInit: RequestInit = {
          ...(init ?? {}),
          signal: requestController.signal,
        };
        return Promise.resolve(originalFetch(input, trackedInit)).finally(
          finish,
        );
      } catch (err) {
        finish();
        throw err;
      }
    }) as typeof fetch;
  }

  function installFetch(target: FetchTarget = globalThis): () => void {
    const originalFetch = target.fetch;
    const trackedFetch = makeTrackedFetch(originalFetch.bind(target));
    target.fetch = trackedFetch;
    return () => {
      if (target.fetch === trackedFetch) target.fetch = originalFetch;
    };
  }

  function cancelAll(message = "cancelled by user"): number {
    const reason = abortReason(message);
    let count = 0;
    for (const controller of cancellableRequests.values()) {
      if (controller.signal.aborted) continue;
      controller.abort(reason);
      count++;
    }
    return count;
  }

  return {
    getState: state,
    track,
    installFetch,
    cancelAll,
  };
}
