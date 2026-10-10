// 設定の「外部接続」の節 (views/remote-access-settings.ts)。入口のサーバの代わりに
// fetch を差し替え、状態の行・開始と停止・外から開いたとき・値とトークンの保存を見る。

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
import type {
  RemoteAccessSaveRequest,
  RemoteAccessStatus,
} from "../core/remote-access";
import { createRemoteAccessSettings } from "../views/remote-access-settings";
import { REMOTE_ACCESS_SETTINGS_TEXT } from "../views/remote-access-settings-i18n";
import { q, waitFor } from "./_test-helpers";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const VALUES = {
  port: 64161,
  origin: "https://viewer.example.com",
  teamDomain: "example.cloudflareaccess.com",
  audience: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
};

const STOPPED: RemoteAccessStatus = {
  generation: 1,
  configPath: "/state/remote-access.json",
  tokenPath: "/state/tunnel-token",
  configFromFlag: false,
  config: { state: "ok", values: VALUES, autoStart: false },
  token: {
    state: "ok",
    tunnelId: "00000000-0000-4000-8000-000000000001",
  },
  cloudflared: { state: "ok", version: "2026.9.0" },
  listener: { state: "stopped" },
  tunnel: { state: "stopped" },
  log: [],
};

const RUNNING: RemoteAccessStatus = {
  ...STOPPED,
  listener: { state: "running", port: 64161, origin: VALUES.origin },
  tunnel: {
    state: "running",
    pid: 4321,
    connections: 4,
    shell: "shell-tunnel",
  },
  log: [],
};

type Call = {
  method: string;
  path: string;
  body: unknown;
  /** 副作用の印 (X-Code-Viewer-Action) を付けたか。 */
  action: boolean;
};

/** 入口のサーバの代わり。答えは呼び出しごとに reply が決める。 */
function serve(reply: (call: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const call = {
        method: init.method ?? "GET",
        path: new URL(input, "http://127.0.0.1").pathname,
        body: typeof init.body === "string" ? JSON.parse(init.body) : null,
        action: new Headers(init.headers).get("X-Code-Viewer-Action") === "1",
      };
      calls.push(call);
      return reply(call);
    }),
  );
  return calls;
}

async function mount(
  lang: "en" | "ja" = "ja",
  openShell: (id: string) => void = () => undefined,
) {
  const section = createRemoteAccessSettings({
    getText: () => REMOTE_ACCESS_SETTINGS_TEXT[lang],
    trackLoad: (promise) => promise,
    actionHeaders: () => ({ "X-Code-Viewer-Action": "1" }),
    openShell,
  });
  document.body.append(section.element);
  await section.refresh();
  return section;
}

function rowTexts(root: HTMLElement): string[][] {
  return Array.from(root.querySelectorAll(".remote-access-row"), (row) =>
    Array.from(row.children, (cell) => cell.textContent ?? ""),
  );
}

/** その行の 3 列目のボタン (ターミナルで見る・トークンの欄へ)。 */
function rowButton(root: HTMLElement, row: number): HTMLButtonElement {
  const button = root
    .querySelectorAll(".remote-access-row")
    [row]?.querySelector<HTMLButtonElement>(".remote-access-row-button");
  if (!button) throw new Error(`no button on status row ${row}`);
  return button;
}

const SERVICE_URL_NOTE =
  "Cloudflare の Tunnel の公開ルートで「サービス URL」に入れるアドレスです。";

describe("the remote access section", () => {
  test("shows the service URL, cloudflared and the token as rows", async () => {
    serve(() => Response.json(RUNNING));
    const section = await mount();

    expect(rowTexts(section.element)).toEqual([
      [
        "サービス URL",
        "開いています",
        "http://127.0.0.1:64161（https://viewer.example.com からの転送先）",
        SERVICE_URL_NOTE,
      ],
      ["cloudflared", "接続中（4 本）", "ターミナルで見る"],
      [
        "トークン",
        "保存済み",
        "Tunnel ID 00000000-0000-4000-8000-000000000001",
      ],
    ]);
  });

  test.each<{
    name: string;
    status: RemoteAccessStatus;
    expected: string[];
  }>([
    {
      name: "stopped with saved values shows the address it will open",
      status: STOPPED,
      expected: [
        "サービス URL",
        "止まっています",
        "http://127.0.0.1:64161",
        SERVICE_URL_NOTE,
      ],
    },
    {
      name: "stopped without values has no address yet",
      status: { ...STOPPED, config: { state: "absent" } },
      expected: ["サービス URL", "止まっています", "", SERVICE_URL_NOTE],
    },
  ])("the service URL row: $name", async ({ status, expected }) => {
    serve(() => Response.json(status));
    const section = await mount();

    expect(rowTexts(section.element)[0]).toEqual(expected);
  });

  test("open in terminal opens the terminal cloudflared runs in", async () => {
    serve(() => Response.json(RUNNING));
    const opened: string[] = [];
    const section = await mount("ja", (id) => opened.push(id));

    rowButton(section.element, 1).click();

    expect(opened).toEqual(["shell-tunnel"]);
  });

  test("without a token, the token row says where to paste it and its button goes to the field", async () => {
    serve(() => Response.json({ ...STOPPED, token: { state: "absent" } }));
    const section = await mount();
    rowButton(section.element, 2).click();

    expect({
      row: rowTexts(section.element)[2],
      focused: document.activeElement?.id,
    }).toEqual({
      row: [
        "トークン",
        "未設定",
        "トークンの欄へ",
        "Cloudflare の Tunnel の画面にあるインストールコマンド（cloudflared service install <トークン>）を、下の「Tunnel のトークン」にそのまま貼り、「変更を保存」を押します。",
      ],
      focused: "remote-access-token",
    });
  });

  test.each<{
    name: string;
    tunnel: RemoteAccessStatus["tunnel"];
    expected: string[];
  }>([
    {
      name: "waiting for its first connection",
      tunnel: {
        state: "running",
        pid: 4321,
        connections: 0,
        shell: "shell-tunnel",
      },
      expected: ["cloudflared", "接続しています", "ターミナルで見る"],
    },
    {
      name: "not started without a token",
      tunnel: { state: "skipped" },
      expected: [
        "cloudflared",
        "起動していません",
        "",
        "トークンが未設定なので起動していません。cloudflared を自分で動かしているなら、このままで使えます。",
      ],
    },
    {
      name: "stopped by itself",
      tunnel: { state: "exited", error: "cloudflared exited (code 3)." },
      expected: [
        "cloudflared",
        "止まりました",
        "cloudflared 2026.9.0",
        "cloudflared exited (code 3).",
      ],
    },
  ])("shows cloudflared $name", async ({ tunnel, expected }) => {
    serve(() => Response.json({ ...STOPPED, tunnel }));
    const section = await mount();

    expect(rowTexts(section.element)[1]).toEqual(expected);
  });

  test.each<{
    name: string;
    status: RemoteAccessStatus;
    start: boolean;
    stop: boolean;
  }>([
    { name: "stopped", status: STOPPED, start: true, stop: false },
    {
      name: "running and connected",
      status: RUNNING,
      start: false,
      stop: true,
    },
    {
      name: "listening without a token",
      status: { ...RUNNING, tunnel: { state: "skipped" } },
      start: false,
      stop: true,
    },
    {
      name: "listening after cloudflared stopped by itself",
      status: { ...RUNNING, tunnel: { state: "exited", error: "sample" } },
      start: true,
      stop: true,
    },
    {
      name: "listening while cloudflared is being installed",
      status: {
        ...RUNNING,
        tunnel: { state: "stopped" },
        cloudflared: { state: "installing" },
      },
      start: false,
      stop: true,
    },
  ])(
    "when $name, start is $start and stop is $stop",
    async ({ status, start, stop }) => {
      serve(() => Response.json(status));
      const section = await mount();

      expect({
        start: !q<HTMLButtonElement>(section.element, ".remote-access-start")
          .disabled,
        stop: !q<HTMLButtonElement>(section.element, ".remote-access-stop")
          .disabled,
      }).toEqual({ start, stop });
    },
  );

  test.each([
    { button: ".remote-access-start", path: "/_entry/remote/start" },
    { button: ".remote-access-stop", path: "/_entry/remote/stop" },
  ])(
    "$button posts to $path with the action header",
    async ({ button, path }) => {
      const calls = serve(() =>
        Response.json({ ...RUNNING, tunnel: { state: "exited", error: "x" } }),
      );
      const section = await mount();

      q<HTMLButtonElement>(section.element, button).click();
      await waitFor(() => calls.length === 2);

      expect(calls[1]).toEqual({
        method: "POST",
        path,
        body: null,
        action: true,
      });
    },
  );

  test("the first load asks the server to check cloudflared again with a POST and the action header", async () => {
    const calls = serve(() => Response.json(STOPPED));
    await mount();

    expect(calls[0]).toEqual({
      method: "POST",
      path: "/_entry/remote/probe",
      body: null,
      action: true,
    });
  });

  test("a refused start shows the server's reason, not the whole response", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const calls = serve((call) =>
      call.path === "/_entry/remote/start"
        ? Response.json(
            { error: "sample reason", code: "conflict" },
            { status: 409 },
          )
        : Response.json(STOPPED),
    );
    const section = await mount("en");

    q<HTMLButtonElement>(section.element, ".remote-access-start").click();
    await waitFor(() => calls.length === 2);
    await waitFor(
      () => !q<HTMLElement>(section.element, ".agent-hooks-result").hidden,
    );

    expect(q(section.element, ".agent-hooks-result").textContent).toBe(
      "Could not start remote access\nError: POST /_entry/remote/start (HTTP 409): sample reason (conflict)",
    );
  });

  test("without saved values, start is disabled and the section says what to do", async () => {
    serve(() => Response.json({ ...STOPPED, config: { state: "absent" } }));
    const section = await mount();

    expect(
      q<HTMLButtonElement>(section.element, ".remote-access-start").disabled,
    ).toBe(true);
    expect(
      q<HTMLInputElement>(section.element, ".scope-settings-toggle input")
        .disabled,
    ).toBe(true);
    expect(section.element.children[1]?.textContent).toBe(
      "下の Cloudflare の値を保存すると開始できます。",
    );
  });

  test.each([
    {
      name: "a page opened from outside",
      response: () =>
        Response.json(
          { code: "remote-local-only", error: "local only" },
          { status: 403 },
        ),
      notice:
        "外部接続の開始・停止と値の変更は、code-viewer を動かしているパソコンの画面でだけ行えます。",
    },
    {
      name: "a server that is not the entry server",
      response: () => new Response("not found", { status: 404 }),
      notice:
        "この code-viewer では外部接続を使えません。--standalone を付けずに起動してください（古い code-viewer が動いたままなら、止めて起動し直します）。",
    },
  ])("on $name, only the reason is shown", async ({ response, notice }) => {
    serve(response);
    const section = await mount();
    const [, shown, , body] = Array.from(section.element.children);

    expect(shown?.textContent).toBe(notice);
    expect((body as HTMLElement | undefined)?.hidden).toBe(true);
  });

  test("other refusals are shown as a load failure with the server's reason", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    serve(() => new Response("forbidden", { status: 403 }));
    const section = await mount("en");

    expect(
      q(section.element, ".scope-settings-refresh-error").textContent,
    ).toBe(
      "Could not read the remote access status\nError: POST /_entry/remote/probe (HTTP 403): forbidden",
    );
  });

  test("turning on start with code-viewer posts it at once", async () => {
    const calls = serve(() => Response.json(STOPPED));
    const section = await mount();
    const input = q<HTMLInputElement>(
      section.element,
      ".scope-settings-toggle input",
    );

    input.checked = true;
    input.dispatchEvent(new Event("change"));
    await waitFor(() => calls.length === 2);

    expect(calls[1]).toEqual({
      method: "POST",
      path: "/_entry/remote/config",
      body: { autoStart: true },
      action: true,
    });
  });

  test("saving sends the edited values and the pasted token, then clears the token field", async () => {
    const saved: RemoteAccessSaveRequest[] = [];
    serve((call) => {
      if (call.path === "/_entry/remote/config")
        saved.push(call.body as RemoteAccessSaveRequest);
      return Response.json(STOPPED);
    });
    const section = await mount();
    const origin = q<HTMLInputElement>(
      section.element,
      "#remote-access-origin",
    );
    const token = q<HTMLInputElement>(section.element, "#remote-access-token");

    origin.value = "https://other.example.com";
    origin.dispatchEvent(new Event("input"));
    token.value = "cloudflared service install sample-token";
    token.dispatchEvent(new Event("input"));
    expect(section.draft.dirty()).toBe(true);
    await section.draft.save();

    expect(saved).toEqual([
      {
        values: { ...VALUES, origin: "https://other.example.com" },
        token: "cloudflared service install sample-token",
      },
    ]);
    expect(token.value).toBe("");
  });

  test.each([
    { name: "empty", port: "", problem: true },
    { name: "zero", port: "0", problem: true },
    { name: "the lowest", port: "1", problem: false },
    { name: "the highest", port: "65535", problem: false },
    { name: "above the highest", port: "65536", problem: true },
    { name: "a fraction", port: "64161.5", problem: true },
  ])("a $name port is a problem: $problem", async ({ port, problem }) => {
    serve(() => Response.json(STOPPED));
    const section = await mount("en");
    const input = q<HTMLInputElement>(section.element, "#remote-access-port");

    input.value = port;
    input.dispatchEvent(new Event("input"));

    expect(section.draft.problem?.()).toBe(
      problem
        ? "The service URL port must be a whole number from 1 to 65535."
        : null,
    );
  });
  test.each<{
    name: string;
    cloudflared: RemoteAccessStatus["cloudflared"];
    shown: boolean;
    disabled: boolean;
  }>([
    {
      name: "missing with Homebrew",
      cloudflared: {
        state: "unavailable",
        error: "not found",
        installable: true,
      },
      shown: true,
      disabled: false,
    },
    {
      name: "being installed",
      cloudflared: { state: "installing" },
      shown: true,
      disabled: true,
    },
    {
      name: "missing without Homebrew",
      cloudflared: {
        state: "unavailable",
        error: "not found",
        installable: false,
      },
      shown: false,
      disabled: false,
    },
    {
      name: "installed",
      cloudflared: { state: "ok", version: "2026.9.0" },
      shown: false,
      disabled: false,
    },
  ])(
    "the install button when cloudflared is $name",
    async ({ cloudflared, shown, disabled }) => {
      serve(() => Response.json({ ...STOPPED, cloudflared }));
      const section = await mount();
      const button = q<HTMLButtonElement>(
        section.element,
        ".remote-access-install",
      );

      expect({ shown: !button.hidden, disabled: button.disabled }).toEqual({
        shown,
        disabled,
      });
    },
  );

  test("pressing install asks the server to install cloudflared", async () => {
    const calls = serve(() =>
      Response.json({
        ...STOPPED,
        cloudflared: {
          state: "unavailable",
          error: "not found",
          installable: true,
        },
      }),
    );
    const section = await mount();

    q<HTMLButtonElement>(section.element, ".remote-access-install").click();
    await waitFor(() => calls.length === 2);

    expect(calls[1]).toEqual({
      method: "POST",
      path: "/_entry/remote/install",
      body: null,
      action: true,
    });
  });
});
