import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  __clearDockerComposeContainerNameCacheForTest,
  __setDockerComposeSpawnSyncForTest,
} from "../server/database/adapters/docker-utils";
import {
  __setDynamoDbDockerCurlTimeoutMsForTest,
  __setDynamoDbRequestTimeoutMsForTest,
  __setDynamoDbSpawnSyncForTest,
  openDynamoDbExplorerAsync,
} from "../server/database/adapters/dynamodb";
import type { DockerDbInfo } from "../server/database/discovery";
import {
  closeDynamoDbAdapter,
  handleDynamoDbRoute,
} from "../server/database/handle-dynamodb";

const originalFetch = globalThis.fetch;

afterEach(() => {
  closeDynamoDbAdapter("docker:localstack");
  closeDynamoDbAdapter("docker:localstack#dynamodb");
  __clearDockerComposeContainerNameCacheForTest();
  __setDynamoDbRequestTimeoutMsForTest(null);
  __setDynamoDbDockerCurlTimeoutMsForTest(null);
  __setDynamoDbSpawnSyncForTest(null);
  __setDockerComposeSpawnSyncForTest(null);
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: originalFetch,
  });
});

function dynamoInfo(): DockerDbInfo {
  return {
    id: "docker:localstack#dynamodb",
    path: "docker-compose.yml",
    name: "localstack / DynamoDB",
    sizeBytes: 0,
    kind: "dynamodb",
    serviceName: "localstack",
    image: "localstack/localstack:latest",
    env: {
      AWS_ACCESS_KEY_ID: "AK_TEST",
      AWS_SECRET_ACCESS_KEY: "SK_TEST",
      AWS_REGION: "ap-northeast-1",
    },
    composeDir: "/tmp",
    relDirSlash: "",
    hostPort: "4566",
    containerPort: "4566",
  };
}

function dynamoInfoWithoutHostPort(): DockerDbInfo {
  const info = dynamoInfo();
  const { hostPort: _hostPort, ...rest } = info;
  return rest;
}

function composeCwd(): string {
  const cwd = mkdtempSync(join(tmpdir(), "cv-dynamodb-route-"));
  writeFileSync(
    join(cwd, "docker-compose.yml"),
    [
      "services:",
      "  localstack:",
      "    image: localstack/localstack:latest",
      '    ports:\n      - "14566:4566"',
      "    environment:",
      "      SERVICES: s3,dynamodb",
      "      AWS_ACCESS_KEY_ID: AK_TEST",
      "      AWS_SECRET_ACCESS_KEY: SK_TEST",
      "      AWS_REGION: ap-northeast-1",
    ].join("\n"),
  );
  return cwd;
}

async function dynamoReq(cwd: string, path: string): Promise<Response> {
  const req = new Request(`http://localhost${path}`);
  const res = await handleDynamoDbRoute(req, new URL(req.url), cwd);
  if (!res) throw new Error("route did not match");
  return res;
}

function mockDynamoFetch(): {
  requests: Array<{ target: string; body: string }>;
} {
  const state: { requests: Array<{ target: string; body: string }> } = {
    requests: [],
  };
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const target = headers.get("x-amz-target") || "";
      const body = String(init?.body || "");
      state.requests.push({ target, body });
      if (target.endsWith(".ListTables")) {
        return new Response(JSON.stringify({ TableNames: ["sample_table"] }), {
          status: 200,
        });
      }
      if (target.endsWith(".DescribeTable")) {
        return new Response(
          JSON.stringify({
            Table: {
              TableName: "sample_table",
              TableStatus: "ACTIVE",
              ItemCount: 2,
            },
          }),
          { status: 200 },
        );
      }
      if (target.endsWith(".Scan")) {
        return new Response(
          JSON.stringify({
            Items: [{ id: { S: "a" } }],
            Count: 1,
            ScannedCount: 2,
            LastEvaluatedKey: { id: { S: "a" } },
          }),
          { status: 200 },
        );
      }
      if (target.endsWith(".Query")) {
        return new Response(
          JSON.stringify({
            Items: [{ id: { S: "b" } }],
            Count: 1,
            ScannedCount: 1,
          }),
          { status: 200 },
        );
      }
      if (target.endsWith(".GetItem")) {
        return new Response(
          JSON.stringify({ Item: { id: { S: "a" }, title: { S: "hello" } } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ __type: "UnknownOperation" }), {
        status: 400,
      });
    }) as typeof fetch,
  });
  return state;
}

describe("DynamoDB adapter", () => {
  test("lists tables via DynamoDB JSON protocol without exposing secret key", async () => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("http://localhost:4566/");
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(JSON.stringify({ Limit: 25 }));
        const headers = new Headers(init?.headers);
        expect(headers.get("content-type")).toBe("application/x-amz-json-1.0");
        expect(headers.get("x-amz-target")).toBe(
          "DynamoDB_20120810.ListTables",
        );
        const auth = headers.get("authorization") || "";
        expect(auth.includes("Credential=AK_TEST/")).toBe(true);
        expect(auth.includes("/ap-northeast-1/dynamodb/aws4_request")).toBe(
          true,
        );
        expect(auth.includes("SK_TEST")).toBe(false);
        return new Response(
          JSON.stringify({
            TableNames: ["sample_table"],
            LastEvaluatedTableName: "sample_table",
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });

    const explorer = await openDynamoDbExplorerAsync(dynamoInfo());
    const tables = await explorer.listTablesAsync({ limit: 25 });
    expect(tables).toEqual({
      tableNames: ["sample_table"],
      lastEvaluatedTableName: "sample_table",
    });
  });

  test("scans tables and preserves DynamoDB AttributeValue payloads", async () => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.body).toBe(
          JSON.stringify({
            TableName: "sample_table",
            Limit: 2,
            ExclusiveStartKey: { id: { S: "a" } },
          }),
        );
        return new Response(
          JSON.stringify({
            Items: [{ id: { S: "b" }, score: { N: "10" } }],
            Count: 1,
            ScannedCount: 2,
            LastEvaluatedKey: { id: { S: "b" } },
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });

    const explorer = await openDynamoDbExplorerAsync(dynamoInfo());
    const result = await explorer.scanAsync({
      tableName: "sample_table",
      limit: 2,
      exclusiveStartKey: { id: { S: "a" } },
    });
    expect(result).toEqual({
      items: [{ id: { S: "b" }, score: { N: "10" } }],
      count: 1,
      scannedCount: 2,
      lastEvaluatedKey: { id: { S: "b" } },
    });
  });

  test("uses docker exec curl without placing request body in argv", async () => {
    __setDockerComposeSpawnSyncForTest((() => ({
      status: 0,
      stdout: Buffer.from(
        JSON.stringify([
          { Service: "localstack", Name: "localstack_1", State: "running" },
        ]),
      ),
      stderr: Buffer.from(""),
    })) as never);
    let capturedArgs: string[] = [];
    let capturedInput = "";
    __setDynamoDbSpawnSyncForTest(((_command, args, opts) => {
      capturedArgs = args as string[];
      capturedInput = Buffer.isBuffer(opts?.input)
        ? opts.input.toString("utf8")
        : String(opts?.input || "");
      return {
        status: 0,
        stdout: Buffer.from(
          [
            "HTTP/1.1 200 OK",
            "Content-Type: application/x-amz-json-1.0",
            "",
            JSON.stringify({ TableNames: ["sample_table"] }),
          ].join("\r\n"),
        ),
        stderr: Buffer.from(""),
      };
    }) as never);

    const explorer = await openDynamoDbExplorerAsync(
      dynamoInfoWithoutHostPort(),
    );
    const tables = await explorer.listTablesAsync();
    expect(tables.tableNames).toEqual(["sample_table"]);
    expect(capturedArgs.join(" ").includes("TableNames")).toBe(false);
    expect(capturedArgs.join(" ").includes("ListTables")).toBe(false);
    expect(capturedInput.includes("x-amz-target:")).toBe(true);
    expect(capturedInput.includes("__CODE_VIEWER_DYNAMODB_BODY__")).toBe(true);
    expect(capturedInput.includes("{}")).toBe(true);
  });
});

describe("DynamoDB route", () => {
  test("lists tables for a multi-service LocalStack datastore id", async () => {
    const cwd = composeCwd();
    try {
      mockDynamoFetch();
      const res = await dynamoReq(
        cwd,
        "/_db/dynamodb/tables?db=docker%3Alocalstack%23dynamodb&tablesLimit=25",
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        dbId: "docker:localstack#dynamodb",
        tableNames: ["sample_table"],
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("describes a table", async () => {
    const cwd = composeCwd();
    try {
      const state = mockDynamoFetch();
      const res = await dynamoReq(
        cwd,
        "/_db/dynamodb/table?db=docker%3Alocalstack%23dynamodb&table=sample_table",
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        dbId: "docker:localstack#dynamodb",
        table: {
          TableName: "sample_table",
          TableStatus: "ACTIVE",
          ItemCount: 2,
        },
      });
      expect(state.requests[0]).toEqual({
        target: "DynamoDB_20120810.DescribeTable",
        body: JSON.stringify({ TableName: "sample_table" }),
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("scans items and forwards pagination key JSON", async () => {
    const cwd = composeCwd();
    try {
      const state = mockDynamoFetch();
      const key = encodeURIComponent(JSON.stringify({ id: { S: "prev" } }));
      const res = await dynamoReq(
        cwd,
        `/_db/dynamodb/items?db=docker%3Alocalstack%23dynamodb&table=sample_table&limit=2&exclusiveStartKey=${key}`,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        dbId: "docker:localstack#dynamodb",
        tableName: "sample_table",
        mode: "scan",
        items: [{ id: { S: "a" } }],
        count: 1,
        scannedCount: 2,
        lastEvaluatedKey: { id: { S: "a" } },
      });
      expect(state.requests[0]).toEqual({
        target: "DynamoDB_20120810.Scan",
        body: JSON.stringify({
          TableName: "sample_table",
          Limit: 2,
          ExclusiveStartKey: { id: { S: "prev" } },
        }),
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("queries items when mode=query and a key condition is provided", async () => {
    const cwd = composeCwd();
    try {
      const state = mockDynamoFetch();
      const values = encodeURIComponent(JSON.stringify({ ":id": { S: "b" } }));
      const res = await dynamoReq(
        cwd,
        `/_db/dynamodb/items?db=docker%3Alocalstack%23dynamodb&table=sample_table&mode=query&keyConditionExpression=id%20%3D%20%3Aid&expressionAttributeValues=${values}&scanIndexForward=false`,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        dbId: "docker:localstack#dynamodb",
        tableName: "sample_table",
        mode: "query",
        items: [{ id: { S: "b" } }],
        count: 1,
        scannedCount: 1,
      });
      expect(state.requests[0].target).toBe("DynamoDB_20120810.Query");
      expect(JSON.parse(state.requests[0].body)).toEqual({
        TableName: "sample_table",
        KeyConditionExpression: "id = :id",
        Limit: 100,
        ExpressionAttributeValues: { ":id": { S: "b" } },
        ScanIndexForward: false,
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("reads one item by JSON key", async () => {
    const cwd = composeCwd();
    try {
      const state = mockDynamoFetch();
      const key = encodeURIComponent(JSON.stringify({ id: { S: "a" } }));
      const res = await dynamoReq(
        cwd,
        `/_db/dynamodb/item?db=docker%3Alocalstack%23dynamodb&table=sample_table&key=${key}`,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        dbId: "docker:localstack#dynamodb",
        tableName: "sample_table",
        key: { id: { S: "a" } },
        item: { id: { S: "a" }, title: { S: "hello" } },
      });
      expect(state.requests[0]).toEqual({
        target: "DynamoDB_20120810.GetItem",
        body: JSON.stringify({
          TableName: "sample_table",
          Key: { id: { S: "a" } },
          ConsistentRead: false,
        }),
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test.each([
    {
      name: "query mode requires keyConditionExpression",
      path: "/_db/dynamodb/items?db=docker%3Alocalstack%23dynamodb&table=sample_table&mode=query",
      expected: "missing keyConditionExpression parameter",
    },
    {
      name: "item route requires valid key JSON",
      path: "/_db/dynamodb/item?db=docker%3Alocalstack%23dynamodb&table=sample_table&key=%7B",
      expected: "invalid key parameter",
    },
  ])("$name", async ({ path, expected }) => {
    const cwd = composeCwd();
    try {
      mockDynamoFetch();
      const res = await dynamoReq(cwd, path);
      expect(res.status).toBe(400);
      expect(await res.text()).toBe(expected);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
