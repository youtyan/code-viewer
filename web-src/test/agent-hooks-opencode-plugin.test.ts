// opencode のプラグインの中身 (core/agent-hooks.ts の opencodePluginSource) を
// 本当に読み込んで動かす。起動スクリプトの代わりに、受け取った引数と標準入力を
// ファイルに書き足すだけのスクリプトを置く (code-viewer にもサーバにも触らない)。
//
// 1 つの default export が opencode 2 と 1 の両方に答える:
// - opencode 1 (1.18.29 以降) は `server({ directory })` を呼び、返った `event` と
//   `dispose` を使う。出来事の形は手元の opencode 1.19.5 で観測したものと、
//   @opencode-ai/sdk の Event 型 (properties.sessionID・properties.status.type・
//   properties.info.parentID)
// - opencode 2 は `id` と `setup(ctx)` を読む。出来事は `ctx.event.subscribe()` から
//   届き、形は手元の opencode 2.2.7 で観測したもの (data.sessionID・
//   data.parentID・data.form.sessionID・data.error.type / message)。片付けは
//   setup が返す関数

import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  OPENCODE_DISPOSE,
  OPENCODE_START,
  opencodePluginSource,
} from "../core/agent-hooks";

type V1Hooks = {
  event(input: { event: { type: string; properties?: unknown } }): unknown;
  dispose(): Promise<void>;
};
type V2Event = { type: string; data?: unknown };
type V2Context = {
  location: { directory: string };
  event: {
    subscribe(options: {
      types?: string[];
      signal?: AbortSignal;
    }): AsyncIterable<V2Event>;
  };
};
type PluginDefinition = {
  id: string;
  setup(ctx: V2Context): (() => Promise<void>) | undefined;
  server(input: { directory: string }): Promise<V1Hooks>;
};

let root: string;
let received: string;
let failureLog: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cv-opencode-plugin-"));
  received = join(root, "received.jsonl");
  failureLog = join(root, "failures.jsonl");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 起動スクリプトの代わり。`<引数> <標準入力>` を 1 行ずつ書き足す。 */
function fakeLauncher(): string {
  const path = join(root, "code-viewer-agent-hook");
  writeFileSync(
    path,
    `#!/bin/sh\nprintf '%s %s\\n' "$1" "$(cat)" >> ${JSON.stringify(received)}\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

async function definition(launcher: string): Promise<PluginDefinition> {
  const file = join(root, `plugin-${Date.now()}-${Math.random()}.mjs`);
  writeFileSync(file, opencodePluginSource({ launcher, failureLog }));
  const module = (await import(pathToFileURL(file).href)) as Record<
    string,
    unknown
  >;
  // opencode 2 は default export だけを読む。ほかに書き出すと、opencode 1 は
  // 書き出したものをそれぞれプラグインとして呼ぶので二重に申告する。
  expect(Object.keys(module)).toEqual(["default"]);
  return module.default as PluginDefinition;
}

/** opencode 1 の呼び方。 */
async function load(launcher: string): Promise<V1Hooks> {
  return (await definition(launcher)).server({ directory: "/work/sample" });
}

/**
 * opencode 2 の呼び方。push で出来事を流し、end で流れを閉じる。subscribe に
 * 渡された types と signal も返す。
 */
function v2Context() {
  const queue: V2Event[] = [];
  let wake: (() => void) | null = null;
  let ended = false;
  const asked: { types?: string[]; signal?: AbortSignal }[] = [];
  const ctx: V2Context = {
    location: { directory: "/work/sample" },
    event: {
      subscribe(options) {
        asked.push(options);
        return {
          async *[Symbol.asyncIterator]() {
            while (true) {
              const next = queue.shift();
              if (next) {
                yield next;
                continue;
              }
              if (ended || options.signal?.aborted) return;
              await new Promise<void>((resolve) => {
                wake = resolve;
                options.signal?.addEventListener("abort", () => resolve(), {
                  once: true,
                });
              });
            }
          },
        };
      },
    },
  };
  return {
    ctx,
    asked,
    push(...events: V2Event[]) {
      queue.push(...events);
      wake?.();
    },
    end() {
      ended = true;
      wake?.();
    },
  };
}

/** 届いた申告。子のプロセスは非同期なので、件数がそろうまで待つ。 */
async function reports(count: number): Promise<Record<string, unknown>[]> {
  for (let i = 0; i < 100; i += 1) {
    const lines = existsSync(received)
      ? readFileSync(received, "utf8").split("\n").filter(Boolean)
      : [];
    if (lines.length >= count) {
      return lines.map((line) => {
        const [agent, ...rest] = line.split(" ");
        expect(agent).toBe("opencode");
        return JSON.parse(rest.join(" ")) as Record<string, unknown>;
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`expected ${count} reports in ${received}`);
}

const status = (sessionID: string, type: string) => ({
  type: "session.status",
  properties: { sessionID, status: { type } },
});

describe("opencode plugin: opencode 1 (server)", () => {
  test("passes each change once, with the session and the folder", async () => {
    const hooks = await load(fakeLauncher());
    for (const event of [
      status("sessionA", "busy"),
      status("sessionA", "busy"),
      { type: "message.part.updated", properties: { sessionID: "sessionA" } },
      { type: "permission.asked", properties: { sessionID: "sessionA" } },
      { type: "permission.replied", properties: { sessionID: "sessionA" } },
      status("sessionA", "busy"),
      status("sessionA", "idle"),
      { type: "session.idle", properties: { sessionID: "sessionA" } },
    ]) {
      await hooks.event({ event });
    }
    await hooks.dispose();
    const got = await reports(7);
    expect(got.map((item) => [item.hook_event_name, item.status])).toEqual([
      [OPENCODE_START, ""],
      ["session.status", "busy"],
      ["permission.asked", ""],
      ["permission.replied", ""],
      ["session.status", "busy"],
      ["session.idle", ""],
      [OPENCODE_DISPOSE, ""],
    ]);
    expect(got[1]).toMatchObject({
      session_id: "sessionA",
      cwd: "/work/sample",
    });
  });

  test("a sub-session reports only its permissions and questions", async () => {
    const hooks = await load(fakeLauncher());
    await hooks.event({
      event: {
        type: "session.created",
        properties: { info: { id: "sessionChild", parentID: "sessionA" } },
      },
    });
    for (const event of [
      status("sessionChild", "busy"),
      { type: "question.asked", properties: { sessionID: "sessionChild" } },
      { type: "session.idle", properties: { sessionID: "sessionChild" } },
    ]) {
      await hooks.event({ event });
    }
    await hooks.dispose();
    const got = await reports(3);
    expect(got.map((item) => item.hook_event_name)).toEqual([
      OPENCODE_START,
      "question.asked",
      OPENCODE_DISPOSE,
    ]);
  });

  test("a launcher that cannot run is written to the failure log", async () => {
    const hooks = await load(join(root, "missing-launcher"));
    await hooks.dispose();
    const lines = readFileSync(failureLog, "utf8").split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const last = JSON.parse(lines[lines.length - 1] ?? "{}");
    expect(last).toMatchObject({
      agent: "opencode",
      hookEvent: OPENCODE_DISPOSE,
      stage: "launch",
    });
    expect(last.detail).toContain("missing-launcher");
  });
});

const v2 = (type: string, data: Record<string, unknown>) => ({ type, data });

describe("opencode plugin: opencode 2 (setup)", () => {
  test("names itself and subscribes to the opencode 2 events only", async () => {
    const plugin = await definition(fakeLauncher());
    expect(plugin.id).toBe("code-viewer.agent-hook");
    const stream = v2Context();
    const cleanup = plugin.setup(stream.ctx);
    const types = stream.asked[0]?.types ?? [];
    expect(types).toEqual(
      expect.arrayContaining([
        "session.created",
        "session.execution.started",
        "session.execution.succeeded",
        "permission.asked",
        "form.created",
      ]),
    );
    // opencode 1 だけの名前を渡すと、opencode 2 はログに警告を出す。
    for (const name of ["session.status", "session.idle", "question.asked"])
      expect(types).not.toContain(name);
    await cleanup?.();
    expect(stream.asked[0]?.signal?.aborted).toBe(true);
  });

  test("passes each change once, with the session and the folder", async () => {
    const plugin = await definition(fakeLauncher());
    const stream = v2Context();
    const cleanup = plugin.setup(stream.ctx);
    stream.push(
      v2("session.created", { sessionID: "sessionA" }),
      v2("session.execution.started", { sessionID: "sessionA" }),
      v2("session.execution.started", { sessionID: "sessionA" }),
      v2("session.text.delta", { sessionID: "sessionA" }),
      v2("permission.asked", { id: "per1", sessionID: "sessionA" }),
      v2("permission.replied", { sessionID: "sessionA", requestID: "per1" }),
      v2("form.created", { form: { id: "form1", sessionID: "sessionA" } }),
      v2("form.replied", { id: "form1", sessionID: "sessionA" }),
      v2("session.execution.succeeded", { sessionID: "sessionA" }),
      v2("session.execution.started", { sessionID: "sessionA" }),
      v2("form.created", { form: { id: "form2", sessionID: "sessionA" } }),
      v2("form.cancelled", { id: "form2", sessionID: "sessionA" }),
      v2("session.execution.interrupted", { sessionID: "sessionA" }),
    );
    const got = await reports(11);
    await cleanup?.();
    const all = await reports(12);
    expect(all.map((item) => item.hook_event_name)).toEqual([
      OPENCODE_START,
      "session.execution.started",
      "permission.asked",
      "permission.replied",
      "form.created",
      "form.replied",
      "session.execution.succeeded",
      "session.execution.started",
      "form.created",
      "form.cancelled",
      "session.execution.interrupted",
      OPENCODE_DISPOSE,
    ]);
    expect(got[4]).toMatchObject({
      session_id: "sessionA",
      cwd: "/work/sample",
    });
  });

  test("answering one of two permissions asked at once is not back to work yet", async () => {
    const plugin = await definition(fakeLauncher());
    const stream = v2Context();
    const cleanup = plugin.setup(stream.ctx);
    stream.push(
      v2("session.execution.started", { sessionID: "sessionA" }),
      v2("permission.asked", { id: "per1", sessionID: "sessionA" }),
      v2("permission.asked", { id: "per2", sessionID: "sessionA" }),
      v2("permission.replied", { sessionID: "sessionA", requestID: "per1" }),
    );
    // 2 つ目に答えるまでは、答えの出来事を送らない。
    await reports(3);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await reports(3)).toHaveLength(3);
    stream.push(
      v2("permission.replied", { sessionID: "sessionA", requestID: "per2" }),
      v2("session.execution.succeeded", { sessionID: "sessionA" }),
    );
    await reports(5);
    await cleanup?.();
    const got = await reports(6);
    expect(got.map((item) => item.hook_event_name)).toEqual([
      OPENCODE_START,
      "session.execution.started",
      "permission.asked",
      "permission.replied",
      "session.execution.succeeded",
      OPENCODE_DISPOSE,
    ]);
  });

  test("a failed turn carries the error type and message", async () => {
    const plugin = await definition(fakeLauncher());
    const stream = v2Context();
    const cleanup = plugin.setup(stream.ctx);
    stream.push(
      v2("session.execution.failed", {
        sessionID: "sessionA",
        error: {
          type: "provider.auth",
          message: "sample failure",
          status: 401,
        },
      }),
    );
    const got = await reports(2);
    await cleanup?.();
    expect(got[1]).toMatchObject({
      hook_event_name: "session.execution.failed",
      session_id: "sessionA",
      error: "provider.auth",
      error_details: "sample failure",
    });
  });

  test("a sub-session reports only its permissions and questions", async () => {
    const plugin = await definition(fakeLauncher());
    const stream = v2Context();
    const cleanup = plugin.setup(stream.ctx);
    stream.push(
      v2("session.created", {
        sessionID: "sessionChild",
        parentID: "sessionA",
      }),
      v2("session.execution.started", { sessionID: "sessionChild" }),
      v2("permission.asked", { id: "per1", sessionID: "sessionChild" }),
      v2("session.execution.succeeded", { sessionID: "sessionChild" }),
    );
    await reports(2);
    await cleanup?.();
    const got = await reports(3);
    expect(got.map((item) => item.hook_event_name)).toEqual([
      OPENCODE_START,
      "permission.asked",
      OPENCODE_DISPOSE,
    ]);
  });

  test("in the shared background service it reports nothing and says why", async () => {
    const plugin = await definition(fakeLauncher());
    const stream = v2Context();
    const argv = process.argv;
    process.argv = [...argv, "serve", "--service"];
    let cleanup: (() => Promise<void>) | undefined;
    try {
      cleanup = plugin.setup(stream.ctx);
    } finally {
      process.argv = argv;
    }
    expect(cleanup).toBeUndefined();
    expect(stream.asked).toEqual([]);
    expect(existsSync(received)).toBe(false);
    const lines = readFileSync(failureLog, "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? "{}");
    expect(record).toMatchObject({
      agent: "opencode",
      hookEvent: OPENCODE_START,
      stage: "service",
    });
    expect(record.detail).toContain("--standalone");
  });

  test("an event stream that ends by itself is written to the failure log", async () => {
    const plugin = await definition(fakeLauncher());
    const stream = v2Context();
    plugin.setup(stream.ctx);
    stream.end();
    for (let i = 0; i < 100 && !existsSync(failureLog); i += 1)
      await new Promise((resolve) => setTimeout(resolve, 20));
    const record = JSON.parse(
      readFileSync(failureLog, "utf8").split("\n").filter(Boolean)[0] ?? "{}",
    );
    expect(record).toMatchObject({ agent: "opencode", stage: "events" });
  });
});
