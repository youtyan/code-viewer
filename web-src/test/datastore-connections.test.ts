import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  __setSqlDriverFactoriesForTest,
  createSqlCliAdapter,
} from "../server/database/adapters/docker";
import {
  __setEsFetchForTest,
  createElasticsearchAdapter,
} from "../server/database/adapters/elasticsearch";
import {
  __setRedisClientFactoryForTest,
  createRedisAdapter,
} from "../server/database/adapters/redis";
import {
  deleteDatastoreConnection,
  loadDatastoreConnections,
  publicConnection,
  saveDatastoreConnection,
} from "../server/database/connections-store";
import {
  createDbFilesResponse,
  handleDatabaseRoute,
} from "../server/database/handle";

const CASES = [
  {
    name: "PostgreSQL connection",
    id: "connection:1111111111111111",
    input: {
      kind: "postgresql",
      host: "db.example.test",
      port: 5432,
      user: "sample_user",
      password: "example-password",
      database: "sample_database",
      schema: "sample_schema",
      tls: true,
    },
  },
  {
    name: "MySQL connection",
    id: "connection:2222222222222222",
    input: {
      kind: "mysql",
      host: "db.example.test",
      port: 3306,
      user: "sample_user",
      password: "example-password",
      database: "sample_database",
      tls: false,
    },
  },
  {
    name: "Redis connection",
    id: "connection:3333333333333333",
    input: {
      kind: "redis",
      host: "cache.example.test",
      port: 6379,
      username: "sample_user",
      password: "example-password",
      tls: true,
    },
  },
  {
    name: "Elasticsearch connection",
    id: "connection:4444444444444444",
    input: {
      kind: "elasticsearch",
      endpoint: "https://search.example.test",
      username: "sample_user",
      password: "example-password",
    },
  },
  {
    name: "S3 connection",
    id: "connection:5555555555555555",
    input: {
      kind: "s3",
      endpoint: "https://objects.example.test",
      region: "example-region-1",
      accessKeyId: "example-access-key",
      secretAccessKey: "example-secret-key",
      sessionToken: "example-session-token",
    },
  },
  {
    name: "DynamoDB connection",
    id: "connection:6666666666666666",
    input: {
      kind: "dynamodb",
      endpoint: "https://documents.example.test",
      region: "example-region-1",
      accessKeyId: "example-access-key",
      secretAccessKey: "example-secret-key",
    },
  },
] as const;

const originalFetch = globalThis.fetch;

afterEach(() => {
  __setSqlDriverFactoriesForTest({});
  __setRedisClientFactoryForTest(null);
  __setEsFetchForTest(null);
  globalThis.fetch = originalFetch;
});

describe("datastore connection store", () => {
  test.each(CASES)("saves and reloads $name", async ({ id, input }) => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-connections-"));
    try {
      await saveDatastoreConnection(dir, {
        id,
        name: "Example datastore",
        ...input,
      });

      const stored = await loadDatastoreConnections(dir);
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe(id);
      expect(stored[0].name).toBe("Example datastore");
      expect(stored[0].kind).toBe(input.kind);
      expect(
        statSync(join(dir, ".code-viewer", "datastore-connections.json")).mode &
          0o777,
      ).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test.each(CASES)("never returns credentials for $name", async ({
    id,
    input,
  }) => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-connections-"));
    try {
      const stored = await saveDatastoreConnection(dir, {
        id,
        name: "Example datastore",
        ...input,
      });
      const safe = publicConnection(stored);

      expect(Object.keys(safe).includes("password")).toBe(false);
      expect(Object.keys(safe).includes("user")).toBe(false);
      expect(Object.keys(safe).includes("username")).toBe(false);
      expect(Object.keys(safe).includes("accessKeyId")).toBe(false);
      expect(Object.keys(safe).includes("secretAccessKey")).toBe(false);
      expect(Object.keys(safe).includes("sessionToken")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("does not persist authentication fields", async () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-connections-"));
    try {
      await saveDatastoreConnection(dir, {
        id: "connection:9999999999999999",
        name: "Example datastore",
        kind: "s3",
        endpoint: "https://objects.example.test",
        region: "example-region-1",
        accessKeyId: "example-access-key",
        secretAccessKey: "example-secret-key",
        sessionToken: "example-session-token",
      });

      const saved = JSON.parse(
        readFileSync(
          join(dir, ".code-viewer", "datastore-connections.json"),
          "utf8",
        ),
      ) as { connections: Array<Record<string, unknown>> };
      expect(Object.keys(saved.connections[0]).includes("password")).toBe(
        false,
      );
      expect(Object.keys(saved.connections[0]).includes("user")).toBe(false);
      expect(Object.keys(saved.connections[0]).includes("username")).toBe(
        false,
      );
      expect(Object.keys(saved.connections[0]).includes("accessKeyId")).toBe(
        false,
      );
      expect(
        Object.keys(saved.connections[0]).includes("secretAccessKey"),
      ).toBe(false);
      expect(Object.keys(saved.connections[0]).includes("sessionToken")).toBe(
        false,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an update preserves an omitted password and delete removes the connection", async () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-connections-"));
    const id = "connection:7777777777777777";
    try {
      await saveDatastoreConnection(dir, {
        id,
        name: "Example datastore",
        kind: "postgresql",
        host: "db.example.test",
        port: 5432,
        user: "sample_user",
        password: "example-password",
        database: "sample_database",
        tls: false,
      });
      await saveDatastoreConnection(dir, {
        id,
        name: "Renamed datastore",
      });

      expect(await loadDatastoreConnections(dir)).toEqual([
        {
          id,
          name: "Renamed datastore",
          kind: "postgresql",
          host: "db.example.test",
          port: 5432,
          user: "sample_user",
          password: "example-password",
          database: "sample_database",
          tls: false,
        },
      ]);
      expect(await deleteDatastoreConnection(dir, id)).toBe(true);
      expect(await loadDatastoreConnections(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("saved connections are included in the datastore list without credentials", async () => {
    const body = await createDbFilesResponse("/workspace", [], undefined, {
      discoverSqliteFiles: async () => [],
      discoverDockerDatabases: async () => [],
      listDockerDatabases: async () => [],
      discoverSupabaseCliProjects: async () => [],
      loadConnections: async () => [
        {
          id: "connection:8888888888888888",
          name: "Example datastore",
          kind: "redis",
          host: "cache.example.test",
          port: 6379,
          password: "example-password",
          tls: false,
        },
      ],
    });

    expect(body).toEqual({
      files: [
        {
          id: "connection:8888888888888888",
          path: "saved connection",
          name: "Example datastore",
          sizeBytes: 0,
          kind: "redis",
          savedConnection: true,
        },
      ],
    });
  });
});

describe("direct SQL connection", () => {
  test("PostgreSQL uses the packaged driver", async () => {
    let receivedConfig: Record<string, unknown> = {};
    let ended = false;
    __setSqlDriverFactoriesForTest({
      pg: (config) => {
        receivedConfig = config as Record<string, unknown>;
        return {
          async connect() {
            return {
              async query() {
                return {
                  fields: [{ name: "table_name" }, { name: "table_type" }],
                  rows: [["sample_table", "BASE TABLE"]],
                };
              },
              release() {
                // Test double has no socket to release.
              },
            };
          },
          async end() {
            ended = true;
          },
        };
      },
    });
    const adapter = createSqlCliAdapter({
      kind: "postgresql",
      host: "db.example.test",
      port: 5432,
      user: "sample_user",
      password: "example-password",
      database: "sample_database",
      schema: "sample_schema",
      tls: true,
    });

    expect(await adapter.getTablesAsync()).toEqual([
      { name: "sample_table", type: "table", rowCount: null, comment: null },
    ]);
    expect(receivedConfig.host).toBe("db.example.test");
    expect(receivedConfig.port).toBe(5432);
    expect(receivedConfig.ssl).toBe(true);
    adapter.close();
    await Promise.resolve();
    expect(ended).toBe(true);
  });

  test("MySQL uses the packaged driver", async () => {
    let multipleStatements = false;
    __setSqlDriverFactoriesForTest({
      mysql: (config) => {
        multipleStatements = config.multipleStatements === true;
        return {
          async getConnection() {
            return {
              async query() {
                return [
                  [["sample_table", "BASE TABLE"]],
                  [{ name: "table_name" }, { name: "table_type" }],
                ];
              },
              release() {
                // Test double has no socket to release.
              },
              destroy() {
                // Test double has no socket to destroy.
              },
            };
          },
          async end() {
            // Test double has no pool to end.
          },
        };
      },
    });
    const adapter = createSqlCliAdapter({
      kind: "mysql",
      host: "db.example.test",
      port: 3306,
      user: "sample_user",
      password: "example-password",
      database: "sample_database",
    });

    expect(await adapter.getTablesAsync()).toEqual([
      { name: "sample_table", type: "table", rowCount: null, comment: null },
    ]);
    expect(multipleStatements).toBe(true);
    adapter.close();
  });

  test("PostgreSQL aborts while waiting for a connection and disposes a late client", async () => {
    let resolveConnect!: (client: {
      query(config: { text: string; rowMode: "array" }): Promise<unknown>;
      release(destroy?: boolean): void;
    }) => void;
    let destroyed = false;
    __setSqlDriverFactoriesForTest({
      pg: () => ({
        connect: () =>
          new Promise((resolve) => {
            resolveConnect = resolve;
          }),
        async end() {
          // Test double has no pool to end.
        },
      }),
    });
    const adapter = createSqlCliAdapter({
      kind: "postgresql",
      host: "db.example.test",
      port: 5432,
      user: "sample_user",
      password: "example-password",
      database: "sample_database",
    });
    const controller = new AbortController();
    const pending = adapter.getTablesAsync(controller.signal);

    controller.abort();

    let abortFailure: unknown;
    try {
      await pending;
    } catch (error) {
      abortFailure = error;
    }
    expect((abortFailure as Error | undefined)?.name).toBe("AbortError");
    resolveConnect({
      async query() {
        return { fields: [], rows: [] };
      },
      release(destroy) {
        destroyed = destroy === true;
        if (destroy) throw new Error("cleanup failure");
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(destroyed).toBe(true);
    adapter.close();
  });
});

describe("connection test route", () => {
  test.each([
    {
      name: "PostgreSQL",
      input: CASES[0].input,
      setup: () =>
        __setSqlDriverFactoriesForTest({
          pg: () => ({
            async connect() {
              return {
                async query() {
                  return {
                    fields: [{ name: "table_name" }, { name: "table_type" }],
                    rows: [["sample_table", "BASE TABLE"]],
                  };
                },
                release() {
                  // Test double has no socket to release.
                },
              };
            },
            async end() {
              // Test double has no pool to end.
            },
          }),
        }),
    },
    {
      name: "MySQL",
      input: CASES[1].input,
      setup: () =>
        __setSqlDriverFactoriesForTest({
          mysql: () => ({
            async getConnection() {
              return {
                async query() {
                  return [
                    [["sample_table", "BASE TABLE"]],
                    [{ name: "table_name" }, { name: "table_type" }],
                  ];
                },
                release() {
                  // Test double has no socket to release.
                },
                destroy() {
                  // Test double has no socket to destroy.
                },
              };
            },
            async end() {
              // Test double has no pool to end.
            },
          }),
        }),
    },
    {
      name: "Redis",
      input: CASES[2].input,
      setup: () =>
        __setRedisClientFactoryForTest(() => ({
          on() {
            return this;
          },
          async connect() {
            // Test double is immediately connected.
          },
          async sendCommand() {
            return "";
          },
          withAbortSignal() {
            return {
              async sendCommand() {
                return "db0:keys=0\r\n";
              },
            };
          },
          destroy() {
            // Test double has no socket to destroy.
          },
        })),
    },
    {
      name: "Elasticsearch",
      input: CASES[3].input,
      setup: () =>
        __setEsFetchForTest(
          (async (_input: RequestInfo | URL, _init?: RequestInit) =>
            new Response(JSON.stringify([]), { status: 200 })) as typeof fetch,
        ),
    },
    {
      name: "S3",
      input: CASES[4].input,
      setup: () => {
        globalThis.fetch = (async (
          _input: RequestInfo | URL,
          _init?: RequestInit,
        ) =>
          new Response(
            '<?xml version="1.0"?><ListAllMyBucketsResult><Buckets></Buckets></ListAllMyBucketsResult>',
            { status: 200 },
          )) as typeof fetch;
      },
    },
    {
      name: "DynamoDB",
      input: CASES[5].input,
      setup: () => {
        globalThis.fetch = (async (
          _input: RequestInfo | URL,
          _init?: RequestInit,
        ) =>
          new Response(JSON.stringify({ TableNames: [] }), {
            status: 200,
          })) as typeof fetch;
      },
    },
  ])("probes an unsaved $name connection without persisting it", async ({
    input,
    setup,
  }) => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-connections-"));
    setup();
    try {
      const request = new Request("http://localhost/_db/connections/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify({
          name: "Example datastore",
          ...input,
        }),
      });
      const response = await handleDatabaseRoute(
        request,
        new URL(request.url),
        dir,
        [],
        () => true,
      );

      expect(response?.status).toBe(200);
      expect(await response?.json()).toEqual({ ok: true });
      expect(await loadDatastoreConnections(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test.each([
    {
      name: "blocked side effect",
      allowed: false,
      body: { ...CASES[0].input, name: "Example datastore" },
      status: 403,
      message: "forbidden",
    },
    {
      name: "invalid payload",
      allowed: true,
      body: { name: "Example datastore", kind: "postgresql" },
      status: 400,
      message: "invalid datastore connection",
    },
    {
      name: "missing saved id",
      allowed: true,
      body: {
        ...CASES[0].input,
        id: "connection:ffffffffffffffff",
        name: "Example datastore",
      },
      status: 404,
      message: "datastore connection not found",
    },
  ])("returns a bounded error for $name", async (scenario) => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-connections-"));
    try {
      const request = new Request("http://localhost/_db/connections/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify(scenario.body),
      });
      const response = await handleDatabaseRoute(
        request,
        new URL(request.url),
        dir,
        [],
        () => scenario.allowed,
      );

      expect(response?.status).toBe(scenario.status);
      expect(await response?.text()).toBe(scenario.message);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns a generic failure without exposing driver details", async () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-connections-"));
    __setSqlDriverFactoriesForTest({
      pg: () => ({
        async connect() {
          throw new Error("authentication rejected: example-password");
        },
        async end() {
          // Test double has no pool to end.
        },
      }),
    });
    try {
      const request = new Request("http://localhost/_db/connections/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify({
          ...CASES[0].input,
          name: "Example datastore",
        }),
      });
      const response = await handleDatabaseRoute(
        request,
        new URL(request.url),
        dir,
        [],
        () => true,
      );

      expect(response?.status).toBe(400);
      expect(await response?.text()).toBe("connection failed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reuses an existing runtime password when edit test omits it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-connections-"));
    const id = "connection:aaaaaaaaaaaaaaaa";
    let receivedPassword = "";
    try {
      await saveDatastoreConnection(dir, {
        id,
        name: "Example datastore",
        ...CASES[0].input,
      });
      __setSqlDriverFactoriesForTest({
        pg: (config) => {
          receivedPassword = String(config.password ?? "");
          return {
            async connect() {
              return {
                async query() {
                  return {
                    fields: [{ name: "table_name" }, { name: "table_type" }],
                    rows: [["sample_table", "BASE TABLE"]],
                  };
                },
                release() {
                  // Test double has no socket to release.
                },
              };
            },
            async end() {
              // Test double has no pool to end.
            },
          };
        },
      });
      const request = new Request("http://localhost/_db/connections/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify({
          id,
          name: "Example datastore",
          kind: "postgresql",
          host: "db.example.test",
          port: 5432,
          user: "sample_user",
          database: "sample_database",
          tls: false,
        }),
      });
      const response = await handleDatabaseRoute(
        request,
        new URL(request.url),
        dir,
        [],
        () => true,
      );

      expect(response?.status).toBe(200);
      expect(receivedPassword).toBe("example-password");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("direct non-SQL connections", () => {
  test("Redis uses the packaged driver and selects the requested database", async () => {
    const configuredDatabases: number[] = [];
    __setRedisClientFactoryForTest((options) => {
      configuredDatabases.push(Number(options?.database ?? 0));
      return {
        on() {
          return this;
        },
        async connect() {
          // Test double is immediately connected.
        },
        async sendCommand() {
          return "";
        },
        withAbortSignal() {
          return {
            async sendCommand(args: string[]) {
              return args[0] === "INFO" ? "db0:keys=2\r\n" : "OK";
            },
          };
        },
        destroy() {
          // Test double has no socket to destroy.
        },
      };
    });
    const adapter = createRedisAdapter({
      host: "cache.example.test",
      port: 6379,
      password: "example-password",
    });

    expect((await adapter.listDatabasesAsync())[0]).toEqual({
      index: 0,
      keyCount: 2,
    });
    expect(configuredDatabases).toEqual([0]);
    adapter.close();
  });

  test("Redis aborts and destroys a client while it is connecting", async () => {
    let resolveConnect!: () => void;
    let destroyed = false;
    __setRedisClientFactoryForTest(() => ({
      on() {
        return this;
      },
      connect: () =>
        new Promise((resolve) => {
          resolveConnect = () => resolve(undefined);
        }),
      async sendCommand() {
        return "";
      },
      withAbortSignal() {
        return {
          async sendCommand() {
            return "";
          },
        };
      },
      destroy() {
        destroyed = true;
      },
    }));
    const adapter = createRedisAdapter({
      host: "cache.example.test",
      port: 6379,
      password: "example-password",
    });
    const controller = new AbortController();
    const pending = adapter.listDatabasesAsync(controller.signal);

    controller.abort();

    let abortFailure: unknown;
    try {
      await pending;
    } catch (error) {
      abortFailure = error;
    }
    expect((abortFailure as Error | undefined)?.name).toBe("AbortError");
    expect(destroyed).toBe(true);
    resolveConnect();
    await Promise.resolve();
    adapter.close();
  });

  test("Elasticsearch uses the built-in HTTP client", async () => {
    let requestedUrl = "";
    __setEsFetchForTest((async (input) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify([
          {
            index: "sample_index",
            "docs.count": "3",
            "store.size": "1kb",
            health: "green",
            status: "open",
          },
        ]),
        { status: 200 },
      );
    }) as typeof fetch);
    const adapter = createElasticsearchAdapter({
      endpoint: "https://search.example.test",
      username: "sample_user",
      password: "example-password",
    });

    expect(await adapter.listIndicesAsync()).toEqual([
      {
        name: "sample_index",
        docCount: 3,
        sizeBytes: 1024,
        health: "green",
        status: "open",
      },
    ]);
    expect(requestedUrl).toBe(
      "https://search.example.test/_cat/indices?format=json&expand_wildcards=open",
    );
  });
});
