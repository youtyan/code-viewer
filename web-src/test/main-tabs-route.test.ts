// 窓ごとの面の並びとタブの入口 (server/state-route.ts の /_state/workspace)。本体を
// 更新した直後は、前の版の JS を読み込んだままのタブが残る。その画面は前の入口
// (/_state/tabs) へ配置を PUT してくる。それで窓ごとの保存を上書きで消さない
// (入口が無いので受けず、ファイルはそのまま)。
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { singlePane } from "../core/workspace";
import { handleStateRoute } from "../server/state-route";

let dir = "";
let previous: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cv-tabs-route-"));
  previous = process.env.CODE_VIEWER_TEST_STATE_DIR;
  process.env.CODE_VIEWER_TEST_STATE_DIR = dir;
});

afterEach(() => {
  // 後始末では元の値に戻す (消すと利用者の状態ディレクトリへ戻る)。
  if (previous === undefined) delete process.env.CODE_VIEWER_TEST_STATE_DIR;
  else process.env.CODE_VIEWER_TEST_STATE_DIR = previous;
  rmSync(dir, { recursive: true, force: true });
});

const WORKSPACE = singlePane("p1", "/p/0123456789abcdef/");

async function call(path: string, init?: RequestInit) {
  const req = new Request(`http://localhost${path}`, init);
  const res = await handleStateRoute(
    req,
    new URL(req.url),
    "/work/sample-app",
    () => true,
  );
  return res ? { status: res.status, text: await res.text() } : null;
}

const put = (body: unknown) =>
  call("/_state/workspace", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("/_state/workspace", () => {
  test("書いた窓の並びを、その窓で読み戻す", async () => {
    const written = await put({ window: "w-a", workspace: WORKSPACE });
    const read = await call("/_state/workspace?window=w-a");
    expect([written, JSON.parse(read?.text ?? "null")]).toEqual([
      { status: 200, text: '{"rev":1}' },
      { root: "/work/sample-app", workspace: WORKSPACE },
    ]);
  });

  test.each([
    {
      name: "窓の無い読み込み",
      run: () => call("/_state/workspace"),
      expected: { status: 400, text: "workspace request has no window" },
    },
    {
      name: "窓の無い書き込み",
      run: () => put({ workspace: WORKSPACE }),
      expected: {
        status: 400,
        text: "workspace body has a bad window: undefined",
      },
    },
    {
      name: "並びの無い書き込み",
      run: () => put({ window: "w-a" }),
      expected: { status: 400, text: "workspace body has no workspace" },
    },
  ])("$name は断る", async ({ run, expected }) => {
    expect(await run()).toEqual(expected);
  });

  test("前の版の画面の PUT /_state/tabs は受けず、今の保存を消さない", async () => {
    await put({ window: "w-a", workspace: WORKSPACE });
    const path = join(dir, "main-tabs.json");
    const before = readFileSync(path, "utf8");
    const res = await call("/_state/tabs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout: { version: 4, panes: [] } }),
    });
    expect([res, readFileSync(path, "utf8")]).toEqual([null, before]);
  });

  test("前の版のファイル (版 2) は配置を返し、まだ書き直さない", async () => {
    const path = join(dir, "main-tabs.json");
    const old = JSON.stringify({
      version: 2,
      rev: 3,
      savedAt: 1,
      layout: { version: 5, focused: "left", panes: [] },
    });
    writeFileSync(path, old);
    const read = await call("/_state/workspace?window=w-a");
    expect([
      JSON.parse(read?.text ?? "null"),
      readFileSync(path, "utf8"),
    ]).toEqual([
      {
        root: "/work/sample-app",
        workspace: null,
        legacy: { version: 5, focused: "left", panes: [] },
      },
      old,
    ]);
  });
});
