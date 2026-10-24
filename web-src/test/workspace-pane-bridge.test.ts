// 面 (pane) の側のやりとり (views/workspace/bridge.ts の startPaneBridge)。host の
// 側 (workspace-bridge.test.ts) とは文書を分ける: host の受け口は写した部品の押下を
// 文書ごと捕まえるので、同じ文書では面の部品を押せない。

import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  HOST_HELLO,
  type HostCommand,
  type PaneMessage,
} from "../core/workspace-bridge";
import { startPaneBridge } from "../views/workspace/bridge";

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://127.0.0.1/p/0123456789abcdef/" });
  const html = readFileSync("web/index.html", "utf8");
  const match = /<body>([\s\S]*)<\/body>/.exec(html);
  if (!match) throw new Error("index.html has no body");
  document.body.innerHTML = match[1].replace(/<script[\s\S]*?<\/script>/g, "");
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

function el(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found;
}

// 面の受け口は文書に 1 つ (2 つ目の hello は投げる) なので、1 つのテストで通す。
describe("pane: host の hello を受けてから知らせる", () => {
  test("親の窓でない hello の口は使わず、親の口へ溜めた知らせを送り、頼みを受ける", async () => {
    const commands: unknown[] = [];
    const bridge = startPaneBridge({
      project: () => ({ root: "/work/sample-app", name: "sample-app" }),
      onCommand: (command) => commands.push(command),
    });
    bridge.send({ type: "look-changed" });
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const hello = (source: unknown) => {
      const channel = new MessageChannel();
      const received: PaneMessage[] = [];
      channel.port2.onmessage = (event) => received.push(event.data);
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: HOST_HELLO },
          origin: location.origin,
          source: source as Window,
          ports: [channel.port1],
        }),
      );
      return { received, port: channel.port2 };
    };
    const stranger = hello({});
    const parent = hello(window.parent);
    await vi.waitFor(() =>
      expect(parent.received.map((message) => message.type)).toEqual([
        // 写しはマイクロタスクでまとめて送る。
        "location",
        "look-changed",
        "mirror",
      ]),
    );
    parent.port.postMessage({ type: "nav-collapsed", collapsed: true });
    await vi.waitFor(() =>
      expect(commands).toEqual([{ type: "nav-collapsed", collapsed: true }]),
    );
    // 写した部品の頼み (click) は onCommand に渡さず、面の部品を修飾キーごと押す。
    const clicks: boolean[] = [];
    el("doctor-btn").addEventListener("click", (event) =>
      clicks.push(event.altKey),
    );
    parent.port.postMessage({
      type: "click",
      id: "doctor-btn",
      modifiers: {
        shiftKey: false,
        altKey: true,
        ctrlKey: false,
        metaKey: false,
      },
    } satisfies HostCommand);
    await vi.waitFor(() => expect(clicks).toEqual([true]));
    expect({
      commands: commands.length,
      stranger: stranger.received,
      refused: errors.mock.calls.map(([error]) => String(error)),
    }).toEqual({
      commands: 1,
      stranger: [],
      refused: [
        "Error: refused a host hello from http://127.0.0.1 that is not this pane's page",
      ],
    });
    errors.mockRestore();
  });
});
