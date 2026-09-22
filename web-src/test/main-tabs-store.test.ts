import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  backupMainTabs,
  loadMainTabs,
  loadProjectMainTabs,
  MAX_MAIN_TABS_LAYOUT_BYTES,
  MAX_MAIN_TABS_PROJECTS,
  saveProjectMainTabs,
} from "../server/main-tabs-store";

let dir = "";
let path = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cv-main-tabs-"));
  path = join(dir, "main-tabs.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const layout = { version: 1, focused: "left", panes: [] };

describe("main tabs store", () => {
  test("保存が無ければ null", () => {
    expect(loadProjectMainTabs(path, "/work/sample-app")).toBe(null);
  });

  test("プロジェクトごとに分けて覚える", async () => {
    await saveProjectMainTabs(path, "/work/sample-app", layout, 1);
    await saveProjectMainTabs(path, "/work/sample-lib", { other: true }, 2);
    expect([
      loadProjectMainTabs(path, "/work/sample-app"),
      loadProjectMainTabs(path, "/work/sample-lib"),
      loadProjectMainTabs(path, "/work/sample-docs"),
      loadProjectMainTabs(path, "constructor"),
    ]).toEqual([layout, { other: true }, null, null]);
  });

  // 共通のタブ (プロジェクトに属さない) は同じファイルの common に 1 つ。
  test.each([
    {
      name: "保存したプロジェクトとは別のプロジェクトでも同じ common を読む",
      saves: [{ root: "/work/sample-app", common: { targets: ["a"] } }],
      root: "/work/sample-lib",
      expected: { layout: null, common: { targets: ["a"] } },
    },
    {
      name: "common を渡さない保存 (前の版の画面) は前の common を残す",
      saves: [
        { root: "/work/sample-app", common: { targets: ["a"] } },
        { root: "/work/sample-lib" },
      ],
      root: "/work/sample-lib",
      expected: { layout, common: { targets: ["a"] } },
    },
    {
      name: "後から保存した common が勝つ",
      saves: [
        { root: "/work/sample-app", common: { targets: ["a"] } },
        { root: "/work/sample-lib", common: { targets: ["b"] } },
      ],
      root: "/work/sample-app",
      expected: { layout, common: { targets: ["b"] } },
    },
    {
      name: "common が一度も無ければ null (この版を初めて使う)",
      saves: [{ root: "/work/sample-app" }],
      root: "/work/sample-app",
      expected: { layout, common: null },
    },
  ])("$name", async ({ saves, root, expected }) => {
    let now = 1;
    for (const save of saves)
      await saveProjectMainTabs(
        path,
        save.root,
        layout,
        now++,
        "common" in save ? save.common : undefined,
      );
    expect(loadMainTabs(path, root)).toEqual(expected);
  });

  test("common の形が違うファイルは読まず、上書きもしない", async () => {
    const text = JSON.stringify({
      version: 1,
      projects: {},
      common: { savedAt: 1 },
    });
    writeFileSync(path, text);
    expect(() => loadMainTabs(path, "/work/sample-app")).toThrow(
      "- common has no tabs",
    );
    await expect(
      saveProjectMainTabs(path, "/work/sample-app", layout, 2, { targets: [] }),
    ).rejects.toThrow("common has no tabs");
    expect(readFileSync(path, "utf8")).toBe(text);
  });

  test("数を超えたら古く保存したものから忘れる", async () => {
    for (let n = 0; n <= MAX_MAIN_TABS_PROJECTS; n += 1)
      await saveProjectMainTabs(path, `/work/p${n}`, layout, n);
    expect([
      loadProjectMainTabs(path, "/work/p0"),
      loadProjectMainTabs(path, "/work/p1"),
      loadProjectMainTabs(path, `/work/p${MAX_MAIN_TABS_PROJECTS}`),
    ]).toEqual([null, layout, layout]);
  });

  test.each([
    { name: "JSON でない", text: "{broken", message: "are not valid JSON" },
    {
      name: "形が違う (版と projects)",
      text: JSON.stringify({ version: 2, projects: [] }),
      message: "- version is 2, expected 1\n- projects is not an object",
    },
  ])("壊れたファイル ($name) は読まず、上書きもしない", async ({
    text,
    message,
  }) => {
    writeFileSync(path, text);
    expect(() => loadProjectMainTabs(path, "/work/sample-app")).toThrow(
      message,
    );
    await expect(
      saveProjectMainTabs(path, "/work/sample-app", layout),
    ).rejects.toThrow(message);
    expect(readFileSync(path, "utf8")).toBe(text);
  });

  test("大きすぎる配置は保存しない", async () => {
    const big = { text: "x".repeat(MAX_MAIN_TABS_LAYOUT_BYTES) };
    await expect(
      saveProjectMainTabs(path, "/work/sample-app", big),
    ).rejects.toThrow(`(at most ${MAX_MAIN_TABS_LAYOUT_BYTES})`);
  });
});

describe("main tabs store: 壊れた保存値の退避", () => {
  test("ファイル全体を同じ場所の main-tabs.json.broken-<時刻> へ写し、元は残す", async () => {
    await saveProjectMainTabs(path, "/work/sample-app", layout, 1);
    await saveProjectMainTabs(path, "/work/sample-lib", { other: true }, 2);
    const before = readFileSync(path, "utf8");
    const now = Date.UTC(2026, 8, 22, 12, 34, 56, 789);
    const first = await backupMainTabs(path, now);
    const second = await backupMainTabs(path, now);
    expect([
      first,
      second,
      readFileSync(first, "utf8"),
      readFileSync(second, "utf8"),
      readFileSync(path, "utf8"),
    ]).toEqual([
      `${path}.broken-2026-09-22T12-34-56-789Z`,
      `${path}.broken-2026-09-22T12-34-56-789Z-2`,
      before,
      before,
      before,
    ]);
  });

  test("写せなければ理由つきで投げる (画面はそのとき上書きしない)", async () => {
    await expect(backupMainTabs(path, 0)).rejects.toThrow(
      `cannot back up the saved main tabs (${path}) to ${path}.broken-1970-01-01T00-00-00-000Z`,
    );
  });
});
