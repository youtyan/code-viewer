// 設定ファイルに書く前の確認の画面の差分: 差分の文字を作る core/text-diff.ts と、
// それを差分の画面と同じ diff2html で描く views/agents/settings-diff.ts。
// diff2html は index.html が読み込むのと同じ web/vendor の実物を読み込んで描く。

import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { unifiedDiff } from "../core/text-diff";
import { settingsDiffBlock } from "../views/agents/settings-diff";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const lines = (count: number, from = 1) =>
  Array.from({ length: count }, (_, index) => `line ${index + from}`);
const text = (items: string[]) => `${items.join("\n")}\n`;

describe("unifiedDiff", () => {
  test.each([
    {
      name: "no change",
      before: text(lines(3)),
      after: text(lines(3)),
      diff: "",
    },
    {
      name: "a missing file: everything is added",
      before: null,
      after: '{\n  "a": 1\n}\n',
      diff: [
        "diff --git a/settings.json b/settings.json",
        "--- /dev/null",
        "+++ b/settings.json",
        "@@ -0,0 +1,3 @@",
        "+{",
        '+  "a": 1',
        "+}",
        "",
      ].join("\n"),
    },
    {
      name: "one line changed in the middle keeps three lines around it",
      before: text(lines(9)),
      after: text([...lines(4), "line five", ...lines(4, 6)]),
      diff: [
        "diff --git a/settings.json b/settings.json",
        "--- a/settings.json",
        "+++ b/settings.json",
        "@@ -2,7 +2,7 @@",
        " line 2",
        " line 3",
        " line 4",
        "-line 5",
        "+line five",
        " line 6",
        " line 7",
        " line 8",
        "",
      ].join("\n"),
    },
    {
      name: "changes far apart make two hunks",
      before: text(lines(20)),
      after: text(["line one", ...lines(18, 2), "line twenty"]),
      diff: [
        "diff --git a/settings.json b/settings.json",
        "--- a/settings.json",
        "+++ b/settings.json",
        "@@ -1,4 +1,4 @@",
        "-line 1",
        "+line one",
        " line 2",
        " line 3",
        " line 4",
        "@@ -17,4 +17,4 @@",
        " line 17",
        " line 18",
        " line 19",
        "-line 20",
        "+line twenty",
        "",
      ].join("\n"),
    },
    {
      name: "lines removed at the end",
      before: text(lines(3)),
      after: text(lines(1)),
      diff: [
        "diff --git a/settings.json b/settings.json",
        "--- a/settings.json",
        "+++ b/settings.json",
        "@@ -1,3 +1 @@",
        " line 1",
        "-line 2",
        "-line 3",
        "",
      ].join("\n"),
    },
  ])("$name", ({ before, after, diff }) => {
    expect(unifiedDiff(before, after, "settings.json")).toBe(diff);
  });
});

function loadDiff2Html(): void {
  const code = readFileSync("web/vendor/diff2html/diff2html-ui.min.js", "utf8");
  // index.html の <script> と同じく、画面の window に Diff2HtmlUI を置く。
  new Function(code).call(window);
}

const PLAN = {
  path: "/home/sample/.claude/settings.json",
  realPath: "/home/sample/dotfiles/claude/settings.json",
  symlink: true,
  changed: true,
  diff: unifiedDiff(
    '{\n  "model": "sample"\n}\n',
    '{\n  "model": "sample",\n  "hooks": {}\n}\n',
    "settings.json",
  ),
};
const TEXT = {
  file: "File",
  unchanged: "Nothing changes.",
  drawFailed: "Shown as text.",
};

describe("settingsDiffBlock", () => {
  test("draws the diff like the Diff screen: line numbers, added and removed rows", () => {
    loadDiff2Html();
    const body = document.createElement("div");
    body.append(...settingsDiffBlock(PLAN, "/home/sample", TEXT));
    document.body.appendChild(body);
    // 書き込む先はリンクなら「リンク → 実体」。
    expect(
      body.querySelector(".agent-hooks-dialog-field code")?.textContent,
    ).toBe("~/.claude/settings.json → ~/dotfiles/claude/settings.json");
    const rows = [...body.querySelectorAll(".agent-settings-diff tr")].map(
      (row) => {
        const code = row.querySelector(".d2h-code-line-ctn")?.textContent ?? "";
        const kind = row.querySelector(".d2h-ins")
          ? "+"
          : row.querySelector(".d2h-del")
            ? "-"
            : " ";
        return `${kind}${code}`;
      },
    );
    expect(rows.filter((row) => row !== " ")).toEqual([
      " {",
      '-  "model": "sample"',
      '+  "model": "sample",',
      '+  "hooks": {}',
      " }",
    ]);
    // 行番号がある。
    expect(
      body.querySelectorAll(".agent-settings-diff .d2h-code-linenumber").length,
    ).toBeGreaterThan(0);
  });

  test.each([
    { name: "not changed", plan: { ...PLAN, changed: false, diff: "" } },
    { name: "changed flag without a diff", plan: { ...PLAN, diff: "" } },
  ])("$name: says nothing changes", ({ plan }) => {
    const [, second] = settingsDiffBlock(plan, "", TEXT);
    expect(second?.textContent).toBe(TEXT.unchanged);
  });

  test("without diff2html it says so and shows the diff as text (not hidden)", () => {
    const saved = window.Diff2HtmlUI;
    const failed = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    Reflect.deleteProperty(window, "Diff2HtmlUI");
    try {
      const parts = settingsDiffBlock(PLAN, "", TEXT);
      expect(parts.map((part) => part.textContent)).toEqual([
        `${TEXT.file}${PLAN.path} → ${PLAN.realPath}`,
        TEXT.drawFailed,
        PLAN.diff,
      ]);
      expect(failed).toHaveBeenCalledTimes(1);
    } finally {
      window.Diff2HtmlUI = saved;
    }
  });
});
