import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitHistory, parseRemoteWebUrl } from "../server/git";

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

  test("filters by commit message", () => {
    const res = commitHistory(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 10,
      query: "COMMIT 2",
    });
    expect(res.error).toBeUndefined();
    expect(res.commits.map((c) => c.subject)).toEqual(["commit 2"]);
    expect(res.hasMore).toBe(false);
  });

  test("filters by sha prefix", () => {
    const res = commitHistory(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 10,
      query: shas[1].slice(0, 8),
    });
    expect(res.commits[0].sha).toBe(shas[1]);
  });

  test("filters by author prefix syntax", () => {
    const hit = commitHistory(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 10,
      query: "author:tester",
    });
    expect(hit.commits.length).toBe(5);
    const miss = commitHistory(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 10,
      query: "author:nobody",
    });
    expect(miss.commits.length).toBe(0);
  });

  test("filters by touched path syntax", () => {
    writeFileSync(join(repo, "special-name.txt"), "x\n");
    git(repo, ["add", "special-name.txt"]);
    git(repo, ["commit", "-m", "touch special file"]);
    const hit = commitHistory(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 10,
      query: "path:special",
    });
    expect(hit.commits.map((c) => c.subject)).toEqual(["touch special file"]);
    const all = commitHistory(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 10,
      query: "path:file.txt",
    });
    expect(all.commits.length).toBe(5);
    git(repo, ["reset", "--hard", "HEAD^"]);
  });

  test("pages filtered results with skip and hasMore", () => {
    const page1 = commitHistory(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 2,
      query: "commit",
    });
    expect(page1.commits.map((c) => c.subject)).toEqual([
      "commit 4",
      "commit 3",
    ]);
    expect(page1.hasMore).toBe(true);
    const page3 = commitHistory(repo, {
      ref: "HEAD",
      skip: 4,
      limit: 2,
      query: "commit",
    });
    expect(page3.commits.map((c) => c.subject)).toEqual(["commit 0"]);
    expect(page3.hasMore).toBe(false);
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

describe("remoteWebUrl", () => {
  test("converts ssh shorthand remotes to https", () => {
    expect(parseRemoteWebUrl("git@github.com:youtyan/code-viewer.git")).toBe(
      "https://github.com/youtyan/code-viewer",
    );
  });

  test("strips .git from https remotes", () => {
    expect(
      parseRemoteWebUrl("https://github.com/youtyan/code-viewer.git"),
    ).toBe("https://github.com/youtyan/code-viewer");
    expect(parseRemoteWebUrl("https://github.com/youtyan/code-viewer")).toBe(
      "https://github.com/youtyan/code-viewer",
    );
  });

  test("converts ssh:// remotes", () => {
    expect(
      parseRemoteWebUrl("ssh://git@github.com/youtyan/code-viewer.git"),
    ).toBe("https://github.com/youtyan/code-viewer");
  });

  test("returns null for unusable remotes", () => {
    expect(parseRemoteWebUrl("")).toBeNull();
    expect(parseRemoteWebUrl("/local/path/repo.git")).toBeNull();
    expect(parseRemoteWebUrl("file:///tmp/repo.git")).toBeNull();
  });
});
