// 「別のアカウントで続ける…」の項目。エージェントの行 (左のサイドバー・
// 全体ボード) と、そのエージェントを映しているタブの右クリックのメニューが
// 同じものを出す。押すと起動の画面 (accounts-dialogs.ts の launch) を、
// 引き継ぎの形で開く。
//
// 次の担当に渡すのは、フックが知らせた会話記録の場所だけ
// (AgentPane.conversation)。フックが無い・まだ申告が来ていないペインでは
// 場所が分からないので押せなくし、フックの入れ方へ送る項目を並べる。

import { isAccountAgent } from "../../core/agent-accounts";
import type { AgentPane } from "../../core/agent-overview";
import type { ContextMenuItem } from "../context-menu";
import type { AgentsText } from "./i18n";

export type HandoffMenuActions = {
  /** 起動の画面を引き継ぎの形で開く。 */
  handoff(pane: AgentPane): void;
  /** フックの入れ方の案内へ。 */
  openHookHelp(): void;
};

/** 引き継げるか: claude / codex で、フックが会話記録の場所を知らせている。 */
export function canHandOff(pane: AgentPane): boolean {
  return isAccountAgent(pane.kind) && !!pane.conversation?.transcriptPath;
}

/**
 * メニューに足す項目 (先頭に区切り)。claude / codex でないペインには何も
 * 足さない (引き継ぐ相手がいない)。
 */
export function handoffMenuItems(
  pane: AgentPane,
  t: AgentsText,
  actions: HandoffMenuActions,
): ContextMenuItem[] {
  if (!isAccountAgent(pane.kind)) return [];
  if (canHandOff(pane)) {
    return [
      { kind: "separator" },
      {
        label: t.handoff,
        title: t.handoffTitle,
        onSelect: () => actions.handoff(pane),
      },
    ];
  }
  // 押せない項目にはツールチップが出ないブラウザがあるので、理由は次の
  // 項目の文字そのものに書く。
  return [
    { kind: "separator" },
    {
      label: t.handoff,
      title: t.handoffNeedsHooksTitle,
      disabled: true,
      onSelect: () => undefined,
    },
    {
      label: t.handoffNeedsHooks,
      title: t.handoffNeedsHooksTitle,
      onSelect: () => actions.openHookHelp(),
    },
  ];
}
