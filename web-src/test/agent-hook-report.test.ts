// フックから呼ばれる申告 (`code-viewer terminal hook`)。
//
// 守りたいのは、動いている全部のサーバに届くこと、1 つの失敗でほかを
// 止めないこと、どう失敗しても終了コード 0 ですぐ終わり、失敗が記録に
// 残ること。後半は起動スクリプトから焼いた CLI までを本物のプロセスで通す。

import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { AGENT_HOOK_MARKER, type AgentHookFailure } from "../core/agent-hooks";
import type { ServerRegistryEntry } from "../server/server-registry";
import {
  type HookReportDeps,
  reportAgentHook,
  reportTargets,
} from "../server/terminal/hook-report";
import {
  type HookLauncher,
  hookLauncherScript,
  readHookFailures,
} from "../server/terminal/hooks";

const REPO_ROOT = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
);
const CLI_BUNDLE = join(REPO_ROOT, "dist", "code-viewer.js");

function server(url: string): ServerRegistryEntry {
  return { url, pid: process.pid, root: "/repo", started_at: "2026-01-01" };
}

type Posted = { url: string; body: Record<string, unknown> };

function fakeDeps(options: {
  servers?: ServerRegistryEntry[];
  registryErrors?: { file: string; error: unknown }[];
  respond?: (url: string) => Promise<Response>;
  env?: Record<string, string>;
  entryUrl?: () => string | null;
}): { deps: HookReportDeps; posted: Posted[]; failures: AgentHookFailure[] } {
  const posted: Posted[] = [];
  const failures: AgentHookFailure[] = [];
  return {
    posted,
    failures,
    deps: {
      now: () => 1_000,
      env: options.env ?? { TMUX_PANE: "%7" },
      listServers: () => ({
        servers: options.servers ?? [],
        errors: options.registryErrors ?? [],
      }),
      entryUrl: options.entryUrl ?? (() => null),
      post: async (url, body) => {
        posted.push({ url, body: body as Record<string, unknown> });
        return options.respond
          ? options.respond(url)
          : new Response("{}", { status: 200 });
      },
      recordFailure: (failure) => failures.push(failure),
    },
  };
}

const STOP = JSON.stringify({ hook_event_name: "Stop", session_id: "s1" });

describe("reportAgentHook", () => {
  test("reports to every running server", async () => {
    const { deps, posted, failures } = fakeDeps({
      servers: [server("http://127.0.0.1:1/"), server("http://127.0.0.1:2")],
    });
    const outcome = await reportAgentHook("claude", STOP, deps);
    expect(outcome).toEqual({
      kind: "reported",
      event: "stop",
      servers: ["http://127.0.0.1:1", "http://127.0.0.1:2"],
    });
    expect(posted.map((item) => item.url).sort()).toEqual([
      "http://127.0.0.1:1/_agent/state",
      "http://127.0.0.1:2/_agent/state",
    ]);
    expect(posted[0]?.body).toEqual({
      target: "%7",
      event: "stop",
      at: 1_000,
      agent: "claude",
    });
    expect(failures).toEqual([]);
  });

  test("sends the prompt text with a prompt", async () => {
    const { deps, posted } = fakeDeps({ servers: [server("http://a")] });
    await reportAgentHook(
      "codex",
      JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "fix it" }),
      deps,
    );
    expect(posted[0]?.body).toMatchObject({
      event: "prompt",
      agent: "codex",
      lastPrompt: "fix it",
    });
  });

  test("one failing server does not stop the others", async () => {
    const { deps, posted, failures } = fakeDeps({
      servers: [
        server("http://ok"),
        server("http://bad"),
        server("http://down"),
      ],
      respond: async (url) => {
        if (url.startsWith("http://bad")) {
          return new Response("invalid target", { status: 400 });
        }
        if (url.startsWith("http://down")) throw new Error("connect refused");
        return new Response("{}", { status: 200 });
      },
    });
    const outcome = await reportAgentHook("claude", STOP, deps);
    expect(posted).toHaveLength(3);
    expect(outcome.kind).toBe("failed");
    expect(
      failures.map((item) => [item.server, item.stage, item.detail]).sort(),
    ).toEqual([
      ["http://bad", "report", "Error: HTTP 400: invalid target"],
      ["http://down", "report", "Error: connect refused"],
    ]);
    for (const failure of failures) {
      expect(failure).toMatchObject({
        at: 1_000,
        agent: "claude",
        hookEvent: "Stop",
        event: "stop",
        target: "%7",
      });
    }
  });

  test.each([
    {
      name: "no running server",
      options: {},
      stage: "no-server",
      detail: "no running code-viewer server",
    },
    {
      name: "broken JSON input",
      options: { servers: [server("http://a")] },
      stdin: "{",
      stage: "input",
      detail: "could not read the hook input",
    },
    {
      name: "non-object input",
      options: { servers: [server("http://a")] },
      stdin: "[]",
      stage: "input",
      detail: "not a JSON object",
    },
  ])("records a failure: $name", async ({ options, stdin, stage, detail }) => {
    const { deps, posted, failures } = fakeDeps(options);
    const outcome = await reportAgentHook("claude", stdin ?? STOP, deps);
    expect(outcome.kind).toBe("failed");
    expect(posted).toEqual([]);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.stage).toBe(stage);
    expect(failures[0]?.detail).toContain(detail);
  });

  test("does not keep malformed hook input contents in a failure", async () => {
    const secret = "sample-secret-value";
    const stdin = `{"prompt":"${secret}"`;
    const { deps, failures } = fakeDeps({
      servers: [server("http://a")],
    });
    await reportAgentHook("claude", stdin, deps);
    expect(failures[0]?.detail).not.toContain(secret);
    expect(failures[0]?.detail).toContain("31 bytes, not shown");
  });

  test("a refused connection is a server that is gone, not a failed report", async () => {
    const refused = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
      }),
    });
    const { deps, failures } = fakeDeps({
      servers: [server("http://ok"), server("http://gone")],
      respond: async (url) => {
        if (url.startsWith("http://gone")) throw refused;
        return new Response("{}", { status: 200 });
      },
    });
    const outcome = await reportAgentHook("claude", STOP, deps);
    expect(outcome).toEqual({
      kind: "reported",
      event: "stop",
      servers: ["http://ok"],
    });
    expect(failures).toEqual([]);
  });

  test("when every registered server refuses, it is recorded as no server", async () => {
    const refused = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ECONNREFUSED" },
    });
    const { deps, failures } = fakeDeps({
      servers: [server("http://gone-a"), server("http://gone-b")],
      respond: async () => {
        throw refused;
      },
    });
    const outcome = await reportAgentHook("codex", STOP, deps);
    expect(outcome.kind).toBe("failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]?.stage).toBe("no-server");
    expect(failures[0]?.detail).toContain("http://gone-a, http://gone-b");
  });

  test("an unreadable registry entry is recorded and the rest still get it", async () => {
    const { deps, posted, failures } = fakeDeps({
      servers: [server("http://a")],
      registryErrors: [{ file: "/reg/x.json", error: new Error("bad json") }],
    });
    await reportAgentHook("claude", STOP, deps);
    expect(posted).toHaveLength(1);
    expect(failures).toEqual([
      expect.objectContaining({
        server: "/reg/x.json",
        stage: "registry",
        detail: "Error: bad json",
      }),
    ]);
  });

  test.each([
    {
      name: "an event that is not reported",
      stdin: JSON.stringify({
        hook_event_name: "Notification",
        notification_type: "idle_prompt",
      }),
      env: { TMUX_PANE: "%7" },
    },
    { name: "outside tmux", stdin: STOP, env: {} },
    { name: "a malformed pane id", stdin: STOP, env: { TMUX_PANE: "7;x" } },
  ])("skips without contacting servers: $name", async ({ stdin, env }) => {
    const { deps, posted, failures } = fakeDeps({
      servers: [server("http://a")],
      env,
    });
    const outcome = await reportAgentHook("claude", stdin, deps);
    expect(outcome.kind).toBe("skipped");
    expect(posted).toEqual([]);
    expect(failures).toEqual([]);
  });
});

describe("launcher -> CLI (real processes)", () => {
  let root: string;
  let registry: string;
  let launcher: HookLauncher;
  const servers: Server[] = [];
  const received: { port: number; body: Record<string, unknown> }[] = [];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cv-hook-report-"));
    registry = join(root, "registry");
    mkdirSync(registry);
    launcher = {
      path: join(root, "state", AGENT_HOOK_MARKER),
      failureLog: join(root, "state", "failures.jsonl"),
      node: process.execPath,
      cli: CLI_BUNDLE,
      registryDir: registry,
    };
    mkdirSync(join(root, "state"));
    writeFileSync(launcher.path, hookLauncherScript(launcher), "utf8");
    chmodSync(launcher.path, 0o755);
    received.length = 0;
  });

  afterEach(async () => {
    await Promise.all(
      servers
        .splice(0)
        .map(
          (item) => new Promise<void>((resolve) => item.close(() => resolve())),
        ),
    );
    rmSync(root, { recursive: true, force: true });
  });

  async function startServer(name: string): Promise<number> {
    const item = createServer((req, res) => {
      let text = "";
      req.on("data", (chunk: Buffer) => {
        text += chunk.toString("utf8");
      });
      req.on("end", () => {
        const port = (item.address() as AddressInfo).port;
        received.push({ port, body: JSON.parse(text) });
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      });
    });
    servers.push(item);
    await new Promise<void>((resolve) => item.listen(0, "127.0.0.1", resolve));
    const port = (item.address() as AddressInfo).port;
    writeFileSync(
      join(registry, `${name}.json`),
      JSON.stringify({
        url: `http://127.0.0.1:${port}`,
        pid: process.pid,
        root: `/sample/${name}`,
        started_at: "2026-01-01T00:00:00Z",
      }),
      "utf8",
    );
    return port;
  }

  function runHook(
    agent: string,
    stdin: string,
  ): Promise<{ code: number | null; ms: number; stderr: string }> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const child = spawn(launcher.path, [agent], {
        env: { ...process.env, TMUX_PANE: "%42" },
        stdio: ["pipe", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.once("error", reject);
      child.once("exit", (code) =>
        resolve({ code, ms: Date.now() - started, stderr }),
      );
      child.stdin?.end(stdin);
    });
  }

  test("one report reaches both servers", async () => {
    const ports = [await startServer("one"), await startServer("two")];
    const result = await runHook("claude", STOP);
    expect(result.code).toBe(0);
    expect(received.map((item) => item.port).sort()).toEqual(ports.sort());
    for (const item of received) {
      expect(item.body).toMatchObject({
        target: "%42",
        event: "stop",
        agent: "claude",
      });
    }
    expect(readHookFailures(launcher.failureLog).total).toBe(0);
  });

  test("with no server it exits 0 at once and logs why", async () => {
    const result = await runHook("codex", STOP);
    expect(result.code).toBe(0);
    expect(result.ms).toBeLessThan(3000);
    const failures = readHookFailures(launcher.failureLog);
    expect(failures.total).toBe(1);
    expect(failures.recent[0]).toMatchObject({
      agent: "codex",
      hookEvent: "Stop",
      event: "stop",
      target: "%42",
      stage: "no-server",
    });
  });

  test("when code-viewer is gone the launcher exits 0 and logs it", async () => {
    const gone = { ...launcher, cli: join(root, "missing", "code-viewer.js") };
    writeFileSync(launcher.path, hookLauncherScript(gone), "utf8");
    const result = await runHook("claude", STOP);
    expect(result.code).toBe(0);
    const failures = readHookFailures(launcher.failureLog);
    expect(failures.recent[0]).toMatchObject({
      agent: "claude",
      stage: "launch",
    });
    expect(failures.recent[0]?.detail).toContain(gone.cli);
    expect(
      readFileSync(launcher.failureLog, "utf8").trim().split("\n"),
    ).toHaveLength(1);
  });
});

describe("where hook reports go", () => {
  const entry = "http://127.0.0.1:64100";
  const standalone: ServerRegistryEntry = {
    url: "http://127.0.0.1:64200/",
    pid: 1,
    root: "/work/a",
    started_at: "x",
  };
  const backend: ServerRegistryEntry = {
    url: "http://127.0.0.1:64300/",
    pid: 2,
    root: "/work/b",
    started_at: "x",
    launched: true,
    backend: true,
  };
  test.each([
    ["no entry, no servers", null, [], []],
    ["the entry alone", entry, [], [entry]],
    [
      "the entry and a standalone server",
      entry,
      [standalone],
      [entry, "http://127.0.0.1:64200"],
    ],
    ["a project process of the entry is skipped", entry, [backend], [entry]],
    ["only project processes", null, [backend], []],
    [
      "the entry registered twice is sent once",
      `${entry}/`,
      [{ ...standalone, url: `${entry}/` }],
      [entry],
    ],
  ] as const)("%s", (_label, entryUrl, servers, expected) => {
    expect(
      reportTargets({ servers: [...servers], errors: [] }, entryUrl),
    ).toEqual(expected);
  });

  test("a report reaches the entry server even with no registered server", async () => {
    const { deps, posted, failures } = fakeDeps({ entryUrl: () => entry });
    const outcome = await reportAgentHook(
      "claude",
      JSON.stringify({ hook_event_name: "Stop" }),
      deps,
    );
    expect(posted.map((item) => item.url)).toEqual([`${entry}/_agent/state`]);
    expect(failures).toEqual([]);
    expect(outcome).toEqual({
      kind: "reported",
      event: "stop",
      servers: [entry],
    });
  });

  test("an unreadable entry record is recorded, and the registered servers still get the report", async () => {
    const { deps, posted, failures } = fakeDeps({
      servers: [standalone],
      entryUrl: () => {
        throw new Error("entry.json is not valid JSON");
      },
    });
    await reportAgentHook(
      "claude",
      JSON.stringify({ hook_event_name: "Stop" }),
      deps,
    );
    expect(posted.map((item) => item.url)).toEqual([
      "http://127.0.0.1:64200/_agent/state",
    ]);
    expect(failures.map((failure) => [failure.stage, failure.detail])).toEqual([
      ["registry", "Error: entry.json is not valid JSON"],
    ]);
  });
});
