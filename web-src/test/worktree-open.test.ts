import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { type StartedServer, startServer } from "../server/runtime";
import {
  readServerRegistry,
  serverRegistryFilePath,
  writeServerRegistry,
} from "../server/server-registry";
import {
  createWorktreeServerController,
  openWorktreeServer,
  runningServerResult,
} from "../server/worktree/open";

let registryDir = "";
let worktree = "";
let identityServer: StartedServer | null = null;

beforeEach(() => {
  registryDir = mkdtempSync(join(tmpdir(), "code-viewer-registry-"));
  worktree = realpathSync(mkdtempSync(join(tmpdir(), "code-viewer-open-")));
  process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR = registryDir;
});

afterEach(async () => {
  await identityServer?.close();
  identityServer = null;
  delete process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR;
  rmSync(registryDir, { recursive: true, force: true });
  rmSync(worktree, { recursive: true, force: true });
});

async function registerIdentityServer(
  root = worktree,
  pid = process.pid,
): Promise<string> {
  identityServer = await startServer({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response(JSON.stringify({ server: { pid, root } }), {
        headers: { "Content-Type": "application/json" },
      }),
  });
  const url = `http://127.0.0.1:${identityServer.port}/`;
  writeServerRegistry({
    url,
    pid: process.pid,
    root: worktree,
    started_at: "2026-08-11T00:00:00.000Z",
  });
  return url;
}

function fakeSpawn(onTerminate: () => void) {
  return {
    onError(listener: (error: Error) => void) {
      void listener;
    },
    async terminate() {
      onTerminate();
    },
    unref() {
      return undefined;
    },
  };
}

describe("runningServerResult", () => {
  test("reports an absent registry", async () => {
    expect(await runningServerResult(worktree)).toEqual({ status: "absent" });
  });

  test("returns a server only after its root and pid answer on HTTP", async () => {
    const url = await registerIdentityServer();
    expect(await runningServerResult(worktree)).toEqual({
      status: "running",
      url,
      pid: process.pid,
    });
  });

  test("passes caller cancellation into the HTTP identity check", async () => {
    writeServerRegistry({
      url: "http://127.0.0.1:4321/",
      pid: process.pid,
      root: worktree,
      started_at: "2026-08-11T00:00:00.000Z",
    });
    let receivedSignal: AbortSignal | null = null;
    const controller = createWorktreeServerController({
      fetch: async (_input, init) => {
        receivedSignal = init.signal as AbortSignal;
        receivedSignal.throwIfAborted();
        throw new Error("expected an aborted signal");
      },
    });
    const request = new AbortController();
    request.abort();

    const result = await controller.runningServerResult(worktree, {
      signal: request.signal,
    });

    expect(result.status).toBe("unreachable");
    expect(receivedSignal?.aborted).toBe(true);
  });

  test.each([
    { name: "pid 0", pid: 0 },
    { name: "a negative pid", pid: -1 },
  ])("reports a registry with $name", async ({ pid }) => {
    writeServerRegistry({
      url: "http://127.0.0.1:4321/",
      pid,
      root: worktree,
      started_at: "2026-08-11T00:00:00.000Z",
    });
    expect((await runningServerResult(worktree)).status).toBe("invalid");
  });

  test.each([
    {
      name: "a non-loopback URL",
      url: "http://192.0.2.1:4321/",
    },
    {
      name: "credentials in the URL",
      url: "http://user:pass@127.0.0.1:4321/",
    },
    {
      name: "a non-root URL path",
      url: "http://127.0.0.1:4321/other",
    },
  ])("rejects $name", async ({ url }) => {
    writeServerRegistry({
      url,
      pid: process.pid,
      root: worktree,
      started_at: "2026-08-11T00:00:00.000Z",
    });
    expect((await runningServerResult(worktree)).status).toBe("invalid");
  });

  test("rejects a root that differs from the registry file key", async () => {
    writeFileSync(
      serverRegistryFilePath(worktree),
      JSON.stringify({
        url: "http://127.0.0.1:4321/",
        pid: process.pid,
        root: "/sample/other",
        started_at: "2026-08-11T00:00:00.000Z",
      }),
      "utf8",
    );
    expect((await runningServerResult(worktree)).status).toBe("invalid");
  });

  test("rejects a live endpoint that reports another identity", async () => {
    await registerIdentityServer(worktree, process.pid + 1);
    expect((await runningServerResult(worktree)).status).toBe("invalid");
  });
});

describe("openWorktreeServer", () => {
  test("reuses a verified server instead of starting a second one", async () => {
    const url = await registerIdentityServer();
    expect(await openWorktreeServer(worktree)).toEqual({
      status: "ok",
      url,
      started: false,
    });
  });

  test("reports a worktree whose directory is gone", async () => {
    expect(await openWorktreeServer(join(worktree, "missing"))).toEqual({
      status: "missing",
    });
  });

  test("shares one startup across simultaneous requests", async () => {
    let clock = 0;
    let spawnCount = 0;
    let registered = false;
    const url = "http://127.0.0.1:4321/";
    const controller = createWorktreeServerController({
      now: () => clock,
      pollIntervalMs: 1,
      startTimeoutMs: 5,
      spawnServer: () => {
        spawnCount++;
        return fakeSpawn(() => undefined);
      },
      delay: async (ms) => {
        clock += ms;
        if (!registered) {
          registered = true;
          writeServerRegistry({
            url,
            pid: process.pid,
            root: worktree,
            started_at: "2026-08-11T00:00:00.000Z",
          });
        }
      },
      fetch: async () =>
        new Response(
          JSON.stringify({ server: { pid: process.pid, root: worktree } }),
        ),
    });

    const [first, second] = await Promise.all([
      controller.openWorktreeServer(worktree),
      controller.openWorktreeServer(worktree),
    ]);

    expect(spawnCount).toBe(1);
    expect(first).toEqual({ status: "ok", url, started: true });
    expect(second).toEqual({ status: "ok", url, started: true });
  });

  test("shares one startup across separate server controllers", async () => {
    let clock = 0;
    let spawnCount = 0;
    let registered = false;
    const url = "http://127.0.0.1:4321/";
    const runtime = {
      now: () => clock,
      pollIntervalMs: 1,
      startTimeoutMs: 10,
      spawnServer: () => {
        spawnCount += 1;
        return fakeSpawn(() => undefined);
      },
      delay: async (ms: number) => {
        clock += ms;
        if (!registered && spawnCount > 0) {
          registered = true;
          writeServerRegistry({
            url,
            pid: process.pid,
            root: worktree,
            started_at: "2026-08-11T00:00:00.000Z",
          });
        }
      },
      fetch: async () =>
        new Response(
          JSON.stringify({ server: { pid: process.pid, root: worktree } }),
        ),
    };
    const firstController = createWorktreeServerController(runtime);
    const secondController = createWorktreeServerController(runtime);

    const results = await Promise.all([
      firstController.openWorktreeServer(worktree),
      secondController.openWorktreeServer(worktree),
    ]);

    expect(spawnCount).toBe(1);
    expect(results.every((result) => result.status === "ok")).toBe(true);
    expect(
      results.filter((result) => result.status === "ok" && result.started),
    ).toHaveLength(1);
  });

  test("terminates the spawned child when startup times out", async () => {
    let clock = 0;
    let terminated = 0;
    const controller = createWorktreeServerController({
      now: () => clock,
      pollIntervalMs: 1,
      startTimeoutMs: 2,
      delay: async (ms) => {
        clock += ms;
      },
      spawnServer: () => fakeSpawn(() => terminated++),
    });

    expect(await controller.openWorktreeServer(worktree)).toEqual({
      status: "timeout",
    });
    expect(terminated).toBe(1);
  });
});

describe("stopWorktreeServer", () => {
  test("stops only a server whose HTTP identity matches the registry", async () => {
    const url = "http://127.0.0.1:4321/";
    writeServerRegistry({
      url,
      pid: process.pid,
      root: worktree,
      started_at: "2026-08-11T00:00:00.000Z",
    });
    const stopped: number[] = [];
    const controller = createWorktreeServerController({
      fetch: async () =>
        new Response(
          JSON.stringify({ server: { pid: process.pid, root: worktree } }),
        ),
      terminatePid: async (pid) => {
        stopped.push(pid);
      },
    });

    await controller.stopWorktreeServer(worktree);

    expect(stopped).toEqual([process.pid]);
    expect(readServerRegistry(worktree)).toBeNull();
  });
});
