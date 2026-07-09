import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { rawFileHeaders } from "../server/raw-file-headers";
import { sourceFixture } from "./source-fixture";

const app = sourceFixture(
  readFileSync("web-src/app.ts", "utf8") +
    readFileSync("web-src/views/source-view.ts", "utf8") +
    readFileSync("web-src/views/repo-view.ts", "utf8"),
);
const server = sourceFixture(readFileSync("web-src/server/preview.ts", "utf8"));
const style = sourceFixture(readFileSync("web/style.css", "utf8"));
const types = sourceFixture(readFileSync("web-src/core/types.ts", "utf8"));

describe("file metadata display", () => {
  test("API types carry file timestamps and size metadata", () => {
    expect(types.includes("created_at?: string")).toBe(true);
    expect(types.includes("updated_at?: string")).toBe(true);
    expect(types.includes("size?: number")).toBe(true);
    expect(types.includes("commit_updated_at?: string")).toBe(true);
  });

  test("server attaches worktree and git metadata to tree and file responses", () => {
    expect(server.includes("function worktreeFileMetadata")).toBe(true);
    expect(server.includes("function gitFileMetadata")).toBe(true);
    expect(server.includes("function directoryMetadata")).toBe(true);
    expect(server.includes("return ms && Number.isFinite(ms)")).toBe(true);
    expect(
      server.includes("entries: recursive ? entries : await Promise.all("),
    ).toBe(true);
    const rawHeaders = new Headers(
      rawFileHeaders("README.md", {
        metadata: {
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-02T00:00:00.000Z",
          commit_updated_at: "2026-01-03T00:00:00.000Z",
        },
      }),
    );
    expect(rawHeaders.get("x-code-viewer-created-at")).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(rawHeaders.get("x-code-viewer-updated-at")).toBe(
      "2026-01-02T00:00:00.000Z",
    );
    expect(rawHeaders.get("x-code-viewer-commit-updated-at")).toBe(
      "2026-01-03T00:00:00.000Z",
    );
    expect(
      server.includes(
        "const metadata = await gitFileMetadata(ref, path, size)",
      ),
    ).toBe(true);
    expect(
      server.includes("const metadata = worktreeFileMetadata(path, size)"),
    ).toBe(true);
  });

  test("repository list and file detail render GitHub-style file metadata", () => {
    expect(app.includes("function createRepoEntryMeta")).toBe(true);
    expect(app.includes("function createFileDetailMeta")).toBe(true);
    expect(app.includes("meta.textContent = '-'")).toBe(true);
    expect(app.includes(": ''")).toBe(true);
    expect(
      app.includes(
        "meta.textContent = entry.type === 'commit' ? 'submodule' : 'directory'",
      ),
    ).toBe(false);
    expect(app.includes("row.append(icon, name, metaBlock, size)")).toBe(true);
    expect(
      app.includes("header.appendChild(createFileDetailMeta(target, meta))"),
    ).toBe(true);
  });

  test("repository list can be sorted by name, updated time, and size", () => {
    expect(app.includes("type RepoSortKey = 'name' | 'updated' | 'size'")).toBe(
      true,
    );
    expect(app.includes("function sortedRepoEntries")).toBe(true);
    expect(app.includes("function createRepoSortHeader")).toBe(true);
    expect(app.includes("button.dataset.repoSort = column.key")).toBe(true);
    expect(app.includes("REPO_SORT.direction === 'asc' ? 'desc' : 'asc'")).toBe(
      true,
    );
  });

  test("metadata has compact GitHub-like styling", () => {
    expect(style.includes(".gdp-repo-row .meta")).toBe(true);
    expect(style.includes(".gdp-file-detail-meta")).toBe(true);
    expect(style.includes(".gdp-file-detail-meta-item")).toBe(true);
  });
});
