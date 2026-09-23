import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  resolveRepoRootSafe,
  screenBaseUrl,
  takeGlobalCliOption,
  validateRefValue,
  validateRepoRelativePathValue,
} from "../server/cli-helpers";
import { rootFileKey, writeServerRegistry } from "../server/server-registry";

describe("takeGlobalCliOption", () => {
  test.each([
    {
      name: "consumes --cwd",
      argv: ["--cwd", "/example/repository"],
      options: { allowedCommands: ["git"] as const },
      expected: { kind: "cwd", value: "/example/repository", next: 1 },
    },
    {
      name: "consumes --server when enabled",
      argv: ["--server", "http://127.0.0.1:64160"],
      options: { allowServer: true, allowedCommands: ["git"] as const },
      expected: {
        kind: "server",
        value: "http://127.0.0.1:64160",
        next: 1,
      },
    },
    {
      name: "leaves --server to callers that do not allow it",
      argv: ["--server", "http://127.0.0.1:64160"],
      options: { allowedCommands: ["git"] as const },
      expected: { kind: "unhandled" },
    },
    {
      name: "consumes an allowed --bin override",
      argv: ["--bin", "git=/opt/bin/git"],
      options: { allowedCommands: ["git"] as const },
      expected: {
        kind: "command-override",
        override: { name: "git", path: "/opt/bin/git" },
        next: 1,
      },
    },
  ])("$name", ({ argv, options, expected }) => {
    expect(takeGlobalCliOption(argv, 0, options)).toEqual(expected);
  });

  test.each([
    {
      name: "--cwd without a value",
      argv: ["--cwd"],
      options: { allowedCommands: ["git"] as const },
      expected: { kind: "error", error: "--cwd requires a value" },
    },
    {
      name: "--server without a value",
      argv: ["--server"],
      options: { allowServer: true, allowedCommands: ["git"] as const },
      expected: { kind: "error", error: "--server requires a value" },
    },
    {
      name: "--bin without a value",
      argv: ["--bin"],
      options: { allowedCommands: ["git"] as const },
      expected: { kind: "error", error: "--bin requires a value" },
    },
    {
      name: "--bin with a disallowed command",
      argv: ["--bin", "docker=/opt/bin/docker"],
      options: { allowedCommands: ["git"] as const },
      expected: {
        kind: "error",
        error: "--bin unsupported command: docker",
      },
    },
  ])("reports $name", ({ argv, options, expected }) => {
    expect(takeGlobalCliOption(argv, 0, options)).toEqual(expected);
  });

  test.each([
    {
      name: "accepts a safe value",
      value: "source/file.ts",
      expected: undefined,
    },
    {
      name: "rejects an empty value",
      value: "",
      expected: "--value requires a non-empty value",
    },
    {
      name: "rejects a value containing NUL",
      value: "source\0file.ts",
      expected: "--value must be single-line and must not contain NUL",
    },
    {
      name: "rejects a multi-line value",
      value: "source\nfile.ts",
      expected: "--value must be single-line and must not contain NUL",
    },
    {
      name: "rejects a leading-dash value",
      value: "--source",
      expected: "--value must not start with '-'",
    },
  ])("keeps shared validation behavior: $name", ({ value, expected }) => {
    expect(validateRefValue(value, "--value")).toBe(expected);
    expect(validateRepoRelativePathValue(value, "--value")).toBe(expected);
  });
});

// 読めない --cwd は、どのパスが・なぜ (code まで) 読めないかを言う。
describe("--cwd that cannot be read", () => {
  const missing = join(tmpdir(), "code-viewer-sample-missing-cwd", "gone");
  const bundle = join(
    fileURLToPath(new URL(".", import.meta.url)),
    "..",
    "..",
    "dist",
    "code-viewer.js",
  );
  test.each([
    {
      name: "resolveRepoRootSafe",
      run: () => {
        const result = resolveRepoRootSafe(missing);
        return { exit: null, text: result.ok === false ? result.error : "" };
      },
    },
    {
      name: "the standalone server",
      run: () => {
        const child = spawnSync(
          process.execPath,
          [bundle, "--standalone", "--cwd", missing],
          { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } },
        );
        return { exit: child.status, text: child.stderr.trim() };
      },
      exit: 1,
    },
  ])("$name names the path and the reason", ({ run, exit = null }) => {
    const { exit: status, text } = run();
    const [head, ...detail] = text.split("\n");
    expect({
      exit: status,
      head,
      code: detail.join("\n").includes('"code":"ENOENT"'),
    }).toEqual({
      exit,
      head: `--cwd must point to an existing directory: ${missing}`,
      code: true,
    });
  });
});

// 入口の下では、CLI が繋ぐのは登録簿にある裏のプロセスで、その URL を開いても
// 入口の画面にならない (直す前は `query diff tables` の diffUrl に `/p/<鍵>` が
// 付かなかった)。
describe("screenBaseUrl", () => {
  const ROOT = "/example/repository";
  const BACKEND = "http://127.0.0.1:64161";
  const ENTRY = "http://127.0.0.1:64160/";
  const saved: Record<string, string | undefined> = {};
  let stateDir = "";

  beforeEach(() => {
    for (const name of [
      "CODE_VIEWER_TEST_SERVER_REGISTRY_DIR",
      "CODE_VIEWER_TEST_STATE_DIR",
    ])
      saved[name] = process.env[name];
    const dir = mkdtempSync(join(tmpdir(), "cv-screen-base-"));
    stateDir = join(dir, "state");
    process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR = join(dir, "servers");
    process.env.CODE_VIEWER_TEST_STATE_DIR = stateDir;
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    vi.restoreAllMocks();
  });

  function register(backend: boolean) {
    writeServerRegistry({
      url: `${BACKEND}/`,
      pid: process.pid,
      root: ROOT,
      started_at: "2026-01-01T00:00:00.000Z",
      ...(backend ? { backend: true } : {}),
    });
  }

  function writeEntry(content: string) {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "entry.json"), content);
  }

  function entryRecord(pid: number) {
    return JSON.stringify({
      url: ENTRY,
      pid,
      token: "0123456789abcdef",
      version: "0.0.0-test",
      started_at: "2026-01-01T00:00:00.000Z",
    });
  }

  const deadPid = () =>
    spawnSync(process.execPath, ["-e", ""]).pid ?? Number.MAX_SAFE_INTEGER;

  test.each([
    {
      name: "no registry (for example a --server to another machine) stays as given",
      setup: () => {
        // 登録簿も入口の記録も書かない。
      },
      serverUrl: `${BACKEND}/`,
      expected: BACKEND,
      stderr: null,
    },
    {
      name: "a --standalone server stays as given",
      setup: () => register(false),
      serverUrl: BACKEND,
      expected: BACKEND,
      stderr: null,
    },
    {
      name: "a project process behind a live entry gets the entry URL and key",
      setup: () => {
        register(true);
        writeEntry(entryRecord(process.pid));
      },
      serverUrl: BACKEND,
      expected: `http://127.0.0.1:64160/p/${rootFileKey(ROOT)}`,
      stderr: null,
    },
    {
      name: "a --server that is not the registered project process stays as given",
      setup: () => {
        register(true);
        writeEntry(entryRecord(process.pid));
      },
      serverUrl: "http://127.0.0.1:64999",
      expected: "http://127.0.0.1:64999",
      stderr: null,
    },
    {
      name: "a project process without an entry record is reported",
      setup: () => register(true),
      serverUrl: BACKEND,
      expected: BACKEND,
      stderr: "no entry server is running",
    },
    {
      name: "a project process whose entry is gone is reported",
      setup: () => {
        register(true);
        writeEntry(entryRecord(deadPid()));
      },
      serverUrl: BACKEND,
      expected: BACKEND,
      stderr: "no entry server is running",
    },
    {
      name: "an unreadable entry record is reported with its reason",
      setup: () => {
        register(true);
        writeEntry("{not json");
      },
      serverUrl: BACKEND,
      expected: BACKEND,
      stderr: "could not tell whether",
    },
  ])("$name", ({ setup, serverUrl, expected, stderr }) => {
    setup();
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args.join(" "));
    });
    expect(screenBaseUrl(ROOT, serverUrl)).toBe(expected);
    if (stderr === null) expect(logged).toEqual([]);
    else {
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain(stderr);
    }
  });
});
