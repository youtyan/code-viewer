import { describe, expect, test } from "bun:test";
import { startDevAssetReload, type WatchFn } from "../server/dev-assets";

describe("dev asset reload", () => {
  test("does not watch assets outside dev mode", () => {
    let watched = false;
    const started = startDevAssetReload({
      enabled: false,
      webRoot: "/repo/web",
      watchedFiles: ["app.js"],
      watch: (() => {
        watched = true;
      }) as WatchFn,
      sendReload: () => {
        throw new Error("reload should not run");
      },
    });

    expect(started).toBe(false);
    expect(watched).toBe(false);
  });

  test("debounces reload events for watched asset changes", () => {
    let listener: Parameters<WatchFn>[2] | null = null;
    let reloads = 0;
    let scheduled: (() => void) | null = null;
    let cleared = 0;

    const started = startDevAssetReload({
      enabled: true,
      webRoot: "/repo/web",
      watchedFiles: ["index.html", "style.css", "app.js"],
      watch: ((_path, _options, next) => {
        listener = next;
      }) as WatchFn,
      sendReload: () => {
        reloads++;
      },
      setTimeoutFn: ((callback: () => void) => {
        scheduled = callback;
        return 1;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => {
        cleared++;
      }) as typeof clearTimeout,
    });

    expect(started).toBe(true);
    listener?.("change", "README.md");
    expect(scheduled).toBeNull();
    listener?.("change", "app.js");
    listener?.("change", "style.css");
    expect(cleared).toBe(1);
    scheduled?.();
    expect(reloads).toBe(1);
  });
});
