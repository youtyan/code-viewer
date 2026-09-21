// ユーザー単位の登録簿 (アカウント・プロジェクト) を読む共通の手順。
//
// 無ければ空。読めない・JSON でない・形が違えば ok: false と理由の全文を
// 返す (呼び出し側はそれを画面に出し、上書きしない)。一覧の取り直しのたびに
// 読むので、ファイルが変わっていなければ前回の結果を使う読み方も用意する。

import { readFileSync, statSync } from "node:fs";
import { formatErrorDetail } from "../core/error-detail";
import { errno } from "./terminal/settings-file";

export type RegistryFileRead<T> =
  | { ok: true; registry: T }
  | { ok: false; error: string };

export function readRegistryFile<T>(
  path: string,
  parse: (
    raw: unknown,
  ) => { ok: true; registry: T } | { ok: false; issues: string[] },
  empty: () => T,
): RegistryFileRead<T> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (errno(error) === "ENOENT") return { ok: true, registry: empty() };
    return {
      ok: false,
      error: `cannot read ${path}: ${formatErrorDetail(error)}`,
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      error: `${path} is not valid JSON: ${formatErrorDetail(error)}`,
    };
  }
  const parsed = parse(raw);
  if (parsed.ok === false) {
    return { ok: false, error: `${path}:\n${parsed.issues.join("\n")}` };
  }
  return parsed;
}

/**
 * 大きさ・更新時刻・inode が前回と同じなら前回の結果を返す読み方。書き手は
 * 一時ファイルから rename するので、書き換わると inode が変わる。
 */
export function cachedRegistryReader<T>(
  read: (path: string) => RegistryFileRead<T>,
): (path: string) => RegistryFileRead<T> {
  const cache = new Map<string, { key: string; read: RegistryFileRead<T> }>();
  return (path) => {
    let key: string;
    try {
      const stat = statSync(path);
      key = `${stat.size}:${stat.mtimeMs}:${stat.ino}`;
    } catch (error) {
      if (errno(error) === "ENOENT") key = "missing";
      else return read(path);
    }
    const hit = cache.get(path);
    if (hit && hit.key === key) return hit.read;
    const result = read(path);
    cache.set(path, { key, read: result });
    return result;
  };
}
