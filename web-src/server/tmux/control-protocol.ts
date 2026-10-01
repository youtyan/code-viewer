// tmux の control mode (`tmux -C`) が送ってくる行を読む。tmux は呼ばない。
//
// control mode のクライアントは画面を持たず、tmux は画面を描く代わりに 1 行ずつ
// 知らせを送ってくる:
//
//   %output %<ペイン> <中身>          そのペインのアプリが出したバイト列
//   %begin <時刻> <番号> <印>         送ったコマンドの返事の始まり。間の行は
//   …                                 コマンドの出力そのまま (エスケープされない)
//   %end / %error <時刻> <番号> <印>  返事の終わり (成功 / 失敗)
//   %layout-change @<窓> …            ペインの大きさ・分割が変わった
//   %window-close @<窓>               窓が閉じた
//   %exit [理由]                      このクライアントが外された
//
// %output の中身は、32 未満のバイトと `\` が `\ooo` (8 進 3 桁) になり、ほかの
// バイトはそのまま届く。UTF-8 の 1 文字が 2 つの %output に分かれることもあるので、
// 文字列にする前にバイトで戻す。
//
// 返事の行は生のまま届くので、ペインの中身に `%end` で始まる行があっても終わりと
// 取り違えないよう、始まりと同じ時刻・番号・印の `%end` だけを終わりと見る。

/** 返事の印の 1 ビット目: このクライアントが送ったコマンドの返事。 */
const FLAG_CLIENT_COMMAND = 1;

export type ControlEvent =
  | { kind: "output"; pane: string; data: Buffer }
  | {
      kind: "reply";
      /** このクライアントが送ったコマンドへの返事か (繋いだ直後の attach の返事は false)。 */
      ours: boolean;
      ok: boolean;
      lines: Buffer[];
    }
  | { kind: "layout"; window: string }
  | { kind: "window-close"; window: string }
  | { kind: "exit"; reason: string }
  /** 読み取り側が使わない知らせ (%session-changed など)。 */
  | { kind: "other"; line: string };

const BACKSLASH = 0x5c;
const NEWLINE = 0x0a;

function isOctalDigit(byte: number | undefined): boolean {
  return byte !== undefined && byte >= 0x30 && byte <= 0x37;
}

/** %output の中身の `\ooo` をバイトに戻す。 */
export function unescapeControlOutput(value: Buffer): Buffer {
  const out = Buffer.allocUnsafe(value.length);
  let length = 0;
  for (let i = 0; i < value.length; i += 1) {
    const byte = value[i];
    if (
      byte === BACKSLASH &&
      isOctalDigit(value[i + 1]) &&
      isOctalDigit(value[i + 2]) &&
      isOctalDigit(value[i + 3])
    ) {
      out[length] =
        (value[i + 1] - 0x30) * 64 +
        (value[i + 2] - 0x30) * 8 +
        (value[i + 3] - 0x30);
      length += 1;
      i += 3;
      continue;
    }
    out[length] = byte;
    length += 1;
  }
  return out.subarray(0, length);
}

const PANE_OUTPUT = /^%output (%[0-9]+) /;
// pause-after を使うと届く形。` : ` の後ろが中身。
const PANE_EXTENDED_OUTPUT = /^%extended-output (%[0-9]+) [0-9]+[^:]* : /;
const BLOCK_START = /^%begin ([0-9]+) ([0-9]+) ([0-9]+)$/;
const WINDOW_EVENT =
  /^%(layout-change|window-close|unlinked-window-close) (@[0-9]+)/;

function asciiPrefix(line: Buffer, max: number): string {
  return line.subarray(0, Math.min(line.length, max)).toString("latin1");
}

/**
 * 届いたバイト列を行に切り、知らせにして返す。行の途中で切れた分は次の
 * feed まで持ち越す。
 */
export function createControlParser(): {
  feed(chunk: Buffer): ControlEvent[];
} {
  let pending = Buffer.alloc(0);
  let block: {
    end: string;
    error: string;
    ours: boolean;
    lines: Buffer[];
  } | null = null;

  function readLine(line: Buffer): ControlEvent | null {
    if (block) {
      const text = line.length < 64 ? line.toString("latin1") : "";
      if (text === block.end || text === block.error) {
        const done = block;
        block = null;
        return {
          kind: "reply",
          ours: done.ours,
          ok: text === done.end,
          lines: done.lines,
        };
      }
      block.lines.push(line);
      return null;
    }
    const head = asciiPrefix(line, 96);
    const output = PANE_OUTPUT.exec(head) ?? PANE_EXTENDED_OUTPUT.exec(head);
    if (output) {
      return {
        kind: "output",
        pane: output[1],
        data: unescapeControlOutput(line.subarray(output[0].length)),
      };
    }
    const start = BLOCK_START.exec(head);
    if (start) {
      const tail = `${start[1]} ${start[2]} ${start[3]}`;
      block = {
        end: `%end ${tail}`,
        error: `%error ${tail}`,
        ours: (Number(start[3]) & FLAG_CLIENT_COMMAND) !== 0,
        lines: [],
      };
      return null;
    }
    const window = WINDOW_EVENT.exec(head);
    if (window) {
      return window[1] === "layout-change"
        ? { kind: "layout", window: window[2] }
        : { kind: "window-close", window: window[2] };
    }
    if (head === "%exit" || head.startsWith("%exit ")) {
      return { kind: "exit", reason: line.subarray(5).toString("utf8").trim() };
    }
    return { kind: "other", line: line.toString("utf8") };
  }

  return {
    feed(chunk) {
      const data = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      const events: ControlEvent[] = [];
      let from = 0;
      for (;;) {
        const at = data.indexOf(NEWLINE, from);
        if (at < 0) break;
        const event = readLine(data.subarray(from, at));
        if (event) events.push(event);
        from = at + 1;
      }
      pending = Buffer.from(data.subarray(from));
      return events;
    },
  };
}
