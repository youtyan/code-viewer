// 未読と「状態が変わった時刻」の保存と読み戻し (server/terminal/unread-store.ts)。
//
// サーバを起こし直しても未読と経過時間が消えないように保存し、同じ tmux の
// サーバの世代・同じペインで、起きた後に最初に観測した状態が保存したときと
// 同じ組のときだけ戻す。状態そのものは戻さない (終わったものを待ちと出さない)。
//
// 保存先はテストごとの一時ディレクトリ。

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
import type { AgentState } from "../core/agent-state";
import {
  clearAgentStates,
  getAgentState,
  recordAgentState,
  setAgentTmuxGeneration,
} from "../server/terminal/agent-state";
import {
  agentUnreadSnapshot,
  resetAgentUnread,
} from "../server/terminal/unread";
import {
  decideUnreadRestore,
  flushUnreadPersistence,
  getUnreadStoreErrors,
  parseSavedUnread,
  readSavedUnread,
  type SavedAgentUnread,
  startUnreadPersistence,
  stopUnreadPersistence,
} from "../server/terminal/unread-store";

const PANE = "%3";

function saved(over: Partial<SavedAgentUnread> = {}): SavedAgentUnread {
  return {
    generation: "g1",
    target: PANE,
    state: "waiting",
    changedAt: 1000,
    unread: "waiting",
    ...over,
  };
}

describe("decideUnreadRestore", () => {
  test.each([
    {
      name: "same waiting: time and unread come back",
      entry: saved(),
      first: "waiting",
      expected: { changedAt: 1000, unread: "waiting" },
    },
    {
      name: "finished then still stopped (idle): both come back",
      entry: saved({ state: "done", unread: "finished" }),
      first: "idle",
      expected: { changedAt: 1000, unread: "finished" },
    },
    {
      name: "working stays working: only the time",
      entry: saved({ state: "working", unread: undefined }),
      first: "working",
      expected: { changedAt: 1000, unread: null },
    },
    {
      name: "waiting then working: something happened, nothing comes back",
      entry: saved(),
      first: "working",
      expected: null,
    },
    {
      name: "stopped then waiting: nothing comes back",
      entry: saved({ state: "idle", unread: "finished" }),
      first: "waiting",
      expected: null,
    },
    {
      name: "the time was never seen and nothing unread: nothing to bring back",
      entry: saved({ state: "idle", changedAt: 0, unread: undefined }),
      first: "idle",
      expected: null,
    },
  ] satisfies {
    name: string;
    entry: SavedAgentUnread;
    first: AgentState;
    expected: ReturnType<typeof decideUnreadRestore>;
  }[])("$name", ({ entry, first, expected }) => {
    expect(
      decideUnreadRestore(entry, { state: first, fromHook: false }, "g1"),
    ).toEqual(expected);
  });

  test("another tmux server generation: nothing", () => {
    expect(
      decideUnreadRestore(saved(), { state: "waiting", fromHook: false }, "g2"),
    ).toBeNull();
  });

  test("a report came first: it is newer, nothing", () => {
    expect(
      decideUnreadRestore(saved(), { state: "waiting", fromHook: true }, "g1"),
    ).toBeNull();
  });
});

describe("parseSavedUnread", () => {
  test("names every broken field", () => {
    expect(
      parseSavedUnread({
        version: 1,
        entries: [
          {
            generation: "",
            target: "main:0",
            state: "busy",
            changedAt: -1,
            unread: "read",
          },
        ],
      }),
    ).toEqual({
      ok: false,
      issues: [
        "entries[0]: generation is not a non-empty string",
        "entries[0]: target is not a tmux pane id",
        "entries[0]: state is not an agent state",
        "entries[0]: changedAt is not a non-negative integer",
        "entries[0]: unread is not waiting or finished",
      ],
    });
  });

  test("another version is not read", () => {
    expect(parseSavedUnread({ version: 2, entries: [] })).toEqual({
      ok: false,
      issues: ["version: expected 1, got 2"],
    });
  });
});

describe("saving and restoring inside the server", () => {
  let root = "";
  let path = "";

  beforeEach(() => {
    stopUnreadPersistence();
    clearAgentStates();
    resetAgentUnread();
    root = mkdtempSync(join(tmpdir(), "cv-unread-"));
    path = join(root, "state", "agent-unread.json");
  });
  afterEach(async () => {
    await flushUnreadPersistence();
    stopUnreadPersistence();
    clearAgentStates();
    resetAgentUnread();
    rmSync(root, { recursive: true, force: true });
  });

  function boot(generation = "g1") {
    startUnreadPersistence(path);
    setAgentTmuxGeneration(generation);
  }

  async function shutdown() {
    await flushUnreadPersistence();
    stopUnreadPersistence();
    clearAgentStates();
    resetAgentUnread();
  }

  const see = (state: AgentState) =>
    recordAgentState({ target: PANE, state, source: "screen" });

  /** 作業中から入力待ちに変わるのを見た (未読の入力待ち・変わった時刻を見た)。 */
  async function waitedBeforeRestart(generation = "g1") {
    boot(generation);
    see("working");
    see("waiting");
    const changedAt = getAgentState(PANE)?.updatedAt ?? 0;
    expect([...agentUnreadSnapshot().values()]).toEqual(["waiting"]);
    await shutdown();
    return changedAt;
  }

  test("saves with mode 0600, and a pane still waiting gets its time and unread back", async () => {
    const changedAt = await waitedBeforeRestart();
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8")).entries).toEqual([
      saved({ changedAt }),
    ]);

    boot();
    see("waiting");
    expect(getAgentState(PANE)).toMatchObject({
      state: "waiting",
      updatedAt: changedAt,
      changeObserved: true,
    });
    expect([...agentUnreadSnapshot().values()]).toEqual(["waiting"]);
    expect(getUnreadStoreErrors()).toEqual([]);
  });

  test.each([
    {
      name: "the pane is working now",
      restart: () => {
        boot();
        see("working");
      },
    },
    {
      name: "the tmux server was restarted",
      restart: () => {
        boot("g2");
        see("waiting");
      },
    },
    {
      name: "a report arrived first",
      restart: () => {
        boot();
        recordAgentState({ target: PANE, event: "ask", source: "hook" });
      },
    },
  ])("$name: nothing comes back", async ({ restart }) => {
    await waitedBeforeRestart();
    restart();
    expect(getAgentState(PANE)?.changeObserved).toBe(
      getAgentState(PANE)?.source === "hook",
    );
    expect(agentUnreadSnapshot().size).toBe(0);
  });

  test("a reported finish comes back as unread while the pane is still stopped", async () => {
    boot();
    see("working");
    recordAgentState({ target: PANE, event: "stop", source: "hook" });
    const changedAt = getAgentState(PANE)?.updatedAt ?? 0;
    await shutdown();

    boot();
    see("idle");
    expect(getAgentState(PANE)).toMatchObject({
      state: "idle",
      updatedAt: changedAt,
      changeObserved: true,
    });
    expect([...agentUnreadSnapshot().values()]).toEqual(["finished"]);
  });

  test("an unreadable save is neither used nor overwritten, and the reason is listed", async () => {
    mkdirSync(join(root, "state"), { recursive: true });
    writeFileSync(path, "{ not json");
    boot();
    see("working");
    see("waiting");
    await flushUnreadPersistence();
    expect(readFileSync(path, "utf8")).toBe("{ not json");
    expect(getUnreadStoreErrors().map((error) => error.operation)).toEqual([
      "restore_unread",
    ]);
  });

  test("a save that cannot be read (permissions) is reported too", async () => {
    mkdirSync(join(root, "state"), { recursive: true });
    writeFileSync(path, JSON.stringify({ version: 1, entries: [] }));
    chmodSync(path, 0o000);
    try {
      boot();
      expect(readSavedUnread(path).ok).toBe(false);
      expect(getUnreadStoreErrors().map((error) => error.operation)).toEqual([
        "restore_unread",
      ]);
    } finally {
      chmodSync(path, 0o600);
    }
  });
});
