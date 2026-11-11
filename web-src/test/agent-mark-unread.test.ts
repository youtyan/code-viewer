// 「未読に戻す」(行の右クリック)。サーバは今の状態から未読の種類を決め
// (入力待ち → 入力待ち、待機・完了 → 終わった、作業中は断る)、画面の監視役は
// 見ている間に戻しても、いったん見なくなるまでは読んだことにしない。

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentPane, AgentUnreadEntry } from "../core/agent-overview";
import type { AgentState } from "../core/agent-state";
import {
  clearAgentStates,
  recordAgentState,
} from "../server/terminal/agent-state";
import { handleAgentRoute } from "../server/terminal/handle";
import {
  agentUnreadSnapshot,
  resetAgentUnread,
} from "../server/terminal/unread";
import { createAgentMonitor } from "../views/agents/agent-monitor";
import { agentsText } from "../views/agents/i18n";
import { markUnreadMenuItems } from "../views/agents/unread-menu";
import { overview } from "./_agents-sidebar-fixture";
import { agentPane, postRoute } from "./_test-helpers";

const PANE = "%5";

describe("POST /_agent/unread with mark", () => {
  beforeEach(() => {
    clearAgentStates();
    resetAgentUnread();
  });

  test.each([
    { state: "waiting", unread: "waiting" },
    { state: "idle", unread: "finished" },
    { state: "done", unread: "finished" },
  ] satisfies { state: AgentState; unread: string }[])(
    "$state becomes unread as $unread",
    async ({ state, unread }) => {
      recordAgentState({ target: PANE, state, source: "screen" });
      const res = await postRoute(handleAgentRoute, "/_agent/unread", {
        target: PANE,
        mark: true,
      });
      expect([res?.status, await res?.json()]).toEqual([
        200,
        { ok: true, unread },
      ]);
      expect([...agentUnreadSnapshot().values()]).toEqual([unread]);
    },
  );

  test.each([
    {
      name: "a working agent",
      setup: () =>
        recordAgentState({ target: PANE, state: "working", source: "screen" }),
      body: { target: PANE, mark: true },
      expected: [409, "a working agent cannot be marked unread"],
    },
    {
      name: "a pane nobody has seen",
      setup: () => undefined,
      body: { target: PANE, mark: true },
      expected: [404, "unknown target"],
    },
    {
      name: "a mark that is not true",
      setup: () =>
        recordAgentState({ target: PANE, state: "idle", source: "screen" }),
      body: { target: PANE, mark: "yes" },
      expected: [400, "invalid mark"],
    },
  ])("refuses $name and changes nothing", async ({ setup, body, expected }) => {
    setup();
    const res = await postRoute(handleAgentRoute, "/_agent/unread", body);
    expect([res?.status, await res?.text()]).toEqual(expected);
    expect(agentUnreadSnapshot().size).toBe(0);
  });
});

describe("the monitor keeps a pane marked unread while you look at it", () => {
  const idle = agentPane({ id: PANE, state: "idle", kind: "claude" });
  let viewing = true;
  let serverUnread: AgentUnreadEntry[] = [];
  const posts: unknown[] = [];

  beforeEach(() => {
    viewing = true;
    serverUnread = [];
    posts.length = 0;
    vi.stubGlobal("Notification", undefined);
    vi.stubGlobal(
      "fetch",
      async (_url: string, init?: { method?: string; body?: string }) => {
        if (init?.method === "POST") {
          const body = JSON.parse(init.body ?? "{}") as { mark?: boolean };
          posts.push(body);
          if (body.mark) {
            serverUnread = [{ pane: PANE, transition: "finished" }];
            return Response.json({ ok: true, unread: "finished" });
          }
          serverUnread = [];
          return Response.json({ ok: true, removed: true });
        }
        return Response.json({
          ...overview([idle], []),
          unread: serverUnread,
        });
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  function monitor() {
    return createAgentMonitor({
      getText: () => agentsText("en"),
      getNotifySettings: () => ({ waiting: true, finished: true }),
      isViewing: () => viewing,
      onUnreadCountChange: () => undefined,
      onNotificationClick: () => undefined,
      actionHeaders: () => ({}),
    });
  }

  test("marked while looking: stays unread; read again only after looking away and back", async () => {
    const m = monitor();
    await m.refresh();
    await m.markUnread(PANE);
    expect(m.snapshot().unread.get(PANE)).toBe("finished");
    // まだ見ている: 解かない (サーバにも解かせない)
    await m.refresh();
    expect(m.snapshot().unread.get(PANE)).toBe("finished");
    expect(posts.filter((body) => !(body as { mark?: boolean }).mark)).toEqual(
      [],
    );
    // 離れた
    viewing = false;
    await m.refresh();
    expect(m.snapshot().unread.get(PANE)).toBe("finished");
    // また見た: 読んだことにする
    viewing = true;
    await m.refresh();
    expect(m.snapshot().unread.has(PANE)).toBe(false);
  });

  test("a refused mark is thrown with the server's reason", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("a working agent cannot be marked unread", {
          status: 409,
        }),
    );
    await expect(monitor().markUnread(PANE)).rejects.toThrow(
      "a working agent cannot be marked unread",
    );
  });
});

describe("markUnreadMenuItems", () => {
  const t = agentsText("en");
  const fakeMonitor = (unread: Map<string, "waiting" | "finished">) => ({
    markUnread: async () => undefined,
    snapshot: () => ({
      overview: null,
      error: "",
      notifyError: "",
      unread,
      sawWaiting: false,
      permissionAsked: false,
    }),
  });

  test.each([
    { name: "idle agent", pane: { state: "idle" }, items: 1 },
    { name: "waiting agent", pane: { state: "waiting" }, items: 1 },
    { name: "working agent", pane: { state: "working" }, items: 0 },
    { name: "a plain shell", pane: { state: "idle", kind: null }, items: 0 },
  ] satisfies { name: string; pane: Partial<AgentPane>; items: number }[])(
    "$name -> $items item(s)",
    ({ pane, items }) => {
      expect(
        markUnreadMenuItems(
          agentPane({ id: PANE, kind: "claude", ...pane }),
          t,
          fakeMonitor(new Map()),
        ),
      ).toHaveLength(items);
    },
  );

  test("already unread: no item", () => {
    expect(
      markUnreadMenuItems(
        agentPane({ id: PANE, kind: "claude", state: "idle" }),
        t,
        fakeMonitor(new Map([[PANE, "finished"]])),
      ),
    ).toEqual([]);
  });
});
