import { describe, expect, test } from "vitest";
import {
  buildFilterWhere,
  buildOrderClause,
  escapeSqlString,
} from "../server/database/sql-utils";

describe("escapeSqlString", () => {
  test("doubles single quotes for every dialect", () => {
    expect(escapeSqlString("a'b")).toBe("'a''b'");
    expect(escapeSqlString("a'b", "postgresql")).toBe("'a''b'");
    expect(escapeSqlString("a'b", "mysql")).toBe("'a''b'");
  });

  test("escapes backslashes only for MySQL", () => {
    // default / postgres: backslash is a literal character (standard strings).
    expect(escapeSqlString("a\\b")).toBe("'a\\b'");
    expect(escapeSqlString("a\\b", "postgresql")).toBe("'a\\b'");
    // mysql: backslash must be doubled or it escapes the surrounding quote.
    expect(escapeSqlString("a\\b", "mysql")).toBe("'a\\\\b'");
  });

  test("a trailing backslash cannot break out of the MySQL literal", () => {
    // Without doubling this would render as 'x\' and escape the closing quote.
    expect(escapeSqlString("x\\", "mysql")).toBe("'x\\\\'");
  });
});

describe("buildFilterWhere exact (eq) conditions", () => {
  test("sqlite binds exact values as parameters", () => {
    const r = buildFilterWhere(new Map(), "sqlite", [
      { column: "c", value: "x" },
    ]);
    expect(r.useParams).toBe(true);
    expect(r.where).toBe('CAST("c" AS TEXT) = ?');
    expect(r.params).toEqual(["x"]);
  });

  test("mysql doubles backslashes in the inlined literal", () => {
    const r = buildFilterWhere(new Map(), "mysql", [
      { column: "c", value: "x\\" },
    ]);
    expect(r.useParams).toBe(false);
    expect(r.where).toBe("CAST(`c` AS CHAR) = 'x\\\\'");
  });

  test("postgres leaves backslashes untouched", () => {
    const r = buildFilterWhere(new Map(), "postgresql", [
      { column: "c", value: "x\\" },
    ]);
    expect(r.where).toBe("CAST(\"c\" AS TEXT) = 'x\\'");
  });
});

// NULL はどの方言でも最小の値として並べる (降順で NULL が先頭に来ると、
// updated_at の「新しい順」で時刻の無い行が先頭を埋めた)。
describe("buildOrderClause", () => {
  test.each([
    {
      name: "sqlite descending keeps the native NULL order",
      kind: "sqlite" as const,
      direction: "desc" as const,
      expected: ' ORDER BY "updated_at" DESC',
    },
    {
      name: "mysql descending keeps the native NULL order",
      kind: "mysql" as const,
      direction: "desc" as const,
      expected: " ORDER BY `updated_at` DESC",
    },
    {
      name: "postgresql descending puts NULL last",
      kind: "postgresql" as const,
      direction: "desc" as const,
      expected: ' ORDER BY "updated_at" DESC NULLS LAST',
    },
    {
      name: "postgresql ascending puts NULL first",
      kind: "postgresql" as const,
      direction: "asc" as const,
      expected: ' ORDER BY "updated_at" ASC NULLS FIRST',
    },
  ])("$name", ({ kind, direction, expected }) => {
    expect(buildOrderClause([{ column: "updated_at", direction }], kind)).toBe(
      expected,
    );
  });

  test("no order gives an empty clause", () => {
    expect(buildOrderClause([], "postgresql")).toBe("");
  });
});
