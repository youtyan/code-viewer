import { describe, expect, test } from "bun:test";
import { inferRailsForeignKeys } from "../core/database/infer-fk";
import type {
  DbColumn,
  DbForeignKey,
  DbTableInfo,
} from "../core/database/types";

function col(name: string): DbColumn {
  return {
    name,
    type: "text",
    nullable: false,
    primaryKey: false,
    defaultValue: null,
  };
}

function tbl(name: string): DbTableInfo {
  return { name, type: "table", rowCount: 0 };
}

function summarize(
  fks: { fromTable: string; fromColumn: string; toTable: string }[],
) {
  return fks
    .map((fk) => `${fk.fromTable}.${fk.fromColumn}->${fk.toTable}`)
    .sort();
}

describe("inferRailsForeignKeys", () => {
  test("matches Rails singular: user_id -> user.id", () => {
    const inferred = inferRailsForeignKeys({
      tables: [tbl("user"), tbl("posts")],
      columnsMap: {
        user: [col("id"), col("email")],
        posts: [col("id"), col("user_id"), col("title")],
      },
      realForeignKeys: [],
    });
    expect(inferred).toEqual([
      {
        fromTable: "posts",
        fromColumn: "user_id",
        toTable: "user",
        toColumn: "id",
        inferred: "rails",
      },
    ]);
  });

  test("matches Rails plural with s: user_id -> users.id", () => {
    const inferred = inferRailsForeignKeys({
      tables: [tbl("users"), tbl("posts")],
      columnsMap: {
        users: [col("id")],
        posts: [col("id"), col("user_id")],
      },
      realForeignKeys: [],
    });
    expect(inferred).toEqual([
      {
        fromTable: "posts",
        fromColumn: "user_id",
        toTable: "users",
        toColumn: "id",
        inferred: "rails",
      },
    ]);
  });

  test("matches y to ies plural: agency_id -> agencies.id", () => {
    const inferred = inferRailsForeignKeys({
      tables: [tbl("agencies"), tbl("contracts")],
      columnsMap: {
        agencies: [col("id")],
        contracts: [col("id"), col("agency_id")],
      },
      realForeignKeys: [],
    });
    expect(inferred[0]?.toTable).toBe("agencies");
    expect(inferred[0]?.inferred).toBe("rails");
  });

  test("skips when target table has no id column", () => {
    const inferred = inferRailsForeignKeys({
      tables: [tbl("foo"), tbl("bar")],
      columnsMap: {
        foo: [col("foo_pk")],
        bar: [col("id"), col("foo_id")],
      },
      realForeignKeys: [],
    });
    expect(inferred).toEqual([]);
  });

  test("skips when target table does not exist", () => {
    const inferred = inferRailsForeignKeys({
      tables: [tbl("posts")],
      columnsMap: {
        posts: [col("id"), col("nonexistent_id")],
      },
      realForeignKeys: [],
    });
    expect(inferred).toEqual([]);
  });

  test("skips when a real FK already covers (fromTable, fromColumn)", () => {
    const real: DbForeignKey = {
      fromTable: "posts",
      fromColumn: "user_id",
      toTable: "users",
      toColumn: "id",
    };
    const inferred = inferRailsForeignKeys({
      tables: [tbl("users"), tbl("posts")],
      columnsMap: {
        users: [col("id")],
        posts: [col("id"), col("user_id")],
      },
      realForeignKeys: [real],
    });
    expect(inferred).toEqual([]);
  });

  test("ignores literal _id column with empty prefix", () => {
    const inferred = inferRailsForeignKeys({
      tables: [tbl("strange")],
      columnsMap: {
        strange: [col("_id")],
      },
      realForeignKeys: [],
    });
    expect(inferred).toEqual([]);
  });

  test("prefers exact prefix match over pluralized form", () => {
    const inferred = inferRailsForeignKeys({
      tables: [tbl("user"), tbl("users"), tbl("posts")],
      columnsMap: {
        user: [col("id")],
        users: [col("id")],
        posts: [col("id"), col("user_id")],
      },
      realForeignKeys: [],
    });
    expect(inferred[0]?.toTable).toBe("user");
  });

  test("emits multiple inferred FKs across tables", () => {
    const inferred = inferRailsForeignKeys({
      tables: [tbl("user"), tbl("posts"), tbl("comments")],
      columnsMap: {
        user: [col("id")],
        posts: [col("id"), col("user_id")],
        comments: [col("id"), col("user_id"), col("post_id")],
      },
      realForeignKeys: [],
    });
    expect(summarize(inferred)).toEqual([
      "comments.post_id->posts",
      "comments.user_id->user",
      "posts.user_id->user",
    ]);
  });
});
