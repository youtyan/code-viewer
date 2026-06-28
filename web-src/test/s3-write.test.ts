// S3 オブジェクト書き込み (putObjectAsync / deleteObjectAsync) を検証する。
// 公開ホストポート経由の直 fetch をモックし、Sig V4 の payload ハッシュ
// (x-amz-content-sha256) が body の SHA256 と一致することを確認する。
import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  __setS3SpawnSyncForTest,
  openS3ExplorerAsync,
} from "../server/database/adapters/s3";
import type { DockerDbInfo } from "../server/database/discovery";

const originalFetch = globalThis.fetch;

afterEach(() => {
  __setS3SpawnSyncForTest(null);
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: originalFetch,
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
