import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FILE_AGENT_HELP,
  FILE_DEFAULT_HISTORY_LIMIT,
  FILE_HELP,
  FILE_HISTORY_HARD_CAP,
  parseFileArgs,
  runFileCli,
} from "../server/file-cli";
import { runGit as git } from "./_git-fixture";
import { captureIo, catchExitAsync, restoreIo } from "./_io-fixture";

describe("parseFileArgs", () => {
  test("bare invocation returns help", () => {
    expect(parseFileArgs([])).toEqual({
      ok: true,
      args: { command: { kind: "help" } },
    });
  });

  test("--help and -h return help", () => {
    expect(parseFileArgs(["--help"])).toEqual({
      ok: true,
      args: { command: { kind: "help" } },
    });
    expect(parseFileArgs(["-h"])).toEqual({
      ok: true,
      args: { command: { kind: "help" } },
    });
  });

  test("agent-help is recognised and rejects extra args", () => {
    expect(parseFileArgs(["agent-help"])).toEqual({
      ok: true,
      args: { command: { kind: "agent-help" } },
    });
    expect(parseFileArgs(["agent-help", "blame"])).toEqual({
      ok: false,
      error: "agent-help does not accept arguments",
    });
  });

  test("unknown top-level subcommand is rejected", () => {
    expect(parseFileArgs(["nope"])).toEqual({
      ok: false,
      error: "unknown file subcommand: nope",
    });
  });

  test("blame requires --path", () => {
    expect(parseFileArgs(["blame"])).toEqual({
      ok: false,
      error: "--path requires a non-empty value",
    });
  });

  test("--path rejects empty, NUL, newline, and leading-dash values", () => {
    expect(parseFileArgs(["blame", "--path", ""])).toEqual({
      ok: false,
      error: "--path requires a non-empty value",
    });
    expect(parseFileArgs(["blame", "--path", "a\0b"])).toEqual({
      ok: false,
      error: "--path must be single-line and must not contain NUL",
    });
    expect(parseFileArgs(["blame", "--path", "a\nb"])).toEqual({
      ok: false,
      error: "--path must be single-line and must not contain NUL",
    });
    expect(parseFileArgs(["blame", "--path", "--inject"])).toEqual({
      ok: false,
      error: "--path must not start with '-'",
    });
  });

  test("--path rejects absolute, parent traversal, and internal metadata paths", () => {
    expect(parseFileArgs(["blame", "--path", "/tmp/a.txt"])).toEqual({
      ok: false,
      error: "--path must be repo-relative",
    });
    expect(parseFileArgs(["blame", "--path", "src/../a.txt"])).toEqual({
      ok: false,
      error: "--path must not contain '..' segments",
    });
    expect(parseFileArgs(["blame", "--path", ".git/config"])).toEqual({
      ok: false,
      error: "--path must not target git metadata",
    });
    expect(
      parseFileArgs(["blame", "--path", ".code-viewer/state.json"]),
    ).toEqual({
      ok: false,
      error: "--path must not target code-viewer metadata",
    });
  });

  test("--ref rejects empty, NUL, newline, and leading-dash values", () => {
    expect(parseFileArgs(["blame", "--path", "a.txt", "--ref", ""])).toEqual({
      ok: false,
      error: "--ref requires a non-empty value",
    });
    expect(
      parseFileArgs(["blame", "--path", "a.txt", "--ref", "a\0b"]),
    ).toEqual({
      ok: false,
      error: "--ref must be single-line and must not contain NUL",
    });
    expect(
      parseFileArgs(["blame", "--path", "a.txt", "--ref", "a\nb"]),
    ).toEqual({
      ok: false,
      error: "--ref must be single-line and must not contain NUL",
    });
    expect(
      parseFileArgs(["blame", "--path", "a.txt", "--ref", "--all"]),
    ).toEqual({ ok: false, error: "--ref must not start with '-'" });
  });

  test("blame default ref is worktree and default base is worktree", () => {
    const result = parseFileArgs(["blame", "--path", "a.txt"]);
    expect(result).toEqual({
      ok: true,
      args: {
        command: {
          kind: "blame",
          path: "a.txt",
          ref: "worktree",
          base: "worktree",
          json: false,
        },
      },
    });
  });

  test("blame --base accepts only worktree or HEAD", () => {
    expect(
      parseFileArgs(["blame", "--path", "a.txt", "--base", "main"]),
    ).toEqual({
      ok: false,
      error: "--base must be worktree or HEAD (got main)",
    });
    const head = parseFileArgs([
      "blame",
      "--path",
      "a.txt",
      "--base",
      "HEAD",
      "--json",
    ]);
    expect(head.ok).toBe(true);
    if (head.ok && head.args.command.kind === "blame") {
      expect(head.args.command.base).toBe("HEAD");
      expect(head.args.command.json).toBe(true);
    }
  });

  test("history defaults limit and skip", () => {
    const result = parseFileArgs(["history", "--path", "a.txt"]);
    expect(result.ok).toBe(true);
    if (result.ok && result.args.command.kind === "history") {
      expect(result.args.command.limit).toBe(FILE_DEFAULT_HISTORY_LIMIT);
      expect(result.args.command.skip).toBe(0);
      expect(result.args.command.ref).toBe("HEAD");
      expect(result.args.command.query).toBeUndefined();
    }
  });

  test("history --limit and --skip validate ranges", () => {
    expect(
      parseFileArgs(["history", "--path", "a.txt", "--limit", "0"]),
    ).toEqual({
      ok: false,
      error: `--limit must be an integer in [1, ${FILE_HISTORY_HARD_CAP}] (got 0)`,
    });
    expect(
      parseFileArgs([
        "history",
        "--path",
        "a.txt",
        "--limit",
        String(FILE_HISTORY_HARD_CAP + 1),
      ]),
    ).toEqual({
      ok: false,
      error: `--limit must be an integer in [1, ${FILE_HISTORY_HARD_CAP}] (got ${
        FILE_HISTORY_HARD_CAP + 1
      })`,
    });
    expect(
      parseFileArgs(["history", "--path", "a.txt", "--skip", "-1"]),
    ).toEqual({
      ok: false,
      error: `--skip must be an integer in [0, ${Number.MAX_SAFE_INTEGER}] (got -1)`,
    });
  });

  test("history --query rejects NUL and newlines", () => {
    expect(
      parseFileArgs(["history", "--path", "a.txt", "--query", "a\0b"]),
    ).toEqual({
      ok: false,
      error: "--query must be single-line and must not contain NUL",
    });
    expect(
      parseFileArgs(["history", "--path", "a.txt", "--query", "a\nb"]),
    ).toEqual({
      ok: false,
      error: "--query must be single-line and must not contain NUL",
    });
    const ok = parseFileArgs([
      "history",
      "--path",
      "a.txt",
      "--query",
      "author:tester",
    ]);
    expect(ok.ok).toBe(true);
    if (ok.ok && ok.args.command.kind === "history") {
      expect(ok.args.command.query).toBe("author:tester");
    }
  });

  test("show requires --start and --end together", () => {
    expect(parseFileArgs(["show", "--path", "a.txt", "--start", "1"])).toEqual({
      ok: false,
      error: "--start and --end must be used together",
    });
    expect(parseFileArgs(["show", "--path", "a.txt", "--end", "3"])).toEqual({
      ok: false,
      error: "--start and --end must be used together",
    });
  });

  test("show validates --start / --end ranges", () => {
    expect(
      parseFileArgs(["show", "--path", "a.txt", "--start", "0", "--end", "3"]),
    ).toEqual({
      ok: false,
      error: `--start must be an integer in [1, ${Number.MAX_SAFE_INTEGER}] (got 0)`,
    });
    expect(
      parseFileArgs(["show", "--path", "a.txt", "--start", "5", "--end", "3"]),
    ).toEqual({
      ok: false,
      error: "--start (5) must be <= --end (3)",
    });
    const ok = parseFileArgs([
      "show",
      "--path",
      "a.txt",
      "--start",
      "2",
      "--end",
      "4",
    ]);
    expect(ok.ok).toBe(true);
    if (ok.ok && ok.args.command.kind === "show") {
      expect(ok.args.command.start).toBe(2);
      expect(ok.args.command.end).toBe(4);
      expect(ok.args.command.ref).toBe("worktree");
    }
  });

  test("rejects positional argument after a subcommand", () => {
    expect(parseFileArgs(["blame", "extra", "--path", "a.txt"])).toEqual({
      ok: false,
      error: "file blame does not accept positional argument: extra",
    });
  });

  test("rejects unknown option", () => {
    expect(parseFileArgs(["blame", "--path", "a.txt", "--what"])).toEqual({
      ok: false,
      error: "unknown option: --what",
    });
  });

  test("captures --cwd", () => {
    const result = parseFileArgs([
      "blame",
      "--path",
      "a.txt",
      "--cwd",
      "/tmp/example",
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.args.cwd).toBe("/tmp/example");
  });

  test("diff defaults from=HEAD, to=worktree, preview mode with default caps", () => {
    const result = parseFileArgs([
      "diff",
      "--path",
      "sample_file.ts",
      "--json",
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.args.command).toEqual({
      kind: "diff",
      path: "sample_file.ts",
      from: "HEAD",
      to: "worktree",
      untracked: false,
      ignoreWs: false,
      ignoreBlank: false,
      mode: "preview",
      maxHunks: 3,
      maxLines: 1200,
      json: true,
    });
  });

  test("diff --full forces full mode and rejects --max-hunks combined with --full", () => {
    const okFull = parseFileArgs([
      "diff",
      "--path",
      "sample_file.ts",
      "--full",
    ]);
    expect(okFull.ok).toBe(true);
    if (okFull.ok && okFull.args.command.kind === "diff") {
      expect(okFull.args.command.mode).toBe("full");
    }
    expect(
      parseFileArgs([
        "diff",
        "--path",
        "sample_file.ts",
        "--full",
        "--max-hunks",
        "5",
      ]),
    ).toEqual({
      ok: false,
      error: "--max-hunks cannot be combined with --full",
    });
    expect(
      parseFileArgs([
        "diff",
        "--path",
        "sample_file.ts",
        "--full",
        "--max-lines",
        "5000",
      ]),
    ).toEqual({
      ok: false,
      error: "--max-lines cannot be combined with --full",
    });
  });

  test("diff rejects --ref (must use --from/--to)", () => {
    expect(
      parseFileArgs(["diff", "--path", "sample_file.ts", "--ref", "HEAD"]),
    ).toEqual({
      ok: false,
      error: "file diff does not accept --ref; use --from / --to instead",
    });
  });

  test("diff --untracked requires --to worktree", () => {
    expect(
      parseFileArgs([
        "diff",
        "--path",
        "sample_file.ts",
        "--untracked",
        "--to",
        "HEAD",
      ]),
    ).toEqual({
      ok: false,
      error: "--untracked requires --to worktree (or --to omitted)",
    });
    expect(
      parseFileArgs([
        "diff",
        "--path",
        "sample_file.ts",
        "--untracked",
        "--from",
        "HEAD",
      ]),
    ).toEqual({
      ok: false,
      error: "--untracked cannot be combined with --from",
    });
    const ok = parseFileArgs([
      "diff",
      "--path",
      "sample_file.ts",
      "--untracked",
    ]);
    expect(ok.ok).toBe(true);
    if (ok.ok && ok.args.command.kind === "diff") {
      expect(ok.args.command.untracked).toBe(true);
      expect(ok.args.command.to).toBe("worktree");
    }
  });

  test("diff --max-hunks / --max-lines validate ranges", () => {
    expect(
      parseFileArgs(["diff", "--path", "sample_file.ts", "--max-hunks", "0"]),
    ).toEqual({
      ok: false,
      error: "--max-hunks must be an integer in [1, 100] (got 0)",
    });
    expect(
      parseFileArgs([
        "diff",
        "--path",
        "sample_file.ts",
        "--max-lines",
        "9999999",
      ]),
    ).toEqual({
      ok: false,
      error: "--max-lines must be an integer in [1, 100000] (got 9999999)",
    });
  });

  test("diff --old-path validates the rename source path", () => {
    expect(
      parseFileArgs([
        "diff",
        "--path",
        "sample_file.ts",
        "--old-path",
        "../escape",
      ]),
    ).toEqual({
      ok: false,
      error: "--old-path must not contain '..' segments",
    });
    const ok = parseFileArgs([
      "diff",
      "--path",
      "sample_file.ts",
      "--old-path",
      "previous_sample.ts",
      "--from",
      "HEAD~1",
      "--to",
      "HEAD",
    ]);
    expect(ok.ok).toBe(true);
    if (ok.ok && ok.args.command.kind === "diff") {
      expect(ok.args.command.oldPath).toBe("previous_sample.ts");
      expect(ok.args.command.from).toBe("HEAD~1");
      expect(ok.args.command.to).toBe("HEAD");
    }
  });

  test("diff toggles ignoreWs / ignoreBlank", () => {
    const ok = parseFileArgs([
      "diff",
      "--path",
      "sample_file.ts",
      "--ignore-ws",
      "--ignore-blank",
    ]);
    expect(ok.ok).toBe(true);
    if (ok.ok && ok.args.command.kind === "diff") {
      expect(ok.args.command.ignoreWs).toBe(true);
      expect(ok.args.command.ignoreBlank).toBe(true);
    }
  });
});

describe("FILE_HELP / FILE_AGENT_HELP", () => {
  test("share a stable signature line", () => {
    expect(FILE_HELP.startsWith("code-viewer file — ")).toBe(true);
    expect(FILE_AGENT_HELP.startsWith("code-viewer file — agent guide")).toBe(
      true,
    );
  });

  test("FILE_HELP documents blame/history/show/diff with their key flags", () => {
    expect(FILE_HELP).toMatch(/code-viewer file blame/);
    expect(FILE_HELP).toMatch(/code-viewer file history/);
    expect(FILE_HELP).toMatch(/code-viewer file show/);
    expect(FILE_HELP).toMatch(/code-viewer file diff/);
    expect(FILE_HELP).toMatch(/--path/);
    expect(FILE_HELP).toMatch(/--ref/);
    expect(FILE_HELP).toMatch(/--base/);
    expect(FILE_HELP).toMatch(/--limit/);
    expect(FILE_HELP).toMatch(/--start/);
    expect(FILE_HELP).toMatch(/--end/);
    expect(FILE_HELP).toMatch(/--from/);
    expect(FILE_HELP).toMatch(/--to/);
    expect(FILE_HELP).toMatch(/--old-path/);
    expect(FILE_HELP).toMatch(/--untracked/);
    expect(FILE_HELP).toMatch(/--ignore-ws/);
    expect(FILE_HELP).toMatch(/--ignore-blank/);
    expect(FILE_HELP).toMatch(/--max-hunks/);
    expect(FILE_HELP).toMatch(/--max-lines/);
    expect(FILE_HELP).toMatch(/--full/);
    expect(FILE_HELP).toMatch(/--json/);
    expect(FILE_HELP).toMatch(/agent-help/);
  });

  test("FILE_AGENT_HELP describes the JSON contract for every subcommand", () => {
    expect(FILE_AGENT_HELP).toMatch(/blame:/);
    expect(FILE_AGENT_HELP).toMatch(/history:/);
    expect(FILE_AGENT_HELP).toMatch(/show:/);
    expect(FILE_AGENT_HELP).toMatch(/diff:/);
    expect(FILE_AGENT_HELP).toMatch(/GitBlameResult/);
    expect(FILE_AGENT_HELP).toMatch(/GitHistoryCommit/);
    expect(FILE_AGENT_HELP).toMatch(/totalLines/);
    expect(FILE_AGENT_HELP).toMatch(/complete/);
    expect(FILE_AGENT_HELP).toMatch(/no history/);
    expect(FILE_AGENT_HELP).toMatch(/hunk_count/);
    expect(FILE_AGENT_HELP).toMatch(/rendered_hunk_count/);
    expect(FILE_AGENT_HELP).toMatch(/preview/);
  });
});

// --- runFileCli integration (fixture repo + log/exit capture) ---
// captureIo / ExitMarker / catchExitAsync は `_io-fixture` に集約済み。

afterEach(() => {
  restoreIo();
});

async function runAndCatchExit(argv: string[]): Promise<void> {
  await catchExitAsync(() => runFileCli(argv));
}

describe("runFileCli help and agent-help", () => {
  test("--help prints FILE_HELP without touching the filesystem", async () => {
    const io = captureIo();
    await runAndCatchExit(["--help"]);
    expect(io.exits).toEqual([]);
    expect(io.logs.length).toBe(1);
    expect(io.logs[0].startsWith("code-viewer file — ")).toBe(true);
  });

  test("agent-help prints FILE_AGENT_HELP", async () => {
    const io = captureIo();
    await runAndCatchExit(["agent-help"]);
    expect(io.exits).toEqual([]);
    expect(io.logs.length).toBe(1);
    expect(io.logs[0].startsWith("code-viewer file — agent guide")).toBe(true);
  });
});

describe("runFileCli against a fixture repo", () => {
  let repo: string;
  let firstSha: string;
  let secondSha: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "code-viewer-file-cli-"));
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.email", "tester@example.com"]);
    git(repo, ["config", "user.name", "tester"]);
    writeFileSync(join(repo, "a.txt"), "line1\nline2\nline3\n");
    git(repo, ["add", "a.txt"]);
    git(repo, ["commit", "-m", "first commit"]);
    firstSha = git(repo, ["rev-parse", "HEAD"]).stdout.trim();
    writeFileSync(join(repo, "a.txt"), "line1\nLINE2\nline3\nline4\n");
    git(repo, ["add", "a.txt"]);
    git(repo, ["commit", "-m", "edit line2, add line4"]);
    secondSha = git(repo, ["rev-parse", "HEAD"]).stdout.trim();
    // Untracked, never committed — used for "no history" assertions.
    writeFileSync(join(repo, "untracked.txt"), "alpha\nbeta\n");
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  test("blame --json wraps git.blame and labels lines by commit", async () => {
    const io = captureIo();
    await runAndCatchExit([
      "blame",
      "--path",
      "a.txt",
      "--ref",
      "HEAD",
      "--base",
      "HEAD",
      "--cwd",
      repo,
      "--json",
    ]);
    expect(io.exits).toEqual([]);
    expect(io.logs.length).toBe(1);
    const payload = JSON.parse(io.logs[0]);
    expect(payload.path).toBe("a.txt");
    expect(payload.ref).toBe("HEAD");
    expect(payload.base).toBe("HEAD");
    expect(payload.result.error).toBeUndefined();
    expect(
      payload.result.lines.map((l: { lineNo: number }) => l.lineNo),
    ).toEqual([1, 2, 3, 4]);
    expect(payload.result.lines[0].sha).toBe(firstSha);
    expect(payload.result.lines[1].sha).toBe(secondSha);
    expect(payload.result.commits[firstSha].summary).toBe("first commit");
    expect(payload.result.commits[secondSha].summary).toBe(
      "edit line2, add line4",
    );
  });

  test("blame default text format emits line/shortSha/summary per line", async () => {
    const io = captureIo();
    await runAndCatchExit([
      "blame",
      "--path",
      "a.txt",
      "--ref",
      "HEAD",
      "--base",
      "HEAD",
      "--cwd",
      repo,
    ]);
    expect(io.exits).toEqual([]);
    expect(io.logs.length).toBe(4);
    expect(io.logs[0]).toBe(`1\t${firstSha.slice(0, 8)}\tfirst commit`);
    expect(io.logs[1]).toBe(
      `2\t${secondSha.slice(0, 8)}\tedit line2, add line4`,
    );
    expect(io.logs[3]).toBe(
      `4\t${secondSha.slice(0, 8)}\tedit line2, add line4`,
    );
  });

  test("blame against a worktree base marks dirty lines with `worktree` and `<uncommitted>`", async () => {
    const original = "line1\nLINE2\nline3\nline4\n";
    writeFileSync(join(repo, "a.txt"), "line1\nLINE2\nNEW3\nline4\n");
    try {
      const io = captureIo();
      await runAndCatchExit(["blame", "--path", "a.txt", "--cwd", repo]);
      expect(io.exits).toEqual([]);
      expect(io.logs.length).toBe(4);
      expect(io.logs[2]).toBe("3\tworktree\t<uncommitted>");
    } finally {
      writeFileSync(join(repo, "a.txt"), original);
    }
  });

  test("blame returns a git error verbatim and exits 1", async () => {
    const io = captureIo();
    await runAndCatchExit([
      "blame",
      "--path",
      "missing.txt",
      "--ref",
      "HEAD",
      "--base",
      "HEAD",
      "--cwd",
      repo,
      "--json",
    ]);
    expect(io.exits).toEqual([1]);
    const payload = JSON.parse(io.logs[0]);
    expect(payload.result.error).toBeTruthy();
    expect(io.errs[0].startsWith("blame failed: ")).toBe(true);
  });

  test("history --json wraps git.commitHistory and respects --limit", async () => {
    const io = captureIo();
    await runAndCatchExit([
      "history",
      "--path",
      "a.txt",
      "--limit",
      "1",
      "--cwd",
      repo,
      "--json",
    ]);
    expect(io.exits).toEqual([]);
    const payload = JSON.parse(io.logs[0]);
    expect(payload.path).toBe("a.txt");
    expect(payload.ref).toBe("HEAD");
    expect(payload.limit).toBe(1);
    expect(payload.skip).toBe(0);
    expect(payload.result.commits.length).toBe(1);
    expect(payload.result.hasMore).toBe(true);
    expect(payload.result.commits[0].sha).toBe(secondSha);
    expect(payload.result.commits[0].subject).toBe("edit line2, add line4");
  });

  test("history default text format emits shortSha/when/author/subject", async () => {
    const io = captureIo();
    await runAndCatchExit([
      "history",
      "--path",
      "a.txt",
      "--limit",
      "5",
      "--cwd",
      repo,
    ]);
    expect(io.exits).toEqual([]);
    expect(io.logs.length).toBe(2);
    expect(io.logs[0].startsWith(`${secondSha.slice(0, 8)}\t`)).toBe(true);
    expect(io.logs[0].endsWith("\ttester\tedit line2, add line4")).toBe(true);
    expect(io.logs[1].endsWith("\ttester\tfirst commit")).toBe(true);
  });

  test("history for an untracked path prints `no history` on stderr with exit 0", async () => {
    const io = captureIo();
    await runAndCatchExit([
      "history",
      "--path",
      "untracked.txt",
      "--cwd",
      repo,
    ]);
    expect(io.exits).toEqual([]);
    expect(io.logs).toEqual([]);
    expect(io.errs).toEqual(["no history"]);
  });

  test("show --json returns text plus totalLines/complete", async () => {
    const io = captureIo();
    await runAndCatchExit([
      "show",
      "--path",
      "a.txt",
      "--ref",
      "HEAD",
      "--cwd",
      repo,
      "--json",
    ]);
    expect(io.exits).toEqual([]);
    const payload = JSON.parse(io.logs[0]);
    expect(payload.path).toBe("a.txt");
    expect(payload.ref).toBe("HEAD");
    expect(payload.totalLines).toBe(4);
    expect(payload.complete).toBe(true);
    expect(payload.text).toBe("line1\nLINE2\nline3\nline4");
    expect(payload.start).toBeUndefined();
    expect(payload.end).toBeUndefined();
  });

  test("show defaults to the worktree and can read an untracked file", async () => {
    const io = captureIo();
    await runAndCatchExit([
      "show",
      "--path",
      "untracked.txt",
      "--cwd",
      repo,
      "--json",
    ]);
    expect(io.exits).toEqual([]);
    const payload = JSON.parse(io.logs[0]);
    expect(payload.path).toBe("untracked.txt");
    expect(payload.ref).toBe("worktree");
    expect(payload.totalLines).toBe(2);
    expect(payload.complete).toBe(true);
    expect(payload.text).toBe("alpha\nbeta");
  });

  test("show --start/--end slices, exposes totalLines, marks incomplete", async () => {
    const io = captureIo();
    await runAndCatchExit([
      "show",
      "--path",
      "a.txt",
      "--ref",
      "HEAD",
      "--start",
      "2",
      "--end",
      "3",
      "--cwd",
      repo,
      "--json",
    ]);
    expect(io.exits).toEqual([]);
    const payload = JSON.parse(io.logs[0]);
    expect(payload.start).toBe(2);
    expect(payload.end).toBe(3);
    expect(payload.totalLines).toBe(4);
    expect(payload.complete).toBe(false);
    expect(payload.text).toBe("LINE2\nline3");
  });

  test("show default text output prints the file verbatim", async () => {
    const io = captureIo();
    await runAndCatchExit([
      "show",
      "--path",
      "a.txt",
      "--ref",
      "HEAD",
      "--cwd",
      repo,
    ]);
    expect(io.exits).toEqual([]);
    expect(io.logs).toEqual(["line1\nLINE2\nline3\nline4"]);
  });

  test("show on a missing path exits 1 and surfaces the git error", async () => {
    const io = captureIo();
    await runAndCatchExit([
      "show",
      "--path",
      "missing.txt",
      "--ref",
      "HEAD",
      "--cwd",
      repo,
      "--json",
    ]);
    expect(io.exits).toEqual([1]);
    const payload = JSON.parse(io.logs[0]);
    expect(payload.complete).toBe(false);
    expect(payload.totalLines).toBe(0);
    expect(payload.text).toBe("");
    expect(typeof payload.error).toBe("string");
    expect(payload.error.length > 0).toBe(true);
  });

  test("show --start/--end out of range produces an empty slice (still exit 0)", async () => {
    const io = captureIo();
    await runAndCatchExit([
      "show",
      "--path",
      "a.txt",
      "--ref",
      "HEAD",
      "--start",
      "100",
      "--end",
      "200",
      "--cwd",
      repo,
      "--json",
    ]);
    expect(io.exits).toEqual([]);
    const payload = JSON.parse(io.logs[0]);
    expect(payload.totalLines).toBe(4);
    expect(payload.complete).toBe(false);
    expect(payload.text).toBe("");
  });

  test("parse failure exits 1 before doing any git work", async () => {
    const io = captureIo();
    await runAndCatchExit(["blame", "--path", ""]);
    expect(io.exits).toEqual([1]);
    expect(io.errs[0]).toBe("--path requires a non-empty value");
  });
});

describe("runFileCli file diff against a sample fixture repo", () => {
  let repo: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "code-viewer-file-cli-diff-"));
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.email", "sample-author@example.invalid"]);
    git(repo, ["config", "user.name", "sample-author"]);
    writeFileSync(join(repo, "sample_file.ts"), "alpha\nbeta\ngamma\ndelta\n");
    git(repo, ["add", "sample_file.ts"]);
    git(repo, ["commit", "-m", "sample initial commit"]);
    // Worktree-only edit so the default range (HEAD..worktree) shows a diff.
    writeFileSync(
      join(repo, "sample_file.ts"),
      "alpha\nBETA\ngamma\ndelta\nepsilon\n",
    );
    // Untracked file used by --untracked tests.
    writeFileSync(join(repo, "sample_untracked.ts"), "fresh\nfile\n");
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  test("diff --json defaults to HEAD..worktree and returns a non-empty unified diff", async () => {
    const io = captureIo();
    await runAndCatchExit([
      "diff",
      "--path",
      "sample_file.ts",
      "--cwd",
      repo,
      "--json",
    ]);
    expect(io.exits).toEqual([]);
    expect(io.logs.length).toBe(1);
    const payload = JSON.parse(io.logs[0]);
    expect(payload.path).toBe("sample_file.ts");
    expect(payload.from).toBe("HEAD");
    expect(payload.to).toBe("worktree");
    expect(payload.mode).toBe("preview");
    expect(payload.max_hunks).toBe(3);
    expect(payload.max_lines).toBe(1200);
    expect(payload.untracked).toBe(false);
    expect(payload.binary).toBe(false);
    expect(payload.error).toBeUndefined();
    expect(payload.diff).toMatch(/diff --git/);
    expect(payload.diff).toMatch(/-beta/);
    expect(payload.diff).toMatch(/\+BETA/);
    expect(payload.diff).toMatch(/\+epsilon/);
    expect(payload.hunk_count > 0).toBe(true);
    expect(payload.rendered_hunk_count).toBe(payload.hunk_count);
    expect(payload.truncated).toBe(false);
    expect(payload.line_count > 0).toBe(true);
  });

  test("diff with same-worktree range short-circuits without spawning git", async () => {
    const io = captureIo();
    await runAndCatchExit([
      "diff",
      "--path",
      "sample_file.ts",
      "--from",
      "worktree",
      "--to",
      "worktree",
      "--cwd",
      repo,
      "--json",
    ]);
    expect(io.exits).toEqual([]);
    const payload = JSON.parse(io.logs[0]);
    expect(payload.from).toBe("worktree");
    expect(payload.to).toBe("worktree");
    expect(payload.diff).toBe("");
    expect(payload.hunk_count).toBe(0);
    expect(payload.rendered_hunk_count).toBe(0);
    expect(payload.line_count).toBe(0);
    expect(payload.truncated).toBe(false);
    expect(payload.binary).toBe(false);
  });

  test("diff --max-hunks=1 truncates to one hunk and sets truncated=true", async () => {
    const baseLines = Array.from(
      { length: 45 },
      (_, index) => `stable-line-${index + 1}`,
    );
    writeFileSync(join(repo, "sample_multi.ts"), `${baseLines.join("\n")}\n`);
    git(repo, ["add", "sample_multi.ts"]);
    git(repo, ["commit", "-m", "sample add multi-hunk file"]);
    const editedLines = [...baseLines];
    for (const index of [0, 10, 20, 30]) {
      editedLines[index] = `edited-line-${index + 1}`;
    }
    writeFileSync(join(repo, "sample_multi.ts"), `${editedLines.join("\n")}\n`);

    const fullIo = captureIo();
    await runAndCatchExit([
      "diff",
      "--path",
      "sample_multi.ts",
      "--cwd",
      repo,
      "--full",
      "--json",
    ]);
    expect(fullIo.exits).toEqual([]);
    const fullPayload = JSON.parse(fullIo.logs[0]);
    expect(fullPayload.mode).toBe("full");
    expect(fullPayload.max_hunks).toBe(null);
    expect(fullPayload.max_lines).toBe(null);
    expect(fullPayload.hunk_count >= 4).toBe(true);
    expect(fullPayload.rendered_hunk_count).toBe(fullPayload.hunk_count);
    expect(fullPayload.truncated).toBe(false);
    restoreIo();

    const cappedIo = captureIo();
    await runAndCatchExit([
      "diff",
      "--path",
      "sample_multi.ts",
      "--cwd",
      repo,
      "--max-hunks",
      "1",
      "--json",
    ]);
    expect(cappedIo.exits).toEqual([]);
    const cappedPayload = JSON.parse(cappedIo.logs[0]);
    expect(cappedPayload.mode).toBe("preview");
    expect(cappedPayload.max_hunks).toBe(1);
    expect(cappedPayload.rendered_hunk_count).toBe(1);
    expect(cappedPayload.hunk_count > 1).toBe(true);
    expect(cappedPayload.truncated).toBe(true);
  });

  test("diff --untracked compares an untracked worktree file to /dev/null", async () => {
    const io = captureIo();
    await runAndCatchExit([
      "diff",
      "--path",
      "sample_untracked.ts",
      "--untracked",
      "--cwd",
      repo,
      "--json",
    ]);
    expect(io.exits).toEqual([]);
    const payload = JSON.parse(io.logs[0]);
    expect(payload.untracked).toBe(true);
    expect(payload.from).toBe("/dev/null");
    expect(payload.to).toBe("worktree");
    expect(payload.diff).toMatch(/\+fresh/);
    expect(payload.diff).toMatch(/\+file/);
  });

  test("diff for a missing path reports a git error and exits 1", async () => {
    const io = captureIo();
    await runAndCatchExit([
      "diff",
      "--path",
      "sample_does_not_exist.ts",
      "--untracked",
      "--cwd",
      repo,
      "--json",
    ]);
    expect(io.exits).toEqual([1]);
    const payload = JSON.parse(io.logs[0]);
    expect(typeof payload.error).toBe("string");
    expect(payload.error.length > 0).toBe(true);
  });

  test("diff text mode prints the unified diff verbatim", async () => {
    const io = captureIo();
    await runAndCatchExit(["diff", "--path", "sample_file.ts", "--cwd", repo]);
    expect(io.exits).toEqual([]);
    expect(io.logs.length).toBe(1);
    expect(io.logs[0]).toMatch(/diff --git/);
  });
});
