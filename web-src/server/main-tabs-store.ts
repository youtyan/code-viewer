// メインの面のタブの配置を、プロジェクトごとに覚える
// (`<状態ディレクトリ>/main-tabs.json`)。リポジトリの `.code-viewer/` には
// 書かない: タブはその人の作業の途中の状態で、リポジトリの中身に付くものではない。
//
// 中身は `{ version: 1, projects: { <根のパス>: { layout, savedAt } } }`。
// layout は画面の serializeLayout (core/main-tabs.ts) の値をそのまま置き、
// 読み戻しの検査 (parseLayout) は画面が行う。ここが見るのは JSON であることと
// 大きさだけ (壊れた配置の理由は画面が全部 console に出す)。
//
// 別々のプロジェクトの裏のプロセスが同じファイルを書くので、読んで・変えて・
// 書く間はロックで囲む (user-settings.ts と同じ)。壊れたファイルは上書きしない。
//
// 変える外部状態と戻し方: このファイルだけ。消せば、どのプロジェクトも空の
// タブから始まる。

import { mkdirSync, readFileSync } from "node:fs";
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
type MainTabsFile = { version: 1; projects: Record<string, ProjectEntry> };

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
  }
  if (problems.length > 0)
    throw new MainTabsStoreError(
      `the saved main tabs (${path}) are not in the expected shape, so they are not used or overwritten:\n- ${problems.join("\n- ")}`,
    );
  return raw as MainTabsFile;
}

/** このプロジェクトの配置。保存が無ければ null。 */
export function loadProjectMainTabs(path: string, root: string): unknown {
  const file = readMainTabsFile(path);
  if (!file) return null;
  // 自分のプロパティだけを見る ("constructor" のような根の名前を継承元で拾わない)。
  const entry = Object.getOwnPropertyDescriptor(file.projects, root);
  return entry ? (entry.value as ProjectEntry).layout : null;
}

export async function saveProjectMainTabs(
  path: string,
  root: string,
  layout: unknown,
  now: number = Date.now(),
): Promise<void> {
  const size = Buffer.byteLength(JSON.stringify(layout) ?? "", "utf8");
  if (layout === undefined || size > MAX_MAIN_TABS_LAYOUT_BYTES)
    throw new MainTabsStoreError(
      layout === undefined
        ? "main tabs layout is missing"
        : `main tabs layout is ${size} bytes (at most ${MAX_MAIN_TABS_LAYOUT_BYTES})`,
    );
  await withFileLock(`${path}.lock`, () => {
    const current = readMainTabsFile(path) ?? { version: 1, projects: {} };
    const projects: Record<string, ProjectEntry> = {
      ...current.projects,
      [root]: { layout, savedAt: now },
    };
    const roots = Object.keys(projects).sort(
      (a, b) => projects[b].savedAt - projects[a].savedAt,
    );
    for (const stale of roots.slice(MAX_MAIN_TABS_PROJECTS))
      delete projects[stale];
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileAtomic(
      path,
      `${JSON.stringify({ version: 1, projects }, null, 2)}\n`,
      0o600,
    );
  });
}
