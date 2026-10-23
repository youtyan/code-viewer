import { describe, expect, test } from "vitest";
import {
  type ErLayout,
  type ErLayoutEdge,
  type ErLayoutNode,
  erEdgeShape,
  layoutErDiagram,
} from "../core/database/er-layout";

const GAP = { column: 10, row: 5, group: 20 };
// 列を折り返さない比 (どの塊も十分に横長な場所に収まる)。
const WIDE = 100;

function box(id: string, width = 100, height = 50): ErLayoutNode {
  return { id, width, height };
}

function at(layout: ErLayout, id: string): { x: number; y: number } {
  const position = layout.positions.get(id);
  if (!position) throw new Error(`no position for ${id}`);
  return position;
}

describe("layoutErDiagram", () => {
  test("places a referenced table one column gap left of the table that references it", () => {
    const layout = layoutErDiagram(
      [box("sample_child"), box("sample_parent")],
      [{ from: "sample_child", to: "sample_parent" }],
      GAP,
      WIDE,
    );

    expect(Object.fromEntries(layout.positions)).toEqual({
      sample_parent: { x: 0, y: 0 },
      sample_child: { x: 110, y: 0 },
    });
    expect({ width: layout.width, height: layout.height }).toEqual({
      width: 210,
      height: 50,
    });
  });

  test.each<{
    name: string;
    edges: ErLayoutEdge[];
    nodes: string[];
    leftOf: Array<[string, string]>;
  }>([
    {
      name: "a chain goes left to right from the most referenced table",
      nodes: ["c", "b", "a"],
      edges: [
        { from: "c", to: "b" },
        { from: "b", to: "a" },
      ],
      leftOf: [
        ["a", "b"],
        ["b", "c"],
      ],
    },
    {
      name: "a table referenced by two tables sits left of both",
      nodes: ["left", "right", "hub"],
      edges: [
        { from: "left", to: "hub" },
        { from: "right", to: "hub" },
      ],
      leftOf: [
        ["hub", "left"],
        ["hub", "right"],
      ],
    },
    {
      name: "a lookup referenced only from deep in a chain moves next to that table",
      nodes: ["root", "mid", "leaf", "lookup"],
      edges: [
        { from: "mid", to: "root" },
        { from: "leaf", to: "mid" },
        { from: "leaf", to: "lookup" },
      ],
      leftOf: [
        ["root", "mid"],
        ["mid", "leaf"],
        ["root", "lookup"],
        ["lookup", "leaf"],
      ],
    },
  ])("$name", ({ nodes, edges, leftOf }) => {
    const layout = layoutErDiagram(
      nodes.map((id) => box(id)),
      edges,
      GAP,
      WIDE,
    );

    for (const [parent, child] of leftOf) {
      expect(at(layout, parent).x + 100).toBeLessThanOrEqual(
        at(layout, child).x,
      );
    }
  });

  test("tables without relations go below the related ones", () => {
    const layout = layoutErDiagram(
      [box("sample_lone", 100, 30), box("sample_child"), box("sample_parent")],
      [{ from: "sample_child", to: "sample_parent" }],
      GAP,
      WIDE,
    );

    expect(at(layout, "sample_lone")).toEqual({ x: 0, y: 70 });
  });

  test.each<{ name: string; edges: ErLayoutEdge[] }>([
    {
      name: "a cycle of foreign keys",
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
      ],
    },
    { name: "a table referencing itself", edges: [{ from: "a", to: "a" }] },
    {
      name: "an edge to a table that is not drawn",
      edges: [{ from: "a", to: "sample_missing" }],
    },
  ])("places every table once with $name", ({ edges }) => {
    const layout = layoutErDiagram(
      [box("a"), box("b"), box("c")],
      edges,
      GAP,
      WIDE,
    );

    expect([...layout.positions.keys()].sort()).toEqual(["a", "b", "c"]);
  });

  test("a long chain folds into rows when the view is not wide", () => {
    const nodes = ["t0", "t1", "t2", "t3", "t4", "t5"].map((id) => box(id));
    const edges = [
      { from: "t1", to: "t0" },
      { from: "t2", to: "t1" },
      { from: "t3", to: "t2" },
      { from: "t4", to: "t3" },
      { from: "t5", to: "t4" },
    ];

    const wide = layoutErDiagram(nodes, edges, GAP, WIDE);
    const square = layoutErDiagram(nodes, edges, GAP, 1);

    expect({ width: wide.width, height: wide.height }).toEqual({
      width: 650,
      height: 50,
    });
    expect({ width: square.width, height: square.height }).toEqual({
      width: 210,
      height: 190,
    });
  });

  test("returns the same layout for the same input", () => {
    const nodes = ["a", "b", "c", "d"].map((id) => box(id));
    const edges = [
      { from: "b", to: "a" },
      { from: "c", to: "a" },
      { from: "d", to: "b" },
    ];

    expect(layoutErDiagram(nodes, edges, GAP, 1.6)).toEqual(
      layoutErDiagram(nodes, edges, GAP, 1.6),
    );
  });

  test.each([
    { name: "duplicate table ids", nodes: [box("a"), box("a")], aspect: 1 },
    { name: "a zero aspect", nodes: [box("a")], aspect: 0 },
    { name: "a NaN aspect", nodes: [box("a")], aspect: Number.NaN },
  ])("rejects $name", ({ nodes, aspect }) => {
    expect(() => layoutErDiagram(nodes, [], GAP, aspect)).toThrow(
      /^ER layout: /,
    );
  });

  // 図の形は配置の工夫で変わるが、箱どうしが重ならないことは変わらない。
  test.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "boxes never overlap in generated schema %i",
    (seed) => {
      let state = seed;
      const random = () => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
      };
      const nodes = Array.from({ length: 30 }, (_, i) =>
        box(
          `t${i}`,
          80 + Math.floor(random() * 200),
          40 + Math.floor(random() * 200),
        ),
      );
      const edges = Array.from({ length: 35 }, () => ({
        from: `t${Math.floor(random() * 30)}`,
        to: `t${Math.floor(random() * 30)}`,
      }));

      const layout = layoutErDiagram(nodes, edges, GAP, 1.6);

      const rects = nodes.map((node) => ({ ...at(layout, node.id), node }));
      const overlaps = rects.flatMap((a, i) =>
        rects
          .slice(i + 1)
          .filter(
            (b) =>
              a.x < b.x + b.node.width &&
              b.x < a.x + a.node.width &&
              a.y < b.y + b.node.height &&
              b.y < a.y + a.node.height,
          )
          .map((b) => `${a.node.id}/${b.node.id}`),
      );
      expect(overlaps).toEqual([]);
      for (const rect of rects) {
        expect(rect.x + rect.node.width).toBeLessThanOrEqual(layout.width);
        expect(rect.y + rect.node.height).toBeLessThanOrEqual(layout.height);
      }
    },
  );
});

describe("erEdgeShape", () => {
  const LEFT = { x: 0, y: 0, width: 100, height: 50 };
  const RIGHT = { x: 200, y: 0, width: 100, height: 50 };
  const BELOW = { x: 20, y: 100, width: 100, height: 50 };

  test("draws a crow's foot at the referencing table and two bars at the referenced one", () => {
    expect(
      erEdgeShape(RIGHT, 25, LEFT, 25, { unique: false, nullable: false }),
    ).toEqual({
      line: "M 200 25 L 180 25 C 148 25 152 25 120 25 L 100 25",
      marks:
        "M 188 25 L 200 19 M 188 25 L 200 31 M 106 19 L 106 31 M 115 19 L 115 31",
      dots: "M 181.5 25 a 3.5 3.5 0 1 0 7 0 a 3.5 3.5 0 1 0 -7 0",
    });
  });

  test.each([
    {
      name: "many and required",
      ends: { unique: false, nullable: false },
      marks:
        "M 188 25 L 200 19 M 188 25 L 200 31 M 106 19 L 106 31 M 115 19 L 115 31",
      dots: "M 181.5 25 a 3.5 3.5 0 1 0 7 0 a 3.5 3.5 0 1 0 -7 0",
    },
    {
      name: "many and nullable",
      ends: { unique: false, nullable: true },
      marks: "M 188 25 L 200 19 M 188 25 L 200 31 M 106 19 L 106 31",
      dots: "M 181.5 25 a 3.5 3.5 0 1 0 7 0 a 3.5 3.5 0 1 0 -7 0 M 111.5 25 a 3.5 3.5 0 1 0 7 0 a 3.5 3.5 0 1 0 -7 0",
    },
    {
      name: "one and required",
      ends: { unique: true, nullable: false },
      marks: "M 194 19 L 194 31 M 106 19 L 106 31 M 115 19 L 115 31",
      dots: "M 181.5 25 a 3.5 3.5 0 1 0 7 0 a 3.5 3.5 0 1 0 -7 0",
    },
    {
      name: "one and nullable",
      ends: { unique: true, nullable: true },
      marks: "M 194 19 L 194 31 M 106 19 L 106 31",
      dots: "M 181.5 25 a 3.5 3.5 0 1 0 7 0 a 3.5 3.5 0 1 0 -7 0 M 111.5 25 a 3.5 3.5 0 1 0 7 0 a 3.5 3.5 0 1 0 -7 0",
    },
  ])("end marks for $name", ({ ends, marks, dots }) => {
    const shape = erEdgeShape(RIGHT, 25, LEFT, 25, ends);

    expect({ marks: shape.marks, dots: shape.dots }).toEqual({ marks, dots });
  });

  test.each([
    {
      name: "referenced table on the right: leaves from the right edge into its left edge",
      from: LEFT,
      to: RIGHT,
      start: "M 100 25",
      end: "L 200 25",
    },
    {
      name: "referenced table on the left: leaves from the left edge into its right edge",
      from: RIGHT,
      to: LEFT,
      start: "M 200 25",
      end: "L 100 25",
    },
    {
      name: "tables stacked in one column: both ends on the right edges",
      from: BELOW,
      to: LEFT,
      start: "M 120 25",
      end: "L 100 25",
    },
    {
      name: "a table referencing itself: both ends on its right edge",
      from: LEFT,
      to: LEFT,
      start: "M 100 25",
      end: "L 100 25",
    },
  ])("$name", ({ from, to, start, end }) => {
    const { line } = erEdgeShape(from, 25, to, 25, {
      unique: false,
      nullable: false,
    });

    expect({
      start: line.slice(0, start.length),
      end: line.slice(-end.length),
    }).toEqual({
      start,
      end,
    });
  });
});
