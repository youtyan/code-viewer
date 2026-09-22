// URL の鍵 (`/p/<鍵>/`) からプロジェクトの根を引く。
//
// 鍵は根の実パスの rootFileKey (サーバ登録簿・起動ロックと同じ)。名前を URL に
// 入れると同名で衝突し、改名で壊れるので使わない。
//
// **引けるのは許したプロジェクトだけ。** URL を踏んだだけで任意のパスの
// プロセスが起きないように、次のどれかに当たる鍵しか根にしない:
// - プロジェクトの登録簿 (projects.json) の根
// - 入口がこのプロセスの間に許した根 (起動したディレクトリ、CLI の
//   「このディレクトリを開いて」、作業ツリーの画面の「開く」)
// - 登録したプロジェクトの作業ツリー (git worktree list)
//
// tmux で見つかっただけの未登録のプロジェクトは、切り替えるときに画面が
// 登録してから移る (今のサイドバーの動きと同じ)。

import { formatErrorDetail } from "../../core/error-detail";
import { worktreePathsAsync } from "../git";
import {
  projectRegistryPath,
  readProjectRegistryCached,
} from "../projects/registry";
import { rootFileKey } from "../server-registry";

/** URL の鍵の形。rootFileKey は sha256 の 16 進の先頭 16 文字。 */
export const PROJECT_KEY_PATTERN = /^[0-9a-f]{16}$/;

export function isProjectKey(value: string): boolean {
  return PROJECT_KEY_PATTERN.test(value);
}

/** 作業ツリーの一覧を覚えておく時間。鍵を引くたびに git を立てない。 */
const WORKTREE_CACHE_TTL_MS = 10_000;

export type EntryProjectsDeps = {
  registryRoots(): string[];
  worktreePaths(root: string): Promise<string[]>;
  now(): number;
};

export type ProjectLookup =
  | { status: "found"; root: string }
  | { status: "unknown" }
  | { status: "error"; error: string };

export function defaultEntryProjectsDeps(): EntryProjectsDeps {
  return {
    registryRoots: () => {
      const read = readProjectRegistryCached(projectRegistryPath());
      if (read.ok === false) throw new Error(read.error);
      return read.registry.projects.map((project) => project.root);
    },
    worktreePaths: worktreePathsAsync,
    now: Date.now,
  };
}

export function createEntryProjects(
  deps: EntryProjectsDeps = defaultEntryProjectsDeps(),
) {
  const allowed = new Map<string, string>();
  const worktreeCache = new Map<string, { at: number; paths: string[] }>();

  async function worktreesOf(root: string): Promise<string[]> {
    const hit = worktreeCache.get(root);
    if (hit && deps.now() - hit.at < WORKTREE_CACHE_TTL_MS) return hit.paths;
    const paths = await deps.worktreePaths(root);
    worktreeCache.set(root, { at: deps.now(), paths });
    return paths;
  }

  /** この根を開いてよいものにする。返すのは鍵。 */
  function allow(root: string): string {
    const key = rootFileKey(root);
    allowed.set(key, root);
    return key;
  }

  async function lookup(key: string): Promise<ProjectLookup> {
    if (!isProjectKey(key)) return { status: "unknown" };
    const known = allowed.get(key);
    if (known) return { status: "found", root: known };
    let roots: string[];
    try {
      roots = deps.registryRoots();
    } catch (error) {
      return {
        status: "error",
        error: `the project registry cannot be read: ${formatErrorDetail(error)}`,
      };
    }
    for (const root of roots) {
      if (rootFileKey(root) === key) return { status: "found", root };
    }
    const failures: string[] = [];
    for (const root of roots) {
      let paths: string[];
      try {
        paths = await worktreesOf(root);
      } catch (error) {
        failures.push(`${root}: ${formatErrorDetail(error)}`);
        continue;
      }
      for (const path of paths) {
        if (rootFileKey(path) === key) return { status: "found", root: path };
      }
    }
    if (failures.length > 0) {
      return {
        status: "error",
        error: `the worktrees of registered projects could not be listed:\n${failures.join("\n")}`,
      };
    }
    return { status: "unknown" };
  }

  return { allow, lookup, keyOf: rootFileKey };
}

export type EntryProjects = ReturnType<typeof createEntryProjects>;
