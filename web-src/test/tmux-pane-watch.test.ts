// SP の 1 ペイン表示の元になる、control mode のクライアントの扱い。tmux の代わりに、
// 書き込まれたコマンドを記録し、テストが返事を流し込む子プロセスを使う。
//
// 守ること:
// - 画面の読み取りの返事より前の出力は捨て、後の出力だけを続きとして渡す
// - コマンドが途中で失敗しても、後のコマンドの返事を取り違えない
// - 窓の並びが変わったら、大きさが変わったときだけ読み直し、無くなったら終える

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runTmux: vi.fn(),
  spawnProcess: vi.fn(),
  stopProcess: vi.fn(),
}));

vi.mock("../server/tmux/command", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/tmux/command")>()),
  runTmux: mocks.runTmux,
}));
vi.mock("../server/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/runtime")>()),
  spawnProcess: mocks.spawnProcess,
  stopProcess: mocks.stopProcess,
}));

import {
  closeAllPaneWatches,
  type PaneWatcher,
  watchTmuxPane,
} from "../server/tmux/pane-watch";

class FakeTmux extends EventEmitter {
  pid = 4242;
  written: string[] = [];
  stdinEnded = false;
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = Object.assign(new EventEmitter(), {
    write: (line: string) => {
      this.written.push(...line.split("\n").filter(Boolean));
      return true;
    },
    end: () => {
      this.stdinEnded = true;
    },
  });
  private replyNumber = 100;

  send(...lines: string[]): void {
    this.stdout.write(`${lines.join("\n")}\n`);
  }

  reply(ok: boolean, ...lines: string[]): string[] {
    this.replyNumber += 1;
    const tail = `1 ${this.replyNumber} 1`;
    return [`%begin ${tail}`, ...lines, `%${ok ? "end" : "error"} ${tail}`];
  }
}

// display-message の書式 (pane-watch.ts の META_FIELDS) と同じ並び:
// id dead 桁 行 cx cy cursor alt appCursor keypad insert wrap origin 上 下 過去
function meta(pane: string, cols: number, rows: number): string {
  return `${pane} 0 ${cols} ${rows} 4 2 1 0 0 0 0 1 0 0 ${rows - 1} 10`;
}

let tmux: FakeTmux;

function recorder(): { events: string[]; watcher: PaneWatcher } {
  const events: string[] = [];
  return {
    events,
    watcher: {
      snapshot: (s) =>
        events.push(
          `snapshot ${s.width}x${s.height} ${JSON.stringify(s.content)}`,
        ),
      output: (text) => events.push(`output ${text}`),
      gone: () => events.push("gone"),
      failed: (error) => events.push(`failed ${error.message}`),
    },
  };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  tmux = new FakeTmux();
  mocks.spawnProcess.mockReturnValue(tmux);
  mocks.runTmux.mockImplementation(async (args: string[]) => ({
    status: "ok",
    stdout: `${args[3]} $1\n`,
  }));
});

afterEach(() => {
  closeAllPaneWatches();
  vi.clearAllMocks();
});

describe("watchTmuxPane", () => {
  test("読み取りの返事より前の出力は捨て、後の出力を続きとして渡す", async () => {
    const { events, watcher } = recorder();
    await watchTmuxPane("%3", "/repo", watcher);
    tmux.send(
      "%output %3 before",
      ...tmux.reply(true, meta("%3", 80, 24)),
      ...tmux.reply(true, "line1", "line2"),
      "%output %3 after",
      "%output %4 other-pane",
    );
    await settle();
    expect(events).toEqual([
      `snapshot 80x24 "line1\\u001b[0m\\nline2\\u001b[0m"`,
      "output after",
    ]);
  });

  test("セッションの control mode のクライアントを 1 本だけ起こす", async () => {
    await watchTmuxPane("%3", "/repo", recorder().watcher);
    await watchTmuxPane("%4", "/repo", recorder().watcher);
    expect(
      mocks.spawnProcess.mock.calls.map(([, args]) => args.slice(0, 4)),
    ).toEqual([["-C", "attach-session", "-t", "$1"]]);
  });

  test("ペインが無ければ繋がずに gone を返す", async () => {
    mocks.runTmux.mockResolvedValue({ status: "ok", stdout: " \n" });
    expect(await watchTmuxPane("%9", "/repo", recorder().watcher)).toEqual({
      status: "gone",
    });
    expect(mocks.spawnProcess).not.toHaveBeenCalled();
  });

  test("1 つ目のコマンドが失敗して残りが飛ばされても、次の返事を取り違えない", async () => {
    const first = recorder();
    const second = recorder();
    await watchTmuxPane("%3", "/repo", first.watcher);
    await watchTmuxPane("%4", "/repo", second.watcher);
    tmux.send(
      // %3 の読み取り: 1 つ目が失敗し、tmux は capture-pane を実行しない
      ...tmux.reply(false, "can't find pane: %3"),
      // %4 の読み取り
      ...tmux.reply(true, meta("%4", 60, 20)),
      ...tmux.reply(true, "ok"),
    );
    await settle();
    expect([first.events, second.events]).toEqual([
      ["gone"],
      [`snapshot 60x20 "ok\\u001b[0m"`],
    ]);
  });

  // replies は窓の並びが変わった後に tmux が返す返事 (大きさの確かめ、読み直しなら
  // 続けて読み直しの 2 つ)。
  test.each([
    {
      name: "大きさが同じなら読み直さない",
      replies: [[meta("%3", 80, 24)]],
      expected: [],
    },
    {
      name: "大きさが変わったら読み直す",
      replies: [[meta("%3", 40, 24)], [meta("%3", 40, 24)], ["narrow"]],
      expected: [`snapshot 40x24 "narrow\\u001b[0m"`],
    },
    {
      name: "ペインが無くなったら終える",
      replies: [[" "]],
      expected: ["gone"],
    },
  ])("窓の並びが変わった: $name", async ({ replies, expected }) => {
    const { events, watcher } = recorder();
    await watchTmuxPane("%3", "/repo", watcher);
    tmux.send(
      ...tmux.reply(true, meta("%3", 80, 24)),
      ...tmux.reply(true, "wide"),
    );
    await settle();
    events.length = 0;
    tmux.send("%layout-change @1 x,80x24,0,0,3 x,80x24,0,0,3 *");
    await settle();
    tmux.send(...replies.flatMap((lines) => tmux.reply(true, ...lines)));
    await settle();
    expect(events).toEqual(expected);
  });

  test("セッションが終わったら gone を伝える", async () => {
    const { events, watcher } = recorder();
    await watchTmuxPane("%3", "/repo", watcher);
    tmux.send("%exit");
    await settle();
    expect(events).toEqual(["gone"]);
  });

  test("クライアントが急に終わったら、標準エラーを理由に failed を伝える", async () => {
    const { events, watcher } = recorder();
    await watchTmuxPane("%3", "/repo", watcher);
    tmux.stderr.write("no server running");
    await settle();
    tmux.emit("close", 1, null);
    expect(events).toEqual([
      "failed the tmux control client for session $1 exited (code 1): no server running",
    ]);
  });

  test("最後に見ていた側が止めたら、標準入力を閉じてクライアントを外す", async () => {
    const result = await watchTmuxPane("%3", "/repo", recorder().watcher);
    if (result.status !== "ok")
      throw new Error(`watch failed: ${result.status}`);
    const before = tmux.stdinEnded;
    result.stop();
    expect([before, tmux.stdinEnded]).toEqual([false, true]);
  });
});
