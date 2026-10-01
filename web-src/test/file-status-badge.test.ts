// ファイル一覧の印 (Files のツリー・フォルダ表示・変更ファイルが使う fileBadge)。
// マージの衝突は C で、未追跡 (U) と読み分けられる名前を両方の言語で持つ。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, expect, test } from "vitest";
import { fileStatusBadge } from "../views/diff-view";
import { DIFF_SCREEN_TEXT } from "../views/diff-view-i18n";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

test.each([
  {
    name: "a conflict in English",
    lang: "en",
    status: "C",
    expected: {
      className: "badge C",
      text: "C",
      title: "conflicted (merge conflict)",
    },
  },
  {
    name: "a conflict in Japanese",
    lang: "ja",
    status: "C",
    expected: {
      className: "badge C",
      text: "C",
      title: "衝突（マージの衝突）",
    },
  },
  {
    name: "an untracked file in English",
    lang: "en",
    status: "U",
    expected: { className: "badge U", text: "U", title: "untracked" },
  },
  {
    name: "an untracked file in Japanese",
    lang: "ja",
    status: "U",
    expected: { className: "badge U", text: "U", title: "未追跡" },
  },
  {
    name: "no status reads as modified",
    lang: "en",
    status: undefined,
    expected: { className: "badge M", text: "M", title: "modified" },
  },
  {
    name: "an unknown letter keeps the letter as its title",
    lang: "en",
    status: "X",
    expected: { className: "badge X", text: "X", title: "X" },
  },
] as const)("$name", ({ lang, status, expected }) => {
  const badge = fileStatusBadge(status, DIFF_SCREEN_TEXT[lang].fileStatus);
  expect({
    className: badge.className,
    text: badge.textContent,
    title: badge.title,
  }).toEqual(expected);
});
