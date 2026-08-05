// terminal ドロワーの HTTP 入口。
//
// - GET  /_tmux/panes   セッション → ウィンドウ → ペインの一覧 (ツリーの元)
// - GET  /_tmux/clients どの端末がどのペインを映しているか
// - POST /_tmux/open    そのペインをブラウザのターミナルで見られるようにする
//
// ドロワーは tmux ペインの画面を自分で描かない。ターミナルは PTY のシェル
// 1 本で、tmux はその中で普通に動く。だから tmux 側に要るのは「今どうなって
// いるかを見せる」ことと「目的のペインへ連れて行く」ことだけになり、画面を
// 取り直す購読もキー送信もここには無い (それぞれ /_shell/* が持つ)。
//
// ルーティングと副作用リクエストの認可は database/handle-shared の
// dispatchRoutes に任せる (state-route.ts と同じ使い方)。ペインを開くのは
// sideEffect: true なので、同一オリジンかつ x-code-viewer-action 付きの
// リクエストしか通らない。

import { formatErrorDetail } from "../../core/error-detail";
import { isTmuxPaneId } from "../../core/tmux";
import {
  dispatchRoutes,
  handleError,
  json,
  jsonLoadResponse,
  parsePostJsonBody,
  textError,
} from "../database/handle-shared";
import { openTmuxPaneInShell } from "../terminal/open";
import { listTmuxClients } from "./clients";
import { listTmuxPanes } from "./panes";

function handlePanesGet(cwd: string): Promise<Response> {
  return jsonLoadResponse(
    () => listTmuxPanes(cwd),
    "tmux",
    "failed to list tmux panes",
  );
}

/**
 * どの端末がどのペインを映しているか。
 *
 * ツリーは「このペインは今ブラウザのどのシェルで見ている」を出すのにこれを
 * 使う。シェルの tty と突き合わせるのはクライアント側ではなくサーバ側の
 * 知識なので、一覧はそのまま渡して照合だけを任せる。
 */
function handleClientsGet(cwd: string): Promise<Response> {
  return listTmuxClients(cwd).then((result) => {
    if (result.status === "gone") return json({ clients: [] });
    if (result.status === "error") {
      console.error("[code-viewer] tmux client listing failed", result.error);
      return textError(formatErrorDetail(result.error), 500);
    }
    return json({ clients: result.clients });
  });
}

/**
 * そのペインをブラウザのターミナルで見られるようにする。
 *
 * 今映しているシェルで tmux が動いていればそれを動かし、動いていなければ
 * こちらでシェルを開いて attach する。どちらになったかは action で返すので、
 * クライアントは新しく開いたときだけ一覧を取り直せばよい。
 */
async function handleOpenPost(req: Request, cwd: string): Promise<Response> {
  const body = await parsePostJsonBody<{
    pane?: unknown;
    cols?: unknown;
    rows?: unknown;
  }>(req);
  if (body instanceof Response) return body;
  if (!isTmuxPaneId(body.pane)) return textError("invalid pane id", 400);
  const result = await openTmuxPaneInShell(body.pane, cwd, {
    cols: typeof body.cols === "number" ? body.cols : undefined,
    rows: typeof body.rows === "number" ? body.rows : undefined,
  });
  if (result.status === "gone") return textError("pane is gone", 410);
  if (result.status === "unavailable") return textError(result.reason, 501);
  if (result.status === "error") {
    console.error("[code-viewer] tmux open failed", result.error);
    return textError(formatErrorDetail(result.error), 500);
  }
  return json({ session: result.session, action: result.action });
}

export function handleTmuxRoute(
  req: Request,
  url: URL,
  cwd: string,
  sideEffectAllowed: (req: Request) => boolean,
): Promise<Response | null> {
  return dispatchRoutes(
    req,
    url,
    {
      "/_tmux/panes": {
        methods: ["GET"],
        sideEffect: false,
        handler: () => handlePanesGet(cwd),
      },
      "/_tmux/clients": {
        methods: ["GET"],
        sideEffect: false,
        handler: () => handleClientsGet(cwd),
      },
      "/_tmux/open": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleOpenPost(req, cwd),
      },
    },
    sideEffectAllowed,
    (res) => res,
    (err) => handleError("tmux", "handle tmux request", err),
  );
}
