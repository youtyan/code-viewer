import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CACHE_TTL_MS } from "../server/cache";
import {
  type GitTreeEntry,
  gitSymlinkTargetMetadataAsync,
  listTreeAsync,
  repoStatusMapAsync,
  resolveSymlinkPath,
} from "../server/git";
import { runGit } from "./_git-fixture";

function initGitIdentity(dir: string) {
  runGit(dir, ["init"]);
  runGit(dir, ["config", "user.email", "test@example.com"]);
  runGit(dir, ["config", "user.name", "Test"]);
}

describe("resolveSymlinkPath", () => {
  test.each([
    {
      name: "same-directory relative target",
      linkPath: "link.txt",
      target: "real.txt",
      expected: "real.txt",
    },
    {
      name: "nested link pointing at a sibling",
      linkPath: "a/link.txt",
      target: "real.txt",
      expected: "a/real.txt",
    },
    {
      name: "nested link pointing into a subdirectory",
      linkPath: "link.txt",
      target: "sub/real.txt",
      expected: "sub/real.txt",
    },
    {
      name: "one level up (still inside the repo)",
      linkPath: "a/b/link.txt",
      target: "../real.txt",
      expected: "a/real.txt",
    },
    {
      name: "boundary: '..' resolves to the repo root",
      linkPath: "a/link.txt",
      target: "..",
      expected: "",
    },
    {
      name: "boundary: one level above the repo root escapes",
      linkPath: "link.txt",
      target: "../outside.txt",
      expected: null,
    },
    {
      name: "boundary: two levels above the repo root escapes",
      linkPath: "a/link.txt",
      target: "../../outside.txt",
      expected: null,
    },
    {
      name: "absolute target is rejected",
      linkPath: "a/link.txt",
      target: "/etc/passwd",
      expected: null,
    },
    {
      name: "empty target is rejected",
      linkPath: "a/link.txt",
      target: "",
      expected: null,
    },
  ])("$name", ({ linkPath, target, expected }) => {
    expect(resolveSymlinkPath(linkPath, target)).toBe(expected);
  });
});

describe("worktree symlink detection via listTreeAsync", () => {
  let dir: string;
  let entries: GitTreeEntry[];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "code-viewer-symlink-worktree-"));
    writeFileSync(join(dir, "real.txt"), "hello\n");
    mkdirSync(join(dir, "real-dir"));
    writeFileSync(join(dir, "real-dir", "inner.txt"), "inner\n");
    symlinkSync("real.txt", join(dir, "link-to-file.txt"));
    symlinkSync("real-dir", join(dir, "link-to-dir"));
    symlinkSync("does-not-exist.txt", join(dir, "link-broken"));
    const result = await listTreeAsync("worktree", "", dir);
    entries = result.entries;
  });

  afterAll(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  test("a symlink to a file resolves is_symlink with type blob", () => {
    const entry = entries.find((e) => e.name === "link-to-file.txt");
    expect(entry?.is_symlink).toBe(true);
    expect(entry?.type).toBe("blob");
    expect(entry?.symlink_target).toBe("real.txt");
    expect(entry?.symlink_target_type).toBe("blob");
  });

  test("a symlink to a directory resolves is_symlink with type tree", () => {
    const entry = entries.find((e) => e.name === "link-to-dir");
    expect(entry?.is_symlink).toBe(true);
    expect(entry?.type).toBe("tree");
    expect(entry?.symlink_target).toBe("real-dir");
    expect(entry?.symlink_target_type).toBe("tree");
  });

  test("a broken symlink resolves is_symlink with target_type missing", () => {
    const entry = entries.find((e) => e.name === "link-broken");
    expect(entry?.is_symlink).toBe(true);
    expect(entry?.type).toBe("blob");
    expect(entry?.symlink_target).toBe("does-not-exist.txt");
    expect(entry?.symlink_target_type).toBe("missing");
  });

  test("a regular file is not flagged as a symlink", () => {
    const entry = entries.find((e) => e.name === "real.txt");
    expect(entry?.is_symlink).toBeUndefined();
    expect(entry?.type).toBe("blob");
  });

  test("a regular directory is not flagged as a symlink", () => {
    const entry = entries.find((e) => e.name === "real-dir");
    expect(entry?.is_symlink).toBeUndefined();
    expect(entry?.type).toBe("tree");
  });
});

describe("worktree symlink detection via listTreeAsync recursive (search/flat listing)", () => {
  let dir: string;
  let entries: GitTreeEntry[];

  beforeAll(async () => {
    dir = mkdtempSync(
      join(tmpdir(), "code-viewer-symlink-worktree-recursive-"),
    );
    writeFileSync(join(dir, "real.txt"), "hello\n");
    mkdirSync(join(dir, "nested"));
    writeFileSync(join(dir, "nested", "real.txt"), "hello\n");
    symlinkSync("real.txt", join(dir, "nested", "link-to-file.txt"));
    symlinkSync("does-not-exist.txt", join(dir, "nested", "link-broken.txt"));
    const result = await listTreeAsync("worktree", "", dir, {
      recursive: true,
    });
    entries = result.entries;
  });

  afterAll(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  test("a nested symlink to a file keeps is_symlink and target metadata in the recursive listing", () => {
    const entry = entries.find((e) => e.path === "nested/link-to-file.txt");
    expect(entry?.is_symlink).toBe(true);
    expect(entry?.type).toBe("blob");
    expect(entry?.symlink_target).toBe("real.txt");
    expect(entry?.symlink_target_type).toBe("blob");
  });

  test("a nested broken symlink is flagged missing in the recursive listing", () => {
    const entry = entries.find((e) => e.path === "nested/link-broken.txt");
    expect(entry?.is_symlink).toBe(true);
    expect(entry?.symlink_target).toBe("does-not-exist.txt");
    expect(entry?.symlink_target_type).toBe("missing");
  });

  test("a nested regular file is not flagged as a symlink in the recursive listing", () => {
    const entry = entries.find((e) => e.path === "nested/real.txt");
    expect(entry?.is_symlink).toBeUndefined();
    expect(entry?.type).toBe("blob");
  });
});

describe("worktree symlink containment (security)", () => {
  let repoDir: string;
  let outsideDir: string;

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "code-viewer-symlink-repo-"));
    outsideDir = mkdtempSync(join(tmpdir(), "code-viewer-symlink-outside-"));
    writeFileSync(join(outsideDir, "secret.txt"), "top secret\n");
    symlinkSync(outsideDir, join(repoDir, "link-outside"));
  });

  afterAll(() => {
    rmSync(repoDir, { force: true, recursive: true });
    rmSync(outsideDir, { force: true, recursive: true });
  });

  test("a symlink pointing outside the repo resolves to symlink_target_type missing, not browsable", async () => {
    const result = await listTreeAsync("worktree", "", repoDir);
    const entry = result.entries.find((e) => e.name === "link-outside");
    expect(entry?.is_symlink).toBe(true);
    expect(entry?.type).toBe("blob");
    expect(entry?.symlink_target_type).toBe("missing");
  });

  test("listing a path that resolves through an outside-escaping symlink returns no entries, even when requested directly", async () => {
    const result = await listTreeAsync("worktree", "link-outside", repoDir);
    expect(result.entries).toEqual([]);
  });
});

describe("committed-ref symlink detection via ls-tree mode 120000", () => {
  let dir: string;
  let entries: GitTreeEntry[];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "code-viewer-symlink-committed-"));
    initGitIdentity(dir);
    writeFileSync(join(dir, "real.txt"), "hello\n");
    mkdirSync(join(dir, "real-dir"));
    writeFileSync(join(dir, "real-dir", "inner.txt"), "inner\n");
    symlinkSync("real.txt", join(dir, "link-to-file.txt"));
    symlinkSync("real-dir", join(dir, "link-to-dir"));
    symlinkSync("missing-target.txt", join(dir, "link-broken"));
    runGit(dir, ["add", "-A"]);
    runGit(dir, ["commit", "-m", "initial"]);
    const result = await listTreeAsync("HEAD", "", dir);
    entries = result.entries;
  });

  afterAll(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  test.each([
    { name: "link-to-file.txt" },
    { name: "link-to-dir" },
    { name: "link-broken" },
  ])("$name is flagged is_symlink from ls-tree mode 120000", ({ name }) => {
    const entry = entries.find((e) => e.name === name);
    expect(entry?.is_symlink).toBe(true);
    // Committed-ref listing does not resolve the target - only the
    // preview.ts HTTP layer promotes type/target via
    // gitSymlinkTargetMetadataAsync (see the describe block below).
    expect(entry?.type).toBe("blob");
  });

  test("a regular committed file is not flagged as a symlink", () => {
    const entry = entries.find((e) => e.name === "real.txt");
    expect(entry?.is_symlink).toBeUndefined();
  });

  test("a regular committed directory is not flagged as a symlink", () => {
    const entry = entries.find((e) => e.name === "real-dir");
    expect(entry?.is_symlink).toBeUndefined();
    expect(entry?.type).toBe("tree");
  });
});

describe("gitSymlinkTargetMetadataAsync resolves committed-ref symlink targets", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "code-viewer-symlink-target-"));
    initGitIdentity(dir);
    writeFileSync(join(dir, "real.txt"), "hello\n");
    mkdirSync(join(dir, "real-dir"));
    writeFileSync(join(dir, "real-dir", "inner.txt"), "inner\n");
    symlinkSync("real.txt", join(dir, "link-to-file.txt"));
    symlinkSync("real-dir", join(dir, "link-to-dir"));
    symlinkSync("missing-target.txt", join(dir, "link-broken"));
    runGit(dir, ["add", "-A"]);
    runGit(dir, ["commit", "-m", "initial"]);
  });

  afterAll(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  test.each([
    {
      path: "link-to-file.txt",
      expectedTarget: "real.txt",
      expectedType: "blob",
      expectedResolvedPath: "real.txt",
    },
    {
      path: "link-to-dir",
      expectedTarget: "real-dir",
      expectedType: "tree",
      expectedResolvedPath: "real-dir",
    },
    {
      path: "link-broken",
      expectedTarget: "missing-target.txt",
      expectedType: "missing",
      expectedResolvedPath: undefined,
    },
  ])("$path resolves to symlink_target_type $expectedType", async ({
    path,
    expectedTarget,
    expectedType,
    expectedResolvedPath,
  }) => {
    const meta = await gitSymlinkTargetMetadataAsync("HEAD", path, dir);
    expect(meta.symlink_target).toBe(expectedTarget);
    expect(meta.symlink_target_type).toBe(expectedType);
    expect(meta.resolved_path).toBe(expectedResolvedPath);
  });

  test("navigating a committed-ref directory symlink via resolved_path lists the real target contents", async () => {
    const meta = await gitSymlinkTargetMetadataAsync(
      "HEAD",
      "link-to-dir",
      dir,
    );
    if (!meta.resolved_path) throw new Error("expected a resolved_path");
    const result = await listTreeAsync("HEAD", meta.resolved_path, dir);
    expect(result.entries.map((e) => e.path)).toEqual(["real-dir/inner.txt"]);
  });

  test("navigating the symlink's own path directly (without resolved_path) sees nothing, since git ls-tree cannot resolve a symlink as a directory", async () => {
    const result = await listTreeAsync("HEAD", "link-to-dir", dir);
    expect(result.entries).toEqual([]);
  });
});

describe("repoStatusMapAsync", () => {
  let dir: string;
  let statusMap: Map<string, string>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "code-viewer-repo-status-map-"));
    initGitIdentity(dir);
    writeFileSync(join(dir, "tracked.txt"), "original\n");
    writeFileSync(join(dir, "to-delete.txt"), "bye\n");
    writeFileSync(join(dir, "to-rename.txt"), "rename me\n");
    writeFileSync(join(dir, "untouched.txt"), "same forever\n");
    runGit(dir, ["add", "-A"]);
    runGit(dir, ["commit", "-m", "initial"]);

    writeFileSync(join(dir, "tracked.txt"), "changed\n");
    rmSync(join(dir, "to-delete.txt"));
    runGit(dir, ["mv", "to-rename.txt", "renamed.txt"]);
    writeFileSync(join(dir, "untracked.txt"), "new\n");
    // A brand-new directory: git collapses this to a single `?? new-dir/`
    // record under --untracked-files=normal, which would leave individual
    // files in it un-badged in the tree explorer.
    mkdirSync(join(dir, "new-dir"));
    writeFileSync(join(dir, "new-dir", "inside.txt"), "nested new file\n");

    statusMap = await repoStatusMapAsync(dir);
  });

  afterAll(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  test.each([
    { path: "tracked.txt", expectedStatus: "M" },
    { path: "to-delete.txt", expectedStatus: "D" },
    { path: "renamed.txt", expectedStatus: "R" },
    { path: "untracked.txt", expectedStatus: "A" },
    { path: "new-dir/inside.txt", expectedStatus: "A" },
  ])("status for $path is $expectedStatus", ({ path, expectedStatus }) => {
    expect(statusMap.get(path)).toBe(expectedStatus);
  });

  test("an unchanged tracked file has no status entry", () => {
    expect(statusMap.has("untouched.txt")).toBe(false);
  });

  test("the old path of a rename is not reported as its own entry", () => {
    expect(statusMap.has("to-rename.txt")).toBe(false);
  });
});

describe("repoStatusMapAsync caching", () => {
  test("a status change made right after a call is not visible until the short TTL cache expires", async () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-repo-status-cache-"));
    try {
      initGitIdentity(dir);
      writeFileSync(join(dir, "tracked.txt"), "original\n");
      runGit(dir, ["add", "-A"]);
      runGit(dir, ["commit", "-m", "initial"]);

      const t0 = 1_700_000_000_000;
      const beforeChange = await repoStatusMapAsync(dir, t0);
      expect(beforeChange.has("tracked.txt")).toBe(false);

      writeFileSync(join(dir, "tracked.txt"), "changed\n");
      const staleAfterChange = await repoStatusMapAsync(
        dir,
        t0 + CACHE_TTL_MS - 1,
      );
      expect(staleAfterChange.has("tracked.txt")).toBe(false);

      const freshAfterTtl = await repoStatusMapAsync(
        dir,
        t0 + CACHE_TTL_MS + 1,
      );
      expect(freshAfterTtl.get("tracked.txt")).toBe("M");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("two different repos never share a cached status map", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "code-viewer-repo-status-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "code-viewer-repo-status-b-"));
    try {
      initGitIdentity(dirA);
      writeFileSync(join(dirA, "only-in-a.txt"), "a\n");
      runGit(dirA, ["add", "-A"]);
      runGit(dirA, ["commit", "-m", "initial"]);
      writeFileSync(join(dirA, "only-in-a.txt"), "a changed\n");

      initGitIdentity(dirB);
      writeFileSync(join(dirB, "only-in-b.txt"), "b\n");
      runGit(dirB, ["add", "-A"]);
      runGit(dirB, ["commit", "-m", "initial"]);

      const statusA = await repoStatusMapAsync(dirA);
      const statusB = await repoStatusMapAsync(dirB);
      expect(statusA.get("only-in-a.txt")).toBe("M");
      expect(statusB.has("only-in-a.txt")).toBe(false);
      expect(statusB.has("only-in-b.txt")).toBe(false);
    } finally {
      rmSync(dirA, { force: true, recursive: true });
      rmSync(dirB, { force: true, recursive: true });
    }
  });
});
