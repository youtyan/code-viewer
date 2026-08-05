// tmux ペインとブラウザシェルの本文を、同じ形で前回の続きから取り出す。
//
// 呼び出し側 (HTTP / CLI / MCP) は対象が tmux かシェルかを気にしない。ID の
// 形で振り分けるので、渡すのは ID とカーソルだけで済む。
//
// 取り出し方そのもの (どこから切るか) は core/terminal-capture の純関数に
// 置いてある。ここは tmux を叩く / 溜め置きを覗く、という副作用だけを持つ。

import { isShellSessionId, type ShellSessionId } from "../../core/shell";
import type { CaptureSlice, TerminalCursor } from "../../core/terminal-capture";
import {
  sliceShellBuffer,
  sliceTmuxCapture,
} from "../../core/terminal-capture";
import { isTmuxPaneId, type TmuxPaneId } from "../../core/tmux";
import { readShellBuffer } from "../shell/session";
import { captureTmuxPane, MAX_TMUX_HISTORY_LINES } from "../tmux/capture";

/** 遡る既定の行数。1 回の応答が読み切れる量に収める。 */
export const DEFAULT_CAPTURE_HISTORY_LINES = 500;

export type TerminalKind = "tmux" | "shell";

export type TerminalCaptureResult =
  | { status: "ok"; kind: TerminalKind; slice: CaptureSlice }
  /** ペインが閉じられた / シェルが片付いた。 */
  | { status: "gone" }
  | { status: "invalid" }
  | { status: "error"; error: Error };

export function terminalKindOf(target: string): TerminalKind | null {
  if (isShellSessionId(target)) return "shell";
  if (isTmuxPaneId(target)) return "tmux";
  return null;
}

function captureShell(
  id: ShellSessionId,
  cursor: TerminalCursor | null,
): TerminalCaptureResult {
  const buffer = readShellBuffer(id);
  if (!buffer) return { status: "gone" };
  return {
    status: "ok",
    kind: "shell",
    slice: sliceShellBuffer(buffer.replay, buffer.totalChars, cursor),
  };
}

async function captureTmux(
  paneId: TmuxPaneId,
  cursor: TerminalCursor | null,
  cwd: string,
  historyLines: number,
): Promise<TerminalCaptureResult> {
  const result = await captureTmuxPane(paneId, cwd, historyLines);
  if (result.status === "gone") return { status: "gone" };
  if (result.status === "error") {
    return result;
  }
  return {
    status: "ok",
    kind: "tmux",
    slice: sliceTmuxCapture(result.screen.content, cursor),
  };
}

export function clampHistoryLines(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseInt(typeof value === "string" ? value : "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_CAPTURE_HISTORY_LINES;
  return Math.min(Math.max(Math.trunc(parsed), 0), MAX_TMUX_HISTORY_LINES);
}

export function captureTerminal(
  target: string,
  cursor: TerminalCursor | null,
  cwd: string,
  historyLines = DEFAULT_CAPTURE_HISTORY_LINES,
): Promise<TerminalCaptureResult> {
  const kind = terminalKindOf(target);
  if (kind === "shell") {
    return Promise.resolve(captureShell(target, cursor));
  }
  if (kind === "tmux") {
    return captureTmux(target, cursor, cwd, historyLines);
  }
  return Promise.resolve({ status: "invalid" });
}
