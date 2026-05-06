import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileDiffCacheKey, worktreeFileSignature } from "../server/cache";
import {
  listTree,
  refCommits,
  refs,
  treeEntries,
  truncateToNHunks,
  verifyTreeRef,
  worktreeEntries,
} from "../server/git";
import { sourceFixture } from "./source-fixture";

function git(cwd: string, args: string[]) {
  const proc = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });
  expect(proc.status).toBe(0);
  return proc;
}

describe("truncateToNHunks", () => {
  test("preserves newlines between rendered hunks", () => {
    const diff = [
      "diff --git a/file.ts b/file.ts",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,2 +1,2 @@",
      " line one",
      "-old one",
      "+new one",
      "@@ -10,2 +10,2 @@",
      " line ten",
      "-old ten",
      "+new ten",
      "",
    ].join("\n");

    const result = truncateToNHunks(diff, 2).text;

    expect(result.includes("+new one\n@@ -10,2 +10,2 @@")).toBe(true);
    expect(result.includes("+new one@@ -10,2 +10,2 @@")).toBe(false);
  });

  test("caps preview output by line count even when a single hunk is huge", () => {
    const diff = [
      "diff --git a/generated.js b/generated.js",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/generated.js",
      "@@ -0,0 +1,5000 @@",
      ...Array.from({ length: 5000 }, (_, index) => `+line ${index}`),
      "",
    ].join("\n");

    const result = truncateToNHunks(diff, 3, 100);

    expect(result.lineTruncated).toBe(true);
    expect(result.renderedHunks).toBe(1);
    expect(result.lineCount <= 100).toBe(true);
    expect(result.text.includes("+line 4999")).toBe(false);
  });

  test("counts inserted separators when capping multi-hunk preview lines", () => {
    const hunk = (offset: number) =>
      [
        `@@ -${offset},4 +${offset},4 @@`,
        ` context ${offset}`,
        `-old ${offset}`,
        `+new ${offset}`,
        ` tail ${offset}`,
      ].join("\n");
    const diff = [
      "diff --git a/file.ts b/file.ts",
      "--- a/file.ts",
      "+++ b/file.ts",
      hunk(1),
      hunk(20),
      hunk(40),
      "",
    ].join("\n");

    const result = truncateToNHunks(diff, 3, 14);

    expect(result.lineTruncated).toBe(true);
    expect(result.lineCount <= 14).toBe(true);
    expect(result.text.includes("@@ -40,4 +40,4 @@")).toBe(false);
  });

  test("server preview keeps medium and large files eligible for split layout", () => {
    const server = sourceFixture(
      readFileSync("web-src/server/preview.ts", "utf8"),
    );

    expect(server.includes("const previewUrl = sizeClass !== 'small'")).toBe(
      true,
    );
    expect(
      server.includes(
        "force_layout: sizeClass === 'huge' ? 'line-by-line' : undefined",
      ),
    ).toBe(true);
    expect(
      server.includes(
        "force_layout: sizeClass === 'large' || sizeClass === 'huge'",
      ),
    ).toBe(false);
    expect(server.includes("force_layout: sizeClass !== 'small'")).toBe(false);
  });

  test("untracked diff cache is keyed by the current worktree file signature", () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-untracked-cache-key-"));
    try {
      writeFileSync(join(dir, "main.tf"), "");
      const empty = fileDiffCacheKey({
        path: "main.tf",
        isUntracked: true,
        range: { from: "HEAD", to: "worktree" },
        extras: [],
        args: ["HEAD"],
        cwd: dir,
      });

      writeFileSync(
        join(dir, "main.tf"),
        'terraform {\n  required_version = ">= 1.6.0"\n}\n',
      );
      const edited = fileDiffCacheKey({
        path: "main.tf",
        isUntracked: true,
        range: { from: "HEAD", to: "worktree" },
        extras: [],
        args: ["HEAD"],
        cwd: dir,
      });

      expect(empty === edited).toBe(false);
      expect(edited.startsWith("u\u0000main.tf\u0000state:file|")).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("tracked worktree diff cache is keyed by the current worktree file signature", () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-tracked-cache-key-"));
    try {
      writeFileSync(join(dir, "main.tf"), "terraform {}\n");
      const original = fileDiffCacheKey({
        path: "main.tf",
        isUntracked: false,
        range: { from: "HEAD", to: "worktree" },
        extras: [],
        args: ["HEAD"],
        cwd: dir,
      });

      writeFileSync(
        join(dir, "main.tf"),
        'terraform {\n  required_version = ">= 1.6.0"\n}\n',
      );
      const edited = fileDiffCacheKey({
        path: "main.tf",
        isUntracked: false,
        range: { from: "HEAD", to: "worktree" },
        extras: [],
        args: ["HEAD"],
        cwd: dir,
      });

      expect(original === edited).toBe(false);
      expect(edited.startsWith("t\u0000main.tf\u0000\u0000state:file|")).toBe(
        true,
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("reverse worktree diff cache is keyed by the current worktree file signature", () => {
    const dir = mkdtempSync(
      join(tmpdir(), "code-viewer-reverse-worktree-cache-key-"),
    );
    try {
      writeFileSync(join(dir, "main.tf"), "terraform {}\n");
      const original = fileDiffCacheKey({
        path: "main.tf",
        isUntracked: false,
        range: { from: "worktree", to: "HEAD" },
        extras: [],
        args: ["HEAD"],
        cwd: dir,
      });

      writeFileSync(
        join(dir, "main.tf"),
        'terraform {\n  required_version = ">= 1.6.0"\n}\n',
      );
      const edited = fileDiffCacheKey({
        path: "main.tf",
        isUntracked: false,
        range: { from: "worktree", to: "HEAD" },
        extras: [],
        args: ["HEAD"],
        cwd: dir,
      });

      expect(original === edited).toBe(false);
      expect(edited.startsWith("t\u0000main.tf\u0000\u0000state:file|")).toBe(
        true,
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("commit-to-commit diff cache omits worktree file signatures", () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-ref-cache-key-"));
    try {
      writeFileSync(join(dir, "main.tf"), "terraform {}\n");
      const original = fileDiffCacheKey({
        path: "main.tf",
        isUntracked: false,
        range: { from: "HEAD~1", to: "HEAD" },
        extras: [],
        args: ["HEAD~1", "HEAD"],
        cwd: dir,
      });

      writeFileSync(
        join(dir, "main.tf"),
        'terraform {\n  required_version = ">= 1.6.0"\n}\n',
      );
      const edited = fileDiffCacheKey({
        path: "main.tf",
        isUntracked: false,
        range: { from: "HEAD~1", to: "HEAD" },
        extras: [],
        args: ["HEAD~1", "HEAD"],
        cwd: dir,
      });

      expect(original).toBe(edited);
      expect(edited.includes("state:file|")).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe("repository tree helpers", () => {
  test("worktree file signature changes when an untracked file is edited", () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-file-signature-"));
    try {
      writeFileSync(join(dir, "main.tf"), "");
      const empty = worktreeFileSignature("main.tf", dir);

      writeFileSync(
        join(dir, "main.tf"),
        'terraform {\n  required_version = ">= 1.6.0"\n}\n',
      );
      const edited = worktreeFileSignature("main.tf", dir);

      expect(empty === edited).toBe(false);
      expect(edited.startsWith("state:file|size:")).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("lists only direct worktree children", () => {
    const entries = worktreeEntries(process.cwd(), "");
    expect(
      entries.some(
        (entry) => entry.path === "web-src" && entry.type === "tree",
      ),
    ).toBe(true);
    expect(entries.some((entry) => entry.path === "web-src/app.ts")).toBe(
      false,
    );
  });

  test("caps the initial commit list in the ref picker data", () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-refs-"));
    try {
      git(dir, ["init"]);
      git(dir, ["config", "user.email", "tester@example.com"]);
      git(dir, ["config", "user.name", "Test User"]);
      for (let index = 1; index <= 105; index++) {
        writeFileSync(join(dir, "file.txt"), `commit ${index}\n`);
        git(dir, ["add", "file.txt"]);
        git(dir, ["commit", "-m", `commit ${index}`]);
      }

      const result = refs(dir);

      expect(result.commits.length).toBe(100);
      expect(result.commits[0].subject).toBe("commit 105");
      expect(
        result.commits.some((commit) => commit.subject === "commit 1"),
      ).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("returns branch metadata without remote HEAD aliases", () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-ref-branches-"));
    try {
      git(dir, ["init"]);
      git(dir, ["config", "user.email", "tester@example.com"]);
      git(dir, ["config", "user.name", "Test User"]);
      writeFileSync(join(dir, "file.txt"), "main\n");
      git(dir, ["add", "file.txt"]);
      git(dir, ["commit", "-m", "main commit"]);
      git(dir, ["branch", "feature"]);
      git(dir, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
      git(dir, [
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
        "refs/remotes/origin/main",
      ]);
      git(dir, ["update-ref", "refs/remotes/upstream/main", "HEAD"]);
      git(dir, [
        "symbolic-ref",
        "refs/remotes/upstream/HEAD",
        "refs/remotes/upstream/main",
      ]);

      const result = refs(dir);

      expect(result.branches.some((branch) => branch.name === "origin")).toBe(
        false,
      );
      expect(result.branches.some((branch) => branch.name === "upstream")).toBe(
        false,
      );
      expect(
        result.branches.some((branch) => branch.name === "origin/main"),
      ).toBe(true);
      expect(
        result.branches.some((branch) => branch.name === "upstream/main"),
      ).toBe(true);
      expect(result.branches.every((branch) => branch.when)).toBe(true);
      expect(
        result.branches.every((branch) =>
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(branch.when),
        ),
      ).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("returns tag metadata for the ref picker", () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-ref-tags-"));
    try {
      git(dir, ["init"]);
      git(dir, ["config", "user.email", "tester@example.com"]);
      git(dir, ["config", "user.name", "Test User"]);
      writeFileSync(join(dir, "file.txt"), "tagged\n");
      git(dir, ["add", "file.txt"]);
      git(dir, ["commit", "-m", "tagged commit"]);
      git(dir, ["tag", "v1.0.0"]);
      git(dir, ["tag", "-a", "v1.1.0", "-m", "annotated tag"]);

      const result = refs(dir);
      const lightTag = result.tags.find((item) => item.name === "v1.0.0");
      const annotatedTag = result.tags.find((item) => item.name === "v1.1.0");

      expect(Boolean(lightTag)).toBe(true);
      expect(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(lightTag?.when || ""),
      ).toBe(true);
      expect(Boolean(annotatedTag)).toBe(true);
      expect(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(annotatedTag?.when || ""),
      ).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("searches commits server-side beyond the initial visible window", () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-ref-commit-search-"));
    try {
      git(dir, ["init"]);
      git(dir, ["config", "user.email", "tester@example.com"]);
      git(dir, ["config", "user.name", "Test User"]);
      writeFileSync(join(dir, "file.txt"), "oldest\n");
      git(dir, ["add", "file.txt"]);
      git(dir, ["commit", "-m", "needle oldest commit"]);
      for (let index = 1; index <= 105; index++) {
        writeFileSync(join(dir, "file.txt"), `commit ${index}\n`);
        git(dir, ["add", "file.txt"]);
        git(dir, ["commit", "-m", `recent commit ${index}`]);
      }

      const result = refCommits(dir, "needle oldest", 5);

      expect(result.length).toBe(1);
      expect(result[0].subject).toBe("needle oldest commit");
      expect(refCommits(dir, result[0].sha.slice(0, 8), 5)[0].sha).toBe(
        result[0].sha,
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("searches commits by author and across non-HEAD refs", () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-ref-author-search-"));
    try {
      git(dir, ["init"]);
      git(dir, ["config", "user.email", "main@example.com"]);
      git(dir, ["config", "user.name", "Main User"]);
      writeFileSync(join(dir, "file.txt"), "main\n");
      git(dir, ["add", "file.txt"]);
      git(dir, ["commit", "-m", "main commit"]);
      const initialBranch = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"])
        .stdout.toString()
        .trim();
      git(dir, ["switch", "-c", "side"]);
      git(dir, ["config", "user.email", "alice@example.com"]);
      git(dir, ["config", "user.name", "Alice Writer"]);
      writeFileSync(join(dir, "file.txt"), "side\n");
      git(dir, ["add", "file.txt"]);
      git(dir, ["commit", "-m", "side branch work"]);
      git(dir, ["switch", initialBranch]);

      const result = refCommits(dir, "Alice Writer", 5);

      expect(result.length).toBe(1);
      expect(result[0].subject).toBe("side branch work");
      expect(result[0].author).toBe("Alice Writer");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("combines hash matches with subject grep matches", () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-ref-hash-grep-"));
    try {
      git(dir, ["init"]);
      git(dir, ["config", "user.email", "tester@example.com"]);
      git(dir, ["config", "user.name", "Test User"]);
      writeFileSync(join(dir, "file.txt"), "first\n");
      git(dir, ["add", "file.txt"]);
      git(dir, ["commit", "-m", "first commit"]);
      const firstSha = git(dir, ["rev-parse", "HEAD"]).stdout.toString().trim();
      writeFileSync(join(dir, "file.txt"), "second\n");
      git(dir, ["add", "file.txt"]);
      git(dir, ["commit", "-m", firstSha.slice(0, 8)]);
      const secondSha = git(dir, ["rev-parse", "HEAD"])
        .stdout.toString()
        .trim();

      const result = refCommits(dir, firstSha.slice(0, 8), 5);

      expect(result.map((commit) => commit.sha)).toEqual([firstSha, secondSha]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("clamps commit search limits and handles hostile queries safely", () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-ref-hostile-"));
    try {
      git(dir, ["init"]);
      git(dir, ["config", "user.email", "tester@example.com"]);
      git(dir, ["config", "user.name", "Test User"]);
      for (let index = 1; index <= 8; index++) {
        writeFileSync(join(dir, "file.txt"), `commit ${index}\n`);
        git(dir, ["add", "file.txt"]);
        git(dir, ["commit", "-m", `commit ${index}`]);
      }

      expect(refCommits(dir, "", -1).length).toBe(1);
      expect(refCommits(dir, "", 99999).length).toBe(8);
      expect(refCommits(dir, "--evil", 5)).toEqual([]);
      expect(refCommits(dir, "commit\0".repeat(300), 5)).toEqual([]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("lists ignored filesystem directories in worktree view", () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-tree-"));
    try {
      writeFileSync(join(dir, ".gitignore"), "ignored-dir/\n");
      mkdirSync(join(dir, "ignored-dir"));
      writeFileSync(join(dir, "ignored-dir", "cache.txt"), "cache");

      const entries = worktreeEntries(dir, "");

      expect(
        entries.some(
          (entry) =>
            entry.name === "ignored-dir" &&
            entry.path === "ignored-dir" &&
            entry.type === "tree",
        ),
      ).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("includes ignored filesystem files in recursive worktree tree data", () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-recursive-tree-"));
    try {
      git(dir, ["init"]);
      writeFileSync(join(dir, ".gitignore"), "ignored-dir/\n*.mp3\n");
      mkdirSync(join(dir, "ignored-dir"));
      writeFileSync(join(dir, "ignored-dir", "cache.txt"), "cache");
      writeFileSync(join(dir, "ignored-dir", "sound.mp3"), "audio");
      writeFileSync(join(dir, "ignored-root.log"), "log");

      const result = listTree("worktree", "", dir, { recursive: true });

      expect(
        result.entries.some(
          (entry) =>
            entry.name === "ignored-dir" &&
            entry.path === "ignored-dir" &&
            entry.type === "tree",
        ),
      ).toBe(true);
      expect(
        result.entries.find((entry) => entry.path === "ignored-dir")
          ?.children_omitted,
      ).toBe(undefined);
      expect(
        result.entries.some(
          (entry) =>
            entry.name === "cache.txt" &&
            entry.path === "ignored-dir/cache.txt" &&
            entry.type === "blob",
        ),
      ).toBe(true);
      expect(
        result.entries.some(
          (entry) =>
            entry.name === "sound.mp3" &&
            entry.path === "ignored-dir/sound.mp3" &&
            entry.type === "blob",
        ),
      ).toBe(true);
      expect(
        result.entries.some(
          (entry) =>
            entry.name === "ignored-root.log" &&
            entry.path === "ignored-root.log" &&
            entry.type === "blob",
        ),
      ).toBe(true);

      const direct = listTree("worktree", "", dir);
      expect(
        direct.entries.find((entry) => entry.path === "ignored-dir")
          ?.children_omitted,
      ).toBe(undefined);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("omits known heavy worktree directories from recursive tree data", () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-heavy-tree-"));
    try {
      git(dir, ["init"]);
      writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
      mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
      writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "module");
      mkdirSync(join(dir, "sandbox"), { recursive: true });
      writeFileSync(join(dir, "sandbox", "sound.mp3"), "audio");

      const result = listTree("worktree", "", dir, { recursive: true });

      expect(
        result.entries.find((entry) => entry.path === "node_modules")
          ?.children_omitted,
      ).toBe(true);
      expect(
        result.entries.find((entry) => entry.path === "node_modules")
          ?.children_omitted_reason,
      ).toBe("heavy");
      expect(
        result.entries.some(
          (entry) => entry.path === "node_modules/pkg/index.js",
        ),
      ).toBe(false);
      expect(
        result.entries.some(
          (entry) =>
            entry.name === "sound.mp3" &&
            entry.path === "sandbox/sound.mp3" &&
            entry.type === "blob",
        ),
      ).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("allows overriding heavy worktree directory omissions", () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-heavy-override-tree-"));
    try {
      git(dir, ["init"]);
      mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
      writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "module");

      const result = listTree("worktree", "", dir, {
        recursive: true,
        omitDirNames: [],
      });

      expect(
        result.entries.find((entry) => entry.path === "node_modules")
          ?.children_omitted,
      ).toBe(undefined);
      expect(
        result.entries.some(
          (entry) => entry.path === "node_modules/pkg/index.js",
        ),
      ).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("marks the .git directory as internal omitted tree data", () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-internal-tree-"));
    try {
      git(dir, ["init"]);
      const result = listTree("worktree", "", dir, { recursive: true });

      const gitEntry = result.entries.find((entry) => entry.path === ".git");
      expect(gitEntry).toEqual({
        name: ".git",
        path: ".git",
        type: "tree",
        children_omitted: true,
        children_omitted_reason: "internal",
      });
      expect(
        result.entries.some((entry) => entry.path.startsWith(".git/")),
      ).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("does not mark empty worktree directories as omitted", () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-empty-tree-"));
    try {
      mkdirSync(join(dir, "empty-dir"));

      const result = listTree("worktree", "", dir, { recursive: true });

      expect(
        result.entries.find((entry) => entry.path === "empty-dir")
          ?.children_omitted,
      ).toBe(undefined);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("does not mark metadata-only untracked directories as omitted", () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-metadata-tree-"));
    try {
      git(dir, ["init"]);
      mkdirSync(join(dir, "metadata-dir"));
      writeFileSync(join(dir, "metadata-dir", ".DS_Store"), "metadata");

      const result = listTree("worktree", "", dir, { recursive: true });

      expect(
        result.entries.find((entry) => entry.path === "metadata-dir")
          ?.children_omitted,
      ).toBe(undefined);
      expect(
        result.entries.some((entry) => entry.path === "metadata-dir/.DS_Store"),
      ).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("does not mark listed worktree child directories as omitted", () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-listed-tree-"));
    try {
      git(dir, ["init"]);
      mkdirSync(join(dir, "tracked-dir"));
      writeFileSync(join(dir, "tracked-dir", "file.txt"), "content");
      git(dir, ["add", "tracked-dir/file.txt"]);

      const result = listTree("worktree", "", dir, { recursive: true });

      expect(
        result.entries.find((entry) => entry.path === "tracked-dir")
          ?.children_omitted,
      ).toBe(undefined);
      expect(
        result.entries.some((entry) => entry.path === "tracked-dir/file.txt"),
      ).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("does not mark gitlink-like worktree directories as omitted", () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-gitlink-tree-"));
    try {
      mkdirSync(join(dir, "submodule-ish"));
      writeFileSync(
        join(dir, "submodule-ish", ".git"),
        "gitdir: ../.git/modules/submodule-ish\n",
      );

      const result = listTree("worktree", "", dir, { recursive: true });
      const entry = result.entries.find(
        (entry) => entry.path === "submodule-ish",
      );

      expect(entry?.type).toBe("commit");
      expect(entry?.children_omitted).toBe(undefined);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("validates tree refs and lists direct git tree entries", () => {
    expect(verifyTreeRef("HEAD", process.cwd())).toBe(true);
    expect(verifyTreeRef("--upload-pack=bad", process.cwd())).toBe(false);
    const result = treeEntries("HEAD", "", process.cwd());
    expect(result.code).toBe(0);
    expect(
      result.entries.some(
        (entry) => entry.path === "web-src" && entry.type === "tree",
      ),
    ).toBe(true);
  });

  test("uses the same direct-child ordering for recursive git tree data", () => {
    const direct = treeEntries("HEAD", "", process.cwd()).entries;
    const recursive = listTree("HEAD", "", process.cwd(), {
      recursive: true,
    }).entries;
    const firstBlob = recursive.findIndex((entry) => entry.type === "blob");
    let lastTree = -1;
    recursive.forEach((entry, index) => {
      if (entry.type === "tree") lastTree = index;
    });

    expect(
      recursive.slice(0, direct.length).map((entry) => entry.path),
    ).toEqual(direct.map((entry) => entry.path));
    expect(firstBlob > 0).toBe(true);
    expect(lastTree < firstBlob).toBe(true);
    expect(
      recursive.some(
        (entry) => entry.path === ".gitignore" && entry.type === "blob",
      ),
    ).toBe(true);
    expect(recursive.some((entry) => entry.children_omitted)).toBe(false);
  });
});
