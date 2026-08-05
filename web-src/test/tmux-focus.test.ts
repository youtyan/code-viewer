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
  test("ペインを引用して attach する 1 行を返す", () => {
    // `%3` はシェルにとってジョブ指定。引用しないと意図しない展開に化ける。
    expect(tmuxAttachCommandLine("%3")).toBe("'tmux' attach-session -t '%3'\r");
  });

  test("実行するために改行で終える", () => {
    // 改行が無いと打ち込まれるだけで走らない。
    expect(tmuxAttachCommandLine("%12").endsWith("\r")).toBe(true);
  });
});

describe("resolvePaneSession", () => {
  test("returns the resolved session", async () => {
    runTmux.mockResolvedValue({ status: "ok", stdout: "sample-session\n" });

    await expect(resolvePaneSession("%1", process.cwd())).resolves.toEqual({
      status: "ok",
      session: "sample-session",
    });
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
