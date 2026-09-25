// claude / codex のアカウントの登録簿と、それに付随する純ロジック。
//
// アカウント = 種類 (claude / codex) と設定ディレクトリの組。claude は
// CLAUDE_CONFIG_DIR、codex は CODEX_HOME にそのディレクトリを渡すと、認証・
// 履歴・セッションがそのディレクトリに分かれる。既定のアカウント (環境変数を
// 渡さないときの ~/.claude・~/.codex) は登録しなくても常にあり、消せない。
//
// 登録簿はユーザー単位の 1 ファイル (server/accounts/registry.ts が読み書き
// する)。ここはファイルに触らない。読んだ JSON の検査、足す・消すの計画、
// プロセスの環境変数からアカウントを求める処理、起動の引数の組み立てだけ。

import type { AgentHookState, HookAgent } from "./agent-hooks";
import { type AgentPane, abbreviateHome } from "./agent-overview";
import { flattenTmuxPanes, type TmuxPane, type TmuxSession } from "./tmux";

export type AccountAgent = HookAgent;

/** アカウントを選ぶ環境変数。取り出すのはこの 2 つだけ。 */
export const ACCOUNT_ENV: Record<
  AccountAgent,
  "CLAUDE_CONFIG_DIR" | "CODEX_HOME"
> = {
  claude: "CLAUDE_CONFIG_DIR",
  codex: "CODEX_HOME",
};

/** 既定のアカウントの設定ディレクトリ (ホームからの相対)。 */
export const DEFAULT_CONFIG_DIR_NAME: Record<AccountAgent, string> = {
  claude: ".claude",
  codex: ".codex",
};

export function defaultAccountId(agent: AccountAgent): string {
  return `${agent}:default`;
}

export function isAccountAgent(value: unknown): value is AccountAgent {
  return value === "claude" || value === "codex";
}

/** 登録簿に書く 1 件。既定のアカウントは書かない。 */
export type StoredAccount = {
  id: string;
  agent: AccountAgent;
  name: string;
  configDir: string;
  /** code-viewer が状態ディレクトリの下に作ったものか (「新しく作る」)。 */
  managed: boolean;
  createdAt: number;
};

/** 前回「新しいエージェント」で選んだもの。次に開いたときの既定にする。 */
export type LaunchChoice = {
  agent: AccountAgent;
  accountId: string;
  project: string;
  session: string;
};

export type AccountRegistry = {
  version: 1;
  accounts: StoredAccount[];
  /** 起動コマンド。空なら種類の名前 (claude / codex)。 */
  launchCommands: Partial<Record<AccountAgent, string>>;
  lastLaunch: LaunchChoice | null;
};

export function emptyAccountRegistry(): AccountRegistry {
  return { version: 1, accounts: [], launchCommands: {}, lastLaunch: null };
}

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 表示名とコマンドの上限。画面に収まり、ファイルが膨らまない程度。 */
export const MAX_ACCOUNT_NAME = 60;
export const MAX_LAUNCH_COMMAND = 400;
/** 登録できるアカウントの数の上限。 */
export const MAX_ACCOUNTS = 64;

function hasControl(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export type AccountNameIssue = "empty" | "too-long" | "control" | null;

export function checkAccountName(name: string): AccountNameIssue {
  const trimmed = name.trim();
  if (!trimmed) return "empty";
  if (trimmed.length > MAX_ACCOUNT_NAME) return "too-long";
  if (hasControl(trimmed)) return "control";
  return null;
}

/**
 * 登録簿として読めるかを確かめる。1 つでも想定外なら、どこが・なぜ、を
 * 全部返す (呼び出し側は書かずにエラーとして見せる)。
 */
export function parseAccountRegistry(
  raw: unknown,
): { ok: true; registry: AccountRegistry } | { ok: false; issues: string[] } {
  if (!isPlainObject(raw)) {
    return { ok: false, issues: ["$: the file must contain a JSON object"] };
  }
  const issues: string[] = [];
  if (raw.version !== 1) {
    issues.push(`$.version: expected 1, found ${JSON.stringify(raw.version)}`);
  }
  const accounts: StoredAccount[] = [];
  if (!Array.isArray(raw.accounts)) {
    issues.push("$.accounts: must be an array");
  } else {
    raw.accounts.forEach((item, index) => {
      const path = `$.accounts[${index}]`;
      if (!isPlainObject(item)) {
        issues.push(`${path}: must be an object`);
        return;
      }
      const { id, agent, name, configDir, managed, createdAt } = item;
      const before = issues.length;
      if (typeof id !== "string" || !id || id.endsWith(":default")) {
        issues.push(`${path}.id: must be a non-default id`);
      }
      if (!isAccountAgent(agent)) {
        issues.push(`${path}.agent: must be "claude" or "codex"`);
      }
      if (typeof name !== "string" || checkAccountName(name) !== null) {
        issues.push(`${path}.name: must be a short name`);
      }
      if (typeof configDir !== "string" || !configDir.startsWith("/")) {
        issues.push(`${path}.configDir: must be an absolute path`);
      }
      if (typeof managed !== "boolean") {
        issues.push(`${path}.managed: must be a boolean`);
      }
      if (typeof createdAt !== "number") {
        issues.push(`${path}.createdAt: must be a number`);
      }
      if (issues.length === before) {
        accounts.push({
          id: id as string,
          agent: agent as AccountAgent,
          name: (name as string).trim(),
          configDir: configDir as string,
          managed: managed as boolean,
          createdAt: createdAt as number,
        });
      }
    });
    const seenIds = new Set<string>();
    const seenDirs = new Set<string>();
    for (const account of accounts) {
      if (seenIds.has(account.id)) {
        issues.push(`$.accounts: the id ${account.id} appears twice`);
      }
      seenIds.add(account.id);
      const key = `${account.agent}\n${normalizeConfigDir(account.configDir)}`;
      if (seenDirs.has(key)) {
        issues.push(
          `$.accounts: ${account.configDir} is registered twice for ${account.agent}`,
        );
      }
      seenDirs.add(key);
    }
  }
  const launchCommands: Partial<Record<AccountAgent, string>> = {};
  if (raw.launchCommands !== undefined) {
    if (!isPlainObject(raw.launchCommands)) {
      issues.push("$.launchCommands: must be an object");
    } else {
      for (const [key, value] of Object.entries(raw.launchCommands)) {
        if (!isAccountAgent(key)) {
          issues.push(`$.launchCommands.${key}: unknown agent`);
        } else if (
          typeof value !== "string" ||
          value.length > MAX_LAUNCH_COMMAND ||
          hasControl(value)
        ) {
          issues.push(`$.launchCommands.${key}: must be a short command`);
        } else if (value.trim()) {
          launchCommands[key] = value.trim();
        }
      }
    }
  }
  let lastLaunch: LaunchChoice | null = null;
  if (raw.lastLaunch !== undefined && raw.lastLaunch !== null) {
    const last = raw.lastLaunch;
    if (
      isPlainObject(last) &&
      isAccountAgent(last.agent) &&
      typeof last.accountId === "string" &&
      typeof last.project === "string" &&
      typeof last.session === "string"
    ) {
      lastLaunch = {
        agent: last.agent,
        accountId: last.accountId,
        project: last.project,
        session: last.session,
      };
    } else {
      issues.push("$.lastLaunch: unexpected shape");
    }
  }
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    registry: { version: 1, accounts, launchCommands, lastLaunch },
  };
}

/** パスの比較用。末尾の / と、途中の // と /./ を畳む。 */
export function normalizeConfigDir(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

export function defaultConfigDir(agent: AccountAgent, home: string): string {
  return normalizeConfigDir(`${home}/${DEFAULT_CONFIG_DIR_NAME[agent]}`);
}

export type AddAccountInput = {
  agent: AccountAgent;
  name: string;
  configDir: string;
  managed: boolean;
};

export type AddAccountIssue =
  | { code: "name"; issue: Exclude<AccountNameIssue, null> }
  | { code: "relative-path"; configDir: string }
  | { code: "default-path"; configDir: string }
  | { code: "duplicate-path"; configDir: string; existing: string }
  | { code: "too-many"; limit: number };

/** 足す前の検査。問題が無ければ null。 */
export function checkAddAccount(
  registry: AccountRegistry,
  input: AddAccountInput,
  home: string,
): AddAccountIssue | null {
  const nameIssue = checkAccountName(input.name);
  if (nameIssue) return { code: "name", issue: nameIssue };
  if (!input.configDir.startsWith("/")) {
    return { code: "relative-path", configDir: input.configDir };
  }
  const dir = normalizeConfigDir(input.configDir);
  if (dir === defaultConfigDir(input.agent, home)) {
    return { code: "default-path", configDir: dir };
  }
  const existing = registry.accounts.find(
    (account) =>
      account.agent === input.agent &&
      normalizeConfigDir(account.configDir) === dir,
  );
  if (existing) {
    return { code: "duplicate-path", configDir: dir, existing: existing.name };
  }
  if (registry.accounts.length >= MAX_ACCOUNTS) {
    return { code: "too-many", limit: MAX_ACCOUNTS };
  }
  return null;
}

export function addAccount(
  registry: AccountRegistry,
  input: AddAccountInput,
  id: string,
  now: number,
): AccountRegistry {
  return {
    ...registry,
    accounts: [
      ...registry.accounts,
      {
        id,
        agent: input.agent,
        name: input.name.trim(),
        configDir: normalizeConfigDir(input.configDir),
        managed: input.managed,
        createdAt: now,
      },
    ],
  };
}

export type RemoveAccountResult =
  | { ok: true; registry: AccountRegistry; removed: StoredAccount }
  | { ok: false; code: "builtin" | "not-found" };

/** 登録簿から外すだけ。設定ディレクトリには触らない。 */
export function removeAccount(
  registry: AccountRegistry,
  id: string,
): RemoveAccountResult {
  if (id.endsWith(":default")) return { ok: false, code: "builtin" };
  const removed = registry.accounts.find((account) => account.id === id);
  if (!removed) return { ok: false, code: "not-found" };
  const lastLaunch =
    registry.lastLaunch?.accountId === id ? null : registry.lastLaunch;
  return {
    ok: true,
    removed,
    registry: {
      ...registry,
      accounts: registry.accounts.filter((account) => account.id !== id),
      lastLaunch,
    },
  };
}

/**
 * 登録するアカウントの名前に使えないもの (小文字)。画面が既定のアカウントに
 * 付ける名前 (views/agents/accounts-i18n.ts の defaultName、英語と日本語)
 * と同じ名前だと、一覧で既定のものと見分けられない。一致はテストが確かめる。
 */
export const RESERVED_ACCOUNT_NAMES = ["default", "既定"] as const;

export type RenameAccountResult =
  | { ok: true; registry: AccountRegistry; renamed: StoredAccount }
  | { ok: false; code: "builtin" | "not-found" | "reserved" }
  | { ok: false; code: "name"; issue: Exclude<AccountNameIssue, null> }
  | { ok: false; code: "duplicate"; existing: string };

/**
 * 表示名を変える。id・種類・設定ディレクトリはそのまま。同じ種類の中で
 * 名前が重なる (大文字小文字を区別しない) もの、既定のアカウントの名前、
 * 空・長すぎ・制御文字は断る。自分と同じ名前は通す (大文字小文字の直し)。
 */
export function renameAccount(
  registry: AccountRegistry,
  id: string,
  name: string,
): RenameAccountResult {
  if (id.endsWith(":default")) return { ok: false, code: "builtin" };
  const target = registry.accounts.find((account) => account.id === id);
  if (!target) return { ok: false, code: "not-found" };
  const issue = checkAccountName(name);
  if (issue) return { ok: false, code: "name", issue };
  const next = name.trim();
  const key = next.toLocaleLowerCase();
  if ((RESERVED_ACCOUNT_NAMES as readonly string[]).includes(key))
    return { ok: false, code: "reserved" };
  const clash = registry.accounts.find(
    (account) =>
      account.id !== id &&
      account.agent === target.agent &&
      account.name.trim().toLocaleLowerCase() === key,
  );
  if (clash) return { ok: false, code: "duplicate", existing: clash.name };
  const renamed = { ...target, name: next };
  return {
    ok: true,
    renamed,
    registry: {
      ...registry,
      accounts: registry.accounts.map((account) =>
        account.id === id ? renamed : account,
      ),
    },
  };
}

/** 画面に出すアカウント 1 件 (既定を含む)。 */
export type AccountEntry = {
  id: string;
  agent: AccountAgent;
  name: string;
  configDir: string;
  builtin: boolean;
  managed: boolean;
};

/** 既定のアカウントを先頭に置いた全件。種類ごとに claude → codex の順。 */
export function accountEntries(
  registry: AccountRegistry,
  home: string,
  defaultNames: Record<AccountAgent, string>,
): AccountEntry[] {
  const out: AccountEntry[] = [];
  for (const agent of ["claude", "codex"] as const) {
    out.push({
      id: defaultAccountId(agent),
      agent,
      name: defaultNames[agent],
      configDir: defaultConfigDir(agent, home),
      builtin: true,
      managed: false,
    });
    for (const account of registry.accounts) {
      if (account.agent !== agent) continue;
      out.push({
        id: account.id,
        agent,
        name: account.name,
        configDir: account.configDir,
        builtin: false,
        managed: account.managed,
      });
    }
  }
  return out;
}

/** ペインのエージェントがどのアカウントで動いているか。 */
export type PaneAccount =
  | { kind: "default"; id: string }
  | { kind: "registered"; id: string }
  | { kind: "unregistered"; configDir: string }
  /** プロセスを調べられなかった。理由を出す。 */
  | { kind: "unknown"; reason: string };

/**
 * 環境変数の値からアカウントを求める。
 *
 * - 未設定・空: 既定
 * - 既定のディレクトリそのもの (`CLAUDE_CONFIG_DIR=~/.claude` のように明示
 *   したもの): 既定。同じ設定ディレクトリを使っているため
 * - 登録簿のどれかと同じディレクトリ: そのアカウント
 * - それ以外: 未登録 (パスを添える。そこから登録できる)
 */
export function accountForEnv(
  agent: AccountAgent,
  value: string | undefined,
  accounts: readonly AccountEntry[],
  home: string,
): PaneAccount {
  if (!value?.trim()) return { kind: "default", id: defaultAccountId(agent) };
  // 相対パスはプロセスの cwd に依存するので、そのまま未登録として見せる。
  if (!value.startsWith("/")) return { kind: "unregistered", configDir: value };
  const dir = normalizeConfigDir(value);
  if (dir === defaultConfigDir(agent, home)) {
    return { kind: "default", id: defaultAccountId(agent) };
  }
  const found = accounts.find(
    (account) =>
      account.agent === agent && normalizeConfigDir(account.configDir) === dir,
  );
  if (found) return { kind: "registered", id: found.id };
  return { kind: "unregistered", configDir: dir };
}

/**
 * `ps eww` の 1 行 (引数の後ろに環境変数が空白区切りで続く) から、
 * CLAUDE_CONFIG_DIR と CODEX_HOME の値だけを取り出す。
 *
 * ほかの変数 (API キーなど) は結果に入れない。この関数は入力の一部を
 * 例外にもログにも載せない (呼び出し側も入力を捨てる)。
 *
 * 値の終わりは「空白の後に `名前=` が続く所」とみなす。値そのものに
 * ` NAME=` の並びを含むパスは正しく切れない (ps の出力は区切りを持たない
 * ため)。引数に同じ名前が現れても、環境変数は後ろにあるので最後の出現を
 * 使う。
 */
export function pickAccountEnv(
  line: string,
): Partial<Record<"CLAUDE_CONFIG_DIR" | "CODEX_HOME", string>> {
  const out: Partial<Record<"CLAUDE_CONFIG_DIR" | "CODEX_HOME", string>> = {};
  for (const name of ["CLAUDE_CONFIG_DIR", "CODEX_HOME"] as const) {
    const marker = ` ${name}=`;
    const start = line.lastIndexOf(marker);
    if (start < 0) continue;
    const rest = line.slice(start + marker.length);
    const next = /\s[A-Za-z_][A-Za-z0-9_]*=/.exec(rest);
    out[name] = (next ? rest.slice(0, next.index) : rest).replace(/\s+$/, "");
  }
  return out;
}

/**
 * 一覧の行にアカウント名を出すか。既定のアカウントだけを使っている間は
 * うるさくならないよう出さない。登録アカウントが 1 つでもあるか、既定以外で
 * 動くエージェントが 1 つでもあれば全行に出す。
 */
export function showPaneAccounts(
  registered: number,
  panes: readonly Pick<AgentPane, "account">[],
): boolean {
  if (registered > 0) return true;
  return panes.some(
    (pane) => pane.account !== null && pane.account.kind !== "default",
  );
}

/** ログインの状態。秘密の値を読まずに得たものだけ。 */
export type AccountLogin = {
  /**
   * - logged-in / logged-out: 公式のコマンドがそう答えた
   * - unknown: 分からない (コマンドが無い・失敗した・答えが読めない)
   * - no-config-dir: 設定ディレクトリが無い
   */
  state: "logged-in" | "logged-out" | "unknown" | "no-config-dir";
  /** 誰として (CLI が答えたメールアドレス)。分からなければ空。 */
  who: string;
  /** ログイン済みなのに who が空の理由。 */
  whoDetail: string;
  /** 認証の方式 (claude.ai / ChatGPT など)。分からなければ空。 */
  method: string;
  /** 契約のプラン (max / pro など、CLI の答えのまま)。分からなければ空。 */
  plan: string;
  /** unknown の理由。 */
  detail: string;
  /**
   * ログイン済みの claude に初回の案内を済ませた印を足せなかった理由
   * (server/accounts/onboarding.ts)。足せた・要らなかったときは無い。
   */
  setupDetail?: string;
  checkedAt: number;
};

/** 使用量の窓 1 つ。 */
export type UsageWindow = {
  /** five_hour / seven_day、それ以外は窓の長さ (分) で表す。 */
  kind: "five_hour" | "seven_day" | "other";
  /** 窓の長さ (分)。分からなければ 0。 */
  minutes: number;
  /** 0〜100 (超えることもある)。 */
  usedPercent: number;
  /** リセットの時刻 (epoch ms)。分からなければ 0。 */
  resetsAt: number;
};

export type AccountUsage =
  | {
      status: "ok";
      windows: UsageWindow[];
      /** この値を得た時刻 (epoch ms)。 */
      observedAt: number;
      /**
       * 同じ設定ディレクトリの記録に、別のアカウントの上限が混ざっている
       * (同じ枠なのにリセットの時刻が違う値が、近い時刻に出ている)。
       * `windows` は最新の記録の値で、こちらは別の記録の値。同じディレクトリで
       * ログインを切り替えて使うと起きる。どちらが今のアカウントかは決められない。
       */
      mixed?: { windows: UsageWindow[]; observedAt: number };
    }
  /** 取得できない。0% や空欄にせず、理由を出す。 */
  | {
      status: "unavailable";
      reason: UsageUnavailableReason;
      /** 理由の詳細 (読めなかったファイルと例外の全文など)。 */
      detail: string;
      /** 最後に値を得た時刻。分からなければ 0。 */
      observedAt: number;
    };

/**
 * 使用量が取れない理由。
 *
 * - not-wrapped: claude の statusLine を包んでいない (値の出所が無い)
 * - no-data: 包んでいるが、まだ値が届いていない (セッションが無い)
 * - no-limits: 値は届いたが上限の情報が無い (Pro / Max 以外、または最初の
 *   応答の前)
 * - no-sessions: codex のセッション記録が無い
 * - no-token-count: セッション記録に上限の情報が無い
 * - unreadable: 読めない・形が想定外 (公式に約束された書式ではない)
 */
export type UsageUnavailableReason =
  | "not-wrapped"
  | "no-data"
  | "no-limits"
  | "no-sessions"
  | "no-token-count"
  | "unreadable";

/**
 * 「使用量を確かめる」(POST /_agent/accounts/usage-check。
 * server/accounts/usage-check.ts) が止まった理由。
 *
 * - not-wrapped: statusLine を包んでいない (起こさずに断った)
 * - onboarding / trust / login: claude が初回の案内・フォルダの信頼の確認・
 *   ログインを求める画面で止まった (待たずに止めた)
 * - timeout: 時間内に新しい使用量が届かなかった
 * - start-failed: tmux のセッションを作れない・claude がすぐ終わった
 */
export type UsageCheckFailure =
  | "not-wrapped"
  | "onboarding"
  | "trust"
  | "login"
  | "timeout"
  | "start-failed";

type UsageCheckBase = {
  accountId: string;
  /**
   * claude を起こした (起こそうとした) フォルダ = サーバのプロジェクトの
   * ルート。画面で止まったときに「このアカウントでここを開く」に使う。
   */
  cwd: string;
  /** この確認のために作った tmux のセッション。作らなかったら空。 */
  session: string;
  /** 作ったセッションを閉じられなかった理由。閉じた (作らなかった) なら空。 */
  closeError: string;
  /** 同じアカウントで走っていた確認を待った (起こさなかった)。 */
  joined: boolean;
  startedAt: number;
  finishedAt: number;
};

export type UsageCheckResponse =
  | (UsageCheckBase & {
      status: "ok";
      /** 起こした後に届いた使用量。 */
      usage: Extract<AccountUsage, { status: "ok" }>;
    })
  | (UsageCheckBase & {
      status: "failed";
      reason: UsageCheckFailure;
      /** 理由の詳細 (元のエラーの全文など。英語)。 */
      detail: string;
      /** 判定に使ったペインの画面の最後の行。見ていなければ空。 */
      evidence: string[];
      /** 終わったときに読めた使用量 (届いていない値の理由を含む)。 */
      usage: AccountUsage | null;
    });

/** 注意の色にする使用率。 */
export const USAGE_WARN_PERCENT = 80;

export type UsageWindowView = {
  window: UsageWindow;
  /** リセットの時刻を過ぎた (この値はもう今の値ではない)。 */
  expired: boolean;
  warn: boolean;
};

export function usageWindowViews(
  usage: AccountUsage,
  now: number,
): UsageWindowView[] {
  if (usage.status !== "ok") return [];
  const order = { five_hour: 0, seven_day: 1, other: 2 };
  return [...usage.windows]
    .sort((a, b) => order[a.kind] - order[b.kind] || a.minutes - b.minutes)
    .map((window) => {
      const expired = window.resetsAt > 0 && window.resetsAt <= now;
      return {
        window,
        expired,
        warn: !expired && window.usedPercent >= USAGE_WARN_PERCENT,
      };
    });
}

/** これより古い値は「古い値」として見せる。 */
export const USAGE_STALE_MS = 30 * 60_000;

export function usageIsStale(observedAt: number, now: number): boolean {
  return observedAt > 0 && now - observedAt > USAGE_STALE_MS;
}

/** 同じ枠でリセットの時刻がこれより違えば、別のアカウントの値とみなす。 */
export const USAGE_MIXED_RESET_TOLERANCE_MS = 60 * 60_000;

/**
 * 新旧 2 つの記録が別のアカウントの上限を指しているか。同じ枠で reset が
 * 許容差より戻るか、古い窓がまだ終わっていない観測時刻に別の reset があれば
 * 混在。同じアカウントの窓が終わった後、次の reset へ進むのは正常な更新。
 */
export function usageWindowsConflict(
  newer: Pick<
    Extract<AccountUsage, { status: "ok" }>,
    "windows" | "observedAt"
  >,
  older: Pick<
    Extract<AccountUsage, { status: "ok" }>,
    "windows" | "observedAt"
  >,
): boolean {
  return newer.windows.some((x) =>
    older.windows.some(
      (y) =>
        x.kind === y.kind &&
        x.minutes === y.minutes &&
        x.resetsAt > 0 &&
        y.resetsAt > 0 &&
        Math.abs(x.resetsAt - y.resetsAt) > USAGE_MIXED_RESET_TOLERANCE_MS &&
        (x.resetsAt < y.resetsAt || y.resetsAt > newer.observedAt),
    ),
  );
}

/** claude の statusLine を包んでいるか。 */
export type StatusLineState =
  /** statusLine が無い。 */
  | "none"
  /** statusLine があり、包んでいない。 */
  | "plain"
  /** 包んでいる。 */
  | "wrapped"
  /** statusLine が無かったので code-viewer の最小の表示を入れた。 */
  | "added"
  | "unreadable"
  | "no-config-dir";

export type StatusLineStatus = {
  state: StatusLineState;
  path: string;
  realPath: string;
  symlink: boolean;
  writeBlocked: string;
  /** unreadable の理由。 */
  detail: string;
  /** 包んでいる元のコマンド。包んでいなければ今のコマンド。無ければ空。 */
  command: string;
  /** 包むスクリプトが無い (包んでいるのに呼び先が消えた)。 */
  wrapperMissing: boolean;
};

export type AccountStatus = AccountEntry & {
  /** 設定ディレクトリがあるか。 */
  exists: boolean;
  login: AccountLogin;
  usage: AccountUsage;
  hooks: AgentHookState;
  /** claude だけ。 */
  statusLine: StatusLineStatus | null;
};

export type AccountsResponse = {
  home: string;
  /** このサーバのリポジトリ (起動先の既定の候補)。 */
  serverRoot: string;
  accounts: AccountStatus[];
  /** 登録簿が読めない。null なら読めた。読めない間は書かない。 */
  registryError: string | null;
  registryPath: string;
  launchCommands: Record<AccountAgent, string>;
  lastLaunch: LaunchChoice | null;
  /** statusLine を包むスクリプトが保存に失敗した記録 (新しい順)。 */
  usageFailures: { total: number; recent: string[]; log: string };
};

/**
 * 既定の設定ディレクトリの直下にあるもの 1 つを、新しいアカウントで共有
 * するかどうか。
 *
 * - shared: 公式の「利用者が書く設定」。既定でオン (外せる)
 * - optional: 公式の一覧に無い・中身を確かめられないもの。既定でオフ
 *   (利用者が確かめて選べる)
 * - blocked: 認証・識別情報・履歴・セッション・キャッシュ・動いている
 *   状態。選べない
 */
export type ShareCategory = "shared" | "optional" | "blocked";

export type BlockedReason =
  | "auth"
  | "identity"
  | "history"
  | "session"
  | "cache"
  | "state"
  /** 名前から認証に関わると疑えるもの。 */
  | "suspect";

export type ShareEntry = {
  name: string;
  /** リンクが指す先 (既定の設定ディレクトリの中)。 */
  target: string;
  directory: boolean;
  category: ShareCategory;
  /** blocked の理由。それ以外は null。 */
  reason: BlockedReason | null;
};

export type CreateAccountPlan = {
  agent: AccountAgent;
  name: string;
  configDir: string;
  /** 設定ディレクトリの親 (無ければ作る)。 */
  parent: string;
  /** 既定の設定ディレクトリ (リンク元。entries はこの直下にあるもの)。 */
  defaultDir: string;
  /** 既定の設定ディレクトリの直下にあるもの全部 (分類つき)。 */
  entries: ShareEntry[];
  /** 公式の「共有する」のうち、既定の側に無いもの (リンクしない)。 */
  missingShared: string[];
  /**
   * 共有する設定ファイルの中に、認証に関わる項目がある (値は読まない。
   * キーの名前だけ)。リンクすると新しいアカウントでもそれが使われる。
   */
  authKeysInShared: string[];
};

export type RegisterAccountPlan = {
  agent: AccountAgent;
  name: string;
  configDir: string;
  exists: boolean;
  isDirectory: boolean;
};

/** 設定ディレクトリの名前に使える形。 */
export function accountDirSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug || "account";
}

/**
 * 既定の設定ディレクトリから共有するもの (公式ドキュメントで「利用者が
 * 書く設定」とされているもの)。認証・アカウントの識別情報・履歴・
 * セッションは入れない。確かめられないものも入れない。
 *
 * 根拠:
 * - claude: https://code.claude.com/docs/en/claude-directory
 * - codex: https://learn.chatgpt.com/docs/config-file/config-advanced 、
 *   https://learn.chatgpt.com/docs/hooks 、
 *   https://developers.openai.com/codex/rules 、
 *   https://learn.chatgpt.com/docs/customization/overview
 */
export const SHARED_CONFIG_ENTRIES: Record<AccountAgent, readonly string[]> = {
  claude: [
    "settings.json",
    "CLAUDE.md",
    "rules",
    "skills",
    "commands",
    "agents",
    "workflows",
    "output-styles",
    "keybindings.json",
    "themes",
  ],
  codex: [
    "config.toml",
    "AGENTS.md",
    "AGENTS.override.md",
    "hooks.json",
    "rules",
  ],
};

/**
 * 共有できないものの名前 (決め打ち)。公式ドキュメントで認証・識別情報・
 * 履歴・セッション・キャッシュ・動作中の状態とされているもの。
 *
 * 根拠: claude https://code.claude.com/docs/en/claude-directory 、
 * codex https://learn.chatgpt.com/docs/config-file/config-advanced
 * ("auth.json" と "per-user state such as logs and caches")。
 */
const BLOCKED_NAMES: Record<AccountAgent, Record<string, BlockedReason>> = {
  claude: {
    ".credentials.json": "auth",
    ".claude.json": "identity",
    "remote-settings.json": "identity",
    "policy-limits.json": "identity",
    // ~/.claude.json の写し。
    backups: "identity",
    "history.jsonl": "history",
    projects: "history",
    "file-history": "history",
    plans: "history",
    tasks: "history",
    todos: "history",
    uploads: "history",
    "usage-data": "history",
    feedback: "history",
    "feedback-bundles": "history",
    "agent-memory": "history",
    "agent-memory-local": "history",
    sessions: "session",
    "session-env": "session",
    "shell-snapshots": "session",
    cache: "cache",
    "paste-cache": "cache",
    "image-cache": "cache",
    "stats-cache.json": "cache",
    jobs: "state",
    daemon: "state",
    debug: "state",
    logs: "state",
    statsig: "state",
    telemetry: "state",
    ide: "state",
  },
  codex: {
    "auth.json": "auth",
    installation_id: "identity",
    "history.jsonl": "history",
    sessions: "session",
    archived_sessions: "session",
    "session_index.jsonl": "session",
    shell_snapshots: "session",
    cache: "cache",
    "models_cache.json": "cache",
    log: "state",
    logs: "state",
    sqlite: "state",
    tmp: "state",
    ".tmp": "state",
    "thread-writer-locks": "state",
    "version.json": "state",
  },
};

/** 名前の形で共有できないと分かるもの (データベース・ロック・一時ファイル)。 */
const BLOCKED_PATTERNS: readonly { pattern: RegExp; reason: BlockedReason }[] =
  [
    { pattern: /\.sqlite(-shm|-wal|-journal)?$/i, reason: "state" },
    { pattern: /\.(lock|pid|sock)$/i, reason: "state" },
    { pattern: /\.(tmp|temp)$/i, reason: "state" },
  ];

/**
 * 名前から認証に関わると疑えるもの。確かめずに共有すると認証情報を
 * 別のアカウントへ持ち込むおそれがあるので、選べない側に倒す。
 * `keybindings` のような語の一部の key は含めない。
 */
const SUSPECT_NAME =
  /credential|auth|token|secret|passw|oauth|cookie|session|(^|[._-])keys?([._-]|$)|api[-_]?key|\.pem$|(^|\.)env$/i;

export function classifyShareEntry(
  agent: AccountAgent,
  name: string,
): { category: ShareCategory; reason: BlockedReason | null } {
  if (SHARED_CONFIG_ENTRIES[agent].includes(name)) {
    return { category: "shared", reason: null };
  }
  const named = BLOCKED_NAMES[agent][name];
  if (named) return { category: "blocked", reason: named };
  for (const rule of BLOCKED_PATTERNS) {
    if (rule.pattern.test(name))
      return { category: "blocked", reason: rule.reason };
  }
  if (SUSPECT_NAME.test(name))
    return { category: "blocked", reason: "suspect" };
  return { category: "optional", reason: null };
}

/** 既定でオンにするもの。 */
export function defaultShareSelection(
  entries: readonly ShareEntry[],
): string[] {
  return entries
    .filter((entry) => entry.category === "shared")
    .map((entry) => entry.name);
}

export type ShareSelectionIssue =
  | { code: "blocked"; name: string; reason: BlockedReason }
  | { code: "unknown"; name: string }
  | { code: "duplicate"; name: string };

/**
 * 共有する選択を検査する。画面の検査には頼らず、サーバが書く前に必ず通す。
 * 問題を全部返す。
 */
export function checkShareSelection(
  entries: readonly ShareEntry[],
  share: readonly string[],
): ShareSelectionIssue[] {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const seen = new Set<string>();
  const issues: ShareSelectionIssue[] = [];
  for (const name of share) {
    if (seen.has(name)) {
      issues.push({ code: "duplicate", name });
      continue;
    }
    seen.add(name);
    const entry = byName.get(name);
    if (!entry) issues.push({ code: "unknown", name });
    else if (entry.category === "blocked") {
      issues.push({ code: "blocked", name, reason: entry.reason ?? "suspect" });
    }
  }
  return issues;
}

/**
 * 共有する設定ファイルの中の、認証に関わるキーの名前。値は見ない。
 * claude の settings.json の apiKeyHelper と env の認証用の変数、codex の
 * config.toml のトークン類。
 */
export const AUTH_SETTING_KEYS: Record<AccountAgent, readonly string[]> = {
  claude: [
    "apiKeyHelper",
    "env.ANTHROPIC_API_KEY",
    "env.ANTHROPIC_AUTH_TOKEN",
    "env.CLAUDE_CODE_OAUTH_TOKEN",
  ],
  codex: ["experimental_bearer_token", "bearer_token"],
};

/** claude の settings.json (読んだ JSON) の中の認証に関わるキー。 */
export function claudeAuthKeys(root: unknown): string[] {
  if (!isPlainObject(root)) return [];
  const found: string[] = [];
  if ("apiKeyHelper" in root) found.push("apiKeyHelper");
  if (isPlainObject(root.env)) {
    for (const key of [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "CLAUDE_CODE_OAUTH_TOKEN",
    ]) {
      if (key in root.env) found.push(`env.${key}`);
    }
  }
  return found;
}

/**
 * codex の config.toml の中の認証に関わるキー。TOML は解釈せず、行頭の
 * キー名だけを見る (値は見ない)。
 */
export function codexAuthKeys(text: string): string[] {
  const found = new Set<string>();
  for (const line of text.split("\n")) {
    const match = /^\s*([A-Za-z0-9_.-]+)\s*=/.exec(line);
    const key = match?.[1]?.split(".").pop();
    if (key && AUTH_SETTING_KEYS.codex.includes(key)) found.add(key);
  }
  return [...found];
}

/** ログインのウィンドウを置く tmux のセッション。 */
export const LOGIN_SESSION = "code-viewer-login";

/**
 * 「使用量を確かめる」(server/accounts/usage-check.ts) が確認のたびに作る
 * tmux のセッションの名前の頭。
 */
export const USAGE_CHECK_SESSION_PREFIX = "code-viewer-usage-";

/**
 * エージェントとして見るペイン。使用量を確かめる裏のセッションの claude は
 * 利用者の作業ではないので、一覧・全体ボード・最下段の件数・通知
 * (terminal/overview.ts) と巡回 (terminal/activity.ts) から除く。判定は
 * ここ 1 か所 (セッション名の頭)。ログインのウィンドウは除かない。
 */
export function agentTmuxPanes(sessions: readonly TmuxSession[]): TmuxPane[] {
  return flattenTmuxPanes(
    sessions.filter(
      (session) => !session.name.startsWith(USAGE_CHECK_SESSION_PREFIX),
    ),
  );
}

/** 起動先の tmux セッションの既定。そのプロジェクトのペインがあるセッション。 */
export function defaultLaunchSession(
  project: string,
  panes: readonly Pick<AgentPane, "project" | "session">[],
  fallbackName: string,
  /** 起動先に選ばないセッション (ログインのウィンドウを置くもの)。 */
  exclude: readonly string[] = [LOGIN_SESSION],
): { session: string; exists: boolean } {
  const counts = new Map<string, number>();
  for (const pane of panes) {
    if (pane.project !== project || !pane.session) continue;
    if (exclude.includes(pane.session)) continue;
    counts.set(pane.session, (counts.get(pane.session) ?? 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [session, count] of counts) {
    if (count > bestCount) {
      best = session;
      bestCount = count;
    }
  }
  if (best) return { session: best, exists: true };
  return { session: fallbackName, exists: false };
}

/** 引用符なしで書けるシェルの単語。 */
const SHELL_SAFE_WORD = /^[A-Za-z0-9_./@%+=:,-]+$/;

function shellQuoteForDisplay(value: string): string {
  return SHELL_SAFE_WORD.test(value)
    ? value
    : `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * 起動の画面に見せるコマンドの 1 行。環境変数を前に置いたシェルの書き方
 * (`CLAUDE_CONFIG_DIR=~/… claude`) にする。既定のアカウントは変数なし。
 * 見せ方だけで、実際の起動は tmuxLaunchArgs (env の引数) で行う。
 *
 * ホーム配下は `~/` で縮める (代入の右辺の先頭の ~ はシェルが展開する)。
 * 縮めた残りに引用が要る文字があるときは、縮めずに全体を引用符で囲む。
 */
export function launchCommandLine(
  agent: AccountAgent,
  configDir: string | null,
  command: string,
  home: string,
  args: readonly string[] = [],
): string {
  const line = [command, ...args.map(shellQuoteForDisplay)].join(" ");
  if (configDir === null) return line;
  const short = abbreviateHome(configDir, home);
  const value =
    short.startsWith("~/") && SHELL_SAFE_WORD.test(short.slice(2))
      ? short
      : shellQuoteForDisplay(configDir);
  return `${ACCOUNT_ENV[agent]}=${value} ${line}`;
}

/** 引き継ぎの指示文の言語 (利用者の画面の言語)。 */
export type HandoffLanguage = "en" | "ja";

export function isHandoffLanguage(value: unknown): value is HandoffLanguage {
  return value === "en" || value === "ja";
}

/** 指示文に入れる前の担当のアカウント名の上限 (表示名の上限より長くとる)。 */
export const MAX_HANDOFF_ACCOUNT_LABEL = 80;

/** 前の担当。指示文に入れるものだけ。 */
export type HandoffFrom = {
  agent: AccountAgent;
  /** アカウントの表示名 (既定なら画面の言語の Default / 既定)。 */
  account: string;
  /** フックが渡した会話記録のファイル (core/agent-state.ts の AgentConversation)。 */
  transcriptPath: string;
};

/**
 * 「別のアカウントで続ける」で、次の担当に最初の指示として渡す文。記録の
 * 中身を code-viewer が読んで要約することはしない (書式が公式に約束されて
 * いない)。読むのは次の担当のエージェント自身。
 */
export function handoffPrompt(
  language: HandoffLanguage,
  from: HandoffFrom,
): string {
  return language === "ja"
    ? `前の担当（${from.agent}・${from.account}）の作業を引き継いでください。前の担当の会話記録は ${from.transcriptPath}（JSONL）にあります。最後の依頼と、どこまで進んだかを読んで、続きをやってください。わからないことは、作業を始める前に聞いてください。`
    : `Take over the work of the previous agent (${from.agent} · ${from.account}). Its conversation log is at ${from.transcriptPath} (JSONL). Read the last request and how far it got, then continue the work. If anything is unclear, ask before you start.`;
}

/** 会話記録のファイルがあるディレクトリ。 */
export function transcriptDir(transcriptPath: string): string {
  const cut = transcriptPath.lastIndexOf("/");
  return cut <= 0 ? "/" : transcriptPath.slice(0, cut);
}

/**
 * 引き継ぎで起動コマンドの後ろに足す引数。最初の指示は引数で渡す
 * (send-keys で打ち込まない。6 節)。
 *
 * - claude: 作業フォルダの外のファイルを読むには許可が要るので、記録の
 *   ディレクトリを `--add-dir` で足す (公式の CLI reference)。指示を先に
 *   置く。`--add-dir` は値を複数とるので、後ろに置いた指示をディレクトリと
 *   して読んでしまう
 * - codex: `--add-dir` は書き込みの許可を足すもの (公式の CLI reference) で、
 *   読むだけの記録には強すぎるので付けない。既定のサンドボックス
 *   (workspace-write / read-only) は作業フォルダの外も読める
 */
export function handoffArgs(
  agent: AccountAgent,
  prompt: string,
  transcriptPath: string,
): string[] {
  return agent === "claude"
    ? [prompt, "--add-dir", transcriptDir(transcriptPath)]
    : [prompt];
}

/** tmux のセッション名として使える形 (`.` と `:` は tmux の区切り)。 */
export function tmuxSessionName(name: string): string {
  const cleaned = name.replace(/[.:\s]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 40) || "agents";
}

export type LaunchRequest = {
  agent: AccountAgent;
  /** null なら既定のアカウント (環境変数を外す)。 */
  configDir: string | null;
  cwd: string;
  session: string;
  /** そのセッションが既にあるか。無ければ作る。 */
  sessionExists: boolean;
  windowName: string;
  /**
   * 実行するもの (引数の配列)。シェルを通さず tmux にそのまま渡す。
   * 起動コマンドは利用者の書いたシェルの文なので、呼び出し側が
   * `[shell, "-i", "-c", command]` の形にする。
   */
  argv: string[];
};

/**
 * tmux の引数を組み立てる。環境変数は env の引数で渡し、キー入力は送らない
 * (シェルの履歴や別の入力に混ざらない)。パスは 1 つの引数としてそのまま
 * 渡すので、空白や引用符を含んでいても崩れない。
 *
 * -P -F で作ったペインの ID を受け取る。
 */
export function tmuxLaunchArgs(request: LaunchRequest): string[] {
  const name = ACCOUNT_ENV[request.agent];
  const env =
    request.configDir === null
      ? ["env", "-u", name]
      : ["env", `${name}=${request.configDir}`];
  const place = request.sessionExists
    ? ["new-window", "-t", `=${request.session}:`, "-n", request.windowName]
    : ["new-session", "-d", "-s", request.session, "-n", request.windowName];
  return [
    ...place,
    "-P",
    "-F",
    "#{pane_id}",
    "-c",
    request.cwd,
    "--",
    ...env,
    ...request.argv,
  ];
}

export type StatusLineAction = "install" | "uninstall";

/** statusLine を包む・戻すと何が変わるか (書かない)。 */
export type StatusLinePlanResponse = {
  action: StatusLineAction;
  configDir: string;
  path: string;
  realPath: string;
  symlink: boolean;
  fileExists: boolean;
  /** 書く前と後の statusLine。無ければ null。 */
  before: unknown;
  after: unknown;
  changed: boolean;
  backupPath: string | null;
  /**
   * 書く前と後の unified diff (core/text-diff.ts)。確認の画面が差分の見た目で
   * 出す。変わらないなら空。ファイルが無ければ全部が足す行。
   */
  diff: string;
  formattingChanged: boolean;
  wrapper: { path: string; write: boolean };
  /** 保存先。 */
  usageDir: string;
  writeBlocked: string;
  baseHash: string;
  /** 同じ内容の別ファイルへのリンク差し替えも見分ける不透明な識別子。 */
  fileIdentity: string;
};

export type StatusLineApplyResponse = {
  path: string;
  changed: boolean;
  backupPath: string | null;
  wrapperWritten: boolean;
};

export type LaunchResponse = {
  paneId: string;
  session: string;
  /** セッションを新しく作ったか。 */
  created: boolean;
  command: string;
  /** 前回の選択を覚えられなかった理由。覚えたなら空。 */
  rememberError: string;
  /**
   * プロジェクトの statusLine を読めず、このセッションの使用量を記録できない
   * 理由 (server/accounts/project-statusline.ts)。起動はしている。無ければ空。
   */
  statusLineError: string;
};
