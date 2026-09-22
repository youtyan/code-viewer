// 知らない鍵の `/p/<鍵>/` の画面 (HTML) に返す案内。API (`/p/<鍵>/_…`) は
// 今までどおり 404 の JSON (server.ts の handleProjectPath)。
//
// 表示言語の設定は読まずに英語と日本語を並べる: 設定が読めないときの分岐を
// この案内のために持たない。色は利用者の OS の明暗に合わせるだけ (アプリの
// style.css はアプリの骨格を前提にするので読まない)。

import { escapeHtml } from "../../core/html-escape";

/** 登録済みのプロジェクトの一覧 (全体ボード)。入口が最後のプロジェクトへ送る。 */
export const PROJECT_LIST_PATH = "/agents";

export function unknownProjectPage(key: string): Response {
  const shown = escapeHtml(key);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Project not registered · code-viewer</title>
<style>
  :root { color-scheme: light dark; --fg: #1f2328; --fg-2: #59636e; --bg: #ffffff; --inset: #f6f8fa; --accent: #6639ba; }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #e6edf3; --fg-2: #9198a1; --bg: #0d1117; --inset: #161b22; --accent: #a371f7; }
  }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.6 system-ui, -apple-system, sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 64px 24px; }
  section + section { margin-top: 40px; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { margin: 8px 0; color: var(--fg-2); }
  a { color: var(--accent); }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  pre { background: var(--inset); padding: 8px 16px; border-radius: 6px; overflow-x: auto; }
</style>
</head>
<body>
<main>
<section lang="en">
<h1>This project is not registered</h1>
<p>No registered project has the key <code>${shown}</code>. It may have been removed from the list, or the link came from another machine.</p>
<p><a href="${PROJECT_LIST_PATH}">Open the registered projects</a></p>
<p>To register a folder, run code-viewer in it:</p>
<pre>cd /path/to/repo
code-viewer</pre>
<p>or <code>code-viewer --cwd /path/to/repo</code>. It is added to the running code-viewer and its URL is printed.</p>
</section>
<section lang="ja">
<h1>このプロジェクトは登録されていません</h1>
<p>鍵 <code>${shown}</code> の登録済みのプロジェクトはありません。一覧から外されたか、別のマシンのリンクです。</p>
<p><a href="${PROJECT_LIST_PATH}">登録済みのプロジェクトを開く</a></p>
<p>フォルダを登録するには、そのフォルダで code-viewer を起動します:</p>
<pre>cd /path/to/repo
code-viewer</pre>
<p>または <code>code-viewer --cwd /path/to/repo</code>。動いている code-viewer に足され、URL が表示されます。</p>
</section>
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
