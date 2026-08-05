// ターミナルの本文を「前回の続きから」渡すための位置決め。
//
// 他のエージェントにコンテキストを渡すのが目的なので、毎回全画面を返すと
// 受け取る側のコンテキストを無駄に食う。前回どこまで渡したかをカーソルとして
// 返し、次はその先だけを返す。
//
// カーソルは呼び出し側 (CLI / MCP / ブラウザ) が持ち回るだけの不透明な文字列
// にしてある。中身の形式が変わっても、持ち回る側は影響を受けない。
//
// tmux とブラウザシェルで位置の決め方が違う。
//
// - tmux: capture-pane の出力は「履歴 + 今の画面」。行が追記される一方、今の
//   画面の部分は書き換わる。しかも遡る行数に上限があるので、行が増えると窓が
//   ずれて古い行が落ちる。だから行数だけでは追えない。
// - シェル: PTY の出力をそのまま溜めているので、開始からの累積文字数がその
//   まま位置になる。
//
// 追えなかったときは全部を返し、reset を立てる。黙って欠けるより、重複して
// でも渡し切るほうが安全。ここを取り違えると、渡した気になって内容が消える。

export type TerminalCursor = string;

export type CaptureSlice = {
  /** 前回位置より後ろの本文。追えなかったときは全部。 */
  content: string;
  /** 次回に渡すカーソル。 */
  cursor: TerminalCursor;
  /**
   * 前回位置を追えず、全部を返した。カーソルを渡さなかった初回では立てない。
   * 立っているときは、受け取り側で前回分と重複している前提で扱う。
   */
  reset: boolean;
};

/**
 * 位置の照合に使う行数。最終行 1 本だけで見ると、シェルのプロンプトのように
 * 何度も同じ文字列が出る行で誤って一致し、その間に増えた本文が黙って落ちる。
 */
const ANCHOR_LINES = 8;

/**
 * 行の同一性を見るためだけの短いハッシュ。衝突しても「差分のはずが全部
 * 返る」だけで壊れないので、暗号強度は要らない。djb2 を 32bit で回す。
 */
export function hashLine(line: string): string {
  let hash = 5381;
  for (let i = 0; i < line.length; i += 1) {
    hash = ((hash << 5) + hash + line.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  // capture-pane は末尾に改行を付ける。空行が 1 本増えるのを防ぐ。
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body.split("\n");
}

/** 位置の直前 ANCHOR_LINES 行をまとめたハッシュ。 */
function anchorHash(lines: string[], upto: number): string {
  const start = Math.max(0, upto - ANCHOR_LINES);
  return hashLine(lines.slice(start, upto).join("\n"));
}

/** 窓の先頭。ここが変わっていれば、遡れる範囲がずれたということ。 */
function headHash(lines: string[]): string {
  return hashLine(lines[0] ?? "");
}

type TmuxCursor = { lines: number; head: string; anchor: string };

const TMUX_CURSOR_RE = /^t(\d+)\.([0-9a-z]+)\.([0-9a-z]+)$/;
const SHELL_CURSOR_RE = /^s(\d+)$/;

function encodeTmuxCursor(lines: string[]): TerminalCursor {
  return `t${lines.length}.${headHash(lines)}.${anchorHash(lines, lines.length)}`;
}

/**
 * カーソルの解釈結果。
 *
 * - absent: 呼び出し側が渡さなかった。初回。
 * - broken: 渡されたが読めない。前回分と重なる前提で全部返す。
 */
type Parsed<T> =
  | { kind: "ok"; value: T }
  | { kind: "absent" }
  | { kind: "broken" };

/**
 * 形どおりでなければ broken、渡されていなければ absent。両方式で同じ扱いを
 * するので 1 箇所に置く。build が null を返した場合も broken とみなす。
 */
function parseCursor<T>(
  cursor: TerminalCursor | null,
  pattern: RegExp,
  build: (match: RegExpExecArray) => T | null,
): Parsed<T> {
  if (cursor === null || cursor === "") return { kind: "absent" };
  const match = pattern.exec(cursor);
  if (!match) return { kind: "broken" };
  const value = build(match);
  return value === null ? { kind: "broken" } : { kind: "ok", value };
}

/** 桁溢れした数字は位置として使えない。 */
function safeCount(raw: string | undefined): number | null {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseTmuxCursor(cursor: TerminalCursor | null): Parsed<TmuxCursor> {
  return parseCursor(cursor, TMUX_CURSOR_RE, (match) => {
    const lines = safeCount(match[1]);
    if (lines === null) return null;
    return { lines, head: match[2] as string, anchor: match[3] as string };
  });
}

function parseShellCursor(cursor: TerminalCursor | null): Parsed<number> {
  return parseCursor(cursor, SHELL_CURSOR_RE, (match) => safeCount(match[1]));
}

/**
 * tmux の capture 出力を前回位置から切り出す。
 *
 * 続きとみなすのは 3 つが揃ったときだけ。
 *
 * 1. 行数が減っていない
 * 2. 窓の先頭行が変わっていない (変わっていれば遡れる範囲がずれた)
 * 3. 前回位置の直前 ANCHOR_LINES 行が一致する
 *
 * TUI のエージェントは今の画面を描き直すので、2 か 3 が外れて全部を返すことは
 * よくある。取りこぼすよりは重複させる。
 */
export function sliceTmuxCapture(
  screen: string,
  cursor: TerminalCursor | null,
): CaptureSlice {
  const lines = splitLines(screen);
  const nextCursor = encodeTmuxCursor(lines);
  const parsed = parseTmuxCursor(cursor);
  if (parsed.kind === "absent") {
    return { content: screen, cursor: nextCursor, reset: false };
  }
  if (parsed.kind === "broken") {
    return { content: screen, cursor: nextCursor, reset: true };
  }
  const prev = parsed.value;
  const continues =
    prev.lines <= lines.length &&
    headHash(lines) === prev.head &&
    anchorHash(lines, prev.lines) === prev.anchor;
  if (!continues) {
    return { content: screen, cursor: nextCursor, reset: true };
  }
  return {
    content: lines.slice(prev.lines).join("\n"),
    cursor: nextCursor,
    reset: false,
  };
}

/**
 * シェルの溜め置き出力を前回位置から切り出す。
 *
 * @param replay 末尾から一定量だけ保持している出力
 * @param totalChars セッション開始からの累積文字数 (捨てた分も含む)
 */
export function sliceShellBuffer(
  replay: string,
  totalChars: number,
  cursor: TerminalCursor | null,
): CaptureSlice {
  const nextCursor = `s${totalChars}`;
  const oldest = totalChars - replay.length;
  const parsed = parseShellCursor(cursor);
  if (parsed.kind === "absent") {
    return { content: replay, cursor: nextCursor, reset: false };
  }
  if (parsed.kind === "broken") {
    return { content: replay, cursor: nextCursor, reset: true };
  }
  const prev = parsed.value;
  // 溜め置きから溢れて捨てられた位置は、もう取り出せない。
  if (prev < oldest || prev > totalChars) {
    return { content: replay, cursor: nextCursor, reset: true };
  }
  return {
    content: replay.slice(prev - oldest),
    cursor: nextCursor,
    reset: false,
  };
}
