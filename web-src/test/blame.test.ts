import { describe, expect, test } from "bun:test";
import {
  BLAME_ZERO_SHA,
  type BlameCommit,
  blameRelativeTime,
  blameShortSha,
  blameTimeBins,
  groupBlameLines,
} from "../core/blame";

function commit(
  sha: string,
  t: number,
  opts: Partial<BlameCommit> = {},
): BlameCommit {
  return {
    sha,
    author: opts.author ?? "alice",
    authorMail: opts.authorMail ?? "alice@example.com",
    authorTime: t,
    summary: opts.summary ?? `commit ${sha.slice(0, 6)}`,
    isUncommitted: opts.isUncommitted ?? sha === BLAME_ZERO_SHA,
  };
}

describe("groupBlameLines", () => {
  test("collapses contiguous lines that share a sha", () => {
    const groups = groupBlameLines(
      [
        { lineNo: 1, sha: "aaa", isUncommitted: false },
        { lineNo: 2, sha: "aaa", isUncommitted: false },
        { lineNo: 3, sha: "bbb", isUncommitted: false },
        { lineNo: 4, sha: "aaa", isUncommitted: false },
        { lineNo: 5, sha: "aaa", isUncommitted: false },
      ],
      { aaa: commit("aaa", 100), bbb: commit("bbb", 200) },
    );
    expect(groups.map((g) => [g.sha, g.startLine, g.endLine])).toEqual([
      ["aaa", 1, 2],
      ["bbb", 3, 3],
      ["aaa", 4, 5],
    ]);
  });

  test("skips lines whose commit metadata is missing", () => {
    const groups = groupBlameLines(
      [
        { lineNo: 1, sha: "aaa", isUncommitted: false },
        { lineNo: 2, sha: "ghost", isUncommitted: false },
        { lineNo: 3, sha: "aaa", isUncommitted: false },
      ],
      { aaa: commit("aaa", 100) },
    );
    expect(groups).toHaveLength(2);
    expect(groups[0].endLine).toBe(1);
    expect(groups[1].startLine).toBe(3);
  });
});

describe("blameTimeBins", () => {
  test("maps oldest commit to bin 0 and newest to the last bin", () => {
    const bins = blameTimeBins(
      {
        a: commit("a", 100),
        b: commit("b", 200),
        c: commit("c", 300),
        d: commit("d", 400),
        e: commit("e", 500),
      },
      5,
    );
    expect(bins.a).toBe(0);
    expect(bins.e).toBe(4);
    expect(bins.c).toBe(2);
  });

  test("uncommitted commits land in the newest bin", () => {
    const bins = blameTimeBins(
      {
        a: commit("a", 100),
        b: commit("b", 200),
        [BLAME_ZERO_SHA]: commit(BLAME_ZERO_SHA, 0, { isUncommitted: true }),
      },
      5,
    );
    expect(bins[BLAME_ZERO_SHA]).toBe(4);
  });

  test("when all commits share a timestamp, everything lands in the newest bin", () => {
    const bins = blameTimeBins(
      {
        a: commit("a", 100),
        b: commit("b", 100),
      },
      5,
    );
    expect(bins.a).toBe(4);
    expect(bins.b).toBe(4);
  });
});

describe("blameRelativeTime", () => {
  test("renders human-readable durations", () => {
    // Pick a "now" comfortably past the largest delta we test (~400 days).
    const now = 60 * 60 * 24 * 365 * 100;
    expect(blameRelativeTime(now - 10, now * 1000)).toBe("just now");
    expect(blameRelativeTime(now - 60 * 5, now * 1000)).toBe("5m ago");
    expect(blameRelativeTime(now - 60 * 60 * 3, now * 1000)).toBe("3h ago");
    expect(blameRelativeTime(now - 60 * 60 * 24, now * 1000)).toBe("yesterday");
    expect(blameRelativeTime(now - 60 * 60 * 24 * 3, now * 1000)).toBe(
      "3 days ago",
    );
    expect(blameRelativeTime(now - 60 * 60 * 24 * 30, now * 1000)).toBe(
      "last month",
    );
    expect(blameRelativeTime(now - 60 * 60 * 24 * 60, now * 1000)).toBe(
      "2 months ago",
    );
    expect(blameRelativeTime(now - 60 * 60 * 24 * 400, now * 1000)).toBe(
      "last year",
    );
  });

  test("returns empty when authorTime is missing", () => {
    expect(blameRelativeTime(0)).toBe("");
  });
});

describe("blameShortSha", () => {
  test("returns the first 7 chars for normal shas", () => {
    expect(blameShortSha("0123456789abcdef")).toBe("0123456");
  });

  test("returns 0000000 for the zero sha", () => {
    expect(blameShortSha(BLAME_ZERO_SHA)).toBe("0000000");
  });
});
