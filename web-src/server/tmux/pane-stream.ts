// SP の 1 ペイン表示の HTTP 入口。attach せずに 1 つのペインを映し、入力を送る。
//
// - GET  /_tmux/pane-stream?pane=%3  ペインの今 (snapshot) と続きの出力を SSE で流す
//   (pane-watch.ts)。知らせは snapshot / output / gone / failed
// - POST /_tmux/pane-input           ペインへ打鍵 (keys)・文字 (text)・Enter を送る
//
// 文字は bracketed paste で貼る (paste-buffer -p)。アプリが求めていれば貼り付けの
// 印で囲むので、改行を含む文を書きかけで送信せずに渡せる。一時バッファは貼った
// ところで消す (-d)。打鍵はバイトのまま (send-keys -H) 送る。

import { formatErrorDetail } from "../../core/error-detail";
import { MAX_KEY_INPUT_LENGTH } from "../../core/shell";
import { isTmuxPaneId } from "../../core/tmux";
import { json, parsePostJsonBody, textError } from "../database/handle-shared";
import { createSseStreamGroup } from "../sse-stream";
import { runTmux, tmuxLiteralArg } from "./command";
import { closeAllPaneWatches, watchTmuxPane } from "./pane-watch";

const PANE_STREAMS = createSseStreamGroup();

/** サーバの終了時。流しと、その元の control mode のクライアントを全部閉じる。 */
export function closePaneStreams(): void {
  PANE_STREAMS.closeAll();
  closeAllPaneWatches();
}

export function handlePaneStream(url: URL, cwd: string): Response {
  const pane = url.searchParams.get("pane");
  if (!isTmuxPaneId(pane)) return textError("invalid pane id", 400);
  return PANE_STREAMS.open((stream) => {
    const failed = (error: Error) => {
      console.error(`[code-viewer] tmux pane stream failed (${pane})`, error);
      stream.send(
        "failed",
        JSON.stringify({ error: formatErrorDetail(error) }),
      );
      stream.close();
    };
    const gone = () => {
      stream.send("gone", "1");
      stream.close();
    };
    watchTmuxPane(pane, cwd, {
      snapshot: (snapshot) => stream.send("snapshot", JSON.stringify(snapshot)),
      output: (data) => stream.send("output", JSON.stringify({ data })),
      gone,
      failed,
    }).then(
      (result) => {
        if (result.status === "ok") stream.onClose(result.stop);
        else if (result.status === "gone") gone();
        else failed(result.error);
      },
      (error: unknown) =>
        failed(
          error instanceof Error
            ? error
            : new Error(`tmux pane watch threw ${String(error)}`),
        ),
    );
  });
}

type PaneInput = {
  pane?: unknown;
  keys?: unknown;
  text?: unknown;
  enter?: unknown;
  generation?: unknown;
};

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

/** 入力を tmux のコマンドにする。送るものが無ければ null。 */
export function paneInputArgs(
  pane: string,
  input: { keys?: string; text?: string; enter?: boolean },
  buffer: string,
): string[] | null {
  const commands: string[][] = [];
  if (input.text) {
    commands.push(
      ["set-buffer", "-b", buffer, "--", tmuxLiteralArg(input.text)],
      ["paste-buffer", "-p", "-d", "-b", buffer, "-t", pane],
    );
  }
  if (input.keys) {
    const hex = [...Buffer.from(input.keys, "utf8")].map((byte) =>
      byte.toString(16).padStart(2, "0"),
    );
    commands.push(["send-keys", "-t", pane, "-H", ...hex]);
  }
  if (input.enter) commands.push(["send-keys", "-t", pane, "Enter"]);
  if (commands.length === 0) return null;
  return commands.flatMap((command, index) =>
    index === 0 ? command : [";", ...command],
  );
}

export async function handlePaneInput(
  req: Request,
  cwd: string,
): Promise<Response> {
  const body = await parsePostJsonBody<PaneInput>(req);
  if (body instanceof Response) return body;
  const { pane, keys, text, enter, generation } = body;
  if (!isTmuxPaneId(pane)) return textError("invalid pane id", 400);
  if (!optionalString(keys) || !optionalString(text))
    return textError("keys and text must be strings", 400);
  if (enter !== undefined && typeof enter !== "boolean")
    return textError("enter must be a boolean", 400);
  if (generation !== undefined && !Number.isSafeInteger(generation))
    return textError("generation must be an integer", 400);
  if ((keys?.length ?? 0) + (text?.length ?? 0) > MAX_KEY_INPUT_LENGTH)
    return textError("input too large", 413);
  const args = paneInputArgs(
    pane,
    { keys, text, enter: enter === true },
    `code-viewer-${process.pid}-${Date.now().toString(36)}`,
  );
  if (!args) return textError("nothing to send", 400);
  const result = await runTmux(args, cwd);
  if (result.status === "error") {
    console.error(
      `[code-viewer] tmux pane input failed (${pane})`,
      result.error,
    );
    return textError(formatErrorDetail(result.error), 500);
  }
  if (result.status !== "ok") return textError(`pane ${pane} is gone`, 410);
  return json({ ok: true, generation: generation ?? null });
}
