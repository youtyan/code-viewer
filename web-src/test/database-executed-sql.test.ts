// /_db/* の response に乗る executedSql フィールドを検証する。サーバが
// captureSql で集めた SQL がそのままクライアントへ返ることをエンドポイント
// 単位で確認する (session log の SQL 表示のサーバ側契約)。
import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  DbMutateResponse,
  DbQueryResponse,
  DbSchemaResponse,
  DbTableDataResponse,
} from "../core/database/types";
import { handleDatabaseRoute } from "../server/database/handle";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 「products / categories」スキーマで seed する。database-mutate.test.ts の
// users/logs とは別の DDL にして dup-check 衝突を避ける。
function seedProductsDb(): { dir: string; db: string } {
  const dir = mkdtempSync(join(tmpdir(), "code-viewer-exec-sql-"));
  tempDirs.push(dir);
  const file = join(dir, "store.db");
  const sqlite = new Database(file);
  sqlite.exec(`
    CREATE TABLE products (
      sku TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      price INTEGER NOT NULL
    );
    INSERT INTO products (sku, title, price) VALUES
      ('A-001', 'Widget', 100),
      ('B-002', 'Gadget', 250);
  `);
  sqlite.close();
  return { dir, db: "store.db" };
}

async function callRoute(dir: string, req: Request): Promise<Response> {
  const res = await handleDatabaseRoute(
    req,
    new URL(req.url),
    dir,
    [],
    () => true,
  );
  if (!res) throw new Error(`route did not match: ${req.url}`);
  return res;
}

describe("executedSql is echoed by /_db/* responses", () => {
  test("/_db/mutate returns the INSERT statement(s) it executed", async () => {
    const { dir, db } = seedProductsDb();
    const req = new Request("http://localhost/_db/mutate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        db,
        table: "products",
        mutations: [
          {
            kind: "insert",
            values: [
              { column: "sku", value: "C-003" },
              { column: "title", value: "Gizmo" },
              { column: "price", value: "300" },
            ],
          },
        ],
      }),
    });
    const res = await callRoute(dir, req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DbMutateResponse;
    expect(Array.isArray(body.executedSql)).toBe(true);
    const joined = (body.executedSql ?? []).join("\n");
    expect(joined).toMatch(/INSERT INTO/);
    expect(joined).toMatch(/products/);
  });

  test("/_db/table returns the SELECT/COUNT statements it executed", async () => {
    const { dir, db } = seedProductsDb();
    const params = new URLSearchParams({
      db,
      table: "products",
      offset: "0",
      limit: "10",
    });
    const res = await callRoute(
      dir,
      new Request(`http://localhost/_db/table?${params}`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DbTableDataResponse;
    expect(Array.isArray(body.executedSql)).toBe(true);
    const joined = (body.executedSql ?? []).join("\n");
    expect(joined).toMatch(/SELECT/);
    expect(joined).toMatch(/products/);
  });

  test("/_db/query echoes the user-submitted SQL in executedSql", async () => {
    const { dir, db } = seedProductsDb();
    const req = new Request("http://localhost/_db/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        db,
        sql: "SELECT sku FROM products ORDER BY sku",
      }),
    });
    const res = await callRoute(dir, req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DbQueryResponse;
    expect(Array.isArray(body.executedSql)).toBe(true);
    const joined = (body.executedSql ?? []).join("\n");
    expect(joined).toMatch(/SELECT sku FROM products/);
  });

  test("/_db/schema returns SQL emitted while inspecting tables", async () => {
    const { dir, db } = seedProductsDb();
    const params = new URLSearchParams({ db, includeColumns: "1" });
    const res = await callRoute(
      dir,
      new Request(`http://localhost/_db/schema?${params}`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DbSchemaResponse;
    expect(Array.isArray(body.executedSql)).toBe(true);
    // sqlite の schema 読み取りでは sqlite_master / PRAGMA が複数発行される。
    expect((body.executedSql ?? []).length > 0).toBeTruthy();
  });
});
