import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  configureExternalCommands,
  resetExternalCommandsForTest,
} from "../server/command-resolver";
import {
  commitHistoryAsync,
  refCommitPageResultAsync,
  refsResultAsync,
  verifyTreeRefResultAsync,
} from "../server/git";
import { defaultMcpTools, dispatchJsonRpc } from "../server/mcp";
import { grepRepoAsync, listRepoFilesAsync } from "../server/search-service";

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
