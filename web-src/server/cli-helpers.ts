// CLI 系サブコマンド (annotate / query / ...) で共通する argv パース / repo
// root 解決 / code-viewer server 探索ヘルパ。
//
// `annotate-cli.ts` と `query-cli.ts` で同じ形が token fingerprint 完全一致
// していたため集約。

import { realpathSync } from "node:fs";
import * as git from "./git";
import { readServerRegistry } from "./server-registry";

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

// `--cwd` 指定 (なければ process.cwd()) から repo root を返す。
// repo 外なら realpath にフォールバックし、それすら無効なら exit 1。
export function resolveRepoRoot(cwdOption: string | undefined): string {
  const base = cwdOption || process.cwd();
  try {
    return git.repoRoot(base) || realpathSync(base);
  } catch {
    console.error(`--cwd must point to an existing directory: ${base}`);
    process.exit(1);
  }
}

// 指定 URL に対して `<healthPath>` を 1.5s タイムアウトで HEAD-like fetch し、
// 2xx を返すかどうかで生存判定する。
// caller ごとに `healthPath` が違うので (例: /_annotations vs /_db/files)、
// 引数で受ける。
export async function serverReachable(
  serverUrl: string,
  healthPath: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${serverUrl}${healthPath}`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// `--server` override があればそれを使う。無ければ server-registry から
// 動いている code-viewer を探す。どちらにも届かなければ exit 1。
// CLI は自前で server を立てない (long-running process なので使い回す前提)。
export async function ensureServerUrl(
  root: string,
  override: string | undefined,
  healthPath: string,
): Promise<string> {
  if (override) {
    const url = override.replace(/\/+$/, "");
    if (await serverReachable(url, healthPath)) return url;
    console.error(`could not reach the code-viewer server at ${url}.`);
    process.exit(1);
  }
  const registered = readServerRegistry(root);
  if (registered) {
    const url = registered.url.replace(/\/+$/, "");
    if (await serverReachable(url, healthPath)) return url;
  }
  console.error(
    "no running code-viewer server for this repository.\n" +
      `Start one manually (from ${root}):\n` +
      "  code-viewer",
  );
  process.exit(1);
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
  } catch {
    console.error(`could not reach the code-viewer server at ${serverUrl}.`);
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
