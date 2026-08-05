// tmux に繋がっている端末の一覧。どの端末がどのセッションのどのペインを
// 見ているかを返す。
//
// code-viewer が開いた PTY シェルの中で tmux を起動すると、その tmux
// クライアントはシェルと同じ端末に載る。だから ShellSession.tty と
// `#{client_tty}` を突き合わせるだけで「このシェルが今どのペインを映して
// いるか」が分かり、逆に「このペインを見せたい」ときの宛先にもなる。
//
// tmux を呼ばない変換は parseTmuxClients に切り出してある (panes.ts と
// 同じ作り)。書式の取り違えはそこだけをテストすれば検出できる。

import type { TmuxClient } from "../../core/tmux";
import { TMUX_FIELD_SEP as FIELD_SEP, runTmux } from "./command";

export type TmuxClientsResult =
  | { status: "ok"; clients: TmuxClient[] }
  | { status: "gone" }
  | { status: "error"; error: Error };

const CLIENT_FIELDS = [
  "#{client_tty}",
  "#{client_session}",
  // そのクライアントが今見ているペイン。カレントウィンドウのアクティブ
  // ペインが解決されて入る。
  "#{pane_id}",
];

const CLIENT_FORMAT = CLIENT_FIELDS.join(FIELD_SEP);

/** CLIENT_FIELDS の並びと 1 対 1 に対応する列位置。 */
const FIELD = {
  tty: 0,
  session: 1,
  pane: 2,
} as const;

/**
 * `list-clients -F` の出力を配列にする。列数が足りない行と、tty が空の行は
 * 捨てる (tty が無いクライアントは宛先にできない)。
 */
export function parseTmuxClients(stdout: string): TmuxClient[] {
  const clients: TmuxClient[] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const fields = line.split(FIELD_SEP);
    if (fields.length < CLIENT_FIELDS.length) continue;
    const tty = fields[FIELD.tty] ?? "";
    if (!tty) continue;
    clients.push({
      tty,
      session: fields[FIELD.session] ?? "",
      pane: fields[FIELD.pane] ?? "",
    });
  }
  return clients;
}

/** tmux が無い / サーバが動いていない場合は gone、実行失敗は error で返す。 */
export async function listTmuxClients(cwd: string): Promise<TmuxClientsResult> {
  const result = await runTmux(["list-clients", "-F", CLIENT_FORMAT], cwd);
  if (result.status === "error") return result;
  if (result.status !== "ok") return { status: "gone" };
  return { status: "ok", clients: parseTmuxClients(result.stdout) };
}

/**
 * その端末に繋がっているクライアントを探す。tty が空 (引けなかったシェル)
 * なら、誰にも当てずに null を返す。
 *
 * 空の tty で照合すると全件が当たりうるので、必ずここで弾く。取り違えると
 * 別の端末を勝手に動かすことになる。
 */
export function findClientByTty(
  clients: TmuxClient[],
  tty: string,
): TmuxClient | null {
  if (!tty) return null;
  return clients.find((client) => client.tty === tty) ?? null;
}
