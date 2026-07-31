import { describe, expect, test } from "vitest";
import {
  findTmuxPane,
  flattenTmuxPanes,
  isTmuxPaneId,
  type TmuxSession,
} from "../core/tmux";
import { parseTmuxPanes } from "../server/tmux/panes";

// panes.ts が list-panes -F に渡している区切り (ASCII Unit Separator)。
// パーサの入力仕様そのものなので、テスト側でも同じ値を置く。
const SEP = String.fromCharCode(31);

type PaneFields = {
  id: string;
  session: string;
  attached: string;
  windowIndex: string;
  windowName: string;
  windowActive: string;
  paneIndex: string;
  paneActive: string;
  width: string;
  height: string;
  command: string;
  path: string;
  title: string;
};

const BASE: PaneFields = {
  id: "%1",
  session: "sample-session",
  attached: "1",
  windowIndex: "0",
  windowName: "sample-window",
  windowActive: "1",
  paneIndex: "0",
  paneActive: "1",
  width: "80",
  height: "24",
  command: "shell",
  path: "/tmp/sample",
  title: "sample title",
};

/** tmux の 1 行を組み立てる。検証したい値だけを上書きする。 */
function line(overrides: Partial<PaneFields> = {}): string {
  const f = { ...BASE, ...overrides };
  return [
    f.id,
    f.session,
    f.attached,
    f.windowIndex,
    f.windowName,
    f.windowActive,
    f.paneIndex,
    f.paneActive,
    f.width,
    f.height,
    f.command,
    f.path,
    f.title,
  ].join(SEP);
}

describe("parseTmuxPanes tree building", () => {
  test("groups panes under their session and window", () => {
    const sessions = parseTmuxPanes(
      [
        line({ id: "%1", session: "alpha", windowIndex: "0", paneIndex: "0" }),
        line({ id: "%2", session: "alpha", windowIndex: "0", paneIndex: "1" }),
        line({ id: "%3", session: "alpha", windowIndex: "1", paneIndex: "0" }),
        line({ id: "%4", session: "beta", windowIndex: "0", paneIndex: "0" }),
      ].join("\n"),
    );

    expect(sessions.map((s) => s.name)).toEqual(["alpha", "beta"]);
    expect(sessions[0].windows.map((w) => w.index)).toEqual([0, 1]);
    expect(sessions[0].windows[0].panes.map((p) => p.id)).toEqual(["%1", "%2"]);
    expect(sessions[0].windows[1].panes.map((p) => p.id)).toEqual(["%3"]);
    expect(sessions[1].windows[0].panes.map((p) => p.id)).toEqual(["%4"]);
  });

  test("keeps windows with the same index in different sessions apart", () => {
    const sessions = parseTmuxPanes(
      [
        line({ id: "%1", session: "alpha", windowIndex: "0" }),
        line({ id: "%2", session: "beta", windowIndex: "0" }),
      ].join("\n"),
    );

    expect(sessions).toHaveLength(2);
    expect(sessions[0].windows[0].panes.map((p) => p.id)).toEqual(["%1"]);
    expect(sessions[1].windows[0].panes.map((p) => p.id)).toEqual(["%2"]);
  });

  // セッション名とウィンドウ番号を区切りなしで連結すると、"a" の窓 10 と
  // "a1" の窓 0 が同じキーになって別ウィンドウのペインが 1 つに混ざる。
  test("keeps windows apart when one session name prefixes another", () => {
    const sessions = parseTmuxPanes(
      [
        line({ id: "%1", session: "a", windowIndex: "10" }),
        line({ id: "%2", session: "a1", windowIndex: "0" }),
      ].join("\n"),
    );

    expect(sessions.map((s) => s.name)).toEqual(["a", "a1"]);
    expect(sessions[0].windows[0].panes.map((p) => p.id)).toEqual(["%1"]);
    expect(sessions[1].windows[0].panes.map((p) => p.id)).toEqual(["%2"]);
  });

  test("preserves the order tmux emitted", () => {
    const sessions = parseTmuxPanes(
      [
        line({ id: "%9", session: "zeta" }),
        line({ id: "%1", session: "alpha" }),
      ].join("\n"),
    );

    expect(sessions.map((s) => s.name)).toEqual(["zeta", "alpha"]);
  });

  test("reads every field of a pane", () => {
    const [session] = parseTmuxPanes(
      line({
        id: "%42",
        session: "alpha",
        windowIndex: "3",
        paneIndex: "2",
        width: "120",
        height: "40",
        command: "editor",
        path: "/tmp/example",
        title: "example task",
      }),
    );

    expect(session.windows[0].panes[0]).toEqual({
      id: "%42",
      label: "alpha:3.2",
      paneIndex: 2,
      title: "example task",
      command: "editor",
      path: "/tmp/example",
      width: 120,
      height: 40,
      active: true,
    });
  });
});

describe("parseTmuxPanes field handling", () => {
  test.each([
    { name: "reads an attached session", attached: "1", expected: true },
    { name: "reads a detached session", attached: "0", expected: false },
    { name: "treats an empty flag as detached", attached: "", expected: false },
  ])("$name", ({ attached, expected }) => {
    expect(parseTmuxPanes(line({ attached }))[0].attached).toBe(expected);
  });

  test.each([
    { name: "reads an active pane", paneActive: "1", expected: true },
    { name: "reads an inactive pane", paneActive: "0", expected: false },
    {
      name: "treats an empty flag as inactive",
      paneActive: "",
      expected: false,
    },
  ])("$name", ({ paneActive, expected }) => {
    expect(
      parseTmuxPanes(line({ paneActive }))[0].windows[0].panes[0].active,
    ).toBe(expected);
  });

  test.each([
    { name: "reads a plain size", width: "80", expected: 80 },
    { name: "reads a wide pane", width: "319", expected: 319 },
    { name: "falls back to 0 for an empty size", width: "", expected: 0 },
    {
      name: "falls back to 0 for a non-numeric size",
      width: "wide",
      expected: 0,
    },
  ])("$name", ({ width, expected }) => {
    expect(parseTmuxPanes(line({ width }))[0].windows[0].panes[0].width).toBe(
      expected,
    );
  });

  test.each([
    {
      name: "keeps a title containing spaces",
      title: "run the sample task",
      expected: "run the sample task",
    },
    {
      name: "keeps a multibyte title",
      title: "日本語のタイトル",
      expected: "日本語のタイトル",
    },
    {
      name: "keeps a title that looks like a separator character",
      title: "a:b.c",
      expected: "a:b.c",
    },
    { name: "keeps an empty title", title: "", expected: "" },
  ])("$name", ({ title, expected }) => {
    expect(parseTmuxPanes(line({ title }))[0].windows[0].panes[0].title).toBe(
      expected,
    );
  });
});

describe("parseTmuxPanes malformed input", () => {
  test.each([
    { name: "ignores an empty string", stdout: "" },
    { name: "ignores blank lines", stdout: "\n\n" },
    { name: "ignores a line with too few columns", stdout: `%1${SEP}alpha` },
    {
      name: "ignores a line with an empty pane id",
      stdout: line({ id: "" }),
    },
  ])("$name", ({ stdout }) => {
    expect(parseTmuxPanes(stdout)).toEqual([]);
  });

  test("keeps the valid lines when one line is malformed", () => {
    const sessions = parseTmuxPanes(
      [line({ id: "%1" }), "warning: something", line({ id: "%2" })].join("\n"),
    );

    expect(flattenTmuxPanes(sessions).map((p) => p.id)).toEqual(["%1", "%2"]);
  });
});

describe("isTmuxPaneId", () => {
  test.each([
    { name: "accepts a single digit id", value: "%0", expected: true },
    { name: "accepts a multi digit id", value: "%142", expected: true },
    { name: "rejects a missing prefix", value: "12", expected: false },
    { name: "rejects a window target", value: "%1.2", expected: false },
    { name: "rejects a session target", value: "alpha:0.1", expected: false },
    { name: "rejects a trailing space", value: "%1 ", expected: false },
    { name: "rejects a shell metacharacter", value: "%1;id", expected: false },
    { name: "rejects an empty string", value: "", expected: false },
    { name: "rejects null", value: null, expected: false },
    { name: "rejects a number", value: 1, expected: false },
  ])("$name", ({ value, expected }) => {
    expect(isTmuxPaneId(value)).toBe(expected);
  });
});

describe("findTmuxPane", () => {
  const SESSIONS: TmuxSession[] = parseTmuxPanes(
    [
      line({ id: "%1", session: "alpha", paneIndex: "0" }),
      line({ id: "%2", session: "alpha", paneIndex: "1" }),
      line({ id: "%3", session: "beta", paneIndex: "0" }),
    ].join("\n"),
  );

  test("finds a pane in the first session", () => {
    expect(findTmuxPane(SESSIONS, "%1")?.id).toBe("%1");
  });

  test("finds a pane in a later session", () => {
    expect(findTmuxPane(SESSIONS, "%3")?.id).toBe("%3");
  });

  test("returns null for a pane that is gone", () => {
    expect(findTmuxPane(SESSIONS, "%99")).toBeNull();
  });

  test("returns null when nothing is selected", () => {
    expect(findTmuxPane(SESSIONS, null)).toBeNull();
  });

  test("returns null for an empty list", () => {
    expect(findTmuxPane([], "%1")).toBeNull();
  });
});
