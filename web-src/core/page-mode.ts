// 画面 (route) ごとに body に付ける印 (app.ts の setPageMode が当てる)。CSS は
// この印で画面の並び (上の帯の有無・右の列に Files の木を出すか) を決める。
//
// index.html の body の頭の早いスクリプト (#first-screen) も、同じ印を URL から
// 付けて最初の描画から場所を取る (JS の後に並びが変わると大きく動く)。その
// スクリプトが付ける印がここと同じであることは web-src/test/first-screen.test.ts
// が URL の表で確かめる。

import type { AppRoute } from "./routes";

/** setPageMode が付け外しする印の全部。 */
export const PAGE_MODE_CLASSES = [
  "gdp-file-detail-page",
  "gdp-repo-blob-page",
  "gdp-repo-page",
  "gdp-diff-page",
  "gdp-help-page",
  "gdp-history-page",
  "gdp-file-history-page",
  "gdp-database-page",
  "gdp-journal-page",
  "gdp-worktree-page",
  "gdp-agents-page",
  "gdp-tools-page",
  "gdp-search-page",
  "gdp-files-column-page",
] as const;

export type PageModeClass = (typeof PAGE_MODE_CLASSES)[number];

/**
 * その route で付ける印。hostedSourceOpen は History の画面の中でファイルを開いて
 * いる (「View File」。上の帯と差分のカードが消える) とき。
 */
export function pageModeClasses(
  route: AppRoute,
  hostedSourceOpen: boolean,
): Set<PageModeClass> {
  const on = new Set<PageModeClass>();
  const file = route.screen === "file" ? route : null;
  if (file || hostedSourceOpen) on.add("gdp-file-detail-page");
  if (
    file &&
    (file.view === "blob" || file.view === "blame" || file.view === "history")
  )
    on.add("gdp-repo-blob-page");
  if (file?.view === "history") on.add("gdp-file-history-page");
  const byScreen: Partial<Record<AppRoute["screen"], PageModeClass>> = {
    repo: "gdp-repo-page",
    diff: "gdp-diff-page",
    help: "gdp-help-page",
    history: "gdp-history-page",
    database: "gdp-database-page",
    journal: "gdp-journal-page",
    worktree: "gdp-worktree-page",
    agents: "gdp-agents-page",
    tools: "gdp-tools-page",
    search: "gdp-search-page",
  };
  const page = byScreen[route.screen];
  if (page) on.add(page);
  // 右の列: 自分の一覧を持たない画面は Files の木を出す (History・選んでいる
  // Worktrees は一覧パネル、repo / file / diff は #sidebar の自分の一覧)。
  if (
    route.screen === "journal" ||
    route.screen === "agents" ||
    route.screen === "tools" ||
    route.screen === "search" ||
    route.screen === "help" ||
    route.screen === "database" ||
    (route.screen === "worktree" && !route.wt)
  )
    on.add("gdp-files-column-page");
  return on;
}
