// 棚の画像の出どころ: 画像パスが tmux のどのペインのどの行に出たか
// (server/terminal/image-origins.ts)。tmux を呼ばない変換だけを見る。
//
// 落とすと痛いもの:
//
// - 左右に分けたペインの両方に同じパスが出たとき、古い方を主にする
// - ペインの幅で折り返したパスの行が、片方の行だけになる
// - ペインの題名に区切り文字が入ると、並びが読めなくなる
// - 位置の読めない行で、ずれた所に枠を描く

import { describe, expect, test } from "vitest";
import { MAX_TERMINAL_REVEAL_TEXT } from "../core/terminal-images";
import { handleAgentRoute } from "../server/terminal/handle";
import {
  findSightings,
  type PaneText,
  paneText,
  parsePaneLayout,
} from "../server/terminal/image-origins";
import { TMUX_FIELD_SEP } from "../server/tmux/command";
import { callRoute, postRoute } from "./_test-helpers";

const STATUS = { statusLines: 1, statusAt: "bottom" } as const;

/** list-panes の 1 行 (id, 番号, 左, 上, 幅, 高さ, コマンド, 場所, ホスト名, 短いホスト名, 題名)。 */
function layoutLine(...fields: string[]): string {
  return fields.join(TMUX_FIELD_SEP);
}

/** 既定の値から変えたい列だけを書く 1 行。 */
function paneLine(
  fields: Partial<{
    id: string;
    index: string;
    left: string;
    top: string;
    width: string;
    height: string;
    command: string;
    path: string;
    host: string;
    hostShort: string;
    title: string;
  }> = {},
): string {
  const line = {
    id: "%1",
    index: "0",
    left: "0",
    top: "0",
    width: "80",
    height: "24",
    command: "zsh",
    path: "/w",
    host: "sample-host.local",
    hostShort: "sample-host",
    title: "t",
    ...fields,
  };
  return layoutLine(
    line.id,
    line.index,
    line.left,
    line.top,
    line.width,
    line.height,
    line.command,
    line.path,
    line.host,
    line.hostShort,
    line.title,
  );
}

describe("parsePaneLayout", () => {
  test("ペインの位置・大きさ・題名・フォルダの名前と、作業場所を読む", () => {
    const read = parsePaneLayout(
      [
        paneLine({ width: "59", height: "23", path: "/work/a", title: "left" }),
        paneLine({
          id: "%2",
          index: "1",
          left: "60",
          width: "59",
          height: "23",
          command: "node",
          path: "/work/sample-app/",
          title: "日本語",
        }),
        "",
      ].join("\n"),
      STATUS,
    );
    expect(read.layout).toEqual({
      panes: [
        {
          id: "%1",
          index: 0,
          title: "left",
          command: "zsh",
          folder: "a",
          left: 0,
          top: 0,
          width: 59,
          height: 23,
        },
        {
          id: "%2",
          index: 1,
          title: "日本語",
          command: "node",
          folder: "sample-app",
          left: 60,
          top: 0,
          width: 59,
          height: 23,
        },
      ],
      statusLines: 1,
      statusAt: "bottom",
    });
    expect([...read.paths]).toEqual([
      ["%1", "/work/a"],
      ["%2", "/work/sample-app/"],
    ]);
  });

  test("題名に区切り文字が入っていても、題名に戻す", () => {
    const title = `a${TMUX_FIELD_SEP}b`;
    const read = parsePaneLayout(paneLine({ title }), STATUS);
    expect(read.layout.panes[0]?.title).toBe(title);
  });

  test.each([
    { name: "ホスト名そのもの", title: "sample-host.local", expected: "" },
    { name: "短いホスト名", title: "sample-host", expected: "" },
    { name: "前後の空白つきのホスト名", title: " sample-host ", expected: "" },
    {
      name: "ホスト名を含むだけの題名",
      title: "sample-host build",
      expected: "sample-host build",
    },
    {
      name: "エージェントの題名",
      title: "✳ Claude Code",
      expected: "✳ Claude Code",
    },
  ])("題名がホスト名 (tmux の既定) なら空にする: $name", ({
    title,
    expected,
  }) => {
    expect(
      parsePaneLayout(paneLine({ title }), STATUS).layout.panes[0]?.title,
    ).toBe(expected);
  });

  test.each([
    { name: "列が足りない", line: layoutLine("%1", "0", "0", "0", "80") },
    { name: "位置が数でない", line: paneLine({ left: "-" }) },
    { name: "id が空", line: paneLine({ id: "" }) },
  ])("$name 行は捨てる (ずれた所に枠を描かない)", ({ line }) => {
    expect(parsePaneLayout(line, STATUS).layout.panes).toEqual([]);
  });
});

describe("paneText", () => {
  test("色を落とし、行末の空白を落とし、カーソルの行を履歴の分ずらす", () => {
    const esc = String.fromCharCode(27);
    expect(
      paneText({
        pane: "%1",
        content: `old   \n${esc}[31mout/a.png${esc}[0m  \n$ `,
        width: 40,
        cursorY: 1,
        historyLines: 1,
      }),
    ).toEqual({
      pane: "%1",
      width: 40,
      rows: ["old", "out/a.png", "$"],
      cursorRow: 2,
      screenTop: 1,
    });
  });
});

/** ペイン 1 つぶん。cursorRow は最後の行。 */
function pane(id: string, rows: string[], width = 40, screenTop = 0): PaneText {
  return { pane: id, width, rows, cursorRow: rows.length - 1, screenTop };
}

describe("findSightings", () => {
  test.each([
    {
      name: "1 つのペインに 1 回",
      panes: [pane("%1", ["$ make", "wrote out/a.png", "$"])],
      candidates: ["out/a.png"],
      expected: [
        { candidate: "out/a.png", pane: "%1", line: "wrote out/a.png" },
      ],
    },
    {
      name: "同じペインに何度も出たら一番下の行",
      panes: [pane("%1", ["first out/a.png", "…", "again out/a.png", "$"])],
      candidates: ["out/a.png"],
      expected: [
        { candidate: "out/a.png", pane: "%1", line: "again out/a.png" },
      ],
    },
    {
      name: "2 つのペインに出たら、カーソルに近い (新しい) 方が先",
      panes: [
        pane("%1", ["old out/a.png", "", "", "", "$"]),
        pane("%2", ["", "", "", "new out/a.png", "$"]),
      ],
      candidates: ["out/a.png"],
      expected: [
        { candidate: "out/a.png", pane: "%2", line: "new out/a.png" },
        { candidate: "out/a.png", pane: "%1", line: "old out/a.png" },
      ],
    },
    {
      name: "画面を消したペインの履歴の行より、ほかのペインの画面に見えている行が先",
      panes: [
        // 1 行目は履歴 (画面は 2 行目から)。カーソルのすぐ上でも古い。
        pane("%1", ["old out/a.png", "$"], 40, 1),
        pane("%2", ["new out/a.png", "", "", "", "$"]),
      ],
      candidates: ["out/a.png"],
      expected: [
        { candidate: "out/a.png", pane: "%2", line: "new out/a.png" },
        { candidate: "out/a.png", pane: "%1", line: "old out/a.png" },
      ],
    },
    {
      name: "ペインの幅で折り返したパスは 2 行を繋ぐ",
      panes: [pane("%1", ["see /tmp/abcdef", "gh.png ok", "$"], 15)],
      candidates: ["/tmp/abcdefgh.png"],
      expected: [
        {
          candidate: "/tmp/abcdefgh.png",
          pane: "%1",
          line: "see /tmp/abcdef gh.png ok",
        },
      ],
    },
    {
      name: "日本語の行もそのまま",
      panes: [pane("%1", ["画像を書き出しました: out/図.png", "$"])],
      candidates: ["out/図.png"],
      expected: [
        {
          candidate: "out/図.png",
          pane: "%1",
          line: "画像を書き出しました: out/図.png",
        },
      ],
    },
    {
      name: "どのペインにも無い候補は返さない",
      panes: [pane("%1", ["nothing here", "$"])],
      candidates: ["out/a.png"],
      expected: [],
    },
    {
      name: "候補の順に並べる",
      panes: [pane("%1", ["b.png", "a.png", "$"])],
      candidates: ["a.png", "b.png"],
      expected: [
        { candidate: "a.png", pane: "%1", line: "a.png" },
        { candidate: "b.png", pane: "%1", line: "b.png" },
      ],
    },
  ])("$name", ({ panes, candidates, expected }) => {
    expect(findSightings(panes, candidates)).toEqual(expected);
  });
});

/** このプロセスには無いシェル (tmux を触らずに確かめられる)。 */
const GONE_SHELL = "shell-abc123";

describe("/_agent/images/layout", () => {
  test("POST は受け付けない", async () => {
    const res = await callRoute(handleAgentRoute, "/_agent/images/layout", {
      method: "POST",
    });
    expect(res?.status).toBe(405);
  });

  test.each([
    { name: "shell が無い", query: "" },
    { name: "shell の形が違う", query: "?shell=%2512" },
  ])("$name ときは 400", async ({ query }) => {
    const res = await callRoute(
      handleAgentRoute,
      `/_agent/images/layout${query}`,
    );
    expect(res?.status).toBe(400);
  });

  test("tmux を映していないシェルは並び無し", async () => {
    const res = await callRoute(
      handleAgentRoute,
      `/_agent/images/layout?shell=${GONE_SHELL}`,
    );
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ layout: null });
  });
});

describe("/_agent/images/reveal", () => {
  const valid = { shell: GONE_SHELL, pane: "%1", text: "out/a.png" };

  test("GET は受け付けない", async () => {
    const res = await callRoute(handleAgentRoute, "/_agent/images/reveal");
    expect(res?.status).toBe(405);
  });

  test("別のオリジンからは通さない (利用者の tmux を動かす)", async () => {
    const res = await postRoute(
      handleAgentRoute,
      "/_agent/images/reveal",
      valid,
      () => false,
    );
    expect(res?.status).toBe(403);
  });

  test.each([
    { name: "shell の形が違う", body: { ...valid, shell: "%1" } },
    { name: "pane の形が違う", body: { ...valid, pane: "1" } },
    { name: "text が空", body: { ...valid, text: "  " } },
    {
      name: "text が長すぎる",
      body: { ...valid, text: "a".repeat(MAX_TERMINAL_REVEAL_TEXT + 1) },
    },
    { name: "text に制御文字", body: { ...valid, text: "a\u001b[2Jb" } },
    { name: "text が文字列でない", body: { ...valid, text: 1 } },
  ])("$name ときは 400 (tmux に渡さない)", async ({ body }) => {
    const res = await postRoute(
      handleAgentRoute,
      "/_agent/images/reveal",
      body,
    );
    expect(res?.status).toBe(400);
  });

  test("tmux を映していないシェルには 409 と理由", async () => {
    const res = await postRoute(
      handleAgentRoute,
      "/_agent/images/reveal",
      valid,
    );
    expect(res?.status).toBe(409);
    expect(await res?.text()).toContain("not showing tmux");
  });
});
