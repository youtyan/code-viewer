// ターミナルの画像パスの相対パスを、どこから解くか (server/terminal/image-base.ts)。
//
// エージェントがリポジトリの下の別のディレクトリで動いていると、リポジトリの
// 根から解いた相対パスは外れる。だからシェルが映している tmux のペインの
// 作業場所から解く。取れないときは シェルの場所 → リポジトリの根 の順に戻る。
//
// tmux とシェルは外の境界なので差し替える。本物の tmux で確かめる手順は
// agents.md の 10 (動かして確かめたときの記録は作業報告に残す)。

import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ShellSession } from "../core/shell";
import type { TmuxClient } from "../core/tmux";
import type { TmuxClientsResult } from "../server/tmux/clients";
import type { TmuxRunResult } from "../server/tmux/command";

type FakeState = {
  session: ShellSession | null;
  clients: TmuxClientsResult;
  paneCwd: TmuxRunResult;
  tmuxCalls: string[][];
};
const STATE_KEY = "__terminalImageBaseFake";
const fake = () =>
  (globalThis as Record<string, unknown>)[STATE_KEY] as FakeState;

vi.mock("../server/shell/session", () => ({
  getShellSession: () =>
    (
      (globalThis as Record<string, unknown>)
        .__terminalImageBaseFake as FakeState
    ).session,
}));
vi.mock("../server/tmux/clients", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/tmux/clients")>();
  return {
    ...actual,
    listTmuxClients: () =>
      Promise.resolve(
        (
          (globalThis as Record<string, unknown>)
            .__terminalImageBaseFake as FakeState
        ).clients,
      ),
  };
});
vi.mock("../server/tmux/command", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/tmux/command")>();
  return {
    ...actual,
    runTmux: (args: string[]) => {
      const state = (globalThis as Record<string, unknown>)
        .__terminalImageBaseFake as FakeState;
      state.tmuxCalls.push(args);
      return Promise.resolve(state.paneCwd);
    },
  };
});

const { terminalImageBase } = await import("../server/terminal/image-base");

const REPO = "/work/sample-app";
const SHELL_ID = "shell-abc123";
const SESSION: ShellSession = {
  id: SHELL_ID,
  command: "/bin/zsh",
  cwd: "/work/sample-app/tools",
  createdAt: "2026-08-01T09:41:58.000Z",
  cols: 80,
  rows: 24,
  exited: false,
  exitCode: null,
  tty: "/dev/ttys001",
};
const CLIENT: TmuxClient = {
  tty: "/dev/ttys001",
  session: "work",
  pane: "%7",
};

beforeEach(() => {
  (globalThis as Record<string, unknown>)[STATE_KEY] = {
    session: SESSION,
    clients: { status: "ok", clients: [CLIENT] },
    paneCwd: { status: "ok", stdout: "/work/sample-app/packages/web\n" },
    tmuxCalls: [],
  } satisfies FakeState;
});

describe("terminalImageBase", () => {
  test("シェルが映している tmux のペインの作業場所から解く", async () => {
    expect(await terminalImageBase(REPO, SHELL_ID)).toEqual({
      base: { source: "pane", cwd: "/work/sample-app/packages/web" },
      pane: "%7",
    });
    // 聞くのは、端末の名前で突き合わせたクライアントが見ているペイン。
    expect(fake().tmuxCalls).toEqual([
      ["display-message", "-p", "-t", "%7", "-F", "#{pane_current_path}"],
    ]);
  });

  test.each([
    {
      name: "shell を渡さない",
      shell: null,
      setup: () => undefined,
      expected: { base: { source: "repo", cwd: REPO }, pane: null },
    },
    {
      name: "もう無いシェル",
      shell: SHELL_ID,
      setup: () => {
        fake().session = null;
      },
      expected: { base: { source: "repo", cwd: REPO }, pane: null },
    },
    {
      name: "tmux が動いていない",
      shell: SHELL_ID,
      setup: () => {
        fake().clients = { status: "gone" };
      },
      expected: { base: { source: "shell", cwd: SESSION.cwd }, pane: null },
    },
    {
      name: "このシェルは tmux を映していない",
      shell: SHELL_ID,
      setup: () => {
        fake().clients = {
          status: "ok",
          clients: [{ ...CLIENT, tty: "/dev/ttys009" }],
        };
      },
      expected: { base: { source: "shell", cwd: SESSION.cwd }, pane: null },
    },
    {
      name: "端末の名前が引けなかったシェルは誰にも当てない",
      shell: SHELL_ID,
      setup: () => {
        fake().session = { ...SESSION, tty: "" };
        fake().clients = { status: "ok", clients: [{ ...CLIENT, tty: "" }] };
      },
      expected: { base: { source: "shell", cwd: SESSION.cwd }, pane: null },
    },
    {
      name: "ペインが引く間に閉じられた",
      shell: SHELL_ID,
      setup: () => {
        fake().paneCwd = { status: "no-target" };
      },
      expected: { base: { source: "shell", cwd: SESSION.cwd }, pane: null },
    },
    {
      name: "作業場所が空 (引けない環境)",
      shell: SHELL_ID,
      setup: () => {
        fake().paneCwd = { status: "ok", stdout: "\n" };
      },
      expected: { base: { source: "shell", cwd: SESSION.cwd }, pane: "%7" },
    },
    {
      name: "シェルの場所も無ければリポジトリの根",
      shell: SHELL_ID,
      setup: () => {
        fake().session = { ...SESSION, cwd: "" };
        fake().clients = { status: "gone" };
      },
      expected: { base: { source: "repo", cwd: REPO }, pane: null },
    },
  ])("$name", async ({ shell, setup, expected }) => {
    setup();
    expect(await terminalImageBase(REPO, shell)).toEqual(expected);
  });

  test.each([
    {
      name: "クライアントの一覧が失敗した",
      setup: () => {
        fake().clients = {
          status: "error",
          error: new Error("tmux exited with 1\nstderr: boom"),
        };
      },
      pane: null,
    },
    {
      name: "作業場所の問い合わせが失敗した",
      setup: () => {
        fake().paneCwd = {
          status: "error",
          error: new Error("tmux exited with 1\nstderr: boom"),
        };
      },
      pane: "%7",
    },
  ])("$name ときは理由を残してシェルの場所から解く", async ({
    setup,
    pane,
  }) => {
    // 失敗を黙って別の起点に差し替えない。理由は応答に載り、ログにも出る。
    setup();
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const result = await terminalImageBase(REPO, SHELL_ID);
      expect(result.pane).toBe(pane);
      expect(result.base.source).toBe("shell");
      expect(result.base.cwd).toBe(SESSION.cwd);
      expect(result.base.error).toContain("stderr: boom");
      expect(errors).toHaveBeenCalledTimes(1);
    } finally {
      errors.mockRestore();
    }
  });
});
