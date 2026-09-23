import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";
import { formatErrorDetail } from "../core/error-detail";
import { collectLineRangeFromStream } from "../server/range";
import {
  fileByteRangeResponseBody,
  fileReadableStream,
  readFileTextRange,
  runBytesAsync,
  runBytesSync,
  runSync,
  type SpawnStreamExit,
  type StartedServer,
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

  // 直す前は起動の失敗も終了コード 1 になり、「動いて 1 で終わった」と
  // 区別できなかった。今は kind が分かれ、理由 (ENOENT) が残る。
  test("spawnStream reports a spawn failure as failed, not as exit code 1", async () => {
    const missing = join(tmpRoot, "missing-command-for-stream-runtime");
    const child = spawnStream([missing], process.cwd());

    const exit = await Promise.race([
      child.exited,
      new Promise<SpawnStreamExit>((resolve) =>
        setTimeout(() => resolve({ kind: "exit", code: 99 }), 1000),
      ),
    ]);

    expect(exit.kind).toBe("failed");
    if (exit.kind !== "failed") throw new Error("expected a spawn failure");
    expect(formatErrorDetail(exit.error)).toMatch(/enoent|no such file/i);
    await child.stream.cancel().catch(() => undefined);
    child.kill();
  });

  test("spawnStream reports a non-zero exit as an exit code", async () => {
    const child = spawnStream(["sh", "-c", "exit 3"], process.cwd());

    const exit = await child.exited;

    expect(exit).toEqual({ kind: "exit", code: 3 });
    await child.stream.cancel().catch(() => undefined);
  });

  // 子が先に終わって壊れたパイプ (EPIPE) は想定内。終了コードがそのまま結果を
  // 決め、失敗としては報告しない。
  test("runBytesAsync keeps a broken stdin pipe out of the result", async () => {
    const result = await runBytesAsync(
      [process.execPath, "-e", "process.exit(4)"],
      process.cwd(),
      { stdin: "x".repeat(4 * 1024 * 1024) },
    );

    expect(result.code).toBe(4);
    expect(result.stderr).toBe("");
  });

  // 直す前は stdin の error を全部捨てていたので、入力が子に届かなくても
  // 「成功」で返っていた。EPIPE 以外は失敗として理由を stderr に残す。
  test("runBytesAsync reports a stdin write failure that is not EPIPE", async () => {
    vi.resetModules();
    const { EventEmitter } = await import("node:events");
    const { PassThrough, Writable } = await import("node:stream");
    const child = new EventEmitter() as InstanceType<typeof EventEmitter> & {
      stdin: InstanceType<typeof Writable>;
      stdout: InstanceType<typeof PassThrough>;
      stderr: InstanceType<typeof PassThrough>;
      kill(signal?: string): void;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({
      write(_chunk, _encoding, callback) {
        callback(Object.assign(new Error("write EACCES"), { code: "EACCES" }));
      },
    });
    child.kill = () => {
      // 入力が届かなかった子は止めるが、この偽の子には送る先が無い。
    };
    vi.doMock("node:child_process", async () => ({
      ...(await vi.importActual<typeof import("node:child_process")>(
        "node:child_process",
      )),
      spawn: () => child,
    }));
    try {
      const runtime = await import("../server/runtime");
      const pending = runtime.runBytesAsync(["anything"], process.cwd(), {
        stdin: "input the child never reads",
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0);

      const result = await pending;

      expect(result.stderr).toContain("write EACCES");
      // 子が 0 で終わっても、入力が届かなかったのは失敗として返す。
      expect(result.code).toBe(1);
    } finally {
      vi.doUnmock("node:child_process");
      vi.resetModules();
    }
  });

  // 直す前は listen した後のエラーを console に出すだけで、壊れたサーバのまま
  // 動き続けていた。今は呼び出し側 (preview / entry) の終了処理へ渡る。
  test("a server error after listen is handed to onError", async () => {
    vi.resetModules();
    const { EventEmitter } = await import("node:events");
    const fake = new EventEmitter() as InstanceType<typeof EventEmitter> & {
      listen(port: number, hostname: string, onListening: () => void): void;
      address(): { port: number };
      close(done: (error?: Error) => void): void;
    };
    fake.listen = (_port, _hostname, onListening) => {
      setTimeout(onListening, 0);
    };
    fake.address = () => ({ port: 65000 });
    fake.close = (done) => done();
    vi.doMock("node:http", async () => ({
      ...(await vi.importActual<typeof import("node:http")>("node:http")),
      createServer: () => fake,
    }));
    try {
      const runtime = await import("../server/runtime");
      const seen: string[] = [];
      const started = await runtime.startServer({
        hostname: "127.0.0.1",
        port: 0,
        fetch: () => new Response("ok"),
        onError: (error) => seen.push(error.message),
      });

      fake.emit("error", new Error("late listener failure"));

      expect(seen).toEqual(["late listener failure"]);
      await started.close();
    } finally {
      vi.doUnmock("node:http");
      vi.resetModules();
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
        onError: (error) => console.error("test server error:", error),
        async fetch() {
          throw new Error("boom from handler");
        },
      });
      const response = await fetch(`http://127.0.0.1:${server.port}/explode`);

      expect(response.status).toBe(500);
      expect(await response.text()).toBe("Error: boom from handler");
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

  test("request.signal aborts when the client disconnects before the response", async () => {
    let server: StartedServer | undefined;
    let observedAbort: Promise<boolean> | undefined;
    try {
      server = await startServer({
        hostname: "127.0.0.1",
        port: 0,
        onError: (error) => console.error("test server error:", error),
        fetch(req) {
          observedAbort = new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(false), 5000);
            req.signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                resolve(true);
              },
              { once: true },
            );
          });
          // Hold the response until the client gives up.
          return observedAbort.then(() => new Response("late"));
        },
      });
      const controller = new AbortController();
      const pending = fetch(`http://127.0.0.1:${server.port}/slow`, {
        signal: controller.signal,
      });
      // Wait until the handler has been entered before aborting.
      while (!observedAbort) await new Promise((r) => setTimeout(r, 5));
      controller.abort();
      await pending.catch(() => undefined);
      expect(await observedAbort).toBe(true);
    } finally {
      await server?.close().catch(() => undefined);
    }
  });

  test("request.signal stays quiet for a request that completes normally", async () => {
    let server: StartedServer | undefined;
    let signal: AbortSignal | undefined;
    try {
      server = await startServer({
        hostname: "127.0.0.1",
        port: 0,
        onError: (error) => console.error("test server error:", error),
        fetch(req) {
          signal = req.signal;
          return new Response("done");
        },
      });
      const response = await fetch(`http://127.0.0.1:${server.port}/ok`);
      expect(await response.text()).toBe("done");
      // Give the 'close' event a tick to fire after the response finished.
      await new Promise((r) => setTimeout(r, 20));
      expect(signal?.aborted).toBe(false);
    } finally {
      await server?.close().catch(() => undefined);
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
        onError: (error) => console.error("test server error:", error),
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
