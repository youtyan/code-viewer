// Data の問い合わせの失敗: 画面ではサーバの理由 (JSON の error) を先頭に出して
// 全文は「詳細」に畳み (serverErrorSummary)、失敗した問い合わせも履歴に「失敗」
// の理由つきで残す (/_db/query)。以前は HTTP の本文の JSON をそのまま並べて理由が
// 末尾に埋もれ、履歴には成功したものしか残らなかった。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, test } from "vitest";
import { errorWithCause, responseErrorMessage } from "../core/error-detail";
import { handleDatabaseRoute } from "../server/database/handle";
import { loadQueryHistoryAsync } from "../server/database/query-history";
import { serverErrorSummary } from "../views/database/report-failure";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function failure(body: string, status = 400): Promise<Error> {
  return new Error(
    await responseErrorMessage(
      new Response(body, { status, statusText: "Bad Request" }),
      "failed to execute query",
    ),
  );
}

test.each([
  {
    name: "JSON の error を取り出す",
    body: JSON.stringify({
      dbId: "sample.db",
      columns: [],
      rows: [],
      error: "no such table: absent",
    }),
    expected: "no such table: absent",
  },
  {
    name: "code があれば添える",
    body: JSON.stringify({
      error: "the process for this project stopped",
      code: "backend-stopped",
    }),
    expected: "the process for this project stopped (backend-stopped)",
  },
  {
    name: "JSON でない本文は要約しない",
    body: "plain failure text",
    expected: null,
  },
  {
    name: "error の無い JSON は要約しない",
    body: JSON.stringify({ ok: false }),
    expected: null,
  },
])("serverErrorSummary: $name", async ({ body, expected }) => {
  expect(serverErrorSummary(await failure(body))).toBe(expected);
});

test("serverErrorSummary: cause の連鎖の奥の応答も見る", async () => {
  const inner = await failure(
    JSON.stringify({ error: "no such table: absent" }),
  );
  expect(
    serverErrorSummary(errorWithCause("running the query failed", inner)),
  ).toBe("no such table: absent");
});

function seedDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "code-viewer-query-failure-"));
  tempDirs.push(dir);
  const sqlite = new Database(join(dir, "sample.db"));
  sqlite.exec("CREATE TABLE samples (id INTEGER PRIMARY KEY, note TEXT);");
  sqlite.close();
  return dir;
}

async function postQuery(dir: string, sql: string): Promise<Response> {
  const req = new Request("http://localhost/_db/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ db: "sample.db", sql, saveHistory: true }),
  });
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

test("失敗した問い合わせも、理由つきで履歴に残す (成功には error が無い)", async () => {
  const dir = seedDb();
  const ok = await postQuery(dir, "SELECT id FROM samples");
  const failed = await postQuery(dir, "SELECT * FROM absent");
  const failedBody = (await failed.json()) as { error?: string };
  const history = await loadQueryHistoryAsync(dir);
  expect([
    ok.status,
    failed.status,
    typeof failedBody.error === "string" &&
      failedBody.error.includes("no such table: absent"),
    history.entries.map((entry) => ({
      sql: entry.sql,
      failed: entry.error !== undefined,
      reason: entry.error === failedBody.error,
      rowCount: entry.rowCount,
    })),
  ]).toEqual([
    200,
    400,
    true,
    [
      { sql: "SELECT * FROM absent", failed: true, reason: true, rowCount: 0 },
      {
        sql: "SELECT id FROM samples",
        failed: false,
        reason: false,
        rowCount: 0,
      },
    ],
  ]);
});
