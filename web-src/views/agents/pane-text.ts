// エージェント・tmux のペインを 1 行で見せる文字の決まり (1 か所)。
// サイドバーの作業の欄・「＋」のメニューの行・パレットの補足・ターミナルの
// タブの名前・通知が、この値を使う。形は「種類 · 作業の要約 (無ければ状態の
// 語) · 場所 (tmux の session:window.pane)」。ホスト名 (tmux の既定の題名) は
// どこにも出さない (paneTaskSummary)。カーソルを置いたときの説明にコマンド名
// と場所。

import { type AgentPane, paneTaskSummary } from "../../core/agent-overview";
import type { AgentsText } from "./i18n";

export type PaneText = {
  /** 種類 (claude / codex / シェル)。 */
  kind: string;
  /** 作業の要約。無ければ状態の語。 */
  summary: string;
  /** tmux の場所 `session:window.pane`。 */
  place: string;
  /** 種類 · 要約 (タブの名前)。 */
  headline: string;
  /** 種類 · 要約 · 場所 (メニューの行)。 */
  row: string;
  /** 要約 · 場所 (パレットの補足。種類は題名の側)。 */
  detail: string;
  /** 状態 · 要約 (無ければ状態だけ) / 場所 · コマンド (カーソルを置いたときの説明)。 */
  title: string;
};

export function paneText(pane: AgentPane, text: AgentsText): PaneText {
  const kind = pane.kind ? text.kind[pane.kind] : text.kindShell;
  const state = text.state[pane.state];
  const task = paneTaskSummary(pane);
  const summary = task ?? state;
  const place = pane.label;
  return {
    kind,
    summary,
    place,
    headline: `${kind} · ${summary}`,
    row: `${kind} · ${summary} · ${place}`,
    detail: `${summary} · ${place}`,
    // 要約が無ければ状態の語を 2 度並べない。
    title: `${task === null ? state : `${state} · ${task}`}\n${place} · ${pane.command}`,
  };
}

/**
 * エージェントを映していないシェルの名前 (タブ・「＋」の行・パレット)。
 * 「Shell」＋このプロジェクトのサーバで開いた順の番号。id (`shell-…`) は
 * 出さない。番号は一覧 (開いた時刻の順) の位置なので、前のシェルを閉じると
 * 詰まる。一覧にまだ載っていない (取り直し前の) シェルは番号を付けない。
 */
export function shellName(
  session: string,
  sessions: readonly { id: string; createdAt: string }[],
  word: string,
): string {
  const order = [...sessions].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  const index = order.findIndex((item) => item.id === session);
  return index < 0 ? word : `${word} ${index + 1}`;
}
