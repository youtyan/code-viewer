import { describe, expect, test } from "vitest";
import {
  fileSignatureUnchanged,
  rawFileInfoSignature,
} from "../core/file-refresh";
import type { RawFileInfo } from "../core/types";

describe("rawFileInfoSignature", () => {
  test.each<{ name: string; info: RawFileInfo; expected: string | null }>([
    {
      name: "全フィールド欠落 (取得失敗 / 中断) は署名にならない",
      info: {},
      expected: null,
    },
    {
      name: "404 はファイル削除という確定状態として署名になる",
      info: { missing: true },
      expected: "missing",
    },
    {
      name: "worktree ファイル (size + mtime)",
      info: { size: 120, updated_at: "2026-08-18T00:00:00.000Z" },
      expected: "120|2026-08-18T00:00:00.000Z|",
    },
    {
      name: "ref 上のファイル (size + commit date)",
      info: {
        size: 8,
        updated_at: "2026-08-01T00:00:00.000Z",
        commit_updated_at: "2026-08-01T00:00:00.000Z",
      },
      expected: "8|2026-08-01T00:00:00.000Z|2026-08-01T00:00:00.000Z",
    },
    {
      name: "空ファイル (size 0) は欠落ではなく状態",
      info: { size: 0 },
      expected: "0||",
    },
    {
      name: "size 無しでも更新時刻があれば署名になる",
      info: { updated_at: "2026-08-18T09:00:00.000Z" },
      expected: "|2026-08-18T09:00:00.000Z|",
    },
  ])("$name", ({ info, expected }) => {
    expect(rawFileInfoSignature(info)).toBe(expected);
  });
});

describe("fileSignatureUnchanged", () => {
  const stored = { key: "blob\0src/a.ts\0worktree", sig: "10|t1|" };

  test.each<{
    name: string;
    stored: { key: string; sig: string } | null;
    key: string;
    sig: string;
    expected: boolean;
  }>([
    {
      name: "キーと署名が完全一致したときだけ変化なし",
      stored,
      key: stored.key,
      sig: stored.sig,
      expected: true,
    },
    {
      name: "署名が動いたら変化あり",
      stored,
      key: stored.key,
      sig: "11|t2|",
      expected: false,
    },
    {
      name: "別ファイル / 別ビューのキーは変化あり扱い",
      stored,
      key: "blame\0src/a.ts\0worktree",
      sig: stored.sig,
      expected: false,
    },
    {
      name: "未観測 (stored なし) は変化あり扱い",
      stored: null,
      key: stored.key,
      sig: stored.sig,
      expected: false,
    },
  ])("$name", ({ stored, key, sig, expected }) => {
    expect(fileSignatureUnchanged(stored, key, sig)).toBe(expected);
  });
});
