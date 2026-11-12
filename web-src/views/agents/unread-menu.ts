// エージェントの行の右クリックの「未読に戻す」(左のサイドバーと全体ボードで同じ)。
// 一度見た入力待ち・終わったものを、後で片付けるために手が要るものへ戻す。
// 作業中のもの・既に未読のもの・エージェントでないペインには出さない。

import type { AgentPane } from "../../core/agent-overview";
import { formatErrorDetail } from "../../core/error-detail";
import type { ContextMenuItem } from "../context-menu";
import { showAlertDialog } from "../ui-dialog";
import type { AgentMonitor } from "./agent-monitor";
import type { AgentsText } from "./i18n";

export function markUnreadMenuItems(
  pane: AgentPane,
  t: AgentsText,
  monitor: Pick<AgentMonitor, "markUnread" | "snapshot">,
): ContextMenuItem[] {
  if (pane.kind === null || pane.state === "working") return [];
  if (monitor.snapshot().unread.has(pane.id)) return [];
  return [
    {
      label: t.markUnread,
      title: t.markUnreadTitle,
      onSelect: () => {
        monitor.markUnread(pane.id).catch((error: unknown) => {
          console.error(
            `[code-viewer] could not mark ${pane.id} as unread`,
            error,
          );
          void showAlertDialog({
            title: t.markUnreadFailed,
            body: formatErrorDetail(error),
          });
        });
      },
    },
  ];
}
