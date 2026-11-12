// 設定の「外部接続」の presenter (views/remote-access-settings.ts)。表示を記録する
// view に差し替え、入口のサーバの答えから view に渡す値と、押したときに送るものを見る。

import "./_dom";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { RemoteAccessStatus } from "../core/remote-access";
import {
  createRemoteAccessSettings,
  DEFAULT_VIEW,
  type RemoteAccessViewProps,
} from "../views/remote-access-settings";
import { REMOTE_ACCESS_SETTINGS_TEXT } from "../views/remote-access-settings-i18n";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const STOPPED: RemoteAccessStatus = {
  generation: 1,
  configPath: "/state/remote-access.json",
  tokenPath: "/state/tunnel-token",
  configFromFlag: false,
  config: {
    state: "ok",
    values: {
      port: 64161,
      origin: "https://viewer.example.com",
      teamDomain: "example.cloudflareaccess.com",
      audience: "sample-audience",
    },
    autoStart: false,
  },
  token: { state: "absent" },
  cloudflared: { state: "ok", version: "2026.9.0" },
  listener: { state: "stopped" },
  tunnel: { state: "stopped" },
  log: [],
};

function setup() {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      calls.push(
        `${init.method ?? "GET"} ${new URL(input, "http://localhost").pathname}`,
      );
      return Response.json(STOPPED);
    }),
  );
  const shown: RemoteAccessViewProps[] = [];
  const section = createRemoteAccessSettings(
    {
      getText: () => REMOTE_ACCESS_SETTINGS_TEXT.en,
      trackLoad: (promise) => promise,
      actionHeaders: () => ({}),
      openShell: () => undefined,
    },
    (props) => {
      shown.push(props);
      return DEFAULT_VIEW(props);
    },
  );
  document.body.appendChild(section.element);
  return { section, shown, calls };
}

const latest = (items: RemoteAccessViewProps[]) => items[items.length - 1];

describe("the remote access presenter", () => {
  test("gives the view the three status rows and lets start be pressed", async () => {
    const { section, shown } = setup();
    await section.refresh();
    const props = latest(shown);
    const text = REMOTE_ACCESS_SETTINGS_TEXT.en;
    expect({
      rows: props?.rows.map((row) => [row.name, row.label, row.detail.kind]),
      start: props?.start.disabled,
      stop: props?.stop.disabled,
    }).toEqual({
      rows: [
        [text.rowListener, text.listenerStopped, "text"],
        [text.rowTunnel, text.tunnelStopped, "text"],
        [text.rowToken, text.tokenAbsent, "button"],
      ],
      start: false,
      stop: true,
    });
  });

  test("start posts to the entry server; typing a value marks the draft unsaved", async () => {
    const { section, shown, calls } = setup();
    await section.refresh();
    latest(shown)?.start.onClick();
    await vi.waitFor(() =>
      expect(calls).toContain("POST /_entry/remote/start"),
    );
    latest(shown)
      ?.fields.find((field) => field.field === "origin")
      ?.onInput("https://other.example.com");
    expect([latest(shown)?.unsaved.shown, section.draft.dirty()]).toEqual([
      true,
      true,
    ]);
  });
});
