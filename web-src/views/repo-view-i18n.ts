// The folder view is rebuilt on every load, so it does not need a localize
// hook. The next render reads STATE.language again.

export type RepoViewLanguage = "en" | "ja";

export type RepoViewText = {
  copyPathFailed: (detail: string) => string;
  readmeRenderFailed: string;
};

const EN: RepoViewText = {
  copyPathFailed: (detail) => `Could not copy the folder path\n${detail}`,
  readmeRenderFailed:
    "Could not render the Markdown, so the raw text is shown.",
};

const JA: RepoViewText = {
  copyPathFailed: (detail) =>
    `フォルダのパスをコピーできませんでした\n${detail}`,
  readmeRenderFailed:
    "Markdown を描画できなかったので、元の文字を表示しています。",
};

export function repoViewText(language: RepoViewLanguage): RepoViewText {
  return language === "ja" ? JA : EN;
}
