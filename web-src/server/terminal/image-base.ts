// ターミナルの画像パスの相対パスを、どこから解くかを決める。
//
// エージェントはリポジトリの下の別のディレクトリで動いていることがある。
// リポジトリの根から解くと、そこで出た `out/chart.png` を拾い損ねる。だから
// そのシェルが映している tmux のペインの作業場所 (`pane_current_path`) から
// 解く。シェルと tmux のペインは端末の名前 (ShellSession.tty と
// `#{client_tty}`) で突き合わせる (tmux/clients.ts)。
//
// 取れないときの順: ペイン → シェルを起こした場所 → リポジトリの根。
// tmux の失敗は握りつぶさず、理由をログと応答 (TerminalImageBase.error) に残す。
//
// どこから解いても、配ってよいかの判定 (images.ts の resolveTerminalImage) は
// 同じものを通る。起点が変わるだけで、許す範囲は変わらない。

import { formatErrorDetail } from "../../core/error-detail";
import type { ShellSessionId } from "../../core/shell";
import type { TerminalImageBase } from "../../core/terminal-images";
import {
  isTmuxPaneId,
  type TmuxClient,
  type TmuxPaneId,
} from "../../core/tmux";
import { getShellSession } from "../shell/session";
import { findClientByTty, listTmuxClients } from "../tmux/clients";
import { runTmux } from "../tmux/command";

export type TerminalImageBaseResult = {
  base: TerminalImageBase;
  /** シェルが映している tmux のペイン。tmux を映していなければ null。 */
  pane: TmuxPaneId | null;
  /** そのペインを映している tmux のクライアント (ウインドウのペインを引く宛先)。 */
  client: TmuxClient | null;
};

function logBaseError(shell: string, error: Error): string {
  console.error(
    `[code-viewer] terminal image base lookup failed (shell ${shell})`,
    error,
  );
  return formatErrorDetail(error);
}

/**
 * @param repoCwd このサーバのリポジトリの根 (最後の頼り)
 * @param shell 画像パスが出たシェル。null ならリポジトリの根から解く
 */
export async function terminalImageBase(
  repoCwd: string,
  shell: ShellSessionId | null,
): Promise<TerminalImageBaseResult> {
  const repo: TerminalImageBaseResult = {
    base: { source: "repo", cwd: repoCwd },
    pane: null,
    client: null,
  };
  if (!shell) return repo;
  const session = getShellSession(shell);
  if (!session) return repo;
  const fallback = (error?: string): TerminalImageBaseResult => ({
    base: session.cwd
      ? { source: "shell", cwd: session.cwd, ...(error ? { error } : {}) }
      : { source: "repo", cwd: repoCwd, ...(error ? { error } : {}) },
    pane: null,
    client: null,
  });

  const clients = await listTmuxClients(repoCwd);
  if (clients.status === "error") {
    return fallback(logBaseError(shell, clients.error));
  }
  // tmux が無い・動いていない。このシェルは tmux を映していない。
  if (clients.status === "gone") return fallback();
  const client = findClientByTty(clients.clients, session.tty);
  if (!client || !isTmuxPaneId(client.pane)) return fallback();

  const result = await runTmux(
    ["display-message", "-p", "-t", client.pane, "-F", "#{pane_current_path}"],
    repoCwd,
  );
  if (result.status === "error") {
    return {
      ...fallback(logBaseError(shell, result.error)),
      pane: client.pane,
      client,
    };
  }
  // 引く間にペインが閉じられた・tmux が止まった。
  if (result.status !== "ok") return fallback();
  const cwd = result.stdout.trim();
  // 作業場所を持たないペイン (tmux が引けない環境) は、ペインは分かるので
  // 履歴は拾えるが、起点はシェルに戻す。
  if (!cwd) return { ...fallback(), pane: client.pane, client };
  return { base: { source: "pane", cwd }, pane: client.pane, client };
}
