// アカウント・使用量・起動の文言。agents の i18n (i18n.ts) の accounts 欄に
// 入る。切替時のライブ反映は agents-view・accounts-settings の localize()。

import type {
  AccountLogin,
  BlockedReason,
  StatusLineState,
  UsageUnavailableReason,
  UsageWindow,
} from "../../core/agent-accounts";

export type AccountsText = {
  /** 既定のアカウントの表示名。 */
  defaultName: string;
  unregistered: string;
  unregisteredTitle: (path: string) => string;
  unknownAccount: string;
  unknownAccountTitle: (reason: string) => string;
  paneAccountTitle: (name: string, path: string) => string;
  // 帯
  bandTitle: string;
  bandToggle: (collapsed: boolean) => string;
  bandManage: string;
  bandEntry: string;
  bandEntryTitle: string;
  bandLoadFailed: string;
  login: Record<AccountLogin["state"], string>;
  loginWho: (who: string, method: string) => string;
  loginUnknownWho: string;
  loginButton: string;
  loginTitle: (name: string) => string;
  loginStarted: (session: string) => string;
  loginFailed: string;
  window: (window: UsageWindow) => string;
  resetsIn: (duration: string) => string;
  resetPassed: string;
  duration: (ms: number) => string;
  warn: string;
  observed: (ago: string) => string;
  /** 1 分未満。 */
  observedJustNow: string;
  observedStale: (ago: string) => string;
  observedTitle: (time: string) => string;
  usageUnavailable: string;
  usageReason: Record<UsageUnavailableReason, string>;
  agentsCount: (count: number) => string;
  hooksShort: (state: string) => string;
  registerUnregistered: string;
  registerUnregisteredTitle: (path: string) => string;
  // 設定の節
  sectionTitle: string;
  sectionIntro: string;
  loading: string;
  registryError: (path: string) => string;
  pathTitle: (path: string) => string;
  noConfigDir: (path: string) => string;
  add: string;
  remove: string;
  removeTitle: (name: string) => string;
  removeDialogTitle: (name: string) => string;
  removeBody: (path: string) => string;
  removeRunning: (count: number) => string;
  removeManaged: (path: string) => string;
  removeConfirm: string;
  removed: (name: string) => string;
  cancel: string;
  close: string;
  // 足す
  addTitle: string;
  addKind: string;
  addName: string;
  addNamePlaceholder: string;
  addMode: string;
  addModeCreate: string;
  addModeCreateHelp: string;
  addModeRegister: string;
  addModeRegisterHelp: string;
  addPath: string;
  addNext: string;
  addNameRequired: string;
  addPathRequired: string;
  createTitle: (name: string) => string;
  createDir: string;
  createLinks: string;
  createLinkMissing: (names: string) => string;
  usageReasonShort: Record<UsageUnavailableReason, string>;
  /** 3 つのまとまりの見出し。 */
  shareShared: string;
  shareOptional: string;
  shareBlocked: (count: number) => string;
  /** 「選べば共有できる」の各項目に添える、既定でオフの理由。 */
  shareOptionalWhy: string;
  blockedWhy: Record<BlockedReason, string>;
  shareNone: string;
  createAuthKeys: (keys: string) => string;
  createAfter: string;
  createRun: string;
  registerTitle: (name: string) => string;
  registerMissing: (path: string) => string;
  registerNotDir: (path: string) => string;
  registerBody: string;
  registerRun: string;
  added: (name: string) => string;
  // 使用量 (statusLine)
  usageTitle: string;
  usageIntro: string;
  statusLine: Record<StatusLineState, string>;
  statusLineCommand: (command: string) => string;
  statusLineWrapperMissing: string;
  statusLineInstall: string;
  statusLineUninstall: string;
  statusLineDialogTitle: (action: "install" | "uninstall") => string;
  statusLineFile: string;
  statusLineLinkTarget: string;
  statusLineBefore: string;
  statusLineAfter: string;
  statusLineNone: string;
  statusLineNothing: string;
  statusLineBackup: (path: string) => string;
  statusLineNewFile: string;
  statusLineFormatting: string;
  statusLineWrapper: (path: string) => string;
  statusLineSaves: (dir: string) => string;
  statusLineRestore: string;
  statusLineEffect: string;
  statusLineApplied: Record<"install" | "uninstall", string>;
  statusLineUnchanged: string;
  statusLineBlocked: string;
  backupAt: (path: string) => string;
  usageFailures: (count: number) => string;
  usageFailuresLog: (path: string) => string;
  usageFailuresClear: string;
  sharedBy: (names: string) => string;
  // 起動コマンド
  commandsTitle: string;
  commandsIntro: string;
  commandsSave: string;
  commandsSaved: string;
  // 起動
  launchButton: string;
  launchButtonTitle: string;
  launchProjectTitle: (name: string) => string;
  launchTitle: string;
  launchKind: string;
  launchAccount: string;
  launchProject: string;
  launchSession: string;
  launchSessionNew: string;
  launchSessionExisting: string;
  /** 起動するコマンドを、環境変数を前に置いたシェルの書き方で見せる。 */
  launchPreview: (commandLine: string) => string;
  launchRun: string;
  launchStarted: (session: string) => string;
  launchRememberFailed: string;
  launchNeedsLogin: string;
  launchNoProjects: string;
  currentServerProject: (name: string) => string;
};

/** 残り時間を「時間と分」「日と時間」の 2 段で書く。 */
function durationFormatter(units: {
  minute: string;
  hour: string;
  day: string;
  join: string;
}): (ms: number) => string {
  return (ms) => {
    const minutes = Math.max(0, Math.round(ms / 60_000));
    if (minutes < 60) return `${minutes}${units.minute}`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours}${units.hour}${units.join}${minutes % 60}${units.minute}`;
    }
    return `${Math.floor(hours / 24)}${units.day}${units.join}${hours % 24}${units.hour}`;
  };
}

function windowName(
  window: UsageWindow,
  names: { five: string; seven: string; minutes: (n: number) => string },
): string {
  if (window.kind === "five_hour") return names.five;
  if (window.kind === "seven_day") return names.seven;
  return names.minutes(window.minutes);
}

export const ACCOUNTS_EN: AccountsText = {
  defaultName: "Default",
  unregistered: "Unregistered",
  unregisteredTitle: (path) =>
    `Runs with a settings directory that is not registered: ${path}`,
  unknownAccount: "?",
  unknownAccountTitle: (reason) => `Account not known: ${reason}`,
  paneAccountTitle: (name, path) => `Account: ${name}\n${path}`,
  bandTitle: "Accounts",
  bandToggle: (collapsed) => (collapsed ? "Show accounts" : "Hide accounts"),
  bandManage: "Manage",
  bandEntry: "Accounts and usage",
  bandEntryTitle:
    "Register more claude / codex accounts and see their 5-hour and weekly usage",
  bandLoadFailed: "Could not load accounts",
  login: {
    "logged-in": "Signed in",
    "logged-out": "Not signed in",
    unknown: "Sign-in unknown",
    "no-config-dir": "No settings directory",
  },
  loginWho: (who, method) =>
    [who, method].filter(Boolean).join(" · ") || "Signed in",
  loginUnknownWho:
    "Which account is signed in is not shown: the official status command does not print it, and code-viewer does not open credential files.",
  loginButton: "Sign in",
  loginTitle: (name) =>
    `Open the official sign-in for ${name} in a new tmux window. You approve it in the browser; code-viewer does not see or store credentials.`,
  loginStarted: (session) =>
    `Sign-in opened in tmux session ${session}. Finish it in the terminal and the browser.`,
  loginFailed: "Could not start the sign-in",
  window: (window) =>
    `${windowName(window, {
      five: "5h",
      seven: "Week",
      minutes: (n) => `${n}m`,
    })} ${Math.round(window.usedPercent)}%`,
  resetsIn: (duration) => `resets in ${duration}`,
  resetPassed: "window has reset; waiting for a new value",
  duration: durationFormatter({ minute: "m", hour: "h", day: "d", join: " " }),
  warn: "High",
  observed: (ago) => `as of ${ago} ago`,
  observedJustNow: "just now",
  observedStale: (ago) => `old value · ${ago} ago`,
  observedTitle: (time) => `Last value received at ${time}`,
  usageUnavailable: "Usage unavailable",
  usageReason: {
    "not-wrapped":
      "claude reports usage only to the status line. Turn on usage collection in Settings > Accounts.",
    "no-data":
      "No value yet. It arrives after a claude session with this account gets its first response.",
    "no-limits":
      "The status line data has no rate limits (only Pro / Max subscriptions report them, after the first response).",
    "no-sessions": "No codex session log yet for this account.",
    "no-token-count":
      "The recent codex session logs have no rate-limit entry yet.",
    unreadable:
      "The saved data could not be read (the format is not a public contract).",
  },
  agentsCount: (count) => `${count} running`,
  hooksShort: (state) => `Hooks: ${state}`,
  registerUnregistered: "Register",
  registerUnregisteredTitle: (path) =>
    `An agent runs with ${path}, which is not registered. Register it to name it and see its usage.`,
  sectionTitle: "Accounts",
  sectionIntro:
    "claude and codex keep one sign-in per settings directory. Register a directory per account; sign in once per account, then start agents with any account.",
  loading: "Loading accounts…",
  registryError: (path) =>
    `The account registry ${path} cannot be read, so it is not changed. Only the default accounts are listed until it is fixed:`,
  pathTitle: (path) => path,
  noConfigDir: (path) => `The settings directory does not exist: ${path}`,
  add: "Add account…",
  remove: "Remove",
  removeTitle: (name) => `Remove ${name} from the list`,
  removeDialogTitle: (name) => `Remove ${name}?`,
  removeBody: (path) =>
    `The account is removed from code-viewer's list. Its settings directory is kept: ${path}`,
  removeRunning: (count) =>
    `${count} agent${count === 1 ? " is" : "s are"} running with this account now. They keep running; the list will show them as unregistered.`,
  removeManaged: (path) =>
    `code-viewer created this directory. It holds this account's sign-in and history. To delete it after removing: rm -r '${path}'`,
  removeConfirm: "Remove",
  removed: (name) => `Removed ${name}.`,
  cancel: "Cancel",
  close: "Close",
  addTitle: "Add an account",
  addKind: "Agent",
  addName: "Name",
  addNamePlaceholder: "e.g. Work",
  addMode: "Settings directory",
  addModeCreate: "Create a new one",
  addModeCreateHelp:
    "code-viewer creates a directory and links your settings (settings, instructions, skills, commands…) from the default one. Sign-in, account identity and history are not shared.",
  addModeRegister: "Use an existing directory",
  addModeRegisterHelp: "Only registers the path. Nothing inside is changed.",
  addPath: "Path",
  addNext: "Review…",
  addNameRequired: "Enter a name.",
  addPathRequired: "Enter an absolute path.",
  createTitle: (name) => `Create the account "${name}"`,
  createDir: "New settings directory",
  createLinks: "Links that will be created",
  createLinkMissing: (names) =>
    `Not in the default directory, so not linked: ${names}`,
  usageReasonShort: {
    "not-wrapped": "Turn on usage collection in Settings",
    "no-data": "No value yet",
    "no-limits": "No rate limits in the status line data",
    "no-sessions": "No codex session yet",
    "no-token-count": "No rate limits in the session logs yet",
    unreadable: "Could not read the saved data",
  },
  shareShared: "Share (on by default)",
  shareOptional: "Can be shared if you choose (off by default)",
  shareBlocked: (count) => `Cannot be shared (${count})`,
  shareOptionalWhy:
    "Not in the documented settings and its contents are not checked. Turn it on only after confirming it holds no credentials.",
  blockedWhy: {
    auth: "sign-in credentials",
    identity: "account identity",
    history: "history",
    session: "sessions",
    cache: "cache",
    state: "running state (logs, databases, locks)",
    suspect: "the name suggests credentials",
  },
  shareNone: "Nothing is linked; the new directory starts empty.",
  createAuthKeys: (keys) =>
    `The shared settings contain sign-in related keys (${keys}). They apply to this account too. Values were not read.`,
  createAfter:
    "After creating, use Sign in on its row. Nothing is sent anywhere until you do.",
  createRun: "Create",
  registerTitle: (name) => `Register "${name}"`,
  registerMissing: (path) => `${path} does not exist.`,
  registerNotDir: (path) => `${path} is not a directory.`,
  registerBody:
    "The directory is registered as is. code-viewer does not change anything inside it.",
  registerRun: "Register",
  added: (name) => `Added ${name}.`,
  usageTitle: "claude usage",
  usageIntro:
    "claude reports its 5-hour and weekly usage only to the status line. code-viewer can wrap the status line command: it keeps the data it receives, runs your command with the same input and returns its output unchanged.",
  statusLine: {
    none: "Off (no status line)",
    plain: "Off",
    wrapped: "On (wrapping your status line)",
    added: "On (minimal status line)",
    unreadable: "Cannot read",
    "no-config-dir": "No settings directory",
  },
  statusLineCommand: (command) => `Your command: ${command}`,
  statusLineWrapperMissing:
    "The wrapper script is missing, so the status line shows nothing. Turn it on again to rewrite it.",
  statusLineInstall: "Turn on…",
  statusLineUninstall: "Turn off…",
  statusLineDialogTitle: (action) =>
    action === "install"
      ? "Collect claude usage from the status line"
      : "Restore the original status line",
  statusLineFile: "Settings file",
  statusLineLinkTarget: "Link target (written)",
  statusLineBefore: "statusLine now",
  statusLineAfter: "statusLine after",
  statusLineNone: "(none)",
  statusLineNothing: "Nothing to change.",
  statusLineBackup: (path) => `The current file is copied to ${path} first.`,
  statusLineNewFile: "The file does not exist yet; it is created.",
  statusLineFormatting:
    "The file is rewritten with the same indentation; other spacing may change.",
  statusLineWrapper: (path) => `The wrapper script is written to ${path}.`,
  statusLineSaves: (dir) =>
    `The data claude passes to the status line is saved in ${dir} (one file per account, overwritten).`,
  statusLineRestore:
    "Turning it off restores exactly the original status line (or removes it if there was none).",
  statusLineEffect:
    "claude picks up settings changes automatically; new values arrive after the next response.",
  statusLineApplied: {
    install: "Usage collection is on.",
    uninstall: "The original status line is back.",
  },
  statusLineUnchanged: "Nothing changed.",
  statusLineBlocked:
    "This settings file cannot be written (it is generated elsewhere). Change statusLine in its source:",
  backupAt: (path) => `Backup: ${path}`,
  usageFailures: (count) =>
    `The status line wrapper could not save usage ${count} time${count === 1 ? "" : "s"}`,
  usageFailuresLog: (path) => `Log: ${path}`,
  usageFailuresClear: "Clear",
  sharedBy: (names) => `Used by: ${names}`,
  commandsTitle: "Launch commands",
  commandsIntro:
    "The command run in a new tmux window by New agent. Runs in your interactive shell, so shell functions and aliases work.",
  commandsSave: "Save",
  commandsSaved: "Saved.",
  launchButton: "New agent",
  launchButtonTitle: "Start claude or codex in a new tmux window",
  launchProjectTitle: (name) => `Start an agent in ${name}`,
  launchTitle: "New agent",
  launchKind: "Agent",
  launchAccount: "Account",
  launchProject: "Project",
  launchSession: "tmux session",
  launchSessionNew: "A new session is created.",
  launchSessionExisting: "Opens a new window in this session.",
  launchPreview: (commandLine) => `Runs: ${commandLine}`,
  launchRun: "Start",
  launchStarted: (session) => `Started in ${session}.`,
  launchRememberFailed: "Started, but the choice could not be remembered:",
  launchNeedsLogin:
    "This account is not signed in. The agent will ask you to sign in.",
  launchNoProjects: "No project to choose.",
  currentServerProject: (name) => `${name} (this server)`,
};

export const ACCOUNTS_JA: AccountsText = {
  defaultName: "既定",
  unregistered: "未登録",
  unregisteredTitle: (path) =>
    `登録していない設定ディレクトリで動いています: ${path}`,
  unknownAccount: "?",
  unknownAccountTitle: (reason) => `アカウントが分かりません: ${reason}`,
  paneAccountTitle: (name, path) => `アカウント: ${name}\n${path}`,
  bandTitle: "アカウント",
  bandToggle: (collapsed) =>
    collapsed ? "アカウントを表示" : "アカウントを畳む",
  bandManage: "管理",
  bandEntry: "アカウントと使用量",
  bandEntryTitle:
    "claude / codex のアカウントを増やし、5時間枠と週枠の使用量を見る",
  bandLoadFailed: "アカウントを読み込めません",
  login: {
    "logged-in": "ログイン済み",
    "logged-out": "未ログイン",
    unknown: "ログイン状態不明",
    "no-config-dir": "設定ディレクトリなし",
  },
  loginWho: (who, method) =>
    [who, method].filter(Boolean).join(" · ") || "ログイン済み",
  loginUnknownWho:
    "どのアカウントでログインしているかは表示できません。公式の状態確認コマンドが出さず、code-viewer は認証ファイルを開かないためです。",
  loginButton: "ログイン",
  loginTitle: (name) =>
    `${name} の公式のログインを tmux の新しいウィンドウで開きます。承認はブラウザで行います。code-viewer は認証情報を受け取らず、保存もしません。`,
  loginStarted: (session) =>
    `tmux のセッション ${session} でログインを開きました。ターミナルとブラウザで完了してください。`,
  loginFailed: "ログインを始められませんでした",
  window: (window) =>
    `${windowName(window, {
      five: "5時間",
      seven: "週",
      minutes: (n) => `${n}分`,
    })} ${Math.round(window.usedPercent)}%`,
  resetsIn: (duration) => `あと${duration}でリセット`,
  resetPassed: "リセット済み・新しい値を待っています",
  duration: durationFormatter({
    minute: "分",
    hour: "時間",
    day: "日",
    join: "",
  }),
  warn: "注意",
  observed: (ago) => `${ago}前の値`,
  observedJustNow: "たった今の値",
  observedStale: (ago) => `古い値・${ago}前`,
  observedTitle: (time) => `${time} に受け取った値`,
  usageUnavailable: "使用量を取得できません",
  usageReason: {
    "not-wrapped":
      "claude は使用量をステータスラインにだけ渡します。設定 > アカウント で使用量の取得を有効にしてください。",
    "no-data":
      "まだ値がありません。このアカウントの claude が最初の応答を受け取ると届きます。",
    "no-limits":
      "ステータスラインのデータに上限の情報がありません（Pro / Max の加入者だけ、最初の応答の後に出ます）。",
    "no-sessions": "このアカウントの codex のセッション記録がまだありません。",
    "no-token-count":
      "最近の codex のセッション記録に上限の情報がまだありません。",
    unreadable:
      "保存されたデータを読めません（公式に約束された書式ではありません）。",
  },
  agentsCount: (count) => `${count} 件実行中`,
  hooksShort: (state) => `フック: ${state}`,
  registerUnregistered: "登録",
  registerUnregisteredTitle: (path) =>
    `登録していない ${path} で動いているエージェントがあります。登録すると名前が付き、使用量も見られます。`,
  sectionTitle: "アカウント",
  sectionIntro:
    "claude と codex は設定ディレクトリごとに 1 つのログインを持ちます。アカウントごとにディレクトリを登録し、それぞれ最初に 1 回だけログインすれば、どのアカウントでもエージェントを起動できます。",
  loading: "アカウントを読み込んでいます…",
  registryError: (path) =>
    `アカウントの登録簿 ${path} を読めないため、書き換えません。直すまでは既定のアカウントだけを表示します:`,
  pathTitle: (path) => path,
  noConfigDir: (path) => `設定ディレクトリがありません: ${path}`,
  add: "アカウントを追加…",
  remove: "外す",
  removeTitle: (name) => `${name} を一覧から外す`,
  removeDialogTitle: (name) => `${name} を外しますか？`,
  removeBody: (path) =>
    `code-viewer の一覧から外します。設定ディレクトリは消しません: ${path}`,
  removeRunning: (count) =>
    `いまこのアカウントで ${count} 件のエージェントが動いています。止まりませんが、一覧では未登録として表示されます。`,
  removeManaged: (path) =>
    `このディレクトリは code-viewer が作ったもので、このアカウントのログインと履歴が入っています。外した後に消すなら: rm -r '${path}'`,
  removeConfirm: "外す",
  removed: (name) => `${name} を外しました。`,
  cancel: "キャンセル",
  close: "閉じる",
  addTitle: "アカウントを追加",
  addKind: "種類",
  addName: "表示名",
  addNamePlaceholder: "例: 仕事用",
  addMode: "設定ディレクトリ",
  addModeCreate: "新しく作る",
  addModeCreateHelp:
    "code-viewer がディレクトリを作り、既定のディレクトリの設定（settings・指示・スキル・コマンドなど）をリンクで共有します。ログイン・アカウントの識別情報・履歴は共有しません。",
  addModeRegister: "既にあるディレクトリを使う",
  addModeRegisterHelp: "パスを登録するだけです。中身には触りません。",
  addPath: "パス",
  addNext: "内容を確認…",
  addNameRequired: "表示名を入れてください。",
  addPathRequired: "絶対パスを入れてください。",
  createTitle: (name) => `アカウント「${name}」を作る`,
  createDir: "新しい設定ディレクトリ",
  createLinks: "作るリンク",
  createLinkMissing: (names) =>
    `既定のディレクトリに無いためリンクしないもの: ${names}`,
  usageReasonShort: {
    "not-wrapped": "設定で使用量の取得を有効にしてください",
    "no-data": "まだ値がありません",
    "no-limits": "ステータスラインのデータに上限の情報がありません",
    "no-sessions": "codex のセッションがまだありません",
    "no-token-count": "セッション記録に上限の情報がまだありません",
    unreadable: "保存されたデータを読めません",
  },
  shareShared: "共有する（既定でオン）",
  shareOptional: "選べば共有できる（既定でオフ）",
  shareBlocked: (count) => `共有できない（${count} 件）`,
  shareOptionalWhy:
    "公式の設定の一覧に無く、中身を確かめられないため。認証情報が入っていないことを確かめてからオンにしてください。",
  blockedWhy: {
    auth: "ログインの認証情報",
    identity: "アカウントの識別情報",
    history: "履歴",
    session: "セッション",
    cache: "キャッシュ",
    state: "動作中の状態（ログ・データベース・ロック）",
    suspect: "名前から認証情報の疑い",
  },
  shareNone: "何もリンクしません（空の設定ディレクトリを作ります）。",
  createAuthKeys: (keys) =>
    `共有する設定に、ログインに関わる項目（${keys}）があります。このアカウントでも使われます。値は読んでいません。`,
  createAfter:
    "作った後、その行の「ログイン」を押してください。押すまでどこにも何も送りません。",
  createRun: "作る",
  registerTitle: (name) => `「${name}」を登録`,
  registerMissing: (path) => `${path} がありません。`,
  registerNotDir: (path) => `${path} はディレクトリではありません。`,
  registerBody:
    "このディレクトリをそのまま登録します。code-viewer は中身を変えません。",
  registerRun: "登録する",
  added: (name) => `${name} を追加しました。`,
  usageTitle: "claude の使用量",
  usageIntro:
    "claude は 5時間枠と週枠の使用量をステータスラインにだけ渡します。code-viewer はステータスラインのコマンドを包み、受け取ったデータを保存してから、あなたのコマンドに同じ入力を渡し、その出力をそのまま返します。",
  statusLine: {
    none: "無効（ステータスラインなし）",
    plain: "無効",
    wrapped: "有効（あなたのステータスラインを包んでいます）",
    added: "有効（最小のステータスライン）",
    unreadable: "読めません",
    "no-config-dir": "設定ディレクトリなし",
  },
  statusLineCommand: (command) => `あなたのコマンド: ${command}`,
  statusLineWrapperMissing:
    "包むスクリプトが無いため、ステータスラインに何も出ません。もう一度有効にすると書き直します。",
  statusLineInstall: "有効にする…",
  statusLineUninstall: "無効にする…",
  statusLineDialogTitle: (action) =>
    action === "install"
      ? "claude の使用量をステータスラインから取る"
      : "元のステータスラインに戻す",
  statusLineFile: "設定ファイル",
  statusLineLinkTarget: "リンク先（ここに書きます）",
  statusLineBefore: "今の statusLine",
  statusLineAfter: "変更後の statusLine",
  statusLineNone: "（なし）",
  statusLineNothing: "変えるものはありません。",
  statusLineBackup: (path) => `書く前に今のファイルを ${path} に写します。`,
  statusLineNewFile: "ファイルがまだ無いので作ります。",
  statusLineFormatting:
    "同じ字下げで書き直すので、ほかの空白が変わることがあります。",
  statusLineWrapper: (path) => `包むスクリプトを ${path} に書きます。`,
  statusLineSaves: (dir) =>
    `claude がステータスラインに渡すデータを ${dir} に保存します（アカウントごとに 1 ファイル、上書き）。`,
  statusLineRestore:
    "無効にすると元のステータスラインにそのまま戻ります（無かった場合は消します）。",
  statusLineEffect:
    "claude は設定の変更を自動で読み込みます。次の応答から値が届きます。",
  statusLineApplied: {
    install: "使用量の取得を有効にしました。",
    uninstall: "元のステータスラインに戻しました。",
  },
  statusLineUnchanged: "変更はありませんでした。",
  statusLineBlocked:
    "この設定ファイルは別の場所から生成されているため書き込めません。生成元の statusLine を変えてください:",
  backupAt: (path) => `バックアップ: ${path}`,
  usageFailures: (count) =>
    `ステータスラインの包みが使用量を保存できなかったことが ${count} 件あります`,
  usageFailuresLog: (path) => `記録: ${path}`,
  usageFailuresClear: "消す",
  sharedBy: (names) => `使っているアカウント: ${names}`,
  commandsTitle: "起動コマンド",
  commandsIntro:
    "「新しいエージェント」で tmux の新しいウィンドウに実行するコマンド。あなたの対話シェルで動くので、シェルの関数やエイリアスも使えます。",
  commandsSave: "保存",
  commandsSaved: "保存しました。",
  launchButton: "新しいエージェント",
  launchButtonTitle: "claude か codex を tmux の新しいウィンドウで起動する",
  launchProjectTitle: (name) => `${name} でエージェントを起動する`,
  launchTitle: "新しいエージェント",
  launchKind: "種類",
  launchAccount: "アカウント",
  launchProject: "プロジェクト",
  launchSession: "tmux のセッション",
  launchSessionNew: "新しいセッションを作ります。",
  launchSessionExisting: "このセッションに新しいウィンドウを開きます。",
  launchPreview: (commandLine) => `実行: ${commandLine}`,
  launchRun: "起動",
  launchStarted: (session) => `${session} で起動しました。`,
  launchRememberFailed: "起動しましたが、選んだものを覚えられませんでした:",
  launchNeedsLogin:
    "このアカウントは未ログインです。起動したエージェントがログインを求めます。",
  launchNoProjects: "選べるプロジェクトがありません。",
  currentServerProject: (name) => `${name}（このサーバ）`,
};
