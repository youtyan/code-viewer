// /_worktree/* の入口。実際に git worktree を足し引きするので、テストごとに
// 使い捨てのリポジトリを作る。
//
// open だけは扱わない。あれは code-viewer をもう 1 本起こすので、テストから
// 呼ぶと孤児プロセスが残りうる (起動済みサーバの再利用経路は
// worktree-open.test.ts が registry だけで確かめる)。

import {
  existsSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { WorktreesResponse } from "../core/types";
import { handleWorktreeRoute } from "../server/worktree/handle";
import { mapWithConcurrency } from "../server/worktree/list";
import { runGit } from "./_git-fixture";
import { callRoute, postRoute, type RouteHandler } from "./_test-helpers";

const GENERATION = 7;

// handleWorktreeRoute は generation も受け取るので、共有ヘルパが期待する
// 4 引数の形に畳んでから渡す。
const route: RouteHandler = (req, url, cwd, sideEffectAllowed) =>
  handleWorktreeRoute(req, url, cwd, GENERATION, sideEffectAllowed);

let repo = "";

function call(
  path: string,
  init?: RequestInit,
  sideEffectAllowed?: (req: Request) => boolean,
) {
  return callRoute(route, path, init, sideEffectAllowed, repo);
}

function post(
  path: string,
  body: unknown,
  sideEffectAllowed?: (req: Request) => boolean,
) {
  return postRoute(route, path, body, sideEffectAllowed, repo);
}

async function listWorktrees(): Promise<WorktreesResponse> {
  const res = await call("/_worktree/list");
  expect(res?.status).toBe(200);
  return (await res?.json()) as WorktreesResponse;
}

/**
 * 一覧に載っている実パスを引く。画面も一覧の path をそのまま送り返すので、
 * テストが手で組み立てたパスを使うと本番と違う経路を叩くことになる
 * (macOS の一時ディレクトリは symlink なので、組み立てたパスは git が返す
 * 実パスと一致しない)。
 */
async function listedPath(
  match: (entry: WorktreesResponse["worktrees"][number]) => boolean,
): Promise<string> {
  const body = await listWorktrees();
  const found = body.worktrees.find(match);
  if (!found) throw new Error("no worktree matched");
  return found.path;
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "code-viewer-worktree-"));
  runGit(repo, ["init", "-q", "-b", "main", "."]);
  runGit(repo, ["config", "user.email", "test@example.com"]);
  runGit(repo, ["config", "user.name", "test"]);
  writeFileSync(join(repo, "sample.txt"), "sample\n");
  runGit(repo, ["add", "sample.txt"]);
  runGit(repo, ["commit", "-qm", "initial commit"]);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("worktree route dispatch", () => {
  test("passes an unknown path through to the next handler", async () => {
    expect(await call("/_worktree/nope")).toBeNull();
  });

  test("rejects POST on the list", async () => {
    const res = await call("/_worktree/list", { method: "POST" });
    expect(res?.status).toBe(405);
  });

  test.each([
    { name: "rejects GET on add", path: "/_worktree/add" },
    { name: "rejects GET on remove", path: "/_worktree/remove" },
    { name: "rejects GET on open", path: "/_worktree/open" },
  ])("$name", async ({ path }) => {
    const res = await call(path);
    expect(res?.status).toBe(405);
  });

  test.each([
    { name: "guards add", path: "/_worktree/add", body: { name: "x" } },
    { name: "guards remove", path: "/_worktree/remove", body: { path: "/x" } },
    { name: "guards open", path: "/_worktree/open", body: { path: "/x" } },
  ])("$name against cross-origin writes", async ({ path, body }) => {
    const res = await post(path, body, () => false);
    expect(res?.status).toBe(403);
  });
});

describe("worktree list", () => {
  test("bounds concurrent item work while preserving list order", async () => {
    let active = 0;
    let maximum = 0;
    const values = await mapWithConcurrency(
      [0, 1, 2, 3, 4, 5, 6],
      3,
      async (value) => {
        active += 1;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        active -= 1;
        return value * 2;
      },
    );

    expect(maximum).toBe(3);
    expect(values).toEqual([0, 2, 4, 6, 8, 10, 12]);
  });

  test("reports the main worktree as the one this server serves", async () => {
    const body = await listWorktrees();
    expect(body.generation).toBe(GENERATION);
    expect(body.worktrees).toHaveLength(1);
    const [main] = body.worktrees;
    expect(main.branch).toBe("main");
    expect(main.current).toBe(true);
    expect(main.displayPath).toBe(".");
    expect(main.changedCount).toBe(0);
    expect(main.error).toBe("");
    expect(main.lastCommit?.subject).toBe("initial commit");
  });

  test("counts uncommitted changes per worktree", async () => {
    writeFileSync(join(repo, "sample.txt"), "edited\n");
    writeFileSync(join(repo, "untracked.txt"), "new\n");
    const body = await listWorktrees();
    expect(body.worktrees[0].changedCount).toBe(2);
  });
});

describe("divergence from the base branch", () => {
  test("names main as the base and leaves the base row itself uncompared", async () => {
    const body = await listWorktrees();
    expect(body.baseBranch).toBe("main");
    expect(body.worktrees[0].divergence).toBeNull();
  });

  test("counts commits ahead of and behind the base", async () => {
    await post("/_worktree/add", { name: "feature-x" });
    const added = await listedPath((entry) => entry.name === "feature-x");
    writeFileSync(join(added, "only-here.txt"), "one\n");
    runGit(added, ["add", "only-here.txt"]);
    runGit(added, ["commit", "-qm", "add a file on the branch"]);
    // 基準側にもコミットを積んで、behind が 0 でないことまで見る。
    writeFileSync(join(repo, "on-main.txt"), "main\n");
    runGit(repo, ["add", "on-main.txt"]);
    runGit(repo, ["commit", "-qm", "add a file on main"]);

    const entry = (await listWorktrees()).worktrees.find(
      (item) => item.name === "feature-x",
    );
    expect(entry?.divergence?.base).toBe("main");
    expect(entry?.divergence?.ahead).toBe(1);
    expect(entry?.divergence?.behind).toBe(1);
  });

  test("reports a clean merge when the branches touch different files", async () => {
    await post("/_worktree/add", { name: "feature-x" });
    const added = await listedPath((entry) => entry.name === "feature-x");
    writeFileSync(join(added, "branch-only.txt"), "branch\n");
    runGit(added, ["add", "branch-only.txt"]);
    runGit(added, ["commit", "-qm", "branch side"]);

    const entry = (await listWorktrees()).worktrees.find(
      (item) => item.name === "feature-x",
    );
    expect(entry?.divergence?.mergeState).toBe("clean");
    expect(entry?.divergence?.conflicts).toEqual([]);
  });

  test("names the files that would conflict with the base", async () => {
    await post("/_worktree/add", { name: "feature-x" });
    const added = await listedPath((entry) => entry.name === "feature-x");
    writeFileSync(join(added, "sample.txt"), "from the branch\n");
    runGit(added, ["commit", "-qam", "branch edit"]);
    writeFileSync(join(repo, "sample.txt"), "from main\n");
    runGit(repo, ["commit", "-qam", "main edit"]);

    const entry = (await listWorktrees()).worktrees.find(
      (item) => item.name === "feature-x",
    );
    expect(entry?.divergence?.mergeState).toBe("conflict");
    expect(entry?.divergence?.conflicts).toEqual(["sample.txt"]);
  });
});

describe("changed files", () => {
  test("lists uncommitted work and commits made since the branch point", async () => {
    await post("/_worktree/add", { name: "feature-x" });
    const added = await listedPath((entry) => entry.name === "feature-x");
    writeFileSync(join(added, "committed.txt"), "done\n");
    runGit(added, ["add", "committed.txt"]);
    runGit(added, ["commit", "-qm", "committed change"]);
    writeFileSync(join(added, "sample.txt"), "edited\n");
    writeFileSync(join(added, "brand-new.txt"), "new\n");

    const entry = (await listWorktrees()).worktrees.find(
      (item) => item.name === "feature-x",
    );
    const byOrigin = (origin: string) =>
      (entry?.files || [])
        .filter((file) => file.origin === origin)
        .map((file) => file.path)
        .sort();
    expect(byOrigin("uncommitted")).toEqual(["brand-new.txt", "sample.txt"]);
    expect(byOrigin("committed")).toEqual(["committed.txt"]);
    expect(entry?.fileCount).toBe(3);
    // 未追跡は追加済みと区別できるようにしてある。
    expect(
      entry?.files.find((file) => file.path === "brand-new.txt")?.status,
    ).toBe("U");
  });

  test("counts only uncommitted work as the change count", async () => {
    await post("/_worktree/add", { name: "feature-x" });
    const added = await listedPath((entry) => entry.name === "feature-x");
    writeFileSync(join(added, "committed.txt"), "done\n");
    runGit(added, ["add", "committed.txt"]);
    runGit(added, ["commit", "-qm", "committed change"]);
    writeFileSync(join(added, "sample.txt"), "edited\n");

    const entry = (await listWorktrees()).worktrees.find(
      (item) => item.name === "feature-x",
    );
    expect(entry?.changedCount).toBe(1);
  });

  test("returns every changed file after the former 200-file boundary", async () => {
    for (let i = 0; i < 201; i++) {
      writeFileSync(join(repo, `bulk-${i}.txt`), "changed\n");
    }

    const entry = (await listWorktrees()).worktrees[0];

    expect(entry.files).toHaveLength(201);
    expect(entry.fileCount).toBe(201);
    expect(entry.files.some((file) => file.path === "bulk-200.txt")).toBe(true);
  });

  test("keeps the old path of a renamed file", async () => {
    renameSync(join(repo, "sample.txt"), join(repo, "renamed.txt"));
    runGit(repo, ["add", "-A"]);

    const entry = (await listWorktrees()).worktrees[0];
    const renamed = entry.files.find((file) => file.path === "renamed.txt");

    expect(renamed?.status).toBe("R");
    expect(renamed?.oldPath).toBe("sample.txt");
  });
});

describe("file diffs", () => {
  type DiffBody = {
    file: string;
    origin: string;
    diff: string;
    totalHunks: number;
    renderedHunks: number;
    truncated: boolean;
    generation: number;
  };

  async function diffOf(params: Record<string, string>): Promise<Response> {
    const query = new URLSearchParams(params).toString();
    const res = await call(`/_worktree/diff?${query}`);
    if (!res) throw new Error("diff route did not answer");
    return res;
  }

  test("returns the uncommitted diff of a file in another worktree", async () => {
    await post("/_worktree/add", { name: "feature-x" });
    const added = await listedPath((entry) => entry.name === "feature-x");
    writeFileSync(join(added, "sample.txt"), "edited in the worktree\n");

    const res = await diffOf({
      path: added,
      file: "sample.txt",
      origin: "uncommitted",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DiffBody;
    expect(body.diff).toContain("+edited in the worktree");
    expect(body.truncated).toBe(false);
    expect(body.generation).toBe(GENERATION);
  });

  test("compares an untracked file against nothing", async () => {
    await post("/_worktree/add", { name: "feature-x" });
    const added = await listedPath((entry) => entry.name === "feature-x");
    writeFileSync(join(added, "brand-new.txt"), "fresh\n");

    const res = await diffOf({
      path: added,
      file: "brand-new.txt",
      origin: "uncommitted",
      untracked: "1",
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as DiffBody).diff).toContain("+fresh");
  });

  test("returns commits made since the branch point", async () => {
    await post("/_worktree/add", { name: "feature-x" });
    const added = await listedPath((entry) => entry.name === "feature-x");
    writeFileSync(join(added, "sample.txt"), "committed on the branch\n");
    runGit(added, ["commit", "-qam", "branch edit"]);

    const res = await diffOf({
      path: added,
      file: "sample.txt",
      origin: "committed",
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as DiffBody).diff).toContain(
      "+committed on the branch",
    );
  });

  test("has nothing to compare when the worktree is on the base branch", async () => {
    const current = await listedPath((entry) => entry.current);
    const res = await diffOf({
      path: current,
      file: "sample.txt",
      origin: "committed",
    });
    expect(res.status).toBe(409);
  });

  test.each([
    { name: "rejects a path outside the worktree", file: "../escape.txt" },
    { name: "rejects an absolute path", file: "/etc/hosts" },
    { name: "rejects a missing file argument", file: "" },
  ])("$name", async ({ file }) => {
    const current = await listedPath((entry) => entry.current);
    const res = await diffOf({ path: current, file });
    expect(res.status).toBe(400);
  });

  test("refuses to read inside .git", async () => {
    const current = await listedPath((entry) => entry.current);
    const res = await diffOf({ path: current, file: ".git/config" });
    expect(res.status).toBe(403);
  });

  test("refuses a worktree that is not in the list", async () => {
    const res = await diffOf({
      path: join(repo, "not-a-worktree"),
      file: "sample.txt",
    });
    expect(res.status).toBe(404);
  });
});

describe("overlapping files across worktrees", () => {
  test("reports a file two worktrees are both changing", async () => {
    await post("/_worktree/add", { name: "one" });
    await post("/_worktree/add", { name: "two" });
    const first = await listedPath((entry) => entry.name === "one");
    const second = await listedPath((entry) => entry.name === "two");
    writeFileSync(join(first, "sample.txt"), "from one\n");
    writeFileSync(join(second, "sample.txt"), "from two\n");

    const body = await listWorktrees();
    expect(body.overlaps).toEqual([
      { path: "sample.txt", worktreeIds: [first, second] },
    ]);
  });

  test("stays quiet when the worktrees touch different files", async () => {
    await post("/_worktree/add", { name: "one" });
    await post("/_worktree/add", { name: "two" });
    const first = await listedPath((entry) => entry.name === "one");
    const second = await listedPath((entry) => entry.name === "two");
    writeFileSync(join(first, "one.txt"), "one\n");
    writeFileSync(join(second, "two.txt"), "two\n");

    expect((await listWorktrees()).overlaps).toEqual([]);
  });
});

describe("worktree add", () => {
  test("creates the worktree and a branch of the same name", async () => {
    const res = await post("/_worktree/add", { name: "feature-x" });
    expect(res?.status).toBe(200);

    const body = await listWorktrees();
    const added = body.worktrees.find((entry) => entry.name === "feature-x");
    expect(added?.branch).toBe("feature-x");
    expect(added?.current).toBe(false);
    expect(added?.displayPath).toBe(join(".worktrees", "feature-x"));
    expect(existsSync(join(repo, ".worktrees", "feature-x"))).toBe(true);
  });

  test("checks out an existing branch instead of creating one", async () => {
    runGit(repo, ["branch", "existing"]);
    const res = await post("/_worktree/add", {
      name: "dir-name",
      branch: "existing",
    });
    expect(res?.status).toBe(200);

    const body = await listWorktrees();
    const added = body.worktrees.find((entry) => entry.name === "dir-name");
    expect(added?.branch).toBe("existing");
  });

  test("refuses a directory that already exists", async () => {
    await post("/_worktree/add", { name: "feature-x" });
    const res = await post("/_worktree/add", { name: "feature-x" });
    expect(res?.status).toBe(409);
  });

  test.each([
    { name: "rejects an empty name", body: { name: "" } },
    { name: "rejects a path separator", body: { name: "a/b" } },
    { name: "rejects a dotfile name", body: { name: ".hidden" } },
    { name: "rejects a missing name", body: {} },
    {
      name: "rejects a leading dash in the branch",
      body: { name: "ok", branch: "-x" },
    },
  ])("$name with 400", async ({ body }) => {
    const res = await post("/_worktree/add", body);
    expect(res?.status).toBe(400);
    // 弾いたのだから、ディレクトリは 1 つも増えていない。
    expect(existsSync(join(repo, ".worktrees"))).toBe(false);
  });
});

describe("worktree remove", () => {
  test("removes a listed worktree but keeps its branch", async () => {
    await post("/_worktree/add", { name: "feature-x" });
    const added = await listedPath((entry) => entry.name === "feature-x");

    const res = await post("/_worktree/remove", { path: added });
    expect(res?.status).toBe(200);
    expect(existsSync(added)).toBe(false);

    const body = await listWorktrees();
    expect(body.worktrees.map((entry) => entry.name)).not.toContain(
      "feature-x",
    );
    const branches = runGit(repo, ["branch", "--list", "feature-x"]).stdout;
    expect(branches).toContain("feature-x");
  });

  test("refuses to remove the worktree this server serves", async () => {
    const current = await listedPath((entry) => entry.current);
    const res = await post("/_worktree/remove", { path: current });
    expect(res?.status).toBe(409);
    expect(existsSync(join(repo, "sample.txt"))).toBe(true);
  });

  test("refuses a path that is not in the worktree list", async () => {
    const res = await post("/_worktree/remove", {
      path: join(repo, "not-a-worktree"),
    });
    expect(res?.status).toBe(404);
  });

  test("refuses an empty path", async () => {
    const res = await post("/_worktree/remove", { path: "" });
    expect(res?.status).toBe(400);
  });

  test("reports git's refusal when the worktree is dirty", async () => {
    await post("/_worktree/add", { name: "feature-x" });
    const added = await listedPath((entry) => entry.name === "feature-x");
    writeFileSync(join(added, "sample.txt"), "edited\n");

    const res = await post("/_worktree/remove", { path: added });
    expect(res?.status).toBe(500);
    // git の言い分をそのまま返す。理由を握り潰さない。
    expect(await res?.text()).toMatch(/contains modified or untracked files/i);
    expect(existsSync(added)).toBe(true);
  });

  test("removes a dirty worktree when forced", async () => {
    await post("/_worktree/add", { name: "feature-x" });
    const added = await listedPath((entry) => entry.name === "feature-x");
    writeFileSync(join(added, "sample.txt"), "edited\n");

    const res = await post("/_worktree/remove", { path: added, force: true });
    expect(res?.status).toBe(200);
    expect(existsSync(added)).toBe(false);
  });

  test("unregisters a worktree whose folder is already gone", async () => {
    await post("/_worktree/add", { name: "feature-x" });
    const added = await listedPath((entry) => entry.name === "feature-x");
    rmSync(added, { recursive: true, force: true });

    // フォルダが無いエントリに `git worktree remove` を受け付けない git が
    // あるので、サーバは prune に切り替える。どちらの git でも登録が消える。
    const res = await post("/_worktree/remove", { path: added });
    expect(res?.status).toBe(200);

    const body = await listWorktrees();
    expect(body.worktrees.map((entry) => entry.name)).not.toContain(
      "feature-x",
    );
    // 登録を消してもブランチは残る。
    const branches = runGit(repo, ["branch", "--list", "feature-x"]).stdout;
    expect(branches).toContain("feature-x");
  });
});

describe("diff endpoint hardening", () => {
  async function diffRaw(params: Record<string, string>): Promise<Response> {
    const query = new URLSearchParams(params).toString();
    const res = await call(`/_worktree/diff?${query}`);
    if (!res) throw new Error("diff route did not answer");
    return res;
  }

  test("refuses a file argument that git would read as an option", async () => {
    // `--output=<path>` は git diff --no-index に渡ると、その場所へファイルを
    // 書き出す。文字列としては相対パスに見えるので、`..` と絶対パスの検査だけ
    // では通ってしまう。
    const current = await listedPath((entry) => entry.current);
    const written = join(repo, "written-by-git.txt");
    const res = await diffRaw({
      path: current,
      file: `--output=${written}`,
      untracked: "1",
    });
    expect(res.status).toBe(400);
    expect(existsSync(written)).toBe(false);
  });

  test("refuses a tracked file that this worktree has not changed", async () => {
    // untracked=1 を付ければ何でも読める、という穴を塞いである。
    const current = await listedPath((entry) => entry.current);
    const res = await diffRaw({
      path: current,
      file: "sample.txt",
      untracked: "1",
    });
    expect(res.status).toBe(404);
  });

  test("refuses a path that escapes the worktree through a symlink", async () => {
    const outside = mkdtempSync(join(tmpdir(), "code-viewer-outside-"));
    try {
      writeFileSync(join(outside, "secret.txt"), "secret\n");
      symlinkSync(outside, join(repo, "link"));
      const current = await listedPath((entry) => entry.current);
      const res = await diffRaw({
        path: current,
        file: "link/secret.txt",
        untracked: "1",
      });
      // 変更一覧にも載らないので、まずそこで止まる。
      expect([403, 404]).toContain(res.status);
      expect(await res.text()).not.toContain("secret");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
