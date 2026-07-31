// /_tmux/* の入口が、tmux を呼ぶ前に弾くべきものを弾いているかを見る。
// 実際に tmux を叩くケースは環境依存になるので、ここでは扱わない
// (ペイン一覧の中身は tmux-panes.test.ts でパーサ単体を検証している)。

import { describe, expect, test } from "bun:test";
import { handleTmuxRoute } from "../server/tmux/handle";

const ALLOW_SIDE_EFFECTS = () => true;
const DENY_SIDE_EFFECTS = () => false;

const ORIGIN = "http://127.0.0.1:0";

function call(
  path: string,
  init: RequestInit = {},
  sideEffectAllowed = ALLOW_SIDE_EFFECTS,
): Promise<Response | null> {
  const url = new URL(`${ORIGIN}${path}`);
  return handleTmuxRoute(
    new Request(url, init),
    url,
    process.cwd(),
    sideEffectAllowed,
  );
}

function postKeys(
  body: unknown,
  sideEffectAllowed = ALLOW_SIDE_EFFECTS,
): Promise<Response | null> {
  return call(
    "/_tmux/keys",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    sideEffectAllowed,
  );
}

describe("tmux route dispatch", () => {
  test("passes an unknown path through to the next handler", async () => {
    expect(await call("/_tmux/nope")).toBeNull();
  });

  test.each([
    { name: "rejects POST on the pane list", path: "/_tmux/panes" },
    { name: "rejects POST on the stream", path: "/_tmux/stream" },
  ])("$name", async ({ path }) => {
    const res = await call(path, { method: "POST" });
    expect(res?.status).toBe(405);
  });

  test("rejects GET on the key endpoint", async () => {
    const res = await call("/_tmux/keys");
    expect(res?.status).toBe(405);
  });
});

describe("tmux stream pane validation", () => {
  // 有効な id を渡すと購読が始まってしまうので、ここでは弾かれる値だけを見る。
  test.each([
    { name: "rejects a missing pane", query: "" },
    { name: "rejects an empty pane", query: "?pane=" },
    { name: "rejects a pane without the prefix", query: "?pane=12" },
    { name: "rejects a session target", query: "?pane=alpha:0.1" },
    { name: "rejects a shell metacharacter", query: "?pane=%251;id" },
    { name: "rejects a path traversal attempt", query: "?pane=../etc" },
  ])("$name", async ({ query }) => {
    const res = await call(`/_tmux/stream${query}`);
    expect(res?.status).toBe(400);
  });
});

describe("tmux key sending guards", () => {
  test("refuses a request that is not marked as a user action", async () => {
    const res = await postKeys({ pane: "%1", data: "x" }, DENY_SIDE_EFFECTS);
    expect(res?.status).toBe(403);
  });

  test("refuses a body that is not JSON", async () => {
    const res = await postKeys("not json");
    expect(res?.status).toBe(400);
  });

  test.each([
    { name: "refuses a missing pane", body: { data: "x" } },
    { name: "refuses an empty pane", body: { pane: "", data: "x" } },
    {
      name: "refuses a pane without the prefix",
      body: { pane: "1", data: "x" },
    },
    {
      name: "refuses a shell metacharacter in the pane",
      body: { pane: "%1;id", data: "x" },
    },
    { name: "refuses a numeric pane", body: { pane: 1, data: "x" } },
  ])("$name", async ({ body }) => {
    const res = await postKeys(body);
    expect(res?.status).toBe(400);
  });

  test.each([
    { name: "refuses missing data", body: { pane: "%1" } },
    { name: "refuses non-string data", body: { pane: "%1", data: 1 } },
    { name: "refuses object data", body: { pane: "%1", data: { a: 1 } } },
    { name: "refuses null data", body: { pane: "%1", data: null } },
  ])("$name", async ({ body }) => {
    const res = await postKeys(body);
    expect(res?.status).toBe(400);
  });

  test("refuses input beyond the size limit", async () => {
    const res = await postKeys({ pane: "%1", data: "x".repeat(100_001) });
    expect(res?.status).toBe(413);
  });
});
