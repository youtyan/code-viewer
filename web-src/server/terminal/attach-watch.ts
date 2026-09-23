// code-viewer が tmux のペインを映すために開いたシェルを見張り、映していた
// ウインドウが終わったらシェルを閉じる (そのシェルのタブもブラウザで閉じる)。
//
// タブが映しているのは、attach したペインのウインドウ全体 (そのウインドウの
// ペイン全部)。ウインドウの中のペインが 1 つ終わっても、同じウインドウに
// ペインが残っていれば、tmux はそのウインドウの別のペインを前面にするだけで、
// タブは同じウインドウを映し続けている。閉じない (宛先をその前面のペインへ
// 移す。タブの名前は、一覧の名前と同じくそのペインで付く)。
//
// 閉じるのは、ウインドウが終わって tmux がクライアントを別のウインドウ
// (別のエージェント) へ移したとき。タブがそのまま別のものを映し始めるのは、
// 利用者の期待と違う。
//
// tmux から抜けた (セッションが終わった・detach した) 場合は、打ち込んだ
// attach の 1 行の `&& exit` (tmux/focus.ts) でシェルが自分で終わる。ここが
// 見るのは、tmux が別のウインドウへ移した場合と、ペインが無くなったのに
// シェルが残っている場合。
//
// 利用者の tmux には何も書かない (hook やオプションを置かない。以前
// `window-size manual` が残った事故がある)。シェルに出力が出たら (tmux は
// ペインが変わると画面を描き直す) `list-clients` を読み、映しているペインを
// 確かめるだけ。
//
// 見張るのは、code-viewer が attach を打ち込んだシェルだけ。利用者が自分で
// tmux を起こしたシェル (open.ts の findShellForSession で見つけたもの) は
// 利用者のシェルなので閉じない。

import type { ShellSessionId } from "../../core/shell";
import {
  closeShellSession,
  getShellSession,
  rememberShellTmuxAttachment,
  type ShellWriteResult,
  shellTmuxAttachment,
  watchShellOutput,
} from "../shell/session";
import {
  findClientByTty,
  listTmuxClients,
  type TmuxClientsResult,
} from "../tmux/clients";
import { resolvePaneSession, type TmuxPaneSessionResult } from "../tmux/focus";

/** 出力が続いている間も、tmux に聞くのはこの間隔に 1 回まで。 */
export const ATTACH_CHECK_INTERVAL_MS = 1000;

export type AttachedPaneDecision =
  /** 映しているペインは変わっていない (または、まだ確かめられない)。 */
  | { kind: "keep" }
  /** 利用者が tmux の中で別のペインへ移った。見張る宛先をそちらへ移す。 */
  | { kind: "follow"; session: string; pane: string }
  /** 映していたウインドウが終わった。シェルを閉じる。 */
  | { kind: "close" };

/**
 * 見張っているペイン・そのペインのウインドウ (見張りが最後に見たもの)・その
 * シェルの tmux クライアントが今映しているもの・見張っているペインがまだあるか、
 * から次の手を決める。
 *
 * - クライアントが見張っているペインを映していれば何もしない
 * - 見張っていたペインが無く、クライアントが同じウインドウの別のペインを映して
 *   いる: そのウインドウのペインが 1 つ終わっただけ。宛先を移す
 * - 見張っていたペインが無く、それ以外 (別のウインドウへ移された・クライアントも
 *   居ない・ウインドウをまだ見ていない): 閉じる
 * - 別のペインを映していて、見張っていたペインがまだあれば、利用者が tmux の
 *   中で移っただけ。宛先を移す
 * - クライアントが居ないのにペインがある: attach を打ち込んだ直後でまだ
 *   繋がっていないか、繋げずにシェルへ戻った (tmux の理由が画面に出ている)。
 *   閉じない
 *
 * `watchedPaneExists` は、クライアントが見張っているペインを映していれば
 * 聞かないので null。
 */
export function decideAttachedPane(
  watched: { session: string; pane: string; window: string | null },
  client: { session: string; pane: string; windowId?: string } | null,
  watchedPaneExists: boolean | null,
): AttachedPaneDecision {
  if (client?.pane === watched.pane) return { kind: "keep" };
  if (watchedPaneExists === false)
    return client &&
      watched.window !== null &&
      client.windowId === watched.window
      ? { kind: "follow", session: client.session, pane: client.pane }
      : { kind: "close" };
  if (watchedPaneExists === null) return { kind: "keep" };
  if (client)
    return { kind: "follow", session: client.session, pane: client.pane };
  return { kind: "keep" };
}

export type AttachWatchDeps = {
  attachment(id: ShellSessionId): { session: string; pane: string } | null;
  tty(id: ShellSessionId): string;
  listClients(): Promise<TmuxClientsResult>;
  resolvePane(pane: string): Promise<TmuxPaneSessionResult>;
  follow(id: ShellSessionId, session: string, pane: string): void;
  closeShell(id: ShellSessionId): Promise<ShellWriteResult>;
  watchOutput(id: ShellSessionId, onOutput: () => void): (() => void) | null;
  intervalMs: number;
};

function defaultDeps(cwd: string): AttachWatchDeps {
  return {
    attachment: shellTmuxAttachment,
    tty: (id) => getShellSession(id)?.tty ?? "",
    listClients: () => listTmuxClients(cwd),
    resolvePane: (pane) => resolvePaneSession(pane, cwd),
    // 用途 (ログインのウィンドウ) は付け直さない。open.ts が別のペインへ移した
    // ときと同じく、別のペインへ移れば普通のシェルに戻る。
    follow: (id, session, pane) =>
      rememberShellTmuxAttachment(id, session, pane),
    closeShell: closeShellSession,
    watchOutput: watchShellOutput,
    intervalMs: ATTACH_CHECK_INTERVAL_MS,
  };
}

/** そのシェルで映しているペインを確かめる 1 回。閉じたら true。 */
async function checkAttachedShell(
  id: ShellSessionId,
  deps: AttachWatchDeps,
  /** 見張っているペインのウインドウ (クライアントがそのペインを映していたときに覚える)。 */
  seen: { window: string | null },
): Promise<boolean> {
  const watched = deps.attachment(id);
  if (!watched) return true;
  const listed = await deps.listClients();
  if (listed.status === "error") {
    console.error(
      `[code-viewer] could not list tmux clients to check the pane ${watched.pane} shown in shell ${id}`,
      listed.error,
    );
    return false;
  }
  const client =
    listed.status === "ok"
      ? findClientByTty(listed.clients, deps.tty(id))
      : null;
  if (client?.pane === watched.pane) seen.window = client.windowId ?? null;
  let exists: boolean | null = null;
  if (client?.pane !== watched.pane) {
    const resolved = await deps.resolvePane(watched.pane);
    if (resolved.status === "error") {
      console.error(
        `[code-viewer] could not check whether the tmux pane ${watched.pane} shown in shell ${id} still exists`,
        resolved.error,
      );
      return false;
    }
    exists = resolved.status === "ok";
  }
  // tmux に聞いている間に、ブラウザから別のペインを開いて宛先が変わっていれば
  // この結果は古い。次の出力で確かめ直す。
  const current = deps.attachment(id);
  if (!current) return true;
  if (current.pane !== watched.pane || current.session !== watched.session)
    return false;
  const decision = decideAttachedPane(
    { ...watched, window: seen.window },
    client,
    exists,
  );
  if (decision.kind === "follow") {
    deps.follow(id, decision.session, decision.pane);
    seen.window = client?.windowId ?? null;
    return false;
  }
  if (decision.kind === "keep") return false;
  const closed = await deps.closeShell(id);
  if (closed.status === "error") {
    console.error(
      `[code-viewer] the tmux pane ${watched.pane} shown in shell ${id} ended, but the shell could not be closed`,
      closed.error,
    );
  }
  return true;
}

/**
 * code-viewer が attach を打ち込んだシェルを見張り始める。シェルが終われば
 * (閉じても、自分で終わっても) 見張りも終わる。
 */
export function watchAttachedShell(
  id: ShellSessionId,
  cwd: string,
  deps: AttachWatchDeps = defaultDeps(cwd),
): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let dirty = false;
  let stopped = false;
  let unwatch: (() => void) | null = null;
  const seen: { window: string | null } = { window: null };

  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    unwatch?.();
  };

  const run = async () => {
    timer = null;
    running = true;
    dirty = false;
    try {
      if (await checkAttachedShell(id, deps, seen)) stop();
    } catch (error) {
      console.error(
        `[code-viewer] checking the tmux pane shown in shell ${id} failed`,
        error,
      );
    } finally {
      running = false;
    }
    if (dirty && !stopped) poke();
  };

  // 出力のたびに呼ばれる。間隔の中で何度来ても 1 回にまとめ、確かめている
  // 最中に来た分は終わってからもう 1 回確かめる。
  const poke = () => {
    if (stopped) return;
    if (timer || running) {
      dirty = true;
      return;
    }
    timer = setTimeout(() => void run(), deps.intervalMs);
    timer.unref?.();
  };

  unwatch = deps.watchOutput(id, poke);
  if (!unwatch) stopped = true;
}
