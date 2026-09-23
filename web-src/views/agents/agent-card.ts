// エージェントの行の中身 (左のサイドバーと全体ボードで同じもの)。2 行組のカード:
//
//   ◆ Review plan  [Needs input]          •     ← 状態の印・名前 (太め)・札・未読の点
//     claude · 3m · feature-login                ← 補足 (小さく薄い字)
//
// 名前は作業の要約。無ければ種類 (claude / codex)。補足は種類 (名前が要約の
// とき)・状態の語・経過時間・作業ツリー。札は「いま見るべきもの」だけ: 見ていない
// 間に入力待ちになった・終わった (未読)。札があるときは状態の語を補足に繰り返さ
// ない。補足の後ろに呼び出し側の項目 (全体ボードのアカウント・tmux の場所) を
// 足せる。押したとき・キー・未読を読んだ扱いは呼び出し側 (行の作り方は場所ごとに
// 違う) が持つ。

import {
  type AgentPane,
  type AgentTransition,
  paneTaskSummary,
} from "../../core/agent-overview";
import type { AgentsText } from "./i18n";
import { paneText } from "./pane-text";

export function agentStateMark(state: AgentPane["state"]): HTMLElement {
  const mark = document.createElement("i");
  mark.className = `terminal-mark terminal-mark-${state}`;
  mark.setAttribute("aria-hidden", "true");
  return mark;
}

/**
 * 経過時間。変わった瞬間を見たものだけ時間を出す。それ以外は「–」にして、
 * 分かっている下限だけを title に書く。
 */
export function agentAge(
  pane: AgentPane,
  text: AgentsText,
): { text: string; title: string } {
  if (pane.updatedAt > 0) {
    return { text: text.elapsed(Date.now() - pane.updatedAt), title: "" };
  }
  const watched = pane.watchedSince > 0 ? Date.now() - pane.watchedSince : 0;
  return {
    text: text.elapsedUnknown,
    title:
      watched >= 60_000
        ? text.elapsedAtLeast(text.elapsed(watched))
        : text.elapsedJustWatched,
  };
}

export type AgentCardParts = {
  /** 1 行目の名前 (読み上げの名前に使う)。 */
  name: string;
  /** 経過時間の下限の説明 (時刻を断定しないとき)。無ければ空。 */
  ageTitle: string;
};

/** row の中身をカードにする。row の class・属性・イベントは呼び出し側。 */
export function fillAgentCard(
  row: HTMLElement,
  pane: AgentPane,
  text: AgentsText,
  unread: AgentTransition | undefined,
  extra: readonly HTMLElement[] = [],
): AgentCardParts {
  const shown = paneText(pane, text);
  const hasTask = paneTaskSummary(pane) !== null;
  const name = hasTask ? shown.summary : shown.kind;

  const head = document.createElement("span");
  head.className = "agent-card-head";
  const title = document.createElement("span");
  title.className = "agent-card-name";
  title.textContent = name;
  head.appendChild(title);
  if (unread) {
    const badge = document.createElement("span");
    badge.className = `agent-card-badge agent-card-badge-${unread}`;
    badge.textContent = text.cardBadge[unread];
    head.appendChild(badge);
  }

  const age = agentAge(pane, text);
  const ageItem = document.createElement("span");
  ageItem.className = "agent-card-age";
  ageItem.textContent = age.text;
  if (age.title) ageItem.title = age.title;
  const items: HTMLElement[] = [];
  const word = (className: string, value: string) => {
    const item = document.createElement("span");
    item.className = className;
    item.textContent = value;
    return item;
  };
  if (hasTask) items.push(word("agent-card-kind", shown.kind));
  if (!unread) items.push(word("agent-card-state", text.state[pane.state]));
  items.push(ageItem);
  if (pane.worktree) {
    const worktree = word("agent-card-worktree", pane.worktree);
    worktree.title = text.worktreeTitle(pane.worktree);
    items.push(worktree);
  }
  items.push(...extra.filter((item) => item.textContent));
  const meta = document.createElement("span");
  meta.className = "agent-card-meta";
  items.forEach((item, index) => {
    if (index > 0) meta.append(" · ");
    meta.appendChild(item);
  });

  const dot = document.createElement("span");
  dot.className = "agent-card-unread";
  dot.setAttribute("aria-hidden", "true");

  row.classList.add("agent-card");
  row.append(agentStateMark(pane.state), head, meta, dot);
  return { name, ageTitle: age.title };
}
