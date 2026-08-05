// ツリーで選ばれた tmux ペインを、ブラウザのターミナルで見られる状態にする。
//
// 対応の単位は tmux のセッション。1 セッションにつきシェル 1 本を持つ形に
// 収束させる。
//
// - そのセッションを既に開いているシェルがあれば、そのシェルを映したうえで
//   ペインをカレントにする。端末は増えない。
// - 無ければシェルを 1 本開いて attach する。人が自分で `tmux attach` と
//   打ったのと同じ状態になるので、detach すればそのシェルが残る。
//
// セッションで見るのが要点。同じセッションの別ペインへ移るだけなら、既に
// 繋がっているシェルの中で選び直せば済む。ペインごとに端末を増やすと、同じ
// セッションに何台も attach することになり、tmux のウィンドウ寸法を取り合う
// (tmux のウィンドウは 1 つの寸法しか持てない)。

import { errorWithCauses } from "../../core/error-detail";
import type { ShellSession } from "../../core/shell";
import type { TmuxPaneId } from "../../core/tmux";
import {
  closeShellSession,
  createShellSession,
  listShellSessions,
  writeToShellWhenReady,
} from "../shell/session";
import { findClientByTty, listTmuxClients } from "../tmux/clients";
import {
  resolvePaneSession,
  selectTmuxPane,
  tmuxAttachCommandLine,
} from "../tmux/focus";

export type OpenTmuxPaneResult =
  | {
      status: "ok";
      session: ShellSession;
      /**
       * 既にあるシェルでペインを選び直したのか、新しく開いて繋いだのか。
       * クライアントは後者のときだけ一覧に足せばよい。
       */
      action: "switched" | "attached";
    }
  /** ペインが閉じられた / tmux が居ない。 */
  | { status: "gone" }
  /** node-pty が無く、シェルを開けない。 */
  | { status: "unavailable"; reason: string }
  | { status: "error"; error: Error };

/**
 * その tmux セッションを映しているシェルを探す。
 *
 * シェルの端末 (tty) が tmux のクライアントとして繋がっていて、そのクライアント
 * が目的のセッションを見ていれば、それがそのセッションのシェル。tty を引けな
 * かったシェルは数えない (空文字どうしが一致して無関係な端末を掴む)。
 */
function findShellForSession(
  session: string,
  clients: Parameters<typeof findClientByTty>[0],
): ShellSession | null {
  for (const shell of listShellSessions()) {
    if (shell.exited || !shell.tty) continue;
    const client = findClientByTty(clients, shell.tty);
    if (client?.session === session) return shell;
  }
  return null;
}

export async function openTmuxPaneInShell(
  paneId: TmuxPaneId,
  cwd: string,
  /** 新しく開くときの寸法。ブラウザが測った表示領域。 */
  size: { cols?: number; rows?: number } = {},
): Promise<OpenTmuxPaneResult> {
  const resolved = await resolvePaneSession(paneId, cwd);
  if (resolved.status === "gone") return { status: "gone" };
  if (resolved.status === "error") return resolved;
  const session = resolved.session;

  // ペインをそのセッションのカレントにする。既に繋がっているシェルがあれば
  // その場で表示が変わり、これから開く場合は繋いだ瞬間にそのペインが出る。
  // どちらの道でも先に済ませておけばよい。
  const selected = await selectTmuxPane(paneId, cwd);
  if (selected.status === "gone") return { status: "gone" };
  if (selected.status === "error") {
    return selected;
  }

  const listed = await listTmuxClients(cwd);
  if (listed.status === "gone") return { status: "gone" };
  if (listed.status === "error") return listed;
  const existing = findShellForSession(session, listed.clients);
  if (existing) return { status: "ok", session: existing, action: "switched" };

  const created = await createShellSession(cwd, size);
  if (created.status !== "ok") return created;
  // シェルが端末を整え終わるまで待ってから流す。作った直後に書くと捨てられる。
  const written = await writeToShellWhenReady(
    created.session.id,
    tmuxAttachCommandLine(paneId),
  );
  if (written.status !== "ok") {
    const closed = await closeShellSession(created.session.id);
    if (closed.status === "error") {
      const writeError =
        written.status === "error"
          ? written.error
          : new Error("shell was gone before the initial command was written");
      return {
        status: "error",
        error: errorWithCauses(
          "failed to initialize the shell and close it afterward",
          [writeError, closed.error],
        ),
      };
    }
    return written;
  }
  return { status: "ok", session: created.session, action: "attached" };
}
