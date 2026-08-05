import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { writeServerRegistry } from "../server/server-registry";
import {
  parseStatusArgs,
  runStatusCli,
  STATUS_AGENT_HELP,
  STATUS_DEFAULT_LIMIT,
  STATUS_HARD_CAP_LIMIT,
  STATUS_HELP,
} from "../server/status-cli";
import { runGit as git } from "./_git-fixture";
import { captureIo, catchExitAsync, restoreIo } from "./_io-fixture";

// 全テストでサーバ未登録の状態 (nextCommands の --server pin 無し経路) を
// 再現したい。registry dir を temp dir に差し替えて readServerRegistry を
// 空にする。
let originalRegistryDir: string | undefined;
let registryDirStub: string;
beforeAll(() => {
  registryDirStub = mkdtempSync(join(tmpdir(), "code-viewer-status-registry-"));
  originalRegistryDir = process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR;
  process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR = registryDirStub;
});
afterAll(() => {
  if (originalRegistryDir === undefined) {
    delete process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR;
  } else {
    process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR = originalRegistryDir;
  }
  rmSync(registryDirStub, { recursive: true, force: true });
});

describe("parseStatusArgs", () => {
  test("bare invocation defaults to ref=HEAD, limit=STATUS_DEFAULT_LIMIT, json=false", () => {
    expect(parseStatusArgs([])).toEqual({
      ok: true,
      args: {
        command: {
          kind: "run",
          ref: "HEAD",
          limit: STATUS_DEFAULT_LIMIT,
          json: false,
        },
      },
    });
  });

  test("--help / -h return help command", () => {
    expect(parseStatusArgs(["--help"])).toEqual({
      ok: true,
      args: { command: { kind: "help" } },
    });
    expect(parseStatusArgs(["-h"])).toEqual({
      ok: true,
      args: { command: { kind: "help" } },
    });
  });

  test("agent-help is recognised but rejects extra args", () => {
    expect(parseStatusArgs(["agent-help"])).toEqual({
      ok: true,
      args: { command: { kind: "agent-help" } },
    });
    expect(parseStatusArgs(["agent-help", "extra"])).toEqual({
      ok: false,
      error: "agent-help does not accept arguments",
    });
    expect(parseStatusArgs(["agent-help", "--json"])).toEqual({
      ok: false,
      error: "agent-help does not accept arguments",
    });
  });

  test("stray positional arguments are rejected", () => {
    expect(parseStatusArgs(["wat"])).toEqual({
      ok: false,
      error: "status does not accept positional argument: wat",
    });
  });

  test("unknown options are rejected", () => {
    expect(parseStatusArgs(["--unknown"])).toEqual({
      ok: false,
      error: "unknown option: --unknown",
    });
  });

  test("--cwd captures the value", () => {
    const result = parseStatusArgs(["--cwd", "/example/repo"]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("parse failed");
    expect(result.args.cwd).toBe("/example/repo");
  });

  test("--bin captures the git command override", () => {
    const result = parseStatusArgs(["--bin", "git=/opt/bin/git", "--json"]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("parse failed");
    expect(result.args.commandOverrides).toEqual([
      { name: "git", path: "/opt/bin/git" },
    ]);
    expect(result.args.command).toEqual({
      kind: "run",
      ref: "HEAD",
      limit: STATUS_DEFAULT_LIMIT,
      json: true,
    });
  });

  test("--bin rejects unsupported command names", () => {
    expect(parseStatusArgs(["--bin", "psql=/opt/bin/psql"])).toEqual({
      ok: false,
      error: "--bin unsupported command: psql",
    });
    expect(parseStatusArgs(["--bin", "docker=/opt/bin/docker"])).toEqual({
      ok: false,
      error: "--bin unsupported command: docker",
    });
  });

  test("--ref rejects empty / NUL / newline / leading-dash values", () => {
    expect(parseStatusArgs(["--ref", ""])).toEqual({
      ok: false,
      error: "--ref requires a non-empty value",
    });
    expect(parseStatusArgs(["--ref", "a\0b"])).toEqual({
      ok: false,
      error: "--ref must be single-line and must not contain NUL",
    });
    expect(parseStatusArgs(["--ref", "a\nb"])).toEqual({
      ok: false,
      error: "--ref must be single-line and must not contain NUL",
    });
    expect(parseStatusArgs(["--ref", "--inject"])).toEqual({
      ok: false,
      error: "--ref must not start with '-'",
    });
  });

  test("--limit rejects values outside [1, STATUS_HARD_CAP_LIMIT]", () => {
    for (const bad of ["0", "-3", "abc", String(STATUS_HARD_CAP_LIMIT + 1)]) {
      expect(parseStatusArgs(["--limit", bad])).toEqual({
        ok: false,
        error: `--limit must be an integer in [1, ${STATUS_HARD_CAP_LIMIT}] (got ${bad})`,
      });
    }
  });

  test("--limit accepts boundaries and --json captures the flag", () => {
    const result = parseStatusArgs(["--ref", "main", "--limit", "5", "--json"]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("parse failed");
    expect(result.args.command).toEqual({
      kind: "run",
      ref: "main",
      limit: 5,
      json: true,
    });
  });
});

describe("STATUS_HELP / STATUS_AGENT_HELP", () => {
  test("STATUS_HELP advertises status usage and agent-help", () => {
    expect(STATUS_HELP.startsWith("code-viewer status — ")).toBe(true);
    expect(STATUS_HELP).toMatch(/code-viewer status \[/);
    expect(STATUS_HELP).toMatch(/code-viewer status agent-help/);
  });
  test("STATUS_AGENT_HELP names every payload field AI agents must read", () => {
    expect(
      STATUS_AGENT_HELP.startsWith("code-viewer status — agent guide"),
    ).toBe(true);
    for (const key of [
      "repoRoot",
      "branch",
      "remoteWebUrl",
      "changed",
      "staged",
      "recentCommits",
      "nextCommands",
    ]) {
      expect(STATUS_AGENT_HELP.includes(key)).toBe(true);
    }
  });
});

// --- runStatusCli integration tests against a real sample repo ---
// captureIo / ExitMarker / catchExitAsync は `_io-fixture` に集約済み。

afterEach(() => {
  restoreIo();
  rmSync(registryDirStub, { recursive: true, force: true });
});

async function runAndCatchExit(argv: string[]): Promise<void> {
  await catchExitAsync(() => runStatusCli(argv));
}

describe("runStatusCli help and agent-help", () => {
  test("--help prints STATUS_HELP", async () => {
    const io = captureIo();
    await runAndCatchExit(["--help"]);
    expect(io.exits).toEqual([]);
    expect(io.logs.length).toBe(1);
    expect(io.logs[0]).toBe(STATUS_HELP);
  });

  test("agent-help prints STATUS_AGENT_HELP", async () => {
    const io = captureIo();
    await runAndCatchExit(["agent-help"]);
    expect(io.exits).toEqual([]);
    expect(io.logs.length).toBe(1);
    expect(io.logs[0]).toBe(STATUS_AGENT_HELP);
  });

  test("unknown option exits 1 with usage hint", async () => {
    const io = captureIo();
    await runAndCatchExit(["--bogus"]);
    expect(io.exits).toEqual([1]);
    expect(io.errs[0]).toBe("unknown option: --bogus");
    expect(io.errs[1]).toBe('Run "code-viewer status --help" for usage.');
  });
});

describe("runStatusCli against a fixture repo", () => {
  let repo: string;
  let firstSha: string;
  let secondSha: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "code-viewer-status-cli-"));
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.email", "sample-author"]);
    git(repo, ["config", "user.name", "sample-author"]);
    // 2 コミット作成。一つは src/sample.ts、もう一つは README.md。
    writeFileSync(join(repo, "src-sample.ts"), "export const sample = 1;\n");
    git(repo, ["add", "src-sample.ts"]);
    git(repo, ["commit", "-m", "sample initial commit"]);
    firstSha = git(repo, ["rev-parse", "HEAD"]).stdout.trim();
    writeFileSync(join(repo, "sample-readme.md"), "sample readme line 1\n");
    git(repo, ["add", "sample-readme.md"]);
    git(repo, ["commit", "-m", "sample readme commit"]);
    secondSha = git(repo, ["rev-parse", "HEAD"]).stdout.trim();
    // unstaged tracked edit: src-sample.ts に追記 (worktree-vs-HEAD で M)。
    writeFileSync(
      join(repo, "src-sample.ts"),
      "export const sample = 1;\nexport const extra = 2;\n",
    );
    // staged 新規ファイル: index に乗せておく (--cached でも M / A)。
    writeFileSync(join(repo, "staged-sample.ts"), "export const staged = 3;\n");
    git(repo, ["add", "staged-sample.ts"]);
    // untracked: 何にも触っていない新規ファイル (changed 側のみに出る)。
    writeFileSync(
      join(repo, "untracked-sample.ts"),
      "export const untracked = 4;\n",
    );
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  test("--json emits the structured payload AI agents consume", async () => {
    const io = captureIo();
    await runAndCatchExit(["--cwd", repo, "--json"]);
    expect(io.exits).toEqual([]);
    expect(io.errs).toEqual([]);
    expect(io.logs.length).toBe(1);
    const payload = JSON.parse(io.logs[0]);

    expect(typeof payload.repoRoot).toBe("string");
    expect(
      payload.repoRoot.endsWith(repo.replace(/^\/private/, "")) ||
        payload.repoRoot.endsWith(repo),
    ).toBe(true);
    expect(payload.branch).toBe("main");
    // sample fixture has no remote configured; remoteWebUrl must be null.
    expect(payload.remoteWebUrl).toBeNull();

    // changed (worktree vs HEAD): src-sample.ts (M, unstaged), staged-sample.ts (A,
    // staged), untracked-sample.ts (untracked).
    const changedPaths = payload.changed.files
      .map((f: { path: string }) => f.path)
      .sort();
    expect(changedPaths).toEqual([
      "src-sample.ts",
      "staged-sample.ts",
      "untracked-sample.ts",
    ]);
    expect(payload.changed.totals.files).toBe(3);

    // staged (index vs HEAD): staged-sample.ts のみ。
    const stagedPaths = payload.staged.files.map(
      (f: { path: string }) => f.path,
    );
    expect(stagedPaths).toEqual(["staged-sample.ts"]);
    expect(payload.staged.totals.files).toBe(1);

    expect(payload.recentCommits.length).toBe(2);
    expect(payload.recentCommits[0].sha).toBe(secondSha);
    expect(payload.recentCommits[1].sha).toBe(firstSha);
    expect(payload.recentCommits[0].subject).toBe("sample readme commit");

    // nextCommands: server registry が空なので --server pin は付かない。
    // sample changed path を含む file history hint + search code hint が必ず出る。
    // query sources --commands は server 不在で省略される。
    expect(Array.isArray(payload.nextCommands)).toBe(true);
    const cmdStr = payload.nextCommands.join("\n");
    expect(cmdStr).toMatch(
      /^code-viewer file history --path '(staged-sample\.ts|src-sample\.ts|untracked-sample\.ts)' --limit 10 --json$/m,
    );
    expect(cmdStr).toMatch(/^code-viewer search code --term 'TODO' --json$/m);
    expect(/--server '/.test(cmdStr)).toBe(false);
    expect(/query sources --commands/.test(cmdStr)).toBe(false);
  });

  test("--limit caps recentCommits length", async () => {
    const io = captureIo();
    await runAndCatchExit(["--cwd", repo, "--limit", "1", "--json"]);
    expect(io.exits).toEqual([]);
    const payload = JSON.parse(io.logs[0]);
    expect(payload.recentCommits.length).toBe(1);
    expect(payload.recentCommits[0].sha).toBe(secondSha);
  });

  test("default text output groups branch / changed / staged / recent / next steps", async () => {
    const io = captureIo();
    await runAndCatchExit(["--cwd", repo]);
    expect(io.exits).toEqual([]);
    expect(io.logs.length).toBe(1);
    const out = io.logs[0];
    // sectional headers (intent: AI / human can split on /\n\n/).
    expect(out).toMatch(/^repo:\s+/m);
    expect(out).toMatch(/^branch:\s+main$/m);
    expect(out).toMatch(/^remote:\s+\(none\)$/m);
    expect(out).toMatch(/^changed \(worktree vs HEAD\): 3 files /m);
    expect(out).toMatch(/^staged \(index vs HEAD\): 1 files /m);
    expect(out).toMatch(/^recent commits: 2$/m);
    expect(out).toMatch(/^next steps:$/m);
    // 各 changed file 行 / staged 行 / recent commit 行が含まれる。
    expect(/staged-sample\.ts/.test(out)).toBe(true);
    expect(/src-sample\.ts/.test(out)).toBe(true);
    expect(/untracked-sample\.ts/.test(out)).toBe(true);
    expect(out.includes(secondSha.slice(0, 8))).toBe(true);
    expect(out.includes(firstSha.slice(0, 8))).toBe(true);
    // next steps セクションには必ず search code 行が出る。
    expect(out).toMatch(/ {2}code-viewer search code --term 'TODO' --json/);
  });

  test("an unreachable --ref surfaces the error inside recentCommitsError but still emits the rest", async () => {
    const io = captureIo();
    await runAndCatchExit([
      "--cwd",
      repo,
      "--ref",
      "this-ref-does-not-exist",
      "--json",
    ]);
    expect(io.exits).toEqual([]);
    expect(io.logs.length).toBe(1);
    const payload = JSON.parse(io.logs[0]);
    expect(payload.recentCommits).toEqual([]);
    expect(typeof payload.recentCommitsError).toBe("string");
    // changed / staged は git の他の経路で取れているので残る。
    expect(payload.changed.totals.files).toBe(3);
    expect(payload.staged.totals.files).toBe(1);
  });

  test("registered server is pinned only on server-backed next commands", async () => {
    const registryRoot = git(repo, [
      "rev-parse",
      "--show-toplevel",
    ]).stdout.trim();
    writeServerRegistry({
      root: registryRoot,
      url: "http://127.0.0.1:64160",
      pid: 12345,
      started_at: "2026-06-30T00:00:00.000Z",
    });
    const io = captureIo();
    await runAndCatchExit(["--cwd", repo, "--json"]);
    expect(io.exits).toEqual([]);
    const payload = JSON.parse(io.logs[0]);
    const commands = payload.nextCommands as string[];

    expect(
      commands.some((command) =>
        /^code-viewer file history --path /.test(command),
      ),
    ).toBe(true);
    expect(
      commands.some((command) =>
        /^code-viewer file history --server /.test(command),
      ),
    ).toBe(false);
    expect(
      commands.includes(
        "code-viewer search code --server 'http://127.0.0.1:64160' --term 'TODO' --json",
      ),
    ).toBe(true);
    expect(
      commands.includes(
        "code-viewer query sources --server 'http://127.0.0.1:64160' --commands",
      ),
    ).toBe(true);
  });

  test("nextCommands omit file history when every changed path is unsafe for file CLI", async () => {
    const oddRepo = mkdtempSync(join(tmpdir(), "code-viewer-status-odd-path-"));
    try {
      git(oddRepo, ["init", "-b", "main"]);
      git(oddRepo, ["config", "user.email", "sample-author"]);
      git(oddRepo, ["config", "user.name", "sample-author"]);
      writeFileSync(join(oddRepo, "base.txt"), "base\n");
      git(oddRepo, ["add", "base.txt"]);
      git(oddRepo, ["commit", "-m", "base"]);
      writeFileSync(join(oddRepo, "line\nbreak.ts"), "odd\n");

      const io = captureIo();
      await runAndCatchExit(["--cwd", oddRepo, "--json"]);
      expect(io.exits).toEqual([]);
      const payload = JSON.parse(io.logs[0]);
      const commands = payload.nextCommands as string[];

      expect(
        commands.some((command) => command.startsWith("code-viewer file ")),
      ).toBe(false);
      expect(
        commands.includes("code-viewer search code --term 'TODO' --json"),
      ).toBe(true);
    } finally {
      rmSync(oddRepo, { recursive: true, force: true });
    }
  });

  test("unborn repositories still report staged and untracked changes", async () => {
    const emptyRepo = mkdtempSync(join(tmpdir(), "code-viewer-status-empty-"));
    try {
      git(emptyRepo, ["init", "-b", "main"]);
      git(emptyRepo, ["config", "user.email", "sample-author"]);
      git(emptyRepo, ["config", "user.name", "sample-author"]);
      writeFileSync(join(emptyRepo, "staged-before-first-commit.ts"), "1\n");
      git(emptyRepo, ["add", "staged-before-first-commit.ts"]);
      writeFileSync(join(emptyRepo, "untracked-before-first-commit.ts"), "2\n");

      const io = captureIo();
      await runAndCatchExit(["--cwd", emptyRepo, "--json"]);
      expect(io.exits).toEqual([]);
      const payload = JSON.parse(io.logs[0]);
      const changedPaths = payload.changed.files.map(
        (f: { path: string }) => f.path,
      );
      const stagedPaths = payload.staged.files.map(
        (f: { path: string }) => f.path,
      );

      expect(changedPaths).toEqual([
        "staged-before-first-commit.ts",
        "untracked-before-first-commit.ts",
      ]);
      expect(stagedPaths).toEqual(["staged-before-first-commit.ts"]);
      expect(payload.recentCommits).toEqual([]);
      expect(payload.recentCommitsError).toBe(
        "fatal: Needed a single revision",
      );
    } finally {
      rmSync(emptyRepo, { recursive: true, force: true });
    }
  });
});
