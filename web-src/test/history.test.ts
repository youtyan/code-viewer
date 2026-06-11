import { describe, expect, test } from "bun:test";
import {
  commitDiffRange,
  EMPTY_TREE_SHA,
  HISTORY_AUTO_LOAD_MAX_PAGES,
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
