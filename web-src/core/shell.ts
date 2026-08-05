// terminal ドロワーが開くシェルセッションの identity と形。URL
// (?terminal=shell:ab12)、サーバの一覧レスポンス、クライアントの描画が同じ
// 1 つの型を参照するように、client / server 双方から import できる core に
// 置く (core/tmux.ts と同じ役割)。
//
// tmux ペインとの違いは通信の向き。tmux は「今の画面」を取り直して丸ごと
// 置き換えるが、シェルは PTY が吐いた分だけを順に流す。だから描画は追記に
// なり、サイズもブラウザ側が決めて PTY に伝える。

/**
 * シェルセッションの識別子。サーバが払い出す不透明な文字列で、URL にも
 * 載る。tmux のペイン ID (`%12`) と同じ場所に入るので、前置きで区別する。
 */
export type ShellSessionId = string;

/** URL や購読対象で tmux ペインと混ざらないようにする前置き。
 * core/id.ts の makeTimedId が `<prefix>-<...>` を返すので、それに合わせる。 */
export const SHELL_ID_PREFIX = "shell-";

export type ShellSession = {
  id: ShellSessionId;
  /** 起動したコマンド (表示用)。 */
  command: string;
  /** 起動時の作業ディレクトリ。 */
  cwd: string;
  /** ISO8601。一覧の並び順に使う。 */
  createdAt: string;
  cols: number;
  rows: number;
  /** プロセスが終了済みか。終了後も一覧には残し、閉じるまで出力を見られる。 */
  exited: boolean;
  exitCode: number | null;
  /**
   * この PTY の端末デバイス (`/dev/ttys012`)。引けなかった環境では空。
   *
   * このシェルの中で tmux を起動すると、その tmux クライアントは同じ端末に
   * 載る。つまりこの名前が tmux 側の `#{client_tty}` と一致するので、
   * 「どのシェルがどのセッションを映しているか」をこれ 1 つで突き合わせ
   * られる。tmux へ的を絞った指示を出すときの宛先でもある。
   */
  tty: string;
};

export type ShellListResponse = {
  /** node-pty が読み込めたか。false ならシェル機能は使えない。 */
  available: boolean;
  /** 使えない理由 (available が false のときだけ)。 */
  reason?: string;
  sessions: ShellSession[];
};

export type ShellCreateResponse = {
  session: ShellSession;
};

/** 新しいシェルを開くときの既定サイズ。ブラウザ側が測る前の暫定値。 */
export const DEFAULT_SHELL_COLS = 120;
export const DEFAULT_SHELL_ROWS = 32;

/** ブラウザから渡されるサイズの許容範囲。PTY に無茶な値を渡さない。 */
export const MIN_SHELL_COLS = 20;
export const MAX_SHELL_COLS = 1000;
export const MIN_SHELL_ROWS = 5;
export const MAX_SHELL_ROWS = 500;

// 同時に開ける数の上限は持たない。tmux のセッション 1 つにつきシェル 1 本と
// いう対応にしてあるので、本数はユーザーが立てているセッションの数で決まる
// (数十個立てる使い方が普通にある)。上限を置くと、渡り歩いているうちに
// 「多すぎます」で開けなくなる。1 本あたりの負担は PTY と溜め置き
// (REPLAY_BUFFER_LIMIT) だけで、tmux クライアント 1 台ぶんと変わらない。

export function isShellSessionId(value: unknown): value is ShellSessionId {
  return typeof value === "string" && /^shell-[0-9a-z]{6,}$/.test(value);
}

/** ドロワーが今つないでいる対象。tmux ペインかシェルかを 1 つの値で表す。 */
export function isShellTarget(target: string | null): boolean {
  return typeof target === "string" && target.startsWith(SHELL_ID_PREFIX);
}

/** ブラウザが測った桁数・行数を、PTY に渡してよい範囲へ丸める。 */
export function clampShellSize(
  cols: number,
  rows: number,
): {
  cols: number;
  rows: number;
} {
  const clamp = (value: number, min: number, max: number) =>
    Number.isFinite(value)
      ? Math.min(max, Math.max(min, Math.round(value)))
      : min;
  return {
    cols: clamp(cols, MIN_SHELL_COLS, MAX_SHELL_COLS),
    rows: clamp(rows, MIN_SHELL_ROWS, MAX_SHELL_ROWS),
  };
}
