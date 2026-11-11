// 全体ボードの「上に留める」をサーバのメモリで覚える。
//
// 以前は全体ボードの画面のメモリにしか無く、読み直す・プロジェクトを移る・別の
// 窓や電話で開くと消えた。入口のサーバは 1 つでページより長く生きるので、未読
// (unread.ts) と同じくここに持てば、どの窓でも同じピンが見える。
//
// 鍵は tmux の世代 + ペイン ID (agentTargetKey)。tmux を起こし直すとペイン ID が
// 再利用されるので、世代が変われば別のペインとして外れる。一覧から消えた
// ペイン (終わった) のピンは一覧を作るときに外す (ペインと一緒に消える)。
// 保存はしない: サーバを起こし直すと消える (状態ディレクトリに置くほどの値ではない)。

import type { AgentPane } from "../../core/agent-overview";
import type { TmuxPaneId } from "../../core/tmux";
import { agentTargetKey } from "./agent-state";

let pinned = new Set<string>();

/** 留める・外す。 */
export function setAgentPinned(target: string, on: boolean): void {
  const key = agentTargetKey(target);
  if (on) pinned.add(key);
  else pinned.delete(key);
}

/** 今の一覧で留めているペイン。一覧に居ないペインのピンは外す。 */
export function noteAgentPins(panes: AgentPane[]): TmuxPaneId[] {
  const listed = new Set(panes.map((pane) => agentTargetKey(pane.id)));
  for (const key of [...pinned]) if (!listed.has(key)) pinned.delete(key);
  return panes
    .filter((pane) => pinned.has(agentTargetKey(pane.id)))
    .map((pane) => pane.id);
}

export function resetAgentPins(): void {
  pinned = new Set();
}
