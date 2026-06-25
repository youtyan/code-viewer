import { afterEach, describe, expect, test } from "bun:test";
import type { spawnSync } from "node:child_process";
import {
  __clearDockerDatabaseListCacheForTest,
  __setDockerSpawnSyncForTest,
  listDockerDatabasesAsync,
} from "../server/database/adapters/docker";
import {
  __clearDockerComposeContainerNameCacheForTest,
  __setDockerComposeSpawnSyncForTest,
  resolveRunningComposeContainerNameAsync,
} from "../server/database/adapters/docker-utils";

type SpawnSyncLike = typeof spawnSync;

const originalNow = Date.now;

afterEach(() => {
  Date.now = originalNow;
  __setDockerComposeSpawnSyncForTest(null);
  __setDockerSpawnSyncForTest(null);
  __clearDockerComposeContainerNameCacheForTest();
  __clearDockerDatabaseListCacheForTest();
});

function setNow(msRef: { value: number }): void {
  Date.now = () => msRef.value;
}

function composeSuccess(
  services: Array<{ service: string; name: string }>,
): string {
  return JSON.stringify(
    services.map((service) => ({
      Service: service.service,
      Name: service.name,
      State: "running",
    })),
  );
}

describe("docker compose container name cache", () => {
  test("caches positive lookups by service and cwd for 30 seconds", async () => {
    const now = { value: 1000 };
    setNow(now);
    const calls: string[] = [];
    __setDockerComposeSpawnSyncForTest(((
      _command: string,
      _args: string[],
      options?: { cwd?: string },
    ) => {
      calls.push(options?.cwd || "");
      return {
        status: 0,
        stdout: composeSuccess([
          { service: "db", name: `db-container-${calls.length}` },
        ]),
        stderr: "",
      };
    }) as unknown as SpawnSyncLike);

    expect(await resolveRunningComposeContainerNameAsync("db", "/app-a")).toBe(
      "db-container-1",
    );
    expect(await resolveRunningComposeContainerNameAsync("db", "/app-a")).toBe(
      "db-container-1",
    );
    expect(calls).toHaveLength(1);

    expect(await resolveRunningComposeContainerNameAsync("db", "/app-b")).toBe(
      "db-container-2",
    );
    expect(calls).toEqual(["/app-a", "/app-b"]);

    now.value += 30_000;
    expect(await resolveRunningComposeContainerNameAsync("db", "/app-a")).toBe(
      "db-container-3",
    );
    expect(calls).toHaveLength(3);
  });

  test("caches negative lookups for 3 seconds", async () => {
    const now = { value: 1000 };
    setNow(now);
    let running = false;
    let calls = 0;
    __setDockerComposeSpawnSyncForTest((() => {
      calls++;
      if (!running) return { status: 1, stdout: "", stderr: "not running" };
      return {
        status: 0,
        stdout: composeSuccess([{ service: "db", name: "db-container" }]),
        stderr: "",
      };
    }) as unknown as SpawnSyncLike);

    expect(
      await resolveRunningComposeContainerNameAsync("db", "/app"),
    ).toBeNull();
    expect(
      await resolveRunningComposeContainerNameAsync("db", "/app"),
    ).toBeNull();
    expect(calls).toBe(1);

    now.value += 2_999;
    expect(
      await resolveRunningComposeContainerNameAsync("db", "/app"),
    ).toBeNull();
    expect(calls).toBe(1);

    now.value += 2;
    running = true;
    expect(await resolveRunningComposeContainerNameAsync("db", "/app")).toBe(
      "db-container",
    );
    expect(calls).toBe(2);
  });

  test("shares docker daemon failures across services in the same compose cwd", async () => {
    const now = { value: 1000 };
    setNow(now);
    let calls = 0;
    __setDockerComposeSpawnSyncForTest((() => {
      calls++;
      return {
        status: 1,
        stdout: "",
        stderr: "Cannot connect to the Docker daemon",
      };
    }) as unknown as SpawnSyncLike);

    expect(
      await resolveRunningComposeContainerNameAsync("db", "/app"),
    ).toBeNull();
    expect(
      await resolveRunningComposeContainerNameAsync("redis", "/app"),
    ).toBeNull();
    expect(
      await resolveRunningComposeContainerNameAsync("minio", "/app"),
    ).toBeNull();
    expect(calls).toBe(1);

    expect(
      await resolveRunningComposeContainerNameAsync("db", "/other"),
    ).toBeNull();
    expect(calls).toBe(2);
  });
});

describe("docker database list cache", () => {
  test("caches successful database lists for 15 seconds", async () => {
    const now = { value: 1000 };
    setNow(now);
    let composeCalls = 0;
    let execCalls = 0;
    __setDockerComposeSpawnSyncForTest((() => {
      composeCalls++;
      return {
        status: 0,
        stdout: composeSuccess([{ service: "db", name: "db-container" }]),
        stderr: "",
      };
    }) as unknown as SpawnSyncLike);
    __setDockerSpawnSyncForTest((() => {
      execCalls++;
      const databases =
        execCalls === 1
          ? ["schema_name", "app", "analytics"]
          : ["schema_name", "fresh"];
      return { status: 0, stdout: databases.join("\n"), stderr: "" };
    }) as unknown as SpawnSyncLike);

    expect(await listDockerDatabasesAsync("db", "mysql", {}, "/app")).toEqual([
      "app",
      "analytics",
    ]);
    expect(await listDockerDatabasesAsync("db", "mysql", {}, "/app")).toEqual([
      "app",
      "analytics",
    ]);
    expect(execCalls).toBe(1);
    expect(composeCalls).toBe(1);

    now.value += 14_999;
    expect(await listDockerDatabasesAsync("db", "mysql", {}, "/app")).toEqual([
      "app",
      "analytics",
    ]);
    expect(execCalls).toBe(1);

    now.value += 2;
    expect(await listDockerDatabasesAsync("db", "mysql", {}, "/app")).toEqual([
      "fresh",
    ]);
    expect(execCalls).toBe(2);
    expect(composeCalls).toBe(1);
  });

  test("does not cache default database fallbacks but caches empty failures", async () => {
    const now = { value: 1000 };
    setNow(now);
    let execCalls = 0;
    __setDockerComposeSpawnSyncForTest((() => ({
      status: 0,
      stdout: composeSuccess([
        { service: "db", name: "db-container" },
        { service: "empty", name: "empty-container" },
      ]),
      stderr: "",
    })) as unknown as SpawnSyncLike);
    __setDockerSpawnSyncForTest((() => {
      execCalls++;
      return { status: 1, stdout: "", stderr: "query failed" };
    }) as unknown as SpawnSyncLike);

    expect(
      await listDockerDatabasesAsync(
        "db",
        "mysql",
        { MYSQL_DATABASE: "app" },
        "/app",
      ),
    ).toEqual(["app"]);
    expect(
      await listDockerDatabasesAsync(
        "db",
        "mysql",
        { MYSQL_DATABASE: "app" },
        "/app",
      ),
    ).toEqual(["app"]);
    expect(execCalls).toBe(2);

    expect(
      await listDockerDatabasesAsync("empty", "mysql", {}, "/app"),
    ).toEqual([]);
    expect(
      await listDockerDatabasesAsync("empty", "mysql", {}, "/app"),
    ).toEqual([]);
    expect(execCalls).toBe(3);

    now.value += 3_000;
    expect(
      await listDockerDatabasesAsync("empty", "mysql", {}, "/app"),
    ).toEqual([]);
    expect(execCalls).toBe(4);
  });
});
