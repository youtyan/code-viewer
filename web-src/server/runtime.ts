import {
  type ChildProcess,
  type SpawnOptions,
  type SpawnSyncOptionsWithBufferEncoding,
  spawn,
  spawnSync,
} from "node:child_process";
import { EventEmitter } from "node:events";
import { createReadStream, promises as fs, statSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { PassThrough, Readable, Writable } from "node:stream";
import { hasControlCharacter } from "../core/control-chars";
import { errorWithCause, formatErrorDetail } from "../core/error-detail";

/** `/events` sends this often; the entry proxy allows three missed beats. */
export const SSE_HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * `/events` asks the browser to reconnect this soon after the stream drops.
 * The EventSource default (about 3 s in Chrome) was the whole of the wait
 * after the entry server restarted (scripts/perf.mjs, sse.caughtUpMs).
 */
export const SSE_RETRY_MS = 500;

/**
 * 子が終了コードを返すところまで動かなかった理由。動いて終わったなら (0 でも
 * 非 0 でも) 無い。「コマンドが無い」かどうかは command-resolver.ts の
 * commandRunFailure がこれから決める (stderr の文言からは決めない)。
 */
export type RunFailure =
  | {
      kind: "timed-out";
      /** コマンド・上限・止めるまでにかかった時間を含む説明。 */
      message: string;
      timeoutMs: number;
      elapsedMs: number;
    }
  /** fork / exec の失敗 (ENOENT・EAGAIN・EMFILE・EACCES など)。 */
  | { kind: "spawn-error"; error: NodeJS.ErrnoException }
  /**
   * 作業ディレクトリが無い (か、ディレクトリでない)。node はこのときも
   * `spawn <command> ENOENT` を返すので、実行ファイルが無いのと分ける。
   */
  | { kind: "cwd-missing"; cwd: string; error: NodeJS.ErrnoException };

export type RunResult = {
  code: number;
  stdout: string;
  stderr: string;
  failure?: RunFailure;
};

export type RunBytesResult = {
  code: number;
  stdout: Uint8Array;
  stderr: string;
  failure?: RunFailure;
};

export function timedOutFailure(
  args: readonly string[],
  timeoutMs: number,
  startedAt: number,
): RunFailure {
  const elapsedMs = Date.now() - startedAt;
  // tmux の書式の区切り (0x1F) などをログにそのまま出さない。
  const line = args
    .map((arg) => (hasControlCharacter(arg) ? JSON.stringify(arg) : arg))
    .join(" ");
  const command = line.length > 200 ? `${line.slice(0, 200)}...` : line;
  return {
    kind: "timed-out",
    message: `${command} timed out after ${timeoutMs} ms (ETIMEDOUT; stopped at ${elapsedMs} ms)`,
    timeoutMs,
    elapsedMs,
  };
}

/**
 * 子の 'error' のうち、起動 (fork / exec) の失敗だけを RunFailure にする。取り
 * 消し (AbortError) と、止める signal を送れなかったこと (stopProcess) は起動の
 * 失敗ではないので undefined。
 */
export function spawnErrorFailure(
  error: unknown,
  cwd: string,
): RunFailure | undefined {
  const spawnError = error as NodeJS.ErrnoException | undefined;
  const syscall = spawnError?.syscall;
  if (typeof syscall !== "string" || !syscall.startsWith("spawn")) {
    return undefined;
  }
  // 作業ディレクトリがファイルのときは ENOTDIR (spawn は同期で投げる)。
  if (spawnError.code !== "ENOENT" && spawnError.code !== "ENOTDIR") {
    return { kind: "spawn-error", error: spawnError };
  }
  try {
    if (statSync(cwd).isDirectory()) {
      return { kind: "spawn-error", error: spawnError };
    }
  } catch (statError) {
    const code = (statError as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      // 作業ディレクトリを確かめられなかった。どちらが無いのか分からないので
      // 「無い」にせず、両方の理由を持つ起動の失敗にする。
      return {
        kind: "spawn-error",
        error: errorWithCause(
          `${spawnError.message}; checking the working directory ${cwd} also failed`,
          statError,
        ),
      };
    }
  }
  return { kind: "cwd-missing", cwd, error: spawnError };
}

/**
 * 子の stdin に書いた入力が届かなかったときだけ onFailure を呼ぶ。EPIPE は子が
 * 先に終わった (か、時間切れなどでこちらが止めた) ので管が閉じただけで、結果は
 * 終了コードと stderr が決める。それ以外 (EACCES・ENOSPC・壊れた記述子) は
 * 入力が子に届かなかったので、呼び出し側が失敗にする。
 */
export function onStdinWriteFailure(
  child: SpawnedProcess,
  onFailure: (error: NodeJS.ErrnoException) => void,
): void {
  child.stdin?.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") return;
    onFailure(error);
  });
}

export type RunOptions = {
  timeout?: number;
  maxBuffer?: number;
  // Written to the child stdin and closed immediately. Only for commands
  // whose input list can outgrow ARG_MAX (`git check-ignore --stdin` over a
  // recursive listing), not as a general interactive channel - nothing reads
  // back before the process exits.
  stdin?: string;
  // Replaces the child environment wholesale (spawn semantics), so callers
  // spread process.env themselves when they only want to add a variable.
  env?: NodeJS.ProcessEnv;
};

export type RunAsyncOptions = RunOptions & {
  /** Stops the child when its owning request is cancelled. */
  signal?: AbortSignal;
};

export type StartedServer = {
  port: number;
  close(): Promise<void>;
};

/**
 * spawnProcess が返すもの。呼び出し側が使うのはこれだけ (起動に失敗したときの
 * FailedSpawn も同じ形)。
 */
export type SpawnedProcess = Pick<
  ChildProcess,
  "pid" | "stdin" | "stdout" | "stderr" | "kill"
> &
  EventEmitter;

/**
 * 起動の時点で node が投げた子の代わり。起動できなかった子と同じく、次の tick で
 * 'error' を出し、出力を閉じてから 'exit' と 'close' を出す (終了コードは node と
 * 同じく負の errno)。pid は無く、kill は何もしない。
 *
 * node の ChildProcess を中身の無いまま作って代わりにしない。その kill は pid 0
 * (自分のプロセスグループ) に signal を送る。
 */
class FailedSpawn extends EventEmitter {
  readonly pid: number | undefined = undefined;
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;

  constructor(error: unknown, stdio: SpawnOptions["stdio"]) {
    super();
    const piped = (fd: number) =>
      ((Array.isArray(stdio) ? stdio[fd] : stdio) ?? "pipe") === "pipe";
    // 書かれた入力は捨てる (読む子が居ない)。
    this.stdin = piped(0)
      ? new Writable({
          write(_chunk, _encoding, done) {
            done();
          },
        })
      : null;
    const stdout = piped(1) ? new PassThrough() : null;
    const stderr = piped(2) ? new PassThrough() : null;
    this.stdout = stdout;
    this.stderr = stderr;
    const code = (error as NodeJS.ErrnoException).errno ?? 1;
    process.nextTick(() => {
      this.emit("error", error);
      stdout?.end();
      stderr?.end();
      this.emit("exit", code, null);
      this.emit("close", code, null);
    });
  }

  kill(): boolean {
    return false;
  }
}

/**
 * サーバが起こす子プロセスの唯一の入口。`node:child_process` はこのファイル
 * (と biome.jsonc の noRestrictedImports が名前を挙げて許すファイル) の外から
 * import できない。
 *
 * 子は detached (setsid) で起こし、サーバを動かしている端末を制御端末に持た
 * せない。持たせると対話シェル (accounts/launch.ts の agentCommandArgv の
 * `$SHELL -i -c`) が端末の前面を自分のグループにし (tcsetpgrp)、exec した
 * コマンドが終わっても・時間切れで SIGKILL されても戻さない。前面が消えた
 * グループのままになり、`pnpm dev` の Ctrl+C がどのプロセスにも届かなかった。
 * 端末が無いので、子が /dev/tty で入力を待つこともない (すぐ失敗する)。
 *
 * detached の子には端末の Ctrl+C が届かないので、止めるときは stopProcess で
 * グループごと止め (対話シェルが fork した孫も残さない)、このプロセスの終了時
 * にまだ動いているものも止める。
 */
export function spawnProcess(
  command: string,
  args: readonly string[],
  options: Omit<SpawnOptions, "detached"> = {},
): SpawnedProcess {
  let child: ChildProcess;
  try {
    child = spawn(command, args, { ...options, detached: true });
  } catch (error) {
    // node は ENOENT・EACCES・EAGAIN・EMFILE・ENFILE を 'error' で知らせるが、
    // それ以外 (作業ディレクトリがファイルのときの ENOTDIR など) は同期で投げる。
    // 呼び出し側が reject を考えなくてよいよう、'error' と同じ形にそろえる。
    return new FailedSpawn(error, options.stdio);
  }
  const pid = child.pid;
  if (pid === undefined) return child; // 起動できなかった ('error' で知らせる)
  if (!stopLiveProcessesOnExit) {
    stopLiveProcessesOnExit = true;
    process.on("exit", stopLiveProcesses);
  }
  liveProcessGroups.add(pid);
  // 'close' は孫も含めて出力を閉じ終えたとき。グループの番号は、そのグループに
  // 誰かが居る間は別のプロセスに使い回されない。
  child.once("close", () => liveProcessGroups.delete(pid));
  return child;
}

/**
 * spawnProcess で起こした子のグループに signal を送る。もう居なければ何もしない。
 * 送れなかったことは ChildProcess.kill と同じく子の 'error' で知らせる (呼び
 * 出し側の error の扱いに乗せ、タイマーの中で投げてサーバを落とさない)。
 */
export function stopProcess(
  child: SpawnedProcess,
  signal: NodeJS.Signals,
): void {
  if (child.pid === undefined) return;
  try {
    signalProcessGroup(child.pid, signal);
  } catch (error) {
    child.emit(
      "error",
      errorWithCause(
        `could not send ${signal} to child process group ${child.pid}`,
        error,
      ),
    );
  }
}

const liveProcessGroups = new Set<number>();
let stopLiveProcessesOnExit = false;

/**
 * プロセスグループ pid に signal を送る。もう居なければ何もしない。送れな
 * ければ投げる。使ってよいのは、自分が起こして pid を控えたものだけ
 * (spawnProcess の子、「使用量を確かめる」が作ったペインのシェル)。
 */
export function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // ESRCH: グループはもう居ない (止めるものが無い)。
    if (code === "ESRCH") return;
    // macOS は、終わって回収待ち (ゾンビ) の子だけのグループに EPERM を返す
    // (Linux は返さない)。グループの長にじかに送れば、回収待ちなら何も起きず、
    // 本当に送れないなら同じ EPERM がここから出る。
    if (code !== "EPERM") throw error;
  }
  try {
    process.kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function stopLiveProcesses(): void {
  const failures: unknown[] = [];
  for (const pid of liveProcessGroups) {
    try {
      signalProcessGroup(pid, "SIGKILL");
    } catch (error) {
      failures.push(
        errorWithCause(`could not stop child process group ${pid}`, error),
      );
    }
  }
  if (failures.length === 0) return;
  // 'exit' の中では投げても止められないので、全件を出して終了コードで知らせる。
  for (const failure of failures) console.error(formatErrorDetail(failure));
  process.exitCode = 1;
}

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
    failure: proc.failure,
  };
}

export function runAsync(
  args: string[],
  cwd: string,
  options: RunAsyncOptions = {},
): Promise<RunResult> {
  return runBytesAsync(args, cwd, options).then((proc) => ({
    code: proc.code,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: proc.stderr,
    failure: proc.failure,
  }));
}

export function runBytesSync(
  args: string[],
  cwd: string,
  options: RunOptions = {},
): RunBytesResult {
  // detached の理由は spawnProcess。同期なので終了時に残るものは無い。
  // spawnSync も detached を受け付ける (setsid。server-runtime.test.ts が
  // 子のグループで確かめる) が、@types/node の SpawnSyncOptions には無いので、
  // 型を足した変数で渡す。
  const spawnOptions: SpawnSyncOptionsWithBufferEncoding & {
    detached: true;
  } = {
    cwd,
    detached: true,
    env: options.env,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeout,
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    killSignal: "SIGKILL",
  };
  const startedAt = Date.now();
  const proc = spawnSync(args[0], args.slice(1), spawnOptions);
  const error = proc.error as NodeJS.ErrnoException | undefined;
  // spawnSync は時間切れも error (code ETIMEDOUT、syscall spawnSync …) で返す。
  const failure =
    error?.code === "ETIMEDOUT" && options.timeout !== undefined
      ? timedOutFailure(args, options.timeout, startedAt)
      : spawnErrorFailure(error, cwd);
  return {
    code: proc.status ?? (proc.error ? 1 : 0),
    stdout: new Uint8Array(proc.stdout || new Uint8Array()),
    stderr: appendProcessError(
      new TextDecoder().decode(proc.stderr || new Uint8Array()),
      failure?.kind === "timed-out" ? new Error(failure.message) : error,
    ),
    failure,
  };
}

export function runBytesAsync(
  args: string[],
  cwd: string,
  options: RunAsyncOptions = {},
): Promise<RunBytesResult> {
  const maxBuffer = options.maxBuffer ?? 64 * 1024 * 1024;
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const proc = spawnProcess(args[0], args.slice(1), {
      cwd,
      env: options.env,
      stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      signal: options.signal,
    });
    if (options.stdin !== undefined) {
      onStdinWriteFailure(proc, (error) => {
        processError ??= error;
        stopProcess(proc, killSignal);
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
            stopProcess(proc, killSignal);
          }, options.timeout);
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      let stderr = new TextDecoder().decode(concatBytes(stderrChunks));
      const failure =
        timedOut && options.timeout !== undefined
          ? timedOutFailure(args, options.timeout, startedAt)
          : spawnErrorFailure(processError, cwd);
      if (failure?.kind === "timed-out") {
        stderr = appendProcessError(stderr, new Error(failure.message));
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
        failure,
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
          stopProcess(proc, killSignal);
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
      // 子を起こせなかった・入力を渡せなかったときは、子が 0 で終わっていても
      // 成功として返さない (stderr にだけ理由が残る状態にしない)。
      finish(timedOut || bufferExceeded || processError ? 1 : (code ?? 0));
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

/**
 * 子プロセスの終わり方。「動いて終了コードを返した」と「そもそも起動できな
 * かった」(コマンドが無い・権限が無い) を分ける。両方を終了コード 1 に潰すと、
 * 呼び出し側は「その ref にその中身が無い」(404) と「git を起こせない」(500)
 * を見分けられない。
 */
export type SpawnStreamExit =
  | { kind: "exit"; code: number }
  | { kind: "failed"; error: Error };

export function spawnStream(
  args: string[],
  cwd: string,
): {
  stream: ReadableStream<Uint8Array>;
  exited: Promise<SpawnStreamExit>;
  kill(signal?: string): void;
} {
  const proc = spawnProcess(args[0], args.slice(1), {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });
  let spawnError: Error | null = null;
  proc.on("error", (error) => {
    spawnError ??= error;
  });
  return {
    stream: Readable.toWeb(
      proc.stdout,
    ) as unknown as ReadableStream<Uint8Array>,
    exited: new Promise((resolve) => {
      let settled = false;
      const done = (exit: SpawnStreamExit) => {
        if (settled) return;
        settled = true;
        resolve(exit);
      };
      proc.on("error", (error) => done({ kind: "failed", error }));
      proc.on("close", (code) =>
        done(
          spawnError
            ? { kind: "failed", error: spawnError }
            : { kind: "exit", code: code ?? 1 },
        ),
      );
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
  /**
   * listen に成功した後に出たサーバのエラー。聞き続けられる保証は無いので、
   * 本番の呼び出し側はここから共通の終了処理 (exit 1) へ繋ぐ。省略できない
   * のは、省略すると「ログだけ出して壊れたまま動き続ける」に戻るため。
   */
  onError: (error: Error) => void;
}): Promise<StartedServer> {
  const server = createServer(async (req, res) => {
    // Handlers read `request.signal` to stop long external processes (rg,
    // git) when the browser abandons the request. Node's IncomingMessage
    // has no such signal, so derive one from the response closing before
    // it finished: that is the client-went-away case.
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) abort.abort();
    });
    try {
      const request = nodeRequestToWeb(
        req,
        options.hostname,
        server.address(),
        abort.signal,
      );
      const response = await options.fetch(request);
      await writeWebResponse(res, response);
    } catch (error) {
      console.error("[code-viewer] request error:", req.method, req.url, error);
      if (res.headersSent || res.writableEnded) {
        res.destroy(error instanceof Error ? error : undefined);
        return;
      }
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(formatErrorDetail(error));
    }
  });
  return new Promise((resolve, reject) => {
    // ポートが塞がっているときは次の一手を添える (入口も --standalone もここ)。
    const failListen = (error: NodeJS.ErrnoException) =>
      reject(
        error.code === "EADDRINUSE"
          ? errorWithCause(
              `port ${options.port} is used by another program. Pass another --port, or leave --port out to use a free port.`,
              error,
            )
          : error,
      );
    server.once("error", failListen);
    server.listen(options.port, options.hostname, () => {
      server.off("error", failListen);
      server.on("error", options.onError);
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
  signal?: AbortSignal,
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
    signal,
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
