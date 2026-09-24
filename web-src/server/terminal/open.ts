// ツリーで選ばれた tmux ペインを、ブラウザのターミナルで見られる状態にする。
//
// 対応の単位は tmux のセッション。1 セッションにつきシェル 1 本を持つ形に
// 収束させる。
//
// - そのセッションを既に開いているシェルがあれば、そのシェルを映したうえで
//   ペインをカレントにする。端末は増えない。
// - 無ければシェルを 1 本開いて attach する。人が自分で `tmux attach` と
//   打ったのと同じ状態だが、tmux から抜ければ (セッションが終わった・detach
//   した) シェルも終わる (tmux/focus.ts の `&& exit`)。映していたペインが
//   終わって tmux が別のペインへ移したときも閉じる (attach-watch.ts)。どちらも
//   映すものが無くなったので、タブを残さない。
//
// セッションで見るのが要点。同じセッションの別ペインへ移るだけなら、既に
// 繋がっているシェルの中で選び直せば済む。ペインごとに端末を増やすと、同じ
// セッションに何台も attach することになり、tmux のウィンドウ寸法を取り合う
// (tmux のウィンドウは 1 つの寸法しか持てない)。

import { LOGIN_SESSION } from "../../core/agent-accounts";
import { errorWithCauses } from "../../core/error-detail";
import type {
  ShellPurpose,
  ShellSession,
  ShellSessionId,
} from "../../core/shell";
import type { TmuxPaneId } from "../../core/tmux";
import {
  closeShellSession,
  createShellSession,
  findShellSessionForTmuxSession,
  listShellSessionsForMatching,
  rememberShellTmuxAttachment,
  writeToShellWhenReady,
} from "../shell/session";
import { findClientByTty, listTmuxClients } from "../tmux/clients";
import {
  resolvePaneSession,
  selectTmuxPane,
  tmuxAttachCommandLine,
} from "../tmux/focus";
import { watchAttachedShell } from "./attach-watch";

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
 * code-viewer 自身が接続した宛先は SessionEntry に覚えてあり、呼出側が TTY の
 * 照合より先に見る。ここは、手動で接続したシェルも見つけるための TTY 経路。
 *
 * シェルの端末 (tty) が tmux のクライアントとして繋がっていて、そのクライアント
 * が目的のセッションを見ていれば、それがそのセッションのシェル。tty を引けな
 * かったシェルは数えない (空文字どうしが一致して無関係な端末を掴む)。
 */
async function findShellForSession(
  session: string,
  clients: Parameters<typeof findClientByTty>[0],
): Promise<ShellSession | null> {
  for (const shell of await listShellSessionsForMatching()) {
    if (shell.exited || !shell.tty) continue;
    const client = findClientByTty(clients, shell.tty);
    if (client?.session === session) return shell;
  }
  return null;
}

/** ログインのウィンドウのペインと、そのアカウント (accounts/handle.ts が覚える)。 */
const signInPanes = new Map<TmuxPaneId, ShellPurpose>();

export function rememberSignInPane(
  paneId: TmuxPaneId,
  purpose: ShellPurpose,
): void {
  signInPanes.set(paneId, purpose);
}

export async function openTmuxPaneInShell(
  paneId: TmuxPaneId,
  cwd: string,
  /** 新しく開くときの寸法。ブラウザが測った表示領域。 */
  size: { cols?: number; rows?: number } = {},
  /**
   * サーバが起き直して終わったシェルのタブを、同じ ID のシェルで同じ場所へ
   * 繋ぎ直す (タブの配置はシェルの ID で指すので、ID を保てばタブの位置も
   * グループも変わらない)。ペイン ID は tmux が起き直すと別のペインに付くので、
   * セッション名とウインドウの番号も保存した場所と一致したときだけ繋ぐ。
   * 繋ぎ直しでは、同じセッションを映している別のシェルを使い回さない。
   */
  revive?: { shell: ShellSessionId; session: string; window: number },
): Promise<OpenTmuxPaneResult> {
  const resolved = await resolvePaneSession(paneId, cwd);
  if (resolved.status === "gone") return { status: "gone" };
  if (resolved.status === "error") return resolved;
  const session = resolved.session;
  if (
    revive &&
    (session !== revive.session || resolved.window !== revive.window)
  )
    return { status: "gone" };
  // ペイン ID は tmux が起き直すと振り直されるので、ログインのセッションの
  // ペインのときだけ覚えた用途を使う。
  const purpose =
    session === LOGIN_SESSION ? (signInPanes.get(paneId) ?? null) : null;

  // ペインをそのセッションのカレントにする。既に繋がっているシェルがあれば
  // その場で表示が変わり、これから開く場合は繋いだ瞬間にそのペインが出る。
  // どちらの道でも先に済ませておけばよい。
  const selected = await selectTmuxPane(paneId, cwd);
  if (selected.status === "gone") return { status: "gone" };
  if (selected.status === "error") {
    return selected;
  }

  const remembered = revive ? null : findShellSessionForTmuxSession(session);
  if (remembered) {
    rememberShellTmuxAttachment(remembered.id, session, paneId, purpose);
    return { status: "ok", session: remembered, action: "switched" };
  }

  if (!revive) {
    const listed = await listTmuxClients(cwd);
    if (listed.status === "gone") return { status: "gone" };
    if (listed.status === "error") return listed;
    const existing = await findShellForSession(session, listed.clients);
    if (existing) {
      rememberShellTmuxAttachment(existing.id, session, paneId, purpose);
      return { status: "ok", session: existing, action: "switched" };
    }
  }

  const created = await createShellSession(cwd, size, revive?.shell);
  // 別の窓が先に同じタブを繋ぎ直した。そのシェルを映す (attach を打ち直さない)。
  if (created.status === "in-use")
    return { status: "ok", session: created.session, action: "switched" };
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
  rememberShellTmuxAttachment(created.session.id, session, paneId, purpose);
  watchAttachedShell(created.session.id, cwd);
  return { status: "ok", session: created.session, action: "attached" };
}
