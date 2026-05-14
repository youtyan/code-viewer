import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectLineRangeFromStream } from "../server/range";
import {
  fileByteRangeResponseBody,
  fileReadableStream,
  readFileTextRange,
  runSync,
  type StartedServer,
  startServer,
} from "../server/runtime";

const tmpRoot = join(import.meta.dir, "..", "..", ".tmp-tests");

describe("server runtime compatibility helpers", () => {
  test("runSync returns process status and decoded output", () => {
    const result = runSync(
      [process.execPath, "-e", 'process.stdout.write("ok")'],
      process.cwd(),
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("ok");
    expect(result.stderr).toBe("");
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
});
