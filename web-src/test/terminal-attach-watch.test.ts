// code-viewer が tmux のペインを映すために開いたシェルを、映していたペインが
// 終わったら閉じる見張り (server/terminal/attach-watch.ts)。
//
// ここが狂うと、ペインが終わってもタブが残る (外側のシェルのプロンプトが
// 出る)、tmux が移した別のペインが同じタブに映る、利用者が tmux の中で別の
// ペインへ移っただけなのにタブが閉じる、のどれかになる。

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { TmuxClient } from "../core/tmux";
import type { ShellWriteResult } from "../server/shell/session";
import {
  type AttachWatchDeps,
  decideAttachedPane,
  watchAttachedShell,
} from "../server/terminal/attach-watch";
import type { TmuxClientsResult } from "../server/tmux/clients";

const WATCHED = { session: "work", pane: "%1" };

// 見張りはウインドウの単位: タブが映しているのは attach したペインのウインドウ
// 全体。見張っているペイン %1 はウインドウ @1 にある。
describe("decideAttachedPane", () => {
  test.each([
    {
      name: "映しているペインのまま",
      window: "@1",
      client: { session: "work", pane: "%1", windowId: "@1" },
      exists: null,
      expected: { kind: "keep" },
    },
    {
      name: "前面のペインが終わり、tmux が同じウインドウの別のペインを前面にした",
      window: "@1",
      client: { session: "work", pane: "%2", windowId: "@1" },
      exists: false,
      expected: { kind: "follow", session: "work", pane: "%2" },
    },
    {
      name: "ウインドウが終わり、tmux が同じセッションの別のウインドウへ移した",
      window: "@1",
      client: { session: "work", pane: "%3", windowId: "@2" },
      exists: false,
      expected: { kind: "close" },
    },
    {
      name: "ウインドウが終わり、tmux が別のセッションへ移した (detach-on-destroy off)",
      window: "@1",
      client: { session: "other", pane: "%9", windowId: "@9" },
      exists: false,
      expected: { kind: "close" },
    },
    {
      name: "ペインが終わり、ウインドウをまだ見ていない (見分けられない)",
      window: null,
      client: { session: "work", pane: "%2", windowId: "@1" },
      exists: false,
      expected: { kind: "close" },
    },
    {
      name: "ペインが終わり、ウインドウの列が読めない (古い tmux)",
      window: "@1",
      client: { session: "work", pane: "%2" },
      exists: false,
      expected: { kind: "close" },
    },
    {
      name: "利用者が tmux の中で別のペインへ移った (元のペインは残っている)",
      window: "@1",
      client: { session: "work", pane: "%2", windowId: "@1" },
      exists: true,
      expected: { kind: "follow", session: "work", pane: "%2" },
    },
    {
      name: "利用者が tmux の中で別のウインドウへ移った (元のペインは残っている)",
      window: "@1",
      client: { session: "work", pane: "%3", windowId: "@2" },
      exists: true,
      expected: { kind: "follow", session: "work", pane: "%3" },
    },
    {
      name: "クライアントが居ず、ペインも無い (tmux のサーバごと終わった)",
      window: "@1",
      client: null,
      exists: false,
      expected: { kind: "close" },
    },
    {
      name: "クライアントが居ないが、ペインはある (attach の直後・繋げなかった)",
      window: "@1",
      client: null,
      exists: true,
      expected: { kind: "keep" },
    },
  ] as const)("$name", ({ window, client, exists, expected }) => {
    expect(decideAttachedPane({ ...WATCHED, window }, client, exists)).toEqual(
      expected,
    );
  });
});

describe("watchAttachedShell", () => {
  let output: (() => void) | null;
  let attachment: { session: string; pane: string } | null;
  let clients: TmuxClient[];
  let alive: Set<string>;
  let deps: AttachWatchDeps;
  let closeShell: ReturnType<
    typeof vi.fn<(id: string) => Promise<ShellWriteResult>>
  >;
  let follow: ReturnType<
    typeof vi.fn<(id: string, session: string, pane: string) => void>
  >;
  let listClients: ReturnType<typeof vi.fn<() => Promise<TmuxClientsResult>>>;

  beforeEach(() => {
    vi.useFakeTimers();
    output = null;
    attachment = { ...WATCHED };
    clients = [{ tty: "/dev/sample", session: "work", pane: "%1" }];
    alive = new Set(["%1", "%2"]);
    closeShell = vi.fn(async (_id: string): Promise<ShellWriteResult> => {
      attachment = null;
      return { status: "ok" };
    });
    follow = vi.fn((_id: string, session: string, pane: string) => {
      attachment = { session, pane };
    });
    listClients = vi.fn(
      async (): Promise<TmuxClientsResult> => ({ status: "ok", clients }),
    );
    deps = {
      attachment: () => attachment,
      tty: () => "/dev/sample",
      listClients,
      resolvePane: async (pane) =>
        alive.has(pane)
          ? { status: "ok", session: "work" }
          : { status: "gone" },
      follow,
      closeShell,
      watchOutput: (_id, onOutput) => {
        output = onOutput;
        return () => {
          output = null;
        };
      },
      intervalMs: 1000,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function outputAndWait(): Promise<void> {
    output?.();
    await vi.advanceTimersByTimeAsync(1000);
  }

  test("ウインドウが終わって tmux が別のウインドウへ移したら、シェルを閉じて見張りをやめる", async () => {
    clients = [
      { tty: "/dev/sample", session: "work", pane: "%1", windowId: "@1" },
    ];
    watchAttachedShell("shell-sample", "/sample", deps);
    await outputAndWait();
    alive.delete("%1");
    clients = [
      { tty: "/dev/sample", session: "work", pane: "%2", windowId: "@2" },
    ];
    await outputAndWait();
    expect(closeShell.mock.calls).toEqual([["shell-sample"]]);
    expect(output).toBeNull();
  });

  test("ウインドウの中のペインが 1 つ終わっただけなら閉じず、前面になったペインを見張る", async () => {
    clients = [
      { tty: "/dev/sample", session: "work", pane: "%1", windowId: "@1" },
    ];
    watchAttachedShell("shell-sample", "/sample", deps);
    await outputAndWait();
    alive.delete("%1");
    clients = [
      { tty: "/dev/sample", session: "work", pane: "%2", windowId: "@1" },
    ];
    await outputAndWait();
    expect([closeShell.mock.calls, follow.mock.calls]).toEqual([
      [],
      [["shell-sample", "work", "%2"]],
    ]);
    // そのウインドウの最後のペインも終わり、別のウインドウへ移されたら閉じる。
    alive.delete("%2");
    clients = [
      { tty: "/dev/sample", session: "work", pane: "%3", windowId: "@2" },
    ];
    await outputAndWait();
    expect(closeShell.mock.calls).toEqual([["shell-sample"]]);
  });

  test("利用者が tmux の中で移っただけなら閉じず、移った先を見張る", async () => {
    watchAttachedShell("shell-sample", "/sample", deps);
    clients = [{ tty: "/dev/sample", session: "work", pane: "%2" }];
    await outputAndWait();
    expect([closeShell.mock.calls, follow.mock.calls]).toEqual([
      [],
      [["shell-sample", "work", "%2"]],
    ]);
    // 移った先が終わったら閉じる (元のペインはまだある)。
    alive.delete("%2");
    clients = [{ tty: "/dev/sample", session: "work", pane: "%1" }];
    await outputAndWait();
    expect(closeShell.mock.calls).toEqual([["shell-sample"]]);
  });

  test("出力が続いても、間隔ごとに 1 回しか tmux に聞かない", async () => {
    watchAttachedShell("shell-sample", "/sample", deps);
    for (let i = 0; i < 20; i++) {
      output?.();
      await vi.advanceTimersByTimeAsync(100);
    }
    // 2 秒の間に、先頭の 1 回 + 確かめている間に来た分の 1 回ずつ。
    expect(listClients.mock.calls.length).toBeLessThanOrEqual(2);
    expect(closeShell).not.toHaveBeenCalled();
  });

  test("tmux に聞けなかったときは閉じず、理由をログに残す", async () => {
    const error = new Error("tmux failed");
    listClients.mockResolvedValue({ status: "error", error });
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    watchAttachedShell("shell-sample", "/sample", deps);
    await outputAndWait();
    expect([closeShell.mock.calls, logged.mock.calls[0]?.[1]]).toEqual([
      [],
      error,
    ]);
    logged.mockRestore();
  });

  test("聞いている間にブラウザから別のペインを開いたら、古い結果で閉じない", async () => {
    let release: () => void = () => undefined;
    listClients.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ status: "ok", clients });
        }),
    );
    watchAttachedShell("shell-sample", "/sample", deps);
    alive.delete("%1");
    clients = [{ tty: "/dev/sample", session: "work", pane: "%2" }];
    output?.();
    await vi.advanceTimersByTimeAsync(1000);
    attachment = { session: "work", pane: "%2" };
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(closeShell).not.toHaveBeenCalled();
  });
});
