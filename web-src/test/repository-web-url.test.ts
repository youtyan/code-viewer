import { describe, expect, test } from "vitest";
import { buildRepositoryWebTarget } from "../core/repository-web-url";

describe("buildRepositoryWebTarget", () => {
  test.each([
    {
      name: "current worktree directory uses the fallback branch",
      repoWebUrl: "https://github.com/example/sample",
      options: {
        ref: "worktree",
        fallbackRef: "feature/ui",
        path: "src/components",
        kind: "tree" as const,
      },
      expected: {
        url: "https://github.com/example/sample/tree/feature/ui/src/components",
        provider: "github" as const,
      },
    },
    {
      name: "file selection points to a single GitHub line",
      repoWebUrl: "https://github.com/example/sample/",
      options: {
        ref: "HEAD",
        fallbackRef: "main",
        path: "src/index.ts",
        kind: "blob" as const,
        start: 12,
        end: 12,
      },
      expected: {
        url: "https://github.com/example/sample/blob/main/src/index.ts#L12",
        provider: "github" as const,
      },
    },
    {
      name: "file selection normalizes a reversed GitHub line range",
      repoWebUrl: "https://github.com/example/sample",
      options: {
        ref: "release/v1",
        path: "lib/file name.ts",
        kind: "blob" as const,
        start: 30,
        end: 20,
      },
      expected: {
        url: "https://github.com/example/sample/blob/release/v1/lib/file%20name.ts#L20-L30",
        provider: "github" as const,
      },
    },
    {
      name: "non-GitHub remote safely falls back to its repository root",
      repoWebUrl: "https://git.example.test/group/sample",
      options: {
        ref: "main",
        path: "src/index.ts",
        kind: "blob" as const,
        start: 1,
        end: 2,
      },
      expected: {
        url: "https://git.example.test/group/sample",
        provider: "web" as const,
      },
    },
  ])("$name", ({ repoWebUrl, options, expected }) => {
    expect(buildRepositoryWebTarget(repoWebUrl, options)).toEqual(expected);
  });

  test.each([
    { name: "missing remote", repoWebUrl: null },
    { name: "local path", repoWebUrl: "/tmp/sample" },
    { name: "unsupported protocol", repoWebUrl: "file:///tmp/sample" },
  ])("returns null for $name", ({ repoWebUrl }) => {
    expect(
      buildRepositoryWebTarget(repoWebUrl, {
        ref: "main",
        path: "src/index.ts",
        kind: "blob",
      }),
    ).toBeNull();
  });
});

describe("buildRepositoryWebTarget commit pages", () => {
  test.each([
    {
      name: "a sha links the GitHub commit page",
      repoWebUrl: "https://github.com/example/sample",
      ref: "0123abcd0123abcd0123abcd0123abcd0123abcd",
      expected: {
        url: "https://github.com/example/sample/commit/0123abcd0123abcd0123abcd0123abcd0123abcd",
        provider: "github" as const,
      },
    },
    {
      name: "the worktree pseudo commit falls back to the repository root",
      repoWebUrl: "https://github.com/example/sample",
      ref: "worktree",
      expected: {
        url: "https://github.com/example/sample",
        provider: "github" as const,
      },
    },
    {
      name: "non-GitHub hosts keep the plain web url",
      repoWebUrl: "https://git.example.test/group/sample",
      ref: "0123abcd",
      expected: {
        url: "https://git.example.test/group/sample",
        provider: "web" as const,
      },
    },
  ])("$name", ({ repoWebUrl, ref, expected }) => {
    expect(
      buildRepositoryWebTarget(repoWebUrl, { ref, kind: "commit" }),
    ).toEqual(expected);
  });
});
