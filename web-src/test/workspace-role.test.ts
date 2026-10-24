// 窓の役割 (core/workspace-role.ts) と、面の中で外す SP の @media。
//
// 電話の段かを読む所は views/shell/workspace.ts の phoneMediaQuery を通す。面の中では
// style.css の SP の @media を外す (index.html #pane-media) ので、TS 側だけが
// matchMedia(PHONE_MEDIA_QUERY) を直に読むと、面の中で CSS と TS の骨格が食い違う。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";
import {
  PHONE_MEDIA_QUERY,
  SOFT_KEYS_MEDIA_QUERY,
} from "../core/mobile-layout";
import { decideWorkspaceRole, embeddedMediaText } from "../core/workspace-role";

describe("decideWorkspaceRole", () => {
  test.each([
    {
      name: "host が置いた面の中は pane (SP の幅でも)",
      facts: { paneFrame: true, topLevel: false, phone: true },
      expected: "pane",
    },
    {
      name: "一番上のページで SP の幅でなければ host",
      facts: { paneFrame: false, topLevel: true, phone: false },
      expected: "host",
    },
    {
      name: "一番上のページでも SP の幅なら今までどおりの 1 枚",
      facts: { paneFrame: false, topLevel: true, phone: true },
      expected: "single",
    },
    {
      name: "ほかのページの中 (エディタの中のブラウザ) は 1 枚",
      facts: { paneFrame: false, topLevel: false, phone: false },
      expected: "single",
    },
  ] as const)("$name", ({ facts, expected }) => {
    expect(decideWorkspaceRole(facts)).toBe(expected);
  });
});

describe("embeddedMediaText", () => {
  test.each([
    {
      name: "SP の段の条件は全部外れて not all",
      media: PHONE_MEDIA_QUERY,
      expected: "not all",
    },
    {
      name: "指の画面の条件は残す (操作札の段)",
      media: SOFT_KEYS_MEDIA_QUERY,
      expected: "(pointer: coarse)",
    },
    {
      name: "境界: 幅 640 以下は外す",
      media: "(max-width: 640px)",
      expected: "not all",
    },
    {
      name: "境界: 幅 641 はデスクトップの区切りとして残す",
      media: "(max-width: 641px)",
      expected: "(max-width: 641px)",
    },
    {
      name: "境界: 高さ 500 以下は外す",
      media: "(pointer: coarse) and (max-height: 500px)",
      expected: "not all",
    },
    {
      name: "境界: 高さ 501 は残す",
      media: "(max-height: 501px)",
      expected: "(max-height: 501px)",
    },
    {
      name: "デスクトップの幅の区切りはそのまま",
      media: "(max-width: 1100px)",
      expected: "(max-width: 1100px)",
    },
    {
      name: "幅の条件の無いものはそのまま",
      media: "(prefers-color-scheme: dark)",
      expected: "(prefers-color-scheme: dark)",
    },
  ])("$name", ({ media, expected }) => {
    expect(embeddedMediaText(media)).toBe(expected);
  });
});

describe("電話の段かは phoneMediaQuery だけが読む", () => {
  const ROOT = "web-src";
  const ALLOWED = "web-src/views/shell/workspace.ts";
  const DIRECT = /matchMedia\??\.?\(\s*PHONE_MEDIA_QUERY/;

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory())
        return dir === ROOT && (name === "test" || name === "server")
          ? []
          : sources(full);
      return name.endsWith(".ts") ? [relative(".", full)] : [];
    });
  }

  test("matchMedia(PHONE_MEDIA_QUERY) は views/shell/workspace.ts の外に無い", () => {
    const offenders = sources(ROOT)
      .filter((file) => file !== ALLOWED)
      .filter((file) => DIRECT.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  test.each([
    { source: "window.matchMedia(PHONE_MEDIA_QUERY)", found: true },
    { source: "window.matchMedia?.(PHONE_MEDIA_QUERY).matches", found: true },
    { source: "phoneMediaQuery().matches", found: false },
  ])("検査の形: $source → $found", ({ source, found }) => {
    expect(DIRECT.test(source)).toBe(found);
  });
});
