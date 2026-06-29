import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _parseSqliteAbiMismatchMessage,
  describeSqliteDriver,
} from "../server/database/sqlite-driver";
import { buildDoctorReport, sqliteStatusToRow } from "../server/doctor";

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
    const row = sqliteStatusToRow({ kind: "ok", driver: "bun:sqlite" });
    expect(row.status).toBe("ok");
  });
});

describe("doctor report", () => {
  test("includes all expected diagnostic groups", async () => {
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
      "discovery",
      "docker",
      "server",
    ]) {
      expect(groupIds.has(id)).toBe(true);
    }
    const worst = report.worstStatus;
    const validWorst = worst === "ok" || worst === "warn" || worst === "error";
    expect(validWorst).toBe(true);
  });

  test("monotonically bumps generation across calls", async () => {
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
  });

  test("server group reports the listening port", async () => {
    const report = await buildDoctorReport({
      cwd: TEST_CWD,
      scopeOmitDirNames: [],
      listenPort: 8080,
    });
    const server = report.groups.find((g) => g.id === "server");
    expect(Boolean(server)).toBe(true);
    const portRow = server?.rows.find((r) => r.id === "server.port");
    expect((portRow?.detail || "").includes("8080")).toBe(true);
  });
});
