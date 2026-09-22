import { describe, expect, test } from "vitest";
import { listColumnWidth } from "../core/list-column";

// 一覧の列の 2 段の幅 (core/list-column.ts)。本文 = room − 一覧の列 − inset。
// 本文が need に足りなければ詰めた幅。利用者の幅が詰めた幅以下なら詰めない。
describe("listColumnWidth", () => {
  test.each([
    // 1 面の History (inset = 変更ファイルの木 240、need 480)
    {
      room: 972,
      preferred: 320,
      inset: 240,
      need: 480,
      width: 240,
      compact: true,
    },
    {
      room: 1040,
      preferred: 320,
      inset: 240,
      need: 480,
      width: 320,
      compact: false,
    },
    {
      room: 1039,
      preferred: 320,
      inset: 240,
      need: 480,
      width: 240,
      compact: true,
    },
    // 1 面の Diff (inset 0)
    {
      room: 800,
      preferred: 320,
      inset: 0,
      need: 480,
      width: 320,
      compact: false,
    },
    {
      room: 799,
      preferred: 320,
      inset: 0,
      need: 480,
      width: 240,
      compact: true,
    },
    // 2 面 (need 961)
    {
      room: 1281,
      preferred: 320,
      inset: 0,
      need: 961,
      width: 320,
      compact: false,
    },
    {
      room: 1280,
      preferred: 320,
      inset: 0,
      need: 961,
      width: 240,
      compact: true,
    },
    // 詰めても足りなくても詰めた幅 (その先は 2 面なら右の面を預ける)
    {
      room: 600,
      preferred: 320,
      inset: 0,
      need: 961,
      width: 240,
      compact: true,
    },
    // 利用者が広げた幅
    {
      room: 1400,
      preferred: 560,
      inset: 240,
      need: 480,
      width: 560,
      compact: false,
    },
    {
      room: 1279,
      preferred: 560,
      inset: 240,
      need: 480,
      width: 240,
      compact: true,
    },
    // 利用者の幅が詰めた幅と同じ
    {
      room: 500,
      preferred: 240,
      inset: 240,
      need: 480,
      width: 240,
      compact: false,
    },
  ])("room $room・利用者 $preferred・inset $inset・need $need → $width", ({
    room,
    preferred,
    inset,
    need,
    width,
    compact,
  }) => {
    expect(
      listColumnWidth({ room, preferred, compact: 240, inset, need }),
    ).toEqual({ width, compact });
  });
});
