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

import { makeTimedId } from "../../core/id";
import {
  clampShellSize,
  DEFAULT_SHELL_COLS,
  DEFAULT_SHELL_ROWS,
  MAX_SHELL_SESSIONS,
  SHELL_ID_PREFIX,
  type ShellSession,
  type ShellSessionId,
} from "../../core/shell";

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
};

const sessions = new Map<ShellSessionId, SessionEntry>();

/** node-pty の読み込み結果。プロセス内で 1 度だけ試す。 */
let ptyModulePromise: Promise<PtyModule | null> | null = null;
let ptyLoadError = "";

function loadPty(): Promise<PtyModule | null> {
  if (!ptyModulePromise) {
    ptyModulePromise = import("@lydell/node-pty")
      .then((mod) => mod as unknown as PtyModule)
      .catch((err: unknown) => {
        ptyLoadError = err instanceof Error ? err.message : String(err);
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
      ptyLoadError ||
      "@lydell/node-pty is an optional dependency required for opening shells.",
  };
}

/** ログインシェル。ユーザーの環境をそのまま使う。 */
function resolveShellCommand(): string {
  return process.env.SHELL || "/bin/sh";
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
  | { status: "too-many" }
  | { status: "error"; message: string };

export async function createShellSession(
  cwd: string,
  size: { cols?: number; rows?: number } = {},
): Promise<CreateShellResult> {
  const pty = await loadPty();
  if (!pty) {
    return { status: "unavailable", reason: ptyLoadError };
  }
  if (sessions.size >= MAX_SHELL_SESSIONS) {
    return { status: "too-many" };
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
      message: err instanceof Error ? err.message : String(err),
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
    },
    pty: child,
    replay: "",
    totalChars: 0,
    listeners: new Set(),
    exitListeners: new Set(),
  };

  child.onData((chunk) => {
    entry.replay = `${entry.replay}${chunk}`.slice(-REPLAY_BUFFER_LIMIT);
    entry.totalChars += chunk.length;
    for (const listener of [...entry.listeners]) listener(chunk);
  });
  child.onExit(({ exitCode }) => {
    entry.meta.exited = true;
    entry.meta.exitCode = exitCode;
    for (const listener of [...entry.exitListeners]) listener(exitCode);
  });

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
  | { status: "error"; message: string };

export function writeToShell(
  id: ShellSessionId,
  data: string,
): ShellWriteResult {
  const entry = sessions.get(id);
  if (!entry || entry.meta.exited) return { status: "gone" };
  try {
    entry.pty.write(data);
    return { status: "ok" };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
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
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * kill() の後、これだけ待っても終わらなければ SIGKILL に切り替える。
 * 落ちないシェルを残したままサーバが終わると、PTY が孤児になる。
 */
const SHELL_KILL_GRACE_MS = 2000;

export function closeShellSession(id: ShellSessionId): boolean {
  const entry = sessions.get(id);
  if (!entry) return false;
  sessions.delete(id);
  entry.listeners.clear();
  entry.exitListeners.clear();
  if (entry.meta.exited) return true;

  let exited = false;
  try {
    // 終了を見届けるための購読。取り除いた後なので listeners には入れない。
    entry.pty.onExit(() => {
      exited = true;
    });
  } catch {
    // 監視できなくても、下の強制終了は掛けられる。
  }
  try {
    entry.pty.kill();
  } catch (error) {
    // 既に死んでいることが多いが、握り潰すと落とせなかった場合に気付けない。
    console.warn(`[code-viewer] shell kill failed: ${String(error)}`);
  }
  const forceTimer = setTimeout(() => {
    if (exited) return;
    try {
      entry.pty.kill("SIGKILL");
    } catch (error) {
      console.warn(`[code-viewer] shell force kill failed: ${String(error)}`);
    }
  }, SHELL_KILL_GRACE_MS);
  // 猶予のためだけにプロセスを生かし続けない。
  forceTimer.unref?.();
  return true;
}

/** preview.ts の shutdown から呼ぶ。子を残したまま終わらない。 */
export function closeAllShellSessions(): void {
  for (const id of [...sessions.keys()]) closeShellSession(id);
}
