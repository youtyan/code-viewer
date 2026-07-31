import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseJournalArgs, runJournalCli } from "../server/journal-cli";
import { startServer } from "../server/runtime";
import { extractDocumentedSubcommandInvocations } from "./_documented-cli-fixture";
import { captureIo, catchExitAsync, restoreIo } from "./_io-fixture";

const REPO_ROOT = process.cwd();

describe("parseJournalArgs", () => {
  test("no arguments or --help shows help", () => {
    expect(parseJournalArgs([])).toEqual({
      ok: true,
      args: { command: { kind: "help" }, dryRun: false },
    });
    const help = parseJournalArgs(["task-add", "--help"]);
    expect(help.ok && help.args.command.kind === "help").toBe(true);
  });

  test("parses journal add with labels and dry-run", () => {
    const parsed = parseJournalArgs([
      "add",
      "--date",
      "2026-07-02",
      "--title",
      "Daily note",
      "--label",
      "ai-ready",
      "--label",
      "ui",
      "--body",
      "Worked on tasks.",
      "--dry-run",
    ]);
    expect(parsed).toEqual({
      ok: true,
      args: {
        command: {
          kind: "add",
          date: "2026-07-02",
          title: "Daily note",
          labels: ["ai-ready", "ui"],
          body: "Worked on tasks.",
          bodyFile: undefined,
        },
        cwd: undefined,
        server: undefined,
        dryRun: true,
      },
    });
  });

  test("parses journal list with a limit", () => {
    const parsed = parseJournalArgs([
      "list",
      "--date",
      "2026-07-02",
      "--limit",
      "7",
      "--json",
    ]);
    expect(parsed).toEqual({
      ok: true,
      args: {
        command: {
          kind: "list",
          date: "2026-07-02",
          limit: 7,
          json: true,
        },
        cwd: undefined,
        server: undefined,
        dryRun: false,
      },
    });
  });

  test("parses task queue filters", () => {
    const parsed = parseJournalArgs([
      "task-next",
      "--label",
      "ai-ready",
      "--status",
      "todo",
      "--limit",
      "3",
      "--json",
    ]);
    expect(parsed).toEqual({
      ok: true,
      args: {
        command: {
          kind: "task-next",
          status: "todo",
          labels: ["ai-ready"],
          limit: 3,
          json: true,
        },
        cwd: undefined,
        server: undefined,
        dryRun: false,
      },
    });
  });

  test("parses read-only GitHub issue list options", () => {
    const parsed = parseJournalArgs([
      "github-issues",
      "--repo",
      "owner/repo",
      "--state",
      "all",
      "--gh-label",
      "bug",
      "--gh-label",
      "help wanted",
      "--search",
      "is:open no:assignee",
      "--limit",
      "12",
      "--json",
      "--bin",
      "gh=/opt/bin/gh",
    ]);
    expect(parsed).toEqual({
      ok: true,
      args: {
        command: {
          kind: "github-issues",
          repo: "owner/repo",
          ghState: "all",
          ghLabels: ["bug", "help wanted"],
          search: "is:open no:assignee",
          limit: 12,
          json: true,
        },
        cwd: undefined,
        server: undefined,
        commandOverrides: [{ name: "gh", path: "/opt/bin/gh" }],
        dryRun: false,
      },
    });
  });

  test("parses GitHub issue to local task link options", () => {
    const parsed = parseJournalArgs([
      "task-link-issue",
      "42",
      "--repo",
      "owner/repo",
      "--status",
      "todo",
      "--priority",
      "p1",
      "--label",
      "ai-ready",
      "--before",
      "t-1",
      "--json",
      "--bin",
      "gh=/opt/bin/gh",
    ]);
    expect(parsed).toEqual({
      ok: true,
      args: {
        command: {
          kind: "task-link-issue",
          issueNumber: 42,
          repo: "owner/repo",
          status: "todo",
          priority: "p1",
          labels: ["ai-ready"],
          before: "t-1",
          after: undefined,
          position: undefined,
          json: true,
        },
        cwd: undefined,
        server: undefined,
        commandOverrides: [{ name: "gh", path: "/opt/bin/gh" }],
        dryRun: false,
      },
    });
  });

  test("rejects invalid task metadata", () => {
    expect(
      parseJournalArgs(["task-add", "--title", "x", "--priority", "p9"]).ok,
    ).toBe(false);
    expect(parseJournalArgs(["task-next", "--limit", "0"]).ok).toBe(false);
    expect(parseJournalArgs(["list", "--limit", "0"]).ok).toBe(false);
    expect(parseJournalArgs(["list", "--date", "2026-02-29"]).ok).toBe(false);
    expect(parseJournalArgs(["task-done", "t-1"]).ok).toBe(false);
    expect(parseJournalArgs(["github-issues", "--state", "invalid"]).ok).toBe(
      false,
    );
    expect(parseJournalArgs(["github-issues", "--label", "bug"]).ok).toBe(
      false,
    );
    expect(parseJournalArgs(["task-link-issue", "0"]).ok).toBe(false);
    expect(
      parseJournalArgs(["task-link-issue", "1", "--gh-label", "bug"]).ok,
    ).toBe(false);
    expect(parseJournalArgs(["tasks", "--bin", "gh=/opt/bin/gh"]).ok).toBe(
      false,
    );
  });

  test("dry-run normalizes task-add none dates to null", async () => {
    const captured = captureIo();
    try {
      await runJournalCli([
        "task-add",
        "--title",
        "Task",
        "--due",
        "none",
        "--source-date",
        "none",
        "--body",
        "Body",
        "--dry-run",
      ]);
    } finally {
      restoreIo();
    }
    const payload = JSON.parse(captured.logs[0] || "{}") as {
      due_date?: unknown;
      source_date?: unknown;
    };
    expect(payload.due_date).toBeNull();
    expect(payload.source_date).toBeNull();
  });

  test("journal list --limit limits JSON output", async () => {
    const server = await startServer({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return Response.json({
          journal: {
            version: 1,
            entries: [
              {
                id: "j-old",
                date: "2026-07-01",
                body: "Old",
                labels: [],
                source: "user",
                created_at: "2026-07-01T00:00:00.000Z",
                updated_at: "2026-07-01T00:00:00.000Z",
              },
              {
                id: "j-mid",
                date: "2026-07-02",
                body: "Middle",
                labels: [],
                source: "user",
                created_at: "2026-07-02T00:00:00.000Z",
                updated_at: "2026-07-02T00:00:00.000Z",
              },
              {
                id: "j-new",
                date: "2026-07-03",
                body: "New",
                labels: [],
                source: "user",
                created_at: "2026-07-03T00:00:00.000Z",
                updated_at: "2026-07-03T00:00:00.000Z",
              },
            ],
          },
          tasks: { version: 1, tasks: [] },
          labels: [],
        });
      },
    });
    const captured = captureIo();
    try {
      await runJournalCli([
        "list",
        "--limit",
        "2",
        "--json",
        "--server",
        `http://127.0.0.1:${server.port}`,
      ]);
    } finally {
      restoreIo();
      await server.close();
    }
    const output = JSON.parse(captured.logs[0] || "{}") as {
      entries?: { id: string }[];
    };
    expect(output.entries?.map((entry) => entry.id)).toEqual([
      "j-new",
      "j-mid",
    ]);
  });

  test("task-delete reports a missing task as failure", async () => {
    const server = await startServer({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        if (request.method === "GET") {
          return Response.json({
            journal: { version: 1, entries: [] },
            tasks: { version: 1, tasks: [] },
            labels: [],
          });
        }
        const payload = (await request.json()) as {
          action?: string;
          id?: string;
        };
        expect(payload).toEqual({ action: "delete-task", id: "missing-task" });
        return Response.json({ ok: true, removed: false, generation: 1 });
      },
    });
    const captured = captureIo();
    try {
      await catchExitAsync(() =>
        runJournalCli([
          "task-delete",
          "missing-task",
          "--server",
          `http://127.0.0.1:${server.port}`,
        ]),
      );
    } finally {
      restoreIo();
      await server.close();
    }
    expect(captured.exits).toEqual([1]);
    expect(captured.errs.includes("task not found: missing-task")).toBe(true);
    expect(captured.logs).toEqual([]);
  });

  test("dry-run links a GitHub issue without copying the issue body", async () => {
    const base = mkdtempSync(join(tmpdir(), "code-viewer-journal-link-"));
    const cwd = join(base, "cwd");
    const binDir = join(base, "bin");
    mkdirSync(cwd);
    mkdirSync(binDir);
    const gh = join(binDir, "gh");
    writeFileSync(
      gh,
      [
        "#!/bin/sh",
        'printf \'%s\\n\' \'{"number":42,"title":"Sample issue","state":"open","labels":[],"url":"https://example.invalid/repo/issues/42","body":"Do not copy me"}\'',
      ].join("\n"),
    );
    chmodSync(gh, 0o755);
    const captured = captureIo();
    try {
      await runJournalCli([
        "task-link-issue",
        "42",
        "--cwd",
        cwd,
        "--repo",
        "owner/repo",
        "--bin",
        `gh=${gh}`,
        "--label",
        "ai-ready",
        "--dry-run",
      ]);
    } finally {
      restoreIo();
    }
    const payload = JSON.parse(captured.logs[0] || "{}") as {
      action?: string;
      issue_number?: number;
      title?: string;
      labels?: string[];
      body?: string;
      repo?: string;
      status?: string;
    };
    expect(payload.action).toBe("link-github-issue");
    expect(payload.issue_number).toBe(42);
    expect(payload.title).toBe("Sample issue");
    expect(payload.repo).toBe("owner/repo");
    expect(payload.status).toBeUndefined();
    expect(payload.labels).toEqual(["ai-ready"]);
    expect(payload.body).toBeUndefined();
  });

  test("rejects unknown task commands", () => {
    const parsed = parseJournalArgs(["task-sync"]);
    expect(parsed.ok).toBe(false);
  });
});

function extractDocumentedJournalInvocations(text: string): string[][] {
  return extractDocumentedSubcommandInvocations(text, "journal");
}

describe("bundled journal skill tracks the CLI contract", () => {
  test("every documented code-viewer journal example parses", () => {
    const text = readFileSync(
      join(REPO_ROOT, "skills/code-viewer-journal/SKILL.md"),
      "utf8",
    );
    const invocations = extractDocumentedJournalInvocations(text);
    expect(invocations.length === 0).toBe(false);
    const failures: string[] = [];
    for (const argv of invocations) {
      const result = parseJournalArgs(argv);
      if (result.ok) continue;
      failures.push(`\`${argv.join(" ")}\``);
    }
    expect(failures).toEqual([]);
  });

  test("documents task read/create/update/claim/done and GitHub link flows", () => {
    const text = readFileSync(
      join(REPO_ROOT, "skills/code-viewer-journal/SKILL.md"),
      "utf8",
    );
    const invocations = extractDocumentedJournalInvocations(text);
    const required = [
      "tasks",
      "task-next",
      "task-add",
      "task-update",
      "task-claim",
      "task-done",
      "github-issues",
      "task-link-issue",
    ];
    for (const kind of required) {
      const present = invocations.some((argv) => argv[0] === kind);
      expect({ kind, present }).toEqual({ kind, present: true });
    }
  });
});
