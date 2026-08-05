import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import type {
  DbMutateResponse,
  DbTableDataResponse,
  RowMutation,
} from "../core/database/types";
import { handleDatabaseRoute } from "../server/database/handle";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function seedDb(): { dir: string; db: string } {
  const dir = mkdtempSync(join(tmpdir(), "code-viewer-mutate-"));
  dirs.push(dir);
  const sqlite = new Database(join(dir, "app.db"));
  sqlite.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, active INTEGER);
    INSERT INTO users (id, name, active) VALUES (1, 'Alice', 1), (2, 'Bob', 0);
    CREATE TABLE logs (msg TEXT);
    INSERT INTO logs (msg) VALUES ('one');
  `);
  sqlite.close();
  return { dir, db: "app.db" };
}

async function mutate(
  dir: string,
  db: string,
  table: string,
  mutations: RowMutation[],
  sideEffectAllowed = true,
): Promise<Response> {
  const req = new Request("http://localhost/_db/mutate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ db, table, mutations }),
  });
  const res = await handleDatabaseRoute(
    req,
    new URL(req.url),
    dir,
    [],
    () => sideEffectAllowed,
  );
  if (!res) throw new Error("route did not match");
  return res;
}

async function readRows(
  dir: string,
  db: string,
  table: string,
): Promise<DbTableDataResponse> {
  const params = new URLSearchParams({ db, table, offset: "0", limit: "200" });
  const req = new Request(`http://localhost/_db/table?${params}`);
  const res = await handleDatabaseRoute(
    req,
    new URL(req.url),
    dir,
    [],
    () => true,
  );
  if (!res) throw new Error("table route did not match");
  return (await res.json()) as DbTableDataResponse;
}

describe("/_db/mutate (sqlite)", () => {
  test("inserts a new row and reflects it on read", async () => {
    const { dir, db } = seedDb();
    const res = await mutate(dir, db, "users", [
      {
        kind: "insert",
        values: [
          { column: "id", value: "3" },
          { column: "name", value: "Carol" },
          { column: "active", value: "1" },
        ],
      },
    ]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DbMutateResponse;
    expect(body.affected).toBe(1);

    const data = await readRows(dir, db, "users");
    expect(data.totalRows).toBe(3);
    const carol = data.rows.find((row) => row[1] === "Carol");
    expect(carol !== undefined).toBeTruthy();
  });

  test("updates an existing row by primary key", async () => {
    const { dir, db } = seedDb();
    const res = await mutate(dir, db, "users", [
      {
        kind: "update",
        pk: [{ column: "id", value: "1" }],
        values: [{ column: "name", value: "Alicia" }],
      },
    ]);
    expect(res.status).toBe(200);
    expect(((await res.json()) as DbMutateResponse).affected).toBe(1);

    const data = await readRows(dir, db, "users");
    const row = data.rows.find((r) => r[0] === 1);
    expect(row?.[1]).toBe("Alicia");
  });

  test("deletes a row by primary key", async () => {
    const { dir, db } = seedDb();
    const res = await mutate(dir, db, "users", [
      { kind: "delete", pk: [{ column: "id", value: "2" }] },
    ]);
    expect(res.status).toBe(200);
    const data = await readRows(dir, db, "users");
    expect(data.totalRows).toBe(1);
    expect(data.rows.find((r) => r[0] === 2)).toBeUndefined();
  });

  test("applies a mixed batch atomically", async () => {
    const { dir, db } = seedDb();
    const res = await mutate(dir, db, "users", [
      {
        kind: "insert",
        values: [
          { column: "id", value: "9" },
          { column: "name", value: "Nine" },
        ],
      },
      {
        kind: "update",
        pk: [{ column: "id", value: "1" }],
        values: [{ column: "name", value: "One" }],
      },
      { kind: "delete", pk: [{ column: "id", value: "2" }] },
    ]);
    expect(res.status).toBe(200);
    expect(((await res.json()) as DbMutateResponse).affected).toBe(3);
    const data = await readRows(dir, db, "users");
    expect(data.totalRows).toBe(2);
  });

  test("rolls back the whole batch when one statement fails", async () => {
    const { dir, db } = seedDb();
    // 2 件目で主キー重複 (id=1) を起こす。トランザクションなので 1 件目の
    // insert も巻き戻り、行数は元のままでなければならない。
    const res = await mutate(dir, db, "users", [
      {
        kind: "insert",
        values: [
          { column: "id", value: "5" },
          { column: "name", value: "Five" },
        ],
      },
      {
        kind: "insert",
        values: [
          { column: "id", value: "1" },
          { column: "name", value: "Dup" },
        ],
      },
    ]);
    expect(res.status).toBe(400);
    const data = await readRows(dir, db, "users");
    expect(data.totalRows).toBe(2);
    expect(data.rows.find((r) => r[0] === 5)).toBeUndefined();
  });

  test("updates a nullable column to SQL NULL", async () => {
    const { dir, db } = seedDb();
    const res = await mutate(dir, db, "users", [
      {
        kind: "update",
        pk: [{ column: "id", value: "1" }],
        values: [{ column: "name", value: null }],
      },
    ]);
    expect(res.status).toBe(200);
    const data = await readRows(dir, db, "users");
    const row = data.rows.find((r) => r[0] === 1);
    expect(row?.[1]).toBeNull();
  });

  test("rejects update/delete on a table without a primary key", async () => {
    const { dir, db } = seedDb();
    const res = await mutate(dir, db, "logs", [
      { kind: "delete", pk: [{ column: "msg", value: "one" }] },
    ]);
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/primary key/);
  });

  test("forbids writes when the side-effect gate denies the request", async () => {
    const { dir, db } = seedDb();
    const res = await mutate(
      dir,
      db,
      "users",
      [{ kind: "delete", pk: [{ column: "id", value: "1" }] }],
      false,
    );
    expect(res.status).toBe(403);
    const data = await readRows(dir, db, "users");
    expect(data.totalRows).toBe(2);
  });
});
