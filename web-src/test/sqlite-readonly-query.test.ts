// SQLite の読み取りクエリ (クエリの欄と実行計画) を、実ファイルの SQLite で
// 流して確かめる。直す前は EXPLAIN もサブクエリに包み、包めなければ末尾に
// LIMIT を足していたので、既定の表のクエリ (LIMIT と OFFSET 付き) の実行計画が
// 必ず構文エラーになり、しかも 1 つ目の形の理由だけを返して 2 つ目を捨てていた。

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import type { DbQueryResponse } from "../core/database/types";
import { sqliteAdapterFactory } from "../server/database/adapters/sqlite";
import { handleDatabaseRoute } from "../server/database/handle";
import { captureErrorAsync } from "./_test-helpers";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function seedSampleDb(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "code-viewer-sqlite-readonly-"));
  tempDirs.push(dir);
  const file = join(dir, "sample.db");
  const sqlite = new Database(file);
  sqlite.exec(`
    CREATE TABLE sample_table (id INTEGER PRIMARY KEY, sample_column TEXT);
    INSERT INTO sample_table (sample_column) VALUES ('alpha'), ('bravo');
  `);
  sqlite.close();
  return { dir, file };
}

describe("sqlite read-only query", () => {
  test.each([
    {
      name: "EXPLAIN of the default table query (LIMIT and OFFSET)",
      sql: 'EXPLAIN QUERY PLAN SELECT * FROM "sample_table" LIMIT 200 OFFSET 0',
      expected: (rows: unknown[][]) =>
        rows.some((row) => row.includes("SCAN sample_table")),
    },
    {
      name: "EXPLAIN without LIMIT",
      sql: "EXPLAIN QUERY PLAN SELECT * FROM sample_table",
      expected: (rows: unknown[][]) =>
        rows.some((row) => row.includes("SCAN sample_table")),
    },
    {
      name: "PRAGMA",
      sql: "PRAGMA table_info(sample_table)",
      expected: (rows: unknown[][]) =>
        rows.some((row) => row.includes("sample_column")),
    },
    {
      name: "SELECT with its own LIMIT",
      sql: "SELECT sample_column FROM sample_table ORDER BY id LIMIT 1",
      expected: (rows: unknown[][]) =>
        rows.length === 1 && rows[0]?.[0] === "alpha",
    },
  ])("runs $name", async ({ sql, expected }) => {
    const { file } = seedSampleDb();
    const adapter = await sqliteAdapterFactory.open(file);
    try {
      const result = await adapter.executeReadonlyQueryAsync(sql);
      expect(expected(result.rows)).toBe(true);
    } finally {
      adapter.close();
    }
  });

  test.each([
    {
      name: "a SELECT that fails in both forms names both reasons",
      sql: "SELECT * FROM missing_table",
      message:
        "the query failed in every form it was tried (" +
        "as a subquery: no such table: missing_table; " +
        "with LIMIT appended: no such table: missing_table)",
    },
    {
      name: "an EXPLAIN is run once and names its own reason",
      sql: "EXPLAIN QUERY PLAN SELECT * FROM missing_table",
      message: "no such table: missing_table",
    },
  ])("$name", async ({ sql, message }) => {
    const { file } = seedSampleDb();
    const adapter = await sqliteAdapterFactory.open(file);
    try {
      expect(
        await captureErrorAsync(() => adapter.executeReadonlyQueryAsync(sql)),
      ).toBe(message);
    } finally {
      adapter.close();
    }
  });

  test("/_db/query answers the plan of the default table query", async () => {
    const { dir } = seedSampleDb();
    const req = new Request("http://localhost/_db/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        db: "sample.db",
        sql: 'EXPLAIN QUERY PLAN SELECT * FROM "sample_table" LIMIT 200 OFFSET 0',
      }),
    });
    const res = await handleDatabaseRoute(
      req,
      new URL(req.url),
      dir,
      [],
      () => true,
    );
    expect(res?.status).toBe(200);
    const body = (await res?.json()) as DbQueryResponse;
    expect(body.error).toBeUndefined();
    expect(body.rows.some((row) => row.includes("SCAN sample_table"))).toBe(
      true,
    );
  });
});
