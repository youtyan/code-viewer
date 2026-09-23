// 画面のファイル (index.html・style.css・app.js・遅延バンドル・vendor) を配る。
// 1 つで完結するサーバ (preview.ts) と入口のサーバ (entry/) が同じ表を使う。

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_ENTRY_PATHS, SPA_PATHS } from "../core/routes";
import { ROOT } from "./root";

export const WEB_ROOT = join(ROOT, "web");

/** 画面の入口 (index.html を返す経路)。 */
export function isAppEntryPath(pathname: string): boolean {
  return (
    (APP_ENTRY_PATHS as readonly string[]).includes(pathname) ||
    (SPA_PATHS as readonly string[]).includes(pathname)
  );
}

const STATIC_FILES: Record<string, readonly [string, string]> = {
  "/favicon.png": ["favicon.png", "image/png"],
  // インストールした窓 (PWA) の名前・アイコン・色。入口の下 (/p/<鍵>/) の画面も
  // 根のこの経路を読む (index.html の link が絶対パス)。
  "/manifest.webmanifest": [
    "manifest.webmanifest",
    "application/manifest+json; charset=utf-8",
  ],
  "/icons/icon-192.png": ["icons/icon-192.png", "image/png"],
  "/icons/icon-512.png": ["icons/icon-512.png", "image/png"],
  "/icons/icon-maskable-192.png": ["icons/icon-maskable-192.png", "image/png"],
  "/icons/icon-maskable-512.png": ["icons/icon-maskable-512.png", "image/png"],
  "/icons/apple-touch-icon.png": ["icons/apple-touch-icon.png", "image/png"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "application/javascript; charset=utf-8"],
  "/mermaid.js": ["mermaid.js", "application/javascript; charset=utf-8"],
  "/shiki.js": ["shiki.js", "application/javascript; charset=utf-8"],
  "/yaml.js": ["yaml.js", "application/javascript; charset=utf-8"],
  "/xterm.js": ["xterm.js", "application/javascript; charset=utf-8"],
  "/vendor/xterm/xterm.css": [
    "vendor/xterm/xterm.css",
    "text/css; charset=utf-8",
  ],
  "/vendor/diff2html/diff2html.min.css": [
    "vendor/diff2html/diff2html.min.css",
    "text/css; charset=utf-8",
  ],
  "/vendor/diff2html/diff2html-ui.min.js": [
    "vendor/diff2html/diff2html-ui.min.js",
    "application/javascript; charset=utf-8",
  ],
  "/vendor/highlight.js/highlight.min.js": [
    "vendor/highlight.js/highlight.min.js",
    "application/javascript; charset=utf-8",
  ],
  "/vendor/highlight.js/styles/github.min.css": [
    "vendor/highlight.js/styles/github.min.css",
    "text/css; charset=utf-8",
  ],
  "/vendor/highlight.js/styles/github-dark.min.css": [
    "vendor/highlight.js/styles/github-dark.min.css",
    "text/css; charset=utf-8",
  ],
};

const STATIC_FILE_MAP = new Map(Object.entries(STATIC_FILES));

/** その経路で配るファイル (`web/` からの相対) と Content-Type。無ければ null。 */
export function staticFileSpec(
  pathname: string,
): readonly [string, string] | null {
  if (isAppEntryPath(pathname))
    return ["index.html", "text/html; charset=utf-8"];
  return STATIC_FILE_MAP.get(pathname) ?? null;
}

export function staticFile(pathname: string): Response | null {
  const spec = staticFileSpec(pathname);
  if (!spec) return null;
  const full = join(WEB_ROOT, spec[0]);
  if (!existsSync(full)) {
    return new Response("not found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
  return new Response(readFileSync(full), {
    headers: { "Content-Type": spec[1], "Cache-Control": "no-store" },
  });
}
