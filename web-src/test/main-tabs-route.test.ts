// /_state/tabs の入口 (server/state-route.ts)。本体を更新した直後は、前の版の
// JS を読み込んだままのタブが残る。その画面は版の番号 (baseRev) も base も付けずに、
// プロジェクトごとの配置と共通のタブを PUT してくる。それで全プロジェクト共通の
// 保存を上書きで消さない (400 で断り、ファイルはそのまま)。
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { LAYOUT_VERSION } from "../core/main-tabs";
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

const saved = JSON.stringify({
  version: 2,
  rev: 3,
  savedAt: 1,
  layout: {
    version: LAYOUT_VERSION,
    focused: "left",
    panes: [
      {
        side: "left",
        activeId: "a",
        tabs: [
          {
            id: "a",
            preview: false,
            target: { kind: "file", path: "a.ts", project: "/work/sample-app" },
          },
        ],
      },
    ],
  },
});

/** 前の版の画面が送る形 (プロジェクトの配置は版 4、共通のタブは別)。 */
const oldLayout = {
  version: 4,
  focused: "left",
  panes: [
    {
      side: "left",
      activeId: "t1",
      tabs: [
        { id: "t1", preview: false, target: { kind: "file", path: "old.ts" } },
      ],
    },
  ],
};

async function put(body: unknown) {
  const req = new Request("http://localhost/_state/tabs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await handleStateRoute(
    req,
    new URL(req.url),
    "/work/sample-lib",
    () => true,
  );
  if (!res) throw new Error("no response");
  return { status: res.status, text: await res.text() };
}

describe("PUT /_state/tabs from a page of the previous version", () => {
  test.each([
    { name: "配置だけ", body: { layout: oldLayout } },
    {
      name: "配置と共通のタブ",
      body: {
        layout: oldLayout,
        common: {
          version: 1,
          targets: [{ kind: "terminal", session: "shell-ab12" }],
        },
      },
    },
  ])("版の番号の無い PUT ($name) は断り、今の保存を消さない", async ({
    body,
  }) => {
    const path = join(dir, "main-tabs.json");
    writeFileSync(path, saved);
    const res = await put(body);
    expect([res.status, res.text, readFileSync(path, "utf8")]).toEqual([
      400,
      "main tabs body has a bad baseRev: undefined",
      saved,
    ]);
  });

  test("前の版の画面が読むと、新しい版の配置が返る (その画面は保存しない)", async () => {
    writeFileSync(join(dir, "main-tabs.json"), saved);
    const req = new Request("http://localhost/_state/tabs");
    const res = await handleStateRoute(
      req,
      new URL(req.url),
      "/work/sample-app",
      () => true,
    );
    const body = (await res?.json()) as { layout: { version: number } };
    // 前の版の画面は、自分より新しい版 (5 > 4) の配置を「使わず、書かない」。
    expect([body.layout.version > 4, "common" in body]).toEqual([true, false]);
  });
});
