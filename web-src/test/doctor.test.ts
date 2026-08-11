import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  _parseSqliteAbiMismatchMessage,
  describeSqliteDriver,
} from "../server/database/sqlite-driver";
import {
  buildDoctorReport,
  checkServer,
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
          detail: "git not found in PATH",
          override: "--bin git=/absolute/path",
        },
        {
          groupId: "search",
          rowId: "search.rg",
          detail: "rg not found in PATH",
          override: "--bin rg=/absolute/path",
        },
        {
          groupId: "terminal",
          rowId: "terminal.tmux",
          detail: "tmux not found in PATH",
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
