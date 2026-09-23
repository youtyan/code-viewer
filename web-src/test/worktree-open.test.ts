import { spawn } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { processAlive } from "../server/file-lock";
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

const ORIGINAL_REGISTRY_DIR = process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR;
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
  // テスト全体の一時登録簿 (vitest-global-setup) に戻す。消すと、この後に
  // 同じプロセスで走るテストが開発者の ~/.cache に登録を書く。
  if (ORIGINAL_REGISTRY_DIR === undefined) {
    delete process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR;
  } else {
    process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR = ORIGINAL_REGISTRY_DIR;
  }
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
    onError: (error) => console.error("test server error:", error),
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
    onExit(listener: (code: number | null, signal: string | null) => void) {
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
      launched: false,
      backend: false,
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

  test("a new entry adopts a verified project process with its token", async () => {
    const token = "0123456789abcdef";
    let adopted: unknown = null;
    let adoptionHeaders: Headers | null = null;
    identityServer = await startServer({
      hostname: "127.0.0.1",
      port: 0,
      onError: (error) => console.error("test server error:", error),
      async fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/_settings") {
          return new Response(
            JSON.stringify({
              server: { pid: process.pid, root: worktree },
            }),
          );
        }
        if (path === "/_entry/adopt" && req.method === "POST") {
          adopted = await req.json();
          adoptionHeaders = req.headers;
          return new Response(JSON.stringify({ ok: true }));
        }
        return new Response("not found", { status: 404 });
      },
    });
    const url = `http://127.0.0.1:${identityServer.port}/`;
    writeServerRegistry({
      url,
      pid: process.pid,
      root: worktree,
      started_at: "2026-08-11T00:00:00.000Z",
      backend: true,
    });

    expect(
      await openWorktreeServer(worktree, {
        backendOf: 4242,
        backendToken: token,
      }),
    ).toEqual({ status: "ok", url, started: false });
    expect(adopted).toEqual({ pid: 4242, token });
    expect(adoptionHeaders?.get("x-code-viewer-action")).toBe("1");
    expect(adoptionHeaders?.get("origin")).toBe(new URL(url).origin);
  });

  test("a project process without token adoption is an incompatible version", async () => {
    identityServer = await startServer({
      hostname: "127.0.0.1",
      port: 0,
      onError: (error) => console.error("test server error:", error),
      fetch(req) {
        if (new URL(req.url).pathname === "/_settings") {
          return new Response(
            JSON.stringify({ server: { pid: process.pid, root: worktree } }),
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    const url = `http://127.0.0.1:${identityServer.port}/`;
    writeServerRegistry({
      url,
      pid: process.pid,
      root: worktree,
      started_at: "2026-08-11T00:00:00.000Z",
      backend: true,
    });

    const result = await openWorktreeServer(worktree, {
      backendOf: 4242,
      backendToken: "0123456789abcdef",
    });

    expect(result.status).toBe("error");
    expect(result.status === "error" && String(result.error)).toContain(
      `another version is running at ${url} (pid ${process.pid})`,
    );
  });

  // 入口を新しい版で起こし直した直後: 古い版の裏は採用を断る。版違いの断りなら
  // 自分で終わるのを待たず (約 10 秒開けなかった) 止めて新しい裏を起こす。
  // ほかの断り (古い入口がまだ答える) では止めない。
  test.each([
    {
      name: "版違い",
      refusal: () =>
        new Response(
          JSON.stringify({
            error: "new entry owner could not be verified",
            detail: "the entry server (pid 4242) is version 2",
            code: "entry-version",
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        ),
      replaced: true,
    },
    {
      name: "古い入口がまだ答える",
      refusal: () =>
        new Response("entry owner pid 4241 is still alive", { status: 409 }),
      replaced: false,
    },
  ])("a project process that refuses a new entry ($name)", async ({
    refusal,
    replaced,
  }) => {
    const old = spawn(process.execPath, ["-e", "setInterval(() => {}, 1e9)"], {
      stdio: "ignore",
    });
    const oldPid = old.pid as number;
    const calls: string[] = [];
    let clock = 0;
    writeServerRegistry({
      url: "http://127.0.0.1:4321/",
      pid: oldPid,
      root: worktree,
      started_at: "2026-08-11T00:00:00.000Z",
      backend: true,
    });
    const controller = createWorktreeServerController({
      now: () => clock,
      pollIntervalMs: 1,
      startTimeoutMs: 50,
      delay: async (ms) => {
        clock += ms;
      },
      spawnServer: () => {
        calls.push("spawn");
        writeServerRegistry({
          url: "http://127.0.0.1:4322/",
          pid: process.pid,
          root: worktree,
          started_at: "2026-08-11T00:00:01.000Z",
          backend: true,
        });
        return fakeSpawn(() => undefined);
      },
      fetch: async (input) => {
        const url = new URL(input);
        calls.push(`${url.port} ${url.pathname}`);
        if (url.pathname === "/_entry/adopt") return refusal();
        const pid = url.port === "4321" ? oldPid : process.pid;
        return new Response(
          JSON.stringify({ server: { pid, root: worktree } }),
        );
      },
    });
    try {
      const result = await controller.openWorktreeServer(worktree, {
        backendOf: 4242,
        backendToken: "0123456789abcdef",
      });
      expect({
        result: result.status === "ok" ? result : result.status,
        calls,
        oldAlive: processAlive(oldPid),
      }).toEqual(
        replaced
          ? {
              result: {
                status: "ok",
                url: "http://127.0.0.1:4322/",
                started: true,
              },
              calls: [
                "4321 /_settings",
                "4321 /_entry/adopt",
                "spawn",
                "4322 /_settings",
              ],
              oldAlive: false,
            }
          : {
              result: "error",
              calls: ["4321 /_settings", "4321 /_entry/adopt"],
              oldAlive: true,
            },
      );
    } finally {
      old.kill("SIGKILL");
    }
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
