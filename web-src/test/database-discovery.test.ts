import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverDockerDatabases } from "../server/database/discovery";

function discoverFromCompose(
  compose: string,
  extraFiles: Record<string, string> = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "code-viewer-compose-discovery-"));
  try {
    writeFileSync(join(dir, "docker-compose.yml"), compose, "utf8");
    for (const [path, content] of Object.entries(extraFiles)) {
      writeFileSync(join(dir, path), content, "utf8");
    }
    return discoverDockerDatabases(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function withProcessEnv<T>(key: string, value: string, fn: () => T): T {
  const previous = process.env[key];
  process.env[key] = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
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
      - '$CV_TEST_DB_PORT:3306'
    environment:
      MYSQL_DATABASE: $CV_TEST_DB_NAME
      MYSQL_ROOT_PASSWORD: '$CV_TEST_DB_PASSWORD'
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

  test("resolves $VAR environment values from process.env", () => {
    withProcessEnv("CV_TEST_MYSQL_PASSWORD", "host-password", () => {
      const results = discoverFromCompose(`
services:
  db:
    image: mysql:8
    environment:
      MYSQL_ROOT_PASSWORD: '$CV_TEST_MYSQL_PASSWORD'
`);

      expect(results).toHaveLength(1);
      expect(results[0]?.env.MYSQL_ROOT_PASSWORD).toBe("host-password");
    });
  });

  test("resolves $VAR environment values from compose directory .env", () => {
    const results = discoverFromCompose(
      `
services:
  db:
    image: mysql:8
    environment:
      MYSQL_ROOT_PASSWORD: '$CV_TEST_MYSQL_PASSWORD'
`,
      {
        ".env": "CV_TEST_MYSQL_PASSWORD=file-password\n",
      },
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.env.MYSQL_ROOT_PASSWORD).toBe("file-password");
  });

  test("prefers process.env over compose directory .env", () => {
    withProcessEnv("CV_TEST_MYSQL_PASSWORD", "host-password", () => {
      const results = discoverFromCompose(
        `
services:
  db:
    image: mysql:8
    environment:
      MYSQL_ROOT_PASSWORD: '$CV_TEST_MYSQL_PASSWORD'
`,
        {
          ".env": "CV_TEST_MYSQL_PASSWORD=file-password\n",
        },
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.env.MYSQL_ROOT_PASSWORD).toBe("host-password");
    });
  });

  test("parses compose directory .env quotes comments and export prefixes", () => {
    const results = discoverFromCompose(
      `
services:
  db:
    image: mysql:8
    environment:
      MYSQL_ROOT_PASSWORD: $CV_TEST_MYSQL_PASSWORD
      MYSQL_DATABASE: $CV_TEST_MYSQL_DATABASE
      MYSQL_USER: $CV_TEST_MYSQL_USER
`,
      {
        ".env": [
          "export CV_TEST_MYSQL_PASSWORD='quoted-password'",
          "CV_TEST_MYSQL_DATABASE=app_db # local database",
          'CV_TEST_MYSQL_USER="app-user"',
          "CV_TEST_UNUSED_DOTENV=unused-value",
          "",
        ].join("\n"),
      },
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.env.MYSQL_ROOT_PASSWORD).toBe("quoted-password");
    expect(results[0]?.env.MYSQL_DATABASE).toBe("app_db");
    expect(results[0]?.env.MYSQL_USER).toBe("app-user");
    expect(results[0]?.env.CV_TEST_UNUSED_DOTENV).toBeUndefined();
  });
});
