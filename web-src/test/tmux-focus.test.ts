// ペインを見せるための tmux コマンドの組み立て。
//
// 一番落としたくないのは switch-client の宛先。-c を欠くと tmux は「最後に
// 使われたクライアント」を動かすので、ユーザーが別の端末で作業している画面が
// 勝手に切り替わる。宛先が無いときは呼ばずに畳む、が守れているかを見る。

import { beforeEach, describe, expect, test, vi } from "vitest";

const runTmux = vi.hoisted(() => vi.fn());

vi.mock("../server/tmux/command", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/tmux/command")>();
  return { ...actual, runTmux };
});

import {
  focusTmuxPane,
  resolvePaneSession,
  tmuxAttachCommandLine,
} from "../server/tmux/focus";

beforeEach(() => {
  runTmux.mockReset();
});

describe("focusTmuxPane", () => {
  test("宛先の端末が無ければ tmux を呼ばずに畳む", async () => {
    // tty を引けなかったシェル (Windows や ps が無い環境) がここに来る。
    // 素通しすると -c 無しの switch-client になり、無関係な端末が動く。
    const result = await focusTmuxPane("%1", "", process.cwd());

    expect(result).toEqual({ status: "gone" });
  });
});

describe("tmuxAttachCommandLine", () => {
  // `%3` はシェルにとってジョブ指定。引用しないと意図しない展開に化ける。
  // TMUX を外して打つ (シェルが tmux の中でも入れ子で繋がる)。止める系の
  // tmux のコマンドは決して入れない。
  test.each([
    {
      pane: "%3",
      line: "env -u TMUX 'tmux' attach-session -t '%3' && exit\r",
    },
    {
      pane: "%12",
      line: "env -u TMUX 'tmux' attach-session -t '%12' && exit\r",
    },
  ] as const)("$pane を引用し、TMUX を外して attach し、抜けたらシェルも終える 1 行を返す", ({
    pane,
    line,
  }) => {
    const typed = tmuxAttachCommandLine(pane);
    expect([typed, /kill-|detach/.test(typed)]).toEqual([line, false]);
  });

  test("実行するために改行で終える", () => {
    // 改行が無いと打ち込まれるだけで走らない。
    expect(tmuxAttachCommandLine("%12").endsWith("\r")).toBe(true);
  });
});

describe("resolvePaneSession", () => {
  // 区切りは tmux の書式の区切り文字 (U+001F)。
  test.each([
    {
      name: "セッション名とウインドウの番号",
      stdout: "sample-session\u001f3\n",
      expected: { status: "ok", session: "sample-session", window: 3 },
    },
    {
      name: "区切りの文字を含むセッション名は最後の区切りで分ける",
      stdout: "sample\u001fsession\u001f0\n",
      expected: { status: "ok", session: "sample\u001fsession", window: 0 },
    },
    {
      name: "空の答えは gone",
      stdout: "\n",
      expected: { status: "gone" },
    },
  ])("$name", async ({ stdout, expected }) => {
    runTmux.mockResolvedValue({ status: "ok", stdout });

    await expect(resolvePaneSession("%1", process.cwd())).resolves.toEqual(
      expected,
    );
  });

  test.each([
    { name: "ウインドウの番号が無い", stdout: "sample-session\n" },
    { name: "ウインドウの番号が数でない", stdout: "sample-session\u001fx\n" },
    { name: "セッション名が空", stdout: "\u001f1\n" },
  ])("$name なら、答えを添えたエラー", async ({ stdout }) => {
    runTmux.mockResolvedValue({ status: "ok", stdout });

    const result = await resolvePaneSession("%1", process.cwd());

    expect(result.status === "error" && result.error.message).toBe(
      `tmux answered an unreadable session and window for %1: ${JSON.stringify(stdout)}`,
    );
  });

  test.each([
    { name: "the command is missing", result: { status: "missing" } },
    { name: "the server is not running", result: { status: "no-server" } },
    { name: "the target disappears", result: { status: "no-target" } },
  ])("returns gone when $name", async ({ result }) => {
    runTmux.mockResolvedValue(result);

    await expect(resolvePaneSession("%1", process.cwd())).resolves.toEqual({
      status: "gone",
    });
  });

  test("keeps a command error instead of returning null", async () => {
    const error = new Error("display-message failed");
    runTmux.mockResolvedValue({ status: "error", error });

    await expect(resolvePaneSession("%1", process.cwd())).resolves.toEqual({
      status: "error",
      error,
    });
  });
});
