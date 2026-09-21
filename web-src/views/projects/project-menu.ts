// プロジェクトの「⋯」のメニュー (登録・名前・並べ替え・外す・サーバを止める)。
// エージェントの全体ボードの見出しと、左のサイドバーのプロジェクトの行が
// 同じものを開く (項目と押せる条件を 1 か所で決める)。

import type { AgentProjectInfo } from "../../core/agent-overview";
import { canStopProjectServer } from "../../core/projects";
import { type ContextMenuItem, showContextMenu } from "../context-menu";
import type { ProjectActions } from "./project-actions";
import type { ProjectsText } from "./projects-i18n";

export function showProjectMenu(
  anchor: HTMLElement,
  info: AgentProjectInfo,
  options: {
    actions: ProjectActions;
    text: ProjectsText;
    /** 登録しているプロジェクトの数 (「下へ」を押せるかに使う)。 */
    registeredCount: number;
  },
): void {
  const { actions, text: t } = options;
  const registered = info.registered;
  const items: ContextMenuItem[] = [];
  if (!registered) {
    items.push({
      label: t.register,
      title: t.registerTitle,
      disabled: !info.git,
      onSelect: () => void actions.registerRoot(info.root),
    });
  } else {
    const last = options.registeredCount - 1;
    items.push(
      {
        label: t.rename,
        onSelect: () => void actions.rename(info),
      },
      {
        label: t.moveUp,
        disabled: registered.order <= 0,
        onSelect: () => void actions.move(info, -1),
      },
      {
        label: t.moveDown,
        disabled: registered.order >= last,
        onSelect: () => void actions.move(info, 1),
      },
      {
        label: t.unregister,
        title: t.unregisterTitle,
        onSelect: () => void actions.unregister(info),
      },
    );
  }
  const stoppable = canStopProjectServer(info.server);
  items.push(
    { kind: "separator" },
    {
      label: t.stopServer,
      title: stoppable ? t.stopServerTitle : t.stopServerNotLaunched,
      danger: true,
      disabled: !stoppable,
      onSelect: () => void actions.stop(info),
    },
  );
  showContextMenu(anchor, items);
}
