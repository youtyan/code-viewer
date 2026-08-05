import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import type {
  DbTableCountResponse,
  DbTableDataResponse,
} from "../core/database/types";
import { handleDatabaseRoute } from "../server/database/handle";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function seedDb(): { dir: string; db: string } {
  const dir = mkdtempSync(join(tmpdir(), "code-viewer-related-"));
  dirs.push(dir);
  const sqlite = new Database(join(dir, "app.db"));
  sqlite.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      title TEXT
    );
    CREATE VIEW post_titles AS SELECT title FROM posts;
    INSERT INTO users (id, name) VALUES (1, 'Alice'), (2, 'Bob'), (11, 'Eve');
    INSERT INTO posts (id, user_id, title) VALUES
      (1, 1, 'Hello'),
      (2, 1, 'Again'),
      (3, 11, 'Eve post');
  `);
  sqlite.close();
  return { dir, db: "app.db" };
}

async function route(dir: string, path: string): Promise<Response> {
  const req = new Request(`http://localhost${path}`);
  const res = await handleDatabaseRoute(
    req,
    new URL(req.url),
    dir,
    [],
    () => true,
  );
  if (!res) throw new Error("route did not match");
  return res;
}

function tableUrl(
  db: string,
  table: string,
  extra: Record<string, string> = {},
): string {
  const params = new URLSearchParams({
    db,
    table,
    offset: "0",
    limit: "200",
    ...extra,
  });
  return `/_db/table?${params}`;
}

function tableCountUrl(db: string, table: string): string {
  return `/_db/table-count?${new URLSearchParams({ db, table })}`;
}

describe("/_db/table eq (exact foreign-key match)", () => {
  test("table-count returns an unfiltered table row count", async () => {
    const { dir, db } = seedDb();
    const res = await route(dir, tableCountUrl(db, "posts"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as DbTableCountResponse;
    expect(body.table).toBe("posts");
    expect(body.rowCount).toBe(3);
  });

  test("table-count keeps view row counts unset", async () => {
    const { dir, db } = seedDb();
    const res = await route(dir, tableCountUrl(db, "post_titles"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as DbTableCountResponse;
    expect(body.table).toBe("post_titles");
    expect(body.rowCount).toBeNull();
  });

  test("table-count rejects an unknown table instead of returning zero", async () => {
    const { dir, db } = seedDb();
    const res = await route(dir, tableCountUrl(db, "missing_table"));
    expect(res.status).toBe(500);
    expect(await res.text()).toMatch(/unknown table/);
  });

  test("eq matches exactly and not as a substring", async () => {
    const { dir, db } = seedDb();
    // user_id = 1 must match only the two posts for user 1, not user 11.
    const res = await route(
      dir,
      tableUrl(db, "posts", {
        eq: JSON.stringify([{ column: "user_id", value: "1" }]),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DbTableDataResponse;
    expect(body.totalRows).toBe(2);
    expect(body.rows.length).toBe(2);
  });

  test("eq returns the single referenced row", async () => {
    const { dir, db } = seedDb();
    const res = await route(
      dir,
      tableUrl(db, "users", {
        eq: JSON.stringify([{ column: "id", value: "11" }]),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DbTableDataResponse;
    expect(body.rows.length).toBe(1);
    const nameIdx = body.columns.findIndex((c) => c.name === "name");
    expect(body.rows[0][nameIdx]).toBe("Eve");
  });

  test("eq combines with a LIKE filter on top of the base WHERE", async () => {
    const { dir, db } = seedDb();
    // Base WHERE user_id = 1 (2 rows) further narrowed by title LIKE %Again%.
    const res = await route(
      dir,
      tableUrl(db, "posts", {
        eq: JSON.stringify([{ column: "user_id", value: "1" }]),
        filters: JSON.stringify([{ column: "title", value: "Again" }]),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DbTableDataResponse;
    expect(body.rows.length).toBe(1);
    const titleIdx = body.columns.findIndex((c) => c.name === "title");
    expect(body.rows[0][titleIdx]).toBe("Again");
  });

  test("an unknown eq column is ignored rather than erroring", async () => {
    const { dir, db } = seedDb();
    const res = await route(
      dir,
      tableUrl(db, "users", {
        eq: JSON.stringify([{ column: "not_a_column", value: "1" }]),
      }),
    );
    // Invalid eq columns are dropped (consistent with LIKE filters), so the
    // request still succeeds and returns the full table.
    expect(res.status).toBe(200);
    const body = (await res.json()) as DbTableDataResponse;
    expect(body.totalRows).toBe(3);
  });

  test("an over-long eq value is dropped (DoS guard) and does not filter", async () => {
    const { dir, db } = seedDb();
    const huge = "x".repeat(5000); // exceeds MAX_FILTER_VALUE_LEN (4096)
    const res = await route(
      dir,
      tableUrl(db, "users", {
        eq: JSON.stringify([{ column: "id", value: huge }]),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { totalRows: number };
    // The condition is dropped, so the full table comes back rather than 0.
    expect(body.totalRows).toBe(3);
  });

  test("a flood of eq conditions is capped and still succeeds", async () => {
    const { dir, db } = seedDb();
    const many = Array.from({ length: 500 }, () => ({
      column: "user_id",
      value: "1",
    }));
    const res = await route(
      dir,
      tableUrl(db, "posts", { eq: JSON.stringify(many) }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { totalRows: number };
    // All conditions are identical (user_id = 1) so the capped set matches the
    // same two posts; the point is the request is bounded and does not error.
    expect(body.totalRows).toBe(2);
  });

  test("export honors the eq base WHERE", async () => {
    const { dir, db } = seedDb();
    const params = new URLSearchParams({
      db,
      table: "posts",
      format: "csv",
      eq: JSON.stringify([{ column: "user_id", value: "1" }]),
    });
    const res = await route(dir, `/_db/export?${params}`);
    expect(res.status).toBe(200);
    const csv = await res.text();
    const lines = csv.trim().split("\n");
    // header + 2 data rows for user 1 (posts 1 and 2), excluding user 11.
    expect(lines).toHaveLength(3);
  });

  test("filtered table read returns a JSON-serializable totalRows (no BigInt)", async () => {
    // Regression: safeIntegers makes COUNT(*) a bigint; the filtered table
    // path must coerce totalRows to a number, otherwise the JSON response
    // throws "JSON.stringify cannot serialize BigInt".
    const { dir, db } = seedDb();
    // id LIKE %1% matches id 1 and 11 — two rows; the point is that the
    // response serializes at all (no BigInt) and totalRows is a number.
    const res = await route(
      dir,
      tableUrl(db, "users", {
        filters: JSON.stringify([{ column: "id", value: "1" }]),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DbTableDataResponse;
    expect(typeof body.totalRows).toBe("number");
    expect(body.totalRows).toBe(2);
  });
});
