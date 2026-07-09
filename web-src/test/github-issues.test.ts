import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configureExternalCommands,
  resetExternalCommandsForTest,
} from "../server/command-resolver";
import {
  buildGithubIssueListArgs,
  buildGithubIssueViewArgs,
  githubSearchHasStateQualifier,
  parseGithubIssueListOutput,
  parseGithubIssueViewOutput,
  readGithubIssueAsync,
  readGithubIssueListAsync,
} from "../server/github-issues";

describe("github issue listing", () => {
  afterEach(() => {
    resetExternalCommandsForTest();
  });

  test("builds read-only gh issue list args with repo and labels", () => {
    expect(
      buildGithubIssueListArgs({
        cwd: "/repo",
        repo: "owner/repo",
        labels: ["bug", "help wanted"],
        search: "sort:created-desc",
        state: "all",
        limit: 12,
      }),
    ).toEqual([
      "gh",
      "issue",
      "list",
      "--json",
      "number,title,state,labels,url",
      "--limit",
      "12",
      "--state",
      "all",
      "--repo",
      "owner/repo",
      "--search",
      "sort:created-desc",
      "--label",
      "bug",
      "--label",
      "help wanted",
    ]);
  });

  test("builds read-only gh issue view args without body fields", () => {
    expect(
      buildGithubIssueViewArgs({
        cwd: "/repo",
        number: 42,
        repo: "owner/repo",
      }),
    ).toEqual([
      "gh",
      "issue",
      "view",
      "42",
      "--json",
      "number,title,state,labels,url",
      "--repo",
      "owner/repo",
    ]);
  });

  test("lets search state qualifiers own the GitHub state filter", () => {
    expect(githubSearchHasStateQualifier("is:open no:assignee")).toBe(true);
    expect(githubSearchHasStateQualifier("state:closed")).toBe(true);
    expect(githubSearchHasStateQualifier("is:issue")).toBe(false);
    expect(
      buildGithubIssueListArgs({
        cwd: "/repo",
        search: "is:open no:assignee",
        state: "closed",
        limit: 3,
      }),
    ).toEqual([
      "gh",
      "issue",
      "list",
      "--json",
      "number,title,state,labels,url",
      "--limit",
      "3",
      "--state",
      "all",
      "--search",
      "is:open no:assignee",
    ]);
  });

  test("normalizes issue JSON without copying body fields", () => {
    expect(
      parseGithubIssueListOutput(
        JSON.stringify([
          {
            number: 42,
            title: "Sample issue",
            state: "OPEN",
            labels: [{ name: "ui" }, { name: "priority:p1" }],
            url: "https://example.invalid/repo/issues/42",
            body: "Full issue text must not be returned",
          },
        ]),
      ),
    ).toEqual([
      {
        number: 42,
        title: "Sample issue",
        state: "open",
        labels: ["ui", "priority:p1"],
        url: "https://example.invalid/repo/issues/42",
      },
    ]);
    expect(
      parseGithubIssueViewOutput(
        JSON.stringify({
          number: 43,
          title: "Another sample issue",
          state: "OPEN",
          labels: [{ name: "backend" }],
          url: "https://example.invalid/repo/issues/43",
          body: "Full issue text must not be returned",
        }),
      ),
    ).toEqual({
      number: 43,
      title: "Another sample issue",
      state: "open",
      labels: ["backend"],
      url: "https://example.invalid/repo/issues/43",
    });
  });

  test("drops malformed entries and caps unsafe options", () => {
    const labels = Array.from({ length: 30 }, (_, index) => `label-${index}`);
    expect(
      buildGithubIssueListArgs({
        cwd: "/repo",
        repo: " owner/repo\nextra ",
        labels: ["", "safe", "safe", ...labels],
        state: "open",
        limit: 200,
      }),
    ).toEqual([
      "gh",
      "issue",
      "list",
      "--json",
      "number,title,state,labels,url",
      "--limit",
      "100",
      "--state",
      "open",
      "--label",
      "safe",
      ...labels.slice(0, 23).flatMap((label) => ["--label", label] as const),
    ]);
    expect(
      parseGithubIssueListOutput(
        JSON.stringify([
          { title: "missing number" },
          { number: 1, title: "Valid", state: "closed", labels: [] },
        ]),
      ),
    ).toEqual([{ number: 1, title: "Valid", state: "closed", labels: [] }]);
  });

  test("uses configured gh override when reading issues", async () => {
    const base = mkdtempSync(join(tmpdir(), "code-viewer-gh-"));
    const cwd = join(base, "cwd");
    const binDir = join(base, "bin");
    mkdirSync(cwd);
    mkdirSync(binDir);
    const gh = join(binDir, "gh");
    writeFileSync(
      gh,
      [
        "#!/bin/sh",
        'if [ "$2" = "view" ]; then',
        '  printf \'%s\\n\' \'{"number":7,"title":"Fixture issue","state":"open","labels":[]}\'',
        "else",
        '  printf \'%s\\n\' \'[{"number":7,"title":"Fixture issue","state":"open","labels":[]}]\'',
        "fi",
      ].join("\n"),
    );
    chmodSync(gh, 0o755);
    const configured = configureExternalCommands({
      cwd,
      cliOverrides: [{ name: "gh", path: gh }],
      allowedNames: ["gh"],
    });
    expect(configured).toEqual({ ok: true });
    expect(await readGithubIssueListAsync({ cwd, limit: 1 })).toEqual([
      { number: 7, title: "Fixture issue", state: "open", labels: [] },
    ]);
    expect(await readGithubIssueAsync({ cwd, number: 7 })).toEqual({
      number: 7,
      title: "Fixture issue",
      state: "open",
      labels: [],
    });
  });
});
