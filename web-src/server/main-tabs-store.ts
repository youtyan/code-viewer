// メインの面のタブの配置を覚える (`<状態ディレクトリ>/main-tabs.json`)。
// リポジトリの `.code-viewer/` には書かない: タブはその人の作業の途中の状態で、
// リポジトリの中身に付くものではない。
//
// タブは全プロジェクト共通の 1 つの配置 (core/main-tabs.ts)。中身は
// `{ version: 2, rev, savedAt, layout }`。layout は画面の serializeLayout の値。
// rev は書くたびに 1 つ進む版の番号で、窓どうしの突き合わせに使う:
// 画面は前に読んだ rev と値 (base) を添えて書き、rev が進んでいれば (別の窓が先に
// 書いた) ここで core/main-tabs-merge.ts の mergeSerializedLayouts で重ねてから書く。
// 全体の上書きで、もう一方の窓のタブの変更を消さないため。
//
// 前の版の形 (`{ version: 1, projects: { <根>: { layout } }, common? }`) を読んだら、
// ロックの中で 1 つの配置へ移して書き直す (core/main-tabs-migrate.ts)。元のファイルは
// 先に `main-tabs.json.v1-<時刻>` へ写す (移せなかったものも元の値のまま残る)。
//
// 別々のプロジェクトの裏のプロセスが同じファイルを書くので、読んで・変えて・
// 書く間はロックで囲む (user-settings.ts と同じ)。壊れたファイルと、このアプリより
// 新しい版のファイルは上書きしない。
//
// 変える外部状態と戻し方: このファイルだけ。消せば、空のタブから始まる。前の版へ
// 戻すなら、写しておいた `main-tabs.json.v1-<時刻>` を main-tabs.json に戻す。

import {
  constants,
  copyFileSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { formatErrorDetail } from "../core/error-detail";
import { parseLayout } from "../core/main-tabs";
import { mergeSerializedLayouts } from "../core/main-tabs-merge";
import {
  isPerProjectTabsFile,
  type MigratedTabs,
  migratePerProjectTabs,
} from "../core/main-tabs-migrate";
import { withFileLock } from "./file-lock";
import { errno, writeFileAtomic } from "./terminal/settings-file";
import { codeViewerStateDir } from "./user-state-dir";

/** 配置の上限。タブ数百枚でも収まる。 */
export const MAX_MAIN_TABS_LAYOUT_BYTES = 64_000;
/** ファイルの形の版。1 はプロジェクトごとの保存 (読むと移す)。 */
export const MAIN_TABS_FILE_VERSION = 2;

type MainTabsFile = {
  version: typeof MAIN_TABS_FILE_VERSION;
  rev: number;
  savedAt: number;
  layout: unknown;
};

/** 前の版のファイルを移したときの報告 (画面が console に出す)。 */
export type MainTabsMigration = Omit<MigratedTabs, "layout"> & {
  /** 元のファイルを写した先。 */
  backup: string;
};

export type LoadedMainTabs =
  | { kind: "none" }
  /** このアプリより新しい版が書いたファイル。使わず、上書きもしない。 */
  | { kind: "newer"; version: number }
  | {
      kind: "ok";
      rev: number;
      layout: unknown;
      migration?: MainTabsMigration;
    };

export type SavedMainTabs =
  | { kind: "newer"; version: number }
  | {
      kind: "ok";
      rev: number;
      /** 書いた値 (merged なら、別の窓の保存と重ねた後の値)。 */
      layout: unknown;
      merged: boolean;
      migration?: MainTabsMigration;
    };

export function mainTabsPath(): string {
  return join(codeViewerStateDir(), "main-tabs.json");
}

export class MainTabsStoreError extends Error {
  /** invalid-input: 画面が送った値の誤り (400)。無ければファイル・ディスクの失敗 (500)。 */
  readonly code: "invalid-input" | null;
  constructor(
    message: string,
    cause?: unknown,
    code: "invalid-input" | null = null,
  ) {
    super(message);
    this.code = code;
    if (cause !== undefined) Object.assign(this, { cause });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

type ReadFile =
  | { kind: "none" }
  | { kind: "v2"; file: MainTabsFile }
  | { kind: "v1"; raw: unknown }
  | { kind: "newer"; version: number };

/** 読む。読めない・形が違えば投げる (上書きしない)。 */
function readMainTabsFile(path: string): ReadFile {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (errno(error) === "ENOENT") return { kind: "none" };
    throw new MainTabsStoreError(
      `cannot read the saved main tabs (${path}): ${formatErrorDetail(error)}`,
      error,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new MainTabsStoreError(
      `the saved main tabs (${path}) are not valid JSON, so they are not used or overwritten: ${formatErrorDetail(error)}`,
      error,
    );
  }
  if (
    isRecord(raw) &&
    typeof raw.version === "number" &&
    raw.version > MAIN_TABS_FILE_VERSION
  )
    return { kind: "newer", version: raw.version };
  if (isPerProjectTabsFile(raw)) return { kind: "v1", raw };
  const problems: string[] = [];
  if (!isRecord(raw)) problems.push("the file is not an object");
  else {
    if (raw.version !== MAIN_TABS_FILE_VERSION)
      problems.push(
        `version is ${JSON.stringify(raw.version)}, expected 1 or ${MAIN_TABS_FILE_VERSION}`,
      );
    if (!Number.isInteger(raw.rev) || (raw.rev as number) < 0)
      problems.push(`rev is ${JSON.stringify(raw.rev)}`);
    if (typeof raw.savedAt !== "number")
      problems.push("savedAt is not a number");
    if (!("layout" in raw)) problems.push("there is no layout");
  }
  if (problems.length > 0)
    throw new MainTabsStoreError(
      `the saved main tabs (${path}) are not in the expected shape, so they are not used or overwritten:\n- ${problems.join("\n- ")}`,
    );
  return { kind: "v2", file: raw as MainTabsFile };
}

function writeMainTabsFile(path: string, file: MainTabsFile): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileAtomic(path, `${JSON.stringify(file, null, 2)}\n`, 0o600);
}

function stamp(now: number): string {
  return new Date(now).toISOString().replace(/[:.]/g, "-");
}

/** 同じ場所へ `<名前>.<印>-<時刻>` で写す (上書きしない)。写した先を返す。 */
function copyAside(path: string, mark: string, now: number): string {
  for (let n = 1; ; n++) {
    const target = `${path}.${mark}-${stamp(now)}${n === 1 ? "" : `-${n}`}`;
    try {
      copyFileSync(path, target, constants.COPYFILE_EXCL);
      return target;
    } catch (error) {
      if (errno(error) === "EEXIST") continue;
      throw new MainTabsStoreError(
        `cannot back up the saved main tabs (${path}) to ${target}: ${formatErrorDetail(error)}`,
        error,
      );
    }
  }
}

/**
 * 前の版のファイルを移す (ロックの中で呼ぶ)。元を写してから書き直す。写せなければ
 * 投げる (書き直さない)。
 */
function migrateInLock(
  path: string,
  raw: unknown,
  now: number,
): { file: MainTabsFile; migration: MainTabsMigration } {
  const migrated = migratePerProjectTabs(raw);
  const backup = copyAside(path, "v1", now);
  const file: MainTabsFile = {
    version: MAIN_TABS_FILE_VERSION,
    rev: 1,
    savedAt: now,
    layout: migrated.layout,
  };
  writeMainTabsFile(path, file);
  const { layout: _layout, ...report } = migrated;
  return { file, migration: { ...report, backup } };
}

/**
 * 画面が読めなかった (parseLayout が壊れていると判定した) 保存値を、上書きする
 * 前に同じ場所へ写す: `main-tabs.json.broken-<時刻>`。写した先のパスを返す。写せ
 * なければ投げる (画面はそのとき上書きしない)。
 */
export async function backupMainTabs(
  path: string,
  now: number = Date.now(),
): Promise<string> {
  return withFileLock(`${path}.lock`, () => copyAside(path, "broken", now));
}

/** 全プロジェクト共通の配置と版の番号。前の版のファイルなら移してから返す。 */
export async function loadMainTabs(
  path: string,
  now: number = Date.now(),
): Promise<LoadedMainTabs> {
  const first = readMainTabsFile(path);
  if (first.kind === "none" || first.kind === "newer") return first;
  if (first.kind === "v2")
    return { kind: "ok", rev: first.file.rev, layout: first.file.layout };
  return withFileLock(`${path}.lock`, () => {
    // ロックを待つ間に別のプロセスが移したかもしれない。読み直す。
    const again = readMainTabsFile(path);
    if (again.kind === "none" || again.kind === "newer") return again;
    if (again.kind === "v2")
      return { kind: "ok", rev: again.file.rev, layout: again.file.layout };
    const { file, migration } = migrateInLock(path, again.raw, now);
    return { kind: "ok", rev: file.rev, layout: file.layout, migration };
  });
}

/** 今の版の番号 (ファイルが無い・前の版なら null)。変わったかを見るだけ (SSE)。 */
export function mainTabsRevision(path: string): number | null {
  const read = readMainTabsFile(path);
  return read.kind === "v2" ? read.file.rev : null;
}

/** ファイルの更新時刻 (無ければ 0)。 */
export function mainTabsModifiedAt(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch (error) {
    if (errno(error) === "ENOENT") return 0;
    throw error;
  }
}

function checkSize(what: string, value: unknown): void {
  const size = Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
  if (size > MAX_MAIN_TABS_LAYOUT_BYTES)
    throw new MainTabsStoreError(
      `${what} is ${size} bytes (at most ${MAX_MAIN_TABS_LAYOUT_BYTES})`,
      undefined,
      "invalid-input",
    );
}

export type MainTabsWrite = {
  /** この窓が前に読んだ・書いた版の番号 (まだ無ければ null)。 */
  baseRev: number | null;
  /** その版の配置 (まだ無ければ null)。 */
  base: unknown;
  /** この窓の配置。 */
  layout: unknown;
};

/**
 * 配置を書く。ファイルの版が baseRev のままならそのまま書き、進んでいれば
 * (別の窓が先に書いた) base からのこの窓の変更を今の保存に重ねて書く。
 */
export async function saveMainTabs(
  path: string,
  write: MainTabsWrite,
  now: number = Date.now(),
): Promise<SavedMainTabs> {
  if (write.layout === undefined)
    throw new MainTabsStoreError(
      "main tabs layout is missing",
      undefined,
      "invalid-input",
    );
  checkSize("main tabs layout", write.layout);
  if (write.base !== null) checkSize("main tabs base layout", write.base);
  // 画面の値が読めること (壊れた配置を書かない)。
  try {
    parseLayout(write.layout);
  } catch (error) {
    throw new MainTabsStoreError(
      `the main tabs layout to save is broken: ${formatErrorDetail(error)}`,
      error,
      "invalid-input",
    );
  }
  return withFileLock(`${path}.lock`, () => {
    const read = readMainTabsFile(path);
    if (read.kind === "newer") return read;
    let current: MainTabsFile | null = null;
    let migration: MainTabsMigration | undefined;
    if (read.kind === "v1") {
      const migrated = migrateInLock(path, read.raw, now);
      current = migrated.file;
      migration = migrated.migration;
    } else if (read.kind === "v2") current = read.file;
    const same = current === null || current.rev === write.baseRev;
    let layout: unknown = write.layout;
    if (!same && current) {
      try {
        layout = mergeSerializedLayouts(
          write.base,
          write.layout,
          current.layout,
        );
      } catch (error) {
        throw new MainTabsStoreError(
          `the main tabs could not be merged with the layout saved by another window (rev ${current.rev}, this window read rev ${JSON.stringify(write.baseRev)}), so nothing was written: ${formatErrorDetail(error)}`,
          error,
        );
      }
    }
    const rev = (current?.rev ?? 0) + 1;
    writeMainTabsFile(path, {
      version: MAIN_TABS_FILE_VERSION,
      rev,
      savedAt: now,
      layout,
    });
    return {
      kind: "ok",
      rev,
      layout,
      merged: !same,
      ...(migration ? { migration } : {}),
    };
  });
}
