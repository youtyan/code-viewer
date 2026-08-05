import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { BLAME_ZERO_SHA, blameAsync, commitHistoryAsync } from "../server/git";
import { runGit as git } from "./_git-fixture";

describe("blame", () => {
  let repo: string;
  let firstSha: string;
  let secondSha: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "code-viewer-blame-"));
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.email", "blame@example.com"]);
    git(repo, ["config", "user.name", "Blame Tester"]);
    writeFileSync(join(repo, "a.txt"), "line1\nline2\nline3\n");
    git(repo, ["add", "a.txt"]);
    git(repo, ["commit", "-m", "first commit"]);
    firstSha = git(repo, ["rev-parse", "HEAD"]).stdout.trim();
    writeFileSync(join(repo, "a.txt"), "line1\nLINE2\nline3\nline4\n");
    git(repo, ["add", "a.txt"]);
    git(repo, ["commit", "-m", "edit line2, add line4"]);
    secondSha = git(repo, ["rev-parse", "HEAD"]).stdout.trim();
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  test("parses --porcelain output and labels lines by commit", async () => {
    const res = await blameAsync(repo, {
      path: "a.txt",
      ref: "HEAD",
      base: "HEAD",
    });
    expect(res.error).toBeUndefined();
    expect(res.lines.map((l) => l.lineNo)).toEqual([1, 2, 3, 4]);
    expect(res.lines[0].sha).toBe(firstSha);
    expect(res.lines[1].sha).toBe(secondSha);
    expect(res.lines[2].sha).toBe(firstSha);
    expect(res.lines[3].sha).toBe(secondSha);
    expect(res.commits[firstSha].summary).toBe("first commit");
    expect(res.commits[secondSha].summary).toBe("edit line2, add line4");
    expect(res.commits[firstSha].author).toBe("Blame Tester");
    expect(res.commits[firstSha].authorTime > 0).toBe(true);
    expect(res.commits[firstSha].isUncommitted).toBe(false);
  });

  test("returns base=HEAD result for a non-HEAD ref", async () => {
    const res = await blameAsync(repo, {
      path: "a.txt",
      ref: firstSha,
      base: "HEAD",
    });
    expect(res.error).toBeUndefined();
    expect(res.lines.map((l) => l.lineNo)).toEqual([1, 2, 3]);
    for (const line of res.lines) expect(line.sha).toBe(firstSha);
  });

  test("worktree base marks dirty lines with the zero sha", async () => {
    writeFileSync(join(repo, "a.txt"), "line1\nLINE2\nNEW3\nline4\n");
    const res = await blameAsync(repo, {
      path: "a.txt",
      ref: "worktree",
      base: "worktree",
    });
    expect(res.error).toBeUndefined();
    const dirty = res.lines.find((l) => l.lineNo === 3);
    expect(dirty?.sha).toBe(BLAME_ZERO_SHA);
    expect(dirty?.isUncommitted).toBe(true);
    expect(res.commits[BLAME_ZERO_SHA].isUncommitted).toBe(true);
    // restore working tree for later tests
    writeFileSync(join(repo, "a.txt"), "line1\nLINE2\nline3\nline4\n");
  });

  test("worktree base synthesizes uncommitted blame for an untracked file", async () => {
    writeFileSync(join(repo, "new.txt"), "alpha\nbeta\ngamma\n");
    const res = await blameAsync(repo, {
      path: "new.txt",
      ref: "worktree",
      base: "worktree",
    });
    expect(res.error).toBeUndefined();
    expect(res.isSynthetic).toBe(true);
    expect(res.isUntracked).toBe(true);
    expect(res.lines.length >= 3).toBe(true);
    for (const line of res.lines) {
      expect(line.sha).toBe(BLAME_ZERO_SHA);
      expect(line.isUncommitted).toBe(true);
    }
    expect(res.commits[BLAME_ZERO_SHA].isUncommitted).toBe(true);
    rmSync(join(repo, "new.txt"), { force: true });
  });

  test("worktree base reports a missing file clearly", async () => {
    const res = await blameAsync(repo, {
      path: "missing.txt",
      ref: "worktree",
      base: "worktree",
    });
    expect(res.lines).toEqual([]);
    expect(res.commits).toEqual({});
    expect(res.error).toBe("file not found");
  });

  test("rejects unsafe paths", async () => {
    const res = await blameAsync(repo, {
      path: "-evil",
      ref: "HEAD",
      base: "HEAD",
    });
    expect(res.error).toBeTruthy();
    expect(res.lines).toEqual([]);
  });
});

describe("commitHistory path filter", () => {
  let repo: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "code-viewer-pathlog-"));
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.email", "p@example.com"]);
    git(repo, ["config", "user.name", "p"]);
    writeFileSync(join(repo, "a.txt"), "one\n");
    git(repo, ["add", "a.txt"]);
    git(repo, ["commit", "-m", "add a"]);
    writeFileSync(join(repo, "b.txt"), "one\n");
    git(repo, ["add", "b.txt"]);
    git(repo, ["commit", "-m", "add b"]);
    writeFileSync(join(repo, "a.txt"), "two\n");
    git(repo, ["add", "a.txt"]);
    git(repo, ["commit", "-m", "edit a"]);
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  test("only returns commits that touched the given path", async () => {
    const res = await commitHistoryAsync(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 10,
      path: "a.txt",
    });
    expect(res.error).toBeUndefined();
    expect(res.commits.map((c) => c.subject)).toEqual(["edit a", "add a"]);
  });
});
