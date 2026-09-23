// Data の画面の裏 (server/database) で、失敗の理由を捨てず・失敗を「無い」「0」
// 「成功」に化けさせないこと。
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { waitForAbortableResource } from "../server/database/adapters/abort";
import {
  __setD1FetchForTest,
  createD1Adapter,
} from "../server/database/adapters/d1";
import {
  __setSqlDriverFactoriesForTest,
  createSqlCliAdapter,
} from "../server/database/adapters/docker";
import {
  __clearDockerComposeContainerNameCacheForTest,
  __clearSupabaseContainerCacheForTest,
  __setDockerComposeSpawnSyncForTest,
  resolveRunningComposeContainerNameOrThrowAsync,
  resolveRunningSupabaseDbContainerOrThrowAsync,
} from "../server/database/adapters/docker-utils";
import {
  __setEsFetchForTest,
  createElasticsearchAdapter,
} from "../server/database/adapters/elasticsearch";
import {
  __setKeychainEnabledForTest,
  __setKeychainSpawnForTest,
  loadConnectionSecretsAsync,
} from "../server/database/credential-store";
import { discoverSqliteFilesAsync } from "../server/database/discovery";
import { handleDatabaseRoute } from "../server/database/handle";
import { serializeDbValue } from "../server/database/serialize";
import {
  loadSqliteClass,
  rollbackAfter,
} from "../server/database/sqlite-driver";

const roots: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  __setD1FetchForTest(null);
  __setSqlDriverFactoriesForTest({});
  __setDockerComposeSpawnSyncForTest(null);
  __clearDockerComposeContainerNameCacheForTest();
  __clearSupabaseContainerCacheForTest();
  __setEsFetchForTest(null);
  __setKeychainEnabledForTest(null);
  __setKeychainSpawnForTest(null);
  // 閉じたフォルダ (作った順の後ろ) から開けて消す。
  for (const root of roots.splice(0).reverse()) {
    chmodSync(root, 0o700);
    rmSync(root, { recursive: true, force: true });
  }
});

async function sampleSqliteRepo(): Promise<string> {
  const cwd = tempDir("code-viewer-db-reasons-");
  const Database = await loadSqliteClass<{
    exec(sql: string): void;
    close(): void;
  }>();
  const db = new Database(join(cwd, "sample.db"));
  db.exec(
    "CREATE TABLE sample_table (id INTEGER PRIMARY KEY, sample_column TEXT); INSERT INTO sample_table (sample_column) VALUES ('a'), ('b');",
  );
  db.close();
  return cwd;
}

function route(cwd: string, path: string, init: RequestInit = {}) {
  const req = new Request(`http://localhost${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Code-Viewer-Action": "1",
      ...init.headers,
    },
  });
  return handleDatabaseRoute(req, new URL(req.url), cwd, [], () => true);
}

describe("database routes answer with the reason", () => {
  test.each([
    {
      name: "a malformed filter is refused instead of returning every row",
      request: {
        path: "/_db/table?db=sample.db&table=sample_table&filters=%5Bbroken",
      },
      expected: {
        status: 400,
        text: expect.stringMatching(
          /^invalid filters parameter: SyntaxError: /,
        ),
      },
    },
    {
      name: "a filter that is not an array is refused",
      request: { path: "/_db/table?db=sample.db&table=sample_table&eq=%7B%7D" },
      expected: {
        status: 400,
        text: "invalid eq parameter: expected a JSON array",
      },
    },
    {
      name: "an unreadable history-clear body is refused instead of clearing all",
      request: {
        path: "/_db/history/clear",
        init: { method: "POST", body: "{broken" },
      },
      expected: {
        status: 400,
        text: expect.stringMatching(/^invalid JSON body: SyntaxError: /),
      },
    },
    {
      name: "an unreadable tabs body says where it broke",
      request: { path: "/_db/tabs", init: { method: "PUT", body: "{broken" } },
      expected: {
        status: 400,
        text: expect.stringMatching(/^invalid JSON body: SyntaxError: /),
      },
    },
    {
      name: "a failed query keeps the driver's error code",
      request: {
        path: "/_db/query",
        init: {
          method: "POST",
          body: JSON.stringify({ db: "sample.db", sql: "SELECT * FROM gone" }),
        },
      },
      expected: {
        status: 400,
        // 応答は JSON なので、error の中の引用符は escape されて見える。
        text: expect.stringContaining(String.raw`\"code\":\"SQLITE_ERROR\"`),
      },
    },
  ])("$name", async ({ request, expected }) => {
    const cwd = await sampleSqliteRepo();
    const res = await route(cwd, request.path, request.init);
    expect({ status: res?.status, text: await res?.text() }).toEqual(expected);
  });
});

describe("recoveries that record what they recovered from", () => {
  const failure = new Error("sample cleanup failure");
  test.each([
    {
      name: "a resource that arrives after the abort and fails to dispose",
      run: async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(
          waitForAbortableResource(
            Promise.resolve("sample"),
            controller.signal,
            () => {
              throw failure;
            },
          ),
        ).rejects.toThrow("operation aborted");
      },
      logged: "disposing a resource that arrived after the abort failed:",
    },
    {
      name: "a PostgreSQL pool that fails to end",
      run: async () => {
        __setSqlDriverFactoriesForTest({
          pg: () => ({
            async connect() {
              throw new Error("unused");
            },
            async end() {
              throw failure;
            },
          }),
        });
        createSqlCliAdapter({
          kind: "postgresql",
          host: "db.example.test",
          port: 5432,
          user: "sample_user",
          password: "example-password",
          database: "sample_database",
        }).close();
      },
      logged: "closing the PostgreSQL pool failed:",
    },
  ])("$name", async ({ run, logged }) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(log.mock.calls).toContainEqual([`[code-viewer] ${logged}`, failure]);
  });

  test("a failed rollback keeps both failures; an already-ended transaction is quiet", () => {
    const original = new Error("sample statement failure");
    const rollbackFailure = new Error("sample disk failure");
    expect(() =>
      rollbackAfter(() => {
        throw new Error("cannot rollback - no transaction is active");
      }, original),
    ).not.toThrow();
    expect(() =>
      rollbackAfter(() => {
        throw rollbackFailure;
      }, original),
    ).toThrow(expect.objectContaining({ errors: [original, rollbackFailure] }));
  });

  test("scans skip an unreadable folder once with a warning and keep going", async () => {
    const cwd = await sampleSqliteRepo();
    const locked = join(cwd, "locked");
    mkdirSync(locked);
    chmodSync(locked, 0);
    roots.push(locked);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const found = await discoverSqliteFilesAsync(cwd, []);
    expect({
      found: found.map((file) => file.path),
      warned: warn.mock.calls.map(([message, error]) => [
        message,
        (error as NodeJS.ErrnoException).code,
      ]),
    }).toEqual({
      found: ["sample.db"],
      warned: [
        [
          `[code-viewer] database discovery skipped a path it cannot read: ${locked}`,
          "EACCES",
        ],
      ],
    });
  });
});

describe("adapters keep the reason of a failure", () => {
  test("every D1 error is kept with its code", async () => {
    __setD1FetchForTest(
      (async () =>
        new Response(
          JSON.stringify({
            success: false,
            errors: [
              { code: 7500, message: "sample first failure" },
              { code: 7501, message: "sample second failure" },
            ],
          }),
          { status: 400 },
        )) as typeof fetch,
    );
    const adapter = createD1Adapter({
      accountId: "example-account",
      databaseId: "example-database",
      apiToken: "example-token",
      apiBaseUrl: "https://api.example.test/client/v4",
    });
    await expect(adapter.getTablesAsync()).rejects.toThrow(
      /^7500: sample first failure; 7501: sample second failure \(sql: /,
    );
  });

  test("a D1 request that cannot connect keeps the fetch cause", async () => {
    const cause = new TypeError("fetch failed");
    __setD1FetchForTest((async () => {
      throw cause;
    }) as typeof fetch);
    const adapter = createD1Adapter({
      accountId: "example-account",
      databaseId: "example-database",
      apiToken: "example-token",
      apiBaseUrl: "https://api.example.test/client/v4",
    });
    await expect(adapter.getTablesAsync()).rejects.toMatchObject({
      message: "D1 request failed: fetch failed",
      cause,
    });
  });

  test.each([
    {
      name: "foreign keys",
      read: (adapter: ReturnType<typeof createSqlCliAdapter>) =>
        adapter.getForeignKeysAsync(),
    },
    {
      name: "triggers",
      read: (adapter: ReturnType<typeof createSqlCliAdapter>) =>
        adapter.getTriggersAsync?.("sample_table") ?? Promise.resolve(),
    },
    {
      name: "create statement",
      read: (adapter: ReturnType<typeof createSqlCliAdapter>) =>
        adapter.getCreateStatementAsync?.("sample_table") ?? Promise.resolve(),
    },
  ])("a failed $name query is an error, not an empty list", async ({
    read,
  }) => {
    const failure = new Error("sample permission denied");
    __setSqlDriverFactoriesForTest({
      pg: () => ({
        async connect() {
          return {
            async query() {
              throw failure;
            },
            release() {
              // Test double has no socket to release.
            },
          };
        },
        async end() {
          // Test double has no pool to end.
        },
      }),
    });
    const adapter = createSqlCliAdapter({
      kind: "postgresql",
      host: "db.example.test",
      port: 5432,
      user: "sample_user",
      password: "example-password",
      database: "sample_database",
    });
    await expect(read(adapter)).rejects.toBe(failure);
    adapter.close();
  });

  test("a table that cannot be counted has no count instead of 0", async () => {
    const failure = new Error("sample permission denied");
    __setSqlDriverFactoriesForTest({
      pg: () => ({
        async connect() {
          return {
            async query() {
              throw failure;
            },
            release() {
              // Test double has no socket to release.
            },
          };
        },
        async end() {
          // Test double has no pool to end.
        },
      }),
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const adapter = createSqlCliAdapter({
      kind: "postgresql",
      host: "db.example.test",
      port: 5432,
      user: "sample_user",
      password: "example-password",
      database: "sample_database",
    });
    const counts = await adapter.getTableRowCountsAsync?.(["sample_table"]);
    adapter.close();
    expect({ counts, logged: log.mock.calls }).toEqual({
      counts: new Map(),
      logged: [
        ["[code-viewer] counting rows of sample_table failed:", failure],
      ],
    });
  });

  test("a D1 foreign-key read that fails for a reason other than a missing module is an error", async () => {
    __setD1FetchForTest((async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const { sql } = JSON.parse(String(init?.body)) as { sql: string };
      const results = sql.includes("foreign_key_list")
        ? null
        : { columns: ["name"], rows: [["sample_table"]] };
      return new Response(
        JSON.stringify(
          results
            ? { success: true, result: [{ success: true, results }] }
            : {
                success: false,
                errors: [{ message: "not authorized: SQLITE_AUTH" }],
              },
        ),
        { status: 200 },
      );
    }) as typeof fetch);
    const adapter = createD1Adapter({
      accountId: "example-account",
      databaseId: "example-database",
      apiToken: "example-token",
      apiBaseUrl: "https://api.example.test/client/v4",
    });
    await expect(adapter.getForeignKeysAsync()).rejects.toThrow(
      /^not authorized: SQLITE_AUTH \(sql: /,
    );
  });

  test("an elasticsearch request that cannot connect keeps the fetch cause", async () => {
    __setEsFetchForTest((async () => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9200"), {
          code: "ECONNREFUSED",
        }),
      });
    }) as typeof fetch);
    const adapter = createElasticsearchAdapter({
      endpoint: "http://127.0.0.1:9200",
      password: "",
    });
    await expect(adapter.listIndicesAsync()).rejects.toThrow(
      /Caused by: Error: connect ECONNREFUSED 127\.0\.0\.1:9200/,
    );
  });

  test("'not running' carries the docker compose ps failure", async () => {
    __setDockerComposeSpawnSyncForTest((() => ({
      status: 1,
      stdout: "",
      stderr: "sample daemon failure",
    })) as unknown as typeof import("node:child_process").spawnSync);
    await expect(
      resolveRunningComposeContainerNameOrThrowAsync("sample-svc", "/example"),
    ).rejects.toMatchObject({
      name: "DockerComposeServiceUnavailableError",
      cause: "sample daemon failure",
    });
  });

  test("'not running' for a Supabase project carries the docker ps failure", async () => {
    __setDockerComposeSpawnSyncForTest((() => ({
      status: 1,
      stdout: "",
      stderr: "sample daemon failure",
    })) as unknown as typeof import("node:child_process").spawnSync);
    await expect(
      resolveRunningSupabaseDbContainerOrThrowAsync("sample_project"),
    ).rejects.toMatchObject({
      name: "SupabaseDbContainerUnavailableError",
      cause: "docker ps exited with 1: sample daemon failure",
    });
  });

  test("a keychain read failure is logged with its exit code and whole stderr", async () => {
    __setKeychainEnabledForTest(true);
    __setKeychainSpawnForTest((async () => ({
      stdout: Buffer.from(""),
      stderr: Buffer.from("sample line 1\nsample line 2"),
      code: 51,
    })) as Parameters<typeof __setKeychainSpawnForTest>[0]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(
      await loadConnectionSecretsAsync("/example", "connection:1"),
    ).toBeNull();
    expect(warn.mock.calls).toEqual([
      [
        "[code-viewer] keychain read failed:",
        "security exited with 51: sample line 1\nsample line 2",
      ],
    ]);
  });

  test("a JSON column holding a bigint is serialized instead of '[object Object]'", () => {
    expect(serializeDbValue({ sample: 12n })).toBe('{"sample":"12"}');
  });
});
