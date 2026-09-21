// エージェントの設定ファイルへ、状態を知らせるフックを入れる・外す。
//
// 変える外部状態と戻し方 (server.md「外部状態を変える機能」):
//
// - claude: `<設定ディレクトリ>/settings.json` の hooks に、コマンド文字列に
//   AGENT_HOOK_MARKER を含むフックを足す。codex: `<CODEX_HOME>/hooks.json`
//   に同じ形で足す。戻すには設定画面の「外す」か、印を含むフックを手で消す。
//   書く前のファイルは同じディレクトリに `<名前>.code-viewer-backup-<時刻>`
//   として残る
// - code-viewer の状態ディレクトリに起動スクリプト (code-viewer-agent-hook)
//   を置く。フックはこれを呼ぶ。外してもこのファイルは残る (ほかのエージェント
//   の分がまだ使っているかもしれないため)。消してよいのは両方外した後
//
// 検出は doctor の agent-hooks グループ (server/doctor.ts)。
//
// 設定ファイルの扱いの約束 (読めなければ書かない・ハッシュの照合・
// バックアップ・一時ファイルで置き換え・リンクのまま) は settings-file.ts。

import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  AGENT_HOOK_MARKER,
  type AgentHookFailure,
  type AgentHookPlanResponse,
  type AgentHookStatus,
  type AgentHooksResponse,
  checkHookShape,
  HOOK_SPECS,
  type HookAction,
  type HookAgent,
  hookEntriesState,
  type LauncherHealth,
  planHookChange,
  serializeHookFile,
} from "../../core/agent-hooks";
import { errorWithCause, formatErrorDetail } from "../../core/error-detail";
import { shellSingleQuote } from "../cli-helpers";
import { ROOT } from "../root";
import { codeViewerStateDir } from "../user-state-dir";
import {
  backupPathFor,
  commitJsonSettingsChange,
  contentHash,
  DEFAULT_WRITE_OPS,
  errno,
  readJsonSettingsFile,
  type SettingsWriteOps,
  writeBlockedReason,
  writeFileAtomic,
} from "./settings-file";

type Env = Record<string, string | undefined>;

/**
 * 設定ディレクトリの既定。エージェント自身と同じ環境変数を見る
 * (CLAUDE_CONFIG_DIR / CODEX_HOME)。無ければ ~/.claude と ~/.codex。
 * 呼び出し側は別のディレクトリを渡してよい (アカウントごとの設定など)。
 */
export function defaultAgentConfigDir(
  agent: HookAgent,
  env: Env = process.env,
  home: string = homedir(),
): string {
  if (agent === "claude") return env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  return env.CODEX_HOME || join(home, ".codex");
}

export function agentHookFile(agent: HookAgent, configDir: string): string {
  return join(configDir, agent === "claude" ? "settings.json" : "hooks.json");
}

/**
 * code-viewer の状態ディレクトリのうち、フック用の場所。起動スクリプトと
 * 失敗の記録を置く。キャッシュ (~/.cache) に置くと掃除で消えて、入れた
 * フックが呼び先を失うので、状態ディレクトリに置く。
 */
export function agentHookStateDir(
  env: Env = process.env,
  home: string = homedir(),
): string {
  return join(codeViewerStateDir(env, home), "agent-hooks");
}

/** 起動スクリプトが呼ぶもの。 */
export type HookLauncher = {
  /** 起動スクリプトの場所。フックのコマンドはここを指す。 */
  path: string;
  failureLog: string;
  node: string;
  cli: string;
  /** テスト用のサーバ登録簿の場所。設定されているときだけ引き継ぐ。 */
  registryDir: string;
};

export function currentHookLauncher(
  stateDir: string = agentHookStateDir(),
  env: Env = process.env,
): HookLauncher {
  return {
    path: join(stateDir, AGENT_HOOK_MARKER),
    failureLog: join(stateDir, "failures.jsonl"),
    node: process.execPath,
    cli: join(ROOT, "dist", "code-viewer.js"),
    registryDir: env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR ?? "",
  };
}

/** 空白などを含むときだけ引用符で囲む。フックの設定を読みやすく保つため。 */
export function shellWord(value: string): string {
  return /^[A-Za-z0-9_./@%+=:,-]+$/.test(value)
    ? value
    : shellSingleQuote(value);
}

/**
 * 設定ファイルに書くコマンド。起動スクリプトの場所と種類だけにする。
 * code-viewer の場所 (版が上がると変わる) は起動スクリプトの中に置くので、
 * 版が上がってもこの文字列は変わらない。codex はフックの定義のハッシュで
 * 信頼を記録するので、文字列が変わると信頼し直しになる。
 */
export function agentHookCommand(launcher: HookLauncher, agent: HookAgent) {
  return `${shellWord(launcher.path)} ${agent}`;
}

/**
 * 起動スクリプトの中身。code-viewer の場所が消えていても、エージェントを
 * 止めない終了コード (0) で抜け、理由を失敗の記録に残す。
 */
export function hookLauncherScript(launcher: HookLauncher): string {
  // 記録の 1 行のうち、時刻と種類以外の部分。printf の書式には入れず
  // 引数で渡すので、パスに % や ' が含まれていても崩れない。
  const missing = JSON.stringify({
    stage: "launch",
    detail: `code-viewer is not at ${launcher.cli} (node: ${launcher.node}). Open code-viewer's settings and use "Repair" in Agent integration.`,
  }).slice(1, -1);
  const registry = launcher.registryDir
    ? `CODE_VIEWER_TEST_SERVER_REGISTRY_DIR=${shellSingleQuote(launcher.registryDir)}\nexport CODE_VIEWER_TEST_SERVER_REGISTRY_DIR\n`
    : "";
  return `#!/bin/sh
# Written by code-viewer. Agent hooks call this to report their state to every
# running code-viewer server. Rewritten by Settings > Agent integration.
node=${shellSingleQuote(launcher.node)}
cli=${shellSingleQuote(launcher.cli)}
log=${shellSingleQuote(launcher.failureLog)}
missing=${shellSingleQuote(missing)}
${registry}if [ ! -x "$node" ] || [ ! -f "$cli" ]; then
  printf '{"at":%s000,"agent":"%s",%s}\\n' "$(date +%s)" "$1" "$missing" >> "$log"
  exit 0
fi
exec "$node" "$cli" terminal hook --agent "$1" --log "$log"
`;
}

/** 起動スクリプトの 1 行 `name='value'` から値を取り出す。 */
function launcherValue(script: string, name: string): string | null {
  const match = new RegExp(`^${name}=('(?:[^']|'\\\\'')*')$`, "m").exec(script);
  if (!match?.[1]) return null;
  return match[1].slice(1, -1).replace(/'\\''/g, "'");
}

export function launcherHealth(launcher: HookLauncher): LauncherHealth {
  let script: string;
  try {
    script = readFileSync(launcher.path, "utf8");
  } catch (error) {
    if (errno(error) === "ENOENT") {
      return { state: "missing", path: launcher.path, detail: "" };
    }
    return {
      state: "unreadable",
      path: launcher.path,
      detail: formatErrorDetail(error),
    };
  }
  const node = launcherValue(script, "node");
  const cli = launcherValue(script, "cli");
  if (!node || !cli) {
    return {
      state: "unreadable",
      path: launcher.path,
      detail: "the launcher does not name node and code-viewer",
    };
  }
  const gone = [node, cli].filter((path) => {
    try {
      statSync(path);
      return false;
    } catch (error) {
      if (errno(error) === "ENOENT") return true;
      throw errorWithCause(`failed to check ${path}`, error);
    }
  });
  if (gone.length > 0) {
    return {
      state: "target-missing",
      path: launcher.path,
      detail: gone.join("\n"),
    };
  }
  return {
    state: script === hookLauncherScript(launcher) ? "ok" : "other-install",
    path: launcher.path,
    detail: cli,
  };
}

/**
 * 起動スクリプトだけを書く (書き直す)。設定ファイルは触らない。
 *
 * 設定ファイルが書けない場所 (読み取り専用のリンク先) にあって、利用者が
 * フックを生成元に自分で写すときに使う。写したフックが呼ぶ先を先に用意して
 * おかないと、呼び先の無いフックが記録も残さずに失敗する。
 */
export function writeHookLauncher(launcher: HookLauncher): boolean {
  try {
    return ensureLauncher(launcher);
  } catch (error) {
    throw new AgentHookError(
      `failed to write the hook launcher ${launcher.path}; the settings file was not changed.`,
      "failed",
      { cause: error },
    );
  }
}

function ensureLauncher(launcher: HookLauncher): boolean {
  const script = hookLauncherScript(launcher);
  try {
    if (readFileSync(launcher.path, "utf8") === script) return false;
  } catch (error) {
    if (errno(error) !== "ENOENT") throw error;
  }
  mkdirSync(dirname(launcher.path), { recursive: true });
  writeFileAtomic(launcher.path, script, 0o755);
  return true;
}

export type AgentHookTarget = {
  agent: HookAgent;
  configDir: string;
};

function describe(target: AgentHookTarget, launcher: HookLauncher) {
  const path = agentHookFile(target.agent, target.configDir);
  const read = readJsonSettingsFile(target.configDir, path, checkHookShape);
  const command = agentHookCommand(launcher, target.agent);
  return { path, read, command, specs: HOOK_SPECS[target.agent] };
}

export function agentHookStatus(
  target: AgentHookTarget,
  launcher: HookLauncher,
  health: LauncherHealth = launcherHealth(launcher),
): AgentHookStatus {
  const { path, read, command, specs } = describe(target, launcher);
  const base = {
    agent: target.agent,
    configDir: target.configDir,
    path,
    realPath: read.kind === "missing-dir" ? path : read.realPath,
    symlink:
      read.kind === "ok" || read.kind === "unreadable" ? read.symlink : false,
    writeBlocked: writeBlockedReason(path, read),
  };
  if (read.kind === "missing-dir") {
    return {
      ...base,
      state: "no-config-dir",
      detail: target.configDir,
      kept: 0,
    };
  }
  if (read.kind === "unreadable") {
    return { ...base, state: "unreadable", detail: read.detail, kept: 0 };
  }
  const root = read.kind === "ok" ? read.root : null;
  const entries = hookEntriesState(root, specs, command);
  const kept = planHookChange(root, "uninstall", specs, command).kept;
  if (entries === "none") return { ...base, state: "none", detail: "", kept };
  if (health.state === "missing" || health.state === "target-missing") {
    return {
      ...base,
      state: "broken",
      detail: health.state === "missing" ? health.path : health.detail,
      kept,
    };
  }
  return { ...base, state: entries, detail: "", kept };
}

export class AgentHookError extends Error {
  constructor(
    message: string,
    readonly code: "conflict" | "blocked" | "unreadable" | "failed",
    options?: { cause?: unknown },
  ) {
    super(message);
    if (options && "cause" in options) {
      Object.assign(this, { cause: options.cause });
    }
  }
}

export function planAgentHooks(
  target: AgentHookTarget,
  action: HookAction,
  launcher: HookLauncher,
  now: Date = new Date(),
): AgentHookPlanResponse {
  const { path, read, command, specs } = describe(target, launcher);
  if (read.kind === "missing-dir") {
    throw new AgentHookError(
      `the ${target.agent} settings directory does not exist: ${target.configDir}`,
      "unreadable",
    );
  }
  if (read.kind === "unreadable") {
    throw new AgentHookError(
      `cannot read ${path}; nothing was changed.\n${read.detail}`,
      "unreadable",
    );
  }
  const root = read.kind === "ok" ? read.root : null;
  const plan = planHookChange(root, action, specs, command);
  const original = read.kind === "ok" ? read.text : null;
  const health = launcherHealth(launcher);
  return {
    agent: target.agent,
    action,
    path,
    realPath: read.realPath,
    symlink: read.kind === "ok" ? read.symlink : false,
    fileExists: read.kind === "ok",
    added: plan.added,
    removed: plan.removed,
    kept: plan.kept,
    changed: plan.changed,
    backupPath:
      plan.changed && read.kind === "ok" ? backupPathFor(path, now) : null,
    formattingChanged:
      original !== null && serializeHookFile(root, original) !== original,
    launcher: {
      path: launcher.path,
      write: action === "install" && health.state !== "ok",
    },
    writeBlocked: writeBlockedReason(path, read),
    baseHash: contentHash(read),
  };
}

export type AgentHookApplyResult = {
  path: string;
  changed: boolean;
  backupPath: string | null;
  launcherWritten: boolean;
};

/**
 * 確認画面で見せた計画を実行する。
 *
 * @param baseHash 確認画面を作ったときの中身のハッシュ。今の中身と違えば
 *   書かない (その間にほかの誰かが書き換えた)。
 */
export function applyAgentHooks(
  target: AgentHookTarget,
  action: HookAction,
  launcher: HookLauncher,
  baseHash: string,
  now: Date = new Date(),
  ops: SettingsWriteOps = DEFAULT_WRITE_OPS,
): AgentHookApplyResult {
  const plan = planAgentHooks(target, action, launcher, now);
  if (plan.baseHash !== baseHash) {
    throw new AgentHookError(
      `${plan.path} changed after it was shown for confirmation; nothing was changed. Review it again.`,
      "conflict",
    );
  }
  if (plan.writeBlocked && plan.changed) {
    throw new AgentHookError(
      `cannot write ${plan.realPath}; nothing was changed.\n${plan.writeBlocked}`,
      "blocked",
    );
  }
  const launcherWritten =
    action === "install" ? writeHookLauncher(launcher) : false;
  if (!plan.changed) {
    return {
      path: plan.path,
      changed: false,
      backupPath: null,
      launcherWritten,
    };
  }
  const { backupPath } = commitJsonSettingsChange({
    configDir: target.configDir,
    path: plan.path,
    check: checkHookShape,
    baseHash,
    next: (root, text) =>
      serializeHookFile(
        planHookChange(
          root,
          action,
          HOOK_SPECS[target.agent],
          agentHookCommand(launcher, target.agent),
        ).next,
        text,
      ),
    now,
    ops,
    error: (code, message, cause) =>
      new AgentHookError(
        message,
        code,
        cause === undefined ? undefined : { cause },
      ),
  });
  return {
    path: plan.path,
    changed: true,
    backupPath,
    launcherWritten,
  };
}

/** 失敗の記録の上限。超えたら古いほうから捨てる。 */
const MAX_FAILURE_LOG_BYTES = 256 * 1024;
const KEEP_FAILURE_LINES = 200;

/**
 * フックの失敗を 1 件残す。フック側 (terminal hook) から呼ぶ。
 * 書けなかったら例外をそのまま投げる (呼び出し側が stderr に出す)。
 */
export function appendHookFailure(
  logPath: string,
  failure: AgentHookFailure,
): void {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${JSON.stringify(failure)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  if (statSync(logPath).size <= MAX_FAILURE_LOG_BYTES) return;
  const lines = readFileSync(logPath, "utf8").split("\n").filter(Boolean);
  writeFileAtomic(
    logPath,
    `${lines.slice(-KEEP_FAILURE_LINES).join("\n")}\n`,
    0o600,
  );
}

function parseFailureLine(line: string): AgentHookFailure {
  try {
    const raw = JSON.parse(line) as Record<string, unknown>;
    const text = (key: string) =>
      typeof raw[key] === "string" ? (raw[key] as string) : "";
    return {
      at: typeof raw.at === "number" ? raw.at : 0,
      agent: text("agent"),
      hookEvent: text("hookEvent"),
      event: text("event"),
      target: text("target"),
      server: text("server"),
      stage: text("stage"),
      detail: text("detail"),
    };
  } catch (error) {
    return {
      at: 0,
      agent: "",
      hookEvent: "",
      event: "",
      target: "",
      server: "",
      stage: "log",
      detail: `unreadable log line: ${line}\n${formatErrorDetail(error)}`,
    };
  }
}

export function readHookFailures(
  logPath: string,
  limit = 10,
): AgentHooksResponse["failures"] {
  let text: string;
  try {
    text = readFileSync(logPath, "utf8");
  } catch (error) {
    if (errno(error) === "ENOENT")
      return { total: 0, recent: [], log: logPath };
    throw errorWithCause(`failed to read ${logPath}`, error);
  }
  const lines = text.split("\n").filter(Boolean);
  return {
    total: lines.length,
    recent: lines.slice(-limit).reverse().map(parseFailureLine),
    log: logPath,
  };
}

export function clearHookFailures(logPath: string): void {
  try {
    unlinkSync(logPath);
  } catch (error) {
    if (errno(error) === "ENOENT") return;
    throw error;
  }
}

export function agentHooksOverview(
  targets: AgentHookTarget[],
  launcher: HookLauncher,
): AgentHooksResponse {
  const health = launcherHealth(launcher);
  return {
    home: homedir(),
    agents: targets.map((target) => agentHookStatus(target, launcher, health)),
    launcher: health,
    failures: readHookFailures(launcher.failureLog),
  };
}
