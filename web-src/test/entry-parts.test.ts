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
  writeEntryRecord,
} from "../server/entry/entry-file";
import { createEntryProjects } from "../server/entry/projects";
import { isConnectionFailure, proxyToBackend } from "../server/entry/proxy";
import { rootFileKey } from "../server/server-registry";
import type { WorktreeOpenResult } from "../server/worktree/open";

const DEAD_PID = 2_147_483_000;

describe("entry.json", () => {
  const record = {
    url: "http://127.0.0.1:64620/",
    pid: process.pid,
    version: "1.0.0",
    started_at: "2026-01-01T00:00:00.000Z",
  };

  test("written, read back, and removed only by its owner", () => {
    const file = join(mkdtempSync(join(tmpdir(), "entry-file-")), "entry.json");
    expect(readEntryRecord(file)).toEqual({ ok: true, registry: null });
    writeEntryRecord(record, file);
    expect(readEntryRecord(file)).toEqual({ ok: true, registry: record });
    expect(liveEntryUrl(file)).toBe("http://127.0.0.1:64620");
    removeEntryRecord(process.pid + 1, file);
    expect(readEntryRecord(file)).toEqual({ ok: true, registry: record });
    removeEntryRecord(process.pid, file);
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
  ])("a broken record (%s) is reported, not treated as absent", (_label, text, reason) => {
    const file = join(mkdtempSync(join(tmpdir(), "entry-file-")), "entry.json");
    writeFileSync(file, text);
    const read = readEntryRecord(file);
    expect(read.ok).toBe(false);
    expect(read.ok === false && read.error).toContain(reason);
    expect(() => liveEntryUrl(file)).toThrow(reason);
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
  function backends(outcomes: WorktreeOpenResult[]) {
    const opens: unknown[] = [];
    const stops: string[] = [];
    const deps: EntryBackendsDeps = {
      entryPid: 4242,
      controller: {
        openWorktreeServer: async (_root, options) => {
          opens.push(options);
          return outcomes.shift() ?? { status: "timeout" };
        },
        runningServerResult: async () => ({ status: "absent" }),
        stopWorktreeServer: async (root) => {
          stops.push(root);
        },
      },
      logFile: () => "/state/server-logs/sample.log",
      logTail: () => "server output: sample tail",
      registryPid: () => 777,
      serverArgs: () => ["--staged"],
    };
    return { b: createEntryBackends(deps), opens, stops };
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
    expect(await b.target(ROOT)).toEqual({
      status: "ok",
      url: "http://127.0.0.1:65001/",
      pid: 777,
      started: true,
    });
    await b.target(ROOT);
    expect(opens).toEqual([
      {
        port: 0,
        logFile: "/state/server-logs/sample.log",
        backendOf: 4242,
        serverArgs: ["--staged"],
      },
    ]);
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
  });

  test("after it stopped: not started by ordinary requests, once by the SSE reconnect, again by restart", async () => {
    const { b, opens } = backends([ok(65001), ok(65002), ok(65003)]);
    await b.target(ROOT);
    const down = b.noteUnreachable(ROOT, refused);
    expect(down.status).toBe("stopped");
    expect(down.status === "stopped" && down.detail).toContain("ECONNREFUSED");
    expect((await b.target(ROOT)).status).toBe("stopped");
    expect(await b.target(ROOT, { events: true })).toMatchObject({
      status: "ok",
      url: "http://127.0.0.1:65002/",
    });
    b.noteUnreachable(ROOT, refused);
    expect((await b.target(ROOT, { events: true })).status).toBe("stopped");
    expect(await b.restart(ROOT)).toMatchObject({
      status: "ok",
      url: "http://127.0.0.1:65003/",
    });
    expect(opens).toHaveLength(3);
  });

  test("stopping from the menu forgets it, and the next request starts it again", async () => {
    const { b, stops } = backends([ok(65001), ok(65002)]);
    await b.target(ROOT);
    await b.stop(ROOT);
    expect(stops).toEqual([ROOT]);
    expect(await b.target(ROOT)).toMatchObject({
      status: "ok",
      url: "http://127.0.0.1:65002/",
    });
  });

  test("counts SSE subscribers; releasing twice counts once", () => {
    const { b } = backends([]);
    const first = b.subscribe(ROOT);
    const second = b.subscribe(ROOT);
    expect(b.subscriberCount(ROOT)).toBe(2);
    first();
    first();
    expect(b.subscriberCount(ROOT)).toBe(1);
    second();
    expect(b.subscriberCount(ROOT)).toBe(0);
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
      { onBodyEnd: () => (ended += 1) },
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
