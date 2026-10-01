// SP の 1 ペイン表示のために、tmux のセッションへ control mode (`tmux -C`) の
// クライアントを繋ぎ、1 つのペインの画面と出力を見ている側へ渡す。
//
// 普通の端末として attach しない理由:
// - control mode のクライアントは大きさを名乗らない限り、ウインドウの大きさの
//   計算から外れる (tmux の resize.c の ignore_client_size)。利用者の WezTerm など
//   の大きさも、ペインの分割も変えない
// - 画面を描かないので、狭い端末で起きた tmux 3.7c の止まり (focus.ts) を通らない
// - 出力がペインごとに届くので、分割したウインドウの 1 ペインだけを映せる
//
// セッション 1 つに 1 本だけ繋ぎ、見ている側が居なくなったら外す。利用者の tmux に
// オプションもフックも置かない。
//
// 順番の決まり: 画面の読み取り (capture-pane) の返事は、出力の流れの中のちょうど
// その時点に届く。返事より前の出力は読み取りに含まれ、後の出力はその続き。だから
// 読み取りを頼んでから返事が来るまでの出力は捨て、返事を渡した直後から流す。
// 返事は Promise にせず、届いた知らせを処理する同じ流れの中で渡す (Promise にすると、
// 返事と同じ塊で届いた続きの出力を、返事を渡す前に捨ててしまう)。

import { errorWithCause } from "../../core/error-detail";
import type { TmuxPaneId, TmuxPaneSnapshot } from "../../core/tmux";
import { type SpawnedProcess, spawnProcess, stopProcess } from "../runtime";
import { closeLineColors } from "./capture";
import { runTmux, tmuxArgs } from "./command";
import { type ControlEvent, createControlParser } from "./control-protocol";

/** 流しの始めに渡す過去の行数 (折り返しを繋いだ行で数える前の、tmux の行数)。 */
export const PANE_WATCH_HISTORY_LINES = 1000;

/** 子の標準エラーを理由に残す上限。 */
const STDERR_LIMIT = 4096;

export type PaneWatcher = {
  /** 流しの始めと、ペインの大きさが変わったとき。この後の output はこの続き。 */
  snapshot(snapshot: TmuxPaneSnapshot): void;
  output(text: string): void;
  /** ペインが閉じた・セッションが終わった。この後は何も来ない。 */
  gone(): void;
  /** 繋ぎが壊れた。この後は何も来ない。 */
  failed(error: Error): void;
};

export type PaneWatchResult =
  | { status: "ok"; stop(): void }
  | { status: "gone" }
  | { status: "error"; error: Error };

type Reply = { ok: boolean; lines: Buffer[] };

type Watch = {
  pane: TmuxPaneId;
  watcher: PaneWatcher;
  /** 読み取りの返事を待っている間は出力を捨てる。 */
  live: boolean;
  /** 大きさの確かめを頼んでいる最中 (重ねて頼まない)。 */
  checking: boolean;
  cols: number;
  rows: number;
  decoder: TextDecoder;
};

// display-message で 1 行にまとめて読む値。並びは readMeta と 1 対 1。
const META_FIELDS = [
  "#{pane_id}",
  "#{pane_dead}",
  "#{pane_width}",
  "#{pane_height}",
  "#{cursor_x}",
  "#{cursor_y}",
  "#{cursor_flag}",
  "#{alternate_on}",
  "#{keypad_cursor_flag}",
  "#{keypad_flag}",
  "#{insert_flag}",
  "#{wrap_flag}",
  "#{origin_flag}",
  "#{scroll_region_upper}",
  "#{scroll_region_lower}",
  "#{history_size}",
];

type Meta = Omit<TmuxPaneSnapshot, "pane" | "content" | "historyLines"> & {
  historySize: number;
};

function intField(raw: string | undefined): number | null {
  return raw !== undefined && /^[0-9]+$/.test(raw) ? Number(raw) : null;
}

/** display-message の返事を読む。ペインが無い・終わっている・読めなければ null。 */
export function readPaneMeta(line: string, pane: TmuxPaneId): Meta | null {
  const f = line.split(" ");
  if (f.length !== META_FIELDS.length || f[0] !== pane || f[1] === "1")
    return null;
  const ints = f.slice(2).map(intField);
  if (ints.some((value) => value === null)) return null;
  const [
    cols,
    rows,
    cursorX,
    cursorY,
    cursorFlag,
    alternate,
    appCursorKeys,
    appKeypad,
    insert,
    wrap,
    origin,
    scrollTop,
    scrollBottom,
    historySize,
  ] = ints as number[];
  if (cols < 1 || rows < 1) return null;
  return {
    width: cols,
    height: rows,
    cursorX,
    cursorY,
    cursorVisible: cursorFlag === 1,
    alternate: alternate === 1,
    appCursorKeys: appCursorKeys === 1,
    appKeypad: appKeypad === 1,
    insert: insert === 1,
    wrap: wrap === 1,
    origin: origin === 1,
    scrollTop,
    scrollBottom,
    historySize,
  };
}

function metaCommand(pane: TmuxPaneId): string {
  // ペインの id は %数字 だけを通している (isTmuxPaneId)。書式に ' は無い。
  return `display-message -p -t ${pane} '${META_FIELDS.join(" ")}'`;
}

class ControlConnection {
  private readonly child: SpawnedProcess;
  private readonly replies: Array<(reply: Reply) => void> = [];
  private readonly watches = new Set<Watch>();
  private stderr = "";
  private ended = false;

  constructor(
    readonly session: string,
    cwd: string,
    private readonly onEnd: (connection: ControlConnection) => void,
  ) {
    const [command, ...args] = tmuxArgs([
      "-C",
      "attach-session",
      "-t",
      session,
    ]);
    this.child = spawnProcess(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const parser = createControlParser();
    this.child.stdout?.on("data", (chunk: Buffer) => {
      for (const event of parser.feed(chunk)) this.dispatch(event);
    });
    this.child.stderr?.on("data", (chunk: Buffer) => {
      if (this.stderr.length < STDERR_LIMIT)
        this.stderr += chunk.toString("utf8").slice(0, STDERR_LIMIT);
    });
    this.child.stdin?.on("error", (error) =>
      this.end(
        errorWithCause("could not write to the tmux control client", error),
      ),
    );
    this.child.on("error", (error) =>
      this.end(errorWithCause("the tmux control client failed", error)),
    );
    this.child.on("close", (code, signal) => {
      if (this.ended) return;
      this.end(
        new Error(
          `the tmux control client for session ${session} exited (${signal ?? `code ${code}`})${this.stderr ? `: ${this.stderr.trim()}` : ""}`,
        ),
      );
    });
  }

  get idle(): boolean {
    return this.watches.size === 0;
  }

  add(watch: Watch): void {
    this.watches.add(watch);
    this.requestSnapshot(watch);
  }

  remove(watch: Watch): void {
    this.watches.delete(watch);
    if (this.idle) this.close();
  }

  /** 見ている側を残さず外す (サーバの終了)。 */
  close(): void {
    if (this.ended) return;
    this.ended = true;
    this.watches.clear();
    this.onEnd(this);
    // 標準入力を閉じると tmux はこのクライアントを外して %exit を送り、終わる。
    this.child.stdin?.end();
    const timer = setTimeout(() => stopProcess(this.child, "SIGTERM"), 2000);
    timer.unref?.();
    this.child.once("close", () => clearTimeout(timer));
  }

  /**
   * コマンドを `;` で並べて 1 行で送る。tmux は間にペインの出力を挟まずに続けて
   * 実行し、コマンドごとに返事を返す。途中で失敗すると残りは実行せず返事も
   * 返さない (cmd-queue.c の cmdq_remove_group) ので、そのときは残りの受け取り口を
   * 外し、届いた分だけで done を呼ぶ。
   */
  private send(commands: string[], done: (replies: Reply[]) => void): void {
    if (this.ended) return;
    const replies: Reply[] = [];
    commands.forEach((_, index) => {
      this.replies.push((reply) => {
        replies.push(reply);
        if (!reply.ok) {
          this.replies.splice(0, commands.length - 1 - index);
          done(replies);
        } else if (index === commands.length - 1) done(replies);
      });
    });
    this.child.stdin?.write(`${commands.join(" ; ")}\n`);
  }

  private requestSnapshot(watch: Watch): void {
    watch.live = false;
    const capture = `capture-pane -p -e -J -t ${watch.pane} -S -${PANE_WATCH_HISTORY_LINES}`;
    this.send([metaCommand(watch.pane), capture], ([metaReply, reply]) => {
      if (!this.watches.has(watch)) return;
      const meta = metaReply?.ok
        ? readPaneMeta(metaReply.lines[0]?.toString("utf8") ?? "", watch.pane)
        : null;
      if (!meta || !reply?.ok) {
        this.drop(watch);
        watch.watcher.gone();
        return;
      }
      const { historySize, ...state } = meta;
      watch.cols = state.width;
      watch.rows = state.height;
      watch.decoder = new TextDecoder();
      watch.live = true;
      watch.watcher.snapshot({
        ...state,
        pane: watch.pane,
        historyLines: Math.min(historySize, PANE_WATCH_HISTORY_LINES),
        content: closeLineColors(
          Buffer.concat(
            reply.lines.flatMap((line) => [line, Buffer.from("\n")]),
          )
            .toString("utf8")
            .replace(/\n$/, ""),
        ),
      });
    });
  }

  /** 窓の並びが変わった: 大きさが変わっていれば読み直し、無くなっていれば終える。 */
  private checkSize(watch: Watch): void {
    if (watch.checking || !watch.live) return;
    watch.checking = true;
    this.send([metaCommand(watch.pane)], ([reply]) => {
      watch.checking = false;
      if (!this.watches.has(watch)) return;
      const meta = reply?.ok
        ? readPaneMeta(reply.lines[0]?.toString("utf8") ?? "", watch.pane)
        : null;
      if (!meta) {
        this.drop(watch);
        watch.watcher.gone();
        return;
      }
      if (meta.width !== watch.cols || meta.height !== watch.rows)
        this.requestSnapshot(watch);
    });
  }

  private drop(watch: Watch): void {
    this.watches.delete(watch);
    if (this.idle) this.close();
  }

  private dispatch(event: ControlEvent): void {
    switch (event.kind) {
      case "output":
        for (const watch of this.watches) {
          if (watch.pane === event.pane && watch.live)
            watch.watcher.output(
              watch.decoder.decode(event.data, { stream: true }),
            );
        }
        return;
      case "reply":
        // 繋いだ直後の attach の返事 (このクライアントが送ったものではない) は数えない。
        if (event.ours)
          this.replies.shift()?.({ ok: event.ok, lines: event.lines });
        return;
      case "layout":
      case "window-close":
        for (const watch of [...this.watches]) this.checkSize(watch);
        return;
      case "exit":
        // セッションが終わった・tmux が止まった。見ている側には「無くなった」で伝える。
        for (const watch of [...this.watches]) watch.watcher.gone();
        this.watches.clear();
        this.ended = true;
        this.onEnd(this);
        return;
      case "other":
        return;
    }
  }

  private end(error: Error): void {
    if (this.ended) return;
    this.ended = true;
    const watches = [...this.watches];
    this.watches.clear();
    this.onEnd(this);
    for (const watch of watches) watch.watcher.failed(error);
    stopProcess(this.child, "SIGTERM");
  }
}

const connections = new Map<string, ControlConnection>();

/** そのペインのセッション ($数字)。ペインが無ければ null。 */
async function paneSession(
  pane: TmuxPaneId,
  cwd: string,
): Promise<
  | { status: "ok"; session: string }
  | { status: "gone" }
  | { status: "error"; error: Error }
> {
  const result = await runTmux(
    ["display-message", "-p", "-t", pane, "#{pane_id} #{session_id}"],
    cwd,
  );
  if (result.status === "error") return result;
  if (result.status !== "ok") return { status: "gone" };
  // tmux 3.7 は無いペインを -t に渡しても失敗せず、空のフィールドを返す (focus.ts)。
  const [id, session] = result.stdout.trim().split(" ");
  if (id !== pane || !session || !/^\$[0-9]+$/.test(session))
    return { status: "gone" };
  return { status: "ok", session };
}

/**
 * ペインを見始める。最初に snapshot が 1 回届き、その後は出力が届く。止めるときは
 * 返した stop を呼ぶ (呼ばないと tmux のクライアントが残る)。
 */
export async function watchTmuxPane(
  pane: TmuxPaneId,
  cwd: string,
  watcher: PaneWatcher,
): Promise<PaneWatchResult> {
  const resolved = await paneSession(pane, cwd);
  if (resolved.status !== "ok") return resolved;
  let connection = connections.get(resolved.session);
  if (!connection) {
    connection = new ControlConnection(resolved.session, cwd, (ended) => {
      if (connections.get(ended.session) === ended)
        connections.delete(ended.session);
    });
    connections.set(resolved.session, connection);
  }
  const watch: Watch = {
    pane,
    watcher,
    live: false,
    checking: false,
    cols: 0,
    rows: 0,
    decoder: new TextDecoder(),
  };
  const owner = connection;
  owner.add(watch);
  return { status: "ok", stop: () => owner.remove(watch) };
}

/** サーバの終了時。繋いでいる control mode のクライアントを全部外す。 */
export function closeAllPaneWatches(): void {
  for (const connection of [...connections.values()]) connection.close();
}
