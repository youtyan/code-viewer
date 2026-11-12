// 読むだけの git が .git/index を書かないこと (エージェントの git add / commit と
// index.lock を取り合わない)。作業ツリーのファイルの更新時刻だけを変えると、
// 普通の git status / git diff は index の stat の記録を書き直す。それが起きない
// ことを、index の更新時刻と中身で見る。

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  fileDiffTextAsync,
  gitInvocation,
  nameStatusResultAsync,
  numstatZResultAsync,
  repoStatusMapAsync,
  statusPorcelainForPathAsync,
} from "../server/git";
import { runGit } from "./_git-fixture";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const PAST = new Date("2001-01-01T00:00:00Z");

/** コミット済みのファイルを 1 つ持ち、index の記録とファイルの stat がずれた repo。 */
function staleStatRepo(): { dir: string; index: string } {
  const dir = mkdtempSync(join(tmpdir(), "cv-git-readonly-"));
  dirs.push(dir);
  runGit(dir, ["init", "-q"]);
  runGit(dir, ["config", "user.email", "test@example.com"]);
  runGit(dir, ["config", "user.name", "Test"]);
  writeFileSync(join(dir, "tracked.txt"), "same\n");
  writeFileSync(join(dir, "changed.txt"), "before\n");
  runGit(dir, ["add", "."]);
  runGit(dir, ["commit", "-q", "-m", "init"]);
  writeFileSync(join(dir, "changed.txt"), "after\n");
  const index = join(dir, ".git", "index");
  // index を過去の時刻にし、中身の同じファイルの更新時刻だけを今にする。
  utimesSync(index, PAST, PAST);
  const now = new Date();
  utimesSync(join(dir, "tracked.txt"), now, now);
  return { dir, index };
}

const READERS: {
  name: string;
  read: (dir: string) => Promise<{ failed: string | null }>;
}[] = [
  {
    name: "repoStatusMapAsync (the file tree badges)",
    read: async (dir) => {
      const result = await repoStatusMapAsync(dir);
      return { failed: result.ok === false ? result.error : null };
    },
  },
  {
    name: "statusPorcelainForPathAsync",
    read: async (dir) => {
      const result = await statusPorcelainForPathAsync("changed.txt", dir);
      return { failed: result.ok === false ? result.error : null };
    },
  },
  {
    name: "nameStatusResultAsync",
    read: async (dir) => ({
      failed: (await nameStatusResultAsync([], dir)).error ?? null,
    }),
  },
  {
    name: "numstatZResultAsync",
    read: async (dir) => ({
      failed: (await numstatZResultAsync([], dir)).error ?? null,
    }),
  },
  {
    name: "fileDiffTextAsync",
    read: async (dir) => {
      const result = await fileDiffTextAsync([], "changed.txt", dir);
      return { failed: result.code === 0 ? null : result.stderr };
    },
  },
];

describe("read-only git leaves .git/index alone", () => {
  test("control: a plain git status rewrites the index in this fixture", () => {
    const { dir, index } = staleStatRepo();
    runGit(dir, ["status", "--porcelain"]);
    expect(statSync(index).mtimeMs).not.toBe(PAST.getTime());
  });

  test.each(READERS)("$name does not write the index", async ({ read }) => {
    const { dir, index } = staleStatRepo();
    const before = readFileSync(index);
    expect(await read(dir)).toEqual({ failed: null });
    expect(statSync(index).mtimeMs).toBe(PAST.getTime());
    expect(readFileSync(index).equals(before)).toBe(true);
  });

  test.each(READERS)(
    "$name reads while another git holds index.lock",
    async ({ read }) => {
      const { dir } = staleStatRepo();
      const lock = join(dir, ".git", "index.lock");
      writeFileSync(lock, "");
      expect(await read(dir)).toEqual({ failed: null });
      expect(existsSync(lock)).toBe(true);
    },
  );
});

describe("gitInvocation", () => {
  test("a read gets the no-index-write settings and GIT_OPTIONAL_LOCKS=0", () => {
    const invocation = gitInvocation(["git", "status", "--porcelain"], {
      KEEP: "1",
    });
    expect(invocation.args.slice(1)).toEqual([
      "-c",
      "core.fsmonitor=false",
      "-c",
      "diff.autoRefreshIndex=false",
      "status",
      "--porcelain",
    ]);
    expect(invocation.env).toEqual({ KEEP: "1", GIT_OPTIONAL_LOCKS: "0" });
  });

  test.each([
    ["add", ["git", "worktree", "add", "/tmp/wt", "main"]],
    ["remove", ["git", "worktree", "remove", "--", "/tmp/wt"]],
    ["unlock", ["git", "worktree", "unlock", "/tmp/wt"]],
    ["prune", ["git", "worktree", "prune"]],
  ])("worktree %s keeps its own arguments and environment", (_name, args) => {
    const invocation = gitInvocation(args);
    expect(invocation.args.slice(1)).toEqual(args.slice(1));
    expect(invocation.env).toBeUndefined();
  });

  test("listing worktrees is a read", () => {
    const invocation = gitInvocation([
      "git",
      "worktree",
      "list",
      "--porcelain",
    ]);
    expect(invocation.env?.GIT_OPTIONAL_LOCKS).toBe("0");
  });
});
