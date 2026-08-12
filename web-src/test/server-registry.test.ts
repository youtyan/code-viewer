import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  acquireServerStartLock,
  readServerRegistry,
  serverRegistryFilePath,
  writeServerRegistry,
} from "../server/server-registry";

let registryDir = "";

beforeEach(() => {
  registryDir = mkdtempSync(join(tmpdir(), "code-viewer-registry-errors-"));
  process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR = registryDir;
});

afterEach(() => {
  delete process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR;
  rmSync(registryDir, { recursive: true, force: true });
});

describe("server registry errors", () => {
  test("returns null only when the registry file is absent", () => {
    expect(readServerRegistry("/sample/repository")).toBeNull();
  });

  test.each([
    { name: "invalid JSON", raw: "{" },
    { name: "non-object JSON", raw: "[]" },
    {
      name: "missing required fields",
      raw: '{"url":"http://127.0.0.1:4321/"}',
    },
  ])("reports $name", ({ raw }) => {
    const root = "/sample/repository";
    writeFileSync(serverRegistryFilePath(root), raw, "utf8");
    expect(() => readServerRegistry(root)).toThrow(/server registry/);
  });

  test("reports a registry directory that cannot be created", () => {
    const occupied = join(registryDir, "occupied");
    writeFileSync(occupied, "not a directory", "utf8");
    process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR = occupied;
    expect(() =>
      writeServerRegistry({
        url: "http://127.0.0.1:4321/",
        pid: process.pid,
        root: "/sample/repository",
        started_at: "2026-08-11T00:00:00.000Z",
      }),
    ).toThrow();
  });

  test("allows only one live start lock and releases it by owner token", () => {
    const root = "/sample/repository";
    const first = acquireServerStartLock(root, 1_000);
    expect(first).not.toBeNull();
    expect(acquireServerStartLock(root, 1_001)).toBeNull();

    first?.release();

    const next = acquireServerStartLock(root, 1_002);
    expect(next).not.toBeNull();
    next?.release();
  });

  test("reclaims a start lock older than the startup deadline", () => {
    const root = "/sample/repository";
    const stale = acquireServerStartLock(root, 1_000);
    expect(stale).not.toBeNull();

    const replacement = acquireServerStartLock(root, 31_001);
    expect(replacement).not.toBeNull();
    stale?.release();
    expect(acquireServerStartLock(root, 31_002)).toBeNull();
    replacement?.release();
  });
});
