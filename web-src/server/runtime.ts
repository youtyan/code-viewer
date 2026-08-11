import { spawn, spawnSync } from "node:child_process";
import { createReadStream, promises as fs, statSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { Readable } from "node:stream";

export type RunResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type RunBytesResult = {
  code: number;
  stdout: Uint8Array;
  stderr: string;
};

type RunOptions = {
  timeout?: number;
  maxBuffer?: number;
  // Written to the child stdin and closed immediately. Only for commands
  // whose input list can outgrow ARG_MAX (`git check-ignore --stdin` over a
  // recursive listing), not as a general interactive channel - nothing reads
  // back before the process exits.
  stdin?: string;
};

export type StartedServer = {
  port: number;
  close(): Promise<void>;
};

export function runSync(
  args: string[],
  cwd: string,
  options: RunOptions = {},
): RunResult {
  const proc = runBytesSync(args, cwd, options);
  return {
    code: proc.code,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: proc.stderr,
  };
}

export function runAsync(
  args: string[],
  cwd: string,
  options: RunOptions = {},
): Promise<RunResult> {
  return runBytesAsync(args, cwd, options).then((proc) => ({
    code: proc.code,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: proc.stderr,
  }));
}

export function runBytesSync(
  args: string[],
  cwd: string,
  options: RunOptions = {},
): RunBytesResult {
  const proc = spawnSync(args[0], args.slice(1), {
    cwd,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeout,
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    killSignal: "SIGKILL",
  });
  return {
    code: proc.status ?? (proc.error ? 1 : 0),
    stdout: new Uint8Array(proc.stdout || new Uint8Array()),
    stderr: appendProcessError(
      new TextDecoder().decode(proc.stderr || new Uint8Array()),
      proc.error,
    ),
  };
}

export function runBytesAsync(
  args: string[],
  cwd: string,
  options: RunOptions = {},
): Promise<RunBytesResult> {
  const maxBuffer = options.maxBuffer ?? 64 * 1024 * 1024;
  return new Promise((resolve) => {
    const proc = spawn(args[0], args.slice(1), {
      cwd,
      stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    if (options.stdin !== undefined) {
      proc.stdin?.on("error", () => {
        // A child that exits before draining its input (or a kill from the
        // timeout/maxBuffer paths) closes the pipe mid-write - EPIPE here is
        // expected, and the exit code still decides the result.
      });
      proc.stdin?.end(options.stdin);
    }
    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;
    let bufferExceeded = false;
    let processError: Error | undefined;
    const killSignal: NodeJS.Signals = "SIGKILL";
    const timer =
      options.timeout === undefined
        ? null
        : setTimeout(() => {
            timedOut = true;
            proc.kill(killSignal);
          }, options.timeout);
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      let stderr = new TextDecoder().decode(concatBytes(stderrChunks));
      if (timedOut) {
        stderr = appendProcessError(
          stderr,
          new Error(`spawn ${args[0]} ETIMEDOUT`),
        );
      } else if (bufferExceeded) {
        stderr = appendProcessError(
          stderr,
          new Error("stdout maxBuffer exceeded"),
        );
      } else {
        stderr = appendProcessError(stderr, processError);
      }
      resolve({
        code,
        stdout: concatBytes(stdoutChunks),
        stderr,
      });
    };
    const collect =
      (chunks: Uint8Array[], onBytes: (length: number) => void) =>
      (chunk: Uint8Array) => {
        const bytes = new Uint8Array(chunk);
        chunks.push(bytes);
        onBytes(bytes.byteLength);
        if (
          !bufferExceeded &&
          (stdoutBytes > maxBuffer || stderrBytes > maxBuffer)
        ) {
          bufferExceeded = true;
          proc.kill(killSignal);
        }
      };
    proc.stdout?.on(
      "data",
      collect(stdoutChunks, (length) => {
        stdoutBytes += length;
      }),
    );
    proc.stderr?.on(
      "data",
      collect(stderrChunks, (length) => {
        stderrBytes += length;
      }),
    );
    proc.on("error", (err) => {
      processError = err;
    });
    proc.on("close", (code) => {
      finish(timedOut || bufferExceeded ? 1 : (code ?? (processError ? 1 : 0)));
    });
  });
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 0) return new Uint8Array();
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function spawnStream(
  args: string[],
  cwd: string,
): {
  stream: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(signal?: string): void;
} {
  const proc = spawn(args[0], args.slice(1), {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });
  let errorCode = 0;
  proc.on("error", () => {
    errorCode = 1;
  });
  return {
    stream: Readable.toWeb(
      proc.stdout,
    ) as unknown as ReadableStream<Uint8Array>,
    exited: new Promise((resolve) => {
      let settled = false;
      const done = (code: number) => {
        if (settled) return;
        settled = true;
        resolve(code);
      };
      proc.on("error", () => done(1));
      proc.on("close", (code) => done(errorCode || (code ?? 1)));
    }),
    kill: (signal?: string) => proc.kill(signal as NodeJS.Signals | undefined),
  };
}

function appendProcessError(stderr: string, err: Error | undefined): string {
  if (!err) return stderr;
  return `${stderr}${stderr ? "\n" : ""}${err.message}`;
}

// createReadStream() opens a directory (and other non-regular files) happily and
// only fails once the first read runs, from inside the stream. By then the body
// is already handed to Readable.fromWeb()/pipe(), where the EISDIR surfaces as an
// unhandled rejection and takes the whole process down instead of failing one
// request. Fail synchronously at the call site so the caller's catch sees it.
function assertReadableRegularFile(path: string): void {
  const stats = statSync(path) as unknown as {
    isFile(): boolean;
    isDirectory(): boolean;
  };
  if (stats.isFile()) return;
  const error = new Error(`not a regular file: ${path}`) as Error & {
    code?: string;
  };
  error.code = stats.isDirectory() ? "EISDIR" : "EINVAL";
  throw error;
}

export function fileReadableStream(path: string): ReadableStream<Uint8Array> {
  assertReadableRegularFile(path);
  return Readable.toWeb(
    createReadStream(path),
  ) as unknown as ReadableStream<Uint8Array>;
}

export function fileByteRangeResponseBody(
  path: string,
  start: number,
  endInclusive: number,
): ReadableStream<Uint8Array> {
  assertReadableRegularFile(path);
  return Readable.toWeb(
    createReadStream(path, { start, end: endInclusive }),
  ) as unknown as ReadableStream<Uint8Array>;
}

export async function readFileTextRange(
  path: string,
  start: number,
  endExclusive: number,
): Promise<string> {
  const length = Math.max(0, endExclusive - start);
  if (length === 0) return "";
  const handle = await fs.open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const result = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, result.bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

export function startServer(options: {
  hostname: string;
  port: number;
  fetch: (req: Request) => Response | Promise<Response>;
}): Promise<StartedServer> {
  const server = createServer(async (req, res) => {
    try {
      const request = nodeRequestToWeb(req, options.hostname, server.address());
      const response = await options.fetch(request);
      await writeWebResponse(res, response);
    } catch (error) {
      console.error("[code-viewer] request error:", req.method, req.url, error);
      if (res.headersSent || res.writableEnded) {
        res.destroy(error instanceof Error ? error : undefined);
        return;
      }
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("internal server error");
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.hostname, () => {
      server.off("error", reject);
      server.on("error", (error) => {
        console.error("[code-viewer] server error:", error);
      });
      const address = server.address();
      const port =
        typeof address === "object" && address ? address.port : options.port;
      resolve({
        port,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            let settled = false;
            let forceTimer: ReturnType<typeof setTimeout> | null = null;
            const settle = (error?: Error | null) => {
              if (settled) return;
              settled = true;
              if (forceTimer) clearTimeout(forceTimer);
              const code =
                error && "code" in error
                  ? String((error as { code?: unknown }).code)
                  : "";
              if (error && code !== "ERR_SERVER_NOT_RUNNING") {
                rejectClose(error);
                return;
              }
              resolveClose();
            };
            forceTimer = setTimeout(() => {
              server.closeAllConnections?.();
              settle();
            }, 2000);
            forceTimer.unref?.();
            server.close(settle);
            server.closeIdleConnections?.();
            server.closeAllConnections?.();
          }),
      });
    });
  });
}

function nodeRequestToWeb(
  req: IncomingMessage,
  hostname: string,
  address: ReturnType<ReturnType<typeof createServer>["address"]>,
): Request {
  const port = typeof address === "object" && address ? address.port : 0;
  const host = req.headers.host || `${hostname}:${port}`;
  const url = new URL(req.url || "/", `http://${host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  const method = req.method || "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, {
    method,
    headers,
    body: hasBody
      ? (Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>)
      : undefined,
    duplex: hasBody ? "half" : undefined,
  } as RequestInit);
}

async function writeWebResponse(
  res: ServerResponse,
  response: Response,
): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (!response.body) {
    res.end();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const body = Readable.fromWeb(
      response.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>,
    );
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    body.on("error", (error) =>
      settle(() => {
        res.destroy(error);
        reject(error);
      }),
    );
    res.on("finish", () => settle(resolve));
    res.on("close", () =>
      settle(() => {
        body.destroy();
        resolve();
      }),
    );
    body.pipe(res);
  });
}
