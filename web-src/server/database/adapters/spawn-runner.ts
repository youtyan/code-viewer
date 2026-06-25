import { type SpawnOptions, spawn } from "node:child_process";
import { abortError, throwIfAborted } from "./abort";

export type SpawnTextResult = {
  stdout: string;
  stderr: string;
  code: number;
};

export type SpawnCollectOptions = {
  command: string;
  args: string[];
  cwd?: string;
  env?: SpawnOptions["env"];
  input?: Buffer<ArrayBufferLike> | string;
  timeoutMs: number;
  signal?: AbortSignal;
  killSignal?: NodeJS.Signals;
  abortMessage: string;
  timeoutMessage: string;
  rejectOnError?: boolean;
};

export type SpawnCollectResult = {
  stdout: Buffer<ArrayBufferLike>;
  stderr: Buffer<ArrayBufferLike>;
  code: number;
};

function appendMessage(
  buffer: Buffer<ArrayBufferLike>,
  message: string,
): Buffer<ArrayBufferLike> {
  const suffix = `${buffer.length > 0 ? "\n" : ""}${message}`;
  return Buffer.concat([buffer, Buffer.from(suffix, "utf8")]);
}

export function spawnCollectAsync(
  opts: SpawnCollectOptions,
): Promise<SpawnCollectResult> {
  throwIfAborted(opts.signal, opts.abortMessage);
  const killSignal = opts.killSignal ?? "SIGTERM";
  return new Promise((resolve, reject) => {
    const child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer<ArrayBufferLike>[] = [];
    const stderrChunks: Buffer<ArrayBufferLike>[] = [];
    let settled = false;
    let timedOut = false;
    const finish = (code: number, fallbackStderr?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", abort);
      let stderr: Buffer<ArrayBufferLike> = Buffer.concat(stderrChunks);
      if (fallbackStderr) stderr = appendMessage(stderr, fallbackStderr);
      resolve({
        stdout: Buffer.concat(stdoutChunks),
        stderr,
        code,
      });
    };
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", abort);
      reject(err);
    };
    const abort = () => {
      child.kill(killSignal);
      fail(abortError(opts.abortMessage));
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill(killSignal);
    }, opts.timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdoutChunks.push(Buffer.from(chunk));
    });
    child.stderr?.on("data", (chunk) => {
      stderrChunks.push(Buffer.from(chunk));
    });
    child.stdin?.on("error", () => {
      // Process exit/abort can close stdin before the pending input is flushed.
    });
    child.on("error", (err) => {
      if (opts.rejectOnError === false) {
        finish(1, err.message);
      } else {
        fail(err);
      }
    });
    child.on("close", (code) => {
      finish(timedOut ? 1 : (code ?? 1), timedOut ? opts.timeoutMessage : "");
    });
    opts.signal?.addEventListener("abort", abort, { once: true });
    if (opts.signal?.aborted) {
      abort();
    } else if (opts.input !== undefined) {
      child.stdin?.end(opts.input);
    }
  });
}

export async function spawnTextAsync(
  opts: SpawnCollectOptions,
): Promise<SpawnTextResult> {
  const result = await spawnCollectAsync(opts);
  return {
    stdout: result.stdout.toString("utf8"),
    stderr: result.stderr.toString("utf8"),
    code: result.code,
  };
}
