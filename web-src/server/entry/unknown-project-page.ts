// 知らない鍵の `/p/<鍵>/` の画面 (HTML) に返す案内。API (`/p/<鍵>/_…`) は
// 今までどおり 404 の JSON (server.ts の handleProjectPath)。
//
// 言語とテーマは全プロジェクト共通の設定 (`<状態>/settings.json`) に合わせる。
// テーマはアプリと同じく "light" 以外 (未設定・色違いのダーク) をダークにする。
// 無ければ英語・ダーク。読めなければ英語・ダークで出し、読めない理由をページの
// 末尾に小さく出す (console.error にも全部出す)。色はアプリの style.css を読まず
// ここに持つ (style.css はアプリの骨格を前提にする)。

import { escapeHtml } from "../../core/html-escape";
import { readUserSettings } from "../user-settings";

/** 登録済みのプロジェクトの一覧 (全体ボード)。入口が最後のプロジェクトへ送る。 */
export const PROJECT_LIST_PATH = "/agents";

export type PageLook = {
  lang: "en" | "ja";
  theme: "light" | "dark";
  /** 設定が読めなかった理由。読めた (または無かった) なら null。 */
  failure: string | null;
};

/** 設定から言語とテーマを決める。読めなければ英語・ダークと理由。 */
export function readPageLook(settingsPath: string): PageLook {
  try {
    const settings = readUserSettings(settingsPath);
    return {
      lang: settings?.language === "ja" ? "ja" : "en",
      theme: settings?.theme === "light" ? "light" : "dark",
      failure: null,
    };
  } catch (error) {
    console.error(
      "[code-viewer] entry: the page for an unknown project could not read the shared settings; showing it in English and dark",
      error,
    );
    // ページには理由の文だけ (元の原因の文を含む)。スタックは上の console.error。
    const failure = error instanceof Error ? error.message : String(error);
    return { lang: "en", theme: "dark", failure };
  }
}

const TEXT = {
  en: {
    title: "Project not registered · code-viewer",
    heading: "This project is not registered",
    body: (key: string) =>
      `No registered project has the key <code>${key}</code>. It may have been removed from the list, or the link came from another machine.`,
    list: "Open the registered projects",
    register: "To register a folder, run code-viewer in it:",
    or: "or <code>code-viewer --cwd /path/to/repo</code>. It is added to the running code-viewer and its URL is printed.",
  },
  ja: {
    title: "登録されていないプロジェクト · code-viewer",
    heading: "このプロジェクトは登録されていません",
    body: (key: string) =>
      `鍵 <code>${key}</code> の登録済みのプロジェクトはありません。一覧から外されたか、別のマシンのリンクです。`,
    list: "登録済みのプロジェクトを開く",
    register:
      "フォルダを登録するには、そのフォルダで code-viewer を起動します:",
    or: "または <code>code-viewer --cwd /path/to/repo</code>。動いている code-viewer に足され、URL が表示されます。",
  },
} as const;

export function unknownProjectPage(key: string, look: PageLook): Response {
  const t = TEXT[look.lang];
  const failure =
    look.failure === null
      ? ""
      : `\n<p class="settings-failure">settings could not be read: ${escapeHtml(look.failure)}</p>`;
  const html = `<!doctype html>
<html lang="${look.lang}" data-theme="${look.theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t.title}</title>
<style>
  :root { --fg: #1f2328; --fg-2: #59636e; --fg-3: #818b98; --bg: #ffffff; --inset: #f6f8fa; --accent: #6639ba; color-scheme: light; }
  :root[data-theme="dark"] { --fg: #e6edf3; --fg-2: #9198a1; --fg-3: #6e7681; --bg: #0d1117; --inset: #161b22; --accent: #a371f7; color-scheme: dark; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.6 system-ui, -apple-system, sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 64px 24px; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { margin: 8px 0; color: var(--fg-2); }
  a { color: var(--accent); }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  pre { background: var(--inset); padding: 8px 16px; border-radius: 6px; overflow-x: auto; }
  .settings-failure { margin-top: 40px; color: var(--fg-3); font-size: 12px; white-space: pre-wrap; }
</style>
</head>
<body>
<main>
<h1>${t.heading}</h1>
<p>${t.body(escapeHtml(key))}</p>
<p><a href="${PROJECT_LIST_PATH}">${t.list}</a></p>
<p>${t.register}</p>
<pre>cd /path/to/repo
code-viewer</pre>
<p>${t.or}</p>${failure}
</main>
</body>
</html>
`;
  return new Response(html, {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
