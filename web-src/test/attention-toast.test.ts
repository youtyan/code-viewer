// 窓の中の知らせ (views/agents/attention-toast.ts と、監視役がどちらに出すか)。
//
// 落とすと痛いもの:
// - 押してもそのペインが開かない / 開いた後も残る
// - 同じペインの同じ変化が何枚も積もる / 古いものが消えずに画面を覆う
// - 窓が前面なのに OS の通知だけが出る (押してもタブを探すことになる)
import "./_dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentOverviewResponse } from "../core/agent-overview";
import { createAgentMonitor } from "../views/agents/agent-monitor";
import {
  ATTENTION_TOAST_LIMIT,
  ATTENTION_TOAST_MS,
  type AttentionToastViewProps,
  createAttentionToasts,
  DEFAULT_VIEW,
} from "../views/agents/attention-toast";
import { agentsText } from "../views/agents/i18n";
import { flushRenders } from "../views/ui/render-queue";
import { overview } from "./_agents-sidebar-fixture";
import { agentPane } from "./_test-helpers";

describe("attention toasts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function mount() {
    const seen: AttentionToastViewProps[] = [];
    const opened: string[] = [];
    const toasts = createAttentionToasts(
      { closeLabel: () => "Dismiss", open: (pane) => opened.push(pane) },
      (props) => {
        seen.push(props);
        return DEFAULT_VIEW(props);
      },
    );
    const last = () => seen[seen.length - 1];
    return { toasts, opened, last };
  }

  const toast = (
    pane: string,
    transition: "waiting" | "finished" = "waiting",
  ) => ({
    pane,
    transition,
    title: `Needs input · ${pane}`,
    body: `task\nwork:0.${pane.slice(1)}`,
  });

  test("clicking a toast opens its pane and takes the toast away", async () => {
    const { toasts, opened, last } = mount();
    toasts.show(toast("%3"));
    await flushRenders();
    document.querySelector<HTMLButtonElement>(".attention-toast-open")?.click();
    await flushRenders();
    expect({ opened, shown: last()?.toasts.length }).toEqual({
      opened: ["%3"],
      shown: 0,
    });
  });

  test("the same change of the same pane is one toast; only the newest few stay", async () => {
    const { toasts, last } = mount();
    toasts.show(toast("%1"));
    toasts.show(toast("%1"));
    for (let i = 2; i <= ATTENTION_TOAST_LIMIT + 1; i += 1)
      toasts.show(toast(`%${i}`));
    await flushRenders();
    expect(last()?.toasts.map((item) => item.pane)).toEqual(
      Array.from({ length: ATTENTION_TOAST_LIMIT }, (_, i) => `%${i + 2}`),
    );
  });

  test("a toast goes away by itself, or with the close button", async () => {
    const { toasts, last } = mount();
    toasts.show(toast("%1"));
    toasts.show(toast("%2", "finished"));
    await flushRenders();
    document
      .querySelector<HTMLButtonElement>(
        '.attention-toast[data-transition="finished"] .attention-toast-close',
      )
      ?.click();
    await flushRenders();
    expect(last()?.toasts.map((item) => item.pane)).toEqual(["%1"]);
    vi.advanceTimersByTime(ATTENTION_TOAST_MS);
    await flushRenders();
    expect(last()?.toasts).toEqual([]);
  });
});

describe("where the monitor puts an alert", () => {
  const working = agentPane({ id: "%4", state: "working", kind: "claude" });
  const waiting = { ...working, state: "waiting" as const };
  let response: AgentOverviewResponse;

  beforeEach(() => {
    response = overview([working], []);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(response))),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function run(inFront: boolean) {
    const toasts: string[] = [];
    const notices: string[] = [];
    vi.stubGlobal(
      "Notification",
      Object.assign(
        function FakeNotification(this: unknown, title: string) {
          notices.push(title);
          return { addEventListener: () => undefined, close: () => undefined };
        },
        { permission: "granted" },
      ),
    );
    const monitor = createAgentMonitor({
      getText: () => agentsText("en"),
      getNotifySettings: () => ({ waiting: true, finished: true }),
      isViewing: () => false,
      onUnreadCountChange: () => undefined,
      onNotificationClick: () => undefined,
      actionHeaders: () => ({}),
      showToast: (pane, _transition, text) =>
        toasts.push(`${pane.id} ${text.title}`),
      isWindowInFront: () => inFront,
    });
    await monitor.refresh();
    response = overview([waiting], []);
    await monitor.refresh();
    return { toasts, notices };
  }

  test("window in front: a toast in the window, no OS notification", async () => {
    const { toasts, notices } = await run(true);
    expect({ toasts: toasts.length, notices: notices.length }).toEqual({
      toasts: 1,
      notices: 0,
    });
    expect(toasts[0]).toContain("%4");
  });

  test("window behind: the OS notification, no toast", async () => {
    const { toasts, notices } = await run(false);
    expect({ toasts: toasts.length, notices: notices.length }).toEqual({
      toasts: 0,
      notices: 1,
    });
  });
});
