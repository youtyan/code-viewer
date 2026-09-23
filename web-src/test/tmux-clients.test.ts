// list-clients の出力を、どの端末がどのペインを映しているかの一覧にするまで。
//
// ここが狂うと「このシェルが映しているペイン」の対応が丸ごとずれ、ツリーの
// 印が別の行に付いたり、switch-client の宛先が無関係な端末になったりする。
// tmux を呼ばない変換だけを見るので、書式の取り違えはここで捕まる。

import { beforeEach, describe, expect, test, vi } from "vitest";

const runTmux = vi.hoisted(() => vi.fn());

vi.mock("../server/tmux/command", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/tmux/command")>();
  return { ...actual, runTmux };
});

import {
  findClientByTty,
  listTmuxClients,
  parseTmuxClients,
} from "../server/tmux/clients";

/** 実際の出力と同じ区切り (Unit Separator)。 */
const SEP = String.fromCharCode(31);

beforeEach(() => {
  runTmux.mockReset();
});

function line(tty: string, session: string, pane: string): string {
  return [tty, session, pane].join(SEP);
}

describe("parseTmuxClients", () => {
  test("端末・セッション・ペインを 1 件ずつ取り出す", () => {
    const stdout = [
      line("/dev/ttys001", "0", "%12"),
      line("/dev/ttys002", "work", "%34"),
    ].join("\n");

    expect(parseTmuxClients(stdout)).toEqual([
      { tty: "/dev/ttys001", session: "0", pane: "%12" },
      { tty: "/dev/ttys002", session: "work", pane: "%34" },
    ]);
  });

  test.each([
    { name: "空の出力", stdout: "" },
    { name: "空行だけ", stdout: "\n\n" },
    { name: "列が足りない行", stdout: `/dev/ttys001${SEP}0` },
    { name: "tty が空の行", stdout: line("", "0", "%1") },
  ])("$name は 1 件も返さない", ({ stdout }) => {
    expect(parseTmuxClients(stdout)).toEqual([]);
  });

  test("列が足りない行を捨てても、後ろの正しい行は残る", () => {
    // tmux の警告が stdout に混ざっても、読める行まで落とさない。
    const stdout = ["warning: something", line("/dev/ttys003", "0", "%5")].join(
      "\n",
    );

    expect(parseTmuxClients(stdout)).toEqual([
      { tty: "/dev/ttys003", session: "0", pane: "%5" },
    ]);
  });

  // 大きさの列 (端末の桁・行、ウインドウの桁・行、status、status-position、
  // セッションに繋がっている端末の数)。読めない値が 1 つでもあれば大きさを
  // 持たせない (覆う範囲を当て推量しない)。宛先としては残す。
  test.each([
    {
      name: "ステータスが下に 1 行",
      size: ["378", "113", "378", "104", "on", "bottom", "2"],
      window: {
        clientCols: 378,
        clientRows: 113,
        windowCols: 378,
        windowRows: 104,
        statusLines: 1,
        statusAt: "bottom",
        sessionClients: 2,
      },
    },
    {
      name: "ステータスが上に 2 行",
      size: ["200", "50", "120", "40", "2", "top", "3"],
      window: {
        clientCols: 200,
        clientRows: 50,
        windowCols: 120,
        windowRows: 40,
        statusLines: 2,
        statusAt: "top",
        sessionClients: 3,
      },
    },
    {
      name: "ステータスなし",
      size: ["80", "24", "80", "24", "off", "bottom", "1"],
      window: {
        clientCols: 80,
        clientRows: 24,
        windowCols: 80,
        windowRows: 24,
        statusLines: 0,
        statusAt: "bottom",
        sessionClients: 1,
      },
    },
    {
      name: "status が知らない値",
      size: ["80", "24", "80", "23", "6", "bottom", "1"],
      window: null,
    },
    {
      name: "status-position が知らない値",
      size: ["80", "24", "80", "23", "on", "left", "1"],
      window: null,
    },
    {
      name: "大きさが数でない",
      size: ["80", "", "80", "23", "on", "bottom", "1"],
      window: null,
    },
    {
      name: "大きさが 0",
      size: ["80", "24", "0", "23", "on", "bottom", "1"],
      window: null,
    },
    { name: "大きさの列が無い (古い書式)", size: [], window: null },
  ])("大きさの列: $name", ({ size, window }) => {
    const stdout = [line("/dev/ttys001", "work", "%3"), ...size].join(SEP);
    expect(parseTmuxClients(stdout)).toEqual([
      {
        tty: "/dev/ttys001",
        session: "work",
        pane: "%3",
        ...(window ? { window } : {}),
      },
    ]);
  });

  test("list-clients に大きさとステータスの書式を渡す", async () => {
    runTmux.mockResolvedValue({ status: "ok", stdout: "" });
    await listTmuxClients("/sample");
    const format = runTmux.mock.calls[0]?.[0]?.[2] as string;
    expect(format.split(SEP)).toEqual([
      "#{client_tty}",
      "#{client_session}",
      "#{pane_id}",
      "#{client_width}",
      "#{client_height}",
      "#{window_width}",
      "#{window_height}",
      "#{status}",
      "#{status-position}",
      "#{session_attached}",
      "#{window_id}",
    ]);
  });

  test.each([
    { name: "ウインドウの列がある", id: "@7", expected: { windowId: "@7" } },
    { name: "ウインドウの列が空", id: "", expected: {} },
  ])("見ているウインドウ: $name", ({ id, expected }) => {
    const size = ["80", "24", "80", "23", "on", "bottom", "1"];
    const stdout = [line("/dev/ttys001", "work", "%3"), ...size, id].join(SEP);
    const [client] = parseTmuxClients(stdout);
    expect({ tty: client?.tty, windowId: client?.windowId }).toEqual({
      tty: "/dev/ttys001",
      windowId: undefined,
      ...expected,
    });
  });

  test("末尾の改行で空の 1 件を作らない", () => {
    expect(
      parseTmuxClients(`${line("/dev/ttys001", "0", "%1")}\n`),
    ).toHaveLength(1);
  });
});

describe("findClientByTty", () => {
  const CLIENTS = parseTmuxClients(
    [
      line("/dev/ttys001", "0", "%12"),
      line("/dev/ttys002", "work", "%34"),
    ].join("\n"),
  );

  test("その端末のクライアントを返す", () => {
    expect(findClientByTty(CLIENTS, "/dev/ttys002")?.pane).toBe("%34");
  });

  test("繋がっていない端末には何も返さない", () => {
    expect(findClientByTty(CLIENTS, "/dev/ttys999")).toBeNull();
  });

  test("空の tty はどのクライアントにも当てない", () => {
    // tty を引けなかったシェルが、無関係な端末を動かす宛先にならないこと。
    // ここを素通しすると、別の端末で作業中の画面が勝手に切り替わる。
    expect(findClientByTty(CLIENTS, "")).toBeNull();
  });
});

describe("listTmuxClients", () => {
  test("returns parsed clients for a successful command", async () => {
    runTmux.mockResolvedValue({
      status: "ok",
      stdout: line("/dev/ttys001", "sample-session", "%12"),
    });

    await expect(listTmuxClients(process.cwd())).resolves.toEqual({
      status: "ok",
      clients: [
        { tty: "/dev/ttys001", session: "sample-session", pane: "%12" },
      ],
    });
  });

  test.each([
    { name: "the command is missing", result: { status: "missing" } },
    { name: "the server is not running", result: { status: "no-server" } },
    { name: "the target disappears", result: { status: "no-target" } },
  ])("returns gone when $name", async ({ result }) => {
    runTmux.mockResolvedValue(result);

    await expect(listTmuxClients(process.cwd())).resolves.toEqual({
      status: "gone",
    });
  });

  test("keeps a command error instead of returning an empty list", async () => {
    const error = new Error("list-clients failed");
    runTmux.mockResolvedValue({ status: "error", error });

    await expect(listTmuxClients(process.cwd())).resolves.toEqual({
      status: "error",
      error,
    });
  });
});
