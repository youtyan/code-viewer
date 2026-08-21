import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  commitAuthorsAsync,
  commitHistoryAsync,
  fileRevisionNeighborsAsync,
  historyQueryArgs,
  parseHistoryDecorations,
  parseRemoteWebUrl,
} from "../server/git";

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

  test("returns newest-first commits with parents", async () => {
    const res = await commitHistoryAsync(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 10,
    });
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

  test("returns the commit body", async () => {
    writeFileSync(join(repo, "body.txt"), "body\n");
    git(repo, ["add", "body.txt"]);
    git(repo, [
      "commit",
      "-m",
      "subject line",
      "-m",
      "body first line\n\nbody second paragraph",
    ]);
    const res = await commitHistoryAsync(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 1,
    });
    expect(res.commits[0].subject).toBe("subject line");
    expect(res.commits[0].body).toBe(
      "body first line\n\nbody second paragraph",
    );
    git(repo, ["reset", "--hard", "HEAD^"]);
  });

  test("pages with skip and reports hasMore", async () => {
    const page1 = await commitHistoryAsync(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 2,
    });
    expect(page1.commits.map((c) => c.subject)).toEqual([
      "commit 4",
      "commit 3",
    ]);
    expect(page1.hasMore).toBe(true);
    const page3 = await commitHistoryAsync(repo, {
      ref: "HEAD",
      skip: 4,
      limit: 2,
    });
    expect(page3.commits.map((c) => c.subject)).toEqual(["commit 0"]);
    expect(page3.hasMore).toBe(false);
  });

  test("resolves a single sha as ref (deep-link fallback lookup)", async () => {
    const res = await commitHistoryAsync(repo, {
      ref: shas[1],
      skip: 0,
      limit: 1,
    });
    expect(res.commits[0].sha).toBe(shas[1]);
    expect(res.hasMore).toBe(true);
  });

  test("rejects unknown and unsafe refs", async () => {
    expect(
      (
        await commitHistoryAsync(repo, {
          ref: "no-such-ref",
          skip: 0,
          limit: 10,
        })
      ).error,
    ).toBeTruthy();
    expect(
      (await commitHistoryAsync(repo, { ref: "--all", skip: 0, limit: 10 }))
        .error,
    ).toBeTruthy();
  });

  test("clamps limit and skip", async () => {
    const res = await commitHistoryAsync(repo, {
      ref: "HEAD",
      skip: -5,
      limit: 100000,
    });
    expect(res.error).toBeUndefined();
    expect(res.commits.length).toBe(5);
  });

  test("filters by commit message", async () => {
    const res = await commitHistoryAsync(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 10,
      query: "COMMIT 2",
    });
    expect(res.error).toBeUndefined();
    expect(res.commits.map((c) => c.subject)).toEqual(["commit 2"]);
    expect(res.hasMore).toBe(false);
  });

  test("filters by sha prefix", async () => {
    const res = await commitHistoryAsync(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 10,
      query: shas[1].slice(0, 8),
    });
    expect(res.commits[0].sha).toBe(shas[1]);
  });

  test("filters by author prefix syntax", async () => {
    const hit = await commitHistoryAsync(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 10,
      query: "author:tester",
    });
    expect(hit.commits.length).toBe(5);
    const miss = await commitHistoryAsync(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 10,
      query: "author:nobody",
    });
    expect(miss.commits.length).toBe(0);
  });

  test("filters by touched path syntax", async () => {
    writeFileSync(join(repo, "special-name.txt"), "x\n");
    git(repo, ["add", "special-name.txt"]);
    git(repo, ["commit", "-m", "touch special file"]);
    const hit = await commitHistoryAsync(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 10,
      query: "path:special",
    });
    expect(hit.commits.map((c) => c.subject)).toEqual(["touch special file"]);
    const all = await commitHistoryAsync(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 10,
      query: "path:file.txt",
    });
    expect(all.commits.length).toBe(5);
    git(repo, ["reset", "--hard", "HEAD^"]);
  });

  test("pages filtered results with skip and hasMore", async () => {
    const page1 = await commitHistoryAsync(repo, {
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
    const page3 = await commitHistoryAsync(repo, {
      ref: "HEAD",
      skip: 4,
      limit: 2,
      query: "commit",
    });
    expect(page3.commits.map((c) => c.subject)).toEqual(["commit 0"]);
    expect(page3.hasMore).toBe(false);
  });

  test("combines different filter kinds with AND", async () => {
    const hit = await commitHistoryAsync(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 10,
      query: "commit author:tester",
    });
    expect(hit.commits.map((c) => c.subject)).toEqual([
      "commit 4",
      "commit 3",
      "commit 2",
      "commit 1",
      "commit 0",
    ]);
    const miss = await commitHistoryAsync(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 10,
      query: "commit author:nobody",
    });
    expect(miss.commits).toEqual([]);
  });

  test.each([
    {
      name: "since a day ago keeps everything",
      query: 'since:"1 day ago"',
      expected: 5,
    },
    {
      name: "until two days ago keeps nothing",
      query: 'until:"2 days ago"',
      expected: 0,
    },
  ])("$name", async ({ query, expected }) => {
    const res = await commitHistoryAsync(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 10,
      query,
    });
    expect(res.error).toBeUndefined();
    expect(res.commits.length).toBe(expected);
  });

  test("code:<text> finds the commits that added or removed that text", async () => {
    const res = await commitHistoryAsync(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 10,
      query: 'code:"content 3"',
    });
    expect(res.commits.map((c) => c.subject)).toEqual(["commit 4", "commit 3"]);
  });

  test("a query path: and a path filter share one pathspec list", async () => {
    const res = await commitHistoryAsync(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 10,
      query: "path:file",
      path: "file.txt",
    });
    expect(res.error).toBeUndefined();
    expect(res.commits.length).toBe(5);
  });

  test("lines: restricts the log to commits that changed those lines (git log -L)", async () => {
    const res = await commitHistoryAsync(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 10,
      path: "file.txt",
      lines: { start: 1, end: 1 },
    });
    expect(res.error).toBeUndefined();
    expect(res.commits.map((c) => c.subject)).toEqual([
      "commit 4",
      "commit 3",
      "commit 2",
      "commit 1",
      "commit 0",
    ]);
    const paged = await commitHistoryAsync(repo, {
      ref: "HEAD",
      skip: 3,
      limit: 1,
      path: "file.txt",
      lines: { start: 1, end: 1 },
    });
    expect(paged.commits.map((c) => c.subject)).toEqual(["commit 1"]);
    expect(paged.hasMore).toBe(true);
  });

  test.each([
    {
      name: "a middle revision has both neighbours",
      refIndex: 2,
      previousIndex: 1,
      nextIndex: 3,
    },
    {
      name: "the first revision has no older one",
      refIndex: 0,
      previousIndex: null,
      nextIndex: 1,
    },
    {
      name: "the tip has no newer one",
      refIndex: 4,
      previousIndex: 3,
      nextIndex: null,
    },
  ])("fileRevisionNeighborsAsync: $name", async ({
    refIndex,
    previousIndex,
    nextIndex,
  }) => {
    const res = await fileRevisionNeighborsAsync(repo, {
      path: "file.txt",
      ref: shas[refIndex],
    });
    expect(res.error).toBeUndefined();
    expect(res.previous).toBe(
      previousIndex === null ? null : shas[previousIndex],
    );
    expect(res.next).toBe(nextIndex === null ? null : shas[nextIndex]);
  });

  test("fileRevisionNeighborsAsync treats worktree as HEAD and rejects unknown refs", async () => {
    const res = await fileRevisionNeighborsAsync(repo, {
      path: "file.txt",
      ref: "worktree",
    });
    expect(res.previous).toBe(shas[3]);
    expect(res.next).toBeNull();
    const bad = await fileRevisionNeighborsAsync(repo, {
      path: "file.txt",
      ref: "no-such-ref",
    });
    expect(bad.error).toBeTruthy();
  });

  test("decorations arrive as structured refs", async () => {
    git(repo, ["tag", "v-sample"]);
    const res = await commitHistoryAsync(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 2,
    });
    expect(res.commits[0].refs).toEqual([
      { name: "main", kind: "branch", head: true },
      { name: "v-sample", kind: "tag" },
    ]);
    expect(res.commits[1].refs).toEqual([]);
  });

  // Mutates the repo (adds commits), so this must stay the last test.
  test("lists both parents for merge commits", async () => {
    git(repo, ["checkout", "-b", "topic", shas[3]]);
    writeFileSync(join(repo, "topic.txt"), "topic\n");
    git(repo, ["add", "topic.txt"]);
    git(repo, ["commit", "-m", "topic commit"]);
    const topicSha = git(repo, ["rev-parse", "HEAD"]).stdout.trim();
    git(repo, ["checkout", "main"]);
    git(repo, ["merge", "--no-ff", "-m", "merge topic", "topic"]);
    const res = await commitHistoryAsync(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 1,
    });
    expect(res.commits[0].subject).toBe("merge topic");
    expect(res.commits[0].parents).toEqual([shas[4], topicSha]);
  });

  test.each([
    {
      name: "merges:no hides the merge",
      query: "merges:no",
      subjects: ["topic commit", "commit 4"],
    },
    {
      name: "no-merges is the same",
      query: "no-merges",
      subjects: ["topic commit", "commit 4"],
    },
    {
      name: "merges:only keeps only merges",
      query: "merges:only",
      subjects: ["merge topic"],
    },
  ])("$name", async ({ query, subjects }) => {
    const res = await commitHistoryAsync(repo, {
      ref: "HEAD",
      skip: 0,
      limit: 2,
      query,
    });
    // The topic and main tips share a commit timestamp, so their relative
    // order is not stable; compare as a set.
    expect(res.commits.map((c) => c.subject).sort()).toEqual(
      [...subjects].sort(),
    );
  });

  test("commitAuthorsAsync lists distinct authors with commit counts", async () => {
    const res = await commitAuthorsAsync(repo, "HEAD");
    expect(res.error).toBeUndefined();
    expect(res.authors).toEqual([{ name: "tester", count: 7 }]);
    const bad = await commitAuthorsAsync(repo, "no-such-ref");
    expect(bad.authors).toEqual([]);
    expect(bad.error).toBeTruthy();
  });
});

describe("historyQueryArgs", () => {
  test.each([
    { name: "empty", query: "", filterArgs: [], pathspec: [], shaTerm: "" },
    {
      name: "message phrase",
      query: "fix bug",
      filterArgs: ["--regexp-ignore-case", "--fixed-strings", "--grep=fix bug"],
      pathspec: [],
      shaTerm: "",
    },
    {
      name: "lone hex word also becomes a sha term",
      query: "abc123",
      filterArgs: ["--regexp-ignore-case", "--fixed-strings", "--grep=abc123"],
      pathspec: [],
      shaTerm: "abc123",
    },
    {
      name: "author only",
      query: "author:alice",
      filterArgs: ["--regexp-ignore-case", "--fixed-strings", "--author=alice"],
      pathspec: [],
      shaTerm: "",
    },
    {
      name: "path only needs no text flags",
      query: "path:src",
      filterArgs: [],
      pathspec: [":(icase)*src*"],
      shaTerm: "",
    },
    {
      name: "dates, pickaxe and merges",
      query: "since:2024-01-01 until:2024-02-01 code:handler merges:no",
      filterArgs: [
        "--since=2024-01-01",
        "--until=2024-02-01",
        "-Shandler",
        "--no-merges",
      ],
      pathspec: [],
      shaTerm: "",
    },
    {
      name: "everything together",
      query: "fix author:alice path:src merges:only",
      filterArgs: [
        "--regexp-ignore-case",
        "--fixed-strings",
        "--author=alice",
        "--merges",
        "--grep=fix",
      ],
      pathspec: [":(icase)*src*"],
      shaTerm: "",
    },
  ])("$name", ({ query, filterArgs, pathspec, shaTerm }) => {
    expect(historyQueryArgs(query)).toEqual({ filterArgs, pathspec, shaTerm });
  });
});

describe("parseHistoryDecorations", () => {
  test.each([
    { name: "empty", raw: "", expected: [] },
    {
      name: "checked-out branch plus remote and tag",
      raw: "HEAD -> main, origin/main, tag: v1.2.0",
      expected: [
        { name: "main", kind: "branch", head: true },
        { name: "origin/main", kind: "branch" },
        { name: "v1.2.0", kind: "tag" },
      ],
    },
    {
      name: "detached HEAD",
      raw: "HEAD, tag: v2",
      expected: [
        { name: "HEAD", kind: "head" },
        { name: "v2", kind: "tag" },
      ],
    },
  ])("$name", ({ raw, expected }) => {
    expect(parseHistoryDecorations(raw)).toEqual(expected);
  });
});

describe("remoteWebUrl", () => {
  test("converts ssh shorthand remotes to https", async () => {
    expect(parseRemoteWebUrl("git@github.com:youtyan/code-viewer.git")).toBe(
      "https://github.com/youtyan/code-viewer",
    );
  });

  test("strips .git from https remotes", async () => {
    expect(
      parseRemoteWebUrl("https://github.com/youtyan/code-viewer.git"),
    ).toBe("https://github.com/youtyan/code-viewer");
    expect(parseRemoteWebUrl("https://github.com/youtyan/code-viewer")).toBe(
      "https://github.com/youtyan/code-viewer",
    );
  });

  test("converts ssh:// remotes", async () => {
    expect(
      parseRemoteWebUrl("ssh://git@github.com/youtyan/code-viewer.git"),
    ).toBe("https://github.com/youtyan/code-viewer");
  });

  test("returns null for unusable remotes", async () => {
    expect(parseRemoteWebUrl("")).toBeNull();
    expect(parseRemoteWebUrl("/local/path/repo.git")).toBeNull();
    expect(parseRemoteWebUrl("file:///tmp/repo.git")).toBeNull();
  });
});
