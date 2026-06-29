import { afterEach, describe, expect, test } from "bun:test";
import type { spawnSync } from "node:child_process";
import {
  __clearDockerSchemaListCacheForTest,
  __setDockerSpawnSyncForTest,
  listDockerSchemasAsync,
} from "../server/database/adapters/docker";
import {
  __clearDockerComposeContainerNameCacheForTest,
  __setDockerComposeSpawnSyncForTest,
} from "../server/database/adapters/docker-utils";

type SpawnSyncLike = typeof spawnSync;

afterEach(() => {
  __setDockerComposeSpawnSyncForTest(null);
  __setDockerSpawnSyncForTest(null);
  __clearDockerComposeContainerNameCacheForTest();
  __clearDockerSchemaListCacheForTest();
});

function setupRunningContainer(): void {
  __setDockerComposeSpawnSyncForTest((() => ({
    status: 0,
    stdout: JSON.stringify([
      { Service: "db", Name: "code-viewer-db-1", State: "running" },
    ]),
    stderr: "",
  })) as unknown as SpawnSyncLike);
}

describe("listDockerSchemasAsync - psql 末尾 \\n の扱い", () => {
  test("1 行クエリ (public のみ) で末尾 \\n が schema 名に紛れ込まない", async () => {
    // psql は `-R \x1e` を指定しても最終行の後ろには sep を付けず、stdout
    // 末尾に必ず \n を 1 つ追加する。`public\n` がそのまま値として残ると
    // クライアントが `schema=public%0A` を送って 400 になる回帰バグの再現。
    setupRunningContainer();
    __setDockerSpawnSyncForTest((() => ({
      status: 0,
      stdout: "public\n",
      stderr: "",
    })) as unknown as SpawnSyncLike);
    const schemas = await listDockerSchemasAsync(
      "db",
      "postgresql",
      { POSTGRES_USER: "postgres", POSTGRES_PASSWORD: "" },
      "/app",
    );
    expect(schemas).toEqual(["public"]);
  });

  test("複数行 (RS 区切り + 末尾 \\n) でも正しくパースされる", async () => {
    setupRunningContainer();
    __setDockerSpawnSyncForTest((() => ({
      status: 0,
      stdout: "public\x1eapp_schema\n",
      stderr: "",
    })) as unknown as SpawnSyncLike);
    const schemas = await listDockerSchemasAsync(
      "db",
      "postgresql",
      { POSTGRES_USER: "postgres", POSTGRES_PASSWORD: "" },
      "/app",
    );
    expect(schemas).toEqual(["public", "app_schema"]);
  });
});
