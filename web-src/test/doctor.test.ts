import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
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
import {
  _classifySqliteLoadError,
  _parseSqliteAbiMismatchMessage,
  describeSqliteDriver,
} from "../server/database/sqlite-driver";
import {
  buildDoctorReport,
  checkServer,
  findCodeViewerPackageJson,
  handleDoctor,
  shellAvailabilityToRow,
  sqliteStatusToRow,
} from "../server/doctor";
import { serverRegistryFilePath } from "../server/server-registry";
import { runGit } from "./_git-fixture";

// Use a fresh empty directory as cwd so doctor's discovery (Sqlite files /
// compose files) and docker daemon probes finish quickly inside the 5s
// per-test budget even on CI runners where docker may be installed but
// the daemon is down.
const TEST_CWD = mkdtempSync(join(tmpdir(), "code-viewer-doctor-test-"));

describe("sqlite driver diagnostics", () => {
  test("parses NODE_MODULE_VERSION mismatch messages", () => {
    const message =
      "The module '/home/u/.npm/_npx/abc/node_modules/better-sqlite3/build/Release/better_sqlite3.node'\n" +
      "was compiled against a different Node.js version using\n" +
      "NODE_MODULE_VERSION 127. This version of Node.js requires\n" +
      "NODE_MODULE_VERSION 137. Please try re-compiling or re-installing.";
    const parsed = _parseSqliteAbiMismatchMessage(message);
    expect(parsed?.compiledAbi).toBe(127);
    expect(parsed?.runtimeAbi).toBe(137);
    expect(parsed?.modulePath).toBe(
      "/home/u/.npm/_npx/abc/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    );
  });

  test("returns null for unrelated error messages", () => {
    expect(_parseSqliteAbiMismatchMessage("ENOENT: no such file")).toBeNull();
    expect(_parseSqliteAbiMismatchMessage("")).toBeNull();
  });

  // DB を開けなかった理由ごとの状態と直し方。部品が無い (install スクリプトが
  // 走っていない) のは「入れ直す」でなく rebuild を案内する。
  test.each([
    [
      "NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 137.",
      "abi-mismatch",
      "rm -rf ~/.npm/_npx",
    ],
    [
      "Could not locate the bindings file. Tried:\n → /x/build/better_sqlite3.node",
      "unavailable",
      "npm rebuild better-sqlite3",
    ],
    [
      "Cannot find package 'better-sqlite3' imported from /x/dist/code-viewer.js",
      "unavailable",
      "npm i better-sqlite3",
    ],
  ])("a load failure %j is %s with the hint %j", (message, kind, hint) => {
    const status = _classifySqliteLoadError(message);
    expect(status.kind).toBe(kind);
    expect(status.hint).toContain(hint);
  });

  test("describeSqliteDriver returns a status with a known kind", async () => {
    const status = await describeSqliteDriver();
    const known =
      status.kind === "ok" ||
      status.kind === "abi-mismatch" ||
      status.kind === "unavailable";
    expect(known).toBe(true);
  });

  test("sqliteStatusToRow surfaces remediation hints for abi mismatch", () => {
    const row = sqliteStatusToRow({
      kind: "abi-mismatch",
      driver: "better-sqlite3",
      compiledAbi: 127,
      runtimeAbi: 137,
      modulePath: "/tmp/better_sqlite3.node",
      message: "mismatch",
      hint: "clear npx cache",
    });
    expect(row.status).toBe("error");
    expect(row.hint).toBe("clear npx cache");
    expect(row.detail || "").toMatch(/127/);
    expect(row.detail || "").toMatch(/137/);
  });

  test("sqliteStatusToRow OK status maps to ok pill", () => {
    const row = sqliteStatusToRow({ kind: "ok", driver: "better-sqlite3" });
    expect(row.status).toBe("ok");
  });
});

describe("terminal dependency diagnostics", () => {
  test("reports the complete node-pty load failure with recovery guidance", () => {
    const reason = [
      "Error: failed to load the PTY module",
      "Caused by: Error: native module unavailable",
    ].join("\n");
    const row = shellAvailabilityToRow({ available: false, reason });

    expect(row).toEqual({
      id: "terminal.node-pty",
      title: "@lydell/node-pty",
      status: "warn",
      detail: reason,
      hint: expect.stringContaining("optional dependencies"),
    });
  });

  test("reports node-pty as available when its native module loads", () => {
    expect(shellAvailabilityToRow({ available: true, reason: "" })).toEqual({
      id: "terminal.node-pty",
      title: "@lydell/node-pty",
      status: "ok",
      detail: "available",
    });
  });
});

// buildDoctorReport spawns docker/git probes, each with their own timeout.
// On CI runners without a docker daemon these probes wait the full
// `docker info` budget and the test exceeds the default 5s budget.
const DOCTOR_TEST_TIMEOUT_MS = 30_000;

describe("doctor report", () => {
  test("a report that cannot be built answers 500 with the cause chain and logs the error", async () => {
    const failure = errorWithCause(
      "sample doctor failure",
      new TypeError("sample cause"),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const res = await handleDoctor({
        get cwd(): string {
          throw failure;
        },
        scopeOmitDirNames: [],
        listenPort: 0,
      });
      expect({
        status: res.status,
        body: await res.json(),
        logged: log.mock.calls,
      }).toEqual({
        status: 500,
        body: {
          error:
            "Error: sample doctor failure\nCaused by: TypeError: sample cause",
        },
        logged: [
          ["[code-viewer] the doctor report could not be built:", failure],
        ],
      });
    } finally {
      log.mockRestore();
    }
  });

  test("excludes the current worktree when cwd is one of its subdirectories", async () => {
    const root = mkdtempSync(join(tmpdir(), "code-viewer-doctor-worktree-"));
    const registry = mkdtempSync(
      join(tmpdir(), "code-viewer-doctor-registry-"),
    );
    const originalRegistry = process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR;
    process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR = registry;
    try {
      runGit(root, ["init", "-q", "-b", "main", "."]);
      const subdirectory = join(root, "nested");
      mkdirSync(subdirectory);
      const canonicalRoot = realpathSync(root);
      writeFileSync(serverRegistryFilePath(canonicalRoot), "invalid json\n");

      const server = await checkServer(12345, subdirectory);
      const worktrees = server.rows.find(
        (row) => row.id === "server.worktrees",
      );

      expect(worktrees?.status).toBe("ok");
      expect(worktrees?.detail).toContain("no other code-viewer");
    } finally {
      if (originalRegistry === undefined) {
        delete process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR;
      } else {
        process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR = originalRegistry;
      }
      rmSync(root, { recursive: true, force: true });
      rmSync(registry, { recursive: true, force: true });
    }
  });

  test(
    "explains PATH misses and absolute executable overrides",
    async () => {
      const originalPath = process.env.PATH;
      process.env.PATH = TEST_CWD;
      let report: Awaited<ReturnType<typeof buildDoctorReport>>;
      try {
        report = await buildDoctorReport({
          cwd: TEST_CWD,
          scopeOmitDirNames: [],
          listenPort: 0,
        });
      } finally {
        if (originalPath === undefined) delete process.env.PATH;
        else process.env.PATH = originalPath;
      }

      const expectedRows = [
        {
          groupId: "git",
          rowId: "git.binary",
          detail: "git not found in PATH\nstderr: spawn git ENOENT",
          override: "--bin git=/absolute/path",
        },
        {
          groupId: "search",
          rowId: "search.rg",
          detail: "rg not found in PATH\nstderr: spawn rg ENOENT",
          override: "--bin rg=/absolute/path",
        },
        {
          groupId: "terminal",
          rowId: "terminal.tmux",
          detail: "tmux not found in PATH\nstderr: spawn tmux ENOENT",
          override: "--bin tmux=/absolute/path",
        },
      ];
      for (const expected of expectedRows) {
        const row = report.groups
          .find((group) => group.id === expected.groupId)
          ?.rows.find((candidate) => candidate.id === expected.rowId);
        expect(row?.detail).toBe(expected.detail);
        expect(row?.hint).toContain(expected.override);
      }
    },
    DOCTOR_TEST_TIMEOUT_MS,
  );

  test(
    "includes all expected diagnostic groups",
    async () => {
      const report = await buildDoctorReport({
        cwd: TEST_CWD,
        scopeOmitDirNames: [],
        listenPort: 12345,
      });
      const groupIds = new Set(report.groups.map((g) => g.id));
      for (const id of [
        "runtime",
        "package",
        "sqlite",
        "snapshot",
        "git",
        "search",
        "github",
        "discovery",
        "datastore",
        "docker",
        "terminal",
        "server",
      ]) {
        expect(groupIds.has(id)).toBe(true);
      }
      // datastore は discovery と docker の間に並ぶ (AI/human が top-down に
      // discover -> connect -> compose health の順で読めるようにする位置決め)。
      const orderedIds = report.groups.map((g) => g.id);
      const gitIdx = orderedIds.indexOf("git");
      const searchIdx = orderedIds.indexOf("search");
      const githubIdx = orderedIds.indexOf("github");
      const discoveryIdx = orderedIds.indexOf("discovery");
      const datastoreIdx = orderedIds.indexOf("datastore");
      const dockerIdx = orderedIds.indexOf("docker");
      const terminalIdx = orderedIds.indexOf("terminal");
      expect(searchIdx > gitIdx).toBe(true);
      expect(githubIdx > searchIdx).toBe(true);
      expect(discoveryIdx > githubIdx).toBe(true);
      expect(discoveryIdx >= 0).toBe(true);
      expect(datastoreIdx > discoveryIdx).toBe(true);
      expect(dockerIdx > datastoreIdx).toBe(true);
      expect(terminalIdx > dockerIdx).toBe(true);
      const search = report.groups.find((g) => g.id === "search");
      const rgRow = search?.rows.find((r) => r.id === "search.rg");
      expect(Boolean(rgRow)).toBe(true);
      expect(rgRow?.status === "ok" || rgRow?.status === "warn").toBe(true);
      if (rgRow?.status === "warn") {
        expect(rgRow.hint).toContain("--bin rg=/absolute/path");
      }
      const terminal = report.groups.find((g) => g.id === "terminal");
      const tmuxRow = terminal?.rows.find((r) => r.id === "terminal.tmux");
      const nodePtyRow = terminal?.rows.find(
        (r) => r.id === "terminal.node-pty",
      );
      expect(Boolean(tmuxRow)).toBe(true);
      expect(Boolean(nodePtyRow)).toBe(true);
      if (tmuxRow?.status === "warn") {
        expect(tmuxRow.hint).toContain("--bin tmux=/absolute/path");
      }
      const github = report.groups.find((g) => g.id === "github");
      const ghRow = github?.rows.find((r) => r.id === "github.gh");
      expect(Boolean(ghRow)).toBe(true);
      expect(ghRow?.status === "ok" || ghRow?.status === "warn").toBe(true);
      const worst = report.worstStatus;
      const validWorst =
        worst === "ok" || worst === "warn" || worst === "error";
      expect(validWorst).toBe(true);
    },
    DOCTOR_TEST_TIMEOUT_MS,
  );

  test(
    "monotonically bumps generation across calls",
    async () => {
      const a = await buildDoctorReport({
        cwd: TEST_CWD,
        scopeOmitDirNames: [],
        listenPort: 0,
      });
      const b = await buildDoctorReport({
        cwd: TEST_CWD,
        scopeOmitDirNames: [],
        listenPort: 0,
      });
      expect(b.generation > a.generation).toBe(true);
    },
    DOCTOR_TEST_TIMEOUT_MS,
  );

  test(
    "server group reports the listening port",
    async () => {
      const report = await buildDoctorReport({
        cwd: TEST_CWD,
        scopeOmitDirNames: [],
        listenPort: 8080,
      });
      const server = report.groups.find((g) => g.id === "server");
      expect(Boolean(server)).toBe(true);
      const portRow = server?.rows.find((r) => r.id === "server.port");
      expect((portRow?.detail || "").includes("8080")).toBe(true);
    },
    DOCTOR_TEST_TIMEOUT_MS,
  );
});

// 失敗した検査の行が、何が・なぜ失敗したかを持つこと (1 行目だけ・固定の文に潰さない)。
describe("doctor keeps why a check failed", () => {
  const roots: string[] = [];
  const tempDir = (prefix: string): string => {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    roots.push(dir);
    return dir;
  };
  afterEach(() => {
    resetExternalCommandsForTest();
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // 偽の docker。引数ごとの応答を sh の case で返し、知らない引数は 64 で終える。
  const fakeDocker = (answers: Record<string, string>): string => {
    const path = join(tempDir("code-viewer-doctor-docker-"), "docker");
    const cases = Object.entries(answers)
      .map(([args, body]) => `  "${args}") ${body} ;;`)
      .join("\n");
    writeFileSync(
      path,
      `#!/bin/sh\ncase "$*" in\n${cases}\n  *) echo "unexpected: $*" >&2; exit 64 ;;\nesac\n`,
    );
    chmodSync(path, 0o755);
    return path;
  };
  const answer = (stdout: string) => `echo "${stdout}"; exit 0`;
  const fail = (...stderr: string[]) =>
    `printf '${stderr.join("\\n")}\\n' >&2; exit 1`;
  const running = {
    "--version": answer("Docker version 0.0.0-sample"),
    "compose version --short": answer("0.0.0-sample"),
    "info --format {{.ServerVersion}}": answer("0.0.0-sample"),
  };

  test.each([
    {
      name: "the compose plugin and the daemon",
      answers: {
        "--version": answer("Docker version 0.0.0-sample"),
        "compose version --short": fail("sample plugin failure"),
        "info --format {{.ServerVersion}}": fail(
          "sample daemon line 1",
          "sample daemon line 2",
        ),
      },
      expected: {
        "docker.compose-v2": {
          status: "error",
          detail:
            "not available\ndocker compose version --short exited with 1\nstderr: sample plugin failure",
        },
        "docker.daemon": {
          status: "error",
          detail: "sample daemon line 1\nsample daemon line 2",
        },
      },
    },
    {
      name: "the service list and the ps output",
      answers: {
        ...running,
        "compose config --quiet": "exit 0",
        "compose config --services": fail("sample services failure"),
        "compose ps --all --format json": answer("sample non-json"),
      },
      expected: {
        "docker.compose-config:": {
          status: "warn",
          detail:
            "`docker compose config --services` failed: sample services failure",
        },
        "docker.compose-ps:": {
          status: "warn",
          detail: expect.stringMatching(
            /^could not parse `docker compose ps --format json` output: SyntaxError: /,
          ),
        },
      },
    },
    {
      name: "every stderr line of compose config and ps",
      answers: {
        ...running,
        "compose config --quiet": fail(
          "sample config line 1",
          "sample config line 2",
        ),
        "compose ps --all --format json": fail(
          "sample ps line 1",
          "sample ps line 2",
        ),
      },
      expected: {
        "docker.compose-config:": {
          status: "error",
          detail: "sample config line 1\nsample config line 2",
        },
        "docker.compose-ps:": {
          status: "warn",
          detail: "sample ps line 1\nsample ps line 2",
        },
      },
    },
  ])(
    "docker rows keep $name",
    async ({ answers, expected }) => {
      const cwd = tempDir("code-viewer-doctor-compose-");
      writeFileSync(
        join(cwd, "docker-compose.yml"),
        "services:\n  db:\n    image: postgres:16\n",
      );
      expect(
        configureExternalCommands({
          cwd,
          env: {},
          cliOverrides: [{ name: "docker", path: fakeDocker(answers) }],
        }),
      ).toEqual({ ok: true });
      const report = await buildDoctorReport({
        cwd,
        scopeOmitDirNames: [],
        listenPort: 0,
      });
      const rows = report.groups.find((g) => g.id === "docker")?.rows ?? [];
      const found = Object.fromEntries(
        Object.keys(expected).map((prefix) => {
          const row = rows.find((candidate) => candidate.id.startsWith(prefix));
          return [prefix, row && { status: row.status, detail: row.detail }];
        }),
      );
      expect(found).toEqual(expected);
    },
    DOCTOR_TEST_TIMEOUT_MS,
  );

  test(
    "snapshot and git rows say why, instead of 'not created yet' or 'outside a work tree'",
    async () => {
      const cwd = realpathSync(tempDir("code-viewer-doctor-loop-"));
      // .code-viewer が自分を指す: access・stat は ENOENT でなく ELOOP で失敗する。
      symlinkSync(".code-viewer", join(cwd, ".code-viewer"));
      // 版の確認は PATH を鍵に含めずに覚えるので、PATH を空にした前のテストの
      // 「git が無い」を引かないよう、新しいモジュールで組み立てる。
      vi.resetModules();
      const fresh = await import("../server/doctor");
      const report = await fresh.buildDoctorReport({
        cwd,
        scopeOmitDirNames: [],
        listenPort: 0,
      });
      const row = (id: string) => {
        const found = report.groups
          .flatMap((group) => group.rows)
          .find((candidate) => candidate.id === id);
        return found && { status: found.status, detail: found.detail };
      };
      const eloop = expect.stringContaining('"code":"ELOOP"');
      expect({
        dir: row("snapshot.dir"),
        db: row("snapshot.db"),
        open: row("sqlite.snapshot-open"),
        repo: row("git.repo"),
      }).toEqual({
        dir: {
          status: "error",
          detail: expect.stringMatching(
            /\(not writable\)\nError: ELOOP: .*"code":"ELOOP"/s,
          ),
        },
        db: { status: "error", detail: eloop },
        open: { status: "error", detail: eloop },
        repo: {
          status: "warn",
          detail: expect.stringMatching(
            /^.* is not inside a git work tree\ngit rev-parse --is-inside-work-tree exited with 128\nstderr: fatal: /,
          ),
        },
      });
    },
    DOCTOR_TEST_TIMEOUT_MS,
  );

  test(
    "an aborted report throws and is not remembered as a failed check",
    async () => {
      vi.resetModules();
      const fresh = await import("../server/doctor");
      const cwd = tempDir("code-viewer-doctor-abort-");
      const controller = new AbortController();
      controller.abort();
      await expect(
        fresh.buildDoctorReport({
          cwd,
          scopeOmitDirNames: [],
          listenPort: 0,
          signal: controller.signal,
        }),
      ).rejects.toThrow("doctor aborted");
      const report = await fresh.buildDoctorReport({
        cwd,
        scopeOmitDirNames: [],
        listenPort: 0,
      });
      const git = report.groups
        .find((group) => group.id === "git")
        ?.rows.find((candidate) => candidate.id === "git.binary");
      expect(git?.status).toBe("ok");
    },
    DOCTOR_TEST_TIMEOUT_MS,
  );

  test("the package lookup keeps an unreadable package.json on its way up", () => {
    const root = realpathSync(tempDir("code-viewer-doctor-package-"));
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "@youtyan/code-viewer", version: "0.0.0-sample" }),
    );
    mkdirSync(join(root, "sample", "nested"), { recursive: true });
    writeFileSync(join(root, "sample", "package.json"), "{ sample");
    expect(findCodeViewerPackageJson(join(root, "sample", "nested"))).toEqual({
      version: "0.0.0-sample",
      path: join(root, "package.json"),
      failures: [
        expect.stringContaining(
          `${join(root, "sample", "package.json")}: SyntaxError: `,
        ),
      ],
    });
  });
});
