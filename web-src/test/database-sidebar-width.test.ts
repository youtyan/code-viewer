// Data の左の列を掴んで動かしたときの幅は、列の左端からの距離で決まる
// (左にサイドバーがあっても跳ばない)。
import { describe, expect, test } from "vitest";
import { dbSidebarWidthAt } from "../views/database/database-view";

describe("database sidebar width while dragging", () => {
  test.each([
    { name: "at the page edge", clientX: 260, left: 0, expected: 260 },
    {
      name: "beside the app sidebars, 10px to the right of the edge",
      clientX: 790,
      left: 520,
      expected: 270,
    },
    {
      name: "narrower than the minimum",
      clientX: 560,
      left: 520,
      expected: 120,
    },
    { name: "wider than the maximum", clientX: 1270, left: 520, expected: 600 },
  ])("$name → $expected", ({ clientX, left, expected }) => {
    expect(dbSidebarWidthAt(clientX, left)).toBe(expected);
  });
});
