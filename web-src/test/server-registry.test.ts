import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  acquireServerStartLock,
  pruneDeadServerRegistry,
  readServerRegistry,
  serverRegistryFilePath,
  writeServerRegistry,
} from "../server/server-registry";

const ORIGINAL_REGISTRY_DIR = process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR;
let registryDir = "";

beforeEach(() => {
  registryDir = mkdtempSync(join(tmpdir(), "code-viewer-registry-errors-"));
  process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR = registryDir;
});

afterEach(() => {
  // テスト全体の一時登録簿 (vitest-global-setup) に戻す。消すと、この後に
  // 同じプロセスで走るテストが開発者の ~/.cache に登録を書く。
  if (ORIGINAL_REGISTRY_DIR === undefined) {
    delete process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR;
  } else {
    process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR = ORIGINAL_REGISTRY_DIR;
  }
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

  test("publishes a replacement file instead of truncating the visible registry", () => {
    const root = "/sample/repository";
    const entry = {
      url: "http://127.0.0.1:4321/",
      pid: process.pid,
      root,
      started_at: "2026-08-11T00:00:00.000Z",
    };
    writeServerRegistry(entry);
    const inode = statSync(serverRegistryFilePath(root)).ino;
    writeServerRegistry({ ...entry, started_at: "2026-08-11T00:00:01.000Z" });
    expect(statSync(serverRegistryFilePath(root)).ino).not.toBe(inode);
  });

  test("keeps a standalone identity in a private registry file", () => {
    const root = "/sample/identity-repository";
    const entry = {
      url: "http://127.0.0.1:4321/",
      pid: process.pid,
      root,
      started_at: "2026-08-11T00:00:00.000Z",
      token: "0123456789abcdef",
      version: "1.0.0",
    };

    writeServerRegistry(entry);

    expect(readServerRegistry(root)).toEqual(entry);
    expect(statSync(serverRegistryFilePath(root)).mode & 0o777).toBe(0o600);
  });

  test("rejects a registry URL outside the IPv4 loopback root", () => {
    const root = "/sample/non-loopback-repository";
    writeFileSync(
      serverRegistryFilePath(root),
      JSON.stringify({
        url: "http://example.invalid/",
        pid: process.pid,
        root,
        started_at: "2026-08-11T00:00:00.000Z",
      }),
      "utf8",
    );

    expect(() => readServerRegistry(root)).toThrow(
      "server registry URL must be an HTTP loopback root URL",
    );
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

describe("pruneDeadServerRegistry", () => {
  /** 起動してすぐ終わったプロセスの pid。確実に居ない pid として使う。 */
  function deadPid(): number {
    const child = spawnSync(process.execPath, ["-e", ""]);
    if (typeof child.pid !== "number") throw new Error("no pid from spawnSync");
    return child.pid;
  }

  /** 今の形の登録 (token と版がある)。identity を外すと古い形。 */
  function entry(
    root: string,
    pid: number,
    identity: Record<string, unknown> = {
      token: "0123456789abcdef",
      version: "0.0.0-sample",
    },
  ): string {
    return JSON.stringify({
      url: "http://127.0.0.1:4321/",
      pid,
      root,
      started_at: "2026-08-11T00:00:00.000Z",
      ...identity,
    });
  }

  test.each([
    {
      name: "a live server",
      raw: () => entry("/sample/live", process.pid),
      removed: false,
      error: false,
    },
    {
      name: "a server that is gone",
      raw: () => entry("/sample/gone", deadPid()),
      removed: true,
      error: false,
    },
    {
      name: "a project process of the entry (no token by design)",
      raw: () => entry("/sample/backend", process.pid, { backend: true }),
      removed: false,
      error: false,
    },
    {
      name: "only a token (not the old form)",
      raw: () =>
        entry("/sample/token", process.pid, { token: "0123456789abcdef" }),
      removed: false,
      error: false,
    },
    { name: "broken JSON", raw: () => "{", removed: false, error: true },
    {
      name: "missing fields",
      raw: () => '{"url":"http://127.0.0.1:1/"}',
      removed: false,
      error: true,
    },
  ])("$name", async ({ raw, removed, error }) => {
    const file = join(registryDir, "entry.json");
    writeFileSync(file, raw(), "utf8");
    const result = await pruneDeadServerRegistry();
    expect(result.removed).toEqual(removed ? [file] : []);
    expect(existsSync(file)).toBe(!removed);
    expect(result.errors.map((item) => item.file)).toEqual(error ? [file] : []);
  });

  test.each([
    { name: "whose pid is reused by a live process", pid: () => process.pid },
    { name: "whose process is gone", pid: deadPid },
  ])("an old-form entry without a token or version $name is removed as legacy", async ({
    pid,
  }) => {
    const file = join(registryDir, "old.json");
    writeFileSync(file, entry("/sample/old", pid(), {}), "utf8");
    const result = await pruneDeadServerRegistry();
    expect([result.removed, result.removedLegacy, existsSync(file)]).toEqual([
      [],
      [{ file, root: "/sample/old", url: "http://127.0.0.1:4321/" }],
      false,
    ]);
  });

  test("a mixed registry keeps live and unreadable entries and other files", async () => {
    const live = join(registryDir, "live.json");
    const gone = [1, 2, 3].map((n) => join(registryDir, `gone-${n}.json`));
    const broken = join(registryDir, "broken.json");
    const lock = join(registryDir, "x.start.lock");
    writeFileSync(live, entry("/sample/live", process.pid), "utf8");
    for (const file of gone)
      writeFileSync(file, entry(file, deadPid()), "utf8");
    writeFileSync(broken, "{", "utf8");
    writeFileSync(lock, "{}", "utf8");
    const result = await pruneDeadServerRegistry();
    expect(result.removed.sort()).toEqual([...gone].sort());
    expect(result.kept).toBe(1);
    expect(result.errors.map((item) => item.file)).toEqual([broken]);
    expect(readdirSync(registryDir).sort()).toEqual(
      ["broken.json", "live.json", "x.start.lock"].sort(),
    );
  });

  test("a missing registry directory is nothing to clean", async () => {
    process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR = join(
      registryDir,
      "none",
    );
    expect(await pruneDeadServerRegistry()).toEqual({
      removed: [],
      removedLegacy: [],
      kept: 0,
      errors: [],
    });
  });
});
