// この窓の役割 (core/workspace-role.ts) を、index.html の早いスクリプトが付けた
// html[data-workspace] から読む。

import { PHONE_MEDIA_QUERY } from "../../core/mobile-layout";
import type { WorkspaceRole } from "../../core/workspace-role";

export function workspaceRole(): WorkspaceRole {
  const role = document.documentElement.dataset.workspace;
  if (role === "host" || role === "pane" || role === "single") return role;
  // 早いスクリプトを通らない文書 (テストの happy-dom) は今までどおりの 1 枚。
  if (role === undefined) return "single";
  throw new Error(`unknown workspace role ${JSON.stringify(role)}`);
}

/**
 * 電話の段の media query。外側のページと面の中では電話の段に入らない (面の幅は
 * 窓の幅ではなく、狭い面は電話ではない。style.css の SP の @media も index.html の
 * #pane-media が外す)。電話の段かを読む所はここを通す
 * (web-src/test/workspace-role.test.ts)。
 */
export function phoneMediaQuery(): MediaQueryList {
  return window.matchMedia(
    workspaceRole() === "single" ? PHONE_MEDIA_QUERY : "not all",
  );
}
