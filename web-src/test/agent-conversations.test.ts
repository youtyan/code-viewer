// 会話の場所の保存と読み戻し (server/terminal/agent-conversations.ts)。
//
// サーバを起こし直しても「別のアカウントで続ける」が使えるよう、フックが
// 知らせた場所だけを保存し、同じ tmux のサーバの世代・同じ種類のエージェント・
// 記録のファイルが実在する、の 3 つを満たすものだけを戻す。状態は戻さない。
//
// パス・名前はすべて架空。保存先はテストごとの一時ディレクトリ。

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { AgentConversation } from "../core/agent-state";
import {
  decideConversationRestore,
  flushConversationPersistence,
  getConversationStoreErrors,
  MAX_SAVED_CONVERSATIONS,
  parseSavedConversations,
  readSavedConversations,
  restoreSavedConversations,
  type SavedAgentConversation,
  savedConversationsText,
  startConversationPersistence,
  stopConversationPersistence,
} from "../server/terminal/agent-conversations";
import {
  type AgentConversationEntry,
  clearAgentStates,
  getAgentConversation,
  getAgentState,
  MAX_TRACKED_TARGETS,
  recordAgentState,
  setAgentTmuxGeneration,
} from "../server/terminal/agent-state";

const LOG = "/home/sample/.claude/projects/-work-sample-app/sample.jsonl";

function conversation(transcriptPath = LOG): AgentConversation {
  return { sessionId: "abc123", transcriptPath, cwd: "/work/sample-app" };
}

function saved(
  over: Partial<SavedAgentConversation> = {},
): SavedAgentConversation {
  return {
    generation: "g1",
    target: "%3",
    agent: "claude",
    conversation: conversation(),
    at: 1000,
    ...over,
  };
}

describe("parseSavedConversations", () => {
  const file = (entries: unknown, version: unknown = 1) => ({
    version,
    entries,
  });
  test.each([
    { name: "正しい形", raw: file([saved()]), issue: null },
    { name: "空", raw: file([]), issue: null },
    { name: "オブジェクトでない", raw: [], issue: "expected an object" },
    { name: "版が違う", raw: file([], 2), issue: "version: expected 1" },
    {
      name: "entries が配列でない",
      raw: file({}),
      issue: "entries: expected an array",
    },
    {
      name: "世代が空",
      raw: file([saved({ generation: "" })]),
      issue: "entries[0]: generation",
    },
    {
      name: "ブラウザのシェルの鍵",
      raw: file([saved({ target: "shell-1" })]),
      issue: "entries[0]: target is not a tmux pane id",
    },
    {
      name: "種類が違う",
      raw: file([{ ...saved(), agent: "sample-agent" }]),
      issue: "entries[0]: agent is not claude or codex",
    },
    {
      name: "相対パスの記録",
      raw: file([saved({ conversation: conversation("sample.jsonl") })]),
      issue: "entries[0]: conversation is not a valid conversation",
    },
    {
      name: "時刻が負",
      raw: file([saved({ at: -1 })]),
      issue: "entries[0]: at",
    },
    {
      name: "上限を超える",
      raw: file(
        Array.from({ length: MAX_SAVED_CONVERSATIONS + 1 }, (_, index) =>
          saved({ target: `%${index}` }),
        ),
      ),
      issue: `more than ${MAX_SAVED_CONVERSATIONS}`,
    },
  ])("$name", ({ raw, issue }) => {
    const result = parseSavedConversations(raw);
    if (issue === null) {
      expect(result).toEqual({ ok: true, registry: raw.entries });
    } else {
      expect(result.ok).toBe(false);
      expect(result.ok === false ? result.issues.join("\n") : "").toContain(
        issue,
      );
    }
  });
});

describe("decideConversationRestore", () => {
  const panes = [
    { id: "%3", command: "claude" },
    { id: "%4", command: "2.1.0" },
    { id: "%5", command: "codex" },
    { id: "%6", command: "zsh" },
  ];
  const exists = (path: string) => path === LOG;
  test.each([
    { name: "条件を全部満たす", entry: saved(), reason: null },
    {
      name: "版の番号で動く claude",
      entry: saved({ target: "%4" }),
      reason: null,
    },
    {
      name: "codex",
      entry: saved({ target: "%5", agent: "codex" }),
      reason: null,
    },
    {
      name: "tmux のサーバの世代が違う",
      entry: saved({ generation: "g0" }),
      reason: "tmux-generation",
    },
    {
      name: "ペインが無い",
      entry: saved({ target: "%9" }),
      reason: "pane-gone",
    },
    {
      name: "ペインが今は別の種類のエージェント",
      entry: saved({ target: "%5" }),
      reason: "agent-changed",
    },
    {
      name: "ペインが今はシェル",
      entry: saved({ target: "%6" }),
      reason: "agent-changed",
    },
    {
      name: "記録のファイルが無い",
      entry: saved({ conversation: conversation("/nowhere/sample.jsonl") }),
      reason: "transcript-missing",
    },
  ])("$name", ({ entry, reason }) => {
    const { generation: _generation, ...kept } = entry;
    expect(decideConversationRestore([entry], "g1", panes, exists)).toEqual(
      reason === null
        ? { restore: [kept], dropped: [] }
        : { restore: [], dropped: [{ entry, reason }] },
    );
  });
});

describe("savedConversationsText", () => {
  const entry = (
    index: number,
    transcriptPath = LOG,
  ): AgentConversationEntry => ({
    target: `%${index}`,
    agent: "claude",
    conversation: conversation(transcriptPath),
    at: index,
  });
  test.each([
    {
      name: "上限までは全部",
      count: MAX_SAVED_CONVERSATIONS,
      kept: MAX_SAVED_CONVERSATIONS,
    },
    {
      name: "上限を超えたら新しいものだけ",
      count: MAX_SAVED_CONVERSATIONS + 5,
      kept: MAX_SAVED_CONVERSATIONS,
    },
  ])("$name", ({ count, kept }) => {
    const text = savedConversationsText(
      "g1",
      Array.from({ length: count }, (_, index) => entry(index)),
    );
    const parsed = parseSavedConversations(JSON.parse(text));
    if (parsed.ok === false) throw new Error(parsed.issues.join("\n"));
    expect([
      parsed.registry.length,
      Math.min(...parsed.registry.map((item) => item.at)),
    ]).toEqual([kept, count - kept]);
  });

  test("記録のファイルの場所が無いもの (codex の null) は書かない", () => {
    const text = savedConversationsText("g1", [entry(1), entry(2, "")]);
    expect(
      JSON.parse(text).entries.map((item: { target: string }) => item.target),
    ).toEqual(["%1"]);
  });
});

describe("サーバの中の保存と読み戻し", () => {
  let root = "";
  let path = "";
  let log = "";

  beforeEach(() => {
    clearAgentStates();
    stopConversationPersistence();
    root = mkdtempSync(join(tmpdir(), "cv-conversations-"));
    path = join(root, "state", "agent-conversations.json");
    log = join(root, "sample.jsonl");
    writeFileSync(log, "");
  });
  afterEach(async () => {
    await flushConversationPersistence();
    stopConversationPersistence();
    clearAgentStates();
    rmSync(root, { recursive: true, force: true });
  });

  /** サーバが起きて最初の巡回を終えたところ。 */
  function boot(generation: string, panes = [{ id: "%3", command: "claude" }]) {
    startConversationPersistence(path);
    setAgentTmuxGeneration(generation);
    restoreSavedConversations(generation, panes);
  }

  /** サーバを落とす (メモリを捨てる)。 */
  async function shutdown() {
    await flushConversationPersistence();
    stopConversationPersistence();
    clearAgentStates();
  }

  const report = (event: "prompt" | "stop" | "exit", at = 1000) =>
    recordAgentState({
      target: "%3",
      event,
      source: "hook",
      agent: "claude",
      at,
      ...(event === "exit" ? {} : { conversation: conversation(log) }),
    });

  test("申告の場所を 0600 で保存し、起こし直すと場所だけが戻る (状態は戻らない)", async () => {
    boot("g1");
    report("stop");
    await shutdown();
    expect(statSync(path).mode & 0o777).toBe(0o600);

    boot("g1");
    expect([
      getAgentConversation("%3")?.conversation,
      getAgentState("%3"),
      getConversationStoreErrors(),
    ]).toEqual([conversation(log), null, []]);
  });

  test.each([
    {
      name: "tmux のサーバの世代が違う",
      restart: () => boot("g2"),
    },
    {
      name: "ペインが今は別の種類",
      restart: () => boot("g1", [{ id: "%3", command: "codex" }]),
    },
    {
      name: "記録のファイルが消えた",
      restart: () => {
        rmSync(log);
        boot("g1");
      },
    },
    {
      name: "ペインが無い",
      restart: () => boot("g1", [{ id: "%4", command: "claude" }]),
    },
  ])("$name なら戻さず、保存からも落とす", async ({ restart }) => {
    boot("g1");
    report("stop");
    await shutdown();

    restart();
    await flushConversationPersistence();
    expect([getAgentConversation("%3"), readSavedConversations(path)]).toEqual([
      null,
      { ok: true, registry: [] },
    ]);
  });

  test("セッションの終わり (exit) で保存からも外す", async () => {
    boot("g1");
    report("stop");
    report("exit", 2000);
    await shutdown();
    expect(readSavedConversations(path)).toEqual({ ok: true, registry: [] });
  });

  test("起動の後に届いた申告は、保存より新しいので上書きしない", async () => {
    boot("g1");
    report("stop");
    await shutdown();

    startConversationPersistence(path);
    setAgentTmuxGeneration("g1");
    const newer = join(root, "newer.jsonl");
    writeFileSync(newer, "");
    recordAgentState({
      target: "%3",
      event: "prompt",
      source: "hook",
      agent: "claude",
      at: 3000,
      conversation: conversation(newer),
    });
    restoreSavedConversations("g1", [{ id: "%3", command: "claude" }]);
    await flushConversationPersistence();
    const read = readSavedConversations(path);
    expect([
      getAgentConversation("%3")?.conversation.transcriptPath,
      read.ok === false
        ? read.error
        : read.registry.map((item) => item.conversation.transcriptPath),
    ]).toEqual([newer, [newer]]);
  });

  test.each([
    { name: "JSON でない", text: "{" },
    { name: "形が違う", text: '{"version":1,"entries":[{"target":"%3"}]}' },
  ])("壊れた保存 ($name) は使わず、上書きもせず、理由を出す", async ({
    text,
  }) => {
    mkdirSync(join(root, "state"));
    writeFileSync(path, text);
    boot("g1");
    report("stop");
    await flushConversationPersistence();
    expect([
      readFileSync(path, "utf8"),
      getConversationStoreErrors().map((error) => [
        error.operation,
        error.target,
      ]),
    ]).toEqual([
      text,
      [
        ["restore_conversations", path],
        ["save_conversations", path],
      ],
    ]);
  });

  test("読めない保存 (権限) も使わず、理由を出す", async () => {
    mkdirSync(join(root, "state"));
    writeFileSync(path, savedConversationsText("g1", []));
    chmodSync(path, 0o000);
    try {
      boot("g1");
      expect(getConversationStoreErrors()[0]?.detail).toContain(
        `cannot read ${path}`,
      );
    } finally {
      chmodSync(path, 0o600);
    }
  });

  test(`メモリに覚える数も上限 (${MAX_TRACKED_TARGETS}) で、古い受け取りから落とす`, () => {
    setAgentTmuxGeneration("g1");
    for (let index = 0; index <= MAX_TRACKED_TARGETS; index += 1) {
      recordAgentState({
        target: `%${index}`,
        event: "stop",
        source: "hook",
        agent: "claude",
        at: 1000 + index,
        conversation: conversation(log),
      });
    }
    expect([
      getAgentConversation("%0"),
      getAgentConversation("%1")?.at,
    ]).toEqual([null, 1001]);
  });
});
