import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  ENTRY_WAKE_TIMEOUT_MS,
  resolveRepoRootSafe,
  resolveServerUrl,
  type ServerProbe,
  type ServerUrlDeps,
  screenBaseUrl,
  takeGlobalCliOption,
  validateRefValue,
  validateRepoRelativePathValue,
} from "../server/cli-helpers";
import type { EntryIdentityVerification } from "../server/entry/entry-file";
import {
  rootFileKey,
  type ServerRegistryEntry,
  writeServerRegistry,
} from "../server/server-registry";

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

describe("resolveServerUrl: which server a CLI command talks to", () => {
  const ROOT = "/example/sample-app";
  const ENTRY = "http://127.0.0.1:65000";
  const BACKEND = "http://127.0.0.1:65001";
  const KEY = "0123456789abcdef";
  const backendEntry = (url = BACKEND): ServerRegistryEntry => ({
    url: `${url}/`,
    pid: 4242,
    root: ROOT,
    started_at: "2026-01-01T00:00:00.000Z",
    backend: true,
  });
  const standaloneEntry: ServerRegistryEntry = {
    url: "http://127.0.0.1:65002/",
    pid: 4343,
    root: ROOT,
    started_at: "2026-01-01T00:00:00.000Z",
  };
  const openBody = JSON.stringify({
    url: `${ENTRY}/p/${KEY}/`,
    key: KEY,
    root: ROOT,
  });
  type Answer = { status: number; body: string } | { throws: Error };
  const timeout = () =>
    Object.assign(new Error("The operation was aborted due to timeout"), {
      name: "TimeoutError",
    });

  function run(options: {
    override?: string;
    registry: ServerRegistryEntry | null;
    /** 裏を起こす要求 (`/p/<鍵>/_settings`) に 200 を返した後の登録簿。 */
    registryAfterWake?: ServerRegistryEntry | null;
    entry: boolean;
    identity?: EntryIdentityVerification;
    probe?: (url: string) => ServerProbe;
    answers?: Record<string, Answer[]>;
  }) {
    let registry = options.registry;
    const calls: string[] = [];
    const notices: string[] = [];
    const deps: ServerUrlDeps = {
      readRegistry: () => registry,
      probe: async (url) =>
        options.probe?.(url) ??
        (url === BACKEND
          ? { status: "ok" }
          : { status: "unreachable", error: new Error(`GET ${url} refused`) }),
      liveEntry: () =>
        options.entry
          ? {
              url: `${ENTRY}/`,
              pid: 4141,
              token: KEY,
              version: "0.0.0",
              started_at: "2026-01-01T00:00:00.000Z",
            }
          : null,
      verifyEntry: async () => options.identity ?? { status: "ok" },
      fetch: async (url, init) => {
        const path = url.slice(ENTRY.length);
        calls.push(
          `${init.method} ${path}${init.body ? ` ${String(init.body)}` : ""}`,
        );
        const answer = options.answers?.[path]?.shift();
        if (!answer) throw new Error(`unexpected request ${path}`);
        if ("throws" in answer) throw answer.throws;
        if (path.startsWith("/p/") && answer.status === 200)
          registry = options.registryAfterWake ?? null;
        return new Response(answer.body, { status: answer.status });
      },
      notice: (message) => notices.push(message),
      wakeTimeoutMs: ENTRY_WAKE_TIMEOUT_MS,
    };
    return resolveServerUrl(ROOT, options.override, "/_annotations", deps).then(
      (result) => ({ result, calls, notices }),
    );
  }

  const wakePath = `/p/${KEY}/_settings`;
  const openCall = `POST /_entry/open ${JSON.stringify({ path: ROOT })}`;

  test.each([
    {
      name: "a registered project process that answers is used as it is",
      options: { registry: backendEntry(), entry: true },
      url: BACKEND,
      calls: [],
    },
    {
      name: "no project process: the entry server is asked to open the project and start its process",
      options: {
        registry: null,
        registryAfterWake: backendEntry(),
        entry: true,
        answers: {
          "/_entry/open": [{ status: 200, body: openBody }],
          [wakePath]: [{ status: 200, body: "{}" }],
        },
      },
      url: BACKEND,
      calls: [openCall, `GET ${wakePath}`],
    },
    {
      name: "a registered project process that no longer answers is started again through the entry server",
      options: {
        registry: backendEntry("http://127.0.0.1:65009"),
        registryAfterWake: backendEntry(),
        entry: true,
        answers: {
          "/_entry/open": [{ status: 200, body: openBody }],
          [wakePath]: [{ status: 200, body: "{}" }],
        },
      },
      url: BACKEND,
      calls: [openCall, `GET ${wakePath}`],
    },
    {
      name: "a stopped project process (502 backend-stopped) is restarted once, as the Restart button does",
      options: {
        registry: null,
        registryAfterWake: backendEntry(),
        entry: true,
        answers: {
          "/_entry/open": [{ status: 200, body: openBody }],
          [wakePath]: [
            {
              status: 502,
              body: JSON.stringify({
                error: "the process for this project stopped",
                code: "backend-stopped",
              }),
            },
            { status: 200, body: "{}" },
          ],
          "/_entry/restart": [{ status: 200, body: '{"ok":true}' }],
        },
      },
      url: BACKEND,
      calls: [
        openCall,
        `GET ${wakePath}`,
        `POST /_entry/restart ${JSON.stringify({ key: KEY })}`,
        `GET ${wakePath}`,
      ],
    },
  ])("$name", async ({ options, url, calls }) => {
    const run1 = await run(options);
    expect(run1.result).toEqual({ status: "ok", url });
    expect(run1.calls).toEqual(calls);
    expect(run1.notices).toEqual(
      calls.length > 0
        ? [
            `starting the code-viewer project process for ${ROOT} through the entry server at ${ENTRY}…`,
          ]
        : [],
    );
  });

  test.each([
    {
      name: "--server that does not answer fails without looking anywhere else",
      options: {
        override: "http://127.0.0.1:65003/",
        registry: null,
        entry: true,
      },
      contains: [
        "could not reach the code-viewer server at http://127.0.0.1:65003.",
        "GET http://127.0.0.1:65003 refused",
      ],
      calls: [],
    },
    {
      name: "a --standalone server that does not answer is not replaced through the entry server",
      options: { registry: standaloneEntry, entry: true },
      contains: [
        "no running code-viewer server for this repository.",
        `Start one (from ${ROOT}), then run this command again:\n  code-viewer`,
        "The registered server at http://127.0.0.1:65002 (pid 4343) could not be reached",
      ],
      calls: [],
    },
    {
      name: "no entry server either: says to start code-viewer and leave it running",
      options: { registry: null, entry: false },
      contains: [
        "no running code-viewer server for this repository, and no code-viewer entry server is running.",
        `Start code-viewer (from ${ROOT}) in another terminal and leave it running, then run this command again:\n  code-viewer`,
      ],
      calls: [],
    },
    {
      name: "an entry record whose server is not the entry is not asked",
      options: {
        registry: null,
        entry: true,
        identity: {
          status: "invalid" as const,
          detail:
            "the server at http://127.0.0.1:65000/ failed identity verification",
        },
      },
      contains: [
        `the code-viewer entry server at ${ENTRY} (pid 4141) could not start one for ${ROOT}:`,
        "failed identity verification",
      ],
      calls: [],
    },
    {
      name: "the entry server refusing to open the project: its status and whole body",
      options: {
        registry: null,
        entry: true,
        answers: {
          "/_entry/open": [
            {
              status: 404,
              body: '{"error":"/example/sample-app does not exist","code":"not-found"}',
            },
          ],
        },
      },
      contains: [
        "asking the entry server to open the project answered HTTP 404:",
        '{"error":"/example/sample-app does not exist","code":"not-found"}',
      ],
      calls: [openCall],
    },
    {
      name: "a project process that cannot start (503): the entry server's detail and log",
      options: {
        registry: null,
        entry: true,
        answers: {
          "/_entry/open": [{ status: 200, body: openBody }],
          [wakePath]: [
            {
              status: 503,
              body: JSON.stringify({
                error: "the process for this project did not start",
                code: "backend-start-failed",
                detail:
                  "the project process for /example/sample-app did not start in time",
                log: "sample log line",
              }),
            },
          ],
        },
      },
      contains: [
        "the entry server, while starting the project process, answered HTTP 503:",
        "did not start in time",
        "sample log line",
      ],
      calls: [openCall, `GET ${wakePath}`],
    },
    {
      name: "the entry server not answering in time: how long it waited and the cause",
      options: {
        registry: null,
        entry: true,
        answers: {
          "/_entry/open": [{ status: 200, body: openBody }],
          [wakePath]: [{ throws: timeout() }],
        },
      },
      contains: [
        `the entry server, while starting the project process, did not answer within ${ENTRY_WAKE_TIMEOUT_MS / 1000} seconds:`,
        `GET ${ENTRY}${wakePath} failed`,
        "The operation was aborted due to timeout",
      ],
      calls: [openCall, `GET ${wakePath}`],
    },
    {
      name: "a started process missing from the registry is reported, not guessed",
      options: {
        registry: null,
        registryAfterWake: null,
        entry: true,
        answers: {
          "/_entry/open": [{ status: 200, body: openBody }],
          [wakePath]: [{ status: 200, body: "{}" }],
        },
      },
      contains: [`no project process for ${ROOT} is in the server registry`],
      calls: [openCall, `GET ${wakePath}`],
    },
  ])("$name", async ({ options, contains, calls }) => {
    const run1 = await run(options);
    expect(run1.result.status).toBe("error");
    const message = run1.result.status === "error" ? run1.result.message : "";
    for (const part of contains) expect(message).toContain(part);
    expect(run1.calls).toEqual(calls);
  });
});
