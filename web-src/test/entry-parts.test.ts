// 入口のサーバの部品: 居場所のファイル・URL の鍵の解決・裏のプロセスの管理・
// 取り次ぎ (server/entry/)。
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  type BackendTarget,
  createEntryBackends,
  type EntryBackendsDeps,
} from "../server/entry/backends";
import {
  acquireEntryStartLock,
  liveEntryUrl,
  readEntryRecord,
  removeEntryRecord,
  verifyServerIdentity,
  writeEntryRecord,
} from "../server/entry/entry-file";
import { createEntryProjects } from "../server/entry/projects";
import { isConnectionFailure, proxyToBackend } from "../server/entry/proxy";
import {
  proxyTimeoutResponse,
  registerLaunchRoot,
} from "../server/entry/server";
import { rootFileKey } from "../server/server-registry";
import type { WorktreeOpenResult } from "../server/worktree/open";

const DEAD_PID = 2_147_483_000;

describe("entry.json", () => {
  const record = {
    url: "http://127.0.0.1:64620/",
    pid: process.pid,
    token: "0123456789abcdef",
    version: "1.0.0",
    started_at: "2026-01-01T00:00:00.000Z",
  };

  test("written, read back, and removed only by its owner", () => {
    const file = join(mkdtempSync(join(tmpdir(), "entry-file-")), "entry.json");
    expect(readEntryRecord(file)).toEqual({ ok: true, registry: null });
    writeEntryRecord(record, file);
    expect(readEntryRecord(file)).toEqual({ ok: true, registry: record });
    expect(liveEntryUrl(file)).toBe("http://127.0.0.1:64620");
    expect(removeEntryRecord(process.pid + 1, file)).toEqual({
      status: "other-owner",
    });
    expect(readEntryRecord(file)).toEqual({ ok: true, registry: record });
    expect(removeEntryRecord(process.pid, file)).toEqual({ status: "removed" });
    expect(readEntryRecord(file)).toEqual({ ok: true, registry: null });
  });

  test("a record left by a process that is gone reads as no entry", () => {
    const file = join(mkdtempSync(join(tmpdir(), "entry-file-")), "entry.json");
    writeEntryRecord({ ...record, pid: DEAD_PID }, file);
    expect(liveEntryUrl(file)).toBeNull();
  });

  test.each([
    ["not JSON", "{broken", "is not valid JSON"],
    [
      "another host",
      JSON.stringify({ ...record, url: "http://example.invalid/" }),
      "url: not a loopback root URL",
    ],
    [
      "no version",
      JSON.stringify({ ...record, version: "" }),
      "version: missing",
    ],
    [
      "no token",
      JSON.stringify({ ...record, token: "" }),
      "token: expected 16 lower-case hexadecimal characters",
    ],
  ])("a broken record (%s) is reported, not treated as absent", (_label, text, reason) => {
    const file = join(mkdtempSync(join(tmpdir(), "entry-file-")), "entry.json");
    writeFileSync(file, text);
    const read = readEntryRecord(file);
    expect(read.ok).toBe(false);
    expect(read.ok === false && read.error).toContain(reason);
    expect(() => liveEntryUrl(file)).toThrow(reason);
    const removed = removeEntryRecord(process.pid, file);
    expect(removed.status).toBe("unreadable");
    expect(removed.status === "unreadable" && removed.error.message).toContain(
      reason,
    );
    expect(readFileSync(file, "utf8")).toBe(text);
  });

  test("only one CLI at a time becomes the entry", () => {
    const file = join(mkdtempSync(join(tmpdir(), "entry-file-")), "entry.json");
    const first = acquireEntryStartLock(Date.now(), file);
    expect(first).not.toBeNull();
    expect(acquireEntryStartLock(Date.now(), file)).toBeNull();
    first?.release();
    expect(acquireEntryStartLock(Date.now(), file)).not.toBeNull();
  });

  test("identity verification reports every mismatch without exposing tokens", async () => {
    const verification = await verifyServerIdentity(
      record,
      "entry",
      async () =>
        new Response(
          JSON.stringify({
            role: "standalone",
            pid: process.pid + 1,
            token: "fedcba9876543210",
            version: "0.0.0",
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );

    expect(verification.status).toBe("invalid");
    if (verification.status !== "invalid") {
      throw new Error("expected invalid identity");
    }
    expect(verification.detail).toContain("role mismatch");
    expect(verification.detail).toContain("pid mismatch");
    expect(verification.detail).toContain("token mismatch");
    expect(verification.detail).toContain("version mismatch");
    expect(verification.detail).not.toContain(record.token);
    expect(verification.detail).not.toContain("fedcba9876543210");
  });
});

describe("resolving the key in /p/<key>/", () => {
  const registered = "/work/sample-app";
  const worktree = "/work/sample-app-feature";
  function projects(
    options: { unreadable?: boolean; worktreeError?: boolean } = {},
  ) {
    let worktreeCalls = 0;
    const lookup = createEntryProjects({
      registryRoots: () => {
        if (options.unreadable)
          throw new Error("projects.json is not valid JSON");
        return [registered];
      },
      worktreePaths: async () => {
        worktreeCalls += 1;
        if (options.worktreeError) throw new Error("git worktree list failed");
        return [registered, worktree];
      },
      now: () => 0,
    });
    return { lookup, calls: () => worktreeCalls };
  }

  test.each([
    [
      "a registered project",
      rootFileKey(registered),
      { status: "found", root: registered },
    ],
    [
      "a worktree of a registered project",
      rootFileKey(worktree),
      { status: "found", root: worktree },
    ],
    [
      "an unregistered folder",
      rootFileKey("/work/other"),
      { status: "unknown" },
    ],
    [
      "upper case",
      rootFileKey(registered).toUpperCase(),
      { status: "unknown" },
    ],
    ["too short", rootFileKey(registered).slice(0, 15), { status: "unknown" }],
    ["a path", "..%2F..", { status: "unknown" }],
  ])("%s", async (_label, key, expected) => {
    expect(await projects().lookup.lookup(key)).toEqual(expected);
  });

  test("a folder the entry allowed (the launch folder) resolves without the registry", async () => {
    const { lookup } = projects({ unreadable: true });
    const key = lookup.allow("/work/launched");
    expect(await lookup.lookup(key)).toEqual({
      status: "found",
      root: "/work/launched",
    });
  });

  test("an unreadable registry is an error, not an unknown project", async () => {
    const found = await projects({ unreadable: true }).lookup.lookup(
      rootFileKey(registered),
    );
    expect(found.status).toBe("error");
    expect(found.status === "error" && found.error).toContain(
      "projects.json is not valid JSON",
    );
  });

  test("failing to list worktrees is reported when nothing matched", async () => {
    const found = await projects({ worktreeError: true }).lookup.lookup(
      rootFileKey("/work/other"),
    );
    expect(found.status).toBe("error");
    expect(found.status === "error" && found.error).toContain(
      "git worktree list failed",
    );
  });

  test("worktrees are listed once per interval", async () => {
    const p = projects();
    await p.lookup.lookup(rootFileKey("/work/other"));
    await p.lookup.lookup(rootFileKey("/work/other"));
    expect(p.calls()).toBe(1);
  });
});

describe("the project processes the entry starts", () => {
  const ROOT = "/work/sample-app";
  const IDLE_MS = 600_000;
  /**
   * 起こす・止めるを記録する偽の仕組み。open と stop は差し替えられる
   * (既定: outcomes を順に返す・止めるのは成功)。
   */
  function backends(
    outcomes: WorktreeOpenResult[],
    options: {
      backend?: boolean;
      idleStopMs?: number;
      open?: () => Promise<WorktreeOpenResult>;
      stop?: () => Promise<void>;
      registryEntry?: EntryBackendsDeps["registryEntry"];
    } = {},
  ) {
    const opens: unknown[] = [];
    const stops: string[] = [];
    const lines: string[] = [];
    const clock = { now: 1_000_000 };
    const deps: EntryBackendsDeps = {
      entryPid: 4242,
      entryToken: "0123456789abcdef",
      controller: {
        openWorktreeServer: async (_root, open) => {
          opens.push(open);
          if (options.open) return options.open();
          return outcomes.shift() ?? { status: "timeout" };
        },
        runningServerResult: async () => ({ status: "absent" }),
        stopWorktreeServer: async (root) => {
          stops.push(root);
          if (options.stop) await options.stop();
        },
      },
      logFile: () => "/state/server-logs/sample.log",
      logTail: () => "server output: sample tail",
      registryEntry:
        options.registryEntry ??
        (() => ({
          status: "found",
          pid: 777,
          backend: options.backend ?? true,
        })),
      serverArgs: () => ["--staged"],
      idleStopMs: options.idleStopMs ?? IDLE_MS,
      now: () => clock.now,
      log: (line) => {
        lines.push(line);
      },
    };
    return { b: createEntryBackends(deps), opens, stops, lines, clock };
  }
  const ok = (port: number): WorktreeOpenResult => ({
    status: "ok",
    url: `http://127.0.0.1:${port}/`,
    started: true,
  });
  const refused = Object.assign(new Error("fetch failed"), {
    cause: { code: "ECONNREFUSED" },
  });

  test("starts it as a project process of this entry, once", async () => {
    const { b, opens } = backends([ok(65001)]);
    expect(b.state(ROOT)).toBe("absent");
    expect(await b.target(ROOT)).toEqual({
      status: "ok",
      url: "http://127.0.0.1:65001/",
      pid: 777,
      started: true,
    });
    expect(b.state(ROOT)).toBe("running");
    await b.target(ROOT);
    expect(opens).toEqual([
      {
        port: 0,
        logFile: "/state/server-logs/sample.log",
        backendOf: 4242,
        backendToken: "0123456789abcdef",
        serverArgs: ["--staged"],
      },
    ]);
  });

  test("reads as starting while it is being started", async () => {
    const opening: { finish?: (result: WorktreeOpenResult) => void } = {};
    const { b } = backends([], {
      open: () =>
        new Promise<WorktreeOpenResult>((resolve) => {
          opening.finish = resolve;
        }),
    });
    const started = b.target(ROOT);
    expect(b.state(ROOT)).toBe("starting");
    opening.finish?.(ok(65001));
    await started;
    expect(b.state(ROOT)).toBe("running");
  });

  test.each<[string, WorktreeOpenResult, string]>([
    ["the folder is gone", { status: "missing" }, "does not exist"],
    ["it never answers", { status: "timeout" }, "did not start in time"],
    [
      "it exits",
      { status: "error", error: new Error("exited: sample") },
      "exited: sample",
    ],
  ])("fails with the reason and the log when %s (503)", async (_label, outcome, reason) => {
    const { b } = backends([outcome]);
    const target = (await b.target(ROOT)) as Extract<
      BackendTarget,
      { status: "failed" }
    >;
    expect(target.status).toBe("failed");
    expect(target.detail).toContain(reason);
    expect(target.log).toBe("server output: sample tail");
    expect(b.state(ROOT)).toBe("absent");
  });

  test.each([
    {
      name: "the registry entry is absent",
      registry: { status: "absent" } as const,
      reason: "did not register itself",
    },
    {
      name: "the registry entry is unreadable",
      registry: {
        status: "unreadable",
        error: new Error("sample registry read failed"),
      } as const,
      reason: "sample registry read failed",
    },
  ])("fails instead of starting with pid null when $name", async ({
    registry,
    reason,
  }) => {
    const { b } = backends([ok(65001)], {
      registryEntry: () => registry,
    });

    const result = await b.target(ROOT);

    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.detail).toContain(reason);
    expect(b.state(ROOT)).toBe("absent");
  });

  test("after it became unreachable: not started by ordinary requests, once by the SSE reconnect, again by restart", async () => {
    const { b, opens } = backends([ok(65001), ok(65002), ok(65003)]);
    await b.target(ROOT);
    const down = b.noteUnreachable(ROOT, refused);
    expect(down.status).toBe("unreachable");
    expect(down.status === "unreachable" && down.detail).toContain(
      "ECONNREFUSED",
    );
    expect(b.state(ROOT)).toBe("unreachable");
    expect((await b.target(ROOT)).status).toBe("unreachable");
    expect(await b.target(ROOT, { events: true })).toMatchObject({
      status: "ok",
      url: "http://127.0.0.1:65002/",
    });
    b.noteUnreachable(ROOT, refused);
    expect((await b.target(ROOT, { events: true })).status).toBe("unreachable");
    expect(await b.restart(ROOT)).toMatchObject({
      status: "ok",
      url: "http://127.0.0.1:65003/",
    });
    expect(opens).toHaveLength(3);
  });

  test("concurrent failed SSE restarts share one start and keep it unreachable", async () => {
    const { b, opens } = backends([ok(65001), { status: "timeout" }]);
    await b.target(ROOT);
    b.noteUnreachable(ROOT, refused);
    const restarted = await Promise.all([
      b.target(ROOT, { events: true }),
      b.target(ROOT, { events: true }),
    ]);
    expect(restarted.map((target) => target.status)).toEqual([
      "failed",
      "failed",
    ]);
    expect(b.state(ROOT)).toBe("unreachable");
    expect((await b.target(ROOT)).status).toBe("unreachable");
    expect(opens).toHaveLength(2);
  });

  test("stopping from the menu forgets it, and the next request starts it again", async () => {
    const { b, stops } = backends([ok(65001), ok(65002)]);
    await b.target(ROOT);
    await b.stop(ROOT);
    expect(stops).toEqual([ROOT]);
    expect(b.state(ROOT)).toBe("absent");
    expect(await b.target(ROOT)).toMatchObject({
      status: "ok",
      url: "http://127.0.0.1:65002/",
    });
  });

  test("counts SSE subscribers and other streams; releasing twice counts once", async () => {
    const { b } = backends([ok(65001)]);
    const first = await b.acquire(ROOT, { events: true });
    const second = await b.acquire(ROOT, { events: true });
    const download = await b.acquire(ROOT);
    expect([b.subscriberCount(ROOT), b.streamCount(ROOT)]).toEqual([2, 1]);
    first.release();
    first.release();
    download.release();
    expect([b.subscriberCount(ROOT), b.streamCount(ROOT)]).toEqual([1, 0]);
    second.release();
    expect([b.subscriberCount(ROOT), b.streamCount(ROOT)]).toEqual([0, 0]);
  });

  test("a request that cannot be forwarded is not counted", async () => {
    const { b } = backends([{ status: "timeout" }]);
    const { target } = await b.acquire(ROOT, { events: true });
    expect(target.status).toBe("failed");
    expect(b.subscriberCount(ROOT)).toBe(0);
  });

  // アイドル停止: 購読・流れ・最後の要求からの時間・入口の裏か、の組合せ。
  test.each<{
    name: string;
    subscribers: number;
    streams: number;
    elapsedMs: number;
    backend: boolean;
    stopped: boolean;
  }>([
    {
      name: "nothing open for exactly the idle time: stopped",
      subscribers: 0,
      streams: 0,
      elapsedMs: 600_000,
      backend: true,
      stopped: true,
    },
    {
      name: "nothing open, 1 ms short of the idle time: kept",
      subscribers: 0,
      streams: 0,
      elapsedMs: 599_999,
      backend: true,
      stopped: false,
    },
    {
      name: "nothing open for longer than the idle time: stopped",
      subscribers: 0,
      streams: 0,
      elapsedMs: 600_001,
      backend: true,
      stopped: true,
    },
    {
      name: "an SSE subscriber is open: kept",
      subscribers: 1,
      streams: 0,
      elapsedMs: 3_600_000,
      backend: true,
      stopped: false,
    },
    {
      name: "a download is still streaming: kept",
      subscribers: 0,
      streams: 1,
      elapsedMs: 3_600_000,
      backend: true,
      stopped: false,
    },
    {
      name: "a server the user started (--standalone): kept",
      subscribers: 0,
      streams: 0,
      elapsedMs: 3_600_000,
      backend: false,
      stopped: false,
    },
  ])("$name", async ({ subscribers, streams, elapsedMs, backend, stopped }) => {
    const { b, stops, clock } = backends([ok(65001)], { backend });
    await b.target(ROOT);
    for (let i = 0; i < subscribers; i += 1) {
      await b.acquire(ROOT, { events: true });
    }
    for (let i = 0; i < streams; i += 1) await b.acquire(ROOT);
    clock.now += elapsedMs;
    await b.stopIdleBackends();
    expect({ stops, state: b.state(ROOT) }).toEqual(
      stopped
        ? { stops: [ROOT], state: "idle-stopped" }
        : { stops: [], state: "running" },
    );
  });

  test("the idle time counts from when the last stream ended, not from the start", async () => {
    const { b, stops, clock } = backends([ok(65001)]);
    await b.target(ROOT);
    const sse = await b.acquire(ROOT, { events: true });
    clock.now += 3_600_000;
    sse.release();
    clock.now += 599_999;
    await b.stopIdleBackends();
    expect(stops).toEqual([]);
    clock.now += 1;
    await b.stopIdleBackends();
    expect(stops).toEqual([ROOT]);
  });

  test("a process stopped as idle is not unreachable: the next request starts it again quietly, and both are logged", async () => {
    const { b, opens, lines, clock } = backends([ok(65001), ok(65002)]);
    await b.target(ROOT);
    clock.now += 600_000;
    await b.stopIdleBackends();
    clock.now += 120_000;
    expect(await b.target(ROOT)).toEqual({
      status: "ok",
      url: "http://127.0.0.1:65002/",
      pid: 777,
      started: true,
    });
    expect(opens).toHaveLength(2);
    expect(lines).toEqual([
      "stopped the project process for /work/sample-app (idle: no subscribers or streams for 10m 0s; it ran 10m 0s)",
      "started the project process for /work/sample-app again on request (stopped as idle 2m 0s ago)",
    ]);
  });

  test("a request that arrives while it is being stopped waits and then starts it again", async () => {
    const stopping: { finish?: () => void } = {};
    const { b, opens, clock } = backends([ok(65001), ok(65002)], {
      stop: () =>
        new Promise<void>((resolve) => {
          stopping.finish = resolve;
        }),
    });
    await b.target(ROOT);
    clock.now += IDLE_MS;
    const sweep = b.stopIdleBackends();
    expect(b.state(ROOT)).toBe("idle-stopped");
    const next = b.target(ROOT);
    stopping.finish?.();
    await sweep;
    expect(await next).toMatchObject({ url: "http://127.0.0.1:65002/" });
    expect(opens).toHaveLength(2);
  });

  test("when stopping fails, it stays running, returns the reason, and retries next time", async () => {
    const failure = new Error("sample: kill failed");
    const { b, clock, stops } = backends([ok(65001)], {
      stop: async () => {
        throw failure;
      },
    });
    await b.target(ROOT);
    clock.now += IDLE_MS;
    const first = await b.stopIdleBackends().catch((error: unknown) => error);
    const second = await b.stopIdleBackends().catch((error: unknown) => error);

    expect(b.state(ROOT)).toBe("running");
    expect(stops).toEqual([ROOT, ROOT]);
    expect((first as Error & { errors?: unknown[] }).errors).toEqual([
      expect.objectContaining({ cause: failure }),
    ]);
    expect((second as Error & { errors?: unknown[] }).errors).toEqual([
      expect.objectContaining({ cause: failure }),
    ]);
  });

  test("an idle time of 0 never stops anything", async () => {
    const { b, stops, clock } = backends([ok(65001)], { idleStopMs: 0 });
    await b.target(ROOT);
    clock.now += 10 ** 12;
    await b.stopIdleBackends();
    expect(stops).toEqual([]);
  });
});

describe("registering the launch root", () => {
  test("returns a non-conflict registry failure to its caller with the cause", async () => {
    const failure = new Error("sample project registry failure");
    const caught = await registerLaunchRoot("/work/sample-app", {
      repoRootResult: () => ({ kind: "root", root: "/work/sample-app" }),
      register: async () => {
        throw failure;
      },
    }).catch((error: unknown) => error);

    expect(caught).toEqual(expect.objectContaining({ cause: failure }));
  });
});

describe("forwarding to a project process", () => {
  let upstream: Server | null = null;
  afterEach(async () => {
    const server = upstream;
    upstream = null;
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  async function startUpstream(): Promise<string> {
    upstream = createServer((req, res) => {
      if (req.url?.startsWith("/events")) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("event: open\ndata: ok\n\n");
        setTimeout(() => res.write("event: update\ndata: tick\n\n"), 50);
        return;
      }
      if (req.url?.startsWith("/_file")) {
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-disposition": 'attachment; filename="sample.bin"',
        });
        res.end(Buffer.alloc(300_000, 7));
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            method: req.method,
            url: req.url,
            host: req.headers.host,
            origin: req.headers.origin ?? null,
            action: req.headers["x-code-viewer-action"] ?? null,
            fetchSite: req.headers["sec-fetch-site"] ?? null,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      upstream?.listen(0, "127.0.0.1", resolve),
    );
    return `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/`;
  }

  const ENTRY = "http://127.0.0.1:64620";

  test.each([
    [
      "GET keeps the path and query",
      new Request(`${ENTRY}/p/0123456789abcdef/_tree?path=src`, {
        headers: { host: "127.0.0.1:64620" },
      }),
      { method: "GET", url: "/_tree?path=src", origin: null, body: "" },
    ],
    [
      "a same-origin write gets the project process's origin",
      new Request(`${ENTRY}/p/0123456789abcdef/refresh`, {
        method: "POST",
        headers: {
          host: "127.0.0.1:64620",
          origin: ENTRY,
          "x-code-viewer-action": "1",
          "sec-fetch-site": "same-origin",
          "content-type": "application/json",
        },
        body: '{"sample":1}',
      }),
      {
        method: "POST",
        url: "/refresh",
        origin: "UPSTREAM",
        action: "1",
        fetchSite: "same-origin",
        body: '{"sample":1}',
      },
    ],
    [
      "a write from another origin keeps its origin (the project process refuses it)",
      new Request(`${ENTRY}/p/0123456789abcdef/refresh`, {
        method: "POST",
        headers: {
          host: "127.0.0.1:64620",
          origin: "http://127.0.0.1:1",
          "x-code-viewer-action": "1",
        },
        body: "x",
      }),
      {
        method: "POST",
        url: "/refresh",
        origin: "http://127.0.0.1:1",
        body: "x",
      },
    ],
    [
      "a double slash stays a path on the project process origin",
      new Request(`${ENTRY}/p/0123456789abcdef//127.0.0.1:9/x`),
      { url: "//127.0.0.1:9/x", origin: null },
    ],
  ])("%s", async (_label, req, expected) => {
    const base = await startUpstream();
    const path = new URL(req.url).pathname.replace("/p/0123456789abcdef", "");
    const result = await proxyToBackend(
      req,
      base,
      path,
      new URL(req.url).search,
    );
    expect(result.status).toBe("ok");
    const body = await (result as { response: Response }).response.json();
    const origin =
      expected.origin === "UPSTREAM" ? new URL(base).origin : expected.origin;
    expect(body).toMatchObject({
      ...expected,
      origin,
      host: new URL(base).host,
    });
  });

  test("SSE is relayed as it arrives, and the subscriber is released when the browser leaves", async () => {
    const base = await startUpstream();
    const leave = new AbortController();
    let ended = 0;
    const result = await proxyToBackend(
      new Request(`${ENTRY}/p/0123456789abcdef/events`, {
        signal: leave.signal,
      }),
      base,
      "/events",
      "",
      {
        onBodyEnd: () => (ended += 1),
        responseStartMs: 10,
      },
    );
    const response = (result as { response: Response }).response;
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes("event: update")) {
      const chunk = await reader?.read();
      if (!chunk || chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    expect(text).toBe("event: open\ndata: ok\n\nevent: update\ndata: tick\n\n");
    expect(ended).toBe(0);
    await reader?.cancel();
    expect(ended).toBe(1);
  });

  test("a project process that does not start a response reaches the response-start deadline", async () => {
    let receivedSignal: AbortSignal | null = null;
    const result = await proxyToBackend(
      new Request(`${ENTRY}/p/0123456789abcdef/_tree`),
      "http://127.0.0.1:1/",
      "/_tree",
      "",
      {
        responseStartMs: 10,
        fetch: async (_input, init) => {
          const signal = init?.signal;
          if (!(signal instanceof AbortSignal)) {
            throw new Error("proxy fetch did not receive an AbortSignal");
          }
          receivedSignal = signal;
          return await new Promise<Response>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          });
        },
      },
    );

    expect(result.status).toBe("timeout");
    expect(receivedSignal?.aborted).toBe(true);
    expect(result.status === "timeout" && String(result.error)).toContain(
      "timed out after 10ms",
    );
  });

  test("caller cancellation wins over the response-start deadline", async () => {
    const caller = new AbortController();
    caller.abort(new Error("caller left"));
    const result = await proxyToBackend(
      new Request(`${ENTRY}/p/0123456789abcdef/_tree`, {
        signal: caller.signal,
      }),
      "http://127.0.0.1:1/",
      "/_tree",
      "",
      {
        responseStartMs: 1,
        fetch: async (_input, init) => {
          const signal = init?.signal;
          if (!(signal instanceof AbortSignal)) {
            throw new Error("proxy fetch did not receive an AbortSignal");
          }
          signal.throwIfAborted();
          throw new Error("expected the request to be aborted");
        },
      },
    );

    expect(result.status).toBe("unreachable");
    expect(result.status === "unreachable" && String(result.error)).toContain(
      "caller left",
    );
  });

  test("a response-start deadline becomes a 504 with the route, project, wait, and original error", async () => {
    const response = proxyTimeoutResponse(
      "GET",
      "/_tree",
      "0123456789abcdef",
      "/work/sample-app",
      120_000,
      new Error("operation timed out after 120000ms"),
    );

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      error: "the project process did not start responding within 120 seconds",
      code: "backend-timeout",
      route: { method: "GET", path: "/_tree" },
      project: {
        key: "0123456789abcdef",
        root: "/work/sample-app",
      },
      waitedSeconds: 120,
      detail: "Error: operation timed out after 120000ms",
    });
  });

  test("a download is streamed with its headers", async () => {
    const base = await startUpstream();
    const result = await proxyToBackend(
      new Request(`${ENTRY}/p/0123456789abcdef/_file?path=sample.bin`),
      base,
      "/_file",
      "?path=sample.bin",
    );
    const response = (result as { response: Response }).response;
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="sample.bin"',
    );
    expect((await response.arrayBuffer()).byteLength).toBe(300_000);
  });

  test("a project process that is gone is a connection failure (the entry answers 502)", async () => {
    const base = await startUpstream();
    const server = upstream;
    upstream = null;
    await new Promise((resolve) => server?.close(resolve));
    let ended = 0;
    const result = await proxyToBackend(
      new Request(`${ENTRY}/p/0123456789abcdef/_tree`),
      base,
      "/_tree",
      "",
      {
        onBodyEnd: () => (ended += 1),
      },
    );
    expect(result.status).toBe("unreachable");
    expect(isConnectionFailure((result as { error: unknown }).error)).toBe(
      true,
    );
    expect(ended).toBe(1);
  });
});
