import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverDockerDatabasesAsync,
  discoverSqliteFilesAsync,
  discoverSupabaseCliProjectsAsync,
  parseSupabaseDbId,
  validateDbPath,
} from "../server/database/discovery";

async function discoverFromCompose(
  compose: string,
  extraFiles: Record<string, string> = {},
): Promise<Awaited<ReturnType<typeof discoverDockerDatabasesAsync>>> {
  const dir = mkdtempSync(join(tmpdir(), "code-viewer-compose-discovery-"));
  try {
    writeFileSync(join(dir, "docker-compose.yml"), compose, "utf8");
    for (const [path, content] of Object.entries(extraFiles)) {
      writeFileSync(join(dir, path), content, "utf8");
    }
    return await discoverDockerDatabasesAsync(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function withProcessEnv<T>(
  key: string,
  value: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const previous = process.env[key];
  process.env[key] = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
}

function writeSqliteHeader(path: string) {
  writeFileSync(path, `${"SQLite format 3\0"}test`, "binary");
}

describe("sqlite database discovery", () => {
  test("ignores code-viewer internal sqlite files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-sqlite-discovery-"));
    try {
      mkdirSync(join(dir, ".code-viewer"));
      writeSqliteHeader(join(dir, "app.sqlite"));
      writeSqliteHeader(join(dir, ".code-viewer", "db-snapshots.sqlite"));

      expect(await discoverSqliteFilesAsync(dir, [])).toEqual([
        {
          path: "app.sqlite",
          name: "app.sqlite",
          sizeBytes: 20,
        },
      ]);
      expect(
        validateDbPath(dir, ".code-viewer/db-snapshots.sqlite"),
      ).toBeNull();
      expect(validateDbPath(dir, "app.sqlite")).toBe(
        realpathSync(join(dir, "app.sqlite")),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("does not cache sqlite discovery results after abort", async () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-sqlite-abort-"));
    try {
      writeSqliteHeader(join(dir, "app.sqlite"));
      const controller = new AbortController();
      controller.abort();

      expect(
        await discoverSqliteFilesAsync(dir, [], controller.signal),
      ).toEqual([]);
      expect(await discoverSqliteFilesAsync(dir, [])).toEqual([
        {
          path: "app.sqlite",
          name: "app.sqlite",
          sizeBytes: 20,
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("docker compose database discovery", () => {
  test("does not cache docker discovery results after abort", async () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-docker-abort-"));
    try {
      writeFileSync(
        join(dir, "docker-compose.yml"),
        `
services:
  db:
    image: postgres:16
`,
      );
      const controller = new AbortController();
      controller.abort();

      expect(
        await discoverDockerDatabasesAsync(dir, [], controller.signal),
      ).toEqual([]);
      const results = await discoverDockerDatabasesAsync(dir);
      expect(results).toHaveLength(1);
      expect(results[0]?.kind).toBe("postgresql");
      expect(results[0]?.serviceName).toBe("db");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("detects mysql from build-only service environment", async () => {
    const results = await discoverFromCompose(`
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

  test("detects postgresql from build-only service environment", async () => {
    const results = await discoverFromCompose(`
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

  test("detects mysql from build-only service container port", async () => {
    const results = await discoverFromCompose(`
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

  test("detects mysql from build-only service name", async () => {
    const results = await discoverFromCompose(`
services:
  mariadb:
    build:
      context: ./docker/db
`);

    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe("mysql");
    expect(results[0]?.name).toMatch(/build:mysql/);
  });

  test("skips build-only service without database signals", async () => {
    const results = await discoverFromCompose(`
services:
  worker:
    build:
      context: ./docker/worker
`);

    expect(results).toHaveLength(0);
  });

  test("keeps image detection ahead of fallback signals", async () => {
    const results = await discoverFromCompose(`
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

  test("detects MinIO as S3 and prefers the API port over the console port", async () => {
    const results = await discoverFromCompose(`
services:
  minio:
    image: quay.io/minio/minio:latest
    ports:
      - "9001:9001"
      - "19000:9000"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
`);

    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe("s3");
    expect(results[0]?.serviceName).toBe("minio");
    expect(results[0]?.hostPort).toBe("19000");
    expect(results[0]?.name).toMatch(/localhost:19000/);
  });

  test("detects MinIO API port from published port ranges", async () => {
    const results = await discoverFromCompose(`
services:
  s3:
    image: minio/minio:latest
    ports:
      - "9000-9001:9000-9001"
`);

    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe("s3");
    expect(results[0]?.hostPort).toBe("9000");
    expect(results[0]?.containerPort).toBe("9000");
    expect(results[0]?.name).toMatch(/localhost:9000/);
  });

  test("detects MinIO API port from broad published port ranges", async () => {
    const results = await discoverFromCompose(`
services:
  s3:
    image: minio/minio:latest
    ports:
      - "9000-9200:9000-9200"
`);

    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe("s3");
    expect(results[0]?.hostPort).toBe("9000");
    expect(results[0]?.containerPort).toBe("9000");
  });

  test("detects MinIO API port from environment-expanded port mappings", async () => {
    const results = await discoverFromCompose(
      `
services:
  s3:
    image: minio/minio:latest
    ports:
      - $MINIO_PORT:9000
      - $MINIO_UI_PORT:9001
`,
      {
        ".env": ["MINIO_PORT=19000", "MINIO_UI_PORT=19001"].join("\n"),
      },
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe("s3");
    expect(results[0]?.hostPort).toBe("19000");
    expect(results[0]?.containerPort).toBe("9000");
    expect(results[0]?.name).toMatch(/localhost:19000/);
  });

  test("detects MinIO without a published host port as container-reachable S3", async () => {
    const results = await discoverFromCompose(`
services:
  s3:
    image: minio/minio:latest
    expose:
      - "9000"
`);

    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe("s3");
    expect(results[0]?.hostPort).toBeUndefined();
    expect(results[0]?.containerPort).toBe("9000");
    expect(results[0]?.name).toMatch(/container:9000/);
  });

  test("detects LocalStack as S3 only when S3 is enabled", async () => {
    const enabled = await discoverFromCompose(`
services:
  localstack:
    image: localstack/localstack:latest
    ports:
      - "4566:4566"
    environment:
      SERVICES: s3,sqs
`);
    expect(enabled).toHaveLength(1);
    expect(enabled[0]?.kind).toBe("s3");
    expect(enabled[0]?.hostPort).toBe("4566");

    const disabled = await discoverFromCompose(`
services:
  localstack:
    image: localstack/localstack:latest
    ports:
      - "4566:4566"
    environment:
      SERVICES: sqs,lambda
`);
    expect(disabled).toHaveLength(0);
  });

  // 引用符付きポート値に末尾コメントが続く行 (例: `- "4566:4566"  # comment`)
  // で、コメント除去前に独自の引用符除去を行うと終端の `"` を消せず
  // `4566:4566"` が残って expandPortRange に弾かれ、hostPort が undefined に
  // なる回帰があった。この形式は複数ポート範囲マッピング (例:
  // `4510-4559:4510-4559`) と組み合わせても同様に起きる。
  test("detects host port from a quoted port mapping followed by a trailing comment", async () => {
    const results = await discoverFromCompose(`
services:
  localstack:
    image: localstack/localstack:4.14.0
    ports:
      - "4566:4566"            # LocalStack Gateway
      - "4510-4559:4510-4559"  # external services port range
    environment:
      - SERVICES=s3,sqs
`);

    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe("s3");
    expect(results[0]?.hostPort).toBe("4566");
  });

  test("detects LocalStack S3 from whitespace-separated SERVICES", async () => {
    const results = await discoverFromCompose(`
services:
  localstack:
    image: localstack/localstack:latest
    ports:
      - "4566:4566"
    environment:
      SERVICES: "s3 sqs"
`);

    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe("s3");
  });

  test("does not detect non-MinIO images whose path segment only starts with minio", async () => {
    const results = await discoverFromCompose(`
services:
  object-admin:
    image: example.com/minioadmin/foo:latest
`);

    expect(results).toHaveLength(0);
  });

  test("does not detect arbitrary services as S3 from port 9000 alone", async () => {
    const results = await discoverFromCompose(`
services:
  app:
    build:
      context: ./app
    ports:
      - "9000:9000"
`);

    expect(results).toHaveLength(0);
  });

  test("resolves $VAR environment values from process.env", async () => {
    await withProcessEnv(
      "CV_TEST_MYSQL_PASSWORD",
      "host-password",
      async () => {
        const results = await discoverFromCompose(`
services:
  db:
    image: mysql:8
    environment:
      MYSQL_ROOT_PASSWORD: '$CV_TEST_MYSQL_PASSWORD'
`);

        expect(results).toHaveLength(1);
        expect(results[0]?.env.MYSQL_ROOT_PASSWORD).toBe("host-password");
      },
    );
  });

  test("resolves $VAR environment values from compose directory .env", async () => {
    const results = await discoverFromCompose(
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

  test("prefers process.env over compose directory .env", async () => {
    await withProcessEnv(
      "CV_TEST_MYSQL_PASSWORD",
      "host-password",
      async () => {
        const results = await discoverFromCompose(
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
      },
    );
  });

  test("parses compose directory .env quotes comments and export prefixes", async () => {
    const results = await discoverFromCompose(
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

  test("profiles: 指定のサービスは profiled=true でフラグ立つ", async () => {
    // profile-gated なサービス (例: 開発時のみ起動する test DB) は
    // `docker compose config --services` から外れるので、doctor の
    // 「missing services」warn から除外する判定材料として profiled
    // フラグを立てる必要がある。
    const results = await discoverFromCompose(`services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: app
  db-test:
    image: postgres:16
    environment:
      POSTGRES_DB: app_test
    profiles:
      - test
`);

    expect(results).toHaveLength(2);
    const db = results.find((r) => r.serviceName === "db");
    const dbTest = results.find((r) => r.serviceName === "db-test");
    expect(db?.profiled).toBeUndefined();
    expect(dbTest?.profiled).toBe(true);
  });
});

describe("supabase CLI database discovery", () => {
  function writeSupabaseConfig(dir: string, projectId: string, extra = "") {
    mkdirSync(join(dir, "supabase"), { recursive: true });
    writeFileSync(
      join(dir, "supabase", "config.toml"),
      `project_id = "${projectId}"\n${extra}`,
      "utf8",
    );
  }

  test("discovers project_id and db port from supabase/config.toml", async () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-supabase-discovery-"));
    try {
      writeSupabaseConfig(
        dir,
        "sample_project",
        `
[db]
port = 54322
shadow_port = 54320
`,
      );

      const results = await discoverSupabaseCliProjectsAsync(dir, []);
      expect(results).toHaveLength(1);
      expect(results[0]?.projectId).toBe("sample_project");
      expect(results[0]?.dbPort).toBe("54322");
      expect(results[0]?.kind).toBe("postgresql");
      expect(results[0]?.id).toBe("supabase:sample_project");
      expect(results[0]?.name).toMatch(/sample_project/);
      expect(results[0]?.name).toMatch(/54322/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("falls back to the default db port when [db] port is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-supabase-noport-"));
    try {
      writeSupabaseConfig(dir, "noport");

      const results = await discoverSupabaseCliProjectsAsync(dir, []);
      expect(results).toHaveLength(1);
      expect(results[0]?.dbPort).toBe("54322");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ignores project_id declared inside [remotes.*] sections", async () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-supabase-remotes-"));
    try {
      writeSupabaseConfig(
        dir,
        "local-project",
        `
[remotes.staging]
project_id = "staging-project"

[db]
port = 55000
`,
      );

      const results = await discoverSupabaseCliProjectsAsync(dir, []);
      expect(results).toHaveLength(1);
      expect(results[0]?.projectId).toBe("local-project");
      expect(results[0]?.dbPort).toBe("55000");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("discovers nested supabase projects with a relDir-scoped id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-supabase-nested-"));
    try {
      writeSupabaseConfig(join(dir, "apps", "db"), "nested-project");

      const results = await discoverSupabaseCliProjectsAsync(dir, []);
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe("supabase:nested-project@apps%2Fdb");
      expect(results[0]?.relDirSlash).toBe("apps/db");
      expect(results[0]?.path).toBe("apps/db/supabase/config.toml");

      const parsed = parseSupabaseDbId(results[0]?.id ?? "");
      expect(parsed).toEqual({
        projectId: "nested-project",
        relDir: "apps/db",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ignores config.toml without a project_id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-supabase-noid-"));
    try {
      mkdirSync(join(dir, "supabase"), { recursive: true });
      writeFileSync(
        join(dir, "supabase", "config.toml"),
        "[db]\nport = 54322\n",
        "utf8",
      );

      expect(await discoverSupabaseCliProjectsAsync(dir, [])).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("does not cache results after abort", async () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-supabase-abort-"));
    try {
      writeSupabaseConfig(dir, "abort-project");
      const controller = new AbortController();
      controller.abort();

      expect(
        await discoverSupabaseCliProjectsAsync(dir, [], controller.signal),
      ).toEqual([]);
      const results = await discoverSupabaseCliProjectsAsync(dir, []);
      expect(results).toHaveLength(1);
      expect(results[0]?.projectId).toBe("abort-project");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parseSupabaseDbId", () => {
  test("parses a root-level id", () => {
    expect(parseSupabaseDbId("supabase:sample_project")).toEqual({
      projectId: "sample_project",
      relDir: "",
    });
  });

  test("parses a nested id with an encoded relDir", () => {
    expect(parseSupabaseDbId("supabase:sample_project@apps%2Fdb")).toEqual({
      projectId: "sample_project",
      relDir: "apps/db",
    });
  });

  test("rejects ids without the supabase: prefix", () => {
    expect(parseSupabaseDbId("docker:sample_project")).toBeNull();
  });

  test("rejects unsafe project ids", () => {
    expect(parseSupabaseDbId("supabase:../etc/passwd")).toBeNull();
  });

  test("rejects malformed relDir traversal", () => {
    expect(
      parseSupabaseDbId(
        `supabase:sample_project@${encodeURIComponent("../evil")}`,
      ),
    ).toBeNull();
  });
});
