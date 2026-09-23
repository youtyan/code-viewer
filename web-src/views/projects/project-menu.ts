// プロジェクトの「⋯」のメニュー (登録・名前・色・並べ替え・外す・サーバを止める)。
// エージェントの全体ボードの見出しと、左のサイドバーのプロジェクトの行 (⋯ と
// 見出しの右クリック・電話の長押し) が同じものを開く (項目と押せる条件を 1 か所で
// 決める)。

import type { AgentProjectInfo } from "../../core/agent-overview";
import { PROJECT_COLORS } from "../../core/project-colors";
import { canStopProjectServer } from "../../core/projects";
import { type ContextMenuItem, showContextMenu } from "../context-menu";
import type { ProjectActions } from "./project-actions";
import { projectLook, projectMark } from "./project-looks";
import type { ProjectsText } from "./projects-i18n";

export function showProjectMenu(
  anchor: HTMLElement,
  info: AgentProjectInfo,
  options: {
    actions: ProjectActions;
    text: ProjectsText;
    /** 登録しているプロジェクトの数 (「下へ」を押せるかに使う)。 */
    registeredCount: number;
    /** 右クリックで開くときのポインタの位置 (無ければ anchor の下)。 */
    at?: { x: number; y: number };
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
        label: t.color,
        title: t.colorTitle,
        // この click が文書まで届いてから開く。リポジトリの画面は文書の click で
        // 開いているメニューを全部閉じる (repo-view.ts の closeRepoContextMenu)
        // ので、同じ click の中で開くとすぐ閉じられる。
        onSelect: () => {
          window.setTimeout(() => showColorMenu(anchor, info, options), 0);
        },
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
  showContextMenu(anchor, items, { at: options.at });
}

/**
 * 色の一覧。メニューの「色…」を押すと、同じ場所にこれを開き直す (入れ子の
 * メニューは作らない)。各行にそのプロジェクトの頭文字を載せた四角を出し、
 * 選んだときの見た目がそのまま分かるようにする。
 */
function showColorMenu(
  anchor: HTMLElement,
  info: AgentProjectInfo,
  options: {
    actions: ProjectActions;
    text: ProjectsText;
    at?: { x: number; y: number };
  },
): void {
  const registered = info.registered;
  if (!registered) return;
  const look = projectLook(info);
  const items: ContextMenuItem[] = PROJECT_COLORS.map((color) => ({
    label: options.text.colorNames[color],
    leading: projectMark({ ...look, color }),
    checked: registered.color === color,
    onSelect: () => void options.actions.recolor(info, color),
  }));
  showContextMenu(anchor, items, { at: options.at });
}
