// 左のサイドバーのプロジェクトの行の、主でないブランチと上流との差 (↑2 ↓1)。
// 補足の文字・いつ読み直すか (入口が git を直接読む)・実際の git の読み方。
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { projectBranchTail } from "../core/agent-overview";
import { branchStatusResultAsync } from "../server/git";
import {
  BRANCH_STATUS_FALLBACK_MS,
  createBranchStatusTracker,
} from "../server/projects/branch-status";
import { runGit } from "./_git-fixture";

const status = (branch: string | null, ahead = 0, behind = 0) => ({
  branch,
  ahead,
  behind,
  upstream: true,
});

describe("projectBranchTail", () => {
  test.each([
    { name: "まだ読んでいない", status: undefined, expected: null },
    { name: "main は言うまでもない", status: status("main"), expected: null },
    { name: "master も", status: status("master"), expected: null },
    {
      name: "名前と同じブランチ (worktree)",
      status: status("Sample-App"),
      expected: null,
    },
    {
      name: "主でないブランチ",
      status: status("feature/x"),
      expected: "feature/x",
    },
    {
      name: "main でも差は出す",
      status: status("main", 2, 1),
      expected: "↑2 ↓1",
    },
    { name: "ブランチと差", status: status("fix", 0, 3), expected: "fix ↓3" },
    {
      name: "detached は名前を出さない",
      status: status(null, 1),
      expected: "↑1",
    },
  ])("$name", ({ status, expected }) => {
    expect(projectBranchTail("sample-app", status)).toBe(expected);
  });
});

describe("when the entry server reads a project's branch again", () => {
  function track() {
    let now = 1_000;
    const reads: string[] = [];
    const tracker = createBranchStatusTracker(
      async (root) => {
        reads.push(root);
        return root === "/broken"
          ? { ...status(null), error: "git rev-list failed: sample reason" }
          : status("feature");
      },
      () => now,
    );
    return {
      tracker,
      reads,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  test("reads once, then only on a turn end, a move to the project, or the fallback", async () => {
    const { tracker, reads, advance } = track();
    const roots = ["/a", "/b"];
    tracker.note({ roots, working: new Set(["/a"]), selected: "/a" });
    await settle();
    expect(reads).toEqual(["/a", "/b"]);
    expect(tracker.get("/a")).toEqual({
      status: "ok",
      value: status("feature"),
    });

    // 何も変わらなければ読まない。
    tracker.note({ roots, working: new Set(["/a"]), selected: "/a" });
    await settle();
    expect(reads).toHaveLength(2);

    // /a のエージェントのターンが終わった (作業中が居なくなった)。
    tracker.note({ roots, working: new Set(), selected: "/a" });
    // /b へ移った。
    tracker.note({ roots, working: new Set(), selected: "/b" });
    await settle();
    expect(reads.slice(2)).toEqual(["/a", "/b"]);

    advance(BRANCH_STATUS_FALLBACK_MS);
    tracker.note({ roots, working: new Set(), selected: "/b" });
    await settle();
    expect(reads.slice(4).sort()).toEqual(["/a", "/b"]);
  });

  test("a failure keeps git's reason for the list's errors", async () => {
    const { tracker } = track();
    tracker.note({ roots: ["/broken"], working: new Set(), selected: null });
    await settle();
    expect(tracker.get("/broken")).toEqual({
      status: "error",
      error: "git rev-list failed: sample reason",
    });
  });
});

describe("branchStatusResultAsync", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  function repo(): string {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-branch-"));
    dirs.push(dir);
    runGit(dir, ["init", "-q", "-b", "main"]);
    runGit(dir, ["config", "user.email", "sample@example.com"]);
    runGit(dir, ["config", "user.name", "sample"]);
    writeFileSync(join(dir, "a.txt"), "a\n");
    runGit(dir, ["add", "a.txt"]);
    runGit(dir, ["commit", "-q", "-m", "first"]);
    return dir;
  }

  test("a branch ahead of and behind its upstream", async () => {
    const upstream = repo();
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-branch-clone-"));
    dirs.push(dir);
    runGit(dir, ["clone", "-q", upstream, "."]);
    runGit(dir, ["config", "user.email", "sample@example.com"]);
    runGit(dir, ["config", "user.name", "sample"]);
    writeFileSync(join(upstream, "b.txt"), "b\n");
    runGit(upstream, ["add", "b.txt"]);
    runGit(upstream, ["commit", "-q", "-m", "upstream"]);
    runGit(dir, ["fetch", "-q"]);
    writeFileSync(join(dir, "c.txt"), "c\n");
    runGit(dir, ["add", "c.txt"]);
    runGit(dir, ["commit", "-q", "-m", "local"]);
    expect(await branchStatusResultAsync(dir)).toEqual({
      branch: "main",
      ahead: 1,
      behind: 1,
      upstream: true,
    });
  });

  test("a branch without an upstream, and a detached HEAD, are not errors", async () => {
    const dir = repo();
    expect(await branchStatusResultAsync(dir)).toEqual({
      branch: "main",
      ahead: 0,
      behind: 0,
      upstream: false,
    });
    runGit(dir, ["checkout", "-q", "--detach"]);
    expect(await branchStatusResultAsync(dir)).toEqual({
      branch: null,
      ahead: 0,
      behind: 0,
      upstream: false,
    });
  });
});
