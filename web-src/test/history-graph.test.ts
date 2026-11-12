import "./_dom";
import { render } from "lit/html.js";
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

/** 要素の形 (名前・属性・子)。属性は並びを問わない。lit が残す印 (コメント) は数えない。 */
type Shape = { tag: string; attrs: string[][]; children: Shape[] };
function shape(el: Element): Shape {
  return {
    tag: el.tagName.toLowerCase(),
    attrs: [...el.attributes]
      .map((attr) => [attr.name, attr.value])
      .sort(([a = ""], [b = ""]) => a.localeCompare(b)),
    children: [...el.children].map(shape),
  };
}

/** テンプレートを描いた svg と、前の版が返していた文字列の svg の形。 */
function drawnAndBefore(template: unknown, before: string): [Shape, Shape] {
  const drawn = document.createElement("div");
  render(template, drawn);
  const parsed = document.createElement("div");
  parsed.innerHTML = before;
  const [a, b] = [drawn.querySelector("svg"), parsed.querySelector("svg")];
  if (!a || !b) throw new Error("history graph: no svg was drawn");
  return [shape(a), shape(b)];
}

describe("history graph svg", () => {
  test("a merge row draws the node, the line below and the diagonal to the new lane", () => {
    const [drawn, before] = drawnAndBefore(
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
      '<svg class="history-graph" width="24" aria-hidden="true">' +
        '<line class="history-graph-main" x1="6" y1="50%" x2="6" y2="100%"/>' +
        '<line class="history-graph-branch" x1="6" y1="50%" x2="18" y2="100%"/>' +
        '<circle class="history-graph-main history-graph-node" cx="6" cy="50%" r="3"/>' +
        "</svg>",
    );
    expect(drawn).toEqual(before);
  });

  test("a header row only passes lanes through", () => {
    const [drawn, before] = drawnAndBefore(
      historyGraphPassSvg([0, 1], 2),
      '<svg class="history-graph" width="24" aria-hidden="true">' +
        '<line class="history-graph-main" x1="6" y1="0" x2="6" y2="100%"/>' +
        '<line class="history-graph-branch" x1="18" y1="0" x2="18" y2="100%"/>' +
        "</svg>",
    );
    expect(drawn).toEqual(before);
  });

  test("draws the lines in the SVG namespace", () => {
    const drawn = document.createElement("div");
    render(historyGraphPassSvg([0], 1), drawn);
    expect(drawn.querySelector("line")?.namespaceURI).toBe(
      "http://www.w3.org/2000/svg",
    );
  });
});
