// 窓ごとの面の並びとタブを覚える (`<状態ディレクトリ>/main-tabs.json`)。
// リポジトリの `.code-viewer/` には書かない: タブはその人の作業の途中の状態で、
// リポジトリの中身に付くものではない。
//
// 中身は `{ version: 3, windows: { <窓の id>: { rev, savedAt, workspace } } }`。
// workspace は外側のページの面の木と面ごとのタブ (core/workspace.ts)。窓 (ブラウザの
// タブ・インストールした窓) ごとに 1 つ持ち、書くのはその窓の外側のページだけ
// (窓どうしで重ねない)。知らない窓の読み込みには、最後に書いた窓の写しを返す
// (新しい窓は最後の配置から始まる)。窓は MAX_WINDOWS まで覚え、古いものから捨てる。
//
// 前の版のファイル (1 つの配置を全部の窓で共有した版 2 と、プロジェクトごとの版 1)
// は、読むと配置をそのまま返し (legacy)、外側のページが面の木へ移す
// (core/workspace.ts の migrateLayout)。版 3 で書くときに、元のファイルを
// `main-tabs.json.v<版>-<時刻>` へ写してから書き直す。
//
// 別々のプロジェクトの裏のプロセスが同じファイルを書くので、読んで・変えて・
// 書く間はロックで囲む (user-settings.ts と同じ)。壊れたファイルと、このアプリより
// 新しい版のファイルは上書きしない。
//
// 変える外部状態と戻し方: このファイルだけ。消せば、空のタブから始まる。前の版へ
// 戻すなら、写しておいた `main-tabs.json.v2-<時刻>` を main-tabs.json に戻す。

import { constants, copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { errorWithCause, formatErrorDetail } from "../core/error-detail";
import { parseLayout } from "../core/main-tabs";
import {
  isPerProjectTabsFile,
  type MigratedTabs,
  migratePerProjectTabs,
} from "../core/main-tabs-migrate";
import { parseWorkspace } from "../core/workspace";
import { withFileLock } from "./file-lock";
import { errno, writeFileAtomic } from "./terminal/settings-file";
import { codeViewerStateDir } from "./user-state-dir";

/** 1 つの窓の面の並びとタブの上限。面ごとにタブ数百枚でも収まる。 */
export const MAX_WORKSPACE_BYTES = 256_000;
/** 覚える窓の数。超えたら最後に書いたのが古いものから捨てる。 */
export const MAX_WINDOWS = 8;
/** ファイルの形の版。2 は全部の窓で 1 つの配置、1 はプロジェクトごと (読むと移す)。 */
export const MAIN_TABS_FILE_VERSION = 3;

/** 窓の id (外側のページが sessionStorage に持つ)。 */
const WINDOW_ID = /^[A-Za-z0-9_-]{1,64}$/;

type WindowEntry = { rev: number; savedAt: number; workspace: unknown };

type MainTabsFile = {
  version: typeof MAIN_TABS_FILE_VERSION;
  windows: Record<string, WindowEntry>;
};

/** 前の版 (プロジェクトごと) のファイルを配置へ移したときの報告 (画面が console に出す)。 */
export type MainTabsMigration = Omit<MigratedTabs, "layout">;

export type LoadedWorkspace =
  | { kind: "none" }
  /** このアプリより新しい版が書いたファイル。使わず、上書きもしない。 */
  | { kind: "newer"; version: number }
  /** 前の版のファイルの配置 (外側のページが面の木へ移す)。 */
  | { kind: "legacy"; layout: unknown; migration?: MainTabsMigration }
  | {
      kind: "ok";
      workspace: unknown;
      /** この窓の保存が無く、最後に書いた窓 (この id) の写しを返した。 */
      copiedFrom?: string;
    };

export type SavedWorkspace =
  | { kind: "newer"; version: number }
  | { kind: "ok"; rev: number };

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
  | { kind: "v3"; file: MainTabsFile }
  | { kind: "v2"; layout: unknown }
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
  else if (raw.version === 2) {
    if (!("layout" in raw)) problems.push("version 2 without a layout");
    else return { kind: "v2", layout: raw.layout };
  } else if (raw.version !== MAIN_TABS_FILE_VERSION)
    problems.push(
      `version is ${JSON.stringify(raw.version)}, expected 1, 2 or ${MAIN_TABS_FILE_VERSION}`,
    );
  else if (!isRecord(raw.windows)) problems.push("windows is not an object");
  else
    for (const [id, entry] of Object.entries(raw.windows)) {
      if (!isRecord(entry)) problems.push(`windows.${id} is not an object`);
      else if (!Number.isInteger(entry.rev) || (entry.rev as number) < 1)
        problems.push(`windows.${id}.rev is ${JSON.stringify(entry.rev)}`);
      else if (typeof entry.savedAt !== "number")
        problems.push(`windows.${id}.savedAt is not a number`);
      else if (!("workspace" in entry))
        problems.push(`windows.${id} has no workspace`);
    }
  if (problems.length > 0)
    throw new MainTabsStoreError(
      `the saved main tabs (${path}) are not in the expected shape, so they are not used or overwritten:\n- ${problems.join("\n- ")}`,
    );
  return { kind: "v3", file: raw as MainTabsFile };
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

function checkWindowId(window: string): void {
  if (!WINDOW_ID.test(window))
    throw new MainTabsStoreError(
      `the window id ${JSON.stringify(window)} is not in the form ${WINDOW_ID}`,
      undefined,
      "invalid-input",
    );
}

/**
 * その窓の面の並びとタブ。この窓の保存が無ければ最後に書いた窓の写し。前の版の
 * ファイルなら配置をそのまま返す (legacy。書くときに版 3 へ移す)。
 */
export function loadWorkspace(path: string, window: string): LoadedWorkspace {
  checkWindowId(window);
  const read = readMainTabsFile(path);
  switch (read.kind) {
    case "none":
    case "newer":
      return read;
    case "v2":
      return { kind: "legacy", layout: read.layout };
    case "v1": {
      const { layout, ...migration } = migratePerProjectTabs(read.raw);
      return { kind: "legacy", layout, migration };
    }
    case "v3": {
      const own = read.file.windows[window];
      if (own) return { kind: "ok", workspace: own.workspace };
      const latest = Object.entries(read.file.windows).sort(
        ([, a], [, b]) => b.savedAt - a.savedAt,
      )[0];
      if (!latest) return { kind: "none" };
      return {
        kind: "ok",
        workspace: latest[1].workspace,
        copiedFrom: latest[0],
      };
    }
  }
}

/** 送られた面の並びとタブが読めること (壊れた値を書かない)。 */
function checkWorkspace(workspace: unknown): void {
  const size = Buffer.byteLength(JSON.stringify(workspace) ?? "", "utf8");
  if (size > MAX_WORKSPACE_BYTES)
    throw new MainTabsStoreError(
      `the workspace is ${size} bytes (at most ${MAX_WORKSPACE_BYTES})`,
      undefined,
      "invalid-input",
    );
  try {
    const parsed = parseWorkspace(workspace);
    for (const [id, entry] of Object.entries(parsed.panes))
      if (entry.layout !== null) {
        try {
          parseLayout(entry.layout);
        } catch (error) {
          throw errorWithCause(
            `pane ${id}: ${formatErrorDetail(error)}`,
            error,
          );
        }
      }
  } catch (error) {
    throw new MainTabsStoreError(
      `the workspace to save is broken: ${formatErrorDetail(error)}`,
      error,
      "invalid-input",
    );
  }
}

/**
 * その窓の面の並びとタブを書く。前の版のファイルなら元を写してから版 3 で書き
 * 直す。覚える窓が MAX_WINDOWS を超えたら、最後に書いたのが古い窓を捨てる。
 */
export async function saveWorkspace(
  path: string,
  window: string,
  workspace: unknown,
  now: number = Date.now(),
): Promise<SavedWorkspace> {
  checkWindowId(window);
  checkWorkspace(workspace);
  return withFileLock(`${path}.lock`, () => {
    const read = readMainTabsFile(path);
    if (read.kind === "newer") return read;
    if (read.kind === "v1" || read.kind === "v2")
      copyAside(path, read.kind, now);
    const { [window]: previous, ...others } =
      read.kind === "v3" ? read.file.windows : {};
    const rev = (previous?.rev ?? 0) + 1;
    // 捨てるのはほかの窓だけ (時計が戻った後でも、いま書いた窓は消さない)。
    const kept = Object.entries(others)
      .sort(([, a], [, b]) => b.savedAt - a.savedAt)
      .slice(0, MAX_WINDOWS - 1);
    writeMainTabsFile(path, {
      version: MAIN_TABS_FILE_VERSION,
      windows: {
        ...Object.fromEntries(kept),
        [window]: { rev, savedAt: now, workspace },
      },
    });
    return { kind: "ok", rev };
  });
}
