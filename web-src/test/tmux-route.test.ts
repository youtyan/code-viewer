// /_tmux/* の入口が、tmux を呼ぶ前に弾くべきものを弾いているかを見る。
// 実際に tmux を叩くケースは環境依存になるので、ここでは扱わない
// (ペイン一覧の中身は tmux-panes.test.ts、クライアント一覧は
// tmux-clients.test.ts でパーサ単体を検証している)。
//
// ドロワーは tmux の画面を自分で描かないので、ここに在るのは 3 つだけ。
// 一覧 2 つ (panes / clients) と、ペインを開く 1 つ (open)。画面の購読も
// キー送信も /_shell/* が持つ。

import { describe, expect, test } from "vitest";
import { handleTmuxRoute } from "../server/tmux/handle";
import { callRoute, postRoute } from "./_test-helpers";

const DENY_SIDE_EFFECTS = () => false;

const call = (
  path: string,
  init?: RequestInit,
  sideEffectAllowed?: (req: Request) => boolean,
) => callRoute(handleTmuxRoute, path, init, sideEffectAllowed);

const postOpen = (
  body: unknown,
  sideEffectAllowed?: (req: Request) => boolean,
) => postRoute(handleTmuxRoute, "/_tmux/open", body, sideEffectAllowed);

describe("tmux route dispatch", () => {
  test("passes an unknown path through to the next handler", async () => {
    expect(await call("/_tmux/nope")).toBeNull();
  });

  test.each([
    { name: "rejects POST on the pane list", path: "/_tmux/panes" },
    { name: "rejects POST on the client list", path: "/_tmux/clients" },
  ])("$name", async ({ path }) => {
    const res = await call(path, { method: "POST" });
    expect(res?.status).toBe(405);
  });

  test("rejects GET on the open endpoint", async () => {
    const res = await call("/_tmux/open");
    expect(res?.status).toBe(405);
  });
});

describe("tmux open guards", () => {
  // ペインを開くと tmux を叩き、シェルまで起こしうる。ここでは弾かれる値だけ
  // を見る (有効な値を渡すと環境に手が入ってしまう)。
  test("refuses a request that is not marked as a user action", async () => {
    const res = await postOpen({ pane: "%1" }, DENY_SIDE_EFFECTS);
    expect(res?.status).toBe(403);
  });

  test("refuses a body that is not JSON", async () => {
    const res = await postOpen("not json");
    expect(res?.status).toBe(400);
  });

  test.each([
    { name: "refuses a missing pane", body: {} },
    { name: "refuses an empty pane", body: { pane: "" } },
    { name: "refuses a pane without the prefix", body: { pane: "1" } },
    { name: "refuses a session target", body: { pane: "alpha:0.1" } },
    // ペイン ID はそのまま tmux の引数になる。記号が混ざるものは通さない。
    {
      name: "refuses a shell metacharacter in the pane",
      body: { pane: "%1;id" },
    },
    { name: "refuses a path traversal attempt", body: { pane: "../etc" } },
    { name: "refuses a numeric pane", body: { pane: 1 } },
  ])("$name", async ({ body }) => {
    const res = await postOpen(body);
    expect(res?.status).toBe(400);
  });
});
