import { describe, expect, test } from "bun:test";
import { sourceFixture } from "./source-fixture";

describe("sourceFixture", () => {
  test("keeps comparison and assignment operators distinct", () => {
    const fixture = sourceFixture("if (x === y) return true;");

    expect(fixture.includes("x = y")).toBe(false);
    expect(fixture.includes("x === y")).toBe(true);
  });

  test("keeps meaningful whitespace inside string literals", () => {
    const fixture = sourceFixture('const label = "a  b";');

    expect(fixture.includes('const label = "a b";')).toBe(false);
    expect(fixture.includes("const label = 'a  b';")).toBe(true);
  });

  test("keeps trailing-comma-like text inside string literals", () => {
    const fixture = sourceFixture('const label = "[a, b,]";');

    expect(fixture.includes('const label = "[a, b]";')).toBe(false);
    expect(fixture.includes("const label = '[a, b,]';")).toBe(true);
  });

  test("keeps arrow-like text inside string literals", () => {
    const fixture = sourceFixture('const label = "x  =>  y";');

    expect(fixture.includes('const label = "x => y";')).toBe(false);
    expect(fixture.includes("const label = 'x  =>  y';")).toBe(true);
  });

  test("keeps template literals distinct from plain string literals", () => {
    const fixture = sourceFixture("const label = `${name}`;");

    expect(fixture.includes("const label = '${name}';")).toBe(false);
    expect(fixture.includes("const label = `${name}`;")).toBe(true);
  });

  test("ignores Biome-added trailing commas in arrays, calls, and objects", () => {
    const fixture = sourceFixture("fn([a, b,], { a: b, }, c,);");

    expect(fixture.includes("fn([a, b], { a: b }, c);")).toBe(true);
  });

  test("tolerates Biome-added parens around single arrow arguments", () => {
    const fixture = sourceFixture("items.map((item) => item.id);");

    expect(fixture.includes("items.map(item => item.id);")).toBe(true);
  });

  test("keeps exact regex literal snippets available through raw matching", () => {
    const fixture = sourceFixture("if (text.match(/[\"']/)) return done();");

    expect(fixture.raw.match(/text\.match\(\/\["'\]\/\)/) === null).toBe(false);
  });
});
