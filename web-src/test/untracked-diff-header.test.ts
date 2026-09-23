// 未追跡のファイルの差分 (git diff --no-index /dev/null ./<path>) の見出しから、
// オプションに見えないよう前置した `./` を外す (server/git.ts)。
import { expect, test } from "vitest";
import { withoutDotSlashInHeader } from "../server/git";

const body = [
  "@@ -0,0 +1,2 @@",
  "+see b/./docs/new-note.md",
  "+second line",
  "",
].join("\n");

test("見出しの a/./ と b/./ を外し、本文には触らない", () => {
  const diff = [
    "diff --git a/./docs/new-note.md b/./docs/new-note.md",
    "new file mode 100644",
    "index 0000000..fa49b07",
    "--- /dev/null",
    "+++ b/./docs/new-note.md",
    body,
  ].join("\n");
  expect(withoutDotSlashInHeader(diff, "docs/new-note.md")).toBe(
    [
      "diff --git a/docs/new-note.md b/docs/new-note.md",
      "new file mode 100644",
      "index 0000000..fa49b07",
      "--- /dev/null",
      "+++ b/docs/new-note.md",
      body,
    ].join("\n"),
  );
});

test("本文の無い差分 (空のファイル) も見出しだけ直す", () => {
  const diff = [
    "diff --git a/./sample-empty.txt b/./sample-empty.txt",
    "new file mode 100644",
    "index 0000000..e69de29",
    "",
  ].join("\n");
  expect(withoutDotSlashInHeader(diff, "sample-empty.txt")).toBe(
    [
      "diff --git a/sample-empty.txt b/sample-empty.txt",
      "new file mode 100644",
      "index 0000000..e69de29",
      "",
    ].join("\n"),
  );
});
