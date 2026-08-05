// ブラウザ専用のシェルを PTY で起動し、生きている間だけ保持する。
//
// tmux ペインと違い、このシェルは code-viewer の子プロセスとして生まれる。
// サーバが落ちればシェルも消える。tmux 側のペインには一切触れない。
//
// node-pty はネイティブモジュールで、任意依存。入っていない環境でもサーバ
// 自体は起動できる必要があるので、読み込みは動的に行い、失敗したら「使えな
// い」という状態として扱う (SQLite ドライバと同じ方針)。
//
// 出力は購読者へそのまま流すが、購読していない間の出力も捨てない。ブラウザ
// を開き直したときに直前の画面が真っ白にならないよう、末尾の一定量だけ保持
// しておき、購読開始時にまとめて渡す。

import {
  errorWithCause,
  errorWithCauses,
  formatErrorDetail,
} from "../../core/error-detail";
import { makeTimedId } from "../../core/id";
import {
  clampShellSize,
  DEFAULT_SHELL_COLS,
  DEFAULT_SHELL_ROWS,
  SHELL_ID_PREFIX,
  type ShellSession,
  type ShellSessionId,
} from "../../core/shell";
import { runAsync } from "../runtime";

/**
 * 購読していない間に貯めておく出力の上限 (文字数)。開き直したときに直近の
 * 画面が復元できれば足りるので、履歴として持つことは狙わない。
 */
const REPLAY_BUFFER_LIMIT = 200_000;

type PtyProcess = {
  readonly pid: number;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number }) => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
};

type PtyModule = {
  spawn(
    file: string,
    args: string[],
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: NodeJS.ProcessEnv;
    },
  ): PtyProcess;
};

type SessionEntry = {
  meta: ShellSession;
  pty: PtyProcess;
  /** 購読開始時に流し込む直近の出力。 */
  replay: string;
  /**
   * 開始からの累積文字数。replay から溢れて捨てた分も数える。差分で本文を
   * 渡すときの位置がこれになる (core/terminal-capture の sliceShellBuffer)。
   */
  totalChars: number;
  listeners: Set<(chunk: string) => void>;
  exitListeners: Set<(exitCode: number) => void>;
  /**
   * 最初の出力を受けたか。プロンプトが出た = シェルが入力を読む状態になった
   * 合図として使う (writeToShellWhenReady)。
   */
  ready: boolean;
  /** ready になるまで溜めておく入力と、その書込み結果を待つ呼出側。 */
  queued: Array<{
    data: string;
    resolve(result: ShellWriteResult): void;
  }>;
};

const sessions = new Map<ShellSessionId, SessionEntry>();

/** node-pty の読み込み結果。プロセス内で 1 度だけ試す。 */
let ptyModulePromise: Promise<PtyModule | null> | null = null;
let ptyLoadError: Error | null = null;

function loadPty(): Promise<PtyModule | null> {
  if (!ptyModulePromise) {
    ptyModulePromise = import("@lydell/node-pty")
      .then((mod) => mod as unknown as PtyModule)
      .catch((err: unknown) => {
        ptyLoadError = errorWithCause("failed to load the PTY module", err);
        return null;
      });
  }
  return ptyModulePromise;
}

/** available が true のとき reason は空文字。tsconfig が strict ではないので
 * 判別可能ユニオンの絞り込みに頼らず、常に両方持たせる。 */
export type ShellAvailability = {
  available: boolean;
  reason: string;
};

export async function describeShellAvailability(): Promise<ShellAvailability> {
  const pty = await loadPty();
  if (pty) return { available: true, reason: "" };
  return {
    available: false,
    reason:
      (ptyLoadError ? formatErrorDetail(ptyLoadError) : "") ||
      "@lydell/node-pty is an optional dependency required for opening shells.",
  };
}

/** ログインシェル。ユーザーの環境をそのまま使う。 */
function resolveShellCommand(): string {
  return process.env.SHELL || "/bin/sh";
}

/** ps が応答しないときに待ち続けない。ローカルの ps は数 ms で返る。 */
const PS_TIMEOUT_MS = 2000;

/**
 * この PTY の端末デバイス名を引く。
 *
 * node-pty は tty 名を公開していないので、PTY の「中」で動いているプロセス
 * の側から ps で引く。PTY を作った時点で端末は確定しているので、spawn 直後に
 * 1 度だけ引けばよい (以後は変わらない)。
 *
 * ps が返すのは `ttys012` や `pts/3` のような /dev を落とした形なので、
 * tmux の `#{client_tty}` と同じ絶対パスに揃える。端末を持たないプロセスは
 * `?` や `??` を返すので、その場合は空にする。
 *
 * `ps` の実行自体が失敗した場合は、端末を特定できなかった事実を呼出側へ返す。
 * 端末を持たないことを表す正常な `?` / `??` だけは空文字として扱う。
 */
async function resolvePtyTty(pid: number, cwd: string): Promise<string> {
  try {
    const result = await runAsync(
      ["ps", "-o", "tty=", "-p", String(pid)],
      cwd,
      { timeout: PS_TIMEOUT_MS },
    );
    if (result.code !== 0) {
      const details = [
        `ps exited with ${result.code}`,
        result.stderr ? `stderr: ${result.stderr}` : "",
        result.stdout ? `stdout: ${result.stdout}` : "",
      ].filter(Boolean);
      throw new Error(details.join("\n"));
    }
    const raw = result.stdout.trim();
    if (!raw || raw.startsWith("?")) return "";
    return raw.startsWith("/") ? raw : `/dev/${raw}`;
  } catch (error) {
    throw errorWithCause("failed to resolve the PTY terminal", error);
  }
}

export function listShellSessions(): ShellSession[] {
  return [...sessions.values()]
    .map((entry) => entry.meta)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getShellSession(id: ShellSessionId): ShellSession | null {
  return sessions.get(id)?.meta ?? null;
}

export type CreateShellResult =
  | { status: "ok"; session: ShellSession }
  | { status: "unavailable"; reason: string }
  | { status: "error"; error: Error };

export async function createShellSession(
  cwd: string,
  size: { cols?: number; rows?: number } = {},
): Promise<CreateShellResult> {
  const pty = await loadPty();
  if (!pty) {
    return {
      status: "unavailable",
      reason: ptyLoadError ? formatErrorDetail(ptyLoadError) : "",
    };
  }

  const { cols, rows } = clampShellSize(
    size.cols ?? DEFAULT_SHELL_COLS,
    size.rows ?? DEFAULT_SHELL_ROWS,
  );
  const command = resolveShellCommand();
  // makeTimedId は `<prefix>-<base36>` を返す。SHELL_ID_PREFIX の末尾の
  // ハイフンがそこに当たるので、prefix はハイフンを外して渡す。
  const id = makeTimedId(SHELL_ID_PREFIX.replace(/-$/, ""));

  let child: PtyProcess;
  try {
    child = pty.spawn(command, [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      // シェルの中で動くエージェントが、自分がどのセッションかを名乗れる
      // ようにする。フックはこれを `terminal state --target` に渡す
      // (tmux 側は $TMUX_PANE が同じ役割を持つ)。
      env: {
        ...process.env,
        TERM: "xterm-256color",
        CODE_VIEWER_SHELL_ID: id,
      },
    });
  } catch (err) {
    return {
      status: "error",
      error: errorWithCause("failed to spawn the shell", err),
    };
  }

  let tty: string;
  try {
    tty = await resolvePtyTty(child.pid, cwd);
  } catch (error) {
    try {
      child.kill();
    } catch (cleanupError) {
      return {
        status: "error",
        error: errorWithCauses(
          "failed to create the shell and stop its child process",
          [error, cleanupError],
        ),
      };
    }
    return {
      status: "error",
      error:
        error instanceof Error
          ? error
          : errorWithCause("failed to resolve the PTY terminal", error),
    };
  }

  const entry: SessionEntry = {
    meta: {
      id,
      command,
      cwd,
      createdAt: new Date().toISOString(),
      cols,
      rows,
      exited: false,
      exitCode: null,
      // 端末は PTY を作った時点で確定しているので、ここで 1 度引けば足りる。
      // このシェルの中で tmux を起動したとき、これが宛先になる。
      tty,
    },
    pty: child,
    replay: "",
    totalChars: 0,
    listeners: new Set(),
    exitListeners: new Set(),
    ready: false,
    queued: [],
  };

  child.onData((chunk) => {
    entry.replay = `${entry.replay}${chunk}`.slice(-REPLAY_BUFFER_LIMIT);
    entry.totalChars += chunk.length;
    // 最初の出力が出た = プロンプトが立ち、シェルが入力を読む状態になった。
    // 待たせていた入力があればここで流す。
    markShellReady(entry);
    for (const listener of [...entry.listeners]) listener(chunk);
  });
  child.onExit(({ exitCode }) => {
    entry.meta.exited = true;
    entry.meta.exitCode = exitCode;
    // ready 前に終了した場合も、待っている書込みを gone で必ず完了させる。
    markShellReady(entry);
    // 先に知らせてから片付ける。順序を逆にすると、購読している側は理由を
    // 受け取れないまま接続だけ切れる (人が exit と打ったのか、落ちたのかが
    // 分からなくなる)。
    for (const listener of [...entry.exitListeners]) listener(exitCode);
    // 終わったシェルは一覧に残さない。人が exit と打ったらその場で畳まれる、
    // という普通の端末の感覚に合わせる。tmux から抜けただけならシェルは
    // 生きているので、ここには来ない。
    entry.listeners.clear();
    entry.exitListeners.clear();
    sessions.delete(id);
  });

  // プロンプトを出さないシェルで待ちっぱなしにしない。出力が先に来れば
  // そちらで ready になり、こちらは何もしない。
  const readyTimer = setTimeout(
    () => markShellReady(entry),
    SHELL_READY_TIMEOUT_MS,
  );
  readyTimer.unref?.();

  sessions.set(id, entry);
  return { status: "ok", session: entry.meta };
}

export type ShellSubscription = {
  /** 購読開始時点までに溜まっていた出力。 */
  replay: string;
  unsubscribe(): void;
};

export function subscribeShell(
  id: ShellSessionId,
  onData: (chunk: string) => void,
  onExit: (exitCode: number) => void,
): ShellSubscription | null {
  const entry = sessions.get(id);
  if (!entry) return null;
  entry.listeners.add(onData);
  entry.exitListeners.add(onExit);
  return {
    replay: entry.replay,
    unsubscribe() {
      entry.listeners.delete(onData);
      entry.exitListeners.delete(onExit);
    },
  };
}

/** 差分で本文を渡すために、溜め置きと累積位置をそのまま覗く。 */
export function readShellBuffer(
  id: ShellSessionId,
): { replay: string; totalChars: number } | null {
  const entry = sessions.get(id);
  if (!entry) return null;
  return { replay: entry.replay, totalChars: entry.totalChars };
}

export type ShellWriteResult =
  | { status: "ok" }
  | { status: "gone" }
  | { status: "error"; error: Error };

/**
 * 出力が無いまま待ち続けない上限。プロンプトを出さない設定のシェルでも、
 * ここまで待ったら送ってしまう。
 */
const SHELL_READY_TIMEOUT_MS = 1000;

/** 入力を受け付ける状態になった。待たせていたぶんをここで流す。 */
function markShellReady(entry: SessionEntry): void {
  if (entry.ready) return;
  entry.ready = true;
  const queued = entry.queued.splice(0);
  for (const item of queued) {
    item.resolve(writeToShellEntry(entry, item.data));
  }
}

function writeToShellEntry(
  entry: SessionEntry,
  data: string,
): ShellWriteResult {
  if (entry.meta.exited) return { status: "gone" };
  try {
    entry.pty.write(data);
    return { status: "ok" };
  } catch (error) {
    return {
      status: "error",
      error: errorWithCause("failed to write to the shell", error),
    };
  }
}

/**
 * シェルが入力を受け付けるようになってから流し込む。
 *
 * PTY を作った直後に書くと、シェルが端末を整えている最中に当たって捨てられる
 * (実測で落ちる)。最初の出力 = プロンプトが立った合図なので、それを待ってから
 * 送る。使うのは「開いた直後にこちらから 1 行流し込む」場合だけで、人が打った
 * 鍵は writeToShell でそのまま送ればよい。
 */
export function writeToShellWhenReady(
  id: ShellSessionId,
  data: string,
): Promise<ShellWriteResult> {
  const entry = sessions.get(id);
  if (!entry || entry.meta.exited) return Promise.resolve({ status: "gone" });
  if (entry.ready) return Promise.resolve(writeToShellEntry(entry, data));
  return new Promise((resolve) => {
    entry.queued.push({ data, resolve });
  });
}

export function writeToShell(
  id: ShellSessionId,
  data: string,
): ShellWriteResult {
  const entry = sessions.get(id);
  if (!entry || entry.meta.exited) return { status: "gone" };
  return writeToShellEntry(entry, data);
}

export function resizeShell(
  id: ShellSessionId,
  cols: number,
  rows: number,
): ShellWriteResult {
  const entry = sessions.get(id);
  if (!entry || entry.meta.exited) return { status: "gone" };
  const size = clampShellSize(cols, rows);
  if (size.cols === entry.meta.cols && size.rows === entry.meta.rows) {
    return { status: "ok" };
  }
  try {
    entry.pty.resize(size.cols, size.rows);
    entry.meta.cols = size.cols;
    entry.meta.rows = size.rows;
    return { status: "ok" };
  } catch (err) {
    // リサイズできなくても表示は続けられる。セッションは畳まない。
    return {
      status: "error",
      error: errorWithCause("failed to resize the shell", err),
    };
  }
}

/**
 * kill() の後、これだけ待っても終わらなければ SIGKILL に切り替える。
 * 落ちないシェルを残したままサーバが終わると、PTY が孤児になる。
 */
const SHELL_KILL_GRACE_MS = 2000;

function waitForShellExit(entry: SessionEntry): Promise<boolean> {
  if (entry.meta.exited) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      entry.exitListeners.delete(onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    entry.exitListeners.add(onExit);
    const timer = setTimeout(() => finish(false), SHELL_KILL_GRACE_MS);
    timer.unref?.();
  });
}

export async function closeShellSession(
  id: ShellSessionId,
): Promise<ShellWriteResult> {
  const entry = sessions.get(id);
  if (!entry) return { status: "gone" };
  sessions.delete(id);
  entry.listeners.clear();
  const queued = entry.queued.splice(0);
  entry.ready = true;
  for (const item of queued) item.resolve({ status: "gone" });
  if (entry.meta.exited) {
    entry.exitListeners.clear();
    return { status: "ok" };
  }

  const errors: Error[] = [];
  try {
    entry.pty.kill();
  } catch (error) {
    errors.push(errorWithCause("failed to stop the shell", error));
  }

  let exited = await waitForShellExit(entry);
  if (!exited) {
    let forceKillFailed = false;
    try {
      entry.pty.kill("SIGKILL");
    } catch (error) {
      forceKillFailed = true;
      errors.push(errorWithCause("failed to force-stop the shell", error));
    }
    if (!forceKillFailed) {
      exited = await waitForShellExit(entry);
      if (!exited) {
        errors.push(new Error("shell did not exit after it was force-stopped"));
      }
    }
  }

  entry.exitListeners.clear();
  return errors.length > 0
    ? {
        status: "error",
        error: errorWithCauses("failed to close the shell", errors),
      }
    : { status: "ok" };
}

/** preview.ts の shutdown から呼ぶ。子を残したまま終わらない。 */
export async function closeAllShellSessions(): Promise<ShellWriteResult> {
  const results = await Promise.all(
    [...sessions.keys()].map((id) => closeShellSession(id)),
  );
  const errors = results.flatMap((result) =>
    result.status === "error" ? [result.error] : [],
  );
  return errors.length > 0
    ? {
        status: "error",
        error: errorWithCauses("failed to close all shell sessions", errors),
      }
    : { status: "ok" };
}
