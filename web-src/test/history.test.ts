import { describe, expect, test } from "bun:test";
import {
  commitDiffRange,
  EMPTY_TREE_SHA,
  HISTORY_AUTO_LOAD_MAX_PAGES,
  historyGroupLabel,
  shouldContinueAutoLoad,
} from "../core/history";

describe("commitDiffRange", () => {
  test("uses first parent as from", () => {
    expect(commitDiffRange({ sha: "abc", parents: ["p1", "p2"] })).toEqual({
      from: "p1",
      to: "abc",
    });
  });

  test("uses the empty tree for root commits", () => {
    expect(commitDiffRange({ sha: "abc", parents: [] })).toEqual({
      from: EMPTY_TREE_SHA,
      to: "abc",
    });
  });
});

describe("shouldContinueAutoLoad", () => {
  test("continues while target is missing and pages remain", () => {
    expect(
      shouldContinueAutoLoad({ pagesLoaded: 1, found: false, hasMore: true }),
    ).toBe(true);
  });
  test("stops once the target is found", () => {
    expect(
      shouldContinueAutoLoad({ pagesLoaded: 1, found: true, hasMore: true }),
    ).toBe(false);
  });
  test("stops when the server has no more commits", () => {
    expect(
      shouldContinueAutoLoad({ pagesLoaded: 1, found: false, hasMore: false }),
    ).toBe(false);
  });
  test("stops at the page cap", () => {
    expect(
      shouldContinueAutoLoad({
        pagesLoaded: HISTORY_AUTO_LOAD_MAX_PAGES,
        found: false,
        hasMore: true,
      }),
    ).toBe(false);
  });
});

describe("historyGroupLabel", () => {
  // Friday 2026-06-12 15:00 local time.
  const now = new Date(2026, 5, 12, 15, 0, 0);

  test("groups commits from the same day as Today", () => {
    expect(
      historyGroupLabel(new Date(2026, 5, 12, 0, 30).toISOString(), now),
    ).toBe("Today");
    expect(
      historyGroupLabel(new Date(2026, 5, 12, 23, 0).toISOString(), now),
    ).toBe("Today");
  });

  test("groups future timestamps (clock skew) as Today", () => {
    expect(
      historyGroupLabel(new Date(2026, 5, 13, 1, 0).toISOString(), now),
    ).toBe("Today");
  });

  test("groups the previous day as Yesterday", () => {
    expect(
      historyGroupLabel(new Date(2026, 5, 11, 23, 59).toISOString(), now),
    ).toBe("Yesterday");
    expect(
      historyGroupLabel(new Date(2026, 5, 11, 0, 0).toISOString(), now),
    ).toBe("Yesterday");
  });

  test("groups the last 7 days as This week", () => {
    expect(
      historyGroupLabel(new Date(2026, 5, 10, 12, 0).toISOString(), now),
    ).toBe("This week");
    expect(
      historyGroupLabel(new Date(2026, 5, 6, 0, 0).toISOString(), now),
    ).toBe("This week");
  });

  test("groups older commits in the same month as This month", () => {
    expect(
      historyGroupLabel(new Date(2026, 5, 1, 12, 0).toISOString(), now),
    ).toBe("This month");
  });

  test("groups older commits by month and year", () => {
    expect(historyGroupLabel(new Date(2026, 4, 20).toISOString(), now)).toBe(
      "May 2026",
    );
    expect(historyGroupLabel(new Date(2025, 11, 31).toISOString(), now)).toBe(
      "December 2025",
    );
  });

  test("falls back for unparsable dates", () => {
    expect(historyGroupLabel("not-a-date", now)).toBe("Unknown date");
  });
});
