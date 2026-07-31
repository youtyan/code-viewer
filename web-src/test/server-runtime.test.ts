import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { collectLineRangeFromStream } from "../server/range";
import {
  fileByteRangeResponseBody,
  fileReadableStream,
  readFileTextRange,
  runBytesSync,
  runSync,
  type StartedServer,
  spawnDetached,
  spawnStream,
  startServer,
} from "../server/runtime";

const tmpRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  ".tmp-tests",
);

describe("server runtime compatibility helpers", () => {
  test.each([
    {
      name: "returns empty output for a successful no-op",
      program: "void 0",
      expected: { code: 0, stdout: "", stderr: "" },
    },
    {
      name: "keeps standard output and standard error separate",
      program: 'process.stdout.write("out"); process.stderr.write("err")',
      expected: { code: 0, stdout: "out", stderr: "err" },
    },
    {
      name: "preserves a non-zero exit status",
      program: 'process.stdout.write("failed"); process.exit(7)',
      expected: { code: 7, stdout: "failed", stderr: "" },
    },
    {
      name: "decodes UTF-8 output",
      program: 'process.stdout.write("こんにちは")',
      expected: { code: 0, stdout: "こんにちは", stderr: "" },
    },
    {
      name: "keeps a non-zero error-only result",
      program: 'process.stderr.write("problem"); process.exit(1)',
      expected: { code: 1, stdout: "", stderr: "problem" },
    },
  ])("runSync $name", ({ program, expected }) => {
    expect(runSync([process.execPath, "-e", program], process.cwd())).toEqual(
      expected,
    );
  });

  test("runSync returns process status and decoded output", () => {
    const result = runSync(
      [process.execPath, "-e", 'process.stdout.write("ok")'],
      process.cwd(),
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("ok");
    expect(result.stderr).toBe("");
  });

  test("runSync captures command output beyond Node's small default buffer", () => {
    const result = runSync(
      [
        process.execPath,
        "-e",
        "process.stdout.write('x'.repeat(2 * 1024 * 1024))",
      ],
      process.cwd(),
    );

    expect(result.code).toBe(0);
    expect(result.stdout.length).toBe(2 * 1024 * 1024);
    expect(result.stderr).toBe("");
  });

  test("sync runners return ENOENT diagnostics instead of hiding spawn errors", () => {
    const missing = join(tmpRoot, "missing-command-for-sync-runtime");

    const text = runSync([missing], process.cwd());
    const bytes = runBytesSync([missing], process.cwd());

    expect(text.code).toBe(1);
    expect(text.stderr).toMatch(/enoent|no such file/i);
    expect(bytes.code).toBe(1);
    expect(bytes.stderr).toMatch(/enoent|no such file/i);
  });

  test("spawnStream resolves with a failure code when the command cannot be spawned", async () => {
    const missing = join(tmpRoot, "missing-command-for-stream-runtime");
    const child = spawnStream([missing], process.cwd());

    const code = await Promise.race([
      child.exited,
      new Promise<number>((resolve) => setTimeout(() => resolve(99), 1000)),
    ]);

    expect(code).toBe(1);
    await child.stream.cancel().catch(() => undefined);
    child.kill();
  });

  test("spawnDetached reports a start failure without throwing", async () => {
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    try {
      spawnDetached([join(tmpRoot, "missing-command-for-detached-runtime")]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(warnings.length).toBe(1);
      expect(String(warnings[0]?.[0])).toMatch(/failed to start/);
      expect(String(warnings[0]?.[1])).toMatch(/enoent|no such file/i);
    } finally {
      console.warn = originalWarn;
    }
  });

  test("file stream can be consumed as a web ReadableStream", async () => {
    mkdirSync(tmpRoot, { recursive: true });
    const path = join(tmpRoot, "lines.txt");
    writeFileSync(path, "one\ntwo\nthree\n");

    const range = await collectLineRangeFromStream(
      fileReadableStream(path),
      2,
      2,
    );

    expect(range.lines).toEqual(["two"]);
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("byte range body returns only the requested bytes", async () => {
    mkdirSync(tmpRoot, { recursive: true });
    const path = join(tmpRoot, "bytes.txt");
    writeFileSync(path, "abcdef");

    const body = await new Response(
      fileByteRangeResponseBody(path, 1, 3),
    ).text();
    const text = await readFileTextRange(path, 2, 5);

    expect(body).toBe("bcd");
    expect(text).toBe("cde");
    expect(readFileSync(path, "utf8")).toBe("abcdef");
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("logs request handler errors before returning a 500 response", async () => {
    const originalError = console.error;
    const logged: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };

    let server: StartedServer | undefined;

    try {
      server = await startServer({
        hostname: "127.0.0.1",
        port: 0,
        async fetch() {
          throw new Error("boom from handler");
        },
      });
      const response = await fetch(`http://127.0.0.1:${server.port}/explode`);

      expect(response.status).toBe(500);
      expect(await response.text()).toBe("internal server error");
      expect(logged.length).toBe(1);
      expect(logged[0]?.[0]).toBe("[code-viewer] request error:");
      expect(logged[0]?.[1]).toBe("GET");
      expect(logged[0]?.[2]).toBe("/explode");
      expect(String(logged[0]?.[3]).includes("boom from handler")).toBe(true);
    } finally {
      console.error = originalError;
      await server?.close();
    }
  });

  test("close resolves even when a streaming response is still open", async () => {
    let server: StartedServer | undefined;
    let streamController:
      | ReadableStreamDefaultController<Uint8Array>
      | undefined;

    try {
      server = await startServer({
        hostname: "127.0.0.1",
        port: 0,
        fetch() {
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                streamController = controller;
                controller.enqueue(new TextEncoder().encode("open"));
              },
            }),
            { headers: { "Content-Type": "text/plain; charset=utf-8" } },
          );
        },
      });

      const response = await fetch(`http://127.0.0.1:${server.port}/stream`);
      const reader = response.body?.getReader();
      expect(response.status).toBe(200);
      expect((await reader?.read())?.done).toBe(false);

      await server.close();
      await reader?.cancel().catch(() => undefined);
    } finally {
      try {
        streamController?.close();
      } catch {
        /* response may have been force-closed */
      }
      await server?.close().catch(() => undefined);
    }
  });
});
