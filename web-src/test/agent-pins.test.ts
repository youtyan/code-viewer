// 全体ボードの「上に留める」をサーバのメモリに持つ (server/terminal/pins.ts と
// POST /_agent/pin)。どの窓・電話でも同じピンが見え、ペインが一覧から消えたら
// 外れ、tmux を起こし直してペイン ID が再利用されても前のピンは付かない。

import { beforeEach, describe, expect, test } from "vitest";
import {
  clearAgentStates,
  setAgentTmuxGeneration,
} from "../server/terminal/agent-state";
import { handleAgentRoute } from "../server/terminal/handle";
import {
  noteAgentPins,
  resetAgentPins,
  setAgentPinned,
} from "../server/terminal/pins";
import { agentPane, postRoute } from "./_test-helpers";

const panes = (...ids: string[]) =>
  ids.map((id) => agentPane({ id, kind: "claude" }));

describe("agent pins on the server", () => {
  beforeEach(() => {
    clearAgentStates();
    resetAgentPins();
    setAgentTmuxGeneration("gen-1");
  });

  test("POST /_agent/pin pins and unpins; the list carries the pinned panes", async () => {
    const pin = await postRoute(handleAgentRoute, "/_agent/pin", {
      target: "%2",
      pinned: true,
    });
    expect([pin?.status, await pin?.json()]).toEqual([
      200,
      { ok: true, pinned: true },
    ]);
    expect(noteAgentPins(panes("%1", "%2"))).toEqual(["%2"]);

    await postRoute(handleAgentRoute, "/_agent/pin", {
      target: "%2",
      pinned: false,
    });
    expect(noteAgentPins(panes("%1", "%2"))).toEqual([]);
  });

  test("a pin goes away with its pane", () => {
    setAgentPinned("%2", true);
    expect(noteAgentPins(panes("%1"))).toEqual([]);
    // 同じ ID のペインがまた現れても、外したピンは戻らない。
    expect(noteAgentPins(panes("%1", "%2"))).toEqual([]);
  });

  test("a pane id reused by a restarted tmux is not pinned", () => {
    setAgentPinned("%2", true);
    setAgentTmuxGeneration("gen-2");
    expect(noteAgentPins(panes("%2"))).toEqual([]);
  });

  test.each([
    {
      name: "a target that is not a pane",
      body: { target: "x", pinned: true },
      expected: [400, "invalid target"],
    },
    {
      name: "a pinned that is not a boolean",
      body: { target: "%2", pinned: "yes" },
      expected: [400, "invalid pinned"],
    },
    {
      name: "a missing pinned",
      body: { target: "%2" },
      expected: [400, "invalid pinned"],
    },
  ])("refuses $name and pins nothing", async ({ body, expected }) => {
    const res = await postRoute(handleAgentRoute, "/_agent/pin", body);
    expect([res?.status, await res?.text()]).toEqual(expected);
    expect(noteAgentPins(panes("%2"))).toEqual([]);
  });
});
