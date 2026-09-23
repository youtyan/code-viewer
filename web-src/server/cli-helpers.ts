// CLI 系サブコマンド (annotate / query / ...) で共通する argv パース / repo
// root 解決 / code-viewer server 探索ヘルパ。
//
// `annotate-cli.ts` と `query-cli.ts` で同じ形が token fingerprint 完全一致
// していたため集約。

import { readFileSync, realpathSync } from "node:fs";
import { errorWithCause, formatErrorDetail } from "../core/error-detail";
import {
  type ExternalCommandName,
  type ExternalCommandOverride,
  parseExternalCommandOverride,
} from "./command-resolver";
import {
  type EntryIdentityVerification,
  type EntryRecord,
  liveEntryRecord,
  liveEntryUrl,
  verifyEntryIdentity,
} from "./entry/entry-file";
import * as git from "./git";
import {
  readServerRegistry,
  rootFileKey,
  type ServerRegistryEntry,
} from "./server-registry";

// `--flag <value>` を 1 つ消費する。値が無ければ {error}。
export function takeValue(
  argv: string[],
  index: number,
  flag: string,
): { value: string; next: number } | { error: string } {
  const value = argv[index + 1];
  if (value === undefined) return { error: `${flag} requires a value` };
  return { value, next: index + 1 };
}

export type GlobalCliOption =
  | { kind: "unhandled" }
  | { kind: "error"; error: string }
  | { kind: "cwd" | "server"; value: string; next: number }
  | {
      kind: "command-override";
      override: ExternalCommandOverride;
      next: number;
    };

export type GlobalCliOptionOptions = {
  allowServer?: boolean;
  allowedCommands?: readonly ExternalCommandName[];
};

// CLI subcommand 共通の global option を 1 つ消費する。未対応の option は
// caller に返し、各サブコマンド固有の unknown-option 契約を保つ。
export function takeGlobalCliOption(
  argv: string[],
  index: number,
  options: GlobalCliOptionOptions,
): GlobalCliOption {
  const flag = argv[index];
  if (flag === "--cwd" || (flag === "--server" && options.allowServer)) {
    const taken = takeValue(argv, index, flag);
    if ("error" in taken) return { kind: "error", error: taken.error };
    return {
      kind: flag === "--cwd" ? "cwd" : "server",
      value: taken.value,
      next: taken.next,
    };
  }
  if (flag === "--bin" && options.allowedCommands) {
    const taken = takeValue(argv, index, flag);
    if ("error" in taken) return { kind: "error", error: taken.error };
    const parsed = parseExternalCommandOverride(
      taken.value,
      "--bin",
      options.allowedCommands,
    );
    if (parsed.ok === false) return { kind: "error", error: parsed.error };
    return {
      kind: "command-override",
      override: parsed.override,
      next: taken.next,
    };
  }
  return { kind: "unhandled" };
}

// `--body-file` などで渡されたファイルを読む。読めなければ 1 行目に旗とパス、
// 次の行に理由 (code・syscall・cause) を出して exit 1。
export function readFlagFile(flag: string, path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    console.error(
      `could not read ${flag}: ${path}\n${formatErrorDetail(error)}`,
    );
    process.exit(1);
  }
}

// POSIX shell の single-quote 規則: '...' 内は literal、内部の ' だけ
// '\'' で閉じて再開する。bash/zsh/sh で貼り付け安全な CLI 引数を作る。
export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

// CLI 引数として受け取った文字列に NUL や改行が混ざっていないかの判定。
// shell の引数注入対策ではなく、git ref / path のような single-line で扱う
// CLI 値が複数行に膨らんで以降の引数解析が崩れるのを防ぐためのガード。
// 元は file-cli の private helper として置かれていたが、status-cli からも
// 同じ規則で参照したいので集約。
export function isUnsafeText(value: string): boolean {
  if (value.includes("\0")) return true;
  if (/[\r\n]/.test(value)) return true;
  return false;
}

// `--ref <value>` の典型的なバリデーション。empty / NUL / 改行 / leading
// dash を rejectする。file-cli と status-cli の両方で `--ref` という名前で
// ref を受けるので、flag 名は引数で受けて両者でメッセージを共有する。
function validateSafeCliValue(value: string, flag: string): string | undefined {
  if (!value) return `${flag} requires a non-empty value`;
  if (isUnsafeText(value))
    return `${flag} must be single-line and must not contain NUL`;
  if (value.startsWith("-")) return `${flag} must not start with '-'`;
  return undefined;
}

export function validateRefValue(
  value: string,
  flag: string,
): string | undefined {
  const error = validateSafeCliValue(value, flag);
  if (error) return error;
  return undefined;
}

export function validateRepoRelativePathValue(
  value: string,
  flag: string,
): string | undefined {
  const error = validateSafeCliValue(value, flag);
  if (error) return error;
  if (value.startsWith("/") || value.startsWith("\\"))
    return `${flag} must be repo-relative`;
  const parts = value.split(/[\\/]+/);
  if (parts.includes("..")) return `${flag} must not contain '..' segments`;
  if (git.isGitInternalPath(value)) {
    return `${flag} must not target git metadata`;
  }
  if (git.isToolInternalPath(value)) {
    return `${flag} must not target code-viewer metadata`;
  }
  return undefined;
}

// `--cwd` 指定 (なければ process.cwd()) から repo root を解決する non-throwing 版。
// CLI runner は exit するが、MCP tool のような長寿命プロセスは exit させたくない
// ので、エラーを Result として返す入口だけ別途用意する。エラーメッセージは
// `resolveRepoRoot` の文言と一字一句揃え、CLI 出力の安定を保つ。
export function resolveRepoRootSafe(
  cwdOption: string | undefined,
): { ok: true; root: string } | { ok: false; error: string } {
  const base = cwdOption || process.cwd();
  let baseReal: string;
  try {
    baseReal = realpathSync(base);
  } catch (error) {
    return {
      ok: false,
      error: `--cwd must point to an existing directory: ${base}\n${formatErrorDetail(error)}`,
    };
  }
  const root = git.repoRootResult(baseReal);
  if (root.kind === "root") return { ok: true, root: root.root };
  if (root.kind === "error") return { ok: false, error: root.error };
  return { ok: true, root: baseReal };
}

// `--cwd` 指定 (なければ process.cwd()) から repo root を返す。
// repo 外なら realpath にフォールバックし、それすら無効なら exit 1。
export function resolveRepoRoot(cwdOption: string | undefined): string {
  const result = resolveRepoRootSafe(cwdOption);
  if (result.ok === true) return result.root;
  console.error(result.error);
  process.exit(1);
}

export type ServerProbe =
  | { status: "ok" }
  /** 繋がらなかった (接続拒否・時間切れ)。理由は error.cause。 */
  | { status: "unreachable"; error: Error }
  /** 繋がったが 2xx でなかった。状態と本文は error.message。 */
  | { status: "failed"; error: Error };

// 指定 URL に対して `<healthPath>` を 1.5s タイムアウトで GET し、2xx を
// 返すかどうかで生存判定する。「繋がらない」と「繋がったが失敗」を分け、
// どちらも理由を残す。caller ごとに `healthPath` が違うので
// (例: /_annotations vs /_db/files)、引数で受ける。
export async function probeServer(
  serverUrl: string,
  healthPath: string,
): Promise<ServerProbe> {
  const url = `${serverUrl}${healthPath}`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(1500) });
  } catch (error) {
    return {
      status: "unreachable",
      error: errorWithCause(`GET ${url} failed`, error),
    };
  }
  if (res.ok) {
    await res.body?.cancel();
    return { status: "ok" };
  }
  let body: string;
  try {
    body = await res.text();
  } catch (error) {
    return {
      status: "failed",
      error: errorWithCause(
        `GET ${url} returned ${res.status} and its body could not be read`,
        error,
      ),
    };
  }
  return {
    status: "failed",
    error: new Error(`GET ${url} returned ${res.status}: ${body}`),
  };
}

/**
 * 入口に裏のプロセスを起こしてもらうのを待つ上限 (1 回の要求ごと)。入口は裏の
 * 起動を 20 秒まで待つ (worktree/open.ts の START_TIMEOUT_MS)。それに余裕を足す。
 */
export const ENTRY_WAKE_TIMEOUT_MS = 30_000;

/** 裏を起こすのに入口へ送る要求。読むだけで軽い `/_settings` を使う。 */
const ENTRY_WAKE_PATH = "/_settings";

export type ServerUrlDeps = {
  readRegistry(root: string): ServerRegistryEntry | null;
  probe(url: string, healthPath: string): Promise<ServerProbe>;
  /** 生きている入口の記録。記録が読めなければ投げる。 */
  liveEntry(): EntryRecord | null;
  verifyEntry(entry: EntryRecord): Promise<EntryIdentityVerification>;
  fetch(url: string, init: RequestInit): Promise<Response>;
  /** 裏を起こし始めたことを知らせる (stderr)。 */
  notice(message: string): void;
  wakeTimeoutMs: number;
};

const defaultServerUrlDeps: ServerUrlDeps = {
  readRegistry: readServerRegistry,
  probe: probeServer,
  liveEntry: () => liveEntryRecord(),
  verifyEntry: verifyEntryIdentity,
  fetch: (url, init) => fetch(url, init),
  notice: (message) => console.error(message),
  wakeTimeoutMs: ENTRY_WAKE_TIMEOUT_MS,
};

export type ServerUrlResult =
  | { status: "ok"; url: string }
  | { status: "error"; message: string };

/**
 * CLI が要求を送るサーバを決める。
 *
 * 1. `--server` があればそれだけ (届かなければ失敗)
 * 2. 登録簿にこのリポジトリのサーバがあり、答えればそれ (`--standalone` もここ)
 * 3. 登録簿に無い・入口の裏が答えない: 動いている入口に頼んで裏を起こして
 *    もらう。画面が `/p/<鍵>/` を開くときと同じ経路 (`/_entry/open` で鍵を
 *    もらい、`/p/<鍵>/…` の取り次ぎで裏を起こす)。起きたら登録簿の裏の URL
 *    で続ける
 * 4. 入口も居ない: 入口を起こす案内を出して失敗
 *
 * 登録簿にあるのが `--standalone` のサーバ (裏ではない) で答えないときは、
 * 入口には頼まない (今までどおり失敗)。
 */
export async function resolveServerUrl(
  root: string,
  override: string | undefined,
  healthPath: string,
  deps: ServerUrlDeps = defaultServerUrlDeps,
): Promise<ServerUrlResult> {
  if (override) {
    const url = override.replace(/\/+$/, "");
    const probe = await deps.probe(url, healthPath);
    if (probe.status === "ok") return { status: "ok", url };
    return {
      status: "error",
      message: `could not reach the code-viewer server at ${url}.\n${formatErrorDetail(probe.error)}`,
    };
  }
  const registered = deps.readRegistry(root);
  let registeredFailure = "";
  if (registered) {
    const url = registered.url.replace(/\/+$/, "");
    const probe = await deps.probe(url, healthPath);
    if (probe.status === "ok") return { status: "ok", url };
    registeredFailure = `\nThe registered server at ${url} (pid ${registered.pid}) ${probe.status === "unreachable" ? "could not be reached" : "answered with an error"}:\n${formatErrorDetail(probe.error)}`;
    if (!registered.backend) {
      return {
        status: "error",
        message:
          "no running code-viewer server for this repository.\n" +
          `Start one (from ${root}), then run this command again:\n` +
          "  code-viewer" +
          registeredFailure,
      };
    }
  }
  const entry = deps.liveEntry();
  if (!entry) {
    return {
      status: "error",
      message:
        "no running code-viewer server for this repository, and no code-viewer entry server is running.\n" +
        `Start code-viewer (from ${root}) in another terminal and leave it running, then run this command again:\n` +
        "  code-viewer" +
        registeredFailure,
    };
  }
  const woken = await wakeThroughEntry(entry, root, healthPath, deps);
  if (woken.status === "ok") return woken;
  return { ...woken, message: woken.message + registeredFailure };
}

/** 入口に頼んでこのリポジトリの裏を起こし、その裏の URL を返す。 */
async function wakeThroughEntry(
  entry: EntryRecord,
  root: string,
  healthPath: string,
  deps: ServerUrlDeps,
): Promise<ServerUrlResult> {
  const entryUrl = entry.url.replace(/\/+$/, "");
  const fail = (message: string): ServerUrlResult => ({
    status: "error",
    message: `no running code-viewer server for this repository, and the code-viewer entry server at ${entryUrl} (pid ${entry.pid}) could not start one for ${root}:\n${message}`,
  });
  const identity = await deps.verifyEntry(entry);
  if (identity.status === "dead") return fail("the entry server has exited");
  if (identity.status === "unreachable")
    return fail(
      `the entry server did not answer:\n${formatErrorDetail(identity.error)}`,
    );
  if (identity.status === "invalid") return fail(identity.detail);

  const seconds = deps.wakeTimeoutMs / 1000;
  const request = async (
    label: string,
    url: string,
    init: RequestInit,
  ): Promise<
    | { ok: true; text: string }
    | { ok: false; message: string; status?: number; code?: unknown }
  > => {
    let res: Response;
    let text: string;
    try {
      res = await deps.fetch(url, {
        ...init,
        signal: AbortSignal.timeout(deps.wakeTimeoutMs),
      });
      text = await res.text();
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError");
      return {
        ok: false,
        message: `${label} ${timedOut ? `did not answer within ${seconds} seconds` : "failed"}:\n${formatErrorDetail(errorWithCause(`${init.method ?? "GET"} ${url} failed`, error))}`,
      };
    }
    if (!res.ok) {
      let code: unknown;
      try {
        code = (JSON.parse(text) as { code?: unknown } | null)?.code;
      } catch {
        // 本文が JSON でない失敗 (text/plain)。本文はそのまま message に入る。
      }
      return {
        ok: false,
        message: `${label} answered HTTP ${res.status}:\n${text}`,
        status: res.status,
        code,
      };
    }
    return { ok: true, text };
  };

  // 鍵 (と、入口が使う根のパス) をもらう。git の中なら登録もされる
  // (そのリポジトリで `code-viewer` を打ったときと同じ)。
  const headers = {
    "Content-Type": "application/json",
    Origin: new URL(entryUrl).origin,
    "X-Code-Viewer-Action": "1",
  };
  const opened = await request(
    "asking the entry server to open the project",
    `${entryUrl}/_entry/open`,
    { method: "POST", headers, body: JSON.stringify({ path: root }) },
  );
  if (opened.ok === false) return fail(opened.message);
  let key: unknown;
  let projectRoot: unknown;
  try {
    ({ key, root: projectRoot } = JSON.parse(opened.text) as {
      key?: unknown;
      root?: unknown;
    });
  } catch (error) {
    return fail(
      `the entry server answered /_entry/open with a body that is not JSON:\n${opened.text}\n${formatErrorDetail(error)}`,
    );
  }
  if (typeof key !== "string" || typeof projectRoot !== "string") {
    return fail(
      `the entry server answered /_entry/open without a project key and root:\n${opened.text}`,
    );
  }

  // 画面と同じ取り次ぎで裏を起こす (入口は起きるまで待ってから取り次ぐ)。
  deps.notice(
    `starting the code-viewer project process for ${projectRoot} through the entry server at ${entryUrl}…`,
  );
  const wake = () =>
    request(
      "the entry server, while starting the project process,",
      `${entryUrl}/p/${key}${ENTRY_WAKE_PATH}`,
      { method: "GET" },
    );
  let woke = await wake();
  // 裏が落ちていた (502 backend-stopped) なら、画面の「再起動」と同じ
  // `/_entry/restart` を 1 回だけ頼んで、もう一度起こす。
  if (
    woke.ok === false &&
    woke.status === 502 &&
    woke.code === "backend-stopped"
  ) {
    const restarted = await request(
      "asking the entry server to restart the stopped project process",
      `${entryUrl}/_entry/restart`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ key }),
      },
    );
    if (restarted.ok === false)
      return fail(`${woke.message}\n${restarted.message}`);
    woke = await wake();
  }
  if (woke.ok === false) return fail(woke.message);

  const registered = deps.readRegistry(projectRoot);
  if (!registered) {
    return fail(
      `the entry server answered ${ENTRY_WAKE_PATH} for project ${key}, but no project process for ${projectRoot} is in the server registry`,
    );
  }
  const url = registered.url.replace(/\/+$/, "");
  const probe = await deps.probe(url, healthPath);
  if (probe.status === "ok") return { status: "ok", url };
  return fail(
    `the project process at ${url} (pid ${registered.pid}) was started, but ${probe.status === "unreachable" ? "could not be reached" : "answered with an error"}:\n${formatErrorDetail(probe.error)}`,
  );
}

// 決まらなければ理由を出して exit 1。CLI は自前で server を立てない
// (long-running process なので使い回す前提。入口が居れば入口に起こしてもらう)。
export async function ensureServerUrl(
  root: string,
  override: string | undefined,
  healthPath: string,
): Promise<string> {
  const result = await resolveServerUrl(root, override, healthPath);
  if (result.status === "ok") return result.url;
  console.error(result.message);
  process.exit(1);
}

/**
 * CLI が出す画面の URL の根 (末尾の `/` なし)。
 *
 * 入口のサーバの下では、登録簿にあるのはプロジェクトの裏のプロセス
 * (`--backend`) で、CLI はそこへじかに要求する。その URL をブラウザで開いても
 * 入口の画面にならないので、繋いだ先が登録簿の裏なら入口の URL に
 * `/p/<鍵>` を付けて返す。`--standalone` のサーバと、登録簿と違う `--server`
 * はそのまま返す。
 * 入口の記録が読めない・入口が居ないときは、理由を stderr に出して繋いだ先を
 * 返す (画面の URL は案内で、要求そのものは済んでいるため)。
 */
export function screenBaseUrl(root: string, serverUrl: string): string {
  const base = serverUrl.replace(/\/+$/, "");
  let entryUrl: string | null;
  let key: string;
  try {
    const registered = readServerRegistry(root);
    if (!registered?.backend || registered.url.replace(/\/+$/, "") !== base)
      return base;
    key = rootFileKey(registered.root);
    entryUrl = liveEntryUrl();
  } catch (error) {
    console.error(
      `could not tell whether ${base} is behind the code-viewer entry server, so screen URLs point at it directly:\n${formatErrorDetail(error)}`,
    );
    return base;
  }
  if (!entryUrl) {
    console.error(
      `${base} is a project process of the code-viewer entry server, but no entry server is running, so screen URLs point at the project process directly`,
    );
    return base;
  }
  return `${entryUrl}/p/${key}`;
}

// サーバが 4xx / 5xx を返したときは text/plain で body を返す経路 (handle.ts
// の textError や preview.ts:handleAnnotations の text() 系) と、JSON で
// {error:"<reason>"} を返す経路 (handle.ts:handleQuery の 400) が混在する。
// `res.json()` を盲目的に呼ぶと SyntaxError で本当のエラーが消えるし、
// JSON を生で stderr に流すと AI/human が読めない。Content-Type と body shape
// で振り分けて、人間が読める detail に正規化する。query / annotate 等で同じ
// 必要があるので cli-helpers に置く。
export async function requestJson(
  serverUrl: string,
  path: string,
  method: "GET" | "POST",
  body: unknown,
  action: string,
): Promise<unknown> {
  const url = `${serverUrl}${path}`;
  const origin = new URL(serverUrl).origin;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers:
        method === "POST"
          ? {
              "Content-Type": "application/json",
              Origin: origin,
              "X-Code-Viewer-Action": "1",
            }
          : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    console.error(
      `could not reach the code-viewer server at ${serverUrl}.\n${formatErrorDetail(errorWithCause(`${action}: ${method} ${url} failed`, error))}`,
    );
    process.exit(1);
  }
  const ctype = (res.headers.get("content-type") || "").toLowerCase();
  const isJson = ctype.includes("json");
  if (!res.ok) {
    const text = await res.text();
    const detail = extractErrorDetail(text, isJson, res.status);
    console.error(`${action} failed (${res.status}): ${detail}`);
    process.exit(1);
  }
  if (!isJson) {
    // 2xx で JSON でない応答は稀な escape hatch。caller 側で string として扱う。
    return await res.text();
  }
  return await res.json();
}

export function extractErrorDetail(
  rawBody: string,
  isJson: boolean,
  status: number,
): string {
  const trimmed = rawBody.trim();
  if (!trimmed) return `HTTP ${status}`;
  if (!isJson) return trimmed;
  try {
    const parsed = JSON.parse(trimmed);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as { error?: unknown }).error === "string"
    ) {
      return (parsed as { error: string }).error;
    }
  } catch {
    // Fall back to the raw body for malformed JSON.
  }
  return trimmed;
}
