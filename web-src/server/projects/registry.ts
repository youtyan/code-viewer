// プロジェクトの登録簿 (ユーザー単位の 1 ファイル)。
//
// 置き場所はアカウントの登録簿と同じ状態ディレクトリ
// (`<状態ディレクトリ>/projects.json`)。キャッシュに置くと掃除で消える。
// テストは CODE_VIEWER_TEST_STATE_DIR で逃がす (user-state-dir.ts)。
//
// 別々のリポジトリで動く複数のサーバが同時に書くので、読んで・変えて・
// 書く間はプロセスをまたいだロック (file-lock.ts) で囲み、書くときは
// 一時ファイルから rename する (途中で落ちても半端なファイルを残さない)。
//
// 壊れた登録簿は上書きしない。読めない間は変更を断り、理由を全部返す。
// 登録簿から外してもリポジトリには何もしない。
//
// 変える外部状態と戻し方 (server.md「外部状態を変える機能」): このファイル
// だけ。消せば登録が無い状態に戻る。検出は doctor の projects グループ。

import { homedir } from "node:os";
import { join } from "node:path";
import {
  emptyProjectRegistry,
  type ProjectRegistry,
  type ProjectRegistryChange,
  type ProjectRegistryIssue,
  type ProjectRegistrySnapshot,
  parseProjectRegistry,
  registeredProjectInfos,
  type StoredProject,
} from "../../core/projects";
import { withFileLock } from "../file-lock";
import {
  cachedRegistryReader,
  type RegistryFileRead,
  readRegistryFile,
} from "../registry-file";
import { writeFileAtomic } from "../terminal/settings-file";
import { codeViewerStateDir } from "../user-state-dir";

type Env = Record<string, string | undefined>;

export function projectRegistryPath(
  env: Env = process.env,
  home: string = homedir(),
): string {
  return join(codeViewerStateDir(env, home), "projects.json");
}

export class ProjectRegistryError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid"
      | "conflict"
      | "not-found"
      | "unreadable"
      | "failed",
    options?: { cause?: unknown },
  ) {
    super(message);
    if (options && "cause" in options) {
      Object.assign(this, { cause: options.cause });
    }
  }
}

export type ProjectRegistryRead = RegistryFileRead<ProjectRegistry>;

/** 読む。無ければ空。読めない・形が違えば ok: false と理由の全文。 */
export function readProjectRegistry(path: string): ProjectRegistryRead {
  return readRegistryFile(path, parseProjectRegistry, emptyProjectRegistry);
}

/** 一覧の取り直しのたびに読むので、変わっていなければ前回の結果を使う。 */
export const readProjectRegistryCached =
  cachedRegistryReader(readProjectRegistry);

/** 一覧・切替に載せる形。読めなければ空の一覧と理由の全文。 */
export function projectRegistrySnapshot(path: string): ProjectRegistrySnapshot {
  const read = readProjectRegistryCached(path);
  if (read.ok === false) return { projects: [], error: read.error, path };
  return { projects: registeredProjectInfos(read.registry), error: "", path };
}

// ai-dup-check: allow -- fp:switch over a different issue union (projects, not accounts)
export function issueMessage(issue: ProjectRegistryIssue): string {
  switch (issue.code) {
    case "name":
      return `invalid project name (${issue.issue})`;
    case "root":
      return `invalid project path (${issue.issue})`;
    case "duplicate":
      return `this repository is already registered as "${issue.existing}"`;
    case "too-many":
      return `at most ${issue.limit} projects can be registered`;
    case "not-found":
      return `${issue.root} is not registered`;
  }
}

function issueCode(issue: ProjectRegistryIssue): ProjectRegistryError["code"] {
  if (issue.code === "duplicate") return "conflict";
  if (issue.code === "not-found") return "not-found";
  return "invalid";
}

/**
 * ロックを持って、読めることを確かめて、変えて、書く。変えた結果が同じ
 * 登録簿 (上へ・下への端など) なら書かない。
 */
export async function updateProjectRegistry(
  path: string,
  change: (registry: ProjectRegistry) => ProjectRegistryChange,
): Promise<StoredProject> {
  return withFileLock(`${path}.lock`, () => {
    const read = readProjectRegistry(path);
    if (read.ok === false) {
      throw new ProjectRegistryError(
        `the project registry cannot be read, so it was not changed.\n${read.error}`,
        "unreadable",
      );
    }
    const result = change(read.registry);
    if (result.ok === false) {
      throw new ProjectRegistryError(
        issueMessage(result.issue),
        issueCode(result.issue),
      );
    }
    if (result.registry !== read.registry) {
      try {
        writeFileAtomic(
          path,
          `${JSON.stringify(result.registry, null, 2)}\n`,
          0o600,
        );
      } catch (error) {
        throw new ProjectRegistryError(`failed to write ${path}`, "failed", {
          cause: error,
        });
      }
    }
    return result.project;
  });
}
