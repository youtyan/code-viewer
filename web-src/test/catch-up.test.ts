import { describe, expect, test } from "vitest";
import {
  createCatchUpGate,
  shouldAutoLoadForRoute,
  shouldCatchUpDiff,
} from "../core/catch-up";

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

  test("runs for diff, file detail, and selected history worktree routes only", () => {
    expect(shouldCatchUpDiff({ screen: "diff", range })).toBe(true);
    expect(
      shouldCatchUpDiff({
        screen: "file",
        path: "README.md",
        ref: "worktree",
        view: "detail",
        range,
      }),
    ).toBe(true);
    expect(
      shouldCatchUpDiff({ screen: "repo", ref: "worktree", path: "", range }),
    ).toBe(false);
    expect(
      shouldCatchUpDiff({
        screen: "file",
        path: "README.md",
        ref: "worktree",
        view: "blob",
        range,
      }),
    ).toBe(false);
    expect(
      shouldCatchUpDiff({
        screen: "history",
        ref: "HEAD",
        range,
      }),
    ).toBe(false);
    expect(
      shouldCatchUpDiff(
        {
          screen: "history",
          ref: "HEAD",
          commit: "worktree",
          range,
        },
        { historyWorktreeSelected: true },
      ),
    ).toBe(true);
  });

  test("deduplicates catch-up fetches within the interval", () => {
    let now = 1000;
    const shouldRun = createCatchUpGate(() => now, 1000);

    expect(shouldRun()).toBe(true);
    now = 1500;
    expect(shouldRun()).toBe(false);
    now = 2000;
    expect(shouldRun()).toBe(true);
  });
});
