import type { SpawnOptions } from "node:child_process";
import {
  onStdinWriteFailure,
  type RunFailure,
  type RunResult,
  spawnErrorFailure,
  spawnProcess,
  timedOutFailure,
} from "../../runtime";
import { abortError, throwIfAborted } from "./abort";

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
  /** 終了コードを返すところまで動かなかった理由 (runtime.ts の RunFailure)。 */
  failure?: RunFailure;
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
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawnProcess(opts.command, opts.args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer<ArrayBufferLike>[] = [];
    const stderrChunks: Buffer<ArrayBufferLike>[] = [];
    let settled = false;
    let timedOut = false;
    let stdinError: NodeJS.ErrnoException | undefined;
    const finish = (
      code: number,
      fallbackStderr?: string,
      failure?: RunFailure,
    ) => {
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
        failure,
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
    // 入力が届かなかったら子を止め、子が 0 で終わっても失敗として返す
    // (runtime.ts の runBytesAsync と同じ)。
    onStdinWriteFailure(child, (error) => {
      stdinError ??= error;
      child.kill(killSignal);
    });
    child.on("error", (err) => {
      if (opts.rejectOnError === false) {
        finish(
          1,
          err.message,
          spawnErrorFailure(err, opts.cwd ?? process.cwd()),
        );
      } else {
        fail(err);
      }
    });
    child.on("close", (code) => {
      if (stdinError) {
        finish(
          1,
          `could not write the input to ${opts.command}: ${stdinError.message}`,
        );
        return;
      }
      finish(
        timedOut ? 1 : (code ?? 1),
        timedOut ? opts.timeoutMessage : "",
        timedOut
          ? timedOutFailure(
              [opts.command, ...opts.args],
              opts.timeoutMs,
              startedAt,
            )
          : undefined,
      );
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
): Promise<RunResult> {
  const result = await spawnCollectAsync(opts);
  return {
    stdout: result.stdout.toString("utf8"),
    stderr: result.stderr.toString("utf8"),
    code: result.code,
    failure: result.failure,
  };
}
