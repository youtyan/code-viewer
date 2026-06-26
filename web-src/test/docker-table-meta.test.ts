import { afterEach, describe, expect, test } from "bun:test";
import {
  __setDockerSpawnSyncForTest,
  createDockerAdapter,
} from "../server/database/adapters/docker";

type SpawnCall = {
  args: string[];
  sql: string;
  startedAt: number;
};

type SpawnHarness = {
  calls: SpawnCall[];
  restore(): void;
};

type SpawnResult = {
  stdout: string;
  stderr?: string;
  code?: number;
  delayMs?: number;
};

type SpawnLike = (
  args: string[],
  opts?: Record<string, unknown>,
) => {
  exited: Promise<number>;
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  kill(signal?: string): void;
};

let activeHarness: SpawnHarness | null = null;

afterEach(() => {
  activeHarness?.restore();
  activeHarness = null;
  __setDockerSpawnSyncForTest(null);
});

function mysqlStdout(sql: string): string {
  if (sql.includes("information_schema.columns")) {
    if (sql.includes("table_name = 'escaped_values'")) {
      return [
        "column_name\tcolumn_type\tis_nullable\tcolumn_default\tcolumn_key",
        "id\tint\tNO\tNULL\tPRI",
        "body\ttext\tYES\tNULL\t",
      ].join("\n");
    }
    if (sql.includes("table_name = 'spatial_values'")) {
      return [
        "column_name\tcolumn_type\tis_nullable\tcolumn_default\tcolumn_key",
        "id\tint\tNO\tNULL\tPRI",
        "location\tpoint\tYES\tNULL\t",
      ].join("\n");
    }
    return [
      "column_name\tcolumn_type\tis_nullable\tcolumn_default\tcolumn_key",
      "id\tint\tNO\tNULL\tPRI",
      "name\tvarchar(255)\tYES\tNULL\t",
    ].join("\n");
  }
  if (sql.includes("COUNT(*)")) {
    return ["cnt", "7"].join("\n");
  }
  if (sql.includes("SELECT * FROM `escaped_values`")) {
    return ["id\tbody", "1\tline1\\nline2\\tTabbed\\\\Path"].join("\n");
  }
  if (
    sql.includes(
      "SELECT `id`, ST_AsText(`location`) AS `location` FROM `spatial_values`",
    )
  ) {
    return ["id\tlocation", "1\tPOINT(139 35)"].join("\n");
  }
  return ["id\tname", "1\tAda"].join("\n");
}

// psql は landing_page_html のような改行を含む TEXT 列を -A モードで
// エスケープしないため、本番側で行区切りを ASCII 0x1E (RS) に切り替えた
// (docker.ts:PG_RECORD_SEPARATOR)。テストのモックも同じ separator で
// stdout を組み立てる。
const PG_RS = "\x1e";
function postgresStdout(sql: string): string {
  if (sql.includes("information_schema.columns")) {
    return ["id\tinteger\tNO\t\tYES", "name\ttext\tYES\t\tNO"].join(PG_RS);
  }
  if (sql.includes("COUNT(*)")) {
    return `2${PG_RS}`;
  }
  return `1\tAda${PG_RS}`;
}

function installSpawnHarness(
  resultForSql: (sql: string) => string | SpawnResult = mysqlStdout,
): SpawnHarness {
  const bunGlobal = globalThis as unknown as { Bun: { spawn: SpawnLike } };
  const originalSpawn = bunGlobal.Bun.spawn;
  const calls: SpawnCall[] = [];
  bunGlobal.Bun.spawn = ((args: string[]) => {
    const sql = args[args.length - 1] || "";
    const rawResult = resultForSql(sql);
    const result =
      typeof rawResult === "string" ? { stdout: rawResult } : rawResult;
    calls.push({ args, sql, startedAt: performance.now() });
    return {
      exited: new Promise<number>((resolve) => {
        setTimeout(() => resolve(result.code ?? 0), result.delayMs ?? 20);
      }),
      stdout: new Response(result.stdout).body,
      stderr: new Response(result.stderr || "").body,
      kill() {},
    };
  }) as SpawnLike;
  return {
    calls,
    restore() {
      bunGlobal.Bun.spawn = originalSpawn;
    },
  };
}

function createMysqlAdapter() {
  return createDockerAdapter({
    kind: "mysql",
    containerName: "db",
    user: "root",
    password: "pw",
    database: "app",
  });
}

function createPostgresAdapter(schema = "tenant_a") {
  return createDockerAdapter({
    kind: "postgresql",
    containerName: "db",
    user: "postgres",
    password: "pw",
    database: "app",
    schema,
  });
}

describe("docker table meta queries", () => {
  test("starts columns and count before awaiting table data", async () => {
    activeHarness = installSpawnHarness();
    const adapter = createMysqlAdapter();

    const pending = adapter.getTablePageWithMeta("users", {
      offset: 0,
      limit: 25,
    });

    expect(activeHarness.calls).toHaveLength(2);
    const result = await pending;
    const sql = activeHarness.calls.map((call) => call.sql);

    expect(sql[0]).toMatch(/information_schema\.columns/);
    expect(sql[1]).toBe("SELECT COUNT(*) AS cnt FROM `users`");
    expect(sql[2]).toBe("SELECT * FROM `users` LIMIT 25 OFFSET 0");
    expect(activeHarness.calls[2].args.includes("--raw")).toBe(false);
    expect(result.columns.map((column) => column.name)).toEqual(["id", "name"]);
    expect(result.rows).toEqual([["1", "Ada"]]);
    expect(result.rowCount).toBe(1);
    expect(result.totalRows).toBe(7);
  });

  test("keeps a prefetched row count failure out of unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    activeHarness = installSpawnHarness((sql) => {
      if (sql.includes("information_schema.columns")) {
        return { stdout: postgresStdout(sql), delayMs: 30 };
      }
      if (sql.includes("COUNT(*)")) {
        return {
          stdout: "",
          stderr:
            'ERROR: relation "public.missing_schedule_triggers" does not exist',
          code: 1,
          delayMs: 0,
        };
      }
      return { stdout: "1\tAda\n", delayMs: 30 };
    });
    const adapter = createPostgresAdapter("public");

    try {
      const pending = adapter.getTablePageWithMeta(
        "missing_schedule_triggers",
        {
          offset: 0,
          limit: 25,
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).toEqual([]);
      let thrown: unknown;
      try {
        await pending;
      } catch (err) {
        thrown = err;
      }
      expect(thrown instanceof Error).toBe(true);
      expect((thrown as Error).message).toMatch(/missing_schedule_triggers/);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("filters columns before building filtered table SQL", async () => {
    activeHarness = installSpawnHarness();
    const adapter = createMysqlAdapter();

    const pending = adapter.getFilteredTablePageWithMeta("users", {
      offset: 5,
      limit: 10,
      grouped: new Map([["Ada", ["name"]]]),
    });

    expect(activeHarness.calls).toHaveLength(1);
    const result = await pending;
    const sql = activeHarness.calls.map((call) => call.sql);

    expect(sql[0]).toMatch(/information_schema\.columns/);
    expect(sql[1]).toMatch(/WHERE CAST\(`name` AS CHAR\) LIKE '%Ada%'/);
    expect(sql[2]).toMatch(/WHERE CAST\(`name` AS CHAR\) LIKE '%Ada%'/);
    expect(sql[2]).toMatch(/LIMIT 10 OFFSET 5/);
    expect(result.totalRows).toBe(7);
  });

  test("uses TTL cache for columns and unfiltered row count", async () => {
    activeHarness = installSpawnHarness();
    const adapter = createMysqlAdapter();
    const originalNow = Date.now;
    let now = 1000;
    Date.now = () => now;
    try {
      await adapter.getTablePageWithMeta("users", {
        offset: 0,
        limit: 25,
      });
      expect(activeHarness.calls).toHaveLength(3);

      await adapter.getTablePageWithMeta("users", {
        offset: 25,
        limit: 25,
      });
      expect(activeHarness.calls).toHaveLength(4);
      expect(activeHarness.calls[3].sql).toBe(
        "SELECT * FROM `users` LIMIT 25 OFFSET 25",
      );

      now += 15_100;
      await adapter.getTablePageWithMeta("users", {
        offset: 50,
        limit: 25,
      });
      expect(activeHarness.calls).toHaveLength(6);
      expect(activeHarness.calls[4].sql).toBe(
        "SELECT COUNT(*) AS cnt FROM `users`",
      );
      expect(activeHarness.calls[5].sql).toBe(
        "SELECT * FROM `users` LIMIT 25 OFFSET 50",
      );

      now += 16_000;
      await adapter.getTablePageWithMeta("users", {
        offset: 75,
        limit: 25,
      });
      expect(activeHarness.calls).toHaveLength(9);
      expect(activeHarness.calls[6].sql).toMatch(/information_schema\.columns/);
      expect(activeHarness.calls[7].sql).toBe(
        "SELECT COUNT(*) AS cnt FROM `users`",
      );
      expect(activeHarness.calls[8].sql).toBe(
        "SELECT * FROM `users` LIMIT 25 OFFSET 75",
      );
    } finally {
      Date.now = originalNow;
    }
  });

  test("keeps mysql text newlines and tabs inside their original columns", async () => {
    activeHarness = installSpawnHarness();
    const adapter = createMysqlAdapter();

    const result = await adapter.getTablePageWithMeta("escaped_values", {
      offset: 0,
      limit: 25,
    });

    expect(result.columns.map((column) => column.name)).toEqual(["id", "body"]);
    expect(result.rows).toEqual([["1", "line1\nline2\tTabbed\\Path"]]);
    expect(result.rows[0]).toHaveLength(2);
  });

  test("renders mysql spatial columns as WKT text", async () => {
    activeHarness = installSpawnHarness();
    const adapter = createMysqlAdapter();

    const result = await adapter.getTablePageWithMeta("spatial_values", {
      offset: 0,
      limit: 25,
    });

    const dataCall = activeHarness.calls.find((call) =>
      call.sql.includes("ST_AsText(`location`)"),
    );
    expect(dataCall?.sql).toBe(
      "SELECT `id`, ST_AsText(`location`) AS `location` FROM `spatial_values` LIMIT 25 OFFSET 0",
    );
    expect(result.columns.map((column) => column.name)).toEqual([
      "id",
      "location",
    ]);
    expect(result.rows).toEqual([["1", "POINT(139 35)"]]);
  });

  test("queries PostgreSQL table data through the selected schema", async () => {
    activeHarness = installSpawnHarness(postgresStdout);
    const adapter = createPostgresAdapter("tenant_a");

    const result = await adapter.getTablePageWithMeta("users", {
      offset: 0,
      limit: 25,
    });

    const sql = activeHarness.calls.map((call) => call.sql);
    expect(sql[0]).toMatch(/c\.table_schema = 'tenant_a'/);
    expect(sql[1]).toBe('SELECT COUNT(*) AS cnt FROM "tenant_a"."users"');
    expect(sql[2]).toBe('SELECT * FROM "tenant_a"."users" LIMIT 25 OFFSET 0');
    expect(result.columns.map((column) => column.name)).toEqual(["id", "name"]);
    expect(result.rows).toEqual([["1", "Ada"]]);
    expect(result.totalRows).toBe(2);
  });

  test("sets PostgreSQL search_path for readonly editor queries", async () => {
    activeHarness = installSpawnHarness(() => "1\n");
    const adapter = createPostgresAdapter("tenant space");

    const result = await adapter.executeReadonlyQueryAsync(
      "select * from users",
      [],
      10,
    );
    const calls = activeHarness.calls.map((call) => call.sql);

    expect(result.rowCount).toBe(1);
    expect(calls[0]).toMatch(
      /BEGIN TRANSACTION READ ONLY; SET LOCAL search_path = "tenant space"; select \* from users LIMIT 10; COMMIT/,
    );
    expect(calls[0].includes("pg_catalog")).toBe(false);
  });

  test("does not append a duplicate LIMIT to readonly editor queries", async () => {
    activeHarness = installSpawnHarness(() => "1\n");
    const adapter = createPostgresAdapter("tenant_a");

    await adapter.executeReadonlyQueryAsync(
      "select * from users limit 5",
      [],
      10,
    );
    const calls = activeHarness.calls.map((call) => call.sql);

    expect(calls[0]).toMatch(/select \* from users limit 5; COMMIT/);
    expect(calls[0].includes("limit 5 LIMIT 10")).toBe(false);
  });

  test("invalidates the legacy column cache together with table meta cache", async () => {
    activeHarness = installSpawnHarness(mysqlStdout);
    const adapter = createMysqlAdapter();

    await adapter.getColumnsAsync("users");
    adapter.invalidateTableMetaCache?.("users");
    await adapter.getColumnsAsync("users");

    const columnQueries = activeHarness.calls.filter((call) =>
      call.sql.includes("information_schema.columns"),
    );
    expect(columnQueries).toHaveLength(2);
  });
});
