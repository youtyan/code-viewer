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
