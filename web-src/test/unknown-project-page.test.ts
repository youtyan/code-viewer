// 知らない鍵の案内ページの言語とテーマは、全プロジェクト共通の設定
// (`<状態>/settings.json` の language / theme) に合わせる。無ければ英語・ダーク
// (アプリの既定と同じ)。読めなければ英語・ダークで出し、読めない理由をページの末尾と console.error に
// 出す (隠さない)。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  readPageLook,
  unknownProjectPage,
} from "../server/entry/unknown-project-page";
import { withTempDir } from "./_test-helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

type Prepare = (path: string) => void;

const write =
  (text: string): Prepare =>
  (path) =>
    writeFileSync(path, text);

describe("unknown project page: language and theme from the shared settings", () => {
  test.each<{
    name: string;
    prepare: Prepare;
    lang: string;
    theme: string;
    heading: string;
    /** 末尾の理由の先頭 (理由の残りは一時ディレクトリのパスを含む)。null は出さない。 */
    failure: string | null;
  }>([
    {
      name: "Japanese and dark",
      prepare: write('{"version":1,"language":"ja","theme":"dark"}'),
      lang: "ja",
      theme: "dark",
      heading: "このプロジェクトは登録されていません",
      failure: null,
    },
    {
      name: "English and light",
      prepare: write('{"version":1,"language":"en","theme":"light"}'),
      lang: "en",
      theme: "light",
      heading: "This project is not registered",
      failure: null,
    },
    {
      name: "a dark palette other than violet",
      prepare: write('{"version":1,"theme":"graphite"}'),
      lang: "en",
      theme: "dark",
      heading: "This project is not registered",
      failure: null,
    },
    {
      name: "no settings file",
      prepare: () => undefined,
      lang: "en",
      theme: "dark",
      heading: "This project is not registered",
      failure: null,
    },
    {
      name: "settings without language and theme",
      prepare: write('{"version":1}'),
      lang: "en",
      theme: "dark",
      heading: "This project is not registered",
      failure: null,
    },
    {
      name: "broken settings (not JSON)",
      prepare: write("{"),
      lang: "en",
      theme: "dark",
      heading: "This project is not registered",
      failure:
        "settings could not be read: the settings shared by all projects (",
    },
    {
      name: "unreadable settings (a folder in its place)",
      prepare: (path) => mkdirSync(path),
      lang: "en",
      theme: "dark",
      heading: "This project is not registered",
      failure:
        "settings could not be read: cannot read the settings shared by all projects (",
    },
  ])("$name", async ({ prepare, lang, theme, heading, failure }) => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await withTempDir("unknown-project-page-", async (dir) => {
      const path = join(dir, "settings.json");
      prepare(path);
      const response = unknownProjectPage(
        "0123456789abcdef",
        readPageLook(path),
      );
      const html = await response.text();
      const footer =
        /<p class="settings-failure">([^<]*)<\/p>/.exec(html)?.[1] ?? null;
      expect([
        response.status,
        response.headers.get("content-type"),
        /<html lang="([^"]+)" data-theme="([^"]+)">/.exec(html)?.slice(1),
        html.includes(`<h1>${heading}</h1>`),
        html.includes('<a href="/agents">'),
        html.includes("code-viewer --cwd /path/to/repo"),
        footer === null ? null : footer.slice(0, failure?.length ?? 0),
        error.mock.calls.length,
      ]).toEqual([
        404,
        "text/html; charset=utf-8",
        [lang, theme],
        true,
        true,
        true,
        failure,
        failure === null ? 0 : 1,
      ]);
    });
  });

  test("the key and the reason are escaped", () => {
    const html = unknownProjectPage("<k>", {
      lang: "en",
      theme: "light",
      failure: "bad <tag>",
    });
    return html.text().then((text) => {
      expect([
        text.includes("<code>&lt;k&gt;</code>"),
        text.includes("settings could not be read: bad &lt;tag&gt;"),
      ]).toEqual([true, true]);
    });
  });
});
