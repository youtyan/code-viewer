import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitHistory } from "../server/git";

function git(cwd: string, args: string[]) {
  const proc = spawnSync("git", args, { cwd, encoding: "utf8" });
  expect(proc.status).toBe(0);
  return proc;
}

describe("commitHistory", () => {
  let repo: string;
  const shas: string[] = []; // oldest first

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "code-viewer-history-"));
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "tester"]);
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(repo, "file.txt"), `content ${i}\n`);
      git(repo, ["add", "file.txt"]);
      git(repo, ["commit", "-m", `commit ${i}`]);
      shas.push(git(repo, ["rev-parse", "HEAD"]).stdout.trim());
    }
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  test("returns newest-first commits with parents", () => {
    const res = commitHistory(repo, { ref: "HEAD", skip: 0, limit: 10 });
    expect(res.error).toBeUndefined();
    expect(res.commits.map((c) => c.sha)).toEqual([...shas].reverse());
    expect(res.hasMore).toBe(false);
    expect(res.commits[0].subject).toBe("commit 4");
    expect(res.commits[0].parents).toEqual([shas[3]]);
    expect(res.commits[4].parents).toEqual([]); // root commit
    expect(res.commits[0].author).toBe("tester");
    expect(res.commits[0].when).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(res.commits[0].body).toBe("");
  });

  test("returns the commit body", () => {
    writeFileSync(join(repo, "body.txt"), "body\n");
    git(repo, ["add", "body.txt"]);
    git(repo, [
      "commit",
      "-m",
      "subject line",
      "-m",
      "body first line\n\nbody second paragraph",
    ]);
    const res = commitHistory(repo, { ref: "HEAD", skip: 0, limit: 1 });
    expect(res.commits[0].subject).toBe("subject line");
    expect(res.commits[0].body).toBe(
      "body first line\n\nbody second paragraph",
    );
    git(repo, ["reset", "--hard", "HEAD^"]);
  });

  test("pages with skip and reports hasMore", () => {
    const page1 = commitHistory(repo, { ref: "HEAD", skip: 0, limit: 2 });
    expect(page1.commits.map((c) => c.subject)).toEqual([
      "commit 4",
      "commit 3",
    ]);
    expect(page1.hasMore).toBe(true);
    const page3 = commitHistory(repo, { ref: "HEAD", skip: 4, limit: 2 });
    expect(page3.commits.map((c) => c.subject)).toEqual(["commit 0"]);
    expect(page3.hasMore).toBe(false);
  });

  test("resolves a single sha as ref (deep-link fallback lookup)", () => {
    const res = commitHistory(repo, { ref: shas[1], skip: 0, limit: 1 });
    expect(res.commits[0].sha).toBe(shas[1]);
    expect(res.hasMore).toBe(true);
  });

  test("rejects unknown and unsafe refs", () => {
    expect(
      commitHistory(repo, { ref: "no-such-ref", skip: 0, limit: 10 }).error,
    ).toBeTruthy();
    expect(
      commitHistory(repo, { ref: "--all", skip: 0, limit: 10 }).error,
    ).toBeTruthy();
  });

  test("clamps limit and skip", () => {
    const res = commitHistory(repo, { ref: "HEAD", skip: -5, limit: 100000 });
    expect(res.error).toBeUndefined();
    expect(res.commits.length).toBe(5);
  });

  // Mutates the repo (adds commits), so this must stay the last test.
  test("lists both parents for merge commits", () => {
    git(repo, ["checkout", "-b", "topic", shas[3]]);
    writeFileSync(join(repo, "topic.txt"), "topic\n");
    git(repo, ["add", "topic.txt"]);
    git(repo, ["commit", "-m", "topic commit"]);
    const topicSha = git(repo, ["rev-parse", "HEAD"]).stdout.trim();
    git(repo, ["checkout", "main"]);
    git(repo, ["merge", "--no-ff", "-m", "merge topic", "topic"]);
    const res = commitHistory(repo, { ref: "HEAD", skip: 0, limit: 1 });
    expect(res.commits[0].subject).toBe("merge topic");
    expect(res.commits[0].parents).toEqual([shas[4], topicSha]);
  });
});
