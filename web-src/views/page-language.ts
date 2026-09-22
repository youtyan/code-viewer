// 画面の設定の言語。app.ts が設定から html の lang に置く (localizeViewerChrome)。
// 日時・相対時刻をブラウザの言語ではなくこの言語で出すために使う。
export function pageLanguage(): "en" | "ja" {
  return document.documentElement.lang === "ja" ? "ja" : "en";
}
