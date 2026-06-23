import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverDockerDatabases } from "../server/database/discovery";

function discoverFromCompose(compose: string) {
  const dir = mkdtempSync(join(tmpdir(), "code-viewer-compose-discovery-"));
  try {
    writeFileSync(join(dir, "docker-compose.yml"), compose, "utf8");
    return discoverDockerDatabases(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("docker compose database discovery", () => {
  test("detects mysql from build-only service environment", () => {
    const results = discoverFromCompose(`
services:
  db:
    build:
      context: ./docker/db
      dockerfile: Dockerfile
    ports:
      - '$RERAKU_V2_DATABASE_PORT:3306'
    environment:
      MYSQL_DATABASE: $RERAKU_V2_DATABASE_NAME
      MYSQL_ROOT_PASSWORD: '$RERAKU_V2_DATABASE_PASSWORD'
`);

    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe("mysql");
    expect(results[0]?.serviceName).toBe("db");
    expect(results[0]?.name).toMatch(/build:mysql/);
    expect(results[0]?.name).toMatch(/localhost:3306/);
  });

  test("detects postgresql from build-only service environment", () => {
    const results = discoverFromCompose(`
services:
  app-db:
    build:
      context: ./docker/postgres
    environment:
      POSTGRES_USER: app
`);

    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe("postgresql");
    expect(results[0]?.name).toMatch(/build:postgresql/);
  });

  test("detects mysql from build-only service container port", () => {
    const results = discoverFromCompose(`
services:
  storage:
    build:
      context: ./docker/db
    ports:
      - ':3306'
`);

    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe("mysql");
    expect(results[0]?.name).toMatch(/build:mysql/);
  });

  test("detects mysql from build-only service name", () => {
    const results = discoverFromCompose(`
services:
  mariadb:
    build:
      context: ./docker/db
`);

    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe("mysql");
    expect(results[0]?.name).toMatch(/build:mysql/);
  });

  test("skips build-only service without database signals", () => {
    const results = discoverFromCompose(`
services:
  worker:
    build:
      context: ./docker/worker
`);

    expect(results).toHaveLength(0);
  });

  test("keeps image detection ahead of fallback signals", () => {
    const results = discoverFromCompose(`
services:
  cache:
    image: redis:6.2.6
    environment:
      MYSQL_DATABASE: app
`);

    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe("redis");
    expect(results[0]?.name).toMatch(/redis:6.2.6/);
  });
});
