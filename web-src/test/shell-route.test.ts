// /_shell/* の入口が、PTY を触る前に弾くべきものを弾いているかを見る。
// 実際にシェルを起動するケースは環境依存になるので、ここでは扱わない
// (プロセスの生成と入出力は手動のエンドツーエンド検証でカバーしている)。

import { describe, expect, test, vi } from "vitest";
import * as shellSession from "../server/shell/session";
import { handleShellRoute } from "../server/shell/handle";
import { callRoute, postRoute } from "./_test-helpers";

const DENY_SIDE_EFFECTS = () => false;

const call = (
  path: string,
  init?: RequestInit,
  sideEffectAllowed?: (req: Request) => boolean,
) => callRoute(handleShellRoute, path, init, sideEffectAllowed);

const post = (
  path: string,
  body: unknown,
  sideEffectAllowed?: (req: Request) => boolean,
) => postRoute(handleShellRoute, path, body, sideEffectAllowed);

describe("shell route dispatch", () => {
  test("passes an unknown path through to the next handler", async () => {
    expect(await call("/_shell/nope")).toBeNull();
  });

  test.each([
    { name: "rejects POST on the list", path: "/_shell/list" },
    { name: "rejects POST on the stream", path: "/_shell/stream" },
  ])("$name", async ({ path }) => {
    const res = await call(path, { method: "POST" });
    expect(res?.status).toBe(405);
  });

  test.each([
    { name: "rejects GET on create", path: "/_shell/create" },
    { name: "rejects GET on keys", path: "/_shell/keys" },
    { name: "rejects GET on resize", path: "/_shell/resize" },
    { name: "rejects GET on close", path: "/_shell/close" },
  ])("$name", async ({ path }) => {
    const res = await call(path);
    expect(res?.status).toBe(405);
  });
});

describe("shell stream id validation", () => {
  // 有効な id を渡すと購読が始まってしまうので、弾かれる値だけを見る。
  test.each([
    { name: "rejects a missing id", query: "" },
    { name: "rejects an empty id", query: "?id=" },
    { name: "rejects a tmux pane id", query: "?id=%2512" },
    { name: "rejects a bare suffix", query: "?id=abc123" },
    { name: "rejects a shell metacharacter", query: "?id=shell-abc;id" },
    { name: "rejects a path traversal attempt", query: "?id=shell-../etc" },
  ])("$name", async ({ query }) => {
    const res = await call(`/_shell/stream${query}`);
    expect(res?.status).toBe(400);
  });
});

describe("shell side-effect guards", () => {
  test.each([
    { name: "create", path: "/_shell/create", body: {} },
    {
      name: "keys",
      path: "/_shell/keys",
      body: { id: "shell-abc123", data: "x" },
    },
    {
      name: "resize",
      path: "/_shell/resize",
      body: { id: "shell-abc123", cols: 80, rows: 24 },
    },
    { name: "close", path: "/_shell/close", body: { id: "shell-abc123" } },
  ])("refuses $name when not marked as a user action", async ({
    path,
    body,
  }) => {
    const res = await post(path, body, DENY_SIDE_EFFECTS);
    expect(res?.status).toBe(403);
  });

  test("refuses a body that is not JSON", async () => {
    const res = await post("/_shell/keys", "not json");
    expect(res?.status).toBe(400);
  });
});

describe("shell input validation", () => {
  test.each([
    { name: "refuses a missing id", body: { data: "x" } },
    { name: "refuses a tmux pane id", body: { id: "%12", data: "x" } },
    { name: "refuses a numeric id", body: { id: 1, data: "x" } },
    { name: "refuses missing data", body: { id: "shell-abc123" } },
    { name: "refuses non-string data", body: { id: "shell-abc123", data: 1 } },
  ])("$name", async ({ body }) => {
    const res = await post("/_shell/keys", body);
    expect(res?.status).toBe(400);
  });

  test("refuses input beyond the size limit", async () => {
    const res = await post("/_shell/keys", {
      id: "shell-abc123",
      data: "x".repeat(100_001),
    });
    expect(res?.status).toBe(413);
  });

  test.each([
    { name: "refuses a missing size", body: { id: "shell-abc123" } },
    {
      name: "refuses a non-numeric size",
      body: { id: "shell-abc123", cols: "80", rows: "24" },
    },
  ])("$name", async ({ body }) => {
    const res = await post("/_shell/resize", body);
    expect(res?.status).toBe(400);
  });

  // 存在しないシェルへの操作は 410。閉じた直後の取り違えをここで止める。
  test.each([
    {
      name: "keys against a missing shell",
      path: "/_shell/keys",
      body: { id: "shell-missing1", data: "x" },
    },
    {
      name: "resize against a missing shell",
      path: "/_shell/resize",
      body: { id: "shell-missing1", cols: 80, rows: 24 },
    },
  ])("$name", async ({ path, body }) => {
    const res = await post(path, body);
    expect(res?.status).toBe(410);
  });

  test("closing a missing shell reports that nothing was closed", async () => {
    const res = await post("/_shell/close", { id: "shell-missing1" });
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ closed: false });
  });

  test("returns the complete shell close failure", async () => {
    const closeError = Object.assign(new Error("close failed"), {
      cause: new Error("kill failed"),
    });
    const close = vi
      .spyOn(shellSession, "closeShellSession")
      .mockResolvedValue({ status: "error", error: closeError });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const res = await post("/_shell/close", { id: "shell-sample1" });

      expect(res?.status).toBe(500);
      expect(await res?.text()).toBe(
        "Error: close failed\nCaused by: Error: kill failed",
      );
      expect(log).toHaveBeenCalledWith(
        "[code-viewer] shell close failed",
        closeError,
      );
    } finally {
      close.mockRestore();
      log.mockRestore();
    }
  });
});
