// ユーザー単位の設定 (`<状態ディレクトリ>/settings.json`)。テーマ・言語・
// 文字の大きさ・キー割り当て・通知など、人に付く項目だけを置く
// (core/user-settings.ts の USER_SETTING_KEYS)。
//
// 別々のリポジトリで動く複数のサーバが読み書きするので、読んで・変えて・
// 書く間はプロセスをまたいだロックで囲み、一時ファイルから rename する。
//
// 初めて読むとき (ファイルが無いとき) は、いま見ているリポジトリの設定から
// その項目を引き継いで作る。見た目が突然変わらないように。リポジトリの
// 設定ファイルは読むだけで、書き換えも削除もしない。
//
// 壊れたファイル (JSON でない) は上書きしない。読めない理由を返し、その間は
// リポジトリの設定で表示する (呼び出し側がその理由を画面に出す)。
//
// 変える外部状態と戻し方: このファイルだけ。消せば、次に開いたリポジトリの
// 設定から引き継ぎ直す。

import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { formatErrorDetail } from "../core/error-detail";
import type { AppSettingsState } from "../core/types";
import {
  pickUserSettings,
  type UserSettingsState,
} from "../core/user-settings";
import { withFileLock } from "./file-lock";
import { sanitizeAppSettingsState } from "./state-store";
import { errno, writeFileAtomic } from "./terminal/settings-file";
import { codeViewerStateDir } from "./user-state-dir";

export function userSettingsPath(): string {
  return join(codeViewerStateDir(), "settings.json");
}

export class UserSettingsError extends Error {
  constructor(message: string, cause: unknown) {
    super(message);
    Object.assign(this, { cause });
  }
}

/** 読む。無ければ null。読めない・JSON でなければ投げる (上書きしない)。 */
export function readUserSettings(path: string): UserSettingsState | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (errno(error) === "ENOENT") return null;
    throw new UserSettingsError(
      `cannot read the settings shared by all projects (${path}): ${formatErrorDetail(error)}`,
      error,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new UserSettingsError(
      `the settings shared by all projects (${path}) are not valid JSON, so they are not used or overwritten: ${formatErrorDetail(error)}`,
      error,
    );
  }
  return pickUserSettings(sanitizeAppSettingsState(raw));
}

function writeUserSettings(path: string, state: UserSettingsState): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileAtomic(path, `${JSON.stringify(state, null, 2)}\n`, 0o600);
}

/**
 * ユーザー単位の設定。まだ無ければ repo の値を引き継いで作る。
 */
export async function ensureUserSettings(
  path: string,
  repo: AppSettingsState,
): Promise<UserSettingsState> {
  const existing = readUserSettings(path);
  if (existing) return existing;
  return withFileLock(`${path}.lock`, () => {
    // ロックを待つ間に別のサーバが作っていれば、そちらを使う。
    const created = readUserSettings(path);
    if (created) return created;
    const initial = pickUserSettings(repo);
    writeUserSettings(path, initial);
    return initial;
  });
}

/** 変える。null の項目は消す (既定値に戻る)。まだ無ければ repo から作ってから。 */
export async function patchUserSettings(
  path: string,
  patch: Record<string, unknown>,
  repo: AppSettingsState,
): Promise<UserSettingsState> {
  return withFileLock(`${path}.lock`, () => {
    const current = readUserSettings(path) ?? pickUserSettings(repo);
    const raw: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete raw[key];
      else raw[key] = value;
    }
    const next = pickUserSettings(
      sanitizeAppSettingsState({ ...raw, version: 1 }),
    );
    writeUserSettings(path, next);
    return next;
  });
}
