// メインの面のタブの配置を、プロジェクトごとに覚える
// (`<状態ディレクトリ>/main-tabs.json`)。リポジトリの `.code-viewer/` には
// 書かない: タブはその人の作業の途中の状態で、リポジトリの中身に付くものではない。
//
// 中身は `{ version: 1, projects: { <根のパス>: { layout, savedAt } },
// common?: { tabs, savedAt } }`。layout は画面の serializeLayout
// (core/main-tabs.ts) の値、common はプロジェクトに属さないタブ
// (serializeCommonTabs) の値をそのまま置き、読み戻しの検査 (parseLayout・
// parseCommonTabs) は画面が行う。common が無いのはこの項を知らない版の保存。ここが見るのは JSON であることと
// 大きさだけ (壊れた配置の理由は画面が全部 console に出す)。
//
// 別々のプロジェクトの裏のプロセスが同じファイルを書くので、読んで・変えて・
// 書く間はロックで囲む (user-settings.ts と同じ)。壊れたファイルは上書きしない。
//
// 変える外部状態と戻し方: このファイルだけ。消せば、どのプロジェクトも空の
// タブから始まる。

import { constants, copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { formatErrorDetail } from "../core/error-detail";
import { withFileLock } from "./file-lock";
import { errno, writeFileAtomic } from "./terminal/settings-file";
import { codeViewerStateDir } from "./user-state-dir";

/** 1 プロジェクトの配置の上限。タブ数百枚でも収まる。 */
export const MAX_MAIN_TABS_LAYOUT_BYTES = 64_000;
/** 覚えておくプロジェクトの数。超えたら古く保存したものから忘れる。 */
export const MAX_MAIN_TABS_PROJECTS = 200;

type ProjectEntry = { layout: unknown; savedAt: number };
type CommonEntry = { tabs: unknown; savedAt: number };
type MainTabsFile = {
  version: 1;
  projects: Record<string, ProjectEntry>;
  common?: CommonEntry;
};

export function mainTabsPath(): string {
  return join(codeViewerStateDir(), "main-tabs.json");
}

export class MainTabsStoreError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    if (cause !== undefined) Object.assign(this, { cause });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** 読む。無ければ null。読めない・形が違えば投げる (上書きしない)。 */
function readMainTabsFile(path: string): MainTabsFile | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (errno(error) === "ENOENT") return null;
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
  const problems: string[] = [];
  if (!isRecord(raw)) problems.push("the file is not an object");
  else {
    if (raw.version !== 1)
      problems.push(`version is ${JSON.stringify(raw.version)}, expected 1`);
    if (!isRecord(raw.projects)) problems.push("projects is not an object");
    else
      for (const [root, entry] of Object.entries(raw.projects)) {
        if (!isRecord(entry) || !("layout" in entry))
          problems.push(`projects[${JSON.stringify(root)}] has no layout`);
        else if (typeof entry.savedAt !== "number")
          problems.push(
            `projects[${JSON.stringify(root)}].savedAt is not a number`,
          );
      }
    if ("common" in raw) {
      if (!isRecord(raw.common) || !("tabs" in raw.common))
        problems.push("common has no tabs");
      else if (typeof raw.common.savedAt !== "number")
        problems.push("common.savedAt is not a number");
    }
  }
  if (problems.length > 0)
    throw new MainTabsStoreError(
      `the saved main tabs (${path}) are not in the expected shape, so they are not used or overwritten:\n- ${problems.join("\n- ")}`,
    );
  return raw as MainTabsFile;
}

/**
 * 画面が読めなかった (parseLayout が壊れていると判定した) 保存値を、上書きする
 * 前に同じ場所へ写す: `main-tabs.json.broken-<時刻>`。ファイル全体を写すので
 * 他のプロジェクトの配置も残る。写した先のパスを返す。写せなければ投げる
 * (画面はそのとき上書きしない)。
 */
export async function backupMainTabs(
  path: string,
  now: number = Date.now(),
): Promise<string> {
  return withFileLock(`${path}.lock`, () => {
    const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
    for (let n = 1; ; n++) {
      const target = `${path}.broken-${stamp}${n === 1 ? "" : `-${n}`}`;
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
  });
}

/**
 * このプロジェクトの配置と、プロジェクトに属さないタブ。保存が無ければ
 * それぞれ null。
 */
export function loadMainTabs(
  path: string,
  root: string,
): { layout: unknown; common: unknown } {
  const file = readMainTabsFile(path);
  if (!file) return { layout: null, common: null };
  // 自分のプロパティだけを見る ("constructor" のような根の名前を継承元で拾わない)。
  const entry = Object.getOwnPropertyDescriptor(file.projects, root);
  return {
    layout: entry ? (entry.value as ProjectEntry).layout : null,
    common: file.common ? file.common.tabs : null,
  };
}

/** このプロジェクトの配置。保存が無ければ null。 */
export function loadProjectMainTabs(path: string, root: string): unknown {
  return loadMainTabs(path, root).layout;
}

function checkSize(what: string, value: unknown): void {
  const size = Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
  if (size > MAX_MAIN_TABS_LAYOUT_BYTES)
    throw new MainTabsStoreError(
      `${what} is ${size} bytes (at most ${MAX_MAIN_TABS_LAYOUT_BYTES})`,
    );
}

/**
 * このプロジェクトの配置を保存する。common を渡せば、プロジェクトに属さない
 * タブも同じロックの中で書く (渡さなければ前の値のまま)。
 */
export async function saveProjectMainTabs(
  path: string,
  root: string,
  layout: unknown,
  now: number = Date.now(),
  common?: unknown,
): Promise<void> {
  if (layout === undefined)
    throw new MainTabsStoreError("main tabs layout is missing");
  checkSize("main tabs layout", layout);
  if (common !== undefined) checkSize("common tabs", common);
  await withFileLock(`${path}.lock`, () => {
    const current = readMainTabsFile(path) ?? { version: 1, projects: {} };
    const projects: Record<string, ProjectEntry> = {
      ...current.projects,
      [root]: { layout, savedAt: now },
    };
    // いま保存したものは先頭に置く。時計が戻った後の savedAt は他より古く
    // 見え、並べるだけだと同じ書き込みの中で消える。
    const roots = [
      root,
      ...Object.keys(projects)
        .filter((other) => other !== root)
        .sort((a, b) => projects[b].savedAt - projects[a].savedAt),
    ];
    for (const stale of roots.slice(MAX_MAIN_TABS_PROJECTS))
      delete projects[stale];
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const commonEntry =
      common === undefined ? current.common : { tabs: common, savedAt: now };
    writeFileAtomic(
      path,
      `${JSON.stringify(
        {
          version: 1,
          projects,
          ...(commonEntry ? { common: commonEntry } : {}),
        },
        null,
        2,
      )}\n`,
      0o600,
    );
  });
}
