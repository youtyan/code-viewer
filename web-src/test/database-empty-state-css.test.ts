import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const style = readFileSync("web/style.css", "utf8");

describe("database empty state CSS", () => {
  test("db-pane-empty honors hidden even though the base rule uses flex", () => {
    const start = style.indexOf(".db-pane-empty[hidden]");
    expect(start > -1).toBe(true);
    const block = style.slice(start, style.indexOf("}", start));
    expect(block.includes("display: none")).toBe(true);
  });
});
