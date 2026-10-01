// SP の 1 ペイン表示から送る入力が、tmux のどのコマンドになり、tmux の結果が
// どの応答になるか。ここが狂うと、打った文字が化けたり、`;` で終わる文が途中で
// 切れたり、閉じたペインへの送信を失敗として見せなかったりする。

import { beforeEach, describe, expect, test, vi } from "vitest";

const runTmux = vi.hoisted(() => vi.fn());

vi.mock("../server/tmux/command", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/tmux/command")>()),
  runTmux,
}));

import { handleTmuxRoute } from "../server/tmux/handle";
import { paneInputArgs } from "../server/tmux/pane-stream";
import { postRoute } from "./_test-helpers";

beforeEach(() => {
  runTmux.mockReset();
});

describe("paneInputArgs", () => {
  test.each([
    {
      name: "打鍵はバイトのまま 16 進で送る",
      input: { keys: "a\r" },
      expected: ["send-keys", "-t", "%3", "-H", "61", "0d"],
    },
    {
      name: "日本語の打鍵は UTF-8 のバイト",
      input: { keys: "日" },
      expected: ["send-keys", "-t", "%3", "-H", "e6", "97", "a5"],
    },
    {
      name: "文字は貼り付けて一時バッファを消す",
      input: { text: "hello" },
      expected: [
        "set-buffer",
        "-b",
        "buf",
        "--",
        "hello",
        ";",
        "paste-buffer",
        "-p",
        "-d",
        "-b",
        "buf",
        "-t",
        "%3",
      ],
    },
    {
      name: "文字のあとに Enter",
      input: { text: "go", enter: true },
      expected: [
        "set-buffer",
        "-b",
        "buf",
        "--",
        "go",
        ";",
        "paste-buffer",
        "-p",
        "-d",
        "-b",
        "buf",
        "-t",
        "%3",
        ";",
        "send-keys",
        "-t",
        "%3",
        "Enter",
      ],
    },
    {
      name: "; で終わる文字は区切りと読まれないようにする",
      input: { text: "a;" },
      expected: [
        "set-buffer",
        "-b",
        "buf",
        "--",
        "a\\;",
        ";",
        "paste-buffer",
        "-p",
        "-d",
        "-b",
        "buf",
        "-t",
        "%3",
      ],
    },
    {
      name: "Enter だけ",
      input: { enter: true },
      expected: ["send-keys", "-t", "%3", "Enter"],
    },
    { name: "送るものが無い", input: { keys: "", text: "" }, expected: null },
  ])("$name", ({ input, expected }) => {
    expect(paneInputArgs("%3", input, "buf")).toEqual(expected);
  });
});

describe("POST /_tmux/pane-input の応答", () => {
  test.each([
    {
      name: "送れた: 送った順番の印を返す",
      tmux: { status: "ok", stdout: "" },
      status: 200,
      body: '{"ok":true,"generation":7}',
    },
    {
      name: "ペインが無い",
      tmux: { status: "no-target" },
      status: 410,
      body: "pane %3 is gone",
    },
    {
      name: "tmux が動いていない",
      tmux: { status: "no-server" },
      status: 410,
      body: "pane %3 is gone",
    },
    {
      name: "tmux が失敗した: 理由をそのまま返す",
      tmux: { status: "error", error: new Error("tmux exited with 1") },
      status: 500,
      body: "Error: tmux exited with 1",
    },
  ])("$name", async ({ tmux, status, body }) => {
    runTmux.mockResolvedValue(tmux);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await postRoute(handleTmuxRoute, "/_tmux/pane-input", {
      pane: "%3",
      keys: "x",
      generation: 7,
    });
    expect([res?.status, await res?.text()]).toEqual([status, body]);
  });
});
