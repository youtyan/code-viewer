// 入力待ち・完了の短い音 (設定の「短い音も鳴らす」。既定は鳴らさない)。
// 鳴らすのは見ていないペインの変化だけ、1 回の取得で 1 回 (入力待ちを優先)、
// 種類ごとの通知の設定に従い、通知の許可には関係しない。

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentPane, AgentTransition } from "../core/agent-overview";
import { createAgentMonitor } from "../views/agents/agent-monitor";
import {
  type AudioContextLike,
  playAttentionSound,
} from "../views/agents/attention-sound";
import { agentsText } from "../views/agents/i18n";
import { overview } from "./_agents-sidebar-fixture";
import { agentPane } from "./_test-helpers";

const pane = (id: string, state: AgentPane["state"]) =>
  agentPane({ id, state, kind: "claude" });

describe("the monitor plays one sound per fetch", () => {
  let responses: AgentPane[][] = [];
  let played: AgentTransition[] = [];

  beforeEach(() => {
    played = [];
    vi.stubGlobal("Notification", undefined);
    vi.stubGlobal("fetch", async () =>
      Response.json(overview(responses.shift() ?? [], [])),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  async function run(
    steps: AgentPane[][],
    options: {
      enabled?: boolean;
      viewing?: boolean;
      waiting?: boolean;
      finished?: boolean;
    } = {},
  ) {
    responses = [...steps];
    const monitor = createAgentMonitor({
      getText: () => agentsText("en"),
      getNotifySettings: () => ({
        waiting: options.waiting ?? true,
        finished: options.finished ?? true,
      }),
      getSoundEnabled: () => options.enabled ?? true,
      playSound: async (transition) => {
        played.push(transition);
      },
      isViewing: () => options.viewing ?? false,
      onUnreadCountChange: () => undefined,
      onNotificationClick: () => undefined,
      actionHeaders: () => ({}),
    });
    for (const _ of steps) await monitor.refresh();
    return played;
  }

  test("waiting wins when both happen in one fetch", async () => {
    expect(
      await run([
        [pane("%1", "working"), pane("%2", "working")],
        [pane("%1", "idle"), pane("%2", "waiting")],
      ]),
    ).toEqual(["waiting"]);
  });

  test("a finish alone plays the finished sound", async () => {
    expect(await run([[pane("%1", "working")], [pane("%1", "idle")]])).toEqual([
      "finished",
    ]);
  });

  test.each([
    { name: "sound off (the default)", options: { enabled: false } },
    { name: "looking at it", options: { viewing: true } },
    { name: "finished notifications off", options: { finished: false } },
  ])("$name: no sound", async ({ options }) => {
    expect(
      await run([[pane("%1", "working")], [pane("%1", "idle")]], options),
    ).toEqual([]);
  });

  test("nothing changed: no sound", async () => {
    expect(await run([[pane("%1", "idle")], [pane("%1", "idle")]])).toEqual([]);
  });
});

describe("playAttentionSound", () => {
  function fakeAudio(state = "running") {
    const tones: number[] = [];
    let resumed = false;
    const node = () => ({
      connect: () => undefined,
      gain: {
        setValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      },
    });
    const audio: AudioContextLike = {
      state,
      currentTime: 0,
      destination: {},
      resume: async () => {
        resumed = true;
      },
      createGain: node,
      createOscillator: () => ({
        ...node(),
        type: "",
        frequency: {
          setValueAtTime: (value: number) => {
            tones.push(value);
          },
        },
        start: () => undefined,
        stop: () => undefined,
      }),
    };
    return { audio, tones, resumed: () => resumed };
  }

  test.each([
    ["waiting", 2],
    ["finished", 1],
  ] as const)("%s plays %i tone(s)", async (transition, count) => {
    const fake = fakeAudio();
    await playAttentionSound(transition, () => fake.audio);
    expect(fake.tones).toHaveLength(count);
  });

  test("a suspended context is resumed first", async () => {
    const fake = fakeAudio("suspended");
    await playAttentionSound("finished", () => fake.audio);
    expect(fake.resumed()).toBe(true);
  });

  test("no Web Audio: throws with the reason", async () => {
    vi.stubGlobal("AudioContext", undefined);
    await expect(playAttentionSound("waiting")).rejects.toThrow("Web Audio");
    vi.unstubAllGlobals();
  });
});
