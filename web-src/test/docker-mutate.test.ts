// PostgreSQL / MySQL の書き込みパス (applyMutations) を spawn モックで検証する。
// 実 docker は不要。生成される「1 トランザクションにまとめた SQL」と、エラー時に
// 例外へ変換されることを確認する (実行は CLI なのでリテラル埋め込み)。
import { afterEach, describe, expect, test } from "bun:test";
import type { RowMutation } from "../core/database/types";
import {
  __setDockerSpawnSyncForTest,
  createDockerAdapter,
} from "../server/database/adapters/docker";

const PG_RS = "\x1e";

type SpawnLike = (
  args: string[],
  opts?: Record<string, unknown>,
) => {
  exited: Promise<number>;
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  kill(signal?: string): void;
};

type Harness = { calls: string[]; restore(): void };

function installSpawn(
  resultForSql: (sql: string) => {
    stdout?: string;
    stderr?: string;
    code?: number;
  },
): Harness {
  const bunGlobal = globalThis as unknown as { Bun: { spawn: SpawnLike } };
  const original = bunGlobal.Bun.spawn;
  const calls: string[] = [];
  bunGlobal.Bun.spawn = ((args: string[]) => {
    const sql = args[args.length - 1] || "";
    calls.push(sql);
    const r = resultForSql(sql);
    return {
      exited: new Promise<number>((resolve) =>
        setTimeout(() => resolve(r.code ?? 0), 5),
      ),
      stdout: new Response(r.stdout ?? "").body,
      stderr: new Response(r.stderr ?? "").body,
      kill() {
        /* noop */
      },
    };
  }) as SpawnLike;
  return {
    calls,
    restore() {
      bunGlobal.Bun.spawn = original;
    },
  };
}

let harness: Harness | null = null;
afterEach(() => {
  harness?.restore();
  harness = null;
  __setDockerSpawnSyncForTest(null);
});

const PG_COLUMNS = ["id\tinteger\tNO\t\tYES", "name\ttext\tYES\t\tNO"].join(
  PG_RS,
);
const MYSQL_COLUMNS = [
  "column_name\tcolumn_type\tis_nullable\tcolumn_default\tcolumn_key",
  "id\tint\tNO\tNULL\tPRI",
  "name\tvarchar(255)\tYES\tNULL\t",
].join("\n");

const MUTATIONS: RowMutation[] = [
  {
    kind: "insert",
    values: [
      { column: "id", value: "7" },
      { column: "name", value: "O'Brien" },
    ],
  },
  {
    kind: "update",
    pk: [{ column: "id", value: "1" }],
    values: [{ column: "name", value: "Ann" }],
  },
  { kind: "delete", pk: [{ column: "id", value: "2" }] },
];

function pgAdapter() {
  return createDockerAdapter({
    kind: "postgresql",
    containerName: "db",
    user: "postgres",
    password: "pw",
    database: "app",
    schema: "tenant_a",
  });
}

function mysqlAdapter() {
  return createDockerAdapter({
    kind: "mysql",
    containerName: "db",
    user: "root",
    password: "pw",
    database: "app",
  });
}

describe("docker applyMutations", () => {
  test("postgresql wraps statements in a transaction with search_path", async () => {
    harness = installSpawn((sql) =>
      sql.includes("information_schema.columns")
        ? { stdout: PG_COLUMNS }
        : { stdout: "" },
    );
    const adapter = pgAdapter();
    const result = await adapter.applyMutations?.("users", MUTATIONS);
    expect(result?.affected).toBe(3);
    const write = harness.calls.find((s) => s.includes("BEGIN;"));
    expect(write !== undefined).toBeTruthy();
    const sql = write as string;
    expect(sql).toMatch('SET LOCAL search_path = "tenant_a"');
    expect(sql).toMatch(
      `INSERT INTO "users" ("id", "name") VALUES (7, 'O''Brien')`,
    );
    expect(sql).toMatch(`UPDATE "users" SET "name" = 'Ann' WHERE "id" = 1`);
    expect(sql).toMatch(`DELETE FROM "users" WHERE "id" = 2`);
    expect(sql).toMatch(/COMMIT$/);
  });

  test("mysql wraps statements in START TRANSACTION/COMMIT with backticks", async () => {
    harness = installSpawn((sql) =>
      sql.includes("information_schema.columns")
        ? { stdout: MYSQL_COLUMNS }
        : { stdout: "" },
    );
    const adapter = mysqlAdapter();
    const result = await adapter.applyMutations?.("users", MUTATIONS);
    expect(result?.affected).toBe(3);
    const write = harness.calls.find((s) => s.includes("START TRANSACTION"));
    expect(write !== undefined).toBeTruthy();
    const sql = write as string;
    expect(sql).toMatch(
      "INSERT INTO `users` (`id`, `name`) VALUES (7, 'O''Brien')",
    );
    expect(sql).toMatch("UPDATE `users` SET `name` = 'Ann' WHERE `id` = 1");
    expect(sql).toMatch("DELETE FROM `users` WHERE `id` = 2");
    expect(sql).toMatch(/COMMIT$/);
  });

  test("postgresql boolean column renders TRUE/FALSE through applyMutations", async () => {
    // 回帰防止 (round-1 修正): boolean 列を `= 1` にすると PG が型エラーで弾く。
    const PG_BOOL_COLUMNS = [
      "id\tinteger\tNO\t\tYES",
      "active\tboolean\tYES\t\tNO",
    ].join(PG_RS);
    harness = installSpawn((sql) =>
      sql.includes("information_schema.columns")
        ? { stdout: PG_BOOL_COLUMNS }
        : { stdout: "" },
    );
    const adapter = pgAdapter();
    await adapter.applyMutations?.("flags", [
      {
        kind: "insert",
        values: [
          { column: "id", value: "1" },
          { column: "active", value: "true" },
        ],
      },
      {
        kind: "update",
        pk: [{ column: "id", value: "2" }],
        values: [{ column: "active", value: "0" }],
      },
    ]);
    const write = harness.calls.find((s) => s.includes("BEGIN;")) as string;
    expect(write).toMatch(
      'INSERT INTO "flags" ("id", "active") VALUES (1, TRUE)',
    );
    expect(write).toMatch('UPDATE "flags" SET "active" = FALSE WHERE "id" = 2');
    // 整数リテラルになっていないこと。
    expect(/"active" = 1\b/.test(write)).toBe(false);
  });

  test("a CLI error (non-zero exit) is turned into a thrown error", async () => {
    harness = installSpawn((sql) =>
      sql.includes("information_schema.columns")
        ? { stdout: PG_COLUMNS }
        : { stdout: "", stderr: "duplicate key value", code: 1 },
    );
    const adapter = pgAdapter();
    let message = "";
    try {
      await adapter.applyMutations?.("users", MUTATIONS);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/duplicate key/);
  });
});
