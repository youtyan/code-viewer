import { afterEach, describe, expect, test } from "bun:test";
import type { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  __clearDockerComposeContainerNameCacheForTest,
  __setDockerComposeSpawnSyncForTest,
} from "../server/database/adapters/docker-utils";
import {
  canonicalizeEsSnapshotContainer,
  isReadOnlyEsPath,
  quoteCurlConfigString,
} from "../server/database/adapters/elasticsearch";
import { canonicalizeRedisSnapshotContainer } from "../server/database/adapters/redis";
import { parseDockerDbId } from "../server/database/discovery";
import {
  handleDatabaseRoute,
  parseSelectAllTable,
} from "../server/database/handle";

type SpawnSyncLike = typeof spawnSync;

afterEach(() => {
  __setDockerComposeSpawnSyncForTest(null);
  __clearDockerComposeContainerNameCacheForTest();
});

describe("Elasticsearch read-only path allowlist", () => {
  for (const [path, expected] of [
    ["/_search", true],
    ["/_search?pretty", true],
    ["/logs-2026/_count", true],
    ["/logs-2026/_field_caps", true],
    ["/_search/somethingelse", false],
    ["/_search/_aliases", false],
    ["/logs-2026/_search/_aliases", false],
    ["/logs-2026/_bulk", false],
    ["/logs-2026/_doc/1", false],
  ] as const) {
    test(`${path} => ${expected}`, () => {
      expect(isReadOnlyEsPath(path)).toBe(expected);
    });
  }
});

describe("Elasticsearch curl config quoting", () => {
  test("escapes quotes and backslashes inside curl config strings", () => {
    expect(quoteCurlConfigString('elastic:pw"\\tail')).toBe(
      '"elastic:pw\\"\\\\tail"',
    );
  });

  for (const value of ["elastic:pw\nnext = bad", "elastic:pw\rbad"]) {
    test(`rejects control characters in ${JSON.stringify(value)}`, () => {
      let message = "";
      try {
        quoteCurlConfigString(value);
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message).toBe(
        "curl config value must not contain control characters",
      );
    });
  }
});

describe("Docker db id parsing", () => {
  test("accepts root and nested compose ids", () => {
    expect(parseDockerDbId("docker:redis")).toEqual({
      serviceName: "redis",
      relDir: "",
    });
    expect(parseDockerDbId("docker:mysql@data%2Ftest%2Fmysql:app_db")).toEqual({
      serviceName: "mysql",
      relDir: "data/test/mysql",
      database: "app_db",
    });
  });

  for (const dbId of [
    "docker:",
    "docker:bad@..%2Fsecret",
    "docker:bad@data%2F..%2Fsecret",
    "docker:bad@data%2Fsecret%00",
    "docker:mysql:bad/name",
    "docker:mysql:",
    "docker:mysql:bad\u0000db",
  ]) {
    test(`rejects unsafe id ${dbId}`, () => {
      expect(parseDockerDbId(dbId)).toBeNull();
    });
  }
});

describe("snapshot container canonicalization", () => {
  test("normalizes redis snapshot containers", () => {
    expect(canonicalizeRedisSnapshotContainer("user:*")).toBe(
      JSON.stringify({ db: 0, pattern: "user:*" }),
    );
    expect(
      canonicalizeRedisSnapshotContainer('{"db":2,"pattern":"cart:*"}'),
    ).toBe(JSON.stringify({ db: 2, pattern: "cart:*" }));
  });

  test("normalizes elasticsearch snapshot containers", () => {
    expect(canonicalizeEsSnapshotContainer("logs-*")).toBe(
      JSON.stringify({ index: "logs-*" }),
    );
    expect(
      canonicalizeEsSnapshotContainer(
        '{"index":"logs-*","query":"level:error"}',
      ),
    ).toBe(JSON.stringify({ index: "logs-*", query: "level:error" }));
  });
});

describe("empty query column inference parser", () => {
  for (const [sql, expected] of [
    ["SELECT * FROM users", "users"],
    ['select * from "public"."users"', "users"],
    ["SELECT * FROM users WHERE 1=0", null],
    ["WITH q AS (SELECT * FROM users) SELECT * FROM q", null],
    ["SELECT * FROM users UNION SELECT * FROM archived_users", null],
    ["SELECT id FROM users", null],
    ["SELECT * FROM users LIMIT 0", null],
  ] as const) {
    test(`${sql} => ${expected}`, () => {
      expect(parseSelectAllTable(sql)).toBe(expected);
    });
  }
});

describe("database close route", () => {
  test("closes stale docker ids without discovery info", async () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-close-route-"));
    try {
      const req = new Request("http://localhost/_db/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ db: "docker:redis" }),
      });
      const res = await handleDatabaseRoute(
        req,
        new URL(req.url),
        dir,
        [],
        () => true,
      );
      if (!res) throw new Error("route did not match");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("docker service unavailable route errors", () => {
  function writeCompose(dir: string): void {
    writeFileSync(
      join(dir, "docker-compose.yml"),
      [
        "services:",
        "  redis-svc:",
        "    image: redis:7",
        "  es-svc:",
        "    image: docker.elastic.co/elasticsearch/elasticsearch:8.13.0",
        "  pg-svc:",
        "    image: postgres:16",
        "    environment:",
        "      POSTGRES_DB: app",
        "",
      ].join("\n"),
    );
  }

  function mockNoRunningComposeContainers(): void {
    __setDockerComposeSpawnSyncForTest((() => ({
      status: 0,
      stdout: "[]",
      stderr: "",
    })) as unknown as SpawnSyncLike);
  }

  test("redis explorer routes return startup guidance instead of a generic 500", async () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-redis-down-"));
    try {
      writeCompose(dir);
      mockNoRunningComposeContainers();
      const req = new Request(
        "http://localhost/_db/redis/databases?db=docker:redis-svc",
      );
      const res = await handleDatabaseRoute(
        req,
        new URL(req.url),
        dir,
        [],
        () => true,
      );
      if (!res) throw new Error("route did not match");
      expect(res.status).toBe(503);
      expect(await res.text()).toBe(
        'Container for service "redis-svc" is not running. Start it with: docker compose up -d redis-svc',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("elasticsearch explorer routes return startup guidance instead of a generic 500", async () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-es-down-"));
    try {
      writeCompose(dir);
      mockNoRunningComposeContainers();
      const req = new Request(
        "http://localhost/_db/elasticsearch/indices?db=docker:es-svc",
      );
      const res = await handleDatabaseRoute(
        req,
        new URL(req.url),
        dir,
        [],
        () => true,
      );
      if (!res) throw new Error("route did not match");
      expect(res.status).toBe(503);
      expect(await res.text()).toBe(
        'Container for service "es-svc" is not running. Start it with: docker compose up -d es-svc',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("sql docker routes return startup guidance instead of a generic 500", async () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-pg-down-"));
    try {
      writeCompose(dir);
      mockNoRunningComposeContainers();
      const req = new Request(
        "http://localhost/_db/schema?db=docker:pg-svc&includeColumns=1",
      );
      const res = await handleDatabaseRoute(
        req,
        new URL(req.url),
        dir,
        [],
        () => true,
      );
      if (!res) throw new Error("route did not match");
      expect(res.status).toBe(503);
      expect(await res.text()).toBe(
        'Container for service "pg-svc" is not running. Start it with: docker compose up -d pg-svc',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("sql query routes return startup guidance instead of a JSON error blob", async () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-pg-query-down-"));
    try {
      writeCompose(dir);
      mockNoRunningComposeContainers();
      const req = new Request("http://localhost/_db/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ db: "docker:pg-svc", sql: "SELECT 1" }),
      });
      const res = await handleDatabaseRoute(
        req,
        new URL(req.url),
        dir,
        [],
        () => true,
      );
      if (!res) throw new Error("route did not match");
      expect(res.status).toBe(503);
      expect(await res.text()).toBe(
        'Container for service "pg-svc" is not running. Start it with: docker compose up -d pg-svc',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
