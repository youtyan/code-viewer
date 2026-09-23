// サーバの本体 (MCP・作業ツリーの走査・組み込みの検索) が、失敗の理由を捨てず、
// 読めない場所を黙って「無い」にしないこと。
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { errorWithCause } from "../core/error-detail";
import {
  configureExternalCommands,
  resetExternalCommandsForTest,
} from "../server/command-resolver";
import { listTreeAsync } from "../server/git";
import { dispatchJsonRpc, parseJsonRpcBody } from "../server/mcp";
import { grepRepoAsync, resetRgAvailableCache } from "../server/search-service";

const locked: string[] = [];
const roots: string[] = [];
function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(dir);
  return dir;
}
function lockedPath(path: string): string {
  chmodSync(path, 0);
  locked.push(path);
  return path;
}

afterEach(() => {
  vi.restoreAllMocks();
  resetExternalCommandsForTest();
  resetRgAvailableCache();
  for (const path of locked.splice(0)) chmodSync(path, 0o700);
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const codeOf = (error: unknown) => (error as NodeJS.ErrnoException).code;

describe("MCP keeps the whole failure", () => {
  test("a tool that throws answers with the cause chain and is logged", async () => {
    const failure = errorWithCause(
      "sample tool failure",
      new TypeError("sample cause"),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await dispatchJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "sample_tool", arguments: {} },
      },
      {
        tools: [
          {
            name: "sample_tool",
            title: "Sample tool",
            description: "Throws for the test",
            inputSchema: { type: "object", properties: {} },
            run: () => {
              throw failure;
            },
          },
        ],
      },
    );
    expect({
      message:
        result.kind === "response" ? result.body.error?.message : undefined,
      logged: log.mock.calls,
    }).toEqual({
      message:
        "Internal error: Error: sample tool failure\nCaused by: TypeError: sample cause",
      logged: [["[code-viewer] MCP request failed:", failure]],
    });
  });

  test("an unparsable body names the parser error", () => {
    const parsed = parseJsonRpcBody("{broken");
    expect(parsed.ok === false ? parsed.response.error?.message : "").toMatch(
      /^Parse error: SyntaxError: /,
    );
  });
});

describe("walks that meet a folder or file they cannot read", () => {
  test("the worktree listing skips an unreadable folder with a warning", async () => {
    const cwd = tempDir("code-viewer-walk-reasons-");
    writeFileSync(join(cwd, "sample.txt"), "sample\n");
    const folder = join(cwd, "locked");
    mkdirSync(folder);
    lockedPath(folder);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const listed = await listTreeAsync("worktree", "", cwd, {
      recursive: true,
    });
    expect({
      blobs: listed.entries
        .filter((entry) => entry.type === "blob")
        .map((entry) => entry.path),
      warned: warn.mock.calls.map(([message, error]) => [
        message,
        codeOf(error),
      ]),
    }).toEqual({
      blobs: ["sample.txt"],
      warned: [
        [
          `[code-viewer] the worktree file walk skipped a path it cannot read: ${folder}`,
          "EACCES",
        ],
      ],
    });
  });

  test("the built-in search says why rg was not used and which file it skipped", async () => {
    const cwd = tempDir("code-viewer-search-reasons-");
    writeFileSync(join(cwd, "sample.txt"), "sample needle\n");
    writeFileSync(join(cwd, "locked.txt"), "sample needle\n");
    lockedPath(join(cwd, "locked.txt"));
    const bin = tempDir("code-viewer-search-reasons-bin-");
    const rg = join(bin, "rg");
    writeFileSync(rg, '#!/bin/sh\necho "sample rg failure" >&2\nexit 2\n');
    chmodSync(rg, 0o755);
    expect(
      configureExternalCommands({
        cwd,
        env: {},
        cliOverrides: [{ name: "rg", path: rg }],
      }),
    ).toEqual({ ok: true });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await grepRepoAsync(
      { cwd, omitDirNames: [], excludeNames: [] },
      { query: "needle", ref: "worktree", paths: [], regex: false, max: 10 },
    );
    expect({
      matches: result.ok ? result.value.matches.map((m) => m.path) : result,
      logged: log.mock.calls,
      warned: warn.mock.calls.map(([message, error]) => [
        message,
        codeOf(error),
      ]),
    }).toEqual({
      matches: ["sample.txt"],
      logged: [
        [
          "[code-viewer] rg --version exited with 2; searching without rg this time: sample rg failure",
        ],
      ],
      warned: [
        [
          `[code-viewer] the built-in search skipped a path it cannot read: ${join(cwd, "locked.txt")}`,
          "EACCES",
        ],
      ],
    });
  });
});
