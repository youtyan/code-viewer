// プロジェクトが「起動中」か「停止中」か。左のサイドバー・エージェントの全体
// ボード・切替の小窓 (p) が同じ判定で一覧を分ける。
//
// 登録したプロジェクトが増えると、エージェントも居ない・開いてもいないものが
// 長く続き、いま使っているものが見つからない。起動中のものを上に、停止中の
// ものを下 (畳める所) に分ける。並びそのもの (登録の順) は変えない。
//
// 起動中 = 次のどれか。
// - エージェントのペインが居る (エージェントでないペインは数えない。一覧の行と
//   同じ数え方)
// - ブラウザのシェルが居る。ペインを映しているシェルはそのペインのプロジェクト、
//   それ以外は起こした場所を含む一番近い根 (タブのグループと同じ決め方)
// - 裏のプロセスが動いている・いま見ている・確かめられなかった (問題の印を
//   畳んだ中に隠さない)
// - 起こしている最中 (応答には無く、画面が持っている。extraRoots で渡す)

import type { AgentOverviewResponse } from "./agent-overview";
import { projectRootOfPath } from "./terminal-tab-name";

/** 裏のプロセスの状態のうち、起動中に数えるもの。 */
const RUNNING_SERVER_STATUSES: ReadonlySet<string> = new Set([
  "current",
  "running",
  "unreachable",
  "invalid",
]);

/** 起動中のプロジェクトの根。 */
export function runningProjectRoots(
  overview: Pick<AgentOverviewResponse, "panes" | "projects" | "shells">,
  extraRoots: Iterable<string> = [],
): Set<string> {
  const running = new Set<string>(extraRoots);
  for (const info of overview.projects) {
    if (RUNNING_SERVER_STATUSES.has(info.server.status)) running.add(info.root);
  }
  const paneProjectByShell = new Map<string, string>();
  for (const pane of overview.panes) {
    if (pane.shownInShell)
      paneProjectByShell.set(pane.shownInShell, pane.project);
    if (pane.kind !== null && pane.project) running.add(pane.project);
  }
  const roots = overview.projects.map((info) => info.root);
  for (const shell of overview.shells ?? []) {
    const root =
      paneProjectByShell.get(shell.id) ??
      (shell.cwd ? projectRootOfPath(shell.cwd, roots) : null);
    if (root) running.add(root);
  }
  return running;
}

/** 起動中と停止中に分ける。それぞれの中は渡した順のまま。 */
export function partitionProjectsByRunning<T>(
  items: readonly T[],
  rootOf: (item: T) => string,
  running: ReadonlySet<string>,
): { running: T[]; stopped: T[] } {
  const result: { running: T[]; stopped: T[] } = { running: [], stopped: [] };
  for (const item of items) {
    (running.has(rootOf(item)) ? result.running : result.stopped).push(item);
  }
  return result;
}
