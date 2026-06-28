import { describe, expect, test } from "bun:test";
import type { DbColumn } from "../core/database/types";
import { buildMutationStatements } from "../server/database/mutate";
import { coerceDbValue } from "../server/database/serialize";
import {
  buildDeleteSql,
  buildInsertSql,
  buildUpdateSql,
} from "../server/database/sql-utils";

// プロジェクトの bun:test 型は toThrow を持たないため、投げられたメッセージを
// 取り出して toMatch で検証する小さなヘルパー。
function captureError(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("expected function to throw, but it did not");
}

describe("coerceDbValue", () => {
  test("null stays null", () => {
    expect(coerceDbValue(null, "INTEGER")).toBeNull();
    expect(coerceDbValue(null, "TEXT")).toBeNull();
  });

  test("numeric columns coerce only on lossless round-trip", () => {
    expect(coerceDbValue("123", "INTEGER")).toBe(123);
    expect(coerceDbValue("1.5", "real")).toBe(1.5);
    // 先頭ゼロや指数表記は元の表現を保つため文字列のまま。
    expect(coerceDbValue("0123", "bigint")).toBe("0123");
    expect(coerceDbValue("1e3", "numeric")).toBe("1e3");
    // 非数値はそのまま (DB 側の判断に委ねる)。
    expect(coerceDbValue("abc", "integer")).toBe("abc");
    expect(coerceDbValue("", "integer")).toBe("");
  });

  test("boolean columns normalize to 0/1", () => {
    expect(coerceDbValue("true", "boolean")).toBe(1);
    expect(coerceDbValue("f", "bool")).toBe(0);
    expect(coerceDbValue("1", "boolean")).toBe(1);
    expect(coerceDbValue("maybe", "boolean")).toBe("maybe");
  });

  test("text columns are left as-is", () => {
    expect(coerceDbValue("hello", "TEXT")).toBe("hello");
    expect(coerceDbValue("123", "varchar")).toBe("123");
  });
});

const types = new Map<string, string>([
  ["id", "INTEGER"],
  ["name", "TEXT"],
  ["active", "boolean"],
]);

describe("buildInsertSql", () => {
  test("sqlite uses parameter placeholders with coerced params", () => {
    const r = buildInsertSql(
      "users",
      [
        { column: "id", value: "7" },
        { column: "name", value: "Ann" },
        { column: "active", value: "true" },
      ],
      types,
      "sqlite",
    );
    expect(r.sql).toBe(
      'INSERT INTO "users" ("id", "name", "active") VALUES (?, ?, ?)',
    );
    expect(r.params).toEqual([7, "Ann", 1]);
  });

  test("mysql inlines escaped literals (no params)", () => {
    const r = buildInsertSql(
      "users",
      [
        { column: "id", value: "7" },
        { column: "name", value: "O'Brien" },
      ],
      types,
      "mysql",
    );
    expect(r.sql).toBe(
      "INSERT INTO `users` (`id`, `name`) VALUES (7, 'O''Brien')",
    );
    expect(r.params).toEqual([]);
  });

  test("null renders as SQL NULL in literal mode", () => {
    const r = buildInsertSql(
      "users",
      [{ column: "name", value: null }],
      types,
      "postgresql",
    );
    expect(r.sql).toBe('INSERT INTO "users" ("name") VALUES (NULL)');
  });
});

describe("buildUpdateSql", () => {
  test("sqlite builds SET and WHERE with params", () => {
    const r = buildUpdateSql(
      "users",
      [{ column: "name", value: "Bob" }],
      [{ column: "id", value: "3" }],
      types,
      "sqlite",
    );
    expect(r.sql).toBe('UPDATE "users" SET "name" = ? WHERE "id" = ?');
    expect(r.params).toEqual(["Bob", 3]);
  });

  test("postgresql inlines literals", () => {
    const r = buildUpdateSql(
      "users",
      [{ column: "name", value: "Bo'b" }],
      [{ column: "id", value: "3" }],
      types,
      "postgresql",
    );
    expect(r.sql).toBe(`UPDATE "users" SET "name" = 'Bo''b' WHERE "id" = 3`);
  });
});

describe("buildDeleteSql", () => {
  test("sqlite builds WHERE with params", () => {
    const r = buildDeleteSql(
      "users",
      [{ column: "id", value: "3" }],
      types,
      "sqlite",
    );
    expect(r.sql).toBe('DELETE FROM "users" WHERE "id" = ?');
    expect(r.params).toEqual([3]);
  });
});

const columns: DbColumn[] = [
  {
    name: "id",
    type: "INTEGER",
    nullable: false,
    primaryKey: true,
    defaultValue: null,
  },
  {
    name: "name",
    type: "TEXT",
    nullable: true,
    primaryKey: false,
    defaultValue: null,
  },
];

describe("buildMutationStatements validation", () => {
  test("rejects unknown columns", () => {
    expect(
      captureError(() =>
        buildMutationStatements(
          "users",
          [{ kind: "insert", values: [{ column: "ghost", value: "x" }] }],
          columns,
          "sqlite",
        ),
      ),
    ).toMatch(/unknown column/);
  });

  test("rejects update with missing primary key", () => {
    expect(
      captureError(() =>
        buildMutationStatements(
          "users",
          [
            {
              kind: "update",
              pk: [],
              values: [{ column: "name", value: "x" }],
            },
          ],
          columns,
          "sqlite",
        ),
      ),
    ).toMatch(/primary key/);
  });

  test("rejects non-pk column used as pk condition", () => {
    expect(
      captureError(() =>
        buildMutationStatements(
          "users",
          [{ kind: "delete", pk: [{ column: "name", value: "x" }] }],
          columns,
          "sqlite",
        ),
      ),
    ).toMatch(/primary key/);
  });

  test("rejects update/delete on a table without a primary key", () => {
    const noPk: DbColumn[] = [
      {
        name: "a",
        type: "TEXT",
        nullable: true,
        primaryKey: false,
        defaultValue: null,
      },
    ];
    expect(
      captureError(() =>
        buildMutationStatements(
          "t",
          [{ kind: "delete", pk: [{ column: "a", value: "x" }] }],
          noPk,
          "sqlite",
        ),
      ),
    ).toMatch(/no primary key/);
  });

  test("builds a valid insert + update + delete batch", () => {
    const stmts = buildMutationStatements(
      "users",
      [
        { kind: "insert", values: [{ column: "name", value: "New" }] },
        {
          kind: "update",
          pk: [{ column: "id", value: "1" }],
          values: [{ column: "name", value: "Edited" }],
        },
        { kind: "delete", pk: [{ column: "id", value: "2" }] },
      ],
      columns,
      "sqlite",
    );
    expect(stmts).toHaveLength(3);
    expect(stmts[0].sql).toMatch("INSERT INTO");
    expect(stmts[1].sql).toMatch("UPDATE");
    expect(stmts[2].sql).toMatch("DELETE FROM");
  });

  test("rejects an empty mutation list", () => {
    expect(
      captureError(() =>
        buildMutationStatements("users", [], columns, "sqlite"),
      ),
    ).toMatch(/no mutations/);
  });
});
