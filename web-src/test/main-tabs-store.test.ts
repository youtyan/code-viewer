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
import {
  backupMainTabs,
  loadMainTabs,
  MAIN_TABS_FILE_VERSION,
  MAX_MAIN_TABS_LAYOUT_BYTES,
  MainTabsStoreError,
  saveMainTabs,
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

/** 左の面にファイルのタブ (id = パス、プロジェクト /work/sample-app) を並べた配置。 */
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

const idsOf = (layout: unknown) =>
  (layout as ReturnType<typeof layoutOf>).panes.flatMap((pane) =>
    pane.tabs.map((tab) => tab.id),
  );

describe("main tabs store", () => {
  test("保存が無ければ none", async () => {
    expect(await loadMainTabs(path)).toEqual({ kind: "none" });
  });

  test("書くたびに版の番号が 1 つ進み、書いた値を読み戻す", async () => {
    const first = await saveMainTabs(path, {
      baseRev: null,
      base: null,
      layout: layoutOf("a"),
    });
    const second = await saveMainTabs(path, {
      baseRev: 1,
      base: layoutOf("a"),
      layout: layoutOf("a", "b"),
    });
    expect([first, second, await loadMainTabs(path)]).toEqual([
      { kind: "ok", rev: 1, layout: layoutOf("a"), merged: false },
      { kind: "ok", rev: 2, layout: layoutOf("a", "b"), merged: false },
      { kind: "ok", rev: 2, layout: layoutOf("a", "b") },
    ]);
  });

  // 窓 2 つ: どちらも rev 1 を読んだあと、A が a を開いて書き、B が b を開いて
  // (A の書き込みを知らずに) 書く。前は B の全体の上書きで A の a が消えていた。
  test("窓 2 つ: 後から書いた窓が、もう一方の窓で開いたタブを消さない", async () => {
    await saveMainTabs(path, {
      baseRev: null,
      base: null,
      layout: layoutOf("base"),
    });
    const read = await loadMainTabs(path);
    if (read.kind !== "ok") throw new Error("not saved");
    const fromA = await saveMainTabs(path, {
      baseRev: read.rev,
      base: read.layout,
      layout: layoutOf("base", "a"),
    });
    const fromB = await saveMainTabs(path, {
      baseRev: read.rev,
      base: read.layout,
      layout: layoutOf("base", "b"),
    });
    const after = await loadMainTabs(path);
    expect([
      fromA.kind === "ok" && fromA.merged,
      fromB.kind === "ok" && fromB.merged,
      after.kind === "ok" ? [after.rev, idsOf(after.layout)] : after,
      // b は B の窓で左隣だった base のすぐ右に入る (a はその右へ押される)。
    ]).toEqual([false, true, [3, ["base", "b", "a"]]]);
  });

  test("窓 2 つ: 一方が閉じたタブは、もう一方の古い保存で戻らない", async () => {
    await saveMainTabs(path, {
      baseRev: null,
      base: null,
      layout: layoutOf("a", "b"),
    });
    await saveMainTabs(path, {
      baseRev: 1,
      base: layoutOf("a", "b"),
      layout: layoutOf("a"),
    });
    // 窓 B は rev 1 のまま、c を開いた。
    await saveMainTabs(path, {
      baseRev: 1,
      base: layoutOf("a", "b"),
      layout: layoutOf("a", "b", "c"),
    });
    const after = await loadMainTabs(path);
    expect(after.kind === "ok" ? idsOf(after.layout) : after).toEqual([
      "a",
      "c",
    ]);
  });

  test("新しい版のファイルは使わず、上書きもしない", async () => {
    const text = JSON.stringify({
      version: MAIN_TABS_FILE_VERSION + 1,
      anything: true,
    });
    writeFileSync(path, text);
    expect([
      await loadMainTabs(path),
      await saveMainTabs(path, {
        baseRev: null,
        base: null,
        layout: layoutOf("a"),
      }),
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
      name: "形が違う",
      text: JSON.stringify({ version: 2, rev: -1 }),
      message: "- rev is -1\n- savedAt is not a number\n- there is no layout",
    },
    {
      name: "版が無い",
      text: JSON.stringify({ rev: 1, savedAt: 1, layout: null }),
      message: "- version is undefined, expected 1 or 2",
    },
  ])("壊れたファイル ($name) は読まず、上書きもしない", async ({
    text,
    message,
  }) => {
    writeFileSync(path, text);
    await expect(loadMainTabs(path)).rejects.toThrow(message);
    await expect(
      saveMainTabs(path, { baseRev: null, base: null, layout: layoutOf("a") }),
    ).rejects.toThrow(message);
    expect(readFileSync(path, "utf8")).toBe(text);
  });

  test("別の窓の保存が壊れていて重ねられなければ、何も書かない", async () => {
    const text = JSON.stringify({
      version: 2,
      rev: 4,
      savedAt: 1,
      layout: { version: LAYOUT_VERSION, focused: "middle", panes: [] },
    });
    writeFileSync(path, text);
    await expect(
      saveMainTabs(path, { baseRev: 3, base: null, layout: layoutOf("a") }),
    ).rejects.toThrow(
      "could not be merged with the layout saved by another window (rev 4, this window read rev 3), so nothing was written",
    );
    expect(readFileSync(path, "utf8")).toBe(text);
  });

  test.each([
    {
      name: "大きすぎる配置",
      write: {
        baseRev: null,
        base: null,
        layout: { text: "x".repeat(MAX_MAIN_TABS_LAYOUT_BYTES) },
      },
      message: `(at most ${MAX_MAIN_TABS_LAYOUT_BYTES})`,
    },
    {
      name: "読めない配置",
      write: { baseRev: null, base: null, layout: { version: 0 } },
      message: "the main tabs layout to save is broken",
    },
  ])("$name は画面の誤りとして断り、書かない", async ({ write, message }) => {
    const error = await saveMainTabs(path, write).catch((e: unknown) => e);
    expect([
      error instanceof MainTabsStoreError && error.code,
      String(error),
      existsSync(path),
    ]).toEqual(["invalid-input", expect.stringContaining(message), false]);
  });
});

describe("main tabs store: 前の版 (プロジェクトごと) の保存を移す", () => {
  // 前の版の形: プロジェクト 2 つ分の配置と、プロジェクトに属さないタブ。
  const oldFile = {
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
              activeId: "t2",
              tabs: [
                {
                  id: "t1",
                  preview: false,
                  target: { kind: "file", path: "src/app.ts" },
                },
                {
                  id: "t2",
                  preview: true,
                  target: { kind: "file", path: "README.md" },
                },
                {
                  id: "t3",
                  preview: false,
                  target: { kind: "page", page: "diff" },
                },
                {
                  id: "t4",
                  preview: false,
                  target: { kind: "terminal", session: "shell-ab12" },
                },
              ],
            },
          ],
        },
      },
      "/work/sample-lib": {
        savedAt: 10,
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
                {
                  id: "t2",
                  preview: false,
                  target: { kind: "terminal", session: "shell-ab12" },
                },
                {
                  id: "t3",
                  preview: false,
                  target: { kind: "page", page: "search" },
                  route: { q: "sample" },
                },
              ],
            },
          ],
        },
      },
    },
    common: {
      savedAt: 20,
      tabs: {
        version: 1,
        targets: [
          { kind: "terminal", session: "shell-ab12" },
          { kind: "page", page: "agents" },
        ],
      },
    },
  };

  test("読んだら 1 つの配置へ移して書き直し、元は .v1-<時刻> に残す。タブは 1 枚も消えない", async () => {
    const text = JSON.stringify(oldFile);
    writeFileSync(path, text);
    const now = Date.UTC(2026, 8, 23, 1, 2, 3, 4);
    const loaded = await loadMainTabs(path, now);
    if (loaded.kind !== "ok") throw new Error(`not loaded: ${loaded.kind}`);
    const tabs = (
      loaded.layout as {
        panes: Array<{
          tabs: Array<{ id: string; target: unknown; route?: unknown }>;
        }>;
      }
    ).panes.flatMap((pane) => pane.tabs);
    expect([
      tabs.map((tab) => [tab.id, tab.target, tab.route ?? null]),
      loaded.rev,
      loaded.migration,
      readFileSync(`${path}.v1-2026-09-23T01-02-03-004Z`, "utf8"),
      JSON.parse(readFileSync(path, "utf8")).version,
    ]).toEqual([
      [
        [
          "t1",
          { kind: "file", path: "src/app.ts", project: "/work/sample-app" },
          null,
        ],
        [
          "t2",
          { kind: "file", path: "README.md", project: "/work/sample-app" },
          null,
        ],
        [
          "t3",
          { kind: "page", page: "diff", project: "/work/sample-app" },
          null,
        ],
        ["t4", { kind: "terminal", session: "shell-ab12" }, null],
        [
          "t1-2",
          { kind: "file", path: "src/app.ts", project: "/work/sample-lib" },
          null,
        ],
        [
          "t3-2",
          { kind: "page", page: "search", project: "/work/sample-lib" },
          { q: "sample" },
        ],
        ["c1", { kind: "page", page: "agents" }, null],
      ],
      1,
      {
        moved: 7,
        merged: [
          {
            at: 'projects["/work/sample-lib"].layout left t2-2',
            target: { kind: "terminal", session: "shell-ab12" },
          },
        ],
        retired: [],
        unmigrated: [],
        backup: `${path}.v1-2026-09-23T01-02-03-004Z`,
      },
      text,
      2,
    ]);
  });

  test("読めない配置と知らない種類は捨てずに、場所・理由・元の値を返す", async () => {
    const broken = { version: 4, focused: "middle", panes: [] };
    const chart = { id: "t9", preview: false, target: { kind: "chart" } };
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        projects: {
          "/work/sample-app": {
            savedAt: 2,
            layout: {
              version: 4,
              focused: "left",
              panes: [{ side: "left", activeId: null, tabs: [chart] }],
            },
          },
          "/work/sample-lib": { savedAt: 1, layout: broken },
        },
      }),
    );
    const loaded = await loadMainTabs(path, 0);
    expect(loaded.kind === "ok" && loaded.migration?.unmigrated).toEqual([
      {
        at: 'projects["/work/sample-app"].layout.panes[0].tabs[0]',
        reason: "unknown tab kind",
        raw: chart,
      },
      {
        at: 'projects["/work/sample-lib"]',
        reason:
          'Error: main tab layout is broken (2 problems):\n- focused is "middle"\n- panes has 0 entries (1 or 2 allowed)',
        raw: broken,
      },
    ]);
  });

  test("読めない共通のタブは、error の名前ごと理由を返す", async () => {
    const common = { tabs: "sample broken tabs" };
    writeFileSync(path, JSON.stringify({ version: 1, projects: {}, common }));
    const loaded = await loadMainTabs(path, 0);
    expect(loaded.kind === "ok" && loaded.migration?.unmigrated).toEqual([
      {
        at: "common",
        reason: "Error: common tabs: not an object",
        raw: common,
      },
    ]);
  });

  test("書くときに前の版のファイルだったら、移してから重ねる", async () => {
    writeFileSync(path, JSON.stringify(oldFile));
    const saved = await saveMainTabs(
      path,
      { baseRev: null, base: null, layout: layoutOf("new.ts") },
      0,
    );
    expect(
      saved.kind === "ok" && [saved.rev, saved.merged, idsOf(saved.layout)],
    ).toEqual([
      2,
      true,
      ["t1", "t2", "t3", "t4", "t1-2", "t3-2", "c1", "new.ts"],
    ]);
    expect(readdirSync(dir).some((name) => name.includes(".v1-"))).toBe(true);
  });
});

describe("main tabs store: 壊れた保存値の退避", () => {
  test("ファイル全体を同じ場所の main-tabs.json.broken-<時刻> へ写し、元は残す", async () => {
    await saveMainTabs(path, {
      baseRev: null,
      base: null,
      layout: layoutOf("a"),
    });
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
