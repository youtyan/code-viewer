// terminal-board に残る小さな規則: パスの末尾、ブラウザのシェルと tmux の
// ペインの対応、経過時間の刻み。DOM を触らないので、表で固定する。

import { describe, expect, test } from "vitest";
import type { ShellSession } from "../core/shell";
import {
  basenameOf,
  elapsedBucket,
  linkShellsAndPanes,
} from "../core/terminal-board";
import {
  clampTerminalFontSize,
  DEFAULT_TERMINAL_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  type TmuxClient,
} from "../core/tmux";

function shell(over: Partial<ShellSession> = {}): ShellSession {
  return {
    id: "shell-abc123",
    command: "/bin/zsh",
    cwd: "/home/me/work/buffer",
    createdAt: "2026-08-01T09:41:58.000Z",
    cols: 80,
    rows: 24,
    exited: false,
    exitCode: null,
    tty: "",
    ...over,
  };
}

describe("basenameOf", () => {
  test.each([
    { name: "末尾を取る", path: "/home/me/work/board", expected: "board" },
    {
      name: "末尾のスラッシュを無視する",
      path: "/home/me/board/",
      expected: "board",
    },
    { name: "スラッシュが無ければそのまま", path: "board", expected: "board" },
    { name: "根はそのまま空になる", path: "/", expected: "" },
    { name: "空文字はそのまま", path: "", expected: "" },
  ])("$name", ({ path, expected }) => {
    expect(basenameOf(path)).toBe(expected);
  });
});

describe("シェルと tmux ペインの対応", () => {
  // ブラウザのシェルの中で tmux を起動すると、その tmux クライアントは
  // シェルと同じ端末に載る。tty を鍵にして両者を結び付ける。
  function client(tty: string, pane: string): TmuxClient {
    return { tty, session: "work", pane };
  }

  test("端末が一致するものどうしを両方向で結ぶ", () => {
    const linked = linkShellsAndPanes(
      [shell({ id: "shell-aaa111", tty: "/dev/ttys001" })],
      [client("/dev/ttys001", "%2"), client("/dev/ttys009", "%1")],
    );

    // ペインからは「映しているシェル」、シェルからは「映しているペイン」。
    expect([...linked.paneToShell]).toEqual([["%2", "shell-aaa111"]]);
    expect([...linked.shellToPane]).toEqual([["shell-aaa111", "%2"]]);
  });

  test("tty を引けなかったシェルは何とも結ばない", () => {
    // 空の tty を素通しすると、tty が空のクライアントと当たって無関係な
    // ペインに印が付く。
    const linked = linkShellsAndPanes(
      [shell({ id: "shell-aaa111", tty: "" })],
      [client("", "%1")],
    );

    expect(linked.paneToShell.size).toBe(0);
    expect(linked.shellToPane.size).toBe(0);
  });

  test("終了したシェルは映しているものとして数えない", () => {
    // プロセスが死んだ後も一覧には残る。端末だけ一致しても画面は出ていない。
    const linked = linkShellsAndPanes(
      [shell({ id: "shell-aaa111", tty: "/dev/ttys001", exited: true })],
      [client("/dev/ttys001", "%1")],
    );

    expect(linked.paneToShell.size).toBe(0);
    expect(linked.shellToPane.size).toBe(0);
  });

  test("クライアントが無ければ何も結ばない", () => {
    // /_tmux/clients が落ちても、一覧そのものは出せる。
    const linked = linkShellsAndPanes([shell({ tty: "/dev/ttys001" })], []);

    expect(linked.paneToShell.size).toBe(0);
    expect(linked.shellToPane.size).toBe(0);
  });
});

describe("elapsedBucket", () => {
  test.each([
    { name: "境界: 0 は たった今", ms: 0, unit: "now", value: 0 },
    { name: "境界: 59 秒は たった今", ms: 59_999, unit: "now", value: 0 },
    { name: "境界: 60 秒で 1 分", ms: 60_000, unit: "minute", value: 1 },
    { name: "境界: 59 分", ms: 59 * 60_000, unit: "minute", value: 59 },
    { name: "境界: 60 分で 1 時間", ms: 60 * 60_000, unit: "hour", value: 1 },
    { name: "境界: 23 時間", ms: 23 * 3_600_000, unit: "hour", value: 23 },
    { name: "境界: 24 時間で 1 日", ms: 24 * 3_600_000, unit: "day", value: 1 },
    { name: "負の値は たった今", ms: -5, unit: "now", value: 0 },
    {
      name: "数値でなければ たった今",
      ms: Number.NaN,
      unit: "now",
      value: 0,
    },
  ])("$name", ({ ms, unit, value }) => {
    expect(elapsedBucket(ms)).toEqual({ unit, value });
  });
});

describe("clampTerminalFontSize", () => {
  // 保存値は他の設定と同じ経路で往復するので、壊れた値が来ても既定へ落として
  // 端末が読めない大きさにならないようにする。
  test.each([
    {
      name: "境界: 下限ちょうど",
      value: MIN_TERMINAL_FONT_SIZE,
      expected: MIN_TERMINAL_FONT_SIZE,
    },
    {
      name: "境界: 下限未満は下限へ",
      value: MIN_TERMINAL_FONT_SIZE - 1,
      expected: MIN_TERMINAL_FONT_SIZE,
    },
    {
      name: "境界: 上限ちょうど",
      value: MAX_TERMINAL_FONT_SIZE,
      expected: MAX_TERMINAL_FONT_SIZE,
    },
    {
      name: "境界: 上限超過は上限へ",
      value: MAX_TERMINAL_FONT_SIZE + 1,
      expected: MAX_TERMINAL_FONT_SIZE,
    },
    { name: "小数は丸める", value: 12.6, expected: 13 },
    { name: "0 は下限へ", value: 0, expected: MIN_TERMINAL_FONT_SIZE },
    { name: "負値は下限へ", value: -20, expected: MIN_TERMINAL_FONT_SIZE },
  ])("$name", ({ value, expected }) => {
    expect(clampTerminalFontSize(value)).toBe(expected);
  });

  test.each([
    { name: "未設定は既定", value: undefined },
    { name: "null は既定", value: null },
    { name: "文字列は既定", value: "14" },
    { name: "NaN は既定", value: Number.NaN },
  ])("$name", ({ value }) => {
    expect(clampTerminalFontSize(value)).toBe(DEFAULT_TERMINAL_FONT_SIZE);
  });
});
