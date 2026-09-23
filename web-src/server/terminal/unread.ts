// 未読 (作業中 → 入力待ち・止まった、をまだ見ていないペイン) をサーバで覚える。
//
// 以前はタブのメモリにしか無く、読み直すと・プロジェクトを移る (= ページを
// 読み直す) と消えた。入口のサーバは 1 つでページより長く生きるので、ここに
// 持てば読み直しても残る。判定の規則は画面と同じ純関数 (agentTransition) で、
// 状態の記録が変わった瞬間 (agent-state.ts の recordAgentState) に進める。
// 以前は一覧 (/_agent/overview) を作るたびに前回と比べていたが、一覧を
// 取りに来るのが背面のタブ (ブラウザが取り直しを十数秒まで間引く) だけだと、
// 短い作業中を見ないまま入力待ちになり、未読も通知も付かなかった。
//
// 「見ている」かはサーバには分からないので、画面が見ているペインを
// POST /_agent/unread で解く (開いた・選んだ・前面で映している)。
//
// サーバのメモリだけ (状態の記録と同じ。agents.md 2)。再起動すると消える。

import {
  type AgentPane,
  type AgentTransition,
  type AgentUnreadEntry,
  agentTransition,
} from "../../core/agent-overview";
import type { AgentState } from "../../core/agent-state";
import { agentTargetKey } from "./agent-state";

let unread = new Map<string, AgentTransition>();

/**
 * 状態の記録が from から to に変わった (key は agentTargetKey)。最初の記録
 * (from が undefined) は何が変わったか分からないので未読にしない。作業を
 * 始め直したら解く。
 */
export function noteAgentStateChange(
  key: string,
  from: AgentState | undefined,
  to: AgentState,
): void {
  const transition = agentTransition(from, to);
  if (transition) unread.set(key, transition);
  else if (to === "working") unread.delete(key);
}

/** 今の未読。一覧に居ないペイン・エージェントでないペインの分は捨てる。 */
export function noteAgentUnread(panes: AgentPane[]): AgentUnreadEntry[] {
  const agents = new Set(
    panes
      .filter((pane) => pane.kind !== null)
      .map((pane) => agentTargetKey(pane.id)),
  );
  for (const key of unread.keys()) if (!agents.has(key)) unread.delete(key);
  return panes.flatMap((pane) => {
    const transition = unread.get(agentTargetKey(pane.id));
    return transition ? [{ pane: pane.id, transition }] : [];
  });
}

/** 見た・開いた。解いたら true。 */
export function clearAgentUnread(target: string): boolean {
  return unread.delete(agentTargetKey(target));
}

export function resetAgentUnread(): void {
  unread = new Map();
}
