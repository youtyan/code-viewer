import { afterEach, describe, expect, test } from "bun:test";
import {
  __setD1FetchForTest,
  createD1Adapter,
} from "../server/database/adapters/d1";
import { SQLITE_INTROSPECTION_SQL } from "../server/database/adapters/sqlite-introspection";
import { captureErrorAsync } from "./_test-helpers";

type D1Call = {
  url: string;
  method: string;
  authorization: string | null;
  body: { sql: string; params: unknown[] };
};

type RawResponse = { columns: string[]; rows: unknown[][] };

const CONFIG = {
  accountId: "example-account",
  databaseId: "example-database",
  apiToken: "example-token",
  apiBaseUrl: "https://api.example.test/client/v4",
};

const RAW_URL =
  "https://api.example.test/client/v4/accounts/example-account/d1/database/example-database/raw";

// SQL -> /raw の results をテーブルで与えるスタブ。SQL 完全一致で引けなければ
// 部分一致にフォールバックする (PRAGMA など引数付きの文を短く書けるように)。
function stubD1(
  responses: Array<[match: string, result: RawResponse]>,
): D1Call[] {
  const calls: D1Call[] = [];
  __setD1FetchForTest((async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      sql: string;
      params: unknown[];
    };
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      authorization: new Headers(init?.headers).get("Authorization"),
      body,
    });
    const hit =
      responses.find(([match]) => match === body.sql) ??
      responses.find(([match]) => body.sql.includes(match));
    return new Response(
      JSON.stringify({
        success: true,
        result: [
          { success: true, results: hit?.[1] ?? { columns: [], rows: [] } },
        ],
      }),
      { status: 200 },
    );
  }) as typeof fetch);
  return calls;
}

afterEach(() => {
  __setD1FetchForTest(null);
});

describe("d1 adapter requests", () => {
  test("posts sql to the account/database raw endpoint with a bearer token", async () => {
    const calls = stubD1([
      [
        "sqlite_master",
        { columns: ["name", "type"], rows: [["sample_table", "table"]] },
      ],
    ]);
    const adapter = createD1Adapter(CONFIG);

    const tables = await adapter.getTablesAsync();

    expect(tables).toEqual([
      { name: "sample_table", type: "table", rowCount: null },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(RAW_URL);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].authorization).toBe("Bearer example-token");
  });

  // D1 は内部テーブル _cf_KV を sqlite_master に見せるが、読むと authorizer に
  // 拒否される (not authorized: SQLITE_AUTH)。一覧・件数どちらにも混ぜない。
  test("hides D1 internal tables from the table list", async () => {
    stubD1([
      [
        "sqlite_master",
        {
          columns: ["name", "type"],
          rows: [
            ["_cf_KV", "table"],
            ["sample_table", "table"],
          ],
        },
      ],
    ]);
    const adapter = createD1Adapter(CONFIG);

    expect(await adapter.getTablesAsync()).toEqual([
      { name: "sample_table", type: "table", rowCount: null },
    ]);
  });

  test("never counts rows in a D1 internal table", async () => {
    const calls = stubD1([
      ["AS tbl", { columns: ["tbl", "cnt"], rows: [["sample_table", 4]] }],
    ]);
    const adapter = createD1Adapter(CONFIG);

    const counts = await adapter.getTableRowCountsAsync([
      "_cf_KV",
      "sample_table",
    ]);

    expect(counts.get("sample_table")).toBe(4);
    expect(counts.has("_cf_KV")).toBe(false);
    expect(calls.every((call) => !call.body.sql.includes("_cf_KV"))).toBe(true);
  });

  test("keeps the schema readable when one table's count is denied", async () => {
    __setD1FetchForTest((async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const { sql } = JSON.parse(String(init?.body)) as { sql: string };
      // UNION と、拒否されるテーブル単体の COUNT だけ失敗させる。
      if (sql.includes("UNION ALL") || sql.includes('"restricted_table"')) {
        return new Response(
          JSON.stringify({
            success: false,
            errors: [{ message: "not authorized: SQLITE_AUTH" }],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          result: [
            { success: true, results: { columns: ["cnt"], rows: [[7]] } },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch);
    const adapter = createD1Adapter(CONFIG);

    const counts = await adapter.getTableRowCountsAsync([
      "restricted_table",
      "sample_table",
    ]);

    expect(counts.get("sample_table")).toBe(7);
    expect(counts.has("restricted_table")).toBe(false);
  });

  test("reads a table page with columns, rows and total count", async () => {
    stubD1([
      [
        "PRAGMA table_info",
        {
          columns: ["cid", "name", "type", "notnull", "dflt_value", "pk"],
          rows: [
            [0, "id", "INTEGER", 1, null, 1],
            [1, "label", "TEXT", 0, null, 0],
          ],
        },
      ],
      ["COUNT(*)", { columns: ["cnt"], rows: [[3]] }],
      [
        "SELECT * FROM",
        {
          columns: ["id", "label"],
          rows: [
            [1, "first"],
            [2, "second"],
          ],
        },
      ],
    ]);
    const adapter = createD1Adapter(CONFIG);

    const page = await adapter.getTablePageWithMeta("sample_table", {
      offset: 0,
      limit: 2,
    });

    expect(page.columns).toEqual([
      {
        name: "id",
        type: "INTEGER",
        nullable: false,
        primaryKey: true,
        defaultValue: null,
      },
      {
        name: "label",
        type: "TEXT",
        nullable: true,
        primaryKey: false,
        defaultValue: null,
      },
    ]);
    expect(page.rows).toEqual([
      [1, "first"],
      [2, "second"],
    ]);
    expect(page.totalRows).toBe(3);
  });

  test("passes limit and offset as bound parameters", async () => {
    const calls = stubD1([
      [
        "PRAGMA table_info",
        {
          columns: ["cid", "name", "type", "notnull", "dflt_value", "pk"],
          rows: [[0, "id", "INTEGER", 1, null, 1]],
        },
      ],
      ["SELECT * FROM", { columns: ["id"], rows: [[1]] }],
    ]);
    const adapter = createD1Adapter(CONFIG);

    await adapter.getTablePageAsync("sample_table", { offset: 20, limit: 10 });

    const page = calls.find((call) =>
      call.body.sql.startsWith("SELECT * FROM"),
    );
    expect(page?.body.sql).toBe(
      'SELECT * FROM "sample_table" LIMIT ? OFFSET ?',
    );
    expect(page?.body.params).toEqual([10, 20]);
  });

  test("decodes blob byte arrays into binary values", async () => {
    stubD1([
      [
        "PRAGMA table_info",
        {
          columns: ["cid", "name", "type", "notnull", "dflt_value", "pk"],
          rows: [[0, "payload", "BLOB", 0, null, 0]],
        },
      ],
      ["SELECT * FROM", { columns: ["payload"], rows: [[[104, 105]]] }],
    ]);
    const adapter = createD1Adapter(CONFIG);

    const page = await adapter.getTablePageAsync("sample_table", {
      offset: 0,
      limit: 1,
    });

    expect(page.rows[0][0]).toEqual(new Uint8Array([104, 105]));
  });
});

function stubD1Failure(status: number, message: string): void {
  __setD1FetchForTest(
    (async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ success: false, errors: [{ message }] }), {
        status,
      })) as typeof fetch,
  );
}

const NOT_READONLY =
  "Only SELECT, PRAGMA, EXPLAIN, and WITH queries are allowed";
const BLOCKED_KEYWORD = "Query contains a disallowed statement keyword";

// 中断を per-item の catch で握り潰すと、欠けたインデックス/FK を持つ
// スキーマが HTTP 200 として返り、キャンセル済みの結果が画面に載る。
describe("d1 adapter cancellation", () => {
  test.each([
    {
      name: "index introspection",
      listSql: SQLITE_INTROSPECTION_SQL.listIndexes,
      listResult: {
        columns: ["name", "tbl_name"],
        rows: [["idx_sample", "sample_table"]],
      },
      run: (adapter: ReturnType<typeof createD1Adapter>, signal: AbortSignal) =>
        adapter.getIndexesAsync(signal),
    },
    {
      name: "foreign key introspection",
      listSql: SQLITE_INTROSPECTION_SQL.listForeignKeyTables,
      listResult: { columns: ["name"], rows: [["sample_table"]] },
      run: (adapter: ReturnType<typeof createD1Adapter>, signal: AbortSignal) =>
        adapter.getForeignKeysAsync(signal),
    },
  ])("propagates an abort during $name", async ({
    listSql,
    listResult,
    run,
  }) => {
    const controller = new AbortController();
    __setD1FetchForTest((async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const { sql } = JSON.parse(String(init?.body)) as { sql: string };
      // 一覧の取得までは成功し、その後の PRAGMA 実行中に中断される。
      if (sql !== listSql) {
        controller.abort();
        throw new Error("D1 request aborted");
      }
      return new Response(
        JSON.stringify({
          success: true,
          result: [{ success: true, results: listResult }],
        }),
        { status: 200 },
      );
    }) as typeof fetch);
    const adapter = createD1Adapter(CONFIG);

    expect(await captureErrorAsync(() => run(adapter, controller.signal))).toBe(
      "D1 request aborted",
    );
  });
});

describe("d1 adapter read-only guard", () => {
  test.each([
    { sql: "INSERT INTO sample_table (id) VALUES (1)", message: NOT_READONLY },
    { sql: "UPDATE sample_table SET id = 2", message: NOT_READONLY },
    { sql: "DELETE FROM sample_table", message: NOT_READONLY },
    { sql: "DROP TABLE sample_table", message: NOT_READONLY },
    {
      sql: "SELECT * FROM sample_table; DELETE FROM sample_table",
      message: BLOCKED_KEYWORD,
    },
  ])("rejects $sql without issuing a request", async ({ sql, message }) => {
    const calls = stubD1([]);
    const adapter = createD1Adapter(CONFIG);

    expect(
      await captureErrorAsync(() => adapter.executeReadonlyQueryAsync(sql)),
    ).toBe(message);
    expect(calls).toHaveLength(0);
  });

  test("does not expose row writes", () => {
    const adapter = createD1Adapter(CONFIG);

    expect(adapter.applyMutations).toBeUndefined();
  });
});

describe("d1 adapter error handling", () => {
  // 資格情報はプロセス内保持なので再起動で消える。素の "Authentication error"
  // ではなく入れ直しを促すメッセージを出す。
  test("explains a token lost on restart instead of calling the API", async () => {
    const calls = stubD1([]);
    const adapter = createD1Adapter({ ...CONFIG, apiToken: "" });

    expect(await captureErrorAsync(() => adapter.getTablesAsync())).toMatch(
      /D1 API token is missing/,
    );
    expect(calls).toHaveLength(0);
  });

  test.each([
    {
      name: "a query error returned with HTTP 200",
      status: 200,
      message: "no such table: missing_table",
    },
    {
      name: "an authentication failure",
      status: 401,
      message: "Authentication error",
    },
  ])("surfaces $name with the failing statement", async ({
    status,
    message,
  }) => {
    stubD1Failure(status, message);
    const adapter = createD1Adapter(CONFIG);

    // authorizer 拒否はメッセージだけでは原因が分からないので、どの SQL で
    // 落ちたかまで見えることを保証する。
    expect(await captureErrorAsync(() => adapter.getTablesAsync())).toBe(
      `${message} (sql: ${SQLITE_INTROSPECTION_SQL.listTables})`,
    );
  });
});
