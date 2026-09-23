// 入口として起動するときの引数と、起動の分かれ道 (純関数。テストで表にする)。
//
// `code-viewer` (引数なし・`--cwd`・`--port`・`--open`) は入口になる。
// `--standalone` は今までの 1 つで完結するサーバ (cli.ts が preview.ts へ回す)。
// 裏のプロセスは `--backend` (入口が付ける。人は使わない)。

/** cli.ts が preview.ts (今のサーバ) へ回す引数か。 */
export function runsStandaloneServer(argv: readonly string[]): boolean {
  return argv.some(
    (arg) =>
      arg === "--standalone" ||
      arg === "--backend" ||
      arg === "--help" ||
      arg === "-h" ||
      arg === "--version" ||
      arg === "-v",
  );
}

/**
 * 使われていない裏のプロセスを止めるまでの既定 (秒)。`--idle-stop <秒>` で
 * 変える (0 は止めない)。
 */
export const DEFAULT_IDLE_STOP_SECONDS = 600;

export type EntryArgs = {
  port: number;
  /** 使われていない裏を止めるまでの秒数。0 は止めない。 */
  idleStopSeconds: number;
  cwd: string | null;
  open: boolean;
  /** `--bin <name>=<path>` の値 (入口の tmux・git と、起動したディレクトリの裏に効く)。 */
  bins: string[];
  /** 起動したディレクトリの裏にだけ渡す引数 (`--scope-omit-dir`・git の差分の引数)。 */
  backendArgs: string[];
};

export type EntryArgsResult =
  | { ok: true; args: EntryArgs }
  | { ok: false; error: string };

export function parseEntryArgs(argv: readonly string[]): EntryArgsResult {
  const args: EntryArgs = {
    port: 0,
    idleStopSeconds: DEFAULT_IDLE_STOP_SECONDS,
    cwd: null,
    open: false,
    bins: [],
    backendArgs: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--port") {
      const parsed = Number(argv[++i]);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        return { ok: false, error: "--port requires a TCP port number" };
      }
      args.port = parsed;
    } else if (arg === "--idle-stop") {
      const raw = argv[++i];
      const parsed = Number(raw);
      if (!raw || !Number.isFinite(parsed) || parsed < 0) {
        return {
          ok: false,
          error: "--idle-stop requires a number of seconds (0 = never stop)",
        };
      }
      args.idleStopSeconds = parsed;
    } else if (arg === "--cwd") {
      const next = argv[++i];
      if (!next) return { ok: false, error: "--cwd requires a value" };
      args.cwd = next;
    } else if (arg === "--open") {
      args.open = true;
    } else if (arg === "--bin") {
      const next = argv[++i];
      if (!next) {
        return { ok: false, error: "--bin requires <name>=<absolute-path>" };
      }
      args.bins.push(next);
    } else if (arg === "--scope-omit-dir") {
      const next = argv[++i];
      if (!next) {
        return {
          ok: false,
          error: "--scope-omit-dir requires a directory name",
        };
      }
      args.backendArgs.push(arg, next);
    } else if (arg === "--allow-upload") {
      // Deprecated no-op (preview.ts と同じ)。
    } else {
      args.backendArgs.push(arg);
    }
  }
  return { ok: true, args };
}

/** entry.json と本人確認から分かった、いま動いている入口。 */
export type RunningEntry =
  | { status: "none" }
  | { status: "running"; url: string; pid: number; version: string }
  /** 記録はあるが、読めない・本人確認に失敗した。 */
  | { status: "broken"; detail: string };

export type EntryLaunchDecision =
  /** 動いている同じ版の入口に「このディレクトリを開いて」を送って終わる。 */
  | { kind: "delegate"; url: string }
  /** 版の違う入口が動いている。止めずに知らせて終わる。 */
  | { kind: "other-version"; url: string; pid: number; version: string }
  /** 自分が入口になる。 */
  | { kind: "start" }
  /** 記録が壊れていて判断できない。理由を出して終わる。 */
  | { kind: "broken"; detail: string };

export function decideEntryLaunch(
  running: RunningEntry,
  version: string,
): EntryLaunchDecision {
  if (running.status === "none") return { kind: "start" };
  if (running.status === "broken") {
    return { kind: "broken", detail: running.detail };
  }
  if (running.version !== version) {
    return {
      kind: "other-version",
      url: running.url,
      pid: running.pid,
      version: running.version,
    };
  }
  return { kind: "delegate", url: running.url };
}
