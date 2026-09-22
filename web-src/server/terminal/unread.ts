// 未読 (作業中 → 入力待ち・止まった、をまだ見ていないペイン) をサーバで覚える。
//
// 以前はタブのメモリにしか無く、読み直すと・プロジェクトを移る (= ページを
// 読み直す) と消えた。入口のサーバは 1 つでページより長く生きるので、ここに
// 持てば読み直しても残る。判定の規則は画面と同じ純関数 (nextAgentUnread) を
// 使い、一覧 (/_agent/overview) を作るたびに前回と比べる。
//
// 「見ている」かはサーバには分からないので、画面が見ているペインを
// POST /_agent/unread で解く (開いた・選んだ・前面で映している)。
//
// サーバのメモリだけ (状態の記録と同じ。agents.md 2)。再起動すると消える。

import {
  type AgentPane,
  type AgentTransition,
  type AgentUnreadEntry,
  nextAgentUnread,
} from "../../core/agent-overview";
import type { AgentState } from "../../core/agent-state";

let unread = new Map<string, AgentTransition>();
/** 前回の一覧の状態。最初の一覧の前は null (何も起きたことにしない)。 */
let previous: Map<string, AgentState> | null = null;

/** 今回の一覧を前回と比べて未読を進め、今の未読を返す。 */
export function noteAgentUnread(panes: AgentPane[]): AgentUnreadEntry[] {
  unread = nextAgentUnread(unread, previous, panes, () => false).unread;
  previous = new Map(panes.map((pane) => [pane.id, pane.state]));
  return [...unread].map(([pane, transition]) => ({ pane, transition }));
}

/** 見た・開いた。解いたら true。 */
export function clearAgentUnread(target: string): boolean {
  return unread.delete(target);
}

export function resetAgentUnreadForTest(): void {
  unread = new Map();
  previous = null;
}
