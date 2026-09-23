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

import type { TmuxClient, TmuxClientWindow } from "../../core/tmux";
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
  // 端末とウインドウの大きさ・ステータスの行。ウインドウが端末より小さいと、
  // 外側を tmux が点で埋める (アプリの端末はそこを覆う)。オプションは名前で
  // 書式に書けば、そのクライアントのセッションの値に解ける。
  "#{client_width}",
  "#{client_height}",
  "#{window_width}",
  "#{window_height}",
  "#{status}",
  "#{status-position}",
  "#{session_attached}",
];

const CLIENT_FORMAT = CLIENT_FIELDS.join(FIELD_SEP);

/** CLIENT_FIELDS の並びと 1 対 1 に対応する列位置。 */
const FIELD = {
  tty: 0,
  session: 1,
  pane: 2,
  clientCols: 3,
  clientRows: 4,
  windowCols: 5,
  windowRows: 6,
  status: 7,
  statusPosition: 8,
  sessionClients: 9,
} as const;

/** 1 以上の整数でなければ null (空・`-`・小数)。 */
function positiveInt(raw: string | undefined): number | null {
  if (!raw || !/^[0-9]+$/.test(raw)) return null;
  const value = Number(raw);
  return value > 0 ? value : null;
}

/**
 * tmux の `status` の値 (off / on / 2〜5) をステータスの行数にする。知らない
 * 値は null (覆う範囲を当て推量しない)。
 */
function statusLines(raw: string | undefined): number | null {
  if (raw === "off") return 0;
  if (raw === "on") return 1;
  if (raw && /^[2-5]$/.test(raw)) return Number(raw);
  return null;
}

/** 大きさの列を読む。どれか 1 つでも読めなければ無し (覆わない)。 */
function parseClientWindow(fields: string[]): TmuxClientWindow | undefined {
  const clientCols = positiveInt(fields[FIELD.clientCols]);
  const clientRows = positiveInt(fields[FIELD.clientRows]);
  const windowCols = positiveInt(fields[FIELD.windowCols]);
  const windowRows = positiveInt(fields[FIELD.windowRows]);
  const lines = statusLines(fields[FIELD.status]);
  const position = fields[FIELD.statusPosition];
  const sessionClients = positiveInt(fields[FIELD.sessionClients]);
  if (
    clientCols === null ||
    clientRows === null ||
    windowCols === null ||
    windowRows === null ||
    lines === null ||
    (position !== "top" && position !== "bottom") ||
    sessionClients === null
  )
    return undefined;
  return {
    clientCols,
    clientRows,
    windowCols,
    windowRows,
    statusLines: lines,
    statusAt: position,
    sessionClients,
  };
}

/**
 * `list-clients -F` の出力を配列にする。宛先の 3 列が足りない行と、tty が空の
 * 行は捨てる (tty が無いクライアントは宛先にできない)。大きさの列が読めない
 * 行は、宛先としては残し、大きさだけ持たない。
 */
export function parseTmuxClients(stdout: string): TmuxClient[] {
  const clients: TmuxClient[] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const fields = line.split(FIELD_SEP);
    if (fields.length <= FIELD.pane) continue;
    const tty = fields[FIELD.tty] ?? "";
    if (!tty) continue;
    const window = parseClientWindow(fields);
    clients.push({
      tty,
      session: fields[FIELD.session] ?? "",
      pane: fields[FIELD.pane] ?? "",
      ...(window ? { window } : {}),
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
