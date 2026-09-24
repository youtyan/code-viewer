// メインの面のタブだけで映すようになった terminal-view の、シェルの作成・停止・
// 一覧の取り直し。失敗は呼び出し側 (app.ts が確認と警告のダイアログを出す) へ
// reject で渡し、覚えている一覧は失敗で変えない。xterm は描かないので画面は
// 差し替える。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { ShellSession, ShellSessionId } from "../core/shell";
import type { TerminalScreenDeps } from "../views/terminal/terminal-screen";

const terminalScreenState = vi.hoisted(() => ({
  screens: [] as Array<{
    attached: ShellSession | null;
    focusCount: number;
    deps: TerminalScreenDeps;
  }>,
}));

vi.mock("../views/terminal/terminal-screen", () => ({
  createTerminalScreen: (deps: TerminalScreenDeps) => {
    const state = {
      attached: null as ShellSession | null,
      focusCount: 0,
      deps,
    };
    terminalScreenState.screens.push(state);
    return {
      el: document.createElement("div"),
      attach: async (session: ShellSession) => {
        state.attached = session;
      },
      detach: () => {
        state.attached = null;
      },
      getAttached: () => state.attached,
      measure: () => ({ cols: 80, rows: 24 }),
      focus: () => {
        state.focusCount += 1;
      },
      refit: () => undefined,
      applyFontSize: () => undefined,
      setInputEnabled: () => undefined,
      localize: () => undefined,
      updateTmuxCover: () => undefined,
      dispose: () => undefined,
    };
  },
}));

const { createTerminalView } = await import("../views/terminal/terminal-view");

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  vi.unstubAllGlobals();
  terminalScreenState.screens = [];
});

function shell(id: string): ShellSession {
  return {
    id: id as ShellSessionId,
    command: "zsh",
    cwd: "/work/sample",
    createdAt: "2026-01-01T00:00:00.000Z",
    cols: 80,
    rows: 24,
    exited: false,
    exitCode: null,
    tty: "",
  };
}

function setup(responses: Array<() => Response | Promise<Response>>) {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${url} ${init?.body ?? ""}`);
      const next = responses.shift();
      if (!next) throw new Error(`unexpected request ${url}`);
      return next();
    }),
  );
  const opened: string[] = [];
  const ended: string[] = [];
  const openFailures: string[] = [];
  const view = createTerminalView({
    trackLoad: (promise) => promise,
    actionHeaders: () => ({}),
    getLanguage: () => "en",
    getFontSize: () => 13,
    onFontSizeChange: () => undefined,
    isImageShelfCollapsed: () => false,
    onImageShelfCollapsedChange: () => undefined,
    onOpenInTab: (session, pane, side) =>
      opened.push(
        pane ? `${session.id}:${pane}:${side}` : `${session.id}:${side}`,
      ),
    onShellEnded: (id) => ended.push(id),
    onOpenFailed: (message) => openFailures.push(message),
    tmuxWindow: () => null,
    onTmuxWindowStale: () => undefined,
  });
  return { view, requests, opened, ended, openFailures };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe("terminal view: シェルの作成と停止", () => {
  test("既に接続済みのターミナルタブへ戻っても入力へフォーカスする", async () => {
    const session = shell("shell-a1");
    const { view } = setup([
      () => json({ available: true, sessions: [session] }),
    ]);
    await view.loadShells();

    await view.showInTab(session.id, "left");
    await view.showInTab(session.id, "left");

    expect(terminalScreenState.screens).toHaveLength(1);
    expect(terminalScreenState.screens[0]).toMatchObject({
      attached: session,
      focusCount: 2,
    });
  });

  // その面でまだターミナルを映していなければ寸法は測れないので送らない
  // (サーバの既定で開き、タブに映したときに合わせ直す)。
  test("作ったシェルはその面のタブで開いてもらい、一覧にも載せる", async () => {
    const { view, requests, opened } = setup([
      () => json({ session: shell("shell-a1") }),
    ]);
    await view.createShell("left");
    expect([
      requests,
      opened,
      view.knownShells()?.sessions.map((item) => item.id),
    ]).toEqual([["POST /_shell/create {}"], ["shell-a1:left"], ["shell-a1"]]);
  });

  test("tmux ペインを開くとき、指定した面をタブへ引き継ぐ", async () => {
    const { view, requests, opened } = setup([
      () => json({ session: shell("shell-a1"), action: "attached" }),
    ]);
    await view.openPaneInTab("%1", "right");
    expect(requests).toEqual([
      'POST /_tmux/open {"pane":"%1","shell":null,"cols":80,"rows":24}',
    ]);
    expect(opened).toEqual(["shell-a1:%1:right"]);
  });

  // 状態の行はその面の前面がこの端末のときしか見えないので、同じ理由を
  // 常に見える知らせ (app が最下段に出す) にも渡す。
  test.each([
    {
      name: "閉じたペイン",
      respond: () => new Response("gone", { status: 410 }),
      message: "This pane has been closed. (HTTP 410): gone",
    },
    {
      name: "上限",
      respond: () => new Response("limit 8", { status: 429 }),
      message: "Too many shells are open. Close one first. (HTTP 429): limit 8",
    },
    {
      name: "それ以外",
      respond: () => new Response("tmux failed", { status: 500 }),
      message: "Could not open this pane. (HTTP 500): tmux failed",
    },
    {
      name: "届かない",
      respond: () => Promise.reject(new TypeError("network down")),
      message: "Could not open this pane.\nTypeError: network down",
    },
  ])("ペインを開けなければ理由を知らせにも渡し、タブは開かない ($name)", async ({
    respond,
    message,
  }) => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { view, opened, openFailures } = setup([respond]);
    await view.openPaneInTab("%1", "left");
    consoleError.mockRestore();
    expect([opened, openFailures]).toEqual([[], [message]]);
  });

  test.each([
    {
      name: "上限",
      status: 429,
      message: "Too many shells are open. Close one first. (HTTP 429): limit 8",
    },
    {
      name: "それ以外",
      status: 500,
      message: "Could not open a shell. (HTTP 500): limit 8",
    },
  ])("作れなければ理由と本文ごと reject し、タブは開かない ($name)", async ({
    status,
    message,
  }) => {
    const { view, opened } = setup([() => new Response("limit 8", { status })]);
    await expect(view.createShell("left")).rejects.toThrow(message);
    expect([opened, view.knownShells()]).toEqual([[], null]);
  });

  test("止めたシェルは一覧から外す。止められなければ一覧はそのまま", async () => {
    const { view, requests } = setup([
      () => json({ available: true, sessions: [shell("shell-a1")] }),
      () => new Response("busy", { status: 409 }),
      () => json({ ok: true }),
    ]);
    await view.loadShells();
    await expect(view.closeShell("shell-a1" as ShellSessionId)).rejects.toThrow(
      "Could not close the shell. (HTTP 409): busy",
    );
    const afterFailure = view.knownShells()?.sessions.map((item) => item.id);
    await view.closeShell("shell-a1" as ShellSessionId);
    expect([
      requests.slice(1),
      afterFailure,
      view.knownShells()?.sessions,
    ]).toEqual([
      [
        'POST /_shell/close {"id":"shell-a1"}',
        'POST /_shell/close {"id":"shell-a1"}',
      ],
      ["shell-a1"],
      [],
    ]);
  });

  test("後から始めた取り直しより遅れて届いた古い一覧では巻き戻さない", async () => {
    let releaseOld: (response: Response) => void = () => undefined;
    const { view } = setup([
      () =>
        new Promise<Response>((resolve) => {
          releaseOld = resolve;
        }),
      () => json({ available: true, sessions: [shell("shell-new")] }),
    ]);
    const old = view.loadShells();
    await view.loadShells();
    releaseOld(json({ available: true, sessions: [shell("shell-old")] }));
    await old;
    expect(view.knownShells()?.sessions.map((item) => item.id)).toEqual([
      "shell-new",
    ]);
  });

  test("一覧を取れなければ reject し、覚えている一覧は変えない", async () => {
    const { view } = setup([
      () => json({ available: true, sessions: [shell("shell-a1")] }),
      () => new Response("down", { status: 503 }),
    ]);
    await view.loadShells();
    await expect(view.loadShells()).rejects.toThrow(
      "Failed to load the shell list. (HTTP 503): down",
    );
    expect(view.knownShells()?.sessions.map((item) => item.id)).toEqual([
      "shell-a1",
    ]);
  });
});

// 何も映していない間の案内 (真ん中) と、画面の下端の状態行は別の要素。同じ
// 要素を真ん中から下端へ動かすと、画面が付いたときにレイアウトシフトになって
// いた (ui-layout.md の「切替で CLS 0 を保つ」)。どちらを見せるかは style.css。
describe("terminal view: 案内と状態行", () => {
  test("案内と状態行は別の要素で、同じ文言を持つ", async () => {
    const { view } = setup([() => json({ available: true, sessions: [] })]);
    await view.showInTab("shell-gone" as ShellSessionId, "left");
    const slot = view.tabPaneFor("left").querySelector(".terminal-slot");
    if (!slot) throw new Error("no terminal slot");
    const part = (selector: string) => {
      const el = slot.querySelector<HTMLElement>(selector);
      return el && { text: el.textContent, hidden: el.hidden, role: el.role };
    };
    expect({
      order: [...slot.children].map((child) => child.className),
      hint: part(".terminal-empty-hint"),
      status: part(".terminal-status"),
    }).toEqual({
      order: ["", "terminal-empty-hint", "terminal-status"],
      hint: {
        text: "This shell has been closed.",
        hidden: false,
        role: "status",
      },
      status: {
        text: "This shell has been closed.",
        hidden: false,
        role: "status",
      },
    });
  });
});

// 前面のタブのシェルが終わったら、タブを閉じて知らせてもらう (app.ts)。
// 「セッションを止める」で止めたときは、止めた人が知っているので知らせない。
describe("terminal view: シェルの終わり", () => {
  test("映しているシェルが終わったら、そのシェルを渡して一覧からも外す", async () => {
    const session = shell("shell-e1");
    const { view, ended } = setup([
      () => json({ available: true, sessions: [session] }),
    ]);
    await view.loadShells();
    await view.showInTab(session.id, "left");
    terminalScreenState.screens[0]?.deps.onShellExited(session);
    expect([ended, view.knownShells()?.sessions]).toEqual([["shell-e1"], []]);
  });

  test("「セッションを止める」で止めている間に届いた終わりは知らせない", async () => {
    const session = shell("shell-e2");
    let release: (response: Response) => void = () => undefined;
    const { view, ended } = setup([
      () => json({ available: true, sessions: [session] }),
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    ]);
    await view.loadShells();
    await view.showInTab(session.id, "left");
    const closing = view.closeShell(session.id);
    // サーバは止める応答より先に、流れへ「終わった」を送る。
    terminalScreenState.screens[0]?.deps.onShellExited(session);
    release(json({ ok: true }));
    await closing;
    // 止めた後に同じ id が別の理由で終わることは無いが、印は残さない。
    terminalScreenState.screens[0]?.deps.onShellExited(session);
    expect(ended).toEqual(["shell-e2"]);
  });
});

// 入口のサーバが起き直すとシェルは全部終わる。タブは閉じずに、tmux を映して
// いたものは同じ ID のシェルで繋ぎ直し、そうでないものは中に開き直しの案内を出す
// (app.ts の recoverShellTabs)。
describe("terminal view: サーバが起き直して終わったシェルのタブ", () => {
  const PLACE = { pane: "%3", session: "sample", window: 1 };

  async function showing(
    id: string,
    responses: Parameters<typeof setup>[0],
  ) {
    const session = shell(id);
    const env = setup([
      () => json({ available: true, sessions: [session] }),
      ...responses,
    ]);
    await env.view.loadShells();
    await env.view.showInTab(session.id, "left");
    return { ...env, session };
  }

  test("繋ぎ直せたら、同じ ID と保存した場所を送り、映していた面を新しいシェルに付け直す", async () => {
    const revived = { ...shell("shell-r1"), tty: "/dev/sample-new" };
    const { view, requests } = await showing("shell-r1", [
      () => json({ session: revived, action: "attached" }),
    ]);

    const result = await view.reviveInTab(revived.id, PLACE);

    expect([
      result,
      requests[requests.length - 1],
      terminalScreenState.screens[0]?.attached,
      view.knownShells()?.sessions,
    ]).toEqual([
      "revived",
      'POST /_tmux/open {"pane":"%3","revive":{"shell":"shell-r1","session":"sample","window":1}}',
      revived,
      [revived],
    ]);
  });

  test("場所がもう無い (410) なら gone を返し、付け直さない", async () => {
    const { view, session } = await showing("shell-r2", [
      () => new Response("pane is gone", { status: 410 }),
    ]);

    await expect(view.reviveInTab(session.id, PLACE)).resolves.toBe("gone");
    expect(terminalScreenState.screens[0]?.attached).toEqual(session);
  });

  test("それ以外の失敗は理由と本文ごと reject する", async () => {
    const { view, session } = await showing("shell-r3", [
      () => new Response("tmux failed", { status: 500 }),
    ]);

    await expect(view.reviveInTab(session.id, PLACE)).rejects.toThrow(
      "Could not open this pane. (HTTP 500): tmux failed",
    );
  });

  test("tmux を映していなかったタブは閉じず、端末の代わりに開き直しの案内を出す", async () => {
    const { view, session } = await showing("shell-p1", []);

    view.markEnded(session.id);

    const pane = view.tabPaneFor("left");
    expect([
      pane.querySelector("h2")?.textContent,
      pane.querySelector(".empty-action-primary")?.textContent,
      terminalScreenState.screens[0]?.attached,
      view.knownShells()?.sessions,
    ]).toEqual([
      "The shell ended when the server restarted",
      "Reopen in a new shell",
      null,
      [],
    ]);
  });

  test("ほかのタブへ移って戻っても、開き直すまで案内のまま", async () => {
    const other = shell("shell-p3");
    const { view, session } = await showing("shell-p2", [
      () => json({ available: true, sessions: [other] }),
    ]);
    view.markEnded(session.id);

    await view.showInTab(other.id, "left");
    const shownOther = terminalScreenState.screens[0]?.attached;
    await view.showInTab(session.id, "left");

    expect([
      shownOther,
      view.tabPaneFor("left").querySelector("h2")?.textContent,
    ]).toEqual([other, "The shell ended when the server restarted"]);
  });

  test("「新しいシェルで開き直す」は同じ ID で開き、タブの中に端末を戻す", async () => {
    const reopened = { ...shell("shell-p4"), tty: "/dev/sample-new" };
    const { view, session, requests, opened } = await showing("shell-p4", [
      () => json({ session: reopened }),
    ]);
    view.markEnded(session.id);

    view
      .tabPaneFor("left")
      .querySelector<HTMLButtonElement>(".empty-action-primary")
      ?.click();
    await vi.waitFor(() =>
      expect(terminalScreenState.screens[0]?.attached).toEqual(reopened),
    );

    expect([
      requests[requests.length - 1],
      opened,
      view.tabPaneFor("left").querySelector("h2"),
    ]).toEqual([
      'POST /_shell/create {"id":"shell-p4","cols":80,"rows":24}',
      ["shell-p4:left"],
      null,
    ]);
  });

  test("開き直せなければ理由を知らせ、案内を残す", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { view, session, openFailures } = await showing("shell-p5", [
      () => new Response("spawn failed", { status: 500 }),
    ]);
    view.markEnded(session.id);

    view
      .tabPaneFor("left")
      .querySelector<HTMLButtonElement>(".empty-action-primary")
      ?.click();
    await vi.waitFor(() => expect(openFailures).toHaveLength(1));
    consoleError.mockRestore();

    expect([
      openFailures,
      view.tabPaneFor("left").querySelector("h2")?.textContent,
    ]).toEqual([
      ["Error: Could not open a shell. (HTTP 500): spawn failed"],
      "The shell ended when the server restarted",
    ]);
  });
});
