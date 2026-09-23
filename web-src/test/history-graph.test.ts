import { describe, expect, test } from "vitest";
import {
  buildHistoryGraph,
  historyGraphPassSvg,
  historyGraphSvg,
  passingLanes,
} from "../views/history-graph";

const c = (sha: string, ...parents: string[]) => ({ sha, parents });

describe("buildHistoryGraph", () => {
  test.each([
    {
      name: "a straight line keeps every commit on lane 0",
      commits: [c("c", "b"), c("b", "a"), c("a")],
      linear: false,
      lanes: 1,
      rows: [
        {
          lane: 0,
          through: [],
          fromAbove: false,
          toBelow: true,
          mergeFrom: [],
          branchTo: [],
        },
        {
          lane: 0,
          through: [],
          fromAbove: true,
          toBelow: true,
          mergeFrom: [],
          branchTo: [],
        },
        {
          lane: 0,
          through: [],
          fromAbove: true,
          toBelow: false,
          mergeFrom: [],
          branchTo: [],
        },
      ],
    },
    {
      name: "a merge opens a second lane that joins back at the fork point",
      commits: [
        c("m", "main2", "side2"),
        c("main2", "base"),
        c("side2", "side1"),
        c("side1", "base"),
        c("base"),
      ],
      linear: false,
      lanes: 2,
      rows: [
        {
          lane: 0,
          through: [],
          fromAbove: false,
          toBelow: true,
          mergeFrom: [],
          branchTo: [1],
        },
        {
          lane: 0,
          through: [1],
          fromAbove: true,
          toBelow: true,
          mergeFrom: [],
          branchTo: [],
        },
        {
          lane: 1,
          through: [0],
          fromAbove: true,
          toBelow: true,
          mergeFrom: [],
          branchTo: [],
        },
        {
          lane: 1,
          through: [0],
          fromAbove: true,
          toBelow: true,
          mergeFrom: [],
          branchTo: [],
        },
        {
          lane: 0,
          through: [],
          fromAbove: true,
          toBelow: false,
          mergeFrom: [1],
          branchTo: [],
        },
      ],
    },
    {
      name: "a parent listed above its child (same timestamp) does not keep a lane open",
      commits: [c("parent"), c("child", "parent")],
      linear: false,
      lanes: 1,
      rows: [
        {
          lane: 0,
          through: [],
          fromAbove: false,
          toBelow: false,
          mergeFrom: [],
          branchTo: [],
        },
        {
          lane: 0,
          through: [],
          fromAbove: false,
          toBelow: false,
          mergeFrom: [],
          branchTo: [],
        },
      ],
    },
    {
      name: "linear mode joins filtered rows top to bottom and ignores real parents",
      commits: [c("x", "p1", "p2"), c("y", "p3"), c("z")],
      linear: true,
      lanes: 1,
      rows: [
        {
          lane: 0,
          through: [],
          fromAbove: false,
          toBelow: true,
          mergeFrom: [],
          branchTo: [],
        },
        {
          lane: 0,
          through: [],
          fromAbove: true,
          toBelow: true,
          mergeFrom: [],
          branchTo: [],
        },
        {
          lane: 0,
          through: [],
          fromAbove: true,
          toBelow: false,
          mergeFrom: [],
          branchTo: [],
        },
      ],
    },
    {
      name: "an empty list still reserves one lane",
      commits: [],
      linear: false,
      lanes: 1,
      rows: [],
    },
  ])("$name", ({ commits, linear, lanes, rows }) => {
    expect(buildHistoryGraph(commits, { linear })).toEqual({ rows, lanes });
  });
});

describe("passingLanes", () => {
  test.each([
    { name: "no next row", row: undefined, expected: [] },
    {
      name: "the next row's node lane, lanes merging into it and lanes passing it",
      row: {
        lane: 1,
        through: [2],
        fromAbove: true,
        toBelow: true,
        mergeFrom: [0],
        branchTo: [],
      },
      expected: [0, 1, 2],
    },
    {
      name: "a branch tip starts below the header",
      row: {
        lane: 0,
        through: [],
        fromAbove: false,
        toBelow: true,
        mergeFrom: [],
        branchTo: [],
      },
      expected: [],
    },
  ])("$name", ({ row, expected }) => {
    expect(passingLanes(row)).toEqual(expected);
  });
});

describe("history graph svg", () => {
  test("a merge row draws the node, the line below and the diagonal to the new lane", () => {
    expect(
      historyGraphSvg(
        {
          lane: 0,
          through: [],
          fromAbove: false,
          toBelow: true,
          mergeFrom: [],
          branchTo: [1],
        },
        2,
      ),
    ).toBe(
      '<svg class="history-graph" width="24" aria-hidden="true">' +
        '<line class="history-graph-main" x1="6" y1="50%" x2="6" y2="100%"/>' +
        '<line class="history-graph-branch" x1="6" y1="50%" x2="18" y2="100%"/>' +
        '<circle class="history-graph-main history-graph-node" cx="6" cy="50%" r="3"/>' +
        "</svg>",
    );
  });

  test("a header row only passes lanes through", () => {
    expect(historyGraphPassSvg([0, 1], 2)).toBe(
      '<svg class="history-graph" width="24" aria-hidden="true">' +
        '<line class="history-graph-main" x1="6" y1="0" x2="6" y2="100%"/>' +
        '<line class="history-graph-branch" x1="18" y1="0" x2="18" y2="100%"/>' +
        "</svg>",
    );
  });
});
