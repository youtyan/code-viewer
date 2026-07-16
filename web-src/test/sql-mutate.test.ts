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
    // 空入力は NULL (数値列に "" を入れても意味を成さない)。
    expect(coerceDbValue("", "integer")).toBeNull();
  });

  test("boolean columns normalize to JS boolean", () => {
    // 数値 1/0 ではなく JS boolean を返す (PostgreSQL の boolean 列で
    // `= 1` にすると型エラーになるため)。
    expect(coerceDbValue("true", "boolean")).toBe(true);
    expect(coerceDbValue("f", "bool")).toBe(false);
    expect(coerceDbValue("1", "boolean")).toBe(true);
    expect(coerceDbValue("maybe", "boolean")).toBe("maybe");
    expect(coerceDbValue("", "boolean")).toBeNull();
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

  test("postgresql boolean columns render as TRUE/FALSE, not integers", () => {
    // 回帰防止: boolean 列を `= 1` にすると PostgreSQL が型エラーで弾く。
    const t = new Map<string, string>([["active", "boolean"]]);
    const on = buildInsertSql(
      "users",
      [{ column: "active", value: "true" }],
      t,
      "postgresql",
    );
    expect(on.sql).toBe('INSERT INTO "users" ("active") VALUES (TRUE)');
    const off = buildInsertSql(
      "users",
      [{ column: "active", value: "0" }],
      t,
      "postgresql",
    );
    expect(off.sql).toBe('INSERT INTO "users" ("active") VALUES (FALSE)');
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

describe("write SQL comparison clauses", () => {
  test.each([
    {
      name: "sqlite preserves SET then composite primary-key parameter order",
      set: [
        { column: "name", value: "updated" },
        { column: "active", value: "true" },
      ],
      pk: [
        { column: "id", value: "3" },
        { column: "region", value: "east" },
      ],
      kind: "sqlite" as const,
      expected: {
        sql: 'UPDATE "sample_table" SET "name" = ?, "active" = ? WHERE "id" = ? AND "region" = ?',
        params: ["updated", 1, 3, "east"],
      },
    },
    {
      name: "postgresql inlines quoted text and booleans",
      set: [
        { column: "name", value: "O'Brien" },
        { column: "active", value: "true" },
      ],
      pk: [{ column: "id", value: "4" }],
      kind: "postgresql" as const,
      expected: {
        sql: `UPDATE "sample_table" SET "name" = 'O''Brien', "active" = TRUE WHERE "id" = 4`,
        params: [],
      },
    },
    {
      name: "mysql escapes backslashes in a SET value",
      set: [{ column: "name", value: "x\\y" }],
      pk: [{ column: "id", value: "5" }],
      kind: "mysql" as const,
      expected: {
        sql: "UPDATE `sample_table` SET `name` = 'x\\\\y' WHERE `id` = 5",
        params: [],
      },
    },
  ])("buildUpdateSql $name", ({ set, pk, kind, expected }) => {
    expect(buildUpdateSql("sample_table", set, pk, types, kind)).toEqual(
      expected,
    );
  });

  test.each([
    {
      name: "sqlite binds composite primary keys in order",
      pk: [
        { column: "id", value: "4" },
        { column: "region", value: "east" },
      ],
      kind: "sqlite" as const,
      expected: {
        sql: 'DELETE FROM "sample_table" WHERE "id" = ? AND "region" = ?',
        params: [4, "east"],
      },
    },
    {
      name: "postgresql inlines a boolean primary-key value",
      pk: [{ column: "active", value: "0" }],
      kind: "postgresql" as const,
      expected: {
        sql: 'DELETE FROM "sample_table" WHERE "active" = FALSE',
        params: [],
      },
    },
    {
      name: "mysql escapes apostrophes in a primary-key value",
      pk: [{ column: "name", value: "O'Brien" }],
      kind: "mysql" as const,
      expected: {
        sql: "DELETE FROM `sample_table` WHERE `name` = 'O''Brien'",
        params: [],
      },
    },
  ])("buildDeleteSql $name", ({ pk, kind, expected }) => {
    expect(buildDeleteSql("sample_table", pk, types, kind)).toEqual(expected);
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
