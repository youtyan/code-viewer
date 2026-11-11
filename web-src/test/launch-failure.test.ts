// 起動した直後に失敗して終わったエージェントを知らせる。
// サーバ: 起動したペインの様子を読む (server/accounts/launch.ts の
// launchedPaneStatus)。画面: 起動の少し後に 1 度だけ聞いて、終わっていたら
// 知らせる (views/agents/launch-failure.ts)。

import { afterEach, describe, expect, test, vi } from "vitest";
import type { LaunchedPaneStatus } from "../core/agent-accounts";
import { launchedPaneStatus } from "../server/accounts/launch";
import { handleAgentRoute } from "../server/terminal/handle";
import { TMUX_FIELD_SEP, type TmuxRunResult } from "../server/tmux/command";
import { agentsText } from "../views/agents/i18n";
import { createLaunchFailureWatch } from "../views/agents/launch-failure";
import { callRoute } from "./_test-helpers";

const PANE = "%31";

/** display-message と capture-pane の答えを決めた tmux。呼ばれた引数も残す。 */
function fakeTmux(display: TmuxRunResult, capture?: TmuxRunResult) {
  const calls: string[][] = [];
  const run = async (args: string[]): Promise<TmuxRunResult> => {
    calls.push(args);
    if (args[0] === "display-message") return display;
    if (args[0] === "capture-pane" && capture) return capture;
    throw new Error(`unexpected tmux call: ${args.join(" ")}`);
  };
  return { run, calls };
}

const shown = (id: string, dead: string, status: string): TmuxRunResult => ({
  status: "ok",
  stdout: `${[id, dead, status].join(TMUX_FIELD_SEP)}\n`,
});

describe("launchedPaneStatus", () => {
  test.each([
    {
      name: "still running",
      display: shown(PANE, "0", ""),
      expected: { kind: "running" },
    },
    {
      name: "closed (ended normally)",
      display: { status: "no-target" } as TmuxRunResult,
      expected: { kind: "gone" },
    },
    {
      name: "tmux is gone",
      display: { status: "no-server" } as TmuxRunResult,
      expected: { kind: "gone" },
    },
    {
      name: "tmux answered for another pane",
      display: shown("%2", "0", ""),
      expected: { kind: "gone" },
    },
  ] satisfies {
    name: string;
    display: TmuxRunResult;
    expected: LaunchedPaneStatus;
  }[])("$name", async ({ display, expected }) => {
    const { run } = fakeTmux(display);
    expect(await launchedPaneStatus(PANE, "/", run)).toEqual(expected);
  });

  test("a dead pane gives its exit code and the last non-empty lines, cleaned", async () => {
    const screen = [
      "zsh: command not found: claud",
      "",
      "line 2",
      "line 3",
      `bell${String.fromCharCode(7)}inside`,
      "line 5",
      `${"x".repeat(400)}`,
      "",
      "",
    ].join("\n");
    const { run, calls } = fakeTmux(shown(PANE, "1", "127"), {
      status: "ok",
      stdout: screen,
    });
    const status = await launchedPaneStatus(PANE, "/", run);
    expect(status).toEqual({
      kind: "exited",
      status: 127,
      lines: ["line 2", "line 3", "bell inside", "line 5", "x".repeat(300)],
    });
    // 読むだけ: 表示と画面の取り込みのほかは呼ばない。
    expect(calls.map((args) => args[0])).toEqual([
      "display-message",
      "capture-pane",
    ]);
  });

  test("an unreadable exit code is null, not 0", async () => {
    const { run } = fakeTmux(shown(PANE, "1", ""), {
      status: "ok",
      stdout: "",
    });
    expect(await launchedPaneStatus(PANE, "/", run)).toEqual({
      kind: "exited",
      status: null,
      lines: [],
    });
  });

  test("a tmux failure is thrown with its cause", async () => {
    const cause = new Error("tmux broke");
    const { run } = fakeTmux({ status: "error", error: cause });
    const failure = await launchedPaneStatus(PANE, "/", run).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(PANE);
    expect((failure as Error & { cause?: unknown }).cause).toBe(cause);
  });

  test("refuses something that is not a pane id", async () => {
    const { run, calls } = fakeTmux(shown(PANE, "0", ""));
    await expect(launchedPaneStatus("main:0", "/", run)).rejects.toThrow(
      "not a tmux pane id",
    );
    expect(calls).toEqual([]);
  });
});

describe("GET /_agent/launch/status", () => {
  test.each(["", "main:0", "%1;rm"])("refuses the pane %j", async (pane) => {
    const res = await callRoute(
      handleAgentRoute,
      `/_agent/launch/status?pane=${encodeURIComponent(pane)}`,
    );
    expect([res?.status, await res?.text()]).toEqual([400, "invalid pane"]);
  });
});

describe("createLaunchFailureWatch", () => {
  afterEach(() => vi.useRealTimers());

  function setup(answer: () => Promise<LaunchedPaneStatus>) {
    vi.useFakeTimers();
    const failed: [string, unknown][] = [];
    const errors: [string, unknown][] = [];
    const reads: string[] = [];
    const watch = createLaunchFailureWatch({
      delayMs: 3000,
      readStatus: (pane) => {
        reads.push(pane);
        return answer();
      },
      onFailed: (pane, failure) => failed.push([pane, failure]),
      onError: (pane, error) => errors.push([pane, error]),
    });
    return { watch, failed, errors, reads };
  }

  test("asks once after the delay and reports a pane that ended", async () => {
    const failure: LaunchedPaneStatus = {
      kind: "exited",
      status: 1,
      lines: ["boom"],
    };
    const { watch, failed, reads } = setup(async () => failure);
    watch.watch(PANE);
    watch.watch(PANE);
    await vi.advanceTimersByTimeAsync(2999);
    expect(reads).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(reads).toEqual([PANE]);
    expect(failed).toEqual([[PANE, failure]]);
  });

  test.each([{ kind: "running" }, { kind: "gone" }] as const)(
    "a $kind pane is not news",
    async (status) => {
      const { watch, failed, errors } = setup(async () => status);
      watch.watch(PANE);
      await vi.advanceTimersByTimeAsync(3000);
      expect([failed, errors]).toEqual([[], []]);
    },
  );

  test("a failed check goes to onError with the error", async () => {
    const error = new Error("HTTP 500");
    const { watch, errors } = setup(() => Promise.reject(error));
    watch.watch(PANE);
    await vi.advanceTimersByTimeAsync(3000);
    expect(errors).toEqual([[PANE, error]]);
  });

  test("dispose stops a pending check", async () => {
    const { watch, reads } = setup(async () => ({ kind: "running" }));
    watch.watch(PANE);
    watch.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(reads).toEqual([]);
  });
});

describe("the notice text", () => {
  test.each(["en", "ja"] as const)("%s: exit code and last lines", (lang) => {
    const t = agentsText(lang).accounts;
    const body = t.launchFailedBody(127, ["zsh: command not found: claud"]);
    expect(body).toContain("127");
    expect(body).toContain("zsh: command not found: claud");
    expect(t.launchFailedBody(null, [])).not.toContain("null");
  });
});
