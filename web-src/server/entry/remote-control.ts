// 外部接続 (Cloudflare Tunnel + Access) を入口のサーバの中で動かす。設定画面の
// 「外部接続」が `/_entry/remote*` で使う。
//
// - 待ち受け: 127.0.0.1:<port>。Access の JWT を確かめてから入口の処理へ渡す
//   (関所は remote-access.ts)。外から来た要求には publicOrigin が付く
// - cloudflared: `cloudflared tunnel run --token-file <file>` を code-viewer の
//   端末 (server/shell/session.ts の PTY。「＋」のシェルと同じ) で起こし、張れて
//   いる接続の数を出力から数える。出力は端末のタブで見る (設定の「ターミナルで
//   見る」)。タブを閉じても動き続け、タブの「セッションを止める」で止まる
// - 設定ファイル (remote-access.json) と Tunnel のトークン (tunnel-token): 設定
//   画面から 0600 で書く。トークンはどの応答にもログにも出さない
//
// 開始・停止・保存は 1 本の列で順に行う (連打・保存と開始の重なりで、待ち受けや
// cloudflared を二重に起こさない)。cloudflared の終了の知らせは、その子がまだ
// 今の子であるときだけ反映する (止めた後・起こし直した後の古い子の知らせで
// 今の状態を上書きしない)。
//
// 利用者の環境に残すもの: 設定ファイルとトークン (利用者の設定なので消さない)、
// 画面から入れた cloudflared (Homebrew の管理)。トークンは --remote-access で
// 別の設定ファイルを渡したときも状態フォルダに置く (渡したファイルの隣は
// リポジトリの中でありうる)。
//
// cloudflared は入口の終了処理 (shutdown) と、端末の後始末 (入口が終われば
// PTY が閉じる) で止まる。SIGKILL で入口が終わると残りうるので、起こした pid を状態フォルダに控え、
// 次の入口が起動時と開始の前に、控えた pid がまだ同じトークンの cloudflared
// なら止める (stopLeftoverTunnel)。

import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { JWTVerifyGetKey } from "jose";
import { errorWithCause, formatErrorDetail } from "../../core/error-detail";
import {
  cloudflaredRunArgs,
  REMOTE_LOCAL_ONLY_CODE,
  type RemoteAccessSaveRequest,
  type RemoteAccessStatus,
  type RemoteAccessValues,
} from "../../core/remote-access";
import type { ShellSessionId } from "../../core/shell";
import { stripAnsi } from "../../core/terminal-images";
import {
  json,
  parseBoundedJsonBody,
  textError,
} from "../database/handle-shared";
import { processAlive } from "../file-lock";
import {
  type RunResult,
  runAsync,
  type SpawnedProcess,
  type StartedServer,
  signalProcessGroup,
  spawnProcess,
  startServer,
  stopProcess,
} from "../runtime";
import { createShellSession, watchShellOutput } from "../shell/session";
import { writeFileAtomic } from "../terminal/settings-file";
import { codeViewerStateDir } from "../user-state-dir";
import {
  createRemoteAccess,
  parseRemoteAccessFile,
  parseRemoteAccessValues,
  type RemoteAccessFile,
} from "./remote-access";

const CONFIG_FILE_NAME = "remote-access.json";
const TOKEN_FILE_NAME = "tunnel-token";
const PID_FILE_NAME = "remote-access-cloudflared.pid";
/** 画面に返す cloudflared の出力の行数と、1 行の長さの上限。 */
const LOG_LINES = 200;
const LOG_LINE_CHARS = 2000;
/** cloudflared が自分で終わったとき、理由に添える出力の行数。 */
const EXIT_TAIL_LINES = 20;
/** SIGTERM の後、SIGKILL に切り替えるまで待つ時間。SIGKILL の後も同じだけ待つ。 */
const STOP_WAIT_MS = 5000;
const VERSION_TIMEOUT_MS = 5000;
/** `POST /_entry/remote/config` の本文の上限 (値 4 つとトークン)。 */
const MAX_BODY_BYTES = 16 * 1024;

/** `--remote-access` を付けずに起動したときの設定ファイル。 */
export function defaultRemoteAccessConfigPath(): string {
  return join(codeViewerStateDir(), CONFIG_FILE_NAME);
}

/**
 * 貼られた文字からトークンを取り出す。トークンだけでも、Tunnel の画面が示す
 * `cloudflared service install <token>`・`cloudflared tunnel run --token <token>`
 * をそのまま貼ってもよい。トークンは JSON (a: アカウント、t: Tunnel の ID、
 * s: 秘密) を base64 にしたもので、JSON の始まり `{"` は base64 で `eyJ` になる。
 */
export function parseTunnelToken(input: string): {
  token: string;
  tunnelId: string;
} {
  const candidates = [
    ...new Set(
      input
        .split(/\s+/)
        .map((word) => word.replace(/^["']|["']$/g, ""))
        .filter((word) => /^eyJ[A-Za-z0-9+/_-]+={0,2}$/.test(word)),
    ),
  ];
  if (candidates.length === 0) {
    throw new Error(
      "no Cloudflare Tunnel token was found. Paste the long text after --token or service install from the Tunnel's install command",
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `${candidates.length} Tunnel tokens were found; paste only the token of the Tunnel for code-viewer`,
    );
  }
  const token = candidates[0] ?? "";
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(token, "base64").toString("utf8"));
  } catch (error) {
    // V8 の SyntaxError の文は、壊れた所の前後の原文 (秘密を含みうる) を引用する。
    // 原文は残さず、種類と位置だけを理由に残す。
    const parseError = error as Error;
    const position = /\bposition (\d+)/.exec(parseError.message)?.[1];
    throw new Error(
      `the pasted Tunnel token is cut off or broken (${parseError.name}${position ? ` at position ${position}` : ""} in the decoded token); copy it again from the Tunnel's install command`,
    );
  }
  const fields = (decoded ?? {}) as Record<string, unknown>;
  const tunnelId = fields.t;
  if (
    typeof fields.a !== "string" ||
    !fields.a ||
    typeof fields.s !== "string" ||
    !fields.s ||
    typeof tunnelId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      tunnelId,
    )
  ) {
    throw new Error(
      "the pasted text is not a Cloudflare Tunnel token (it has no account, Tunnel ID and secret)",
    );
  }
  return { token, tunnelId };
}

/**
 * cloudflared の出力 1 行から、接続が張れた・切れたを読む。接続は connIndex
 * (0〜3) ごと。「切れた」の後は cloudflared が自分で張り直し、張れたらまた
 * Registered が出る。
 */
export function tunnelConnectionEvent(
  line: string,
): { kind: "up" | "down"; index: string } | null {
  const index = /\bconnIndex=(\d+)/.exec(line)?.[1];
  if (index === undefined) return null;
  if (/\bRegistered tunnel connection\b/.test(line))
    return { kind: "up", index };
  if (/\b(?:Unregistered tunnel connection|Connection terminated)\b/.test(line))
    return { kind: "down", index };
  return null;
}

/** 本文の形を確かめる (値の中身は parseRemoteAccessValues が見る)。 */
export function parseRemoteAccessSaveRequest(
  body: unknown,
): RemoteAccessSaveRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("the request body must be a JSON object");
  }
  const { values, autoStart, token, ...rest } = body as Record<string, unknown>;
  const unknown = Object.keys(rest);
  if (unknown.length)
    throw new Error(`unknown remote access fields: ${unknown.join(", ")}`);
  const request: RemoteAccessSaveRequest = {};
  if (values !== undefined) request.values = parseRemoteAccessValues(values);
  if (typeof autoStart === "boolean") request.autoStart = autoStart;
  else if (autoStart !== undefined)
    throw new Error("autoStart must be true or false");
  if (typeof token === "string") {
    if (token.trim()) request.token = token;
  } else if (token !== undefined) throw new Error("token must be a string");
  if (Object.keys(request).length === 0)
    throw new Error("nothing to save: send values, autoStart or token");
  return request;
}

type CloudflaredState = RemoteAccessStatus["cloudflared"];

/** 実行ファイルが見つからなかった (動いて失敗したのではない)。 */
function commandMissing(result: RunResult): boolean {
  return (
    result.failure?.kind === "spawn-error" &&
    result.failure.error.code === "ENOENT"
  );
}

/**
 * `cloudflared --version` の結果を、画面に出す状態にする。installable は
 * 呼び出し側が Homebrew を確かめてから決める (ここでは false)。
 */
export function cloudflaredVersionResult(
  command: string,
  result: RunResult,
): Exclude<CloudflaredState, { state: "unknown" | "installing" }> {
  if (result.code === 0) {
    const line = result.stdout.trim().split("\n")[0] ?? "";
    return { state: "ok", version: /\bversion (\S+)/.exec(line)?.[1] ?? line };
  }
  if (commandMissing(result)) {
    return {
      state: "unavailable",
      error: `${command} was not found in PATH. Install it (for example: brew install cloudflared), then press Start again`,
      installable: false,
    };
  }
  const stderr = result.stderr.trim();
  const reason = result.failure
    ? result.failure.kind === "timed-out"
      ? result.failure.message
      : formatErrorDetail(result.failure.error)
    : `exited with ${result.code}${stderr ? `: ${stderr}` : ""}`;
  return {
    state: "unavailable",
    error: `${command} --version failed: ${reason}`,
    installable: false,
  };
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw errorWithCause(`could not check ${path}`, error);
  }
}

type ConfigState = RemoteAccessStatus["config"];
type TokenState = RemoteAccessStatus["token"];

type Listener =
  | { state: "stopped" }
  | { state: "running"; server: StartedServer; values: RemoteAccessValues }
  | { state: "failed"; error: string };

type Tunnel =
  | { state: "stopped" }
  | { state: "skipped" }
  | {
      state: "running";
      /** cloudflared を動かしている code-viewer の端末 (タブで開ける)。 */
      shell: ShellSessionId;
      pid: number;
      connections: Set<string>;
      /** 終わったら解決する (止めるときに待つ)。 */
      closed: Promise<void>;
      /** こちらが止めている (終了を失敗として出さない)。 */
      stopping: boolean;
      /** 出力の最後の行 (自分で終わったときの理由に添える。端末は終わると消える)。 */
      tail: string[];
    }
  | { state: "exited"; error: string };

export type RemoteControlDeps = {
  configPath: string;
  configFromFlag: boolean;
  /** 関所を通った外からの要求を、入口の処理へ渡す。 */
  forward(request: Request, publicOrigin: string): Promise<Response>;
  /** 待ち受けた後に出た待ち受けのエラー (入口の終了処理へ繋ぐ)。 */
  onListenerError(error: Error): void;
  /** 起こす cloudflared。既定は PATH の cloudflared (テストで差し替える)。 */
  cloudflared?: string;
  /** cloudflared を入れる Homebrew。既定は PATH の brew (テストで差し替える)。 */
  brew?: string;
  /** Access の鍵 (テストで差し替える)。 */
  accessKey?: JWTVerifyGetKey;
  /** トークンと、起こした cloudflared の pid の置き場所。既定は状態フォルダ (テストで差し替える)。 */
  tokenPath?: string;
  pidPath?: string;
};

export type RemoteControl = ReturnType<typeof createRemoteControl>;

/**
 * 要求の誤り (400 invalid) と、今の状態ではできない (409 conflict)。応答は
 * 入口のほかの失敗と同じ { error, code } だけにする (画面はこの形から理由を出す)。
 */
class RemoteRequestError extends Error {
  constructor(
    readonly code: "invalid" | "conflict",
    message: string,
    cause?: unknown,
  ) {
    super(message);
    if (cause !== undefined) Object.assign(this, { cause });
  }
}

export function createRemoteControl(deps: RemoteControlDeps) {
  const configPath = deps.configPath;
  const tokenPath =
    deps.tokenPath ?? join(codeViewerStateDir(), TOKEN_FILE_NAME);
  const pidPath = deps.pidPath ?? join(codeViewerStateDir(), PID_FILE_NAME);
  const cloudflared = deps.cloudflared ?? "cloudflared";
  const brew = deps.brew ?? "brew";
  let generation = 0;
  let listener: Listener = { state: "stopped" };
  let tunnel: Tunnel = { state: "stopped" };
  let probe: CloudflaredState = { state: "unknown" };
  /** `brew install cloudflared` が動いている間はその子。 */
  let installing: SpawnedProcess | null = null;
  /** 最後に確かめたとき、cloudflared の実行ファイルが無かった。 */
  let cloudflaredMissing = false;
  /** 利用者が開始していて、まだ停止していない (保存した値をすぐ当てる)。 */
  let active = false;
  const log: string[] = [];
  let queue: Promise<unknown> = Promise.resolve();

  function changed(): void {
    generation += 1;
  }

  /**
   * 操作を 1 本の列で順に行う。前の操作の失敗はその呼び出し側が受け取って
   * いるので、列は失敗しても次へ進める (失敗を捨てているのではない)。
   */
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const run = queue.then(operation);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function appendLog(line: string): void {
    log.push(
      line.length > LOG_LINE_CHARS ? `${line.slice(0, LOG_LINE_CHARS)}…` : line,
    );
    if (log.length > LOG_LINES) log.splice(0, log.length - LOG_LINES);
    changed();
  }

  function readConfig(): ConfigState {
    let text: string;
    try {
      text = readFileSync(configPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { state: "absent" };
      return {
        state: "invalid",
        error: `could not read ${configPath}: ${formatErrorDetail(error)}`,
      };
    }
    try {
      const file = parseRemoteAccessFile(JSON.parse(text));
      return { state: "ok", values: file.values, autoStart: file.autoStart };
    } catch (error) {
      return {
        state: "invalid",
        error: `${configPath} is not a valid remote access config: ${formatErrorDetail(error)}`,
      };
    }
  }

  function readToken(): TokenState {
    let text: string;
    try {
      text = readFileSync(tokenPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { state: "absent" };
      return {
        state: "invalid",
        error: `could not read ${tokenPath}: ${formatErrorDetail(error)}`,
      };
    }
    let parsed: { token: string; tunnelId: string };
    try {
      parsed = parseTunnelToken(text);
    } catch (error) {
      return {
        state: "invalid",
        error: `${tokenPath} does not hold a Tunnel token: ${formatErrorDetail(error)}`,
      };
    }
    // cloudflared は --token-file のファイル全体をトークンとして読む。手で作った
    // ファイルにコマンドや引用符が残っていると、ここで「保存済み」と出しても
    // cloudflared が断る。
    if (text.trim() !== parsed.token)
      return {
        state: "invalid",
        error: `${tokenPath} must contain only the Tunnel token (it has other text around it). Paste the install command into Tunnel token in Settings to save the token alone`,
      };
    return { state: "ok", tunnelId: parsed.tunnelId };
  }

  function status(): RemoteAccessStatus {
    return {
      generation,
      configPath,
      tokenPath,
      configFromFlag: deps.configFromFlag,
      config: readConfig(),
      token: readToken(),
      cloudflared: probe,
      listener:
        listener.state === "running"
          ? {
              state: "running",
              port: listener.server.port,
              origin: listener.values.origin,
            }
          : listener,
      tunnel:
        tunnel.state === "running"
          ? {
              state: "running",
              pid: tunnel.pid,
              connections: tunnel.connections.size,
              shell: tunnel.shell,
            }
          : tunnel,
      log: [...log],
    };
  }

  async function probeCloudflared(): Promise<
    Exclude<CloudflaredState, { state: "unknown" }>
  > {
    // 入れている間は確かめない (終わったら確かめる)。
    if (installing) return { state: "installing" };
    // 作業ディレクトリは何でもよい。いつもあるところで動かす。
    const result = await runAsync([cloudflared, "--version"], tmpdir(), {
      timeout: VERSION_TIMEOUT_MS,
    });
    let found: Exclude<CloudflaredState, { state: "unknown" }> =
      cloudflaredVersionResult(cloudflared, result);
    const missing = commandMissing(result);
    if (found.state === "unavailable" && missing) {
      const homebrew = await runAsync([brew, "--version"], tmpdir(), {
        timeout: VERSION_TIMEOUT_MS,
      });
      found = { ...found, installable: homebrew.code === 0 };
    }
    // 確かめている間に「入れる」が押されたら、そちらの状態を残す。
    if (installing) return { state: "installing" };
    cloudflaredMissing = missing;
    probe = found;
    changed();
    return found;
  }

  /**
   * `brew install cloudflared` を子として動かす。待たずに返し、出力は
   * cloudflared の出力と同じ所へ [brew] を付けて流す。終わったら確かめ直す。
   * 開始・停止の列には入れない (数分かかることがあり、その間も止められるように)。
   */
  async function installCloudflared(): Promise<void> {
    if (installing) return;
    // 入口を起こし直した直後など、まだ確かめていなければ先に確かめる。
    const found = probe.state === "unknown" ? await probeCloudflared() : probe;
    if (installing || found.state === "installing") return;
    if (found.state === "ok")
      throw new RemoteRequestError(
        "conflict",
        "cloudflared is already installed",
      );
    if (!cloudflaredMissing)
      throw new RemoteRequestError(
        "conflict",
        `cloudflared is installed but does not run, so it is not installed again: ${found.error}`,
      );
    if (!found.installable)
      throw new RemoteRequestError(
        "conflict",
        "cloudflared cannot be installed from here: Homebrew was not found in PATH. Install cloudflared with the instructions on the Tunnel page",
      );
    const child = spawnProcess(brew, ["install", "cloudflared"], {
      cwd: tmpdir(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    installing = child;
    probe = { state: "installing" };
    appendLog(`[code-viewer] running ${brew} install cloudflared`);
    for (const stream of [child.stdout, child.stderr]) {
      if (!stream) continue;
      createInterface({ input: stream }).on("line", (line) =>
        appendLog(`[brew] ${line}`),
      );
    }
    let spawnError: Error | null = null;
    child.on("error", (error: Error) => {
      spawnError ??= error;
      console.error("[code-viewer] remote access: brew failed", error);
      appendLog(`[code-viewer] ${formatErrorDetail(error)}`);
    });
    child.once("close", (code: number | null, signal: string | null) => {
      installing = null;
      const how = signal ? `signal ${signal}` : `code ${code}`;
      appendLog(`[code-viewer] ${brew} install cloudflared exited (${how})`);
      if (code === 0 && !spawnError) {
        probeCloudflared().catch((error: unknown) => {
          console.error(
            "[code-viewer] remote access: checking cloudflared after installing it failed",
            error,
          );
          probe = {
            state: "unavailable",
            error: `checking cloudflared after installing it failed: ${formatErrorDetail(error)}`,
            installable: true,
          };
          changed();
        });
        return;
      }
      const error = spawnError
        ? `${brew} could not be started: ${formatErrorDetail(spawnError)}`
        : `${brew} install cloudflared failed (${how}). The last lines of its output are below.`;
      console.error(`[code-viewer] remote access: ${error}`);
      probe = { state: "unavailable", error, installable: true };
      changed();
    });
  }

  async function stopListener(): Promise<void> {
    if (listener.state !== "running") {
      listener = { state: "stopped" };
      changed();
      return;
    }
    const { server } = listener;
    listener = { state: "stopped" };
    changed();
    await server.close();
    console.log("[code-viewer] remote access: listener stopped");
  }

  async function startListener(values: RemoteAccessValues): Promise<void> {
    if (
      listener.state === "running" &&
      JSON.stringify(listener.values) === JSON.stringify(values)
    )
      return;
    await stopListener();
    const guard = createRemoteAccess(values, deps.accessKey);
    try {
      const server = await startServer({
        hostname: "127.0.0.1",
        port: values.port,
        fetch: (req) =>
          guard(req, (authenticated) =>
            deps.forward(authenticated, values.origin),
          ),
        onError: deps.onListenerError,
      });
      listener = { state: "running", server, values };
      console.log(
        `[code-viewer] remote access: ${values.origin} (tunnel target http://127.0.0.1:${server.port})`,
      );
    } catch (error) {
      const failure = errorWithCause(
        `could not listen on 127.0.0.1:${values.port} for remote access. Choose another port, and use the same port in the Tunnel's service URL`,
        error,
      );
      console.error("[code-viewer] remote access:", failure);
      listener = { state: "failed", error: formatErrorDetail(failure) };
    }
    changed();
  }

  /** closed を ms まで待つ。来なければ false。タイマーは必ず片付ける。 */
  async function waitClosed(
    closed: Promise<void>,
    ms: number,
  ): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        closed.then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), ms);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function stopTunnel(): Promise<void> {
    if (tunnel.state !== "running") {
      tunnel = { state: "stopped" };
      changed();
      return;
    }
    const running = tunnel;
    running.stopping = true;
    signalProcessGroup(running.pid, "SIGTERM");
    if (await waitClosed(running.closed, STOP_WAIT_MS)) return;
    appendLog(
      `[code-viewer] cloudflared did not stop within ${STOP_WAIT_MS / 1000} seconds; sending SIGKILL`,
    );
    signalProcessGroup(running.pid, "SIGKILL");
    if (await waitClosed(running.closed, STOP_WAIT_MS)) return;
    // SIGKILL の後も出力が閉じない (送れなかった・孫が管を持っている)。待ち続けると
    // 開始・停止・保存・入口の終了が全部詰まるので、理由を残して先へ進む。
    const error = `cloudflared (pid ${running.pid}) did not stop even after SIGKILL; stop it by hand (kill ${running.pid})`;
    console.error(`[code-viewer] remote access: ${error}`);
    appendLog(`[code-viewer] ${error}`);
    if (tunnel === running) {
      tunnel = { state: "exited", error };
      changed();
    }
  }

  /** 起こした cloudflared の pid の記録 (入口が SIGKILL で終わったときの後始末用)。 */
  function readPidRecord(): { pid: number; tokenPath: string } | null {
    let text: string;
    try {
      text = readFileSync(pidPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw errorWithCause(`could not read ${pidPath}`, error);
    }
    let record: unknown;
    try {
      record = JSON.parse(text);
    } catch (error) {
      throw errorWithCause(`${pidPath} is not valid JSON`, error);
    }
    const { pid, tokenPath: recordedTokenPath } = (record ?? {}) as Record<
      string,
      unknown
    >;
    if (
      typeof pid !== "number" ||
      !Number.isInteger(pid) ||
      pid <= 0 ||
      typeof recordedTokenPath !== "string"
    )
      throw new Error(
        `${pidPath} does not hold a cloudflared pid record: ${text}`,
      );
    return { pid, tokenPath: recordedTokenPath };
  }

  function removePidRecord(pid: number): void {
    if (readPidRecord()?.pid === pid) rmSync(pidPath, { force: true });
  }

  async function waitGone(pid: number, ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (processAlive(pid)) {
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return true;
  }

  /**
   * 前の入口が SIGKILL などで終わり、止められずに残った cloudflared を止める。
   * pid は使い回されるので、まだ同じトークンのファイルで動く cloudflared である
   * ことを ps で確かめてから止める。確かめられなければ止めずに投げる。
   */
  async function stopLeftoverTunnel(): Promise<void> {
    const record = readPidRecord();
    if (!record) return;
    if (tunnel.state === "running" && tunnel.pid === record.pid) return;
    if (processAlive(record.pid)) {
      const ps = await runAsync(
        ["ps", "-o", "command=", "-p", String(record.pid)],
        tmpdir(),
        { timeout: VERSION_TIMEOUT_MS },
      );
      if (ps.failure || (ps.code !== 0 && ps.code !== 1))
        throw new Error(
          `could not check whether pid ${record.pid} in ${pidPath} is a cloudflared left by an earlier code-viewer (ps exited with ${ps.code}${ps.failure ? `: ${ps.failure.kind === "timed-out" ? ps.failure.message : formatErrorDetail(ps.failure.error)}` : ps.stderr.trim() ? `: ${ps.stderr.trim()}` : ""}). Stop it by hand if it is, then delete ${pidPath}`,
        );
      const command = ps.stdout.trim();
      if (
        ps.code === 0 &&
        command.includes("cloudflared") &&
        command.includes(`--token-file ${record.tokenPath}`)
      ) {
        const message = `stopping cloudflared (pid ${record.pid}) left running by an earlier code-viewer`;
        console.log(`[code-viewer] remote access: ${message}`);
        appendLog(`[code-viewer] ${message}`);
        signalProcessGroup(record.pid, "SIGTERM");
        if (!(await waitGone(record.pid, STOP_WAIT_MS))) {
          signalProcessGroup(record.pid, "SIGKILL");
          if (!(await waitGone(record.pid, STOP_WAIT_MS)))
            throw new Error(
              `cloudflared (pid ${record.pid}) left by an earlier code-viewer did not stop even after SIGKILL; stop it by hand (kill ${record.pid})`,
            );
        }
      }
    }
    rmSync(pidPath, { force: true });
  }

  async function startTunnel(): Promise<void> {
    if (tunnel.state === "running") return;
    try {
      await stopLeftoverTunnel();
    } catch (error) {
      console.error("[code-viewer] remote access:", error);
      tunnel = { state: "exited", error: formatErrorDetail(error) };
      changed();
      return;
    }
    const token = readToken();
    if (token.state === "absent") {
      tunnel = { state: "skipped" };
      changed();
      return;
    }
    if (token.state === "invalid") {
      tunnel = { state: "exited", error: token.error };
      changed();
      return;
    }
    const found = await probeCloudflared();
    if (found.state !== "ok") {
      tunnel = {
        state: "exited",
        error:
          found.state === "installing"
            ? "cloudflared is still being installed; press Start again when it finishes"
            : found.error,
      };
      changed();
      return;
    }
    // code-viewer の端末で動かす: 設定の「ターミナルで見る」でタブに開いて出力を
    // 見られ、タブを閉じても動き続ける。端末の子なので入口が終われば一緒に終わる。
    const created = await createShellSession(
      dirname(tokenPath),
      {},
      undefined,
      {
        file: cloudflared,
        args: cloudflaredRunArgs(tokenPath),
        purpose: { kind: "remote-tunnel" },
      },
    );
    if (created.status !== "ok") {
      const error =
        created.status === "unavailable"
          ? `cloudflared runs in a code-viewer terminal, which needs @lydell/node-pty: ${created.reason || "it could not be loaded"}`
          : created.status === "error"
            ? `cloudflared could not be started: ${formatErrorDetail(created.error)}`
            : `cloudflared could not be started: a terminal ${created.session.id} is already open`;
      console.error(`[code-viewer] remote access: ${error}`);
      tunnel = { state: "exited", error };
      changed();
      return;
    }
    let closeTunnel: () => void = () => undefined;
    const closed = new Promise<void>((resolve) => {
      closeTunnel = resolve;
    });
    const current: Tunnel & { state: "running" } = {
      state: "running",
      shell: created.session.id,
      pid: created.pid,
      connections: new Set(),
      closed,
      stopping: false,
      tail: [],
    };
    tunnel = current;
    changed();
    let partial = "";
    const unwatch = watchShellOutput(
      current.shell,
      (chunk) => {
        const lines = `${partial}${chunk}`.split(/\r\n|\n|\r/);
        partial = lines.pop() ?? "";
        for (const raw of lines) {
          // 端末の中の cloudflared は色を付けて書く。色を落としてから読む。
          const line = stripAnsi(raw);
          if (!line) continue;
          current.tail.push(
            line.length > LOG_LINE_CHARS
              ? `${line.slice(0, LOG_LINE_CHARS)}…`
              : line,
          );
          if (current.tail.length > EXIT_TAIL_LINES) current.tail.shift();
          if (tunnel !== current) continue;
          const event = tunnelConnectionEvent(line);
          if (event?.kind === "up") current.connections.add(event.index);
          if (event?.kind === "down") current.connections.delete(event.index);
          changed();
        }
      },
      (exitCode, closedByRequest) => {
        try {
          removePidRecord(current.pid);
        } catch (error) {
          // 終了の知らせの中なので投げ返す先が無い。画面の出力とログに全文を残す
          // (残った記録は次の開始で確かめ直される)。
          console.error(
            "[code-viewer] remote access: removing the pid record failed",
            error,
          );
          appendLog(`[code-viewer] ${formatErrorDetail(error)}`);
        }
        if (tunnel === current) {
          if (current.stopping || closedByRequest) {
            // こちらの停止か、端末のタブの「セッションを止める」。
            tunnel = { state: "stopped" };
            console.log("[code-viewer] remote access: cloudflared stopped");
          } else {
            const last = [...current.tail, stripAnsi(partial)].filter(Boolean);
            const error = `cloudflared exited (code ${exitCode}).${last.length ? `\nLast output:\n${last.join("\n")}` : ""}`;
            console.error(`[code-viewer] remote access: ${error}`);
            tunnel = { state: "exited", error };
          }
          changed();
        }
        closeTunnel();
      },
    );
    if (!unwatch) {
      // 受け手を付ける前に終わった (端末はもう無い)。
      removePidRecord(current.pid);
      tunnel = {
        state: "exited",
        error: `cloudflared exited right after it started (pid ${current.pid})`,
      };
      changed();
      return;
    }
    try {
      mkdirSync(dirname(pidPath), { recursive: true, mode: 0o700 });
      writeFileAtomic(
        pidPath,
        `${JSON.stringify({ pid: current.pid, tokenPath })}\n`,
        0o600,
      );
    } catch (error) {
      // 記録できないまま動かすと、入口が SIGKILL で終わったときに誰も止めない。
      current.stopping = true;
      signalProcessGroup(current.pid, "SIGTERM");
      await waitClosed(closed, STOP_WAIT_MS);
      throw errorWithCause(
        `cloudflared was stopped because its pid could not be recorded in ${pidPath}`,
        error,
      );
    }
    console.log(
      `[code-viewer] remote access: cloudflared started (pid ${current.pid})`,
    );
  }

  function readValidConfig(): RemoteAccessFile {
    const config = readConfig();
    if (config.state === "absent")
      throw new RemoteRequestError(
        "conflict",
        `remote access is not set up yet: save the Cloudflare values first (${configPath})`,
      );
    if (config.state === "invalid")
      throw new RemoteRequestError("conflict", config.error);
    return { values: config.values, autoStart: config.autoStart };
  }

  async function startUnqueued(): Promise<void> {
    const file = readValidConfig();
    active = true;
    await startListener(file.values);
    if (listener.state !== "running") return;
    await startTunnel();
  }

  async function stopUnqueued(): Promise<void> {
    active = false;
    await stopTunnel();
    await stopListener();
  }

  function writeConfig(file: RemoteAccessFile, current: ConfigState): void {
    mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
    // 読めなかったファイルは上書きせず、隣に退かしてから書く。
    if (current.state === "invalid") {
      const aside = `${configPath}.broken-${Date.now()}`;
      try {
        renameSync(configPath, aside);
      } catch (error) {
        throw errorWithCause(
          `${configPath} could not be read and could not be moved aside, so it was not overwritten`,
          error,
        );
      }
      console.error(
        `[code-viewer] remote access: moved the unreadable config to ${aside}`,
      );
    }
    // リンク (dotfiles など) ならリンク先を書く (リンクをただのファイルに置き換えない)。
    // autoStart は入れたときだけ書く: 入れていなければ、以前の版 (知らない欄を
    // 断る) の code-viewer もこのファイルで起動できる。
    const target = isSymlink(configPath)
      ? realpathSync(configPath)
      : configPath;
    writeFileAtomic(
      target,
      `${JSON.stringify(file.autoStart ? { ...file.values, autoStart: true } : file.values, null, 2)}\n`,
      0o600,
    );
  }

  async function saveUnqueued(request: RemoteAccessSaveRequest): Promise<void> {
    const current = readConfig();
    let next: RemoteAccessFile | null =
      current.state === "ok"
        ? { values: current.values, autoStart: current.autoStart }
        : null;
    if (request.values)
      next = { values: request.values, autoStart: next?.autoStart ?? false };
    if (request.autoStart !== undefined) {
      if (!next)
        throw new RemoteRequestError(
          "conflict",
          "save the Cloudflare values before turning on start with code-viewer",
        );
      next = { ...next, autoStart: request.autoStart };
    }
    // 書く前に全部確かめる (トークンが誤っていたら値も書かない)。
    let token: string | null = null;
    if (request.token) {
      try {
        token = parseTunnelToken(request.token).token;
      } catch (error) {
        throw new RemoteRequestError(
          "invalid",
          formatErrorDetail(error),
          error,
        );
      }
    }
    // トークンを先に書く: 値の書き込みが後で失敗しても、画面の値は保存前の
    // まま (未保存) に見え、待ち受けとファイルの値が食い違わない。
    if (token) {
      mkdirSync(dirname(tokenPath), { recursive: true, mode: 0o700 });
      writeFileAtomic(tokenPath, `${token}\n`, 0o600);
      changed();
    }
    if (next && (request.values || request.autoStart !== undefined)) {
      writeConfig(next, current);
      changed();
    }
    // 開いている待ち受け (--remote-access で開いたものも) には、保存した値を
    // すぐ当てる。開始していて待ち受けを開けなかったときも、新しい値で開き直す。
    // 「起動時に開始する」だけの変更では、今の接続に触らない。
    if (request.values && next && (active || listener.state !== "stopped"))
      await startListener(next.values);
    if (!token) return;
    if (tunnel.state === "running") await stopTunnel();
    if (active && listener.state === "running") await startTunnel();
  }

  async function handleRoute(
    req: Request,
    url: URL,
    mutationAllowed: (request: Request) => boolean,
  ): Promise<Response | null> {
    const path = url.pathname;
    if (path === "/_entry/remote") {
      if (req.method !== "GET") return textError("method not allowed", 405);
      return json(status());
    }
    const action =
      path === "/_entry/remote/config"
        ? "config"
        : path === "/_entry/remote/start"
          ? "start"
          : path === "/_entry/remote/stop"
            ? "stop"
            : path === "/_entry/remote/install"
              ? "install"
              : // cloudflared を確かめ直す。子プロセスを起こすので書き込み系と同じ扱い
                // (ブラウザは同じオリジンの GET に Origin を付けず、副作用の印を確かめられない)。
                path === "/_entry/remote/probe"
                ? "probe"
                : null;
    if (!action) return null;
    if (req.method !== "POST") return textError("method not allowed", 405);
    if (!mutationAllowed(req)) return textError("forbidden", 403);
    try {
      if (action === "config") {
        const body = await parseBoundedJsonBody(
          req,
          MAX_BODY_BYTES,
          "remote access settings too large",
        );
        if (body instanceof Response) return body;
        let request: RemoteAccessSaveRequest;
        try {
          request = parseRemoteAccessSaveRequest(body);
        } catch (error) {
          throw new RemoteRequestError(
            "invalid",
            formatErrorDetail(error),
            error,
          );
        }
        await serial(() => saveUnqueued(request));
      } else if (action === "start") {
        await serial(startUnqueued);
      } else if (action === "install") {
        await installCloudflared();
      } else if (action === "probe") {
        await serial(probeCloudflared);
      } else {
        await serial(stopUnqueued);
      }
    } catch (error) {
      if (error instanceof RemoteRequestError)
        return json(
          { error: error.message, code: error.code },
          error.code === "invalid" ? 400 : 409,
        );
      console.error(
        `[code-viewer] remote access: ${req.method} ${path} failed`,
        error,
      );
      return json(
        {
          error: `${req.method} ${path} failed: ${formatErrorDetail(error)}`,
          code: "failed",
        },
        500,
      );
    }
    return json(status());
  }

  return {
    status,
    handleRoute,
    /** `--remote-access <file>` で起動した: 待ち受けを開く。開けなければ投げる。 */
    async startListenerFromFlag(): Promise<void> {
      await serial(async () => {
        await startListener(readValidConfig().values);
        if (listener.state === "failed") throw new Error(listener.error);
      });
    },
    /**
     * 設定で「起動時に開始する」なら開始する。入口はこの失敗で止めない
     * (手元の画面は使える) ので、理由はログと設定画面の待ち受けの行に出す。
     */
    async startOnLaunch(): Promise<void> {
      try {
        await serial(async () => {
          try {
            await stopLeftoverTunnel();
          } catch (error) {
            console.error("[code-viewer] remote access:", error);
            tunnel = { state: "exited", error: formatErrorDetail(error) };
            changed();
          }
          const config = readConfig();
          if (config.state !== "ok" || !config.autoStart) return;
          await startUnqueued();
        });
      } catch (error) {
        console.error(
          "[code-viewer] remote access: starting on launch failed",
          error,
        );
        listener = { state: "failed", error: formatErrorDetail(error) };
        changed();
      }
    },
    async shutdown(): Promise<void> {
      if (installing) stopProcess(installing, "SIGTERM");
      await serial(stopUnqueued);
    },
  };
}

/** 外から開いた画面には操作させない (関所に加えて、入口でも断る)。 */
export function remoteLocalOnlyResponse(): Response {
  return json(
    {
      code: REMOTE_LOCAL_ONLY_CODE,
      error:
        "remote access can be changed only on the computer running code-viewer",
    },
    403,
  );
}
