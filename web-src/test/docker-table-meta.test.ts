import { afterEach, describe, expect, test } from "bun:test";
import { createDockerAdapter } from "../server/database/adapters/docker";

type SpawnCall = {
  sql: string;
  startedAt: number;
};

type SpawnHarness = {
  calls: SpawnCall[];
  restore(): void;
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
});

function mysqlStdout(sql: string): string {
  if (sql.includes("information_schema.columns")) {
    return [
      "column_name\tcolumn_type\tis_nullable\tcolumn_default\tcolumn_key",
      "id\tint\tNO\tNULL\tPRI",
      "name\tvarchar(255)\tYES\tNULL\t",
    ].join("\n");
  }
  if (sql.includes("COUNT(*)")) {
    return ["cnt", "7"].join("\n");
  }
  return ["id\tname", "1\tAda"].join("\n");
}

function installSpawnHarness(): SpawnHarness {
  const bunGlobal = globalThis as unknown as { Bun: { spawn: SpawnLike } };
  const originalSpawn = bunGlobal.Bun.spawn;
  const calls: SpawnCall[] = [];
  bunGlobal.Bun.spawn = ((args: string[]) => {
    const sql = args[args.length - 1] || "";
    calls.push({ sql, startedAt: performance.now() });
    return {
      exited: new Promise<number>((resolve) => {
        setTimeout(() => resolve(0), 20);
      }),
      stdout: new Response(mysqlStdout(sql)).body,
      stderr: new Response("").body,
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

describe("docker table meta queries", () => {
  test("starts columns, data, and count queries before awaiting table data", async () => {
    activeHarness = installSpawnHarness();
    const adapter = createMysqlAdapter();

    const pending = adapter.getTablePageWithMeta("users", {
      offset: 0,
      limit: 25,
    });

    expect(activeHarness.calls).toHaveLength(3);
    const result = await pending;
    const sql = activeHarness.calls.map((call) => call.sql);

    expect(sql[0]).toMatch(/information_schema\.columns/);
    expect(sql[1]).toBe("SELECT * FROM `users` LIMIT 25 OFFSET 0");
    expect(sql[2]).toBe("SELECT COUNT(*) AS cnt FROM `users`");
    expect(result.columns.map((column) => column.name)).toEqual(["id", "name"]);
    expect(result.rows).toEqual([["1", "Ada"]]);
    expect(result.rowCount).toBe(1);
    expect(result.totalRows).toBe(7);
  });

  test("starts filtered columns, data, and count queries together", async () => {
    activeHarness = installSpawnHarness();
    const adapter = createMysqlAdapter();

    const pending = adapter.getFilteredTablePageWithMeta("users", {
      offset: 5,
      limit: 10,
      grouped: new Map([["Ada", ["name"]]]),
    });

    expect(activeHarness.calls).toHaveLength(3);
    const result = await pending;
    const sql = activeHarness.calls.map((call) => call.sql);

    expect(sql[1]).toMatch(/WHERE CAST\(`name` AS CHAR\) LIKE '%Ada%'/);
    expect(sql[1]).toMatch(/LIMIT 10 OFFSET 5/);
    expect(sql[2]).toMatch(/WHERE CAST\(`name` AS CHAR\) LIKE '%Ada%'/);
    expect(result.totalRows).toBe(7);
  });
});
