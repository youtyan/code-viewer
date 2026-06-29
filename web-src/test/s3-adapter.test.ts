import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __setDockerComposeSpawnSyncForTest } from "../server/database/adapters/docker-utils";
import {
  __setS3DockerCurlTimeoutMsForTest,
  __setS3RequestTimeoutMsForTest,
  __setS3SpawnSyncForTest,
  isS3HttpError,
  openS3ExplorerAsync,
} from "../server/database/adapters/s3";
import type { DockerDbInfo } from "../server/database/discovery";
import { closeS3Adapter, handleS3Route } from "../server/database/handle-s3";

const originalFetch = globalThis.fetch;

afterEach(() => {
  closeS3Adapter("docker:minio");
  __setS3RequestTimeoutMsForTest(null);
  __setS3DockerCurlTimeoutMsForTest(null);
  __setS3SpawnSyncForTest(null);
  __setDockerComposeSpawnSyncForTest(null);
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
    env: {
      MINIO_ROOT_USER: "AK_TEST",
      MINIO_ROOT_PASSWORD: "SK_TEST",
    },
    composeDir: "/tmp",
    relDirSlash: "",
    hostPort: "19000",
    containerPort: "9000",
  };
}

function s3InfoWithoutHostPort(): DockerDbInfo {
  const info = s3Info();
  const { hostPort: _hostPort, image: _image, ...rest } = info;
  return { ...rest, image: "example/s3-with-curl:latest" };
}

function minioInfoWithoutHostPort(): DockerDbInfo {
  const info = s3Info();
  const { hostPort: _hostPort, ...rest } = info;
  return rest;
}

function tricklingStream(
  chunkText: string,
  intervalMs: number,
  count: number,
): ReadableStream<Uint8Array> {
  const chunk = new TextEncoder().encode(chunkText);
  let timer: ReturnType<typeof setInterval> | undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let sent = 0;
      timer = setInterval(() => {
        sent++;
        controller.enqueue(chunk);
        if (sent >= count) {
          if (timer) clearInterval(timer);
          controller.close();
        }
      }, intervalMs);
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });
}

describe("S3 adapter", () => {
  test("lists buckets from S3 XML without exposing credentials", async () => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("http://localhost:19000/");
        const headers = new Headers(init?.headers);
        const auth = headers.get("authorization") || "";
        expect(auth.includes("Credential=AK_TEST/")).toBe(true);
        expect(auth.includes("SK_TEST")).toBe(false);
        return new Response(
          [
            "<ListAllMyBucketsResult><Buckets>",
            "<Bucket><Name>media</Name><CreationDate>2026-06-01T00:00:00.000Z</CreationDate></Bucket>",
            "</Buckets></ListAllMyBucketsResult>",
          ].join(""),
          { status: 200 },
        );
      }) as typeof fetch,
    });

    const explorer = await openS3ExplorerAsync(s3Info());
    const buckets = await explorer.listBuckets();
    expect(buckets).toEqual([
      { name: "media", createdAt: "2026-06-01T00:00:00.000Z" },
    ]);
  });

  test("times out stalled bucket requests instead of hanging the route", async () => {
    __setS3RequestTimeoutMsForTest(20);
    const cwd = mkdtempSync(join(tmpdir(), "cv-s3-timeout-"));
    try {
      writeFileSync(
        join(cwd, "docker-compose.yml"),
        [
          "services:",
          "  minio:",
          "    image: quay.io/minio/minio:latest",
          "    ports:",
          '      - "19000:9000"',
          "    environment:",
          "      MINIO_ROOT_USER: AK_TEST",
          "      MINIO_ROOT_PASSWORD: SK_TEST",
        ].join("\n"),
      );
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: (async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Promise<Response>(() => undefined)) as typeof fetch,
      });

      const started = Date.now();
      const req = new Request(
        "http://localhost/_db/s3/buckets?db=docker:minio",
      );
      const res = await handleS3Route(req, new URL(req.url), cwd);
      expect(Date.now() - started < 1000).toBe(true);
      expect(res?.status).toBe(503);
      expect(await res?.text()).toMatch(/S3 request timed out after 20ms/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("times out stalled bucket response bodies instead of hanging the route", async () => {
    __setS3RequestTimeoutMsForTest(20);
    const cwd = mkdtempSync(join(tmpdir(), "cv-s3-body-timeout-"));
    try {
      writeFileSync(
        join(cwd, "docker-compose.yml"),
        [
          "services:",
          "  minio:",
          "    image: quay.io/minio/minio:latest",
          "    ports:",
          '      - "19000:9000"',
          "    environment:",
          "      MINIO_ROOT_USER: AK_TEST",
          "      MINIO_ROOT_PASSWORD: SK_TEST",
        ].join("\n"),
      );
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: (async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(
            new ReadableStream<Uint8Array>({
              start() {
                // Keep headers successful while the XML body never completes.
              },
            }),
            { status: 200 },
          )) as typeof fetch,
      });

      const started = Date.now();
      const req = new Request(
        "http://localhost/_db/s3/buckets?db=docker:minio",
      );
      const res = await handleS3Route(req, new URL(req.url), cwd);
      expect(Date.now() - started < 1000).toBe(true);
      expect(res?.status).toBe(503);
      expect(await res?.text()).toMatch(/S3 request timed out after 20ms/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("enforces an overall deadline for trickling bucket response bodies", async () => {
    __setS3RequestTimeoutMsForTest(50);
    const cwd = mkdtempSync(join(tmpdir(), "cv-s3-body-deadline-"));
    try {
      writeFileSync(
        join(cwd, "docker-compose.yml"),
        [
          "services:",
          "  minio:",
          "    image: quay.io/minio/minio:latest",
          "    ports:",
          '      - "19000:9000"',
          "    environment:",
          "      MINIO_ROOT_USER: AK_TEST",
          "      MINIO_ROOT_PASSWORD: SK_TEST",
        ].join("\n"),
      );
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: (async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(tricklingStream("x", 10, 80), {
            status: 200,
          })) as typeof fetch,
      });

      const started = Date.now();
      const req = new Request(
        "http://localhost/_db/s3/buckets?db=docker:minio",
      );
      const res = await handleS3Route(req, new URL(req.url), cwd);
      expect(Date.now() - started < 1000).toBe(true);
      expect(res?.status).toBe(503);
      expect(await res?.text()).toMatch(/S3 request timed out after 50ms/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("aborts stalled bucket requests when the client request is aborted", async () => {
    __setS3RequestTimeoutMsForTest(1000);
    const cwd = mkdtempSync(join(tmpdir(), "cv-s3-abort-"));
    try {
      writeFileSync(
        join(cwd, "docker-compose.yml"),
        [
          "services:",
          "  minio:",
          "    image: quay.io/minio/minio:latest",
          "    ports:",
          '      - "19000:9000"',
          "    environment:",
          "      MINIO_ROOT_USER: AK_TEST",
          "      MINIO_ROOT_PASSWORD: SK_TEST",
        ].join("\n"),
      );
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: (async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Promise<Response>(() => undefined)) as typeof fetch,
      });

      const controller = new AbortController();
      const req = new Request(
        "http://localhost/_db/s3/buckets?db=docker:minio",
        { signal: controller.signal },
      );
      const started = Date.now();
      const pending = handleS3Route(req, new URL(req.url), cwd);
      await Promise.resolve();
      controller.abort();
      const res = await pending;

      expect(Date.now() - started < 500).toBe(true);
      expect(res?.status).toBe(503);
      expect(await res?.text()).toMatch(/aborted/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("streams raw objects with sandbox headers and preserves range metadata", async () => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        expect(headers.get("range")).toBe("bytes=0-3");
        return new Response("test", {
          status: 206,
          headers: {
            "content-type": "text/html",
            "content-length": "4",
            "content-range": "bytes 0-3/10",
          },
        });
      }) as typeof fetch,
    });

    const explorer = await openS3ExplorerAsync(s3Info());
    const res = await explorer.getObjectResponse({
      bucket: "media",
      key: "index.html",
      method: "GET",
      range: "bytes=0-3",
    });

    expect(res.status).toBe(206);
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-range")).toBe("bytes 0-3/10");
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe("test");
  });

  test("times out stalled raw object streams after upstream headers", async () => {
    __setS3RequestTimeoutMsForTest(20);
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start() {
              // Simulate an image/video response whose body never arrives.
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "image/png",
              "content-length": "100",
            },
          },
        )) as typeof fetch,
    });

    const explorer = await openS3ExplorerAsync(s3Info());
    const res = await explorer.getObjectResponse({
      bucket: "media",
      key: "image.png",
      method: "GET",
    });
    const started = Date.now();
    let error: unknown;
    try {
      await res.arrayBuffer();
    } catch (err) {
      error = err;
    }

    expect(Date.now() - started < 1000).toBe(true);
    expect(isS3HttpError(error)).toBe(true);
    expect(error instanceof Error ? error.message : "").toMatch(
      /S3 request timed out after 20ms/,
    );
  });

  test("allows active raw object streams to exceed the request deadline", async () => {
    __setS3RequestTimeoutMsForTest(30);
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(tricklingStream("a", 10, 6), {
          status: 200,
          headers: {
            "content-type": "application/octet-stream",
            "content-length": "6",
          },
        })) as typeof fetch,
    });

    const explorer = await openS3ExplorerAsync(s3Info());
    const res = await explorer.getObjectResponse({
      bucket: "media",
      key: "stream.bin",
      method: "GET",
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("aaaaaa");
  });

  test("reads text previews with one ranged GET request", async () => {
    const calls: Array<{ method?: string; range: string | null }> = [];
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        calls.push({
          method: init?.method,
          range: headers.get("range"),
        });
        return new Response("test", {
          status: 206,
          headers: {
            "content-type": "text/plain",
            "content-length": "4",
            "content-range": "bytes 0-3/10",
            "last-modified": "Mon, 01 Jun 2026 00:00:00 GMT",
            etag: '"abc"',
          },
        });
      }) as typeof fetch,
    });

    const explorer = await openS3ExplorerAsync(s3Info());
    const result = await explorer.getObjectText({
      bucket: "media",
      key: "note.txt",
      maxBytes: 4,
    });

    expect(calls).toEqual([{ method: "GET", range: "bytes=0-3" }]);
    expect(result.text).toBe("test");
    expect(result.truncated).toBe(true);
    expect(result.head).toEqual({
      dbId: "",
      bucket: "media",
      key: "note.txt",
      sizeBytes: 10,
      contentType: "text/plain",
      updatedAt: "2026-06-01T00:00:00.000Z",
      etag: '"abc"',
    });
  });

  test("does not trust upstream HTML content type for unknown object extensions", async () => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("<script>alert(1)</script>", {
          status: 200,
          headers: {
            "content-type": "text/html",
            "content-length": "25",
          },
        })) as typeof fetch,
    });

    const explorer = await openS3ExplorerAsync(s3Info());
    const res = await explorer.getObjectResponse({
      bucket: "media",
      key: "uploads/no-extension",
      method: "GET",
    });

    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
    expect(await res.text()).toBe("<script>alert(1)</script>");
  });

  test("uses docker exec curl when the S3 service has no published host port", async () => {
    __setS3RequestTimeoutMsForTest(20);
    __setDockerComposeSpawnSyncForTest(((cmd, args) => {
      expect(cmd).toBe("docker");
      expect(args?.slice(0, 3)).toEqual(["compose", "ps", "--format"]);
      return {
        status: 0,
        stdout: JSON.stringify([
          { Service: "minio", Name: "project-minio-1", State: "running" },
        ]),
        stderr: "",
      };
    }) as typeof import("node:child_process").spawnSync);
    __setS3SpawnSyncForTest(((cmd, args, options) => {
      expect(cmd).toBe("docker");
      expect(args?.slice(0, 4)).toEqual([
        "exec",
        "-i",
        "project-minio-1",
        "curl",
      ]);
      expect(args?.includes("-K")).toBe(true);
      expect(args?.includes("http://127.0.0.1:9000/")).toBe(true);
      expect(args?.join(" ").includes("Authorization")).toBe(false);
      expect(args?.join(" ").includes("x-amz")).toBe(false);
      expect((options as { timeout?: number } | undefined)?.timeout).toBe(
        30000,
      );
      const input = (options as { input?: Buffer | string } | undefined)?.input;
      const curlConfig = Buffer.isBuffer(input)
        ? input.toString("utf8")
        : String(input ?? "");
      expect(/authorization/i.test(curlConfig)).toBe(true);
      expect(curlConfig.includes("Credential=AK_TEST/")).toBe(true);
      expect(curlConfig.includes("SK_TEST")).toBe(false);
      return {
        status: 0,
        stdout: Buffer.from(
          [
            "HTTP/1.1 200 OK\r\n",
            "Content-Type: application/xml\r\n",
            "\r\n",
            "<ListAllMyBucketsResult><Buckets>",
            "<Bucket><Name>media</Name></Bucket>",
            "</Buckets></ListAllMyBucketsResult>",
          ].join(""),
        ),
        stderr: Buffer.from(""),
      };
    }) as typeof import("node:child_process").spawnSync);

    const explorer = await openS3ExplorerAsync(s3InfoWithoutHostPort());
    expect(await explorer.listBuckets()).toEqual([{ name: "media" }]);
  });

  test("returns guidance for MinIO without a published host port", async () => {
    let error: unknown;
    try {
      await openS3ExplorerAsync(minioInfoWithoutHostPort());
    } catch (err) {
      error = err;
    }

    expect(isS3HttpError(error)).toBe(true);
    expect(error instanceof Error ? error.message : "").toMatch(
      /MinIO S3 browsing requires a published host port/,
    );
  });

  test("rejects unbounded raw GET through docker exec curl", async () => {
    __setDockerComposeSpawnSyncForTest(((cmd, args) => {
      expect(cmd).toBe("docker");
      expect(args?.slice(0, 3)).toEqual(["compose", "ps", "--format"]);
      return {
        status: 0,
        stdout: JSON.stringify([
          { Service: "minio", Name: "project-minio-1", State: "running" },
        ]),
        stderr: "",
      };
    }) as typeof import("node:child_process").spawnSync);
    __setS3SpawnSyncForTest((() => {
      throw new Error("raw GET should not invoke docker exec curl");
    }) as typeof import("node:child_process").spawnSync);

    const explorer = await openS3ExplorerAsync(s3InfoWithoutHostPort());
    let error: unknown;
    try {
      await explorer.getObjectResponse({
        bucket: "media",
        key: "movie.mp4",
        method: "GET",
      });
    } catch (err) {
      error = err;
    }
    expect(isS3HttpError(error)).toBe(true);
    expect(error instanceof Error ? error.message : "").toBe(
      "S3 raw streaming requires a published host port or a ranged request",
    );
  });

  test("returns all scanned updated-desc results without dropping matches behind limit", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cv-s3-route-"));
    try {
      writeFileSync(
        join(cwd, "docker-compose.yml"),
        [
          "services:",
          "  minio:",
          "    image: quay.io/minio/minio:latest",
          "    ports:",
          '      - "19000:9000"',
          "    environment:",
          "      MINIO_ROOT_USER: AK_TEST",
          "      MINIO_ROOT_PASSWORD: SK_TEST",
        ].join("\n"),
      );
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: (async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(
            [
              "<ListBucketResult>",
              "<IsTruncated>false</IsTruncated>",
              "<Contents><Key>a.txt</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified><Size>1</Size></Contents>",
              "<Contents><Key>b.txt</Key><LastModified>2026-01-03T00:00:00.000Z</LastModified><Size>2</Size></Contents>",
              "<Contents><Key>c.txt</Key><LastModified>2026-01-02T00:00:00.000Z</LastModified><Size>3</Size></Contents>",
              "</ListBucketResult>",
            ].join(""),
            { status: 200 },
          )) as typeof fetch,
      });

      const req = new Request(
        "http://localhost/_db/s3/objects?db=docker:minio&bucket=media&sort=updated-desc&limit=1",
      );
      const res = await handleS3Route(req, new URL(req.url), cwd);
      expect(res?.status).toBe(200);
      const data = (await res?.json()) as {
        objects: Array<{ key: string }>;
        truncated: boolean;
      };
      expect(data.objects.map((object) => object.key)).toEqual([
        "b.txt",
        "c.txt",
        "a.txt",
      ]);
      expect(data.truncated).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("caps updated-desc scans to two pages for fast initial rendering", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cv-s3-route-"));
    const requestedUrls: string[] = [];
    try {
      writeFileSync(
        join(cwd, "docker-compose.yml"),
        [
          "services:",
          "  minio:",
          "    image: quay.io/minio/minio:latest",
          "    ports:",
          '      - "19000:9000"',
          "    environment:",
          "      MINIO_ROOT_USER: AK_TEST",
          "      MINIO_ROOT_PASSWORD: SK_TEST",
        ].join("\n"),
      );
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: (async (input: RequestInfo | URL, _init?: RequestInit) => {
          const url = String(input);
          requestedUrls.push(url);
          const isSecond = url.includes("continuation-token=page-2");
          return new Response(
            [
              "<ListBucketResult>",
              "<IsTruncated>true</IsTruncated>",
              `<NextContinuationToken>${isSecond ? "page-3" : "page-2"}</NextContinuationToken>`,
              `<Contents><Key>${isSecond ? "b.txt" : "a.txt"}</Key><LastModified>${isSecond ? "2026-01-02" : "2026-01-01"}T00:00:00.000Z</LastModified><Size>1</Size></Contents>`,
              "</ListBucketResult>",
            ].join(""),
            { status: 200 },
          );
        }) as typeof fetch,
      });

      const req = new Request(
        "http://localhost/_db/s3/objects?db=docker:minio&bucket=media&sort=updated-desc",
      );
      const res = await handleS3Route(req, new URL(req.url), cwd);
      expect(res?.status).toBe(200);
      const data = (await res?.json()) as {
        objects: Array<{ key: string }>;
        scannedPages: number;
        scanLimitReached?: boolean;
        nextToken?: string;
      };
      expect(requestedUrls).toHaveLength(2);
      expect(data.objects.map((object) => object.key)).toEqual([
        "b.txt",
        "a.txt",
      ]);
      expect(data.scannedPages).toBe(2);
      expect(data.scanLimitReached).toBe(true);
      expect(data.nextToken).toBe("page-3");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("preserves truncated state when upstream continuation token does not advance", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cv-s3-route-"));
    const requestedUrls: string[] = [];
    try {
      writeFileSync(
        join(cwd, "docker-compose.yml"),
        [
          "services:",
          "  minio:",
          "    image: quay.io/minio/minio:latest",
          "    ports:",
          '      - "19000:9000"',
          "    environment:",
          "      MINIO_ROOT_USER: AK_TEST",
          "      MINIO_ROOT_PASSWORD: SK_TEST",
        ].join("\n"),
      );
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: (async (input: RequestInfo | URL, _init?: RequestInit) => {
          requestedUrls.push(String(input));
          return new Response(
            [
              "<ListBucketResult>",
              "<IsTruncated>true</IsTruncated>",
              "<NextContinuationToken>page-1</NextContinuationToken>",
              "<Contents><Key>a.txt</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified><Size>1</Size></Contents>",
              "</ListBucketResult>",
            ].join(""),
            { status: 200 },
          );
        }) as typeof fetch,
      });

      const req = new Request(
        "http://localhost/_db/s3/objects?db=docker:minio&bucket=media&sort=updated-desc&token=page-1",
      );
      const res = await handleS3Route(req, new URL(req.url), cwd);
      expect(res?.status).toBe(200);
      const data = (await res?.json()) as {
        truncated: boolean;
        nextToken?: string;
        scannedPages: number;
        scanLimitReached?: boolean;
      };
      expect(requestedUrls).toHaveLength(1);
      expect(data.truncated).toBe(true);
      expect(data.nextToken).toBeUndefined();
      expect(data.scannedPages).toBe(1);
      expect(data.scanLimitReached).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("limits contains search results before returning JSON", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cv-s3-route-"));
    try {
      writeFileSync(
        join(cwd, "docker-compose.yml"),
        [
          "services:",
          "  minio:",
          "    image: quay.io/minio/minio:latest",
          "    ports:",
          '      - "19000:9000"',
          "    environment:",
          "      MINIO_ROOT_USER: AK_TEST",
          "      MINIO_ROOT_PASSWORD: SK_TEST",
        ].join("\n"),
      );
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: (async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(
            [
              "<ListBucketResult>",
              "<IsTruncated>false</IsTruncated>",
              "<Contents><Key>a.txt</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified><Size>1</Size></Contents>",
              "<Contents><Key>b.txt</Key><LastModified>2026-01-02T00:00:00.000Z</LastModified><Size>1</Size></Contents>",
              "<Contents><Key>c.txt</Key><LastModified>2026-01-03T00:00:00.000Z</LastModified><Size>1</Size></Contents>",
              "</ListBucketResult>",
            ].join(""),
            { status: 200 },
          )) as typeof fetch,
      });

      const req = new Request(
        "http://localhost/_db/s3/objects?db=docker:minio&bucket=media&mode=contains&q=.txt&limit=2&sort=key-asc",
      );
      const res = await handleS3Route(req, new URL(req.url), cwd);
      expect(res?.status).toBe(200);
      const data = (await res?.json()) as {
        objects: Array<{ key: string }>;
      };
      expect(data.objects.map((object) => object.key)).toEqual([
        "a.txt",
        "b.txt",
      ]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("lists a single folder level with delimiter and excludes the self prefix", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cv-s3-folder-"));
    const requestedUrls: string[] = [];
    try {
      writeFileSync(
        join(cwd, "docker-compose.yml"),
        [
          "services:",
          "  minio:",
          "    image: quay.io/minio/minio:latest",
          "    ports:",
          '      - "19000:9000"',
          "    environment:",
          "      MINIO_ROOT_USER: AK_TEST",
          "      MINIO_ROOT_PASSWORD: SK_TEST",
        ].join("\n"),
      );
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: (async (input: RequestInfo | URL, _init?: RequestInit) => {
          requestedUrls.push(String(input));
          return new Response(
            [
              "<ListBucketResult>",
              "<IsTruncated>false</IsTruncated>",
              "<CommonPrefixes><Prefix>photos/2026/</Prefix></CommonPrefixes>",
              "<CommonPrefixes><Prefix>photos/2025/</Prefix></CommonPrefixes>",
              // フォルダ自身を表すプレースホルダ (key === prefix) は除外される。
              "<Contents><Key>photos/</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified><Size>0</Size></Contents>",
              "<Contents><Key>photos/cover.png</Key><LastModified>2026-01-02T00:00:00.000Z</LastModified><Size>10</Size></Contents>",
              "</ListBucketResult>",
            ].join(""),
            { status: 200 },
          );
        }) as typeof fetch,
      });

      const req = new Request(
        "http://localhost/_db/s3/folder?db=docker:minio&bucket=media&prefix=photos/",
      );
      const res = await handleS3Route(req, new URL(req.url), cwd);
      expect(res?.status).toBe(200);
      const data = (await res?.json()) as {
        prefix: string;
        folders: string[];
        objects: Array<{ key: string }>;
      };
      // delimiter=/ で 1 階層だけを列挙していること。
      expect(requestedUrls).toHaveLength(1);
      expect(requestedUrls[0].includes("delimiter=%2F")).toBe(true);
      expect(requestedUrls[0].includes("prefix=photos%2F")).toBe(true);
      expect(data.prefix).toBe("photos/");
      expect(data.folders).toEqual(["photos/2026/", "photos/2025/"]);
      expect(data.objects.map((object) => object.key)).toEqual([
        "photos/cover.png",
      ]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("requests encoding-type=url and decodes URL-encoded keys and prefixes", async () => {
    const requestedUrls: string[] = [];
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (input: RequestInfo | URL, _init?: RequestInit) => {
        requestedUrls.push(String(input));
        return new Response(
          [
            "<ListBucketResult>",
            "<IsTruncated>false</IsTruncated>",
            // "新規 folder/" と "a b.txt" を URL エンコードして返す。
            "<CommonPrefixes><Prefix>%E6%96%B0%E8%A6%8F%20folder/</Prefix></CommonPrefixes>",
            "<Contents><Key>photos/a%20b.txt</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified><Size>1</Size></Contents>",
            "</ListBucketResult>",
          ].join(""),
          { status: 200 },
        );
      }) as typeof fetch,
    });

    const explorer = await openS3ExplorerAsync(s3Info());
    const result = await explorer.listObjects({
      bucket: "media",
      prefix: "photos/",
      delimiter: "/",
    });

    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0].includes("encoding-type=url")).toBe(true);
    expect(result.objects.map((object) => object.key)).toEqual([
      "photos/a b.txt",
    ]);
    expect(result.commonPrefixes).toEqual(["新規 folder/"]);
  });

  test("propagates folder pagination tokens for large directories", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cv-s3-folder-page-"));
    try {
      writeFileSync(
        join(cwd, "docker-compose.yml"),
        [
          "services:",
          "  minio:",
          "    image: quay.io/minio/minio:latest",
          "    ports:",
          '      - "19000:9000"',
          "    environment:",
          "      MINIO_ROOT_USER: AK_TEST",
          "      MINIO_ROOT_PASSWORD: SK_TEST",
        ].join("\n"),
      );
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: (async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(
            [
              "<ListBucketResult>",
              "<IsTruncated>true</IsTruncated>",
              "<NextContinuationToken>next-page</NextContinuationToken>",
              "<Contents><Key>a.txt</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified><Size>1</Size></Contents>",
              "</ListBucketResult>",
            ].join(""),
            { status: 200 },
          )) as typeof fetch,
      });

      const req = new Request(
        "http://localhost/_db/s3/folder?db=docker:minio&bucket=media",
      );
      const res = await handleS3Route(req, new URL(req.url), cwd);
      expect(res?.status).toBe(200);
      const data = (await res?.json()) as {
        folders: string[];
        objects: Array<{ key: string }>;
        nextToken?: string;
      };
      expect(data.folders).toEqual([]);
      expect(data.objects.map((object) => object.key)).toEqual(["a.txt"]);
      expect(data.nextToken).toBe("next-page");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("stops contains scans once enough matches are found", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cv-s3-route-"));
    const requestedUrls: string[] = [];
    try {
      writeFileSync(
        join(cwd, "docker-compose.yml"),
        [
          "services:",
          "  minio:",
          "    image: quay.io/minio/minio:latest",
          "    ports:",
          '      - "19000:9000"',
          "    environment:",
          "      MINIO_ROOT_USER: AK_TEST",
          "      MINIO_ROOT_PASSWORD: SK_TEST",
        ].join("\n"),
      );
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: (async (input: RequestInfo | URL, _init?: RequestInit) => {
          requestedUrls.push(String(input));
          return new Response(
            [
              "<ListBucketResult>",
              "<IsTruncated>true</IsTruncated>",
              "<NextContinuationToken>page-2</NextContinuationToken>",
              "<Contents><Key>a.txt</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified><Size>1</Size></Contents>",
              "<Contents><Key>b.txt</Key><LastModified>2026-01-02T00:00:00.000Z</LastModified><Size>1</Size></Contents>",
              "</ListBucketResult>",
            ].join(""),
            { status: 200 },
          );
        }) as typeof fetch,
      });

      const req = new Request(
        "http://localhost/_db/s3/objects?db=docker:minio&bucket=media&mode=contains&q=.txt&limit=2&sort=key-asc",
      );
      const res = await handleS3Route(req, new URL(req.url), cwd);
      expect(res?.status).toBe(200);
      const data = (await res?.json()) as {
        objects: Array<{ key: string }>;
        scannedPages: number;
        nextToken?: string;
      };
      expect(requestedUrls).toHaveLength(1);
      expect(data.objects.map((object) => object.key)).toEqual([
        "a.txt",
        "b.txt",
      ]);
      expect(data.scannedPages).toBe(1);
      expect(data.nextToken).toBe("page-2");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
