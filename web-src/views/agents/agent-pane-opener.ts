// エージェントのペインを開く入口 (1 か所)。通知・サイドバー・全体ボード・
// パレットが同じものを呼ぶ。別のプロジェクトのペインなら、そのプロジェクトへ
// 移り、移った先が `?open-pane=` で開く (行き先の判定は core/projects.ts の
// agentPaneTarget)。この画面のペインは openHere (タブで開く) に渡す。

import type {
  AgentOverviewResponse,
  AgentProjectInfo,
} from "../../core/agent-overview";
import { agentPaneTarget } from "../../core/projects";

export type AgentPaneOpenerDeps = {
  overview(): AgentOverviewResponse | null;
  /** 今の画面のアプリ内パス (移った先でも同じ画面にする)。 */
  currentPath(): string;
  /** そのプロジェクトへ移る (project-actions の open)。 */
  openProject(info: AgentProjectInfo, path: string): Promise<void>;
  /** この画面のタブで開く。opposite は反対の面。 */
  openHere(pane: string, destination?: "opposite"): void;
};

export function createAgentPaneOpener(
  deps: AgentPaneOpenerDeps,
): (pane: string, destination?: "opposite") => void {
  return (pane, destination) => {
    const target = agentPaneTarget(pane, deps.overview(), deps.currentPath());
    if (target.kind === "project") {
      void deps.openProject(target.info, target.path);
      return;
    }
    deps.openHere(pane, destination);
  };
}
