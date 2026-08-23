import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  configureExternalCommands,
  resetExternalCommandsForTest,
} from "../server/command-resolver";
import {
  commitHistoryAsync,
  defaultBranchResultAsync,
  localBranchExistsResultAsync,
  refCommitPageResultAsync,
  refsResultAsync,
  repoRootResult,
  untrackedMetaAsync,
  verifyTreeRefResultAsync,
  worktreeListResultAsync,
} from "../server/git";
import { defaultMcpTools, dispatchJsonRpc } from "../server/mcp";
import { grepRepoAsync, listRepoFilesAsync } from "../server/search-service";
import { runGit } from "./_git-fixture";

const tmpRoots: string[] = [];

afterEach(() => {
  resetExternalCommandsForTest();
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(root);
  return root;
}

function fakeMissingGit(): string {
  const root = tempRoot("code-viewer-missing-git-bin-");
  const path = join(root, "git");
  writeFileSync(
    path,
    "#!/bin/sh\nprintf 'spawn git ENOENT\\n' >&2\nexit 127\n",
  );
  chmodSync(path, 0o755);
  return path;
}

function fakeFailingGit(): string {
  const root = tempRoot("code-viewer-failing-git-bin-");
  const path = join(root, "git");
  writeFileSync(
    path,
    "#!/bin/sh\nprintf 'fatal: simulated git failure\\n' >&2\nexit 2\n",
  );
  chmodSync(path, 0o755);
  return path;
}

// A git that localizes "not a git repository" unless asked for the C locale,
// the way a translated git does for a non-English LANG.
function fakeTranslatedGit(): string {
  const root = tempRoot("code-viewer-translated-git-bin-");
  const path = join(root, "git");
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      'if [ "$LC_ALL" = "C" ]; then',
      "  printf 'fatal: not a git repository (or any of the parent directories): .git\\n' >&2",
      "else",
      "  printf 'fatal: localized message placeholder: .git\\n' >&2",
      "fi",
      "exit 128",
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o755);
  return path;
}

function fakeSlowGit(): string {
  const root = tempRoot("code-viewer-slow-git-bin-");
  const path = join(root, "git");
  writeFileSync(path, "#!/bin/sh\nexec /bin/sleep 10\n");
  chmodSync(path, 0o755);
  return path;
}

function configureMissingGit(cwd: string): void {
  const configured = configureExternalCommands({
    cwd,
    env: {},
    cliOverrides: [{ name: "git", path: fakeMissingGit() }],
    allowedNames: ["git"],
  });
  expect(configured).toEqual({ ok: true });
}

function configureFailingGit(cwd: string): void {
  const configured = configureExternalCommands({
    cwd,
    env: {},
    cliOverrides: [{ name: "git", path: fakeFailingGit() }],
    allowedNames: ["git"],
  });
  expect(configured).toEqual({ ok: true });
}

function configureTranslatedGit(cwd: string): void {
  const configured = configureExternalCommands({
    cwd,
    env: {},
    cliOverrides: [{ name: "git", path: fakeTranslatedGit() }],
    allowedNames: ["git"],
  });
  expect(configured).toEqual({ ok: true });
}

async function callMcpTool(name: string, args: Record<string, unknown>) {
  const result = await dispatchJsonRpc(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    },
    { tools: defaultMcpTools() },
  );
  if (result.kind !== "response") throw new Error("expected MCP response");
  return result.body.result as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
}

describe("git command failures", () => {
  test("applies caller cancellation and a dedicated timeout to worktree listing", async () => {
    const cwd = tempRoot("code-viewer-worktree-list-cwd-");
    let configured = configureExternalCommands({
      cwd,
      env: {},
      cliOverrides: [{ name: "git", path: fakeSlowGit() }],
      allowedNames: ["git"],
    });
    expect(configured).toEqual({ ok: true });

    const controller = new AbortController();
    controller.abort();
    const aborted = await worktreeListResultAsync(cwd, {
      signal: controller.signal,
      timeout: 5_000,
    });
    expect(aborted.error).toMatch(/abort/i);

    resetExternalCommandsForTest();
    configured = configureExternalCommands({
      cwd,
      env: {},
      cliOverrides: [{ name: "git", path: fakeSlowGit() }],
      allowedNames: ["git"],
    });
    expect(configured).toEqual({ ok: true });
    const timedOut = await worktreeListResultAsync(cwd, { timeout: 10 });
    expect(timedOut.error).toMatch(/ETIMEDOUT/);
  });

  test("preserves and logs stderr from an ordinary git failure", async () => {
    const cwd = tempRoot("code-viewer-failing-git-cwd-");
    configureFailingGit(cwd);
    const originalError = console.error;
    const logged: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };

    try {
      const history = await commitHistoryAsync(cwd, {
        ref: "HEAD",
        skip: 0,
        limit: 5,
      });

      expect(history.error).toBe("fatal: simulated git failure");
      expect(logged).toEqual([
        [
          "[code-viewer] unknown ref (git exit 2): fatal: simulated git failure",
        ],
      ]);
    } finally {
      console.error = originalError;
    }
  });

  test("propagates command-not-found from tree-ref validation and search", async () => {
    const cwd = tempRoot("code-viewer-missing-git-cwd-");
    configureMissingGit(cwd);

    const ref = await verifyTreeRefResultAsync("HEAD", cwd);
    expect(ref.ok).toBe(false);
    if (ref.ok === false) {
      expect(ref.status).toBe(503);
      expect(ref.error).toMatch(/git binary not found|git not found/);
    }

    const env = { cwd, omitDirNames: [], excludeNames: [] };
    const grep = await grepRepoAsync(env, {
      query: "sample",
      ref: "HEAD",
      paths: [],
      regex: false,
      max: 10,
    });
    expect(grep.ok).toBe(false);
    if (grep.ok === false) expect(grep.status).toBe(503);

    const files = await listRepoFilesAsync(env, "HEAD", 1);
    expect(files.ok).toBe(false);
    if (files.ok === false) expect(files.status).toBe(503);

    const emptyGrep = await grepRepoAsync(env, {
      query: "",
      ref: "HEAD",
      paths: [],
      regex: false,
      max: 10,
    });
    expect(emptyGrep.ok).toBe(false);
    if (emptyGrep.ok === false) expect(emptyGrep.status).toBe(503);
  });

  test("propagates command-not-found from history and refs helpers", async () => {
    const cwd = tempRoot("code-viewer-missing-git-history-");
    configureMissingGit(cwd);

    const history = await commitHistoryAsync(cwd, {
      ref: "HEAD",
      skip: 0,
      limit: 5,
    });
    expect(history.status).toBe(503);
    expect(history.error).toMatch(/git binary not found|git not found/);

    const commits = await refCommitPageResultAsync(cwd);
    expect(commits.status).toBe(503);
    expect(commits.error).toMatch(/git binary not found|git not found/);

    const refs = await refsResultAsync(cwd);
    expect(refs.status).toBe(503);
    expect(refs.error).toMatch(/git binary not found|git not found/);
  });

  test("distinguishes a missing branch from a failed git lookup", async () => {
    const repository = tempRoot("code-viewer-branch-lookup-");
    runGit(repository, ["init", "-q", "-b", "main", "."]);
    runGit(repository, ["config", "user.email", "test@example.com"]);
    runGit(repository, ["config", "user.name", "test"]);
    runGit(repository, ["commit", "--allow-empty", "-qm", "initial"]);
    expect(
      await localBranchExistsResultAsync(repository, "missing-branch"),
    ).toEqual({ exists: false });
    expect(await defaultBranchResultAsync(repository)).toEqual({
      branch: "main",
    });

    const failed = tempRoot("code-viewer-branch-lookup-failed-");
    configureMissingGit(failed);
    const branch = await localBranchExistsResultAsync(failed, "main");
    const defaultBranch = await defaultBranchResultAsync(failed);
    const untracked = await untrackedMetaAsync(failed);

    expect(branch.exists).toBe(false);
    expect(branch.status).toBe(503);
    expect(branch.error).toMatch(/git binary not found|git not found/);
    expect(defaultBranch.status).toBe(503);
    expect(defaultBranch.error).toMatch(/git binary not found|git not found/);
    expect(untracked.status).toBe(503);
    expect(untracked.error).toMatch(/git binary not found|git not found/);
  });

  test("propagates command-not-found through MCP search tools", async () => {
    const cwd = tempRoot("code-viewer-missing-git-mcp-");
    configureMissingGit(cwd);

    const files = await callMcpTool("code_viewer_search_files", {
      cwd,
      term: "sample",
      ref: "HEAD",
    });
    expect(files.isError).toBe(true);
    expect(files.content[0].text).toMatch(/git binary not found|git not found/);

    const code = await callMcpTool("code_viewer_search_code", {
      cwd,
      term: "sample",
      ref: "HEAD",
    });
    expect(code.isError).toBe(true);
    expect(code.content[0].text).toMatch(/git binary not found|git not found/);
  });
});

// preview.ts はこの分類で「git を呼んでも失敗すると分かっている (outside)」と
// 「判定できない (error → 従来どおり git を呼ぶ)」を分ける。outside の誤判定は
// 本物のエラーを隠し、error 側への誤判定は管理外で git を叩き続ける。
describe("repository root probe", () => {
  test.each([
    {
      name: "a directory outside any repository is outside",
      configure: (_cwd: string) => {
        // PATH 上の本物の git をそのまま使う
      },
      expected: { kind: "outside" },
    },
    {
      name: "a git that localizes its message is still read as outside",
      configure: configureTranslatedGit,
      expected: { kind: "outside" },
    },
    {
      name: "another fatal error stays an error with its message",
      configure: configureFailingGit,
      expected: { kind: "error", error: "fatal: simulated git failure" },
    },
  ])("$name", ({ configure, expected }) => {
    const cwd = tempRoot("code-viewer-repo-root-probe-");
    configure(cwd);
    expect(repoRootResult(cwd)).toEqual(expected);
  });

  test("the top of a repository is root with its real path", () => {
    const cwd = tempRoot("code-viewer-repo-root-probe-root-");
    runGit(cwd, ["init", "-q", "-b", "main", "."]);
    expect(repoRootResult(cwd)).toEqual({
      kind: "root",
      root: realpathSync(cwd),
    });
  });

  test("a missing git binary is an error, not outside", () => {
    const cwd = tempRoot("code-viewer-repo-root-probe-missing-");
    configureMissingGit(cwd);
    const result = repoRootResult(cwd);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.error).toMatch(/git binary not found|git not found/);
    }
  });
});
