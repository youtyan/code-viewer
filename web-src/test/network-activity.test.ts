import { describe, expect, test } from "vitest";
import {
  BACKGROUND_REQUEST_HEADER,
  createNetworkActivityTracker,
} from "../core/network-activity";
import { deferred } from "./_test-helpers";

describe("network activity tracker", () => {
  test("tracks raw fetch calls without explicit wrappers", async () => {
    const pending = deferred<Response>();
    const target = {
      fetch: (() => pending.promise) as unknown as typeof fetch,
    };
    const tracker = createNetworkActivityTracker();
    tracker.installFetch(target);

    const request = target.fetch("/slow");

    expect(tracker.getState()).toEqual({ inFlight: 1, cancellable: 1 });
    pending.resolve(new Response("ok"));
    await request;
    expect(tracker.getState()).toEqual({ inFlight: 0, cancellable: 0 });
  });

  test("background requests are neither counted nor cancelled", async () => {
    const pending = deferred<Response>();
    let requestSignal: AbortSignal | undefined | null;
    const target = {
      fetch: ((_input, init) => {
        requestSignal = init?.signal;
        return pending.promise;
      }) as unknown as typeof fetch,
    };
    const tracker = createNetworkActivityTracker();
    tracker.installFetch(target);

    const request = target.fetch("/poll", {
      headers: { [BACKGROUND_REQUEST_HEADER]: "1" },
    });

    expect(tracker.getState()).toEqual({ inFlight: 0, cancellable: 0 });
    expect(tracker.cancelAll()).toBe(0);
    expect(requestSignal).toBeUndefined();
    pending.resolve(new Response("ok"));
    expect(await (await request).text()).toBe("ok");
  });

  test("cancels active fetch calls", async () => {
    let requestSignal: AbortSignal | undefined;
    const target = {
      fetch: ((_input, init) => {
        requestSignal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          requestSignal?.addEventListener("abort", () => {
            reject(requestSignal?.reason);
          });
        });
      }) as unknown as typeof fetch,
    };
    const tracker = createNetworkActivityTracker();
    tracker.installFetch(target);

    const request = target.fetch("/slow").catch((err) => err);

    expect(tracker.cancelAll()).toBe(1);
    const err = await request;
    expect(err.name).toBe("AbortError");
    expect(tracker.getState()).toEqual({ inFlight: 0, cancellable: 0 });
  });

  test("preserves caller abort signals", async () => {
    const caller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const target = {
      fetch: ((_input, init) => {
        requestSignal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          requestSignal?.addEventListener("abort", () => {
            reject(requestSignal?.reason);
          });
        });
      }) as unknown as typeof fetch,
    };
    const tracker = createNetworkActivityTracker();
    tracker.installFetch(target);

    const request = target
      .fetch("/slow", { signal: caller.signal })
      .catch((err) => err);

    caller.abort(new DOMException("caller abort", "AbortError"));
    const err = await request;
    expect(err.name).toBe("AbortError");
    expect(tracker.getState()).toEqual({ inFlight: 0, cancellable: 0 });
  });

  test("tracks non-fetch async work through the compatibility API", async () => {
    const pending = deferred<string>();
    const tracker = createNetworkActivityTracker();
    const tracked = tracker.track(pending.promise);

    expect(tracker.getState()).toEqual({ inFlight: 1, cancellable: 0 });
    pending.resolve("done");
    expect(await tracked).toBe("done");
    expect(tracker.getState()).toEqual({ inFlight: 0, cancellable: 0 });
  });
});
