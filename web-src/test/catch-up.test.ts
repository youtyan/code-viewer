import { describe, expect, test } from "vitest";
import {
  catchUpKind,
  createCatchUpGate,
  shouldAutoLoadForRoute,
  sseUpdatePlan,
} from "../core/catch-up";
import type { AppRoute } from "../core/routes";

describe("diff catch-up policy", () => {
  const range = { from: "HEAD", to: "worktree" };

  test.each([
    {
      name: "fixed refs stay mounted when the worktree changes",
      range: { from: "base-ref", to: "target-ref" },
      expected: false,
    },
    {
      name: "a worktree target refreshes",
      range: { from: "base-ref", to: "worktree" },
      expected: true,
    },
    {
      name: "a worktree source refreshes",
      range: { from: "worktree", to: "target-ref" },
      expected: true,
    },
    {
      name: "an omitted source refreshes because the range is worktree-backed",
      range: { from: "", to: "target-ref" },
      expected: true,
    },
  ])("$name", ({ range, expected }) => {
    expect(shouldAutoLoadForRoute({ screen: "diff", range })).toBe(expected);
  });

  test("auto-load skips history unless the worktree entry is selected", () => {
    expect(shouldAutoLoadForRoute({ screen: "diff", range })).toBe(true);
    expect(
      shouldAutoLoadForRoute({
        screen: "history",
        ref: "HEAD",
        range,
      }),
    ).toBe(false);
    expect(
      shouldAutoLoadForRoute(
        {
          screen: "history",
          ref: "HEAD",
          commit: "worktree",
          range,
        },
        { historyWorktreeSelected: true },
      ),
    ).toBe(true);
    expect(
      shouldAutoLoadForRoute({
        screen: "database",
        range,
      }),
    ).toBe(false);
    expect(
      shouldAutoLoadForRoute({
        screen: "help",
        lang: "en",
        section: "overview",
        range,
      }),
    ).toBe(false);
  });

  test.each([
    { name: "diff", route: { screen: "diff", range }, expected: "diff" },
    {
      name: "file detail",
      route: {
        screen: "file",
        path: "README.md",
        ref: "worktree",
        view: "detail",
        range,
      },
      expected: "diff",
    },
    {
      name: "Files view (repository tree)",
      route: { screen: "repo", ref: "worktree", path: "", range },
      expected: "files",
    },
    {
      name: "file blob",
      route: {
        screen: "file",
        path: "README.md",
        ref: "worktree",
        view: "blob",
        range,
      },
      expected: "files",
    },
    {
      name: "history without the worktree selected",
      route: { screen: "history", ref: "HEAD", range },
      expected: null,
    },
    {
      name: "history with the worktree selected",
      route: { screen: "history", ref: "HEAD", commit: "worktree", range },
      options: { historyWorktreeSelected: true },
      expected: "diff",
    },
    {
      name: "database",
      route: { screen: "database", range },
      expected: null,
    },
  ] as const)(
    "catches up $name with $expected",
    ({
      route,
      options,
      expected,
    }: {
      route: AppRoute;
      options?: { historyWorktreeSelected?: boolean };
      expected: "diff" | "files" | null;
    }) => {
      expect(catchUpKind(route, options)).toBe(expected);
    },
  );

  // ファイル一覧はどの画面にも出ているので、どの画面でも自動更新に従う。
  // フォルダ表示のときだけ合わせていた間は、ファイルを開いている間に足した
  // ファイルが一覧に出なかった (2 行目)。
  const blob: AppRoute = {
    screen: "file",
    path: "README.md",
    ref: "worktree",
    view: "blob",
    range,
  };
  test.each([
    {
      name: "the viewed file changed",
      route: blob,
      autoUpdate: true,
      viewedFileUnchanged: false,
      expected: { fileList: true, body: "load" },
    },
    {
      name: "another file was added while a file is open",
      route: blob,
      autoUpdate: true,
      viewedFileUnchanged: true,
      expected: { fileList: true, body: null },
    },
    {
      name: "diff of the worktree",
      route: { screen: "diff", range },
      autoUpdate: true,
      viewedFileUnchanged: false,
      expected: { fileList: true, body: "load" },
    },
    {
      name: "database",
      route: { screen: "database", range },
      autoUpdate: true,
      viewedFileUnchanged: false,
      expected: { fileList: true, body: null },
    },
    {
      name: "auto update off: the viewed file changed",
      route: blob,
      autoUpdate: false,
      viewedFileUnchanged: false,
      expected: { fileList: false, body: "banner" },
    },
    {
      name: "auto update off: another file was added while a file is open",
      route: blob,
      autoUpdate: false,
      viewedFileUnchanged: true,
      expected: { fileList: false, body: null },
    },
    {
      name: "auto update off: diff of the worktree",
      route: { screen: "diff", range },
      autoUpdate: false,
      viewedFileUnchanged: false,
      expected: { fileList: false, body: "banner" },
    },
  ] as const)(
    "file change notice, $name",
    ({
      route,
      autoUpdate,
      viewedFileUnchanged,
      expected,
    }: {
      route: AppRoute;
      autoUpdate: boolean;
      viewedFileUnchanged: boolean;
      expected: ReturnType<typeof sseUpdatePlan>;
    }) => {
      expect(sseUpdatePlan(route, { autoUpdate, viewedFileUnchanged })).toEqual(
        expected,
      );
    },
  );

  test("deduplicates catch-up fetches within the interval", () => {
    let now = 1000;
    const shouldRun = createCatchUpGate(() => now, 1000);

    expect(shouldRun("visible")).toBe(true);
    now = 1500;
    expect(shouldRun("visible")).toBe(false);
    now = 2000;
    expect(shouldRun("visible")).toBe(true);
  });

  // 繋ぎ直しは「切れていた間の変更」を取り直す唯一の機会なので、間引きに
  // 落とすと古い表示が次の変更まで残る。
  test.each([
    {
      name: "a reconnect within the interval still runs",
      steps: [
        { at: 1000, reason: "visible" as const, expected: true },
        { at: 1500, reason: "reconnect" as const, expected: true },
      ],
    },
    {
      name: "two reconnects in a row both run",
      steps: [
        { at: 1000, reason: "reconnect" as const, expected: true },
        { at: 1001, reason: "reconnect" as const, expected: true },
      ],
    },
    {
      name: "a reconnect still holds back the next visibility catch-up",
      steps: [
        { at: 1000, reason: "reconnect" as const, expected: true },
        { at: 1500, reason: "visible" as const, expected: false },
        { at: 2000, reason: "visible" as const, expected: true },
      ],
    },
  ])("$name", ({ steps }) => {
    let now = 0;
    const shouldRun = createCatchUpGate(() => now, 1000);
    for (const step of steps) {
      now = step.at;
      expect(shouldRun(step.reason)).toBe(step.expected);
    }
  });
});
