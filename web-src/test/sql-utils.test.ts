import { describe, expect, test } from "vitest";
import {
  buildFilterWhere,
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
