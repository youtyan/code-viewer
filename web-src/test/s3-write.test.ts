// S3 オブジェクト書き込み (putObjectAsync / deleteObjectAsync) を検証する。
// 公開ホストポート経由の直 fetch をモックし、Sig V4 の payload ハッシュ
// (x-amz-content-sha256) が body の SHA256 と一致することを確認する。
import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  __setS3SpawnSyncForTest,
  openS3ExplorerAsync,
} from "../server/database/adapters/s3";
import type { DockerDbInfo } from "../server/database/discovery";
import { closeS3Adapter, handleS3Route } from "../server/database/handle-s3";

const originalFetch = globalThis.fetch;

afterEach(() => {
  closeS3Adapter("docker:minio");
  __setS3SpawnSyncForTest(null);
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: originalFetch,
  });
});

function composeCwd(): string {
  const cwd = mkdtempSync(join(tmpdir(), "cv-s3-write-"));
  writeFileSync(
    join(cwd, "docker-compose.yml"),
    [
      "services:",
      "  minio:",
      "    image: quay.io/minio/minio:latest",
      '    ports:\n      - "19000:9000"',
      "    environment:",
      "      MINIO_ROOT_USER: AK_TEST",
      "      MINIO_ROOT_PASSWORD: SK_TEST",
    ].join("\n"),
  );
  return cwd;
}

// HEAD の応答ステータスを制御しつつ PUT を記録するフェッチモック。
function mockHeadAndPut(headStatus: number): { puts: number } {
  const state = { puts: 0 };
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method || "GET") === "PUT") {
        state.puts++;
        return new Response("", { status: 200 });
      }
      // HEAD (存在チェック)
      return new Response("", { status: headStatus });
    }) as typeof fetch,
  });
  return state;
}

async function writeReq(cwd: string, body: unknown): Promise<Response> {
  const req = new Request("http://localhost/_db/s3/write", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await handleS3Route(req, new URL(req.url), cwd, () => true);
  if (!res) throw new Error("route did not match");
  return res;
}

describe("S3 write route create guard", () => {
  test("op=create refuses to overwrite an existing object (409, no PUT)", async () => {
    const cwd = composeCwd();
    try {
      const state = mockHeadAndPut(200); // HEAD 200 = already exists
      const res = await writeReq(cwd, {
        db: "docker:minio",
        bucket: "media",
        key: "config/app.json",
        op: "create",
        content: "{}",
      });
      expect(res.status).toBe(409);
      expect(state.puts).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("op=create writes when the object does not exist (HEAD 404 → PUT)", async () => {
    const cwd = composeCwd();
    try {
      const state = mockHeadAndPut(404); // HEAD 404 = absent
      const res = await writeReq(cwd, {
        db: "docker:minio",
        bucket: "media",
        key: "config/new.json",
        op: "create",
        content: "{}",
      });
      expect(res.status).toBe(200);
      expect(state.puts).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

function s3Info(): DockerDbInfo {
  return {
    id: "docker:minio",
    path: "docker-compose.yml",
    name: "minio",
    sizeBytes: 0,
    kind: "s3",
    serviceName: "minio",
    image: "quay.io/minio/minio:latest",
    env: { MINIO_ROOT_USER: "AK_TEST", MINIO_ROOT_PASSWORD: "SK_TEST" },
    composeDir: "/tmp",
    relDirSlash: "",
    hostPort: "19000",
    containerPort: "9000",
  };
}

type Captured = {
  method?: string;
  url?: string;
  contentSha?: string | null;
  body?: string;
};

function mockFetch(status: number): Captured {
  const captured: Captured = {};
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.method = init?.method;
      captured.url = String(input);
      const headers = new Headers(init?.headers);
      captured.contentSha = headers.get("x-amz-content-sha256");
      if (init?.body) {
        captured.body = new TextDecoder().decode(init.body as Uint8Array);
      }
      return new Response("", { status });
    }) as typeof fetch,
  });
  return captured;
}

describe("S3 adapter writes", () => {
  test("putObjectAsync signs the body payload hash and sends the bytes", async () => {
    const captured = mockFetch(200);
    const explorer = await openS3ExplorerAsync(s3Info());
    const bytes = new TextEncoder().encode("hello world");
    await explorer.putObjectAsync({
      bucket: "media",
      key: "docs/a.txt",
      body: bytes,
      contentType: "text/plain",
    });
    expect(captured.method).toBe("PUT");
    expect(captured.url).toBe("http://localhost:19000/media/docs/a.txt");
    // payload ハッシュは body の SHA256 と一致 (EMPTY ではない)。
    const expected = createHash("sha256").update(bytes).digest("hex");
    expect(captured.contentSha).toBe(expected);
    expect(captured.body).toBe("hello world");
  });

  test("deleteObjectAsync issues a DELETE and accepts 204", async () => {
    const captured = mockFetch(204);
    const explorer = await openS3ExplorerAsync(s3Info());
    await explorer.deleteObjectAsync({ bucket: "media", key: "docs/a.txt" });
    expect(captured.method).toBe("DELETE");
    expect(captured.url).toBe("http://localhost:19000/media/docs/a.txt");
  });

  test("putObjectAsync throws on a non-2xx response", async () => {
    mockFetch(403);
    const explorer = await openS3ExplorerAsync(s3Info());
    let threw = false;
    try {
      await explorer.putObjectAsync({
        bucket: "media",
        key: "a.txt",
        body: new TextEncoder().encode("x"),
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
