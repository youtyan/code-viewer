// opencode のプラグインの中身 (core/agent-hooks.ts の opencodePluginSource) を
// 本当に読み込んで動かす。起動スクリプトの代わりに、受け取った引数と標準入力を
// ファイルに書き足すだけのスクリプトを置く (code-viewer にもサーバにも触らない)。
// 出来事の形は手元の opencode 1.19.5 で観測したものと、@opencode-ai/sdk の
// Event 型 (properties.sessionID・properties.status.type・properties.info.parentID)。

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

type PluginHooks = {
  event(input: { event: { type: string; properties?: unknown } }): unknown;
  dispose(): Promise<void>;
};
type PluginModule = Record<
  string,
  (input: { directory: string }) => Promise<PluginHooks>
>;

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

async function load(launcher: string): Promise<PluginHooks> {
  const file = join(root, `plugin-${Date.now()}-${Math.random()}.mjs`);
  writeFileSync(file, opencodePluginSource({ launcher, failureLog }));
  const module = (await import(pathToFileURL(file).href)) as PluginModule;
  // opencode は書き出した関数をそれぞれプラグインとして呼ぶ。1 つだけ書き出す。
  const plugins = Object.values(module);
  expect(plugins).toHaveLength(1);
  const plugin = plugins[0];
  if (!plugin) throw new Error("the plugin exports nothing");
  return plugin({ directory: "/work/sample" });
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

describe("opencode plugin", () => {
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
