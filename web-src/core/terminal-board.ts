// ターミナルとエージェントの一覧で共有する小さな規則。
//
// パスの末尾 (worktree を切っていればその名前)、ブラウザのシェルと tmux の
// ペインの対応、経過時間の刻み。DOM を触らないので、規則はここだけで
// 確かめられる。

import type { ShellSession } from "./shell";
import type { TmuxClient } from "./tmux";

/** パスの末尾。worktree を切っていれば、その名前がここに出る。 */
export function basenameOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  return slash < 0 ? trimmed : trimmed.slice(slash + 1);
}

/**
 * ブラウザのシェルと tmux ペインの対応表を作る。
 *
 * シェルの端末 (tty) が tmux のクライアントとして繋がっていれば、その
 * クライアントが見ているペインがそのシェルの映しているものになる。突き合わせ
 * の鍵は tty だけなので、ここは 2 つの一覧を舐めるだけで済む。
 *
 * tty を持たないシェル (引けなかった環境) は数えない。空文字どうしが一致して
 * 無関係なペインと結び付くのを防ぐ。
 */
export function linkShellsAndPanes(
  shells: ShellSession[],
  clients: TmuxClient[],
): { paneToShell: Map<string, string>; shellToPane: Map<string, string> } {
  const paneToShell = new Map<string, string>();
  const shellToPane = new Map<string, string>();
  const clientByTty = new Map(clients.map((client) => [client.tty, client]));
  for (const shell of shells) {
    if (!shell.tty || shell.exited) continue;
    const client = clientByTty.get(shell.tty);
    if (!client?.pane) continue;
    paneToShell.set(client.pane, shell.id);
    shellToPane.set(shell.id, client.pane);
  }
  return { paneToShell, shellToPane };
}

/**
 * 経過時間の粗い刻み。秒まで出すと 1 秒ごとに描き直すことになるので、分から。
 * 1 分未満は「たった今」に丸める。
 */
export function elapsedBucket(ms: number): {
  unit: "now" | "minute" | "hour" | "day";
  value: number;
} {
  if (!Number.isFinite(ms) || ms < 60_000) return { unit: "now", value: 0 };
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return { unit: "minute", value: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hour", value: hours };
  return { unit: "day", value: Math.floor(hours / 24) };
}
