import { afterEach, describe, expect, test } from "bun:test";
import type { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configureExternalCommands,
  resetExternalCommandsForTest,
} from "../server/command-resolver";
import {
  __clearDockerDatabaseListCacheForTest,
  __setDockerSpawnSyncForTest,
  createDockerAdapter,
  listDockerDatabasesAsync,
} from "../server/database/adapters/docker";
import {
  __clearDockerComposeContainerNameCacheForTest,
  __clearSupabaseContainerCacheForTest,
  __setDockerComposeSpawnSyncForTest,
  resolveRunningComposeContainerNameAsync,
  resolveRunningComposeContainerNameOrThrowAsync,
  resolveRunningSupabaseDbContainerAsync,
  resolveRunningSupabaseDbContainerOrThrowAsync,
  SupabaseDbContainerUnavailableError,
} from "../server/database/adapters/docker-utils";
import { openElasticsearchAdapterAsync } from "../server/database/adapters/elasticsearch";
import { createRedisAdapter } from "../server/database/adapters/redis";
import {
  __setS3SpawnSyncForTest,
  openS3ExplorerAsync,
} from "../server/database/adapters/s3";
import type { DockerDbInfo } from "../server/database/discovery";

type SpawnSyncLike = typeof spawnSync;

const originalNow = Date.now;
const tmpRoots: string[] = [];
const DOCKER_UNAVAILABLE_PATTERN =
  /docker (?:not found in PATH|binary not found)/;

afterEach(() => {
  Date.now = originalNow;
  resetExternalCommandsForTest();
  __setDockerComposeSpawnSyncForTest(null);
  __setDockerSpawnSyncForTest(null);
  __setS3SpawnSyncForTest(null);
  __clearDockerComposeContainerNameCacheForTest();
  __clearDockerDatabaseListCacheForTest();
  __clearSupabaseContainerCacheForTest();
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
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

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(root);
  return root;
}

// ai-dup-check: allow -- fp: fakeMissingGit (git-command-errors.test.ts) と
// 同型の「コマンドが見つからないふりをするスタブ実行ファイルを作る」
// pre-existing のテストヘルパー。対象コマンドが違うので共通化しない。
function fakeMissingDocker(): string {
  const root = tempRoot("code-viewer-missing-docker-bin-");
  const path = join(root, "docker");
  writeFileSync(
    path,
    "#!/bin/sh\nprintf 'spawn docker ENOENT\\n' >&2\nexit 127\n",
  );
  chmodSync(path, 0o755);
  return path;
}

// ai-dup-check: allow -- fp: configureMissingGit (git-command-errors.test.ts)
// と同型の pre-existing ヘルパー。対象コマンドが違うので共通化しない。
function configureMissingDocker(cwd: string): void {
  const configured = configureExternalCommands({
    cwd,
    env: {},
    cliOverrides: [{ name: "docker", path: fakeMissingDocker() }],
    allowedNames: ["docker"],
  });
  expect(configured).toEqual({ ok: true });
}

// ai-dup-check: allow -- fp: s3Info (s3-adapter.test.ts) とはテスト対象の
// fixture 形状が異なる pre-existing ヘルパー。
function s3InfoWithoutHostPort(composeDir: string): DockerDbInfo {
  return {
    id: "docker:s3",
    path: "docker-compose.yml",
    name: "s3",
    sizeBytes: 0,
    kind: "s3",
    serviceName: "s3",
    image: "example/s3-with-curl:latest",
    env: {
      MINIO_ROOT_USER: "AK_TEST",
      MINIO_ROOT_PASSWORD: "SK_TEST",
    },
    composeDir,
    relDirSlash: "",
    containerPort: "9000",
  };
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

  test("throws a command-unavailable error when docker itself cannot be spawned", async () => {
    __setDockerComposeSpawnSyncForTest((() => ({
      status: null,
      stdout: "",
      stderr: "",
      error: new Error("spawn docker ENOENT"),
    })) as unknown as SpawnSyncLike);

    let error: unknown;
    try {
      await resolveRunningComposeContainerNameOrThrowAsync("db", "/app");
    } catch (err) {
      error = err;
    }
    expect(error).toBeTruthy();
    expect(error instanceof Error ? error.message : String(error)).toMatch(
      DOCKER_UNAVAILABLE_PATTERN,
    );
  });

  test("caches docker command failures longer than service-negative lookups", async () => {
    const now = { value: 1000 };
    setNow(now);
    let calls = 0;
    __setDockerComposeSpawnSyncForTest((() => {
      calls++;
      return {
        status: null,
        stdout: "",
        stderr: "",
        error: new Error("spawn docker ENOENT"),
      };
    }) as unknown as SpawnSyncLike);

    expect(
      await resolveRunningComposeContainerNameAsync("db", "/app"),
    ).toBeNull();
    expect(
      await resolveRunningComposeContainerNameAsync("redis", "/app"),
    ).toBeNull();
    expect(calls).toBe(1);

    now.value += 3_001;
    expect(
      await resolveRunningComposeContainerNameAsync("db", "/app"),
    ).toBeNull();
    expect(calls).toBe(1);

    now.value += 12_000;
    expect(
      await resolveRunningComposeContainerNameAsync("db", "/app"),
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

  test("propagates docker command failures while resolving the compose container", async () => {
    __setDockerComposeSpawnSyncForTest((() => ({
      status: null,
      stdout: "",
      stderr: "",
      error: new Error("spawn docker ENOENT"),
    })) as unknown as SpawnSyncLike);

    let error: unknown;
    try {
      await listDockerDatabasesAsync("db", "mysql", {}, "/app");
    } catch (err) {
      error = err;
    }
    expect(error).toBeTruthy();
    expect(error instanceof Error ? error.message : String(error)).toMatch(
      DOCKER_UNAVAILABLE_PATTERN,
    );
  });

  test("propagates docker command failures from docker exec", async () => {
    __setDockerComposeSpawnSyncForTest((() => ({
      status: 0,
      stdout: composeSuccess([{ service: "db", name: "db-container" }]),
      stderr: "",
    })) as unknown as SpawnSyncLike);
    __setDockerSpawnSyncForTest((() => ({
      status: null,
      stdout: "",
      stderr: "",
      error: new Error("spawn docker ENOENT"),
    })) as unknown as SpawnSyncLike);

    let error: unknown;
    try {
      await listDockerDatabasesAsync("db", "mysql", {}, "/app");
    } catch (err) {
      error = err;
    }
    expect(error).toBeTruthy();
    expect(error instanceof Error ? error.message : String(error)).toMatch(
      DOCKER_UNAVAILABLE_PATTERN,
    );
  });

  test("propagates docker command failures from optional SQL metadata", async () => {
    __setDockerSpawnSyncForTest((() => ({
      status: null,
      stdout: "",
      stderr: "",
      error: new Error("spawn docker ENOENT"),
    })) as unknown as SpawnSyncLike);
    const adapter = createDockerAdapter({
      kind: "mysql",
      containerName: "db-container",
      user: "sample_user",
      password: "",
      database: "sample_database",
    });

    let ddlError: unknown;
    try {
      await adapter.getCreateStatementAsync("sample_table");
    } catch (err) {
      ddlError = err;
    }
    expect(ddlError).toBeTruthy();
    expect(
      ddlError instanceof Error ? ddlError.message : String(ddlError),
    ).toMatch(/docker not found in PATH/);

    let triggersError: unknown;
    try {
      await adapter.getTriggersAsync("sample_table");
    } catch (err) {
      triggersError = err;
    }
    expect(triggersError).toBeTruthy();
    expect(
      triggersError instanceof Error
        ? triggersError.message
        : String(triggersError),
    ).toMatch(/docker not found in PATH/);
  });
});

describe("docker command failures in document/kv/object adapters", () => {
  test("propagates docker command failures from Redis public reads", async () => {
    const cwd = tempRoot("code-viewer-missing-docker-redis-");
    configureMissingDocker(cwd);
    const adapter = createRedisAdapter({
      containerName: "redis-container",
      password: "",
    });

    let error: unknown;
    try {
      await adapter.listDatabasesAsync();
    } catch (err) {
      error = err;
    }
    expect(error).toBeTruthy();
    expect(error instanceof Error ? error.message : String(error)).toMatch(
      DOCKER_UNAVAILABLE_PATTERN,
    );
  });

  test("propagates docker command failures from Elasticsearch public reads", async () => {
    const cwd = tempRoot("code-viewer-missing-docker-es-");
    configureMissingDocker(cwd);
    __setDockerComposeSpawnSyncForTest((() => ({
      status: 0,
      stdout: composeSuccess([{ service: "es", name: "es-container" }]),
      stderr: "",
    })) as unknown as SpawnSyncLike);
    const adapter = await openElasticsearchAdapterAsync("es", {}, cwd);

    let error: unknown;
    try {
      await adapter.listIndicesAsync();
    } catch (err) {
      error = err;
    }
    expect(error).toBeTruthy();
    expect(error instanceof Error ? error.message : String(error)).toMatch(
      DOCKER_UNAVAILABLE_PATTERN,
    );
  });

  test("propagates docker command failures from S3 public reads", async () => {
    const cwd = tempRoot("code-viewer-missing-docker-s3-");
    __setDockerComposeSpawnSyncForTest((() => ({
      status: 0,
      stdout: composeSuccess([{ service: "s3", name: "s3-container" }]),
      stderr: "",
    })) as unknown as SpawnSyncLike);
    __setS3SpawnSyncForTest((() => ({
      status: null,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
      error: new Error("spawn docker ENOENT"),
    })) as unknown as SpawnSyncLike);
    const adapter = await openS3ExplorerAsync(s3InfoWithoutHostPort(cwd));

    let error: unknown;
    try {
      await adapter.listBuckets();
    } catch (err) {
      error = err;
    }
    expect(error).toBeTruthy();
    expect(error instanceof Error ? error.message : String(error)).toMatch(
      DOCKER_UNAVAILABLE_PATTERN,
    );
  });
});

function dockerPsSuccess(names: string[]): string {
  return JSON.stringify(
    names.map((name) => ({ Names: name, State: "running" })),
  );
}

describe("supabase CLI container resolution", () => {
  test("resolves the container name when docker ps reports it running", async () => {
    const calls: string[][] = [];
    __setDockerComposeSpawnSyncForTest(((_command: string, args: string[]) => {
      calls.push(args);
      return {
        status: 0,
        stdout: dockerPsSuccess(["supabase_db_hojo"]),
        stderr: "",
      };
    }) as unknown as SpawnSyncLike);

    const containerName = await resolveRunningSupabaseDbContainerAsync("hojo");
    expect(containerName).toBe("supabase_db_hojo");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.includes("name=^/supabase_db_hojo$")).toBe(true);
    expect(calls[0]?.includes("label=com.supabase.cli.project=hojo")).toBe(
      true,
    );
  });

  test("returns null when no container matches name+label", async () => {
    __setDockerComposeSpawnSyncForTest((() => ({
      status: 0,
      stdout: dockerPsSuccess([]),
      stderr: "",
    })) as unknown as SpawnSyncLike);

    expect(await resolveRunningSupabaseDbContainerAsync("hojo")).toBeNull();
  });

  test("caches positive lookups for 15 seconds and negative for 3 seconds", async () => {
    const now = { value: 1000 };
    setNow(now);
    let running = false;
    let calls = 0;
    __setDockerComposeSpawnSyncForTest((() => {
      calls++;
      return {
        status: 0,
        stdout: dockerPsSuccess(running ? ["supabase_db_hojo"] : []),
        stderr: "",
      };
    }) as unknown as SpawnSyncLike);

    expect(await resolveRunningSupabaseDbContainerAsync("hojo")).toBeNull();
    expect(await resolveRunningSupabaseDbContainerAsync("hojo")).toBeNull();
    expect(calls).toBe(1);

    now.value += 2_999;
    running = true;
    expect(await resolveRunningSupabaseDbContainerAsync("hojo")).toBeNull();
    expect(calls).toBe(1);

    now.value += 2;
    expect(await resolveRunningSupabaseDbContainerAsync("hojo")).toBe(
      "supabase_db_hojo",
    );
    expect(calls).toBe(2);

    now.value += 14_999;
    expect(await resolveRunningSupabaseDbContainerAsync("hojo")).toBe(
      "supabase_db_hojo",
    );
    expect(calls).toBe(2);

    now.value += 2;
    expect(await resolveRunningSupabaseDbContainerAsync("hojo")).toBe(
      "supabase_db_hojo",
    );
    expect(calls).toBe(3);
  });

  test("resolveRunningSupabaseDbContainerOrThrowAsync throws when not running", async () => {
    __setDockerComposeSpawnSyncForTest((() => ({
      status: 0,
      stdout: dockerPsSuccess([]),
      stderr: "",
    })) as unknown as SpawnSyncLike);

    let error: unknown;
    try {
      await resolveRunningSupabaseDbContainerOrThrowAsync("hojo");
    } catch (err) {
      error = err;
    }
    expect(error instanceof SupabaseDbContainerUnavailableError).toBe(true);
  });

  test("throws a command-unavailable error when docker itself cannot be spawned", async () => {
    const cwd = tempRoot("code-viewer-missing-docker-supabase-");
    configureMissingDocker(cwd);

    let error: unknown;
    try {
      await resolveRunningSupabaseDbContainerAsync("hojo");
    } catch (err) {
      error = err;
    }
    expect(error).toBeTruthy();
    expect(error instanceof Error ? error.message : String(error)).toMatch(
      DOCKER_UNAVAILABLE_PATTERN,
    );
  });
});
