// 端末の画面のリンクの層 (views/terminal/terminal-links-layer.ts) の view。層は
// 端末の文字に合わせて印と帯を書き換えるので、view は形だけを持つ。描き方を
// 記録する view に差し替え、指したリンクの印と帯のボタンに渡す値を見る。

import "./_dom";
import { afterEach, describe, expect, test } from "vitest";
import type { XtermTerminal } from "../core/xterm-loader";
import { terminalText } from "../views/terminal/i18n";
import {
  createTerminalLinkLayer,
  DEFAULT_VIEW,
  type ScreenLink,
  type TerminalLinkLayerView,
} from "../views/terminal/terminal-links-layer";

afterEach(() => {
  document.body.replaceChildren();
});

/** 80 桁 × 24 行、マス目 8×16 px の端末の偽物。 */
function fakeTerm(): XtermTerminal {
  const element = document.createElement("div");
  const screen = document.createElement("div");
  screen.className = "xterm-screen";
  Object.defineProperty(screen, "clientWidth", { get: () => 640 });
  Object.defineProperty(screen, "clientHeight", { get: () => 384 });
  element.append(screen);
  document.body.append(element);
  return {
    cols: 80,
    rows: 24,
    element,
    buffer: { active: { viewportY: 0 } },
    hasSelection: () => false,
  } as unknown as XtermTerminal;
}

const LINK: ScreenLink = {
  kind: "url",
  key: "0:0:https://example.test",
  text: "https://example.test",
  segments: [{ y: 0, x0: 0, x1: 19 }],
  url: "https://example.test",
};

describe("the terminal link layer's view", () => {
  test("marks the pointed link and labels the bar's buttons", () => {
    const segments: Parameters<TerminalLinkLayerView["segments"]>[0][] = [];
    const actions: string[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    const term = fakeTerm();
    const layer = createTerminalLinkLayer(
      host,
      {
        getText: () => terminalText("en"),
        term: () => term,
        links: () => [LINK],
        open: () => undefined,
        copyValue: (link) => link.url ?? link.text,
        onHover: () => undefined,
        onStatus: () => undefined,
      },
      {
        ...DEFAULT_VIEW,
        segments: (parts) => {
          segments.push(parts);
          return DEFAULT_VIEW.segments(parts);
        },
        action: (paths, label) => {
          actions.push(label);
          return DEFAULT_VIEW.action(paths, label);
        },
      },
    );
    host.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 20, clientY: 4, bubbles: true }),
    );
    expect([segments[segments.length - 1], actions]).toEqual([
      [{ className: "terminal-link-hover", row: 0, col: 0, cols: 20 }],
      [terminalText("en").linkOpen, terminalText("en").linkCopy],
    ]);
    layer.dispose();
  });
});
