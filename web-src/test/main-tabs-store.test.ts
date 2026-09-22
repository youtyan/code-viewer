import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
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
