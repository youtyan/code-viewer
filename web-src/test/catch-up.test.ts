import { describe, expect, test } from "bun:test";
import { createCatchUpGate, shouldCatchUpDiff } from "../catch-up";

describe("diff catch-up policy", () => {
  const range = { from: "HEAD", to: "worktree" };

  test("runs for diff and file detail routes only", () => {
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
