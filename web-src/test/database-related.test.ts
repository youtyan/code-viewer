import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DbRelatedResponse } from "../core/database/types";
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
    INSERT INTO users (id, name) VALUES (1, 'Alice'), (2, 'Bob');
    INSERT INTO posts (id, user_id, title) VALUES (1, 1, 'Hello'), (2, 1, 'Again');
  `);
  sqlite.close();
  return { dir, db: "app.db" };
}

async function related(dir: string, query: string): Promise<Response> {
  const req = new Request(`http://localhost/_db/related?${query}`);
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

describe("/_db/related foreign key lookup", () => {
  test("returns the referenced row by exact match", async () => {
    const { dir, db } = seedDb();
    const res = await related(dir, `db=${db}&table=users&column=id&value=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DbRelatedResponse;
    expect(body.table).toBe("users");
    expect(body.column).toBe("id");
    expect(body.rows.length).toBe(1);
    const idIdx = body.columns.indexOf("id");
    const nameIdx = body.columns.indexOf("name");
    expect(body.rows[0][idIdx]).toBe(1);
    expect(body.rows[0][nameIdx]).toBe("Alice");
    expect(body.truncated).toBe(false);
  });

  test("matches exactly and does not substring-match like the filter UI", async () => {
    const { dir, db } = seedDb();
    // value "1" must not also match id 11/21 etc.; here only id=1 exists,
    // but the reverse direction (posts.user_id) has two rows for user 1.
    const res = await related(
      dir,
      `db=${db}&table=posts&column=user_id&value=1`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DbRelatedResponse;
    expect(body.rows.length).toBe(2);
  });

  test("returns an empty result set when nothing matches", async () => {
    const { dir, db } = seedDb();
    const res = await related(dir, `db=${db}&table=users&column=id&value=999`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DbRelatedResponse;
    expect(body.rows.length).toBe(0);
  });

  test("rejects an unknown column instead of building a bad query", async () => {
    const { dir, db } = seedDb();
    const res = await related(
      dir,
      `db=${db}&table=users&column=not_a_column&value=1`,
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch("unknown column");
  });

  test("requires table, column and value parameters", async () => {
    const { dir, db } = seedDb();
    expect((await related(dir, `db=${db}&column=id&value=1`)).status).toBe(400);
    expect((await related(dir, `db=${db}&table=users&value=1`)).status).toBe(
      400,
    );
    expect((await related(dir, `db=${db}&table=users&column=id`)).status).toBe(
      400,
    );
  });
});
