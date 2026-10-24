// 窓ごとの面の並びとタブの保存 (server/main-tabs-store.ts)。版 3 の読み書き・知らない
// 窓への写し・前の版のファイル (版 2・版 1) の読み方と書き直し・壊れた値と新しい版を
// 上書きしないこと・窓の数の上限 (時計が戻っても書いた窓は消さない)・退避。

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { LAYOUT_VERSION } from "../core/main-tabs";
import { singlePane, splitPane } from "../core/workspace";
import {
  backupMainTabs,
  loadWorkspace,
  MAIN_TABS_FILE_VERSION,
  MAX_WINDOWS,
  MAX_WORKSPACE_BYTES,
  MainTabsStoreError,
  saveWorkspace,
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

/** 左の面にファイルのタブ (id = パス) を並べた配置。 */
function layoutOf(...names: string[]) {
  return {
    version: LAYOUT_VERSION,
    focused: "left",
    panes: [
      {
        side: "left",
        activeId: names[0] ?? null,
        tabs: names.map((name) => ({
          id: name,
          preview: false,
          target: { kind: "file", path: name, project: "/work/sample-app" },
        })),
      },
    ],
  };
}

/** p1 | p2 の窓 (p1 にタブ)。 */
function twoPanes(name: string) {
  const one = singlePane("p1", "/p/0123456789abcdef/");
  const ws = splitPane(one, "p1", "row", "p2", {
    url: "/p/0123456789abcdef/history",
    layout: null,
  });
  return {
    ...ws,
    panes: { ...ws.panes, p1: { ...ws.panes.p1, layout: layoutOf(name) } },
  };
}

describe("窓ごとの読み書き", () => {
  test("保存が無ければ none", () => {
    expect(loadWorkspace(path, "w-a")).toEqual({ kind: "none" });
  });

  test("書くたびにその窓の版が進み、その窓は書いた値を読み戻す", async () => {
    const first = await saveWorkspace(path, "w-a", twoPanes("a.ts"), 10);
    const second = await saveWorkspace(path, "w-a", twoPanes("b.ts"), 20);
    expect([first, second, loadWorkspace(path, "w-a")]).toEqual([
      { kind: "ok", rev: 1 },
      { kind: "ok", rev: 2 },
      { kind: "ok", workspace: twoPanes("b.ts") },
    ]);
  });

  test("窓どうしは重ねない: 別の窓の保存は、この窓の保存を変えない", async () => {
    await saveWorkspace(path, "w-a", twoPanes("a.ts"), 10);
    await saveWorkspace(path, "w-b", twoPanes("b.ts"), 20);
    expect(loadWorkspace(path, "w-a")).toEqual({
      kind: "ok",
      workspace: twoPanes("a.ts"),
    });
  });

  test("知らない窓には、最後に書いた窓の写しを返す", async () => {
    await saveWorkspace(path, "w-a", twoPanes("a.ts"), 20);
    await saveWorkspace(path, "w-b", twoPanes("b.ts"), 10);
    expect(loadWorkspace(path, "w-new")).toEqual({
      kind: "ok",
      workspace: twoPanes("a.ts"),
      copiedFrom: "w-a",
    });
  });

  test(`覚える窓は ${MAX_WINDOWS} まで。時計が戻った後でも、いま書いた窓は消さない`, async () => {
    for (let n = 0; n < MAX_WINDOWS; n++)
      await saveWorkspace(path, `w-${n}`, twoPanes(`${n}.ts`), 100 + n);
    // 時計が戻った (手で合わせ直した・仮想機械の復元): 一番古い時刻で書く。
    await saveWorkspace(path, "w-late", twoPanes("late.ts"), 1);
    const windows = Object.keys(
      JSON.parse(readFileSync(path, "utf8")).windows,
    ).sort();
    expect({ windows, late: loadWorkspace(path, "w-late") }).toEqual({
      windows: ["w-1", "w-2", "w-3", "w-4", "w-5", "w-6", "w-7", "w-late"],
      late: { kind: "ok", workspace: twoPanes("late.ts") },
    });
  });
});

describe("前の版のファイル", () => {
  test("版 2 (全部の窓で 1 つの配置) は配置を返し、書くときに .v2-<時刻> へ写して版 3 にする", async () => {
    const text = JSON.stringify({
      version: 2,
      rev: 4,
      savedAt: 1,
      layout: layoutOf("a.ts"),
    });
    writeFileSync(path, text);
    const loaded = loadWorkspace(path, "w-a");
    const now = Date.UTC(2026, 9, 24, 1, 2, 3, 4);
    await saveWorkspace(path, "w-a", twoPanes("a.ts"), now);
    expect({
      loaded,
      backup: readFileSync(`${path}.v2-2026-10-24T01-02-03-004Z`, "utf8"),
      file: JSON.parse(readFileSync(path, "utf8")),
    }).toEqual({
      loaded: { kind: "legacy", layout: layoutOf("a.ts") },
      backup: text,
      file: {
        version: MAIN_TABS_FILE_VERSION,
        windows: {
          "w-a": { rev: 1, savedAt: now, workspace: twoPanes("a.ts") },
        },
      },
    });
  });

  test("版 1 (プロジェクトごと) は 1 つの配置へ移した値と移した報告を返す", () => {
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        projects: {
          "/work/sample-app": {
            savedAt: 20,
            layout: {
              version: 4,
              focused: "left",
              panes: [
                {
                  side: "left",
                  activeId: "t1",
                  tabs: [
                    {
                      id: "t1",
                      preview: false,
                      target: { kind: "file", path: "src/app.ts" },
                    },
                  ],
                },
              ],
            },
          },
        },
      }),
    );
    const loaded = loadWorkspace(path, "w-a");
    if (loaded.kind !== "legacy") throw new Error(`not legacy: ${loaded.kind}`);
    expect({
      tabs: (
        loaded.layout as { panes: Array<{ tabs: Array<{ target: unknown }> }> }
      ).panes.flatMap((pane) => pane.tabs.map((tab) => tab.target)),
      moved: loaded.migration?.moved,
    }).toEqual({
      tabs: [{ kind: "file", path: "src/app.ts", project: "/work/sample-app" }],
      moved: 1,
    });
  });
});

describe("使わない・上書きしない", () => {
  test("新しい版のファイルは使わず、上書きもしない", async () => {
    const text = JSON.stringify({
      version: MAIN_TABS_FILE_VERSION + 1,
      anything: true,
    });
    writeFileSync(path, text);
    expect([
      loadWorkspace(path, "w-a"),
      await saveWorkspace(path, "w-a", twoPanes("a.ts")),
      readFileSync(path, "utf8"),
    ]).toEqual([
      { kind: "newer", version: MAIN_TABS_FILE_VERSION + 1 },
      { kind: "newer", version: MAIN_TABS_FILE_VERSION + 1 },
      text,
    ]);
  });

  test.each([
    { name: "JSON でない", text: "{broken", message: "are not valid JSON" },
    {
      name: "窓の形が違う",
      text: JSON.stringify({ version: 3, windows: { "w-a": { rev: 0 } } }),
      message: "- windows.w-a.rev is 0",
    },
    {
      name: "版が無い",
      text: JSON.stringify({ windows: {} }),
      message: "- version is undefined, expected 1, 2 or 3",
    },
  ])(
    "壊れたファイル ($name) は読まず、上書きもしない",
    async ({ text, message }) => {
      writeFileSync(path, text);
      expect(() => loadWorkspace(path, "w-a")).toThrow(message);
      await expect(
        saveWorkspace(path, "w-a", twoPanes("a.ts")),
      ).rejects.toThrow(message);
      expect(readFileSync(path, "utf8")).toBe(text);
    },
  );

  test.each([
    {
      name: "窓の id の形が違う",
      window: "../w",
      workspace: twoPanes("a.ts"),
      message: 'the window id "../w" is not in the form',
    },
    {
      name: "面の木が壊れている",
      window: "w-a",
      workspace: { ...twoPanes("a.ts"), focused: "p9" },
      message: '- focused is "p9"',
    },
    {
      name: "面のタブの配置が壊れている",
      window: "w-a",
      workspace: {
        ...twoPanes("a.ts"),
        panes: {
          ...twoPanes("a.ts").panes,
          p2: { url: "/", layout: { version: 0 } },
        },
      },
      message: "pane p2: Error: main tab layout is broken",
    },
    {
      name: "大きすぎる",
      window: "w-a",
      workspace: {
        ...twoPanes("a.ts"),
        panes: {
          ...twoPanes("a.ts").panes,
          p2: { url: "x".repeat(MAX_WORKSPACE_BYTES), layout: null },
        },
      },
      message: `(at most ${MAX_WORKSPACE_BYTES})`,
    },
  ])(
    "$name は画面の誤りとして断り、書かない",
    async ({ window, workspace, message }) => {
      const error = await saveWorkspace(path, window, workspace).catch(
        (e: unknown) => e,
      );
      expect([
        error instanceof MainTabsStoreError && error.code,
        String(error),
        existsSync(path),
      ]).toEqual(["invalid-input", expect.stringContaining(message), false]);
    },
  );
});

describe("壊れた保存値の退避", () => {
  test("ファイル全体を同じ場所の main-tabs.json.broken-<時刻> へ写し、元は残す", async () => {
    await saveWorkspace(path, "w-a", twoPanes("a.ts"));
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
      readdirSync(dir).length,
    ]).toEqual([
      `${path}.broken-2026-09-22T12-34-56-789Z`,
      `${path}.broken-2026-09-22T12-34-56-789Z-2`,
      before,
      before,
      before,
      3,
    ]);
  });

  test("写せなければ理由つきで投げる (画面はそのとき上書きしない)", async () => {
    await expect(backupMainTabs(path, 0)).rejects.toThrow(
      `cannot back up the saved main tabs (${path}) to ${path}.broken-1970-01-01T00-00-00-000Z`,
    );
  });
});
