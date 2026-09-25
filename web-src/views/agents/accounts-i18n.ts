// アカウント・使用量・起動の文言。agents の i18n (i18n.ts) の accounts 欄に
// 入る。切替時のライブ反映は agents-view・accounts-settings の localize()。

import type {
  AccountLogin,
  BlockedReason,
  HandoffLanguage,
  StatusLineState,
  UsageCheckFailure,
  UsageUnavailableReason,
  UsageWindow,
} from "../../core/agent-accounts";

export type AccountsText = {
  /** この文言の言語。引き継ぎの指示文 (core/agent-accounts.ts の handoffPrompt) を合わせる。 */
  language: HandoffLanguage;
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
  /** 枠の名前だけ (5h / week)。割合は別の列に置く。 */
  windowName: (window: UsageWindow) => string;
  /** ログインの状態を確かめた時刻 (未ログインのカードの「いつの値か」)。 */
  loginChecked: (ago: string) => string;
  loginCheckedJustNow: string;
  /** 未ログインのときに値の代わりに出す説明。 */
  loggedOutHint: string;
  // 最下段の使用量から開くポップオーバー
  usagePopoverTitle: string;
  usagePopoverRefresh: string;
  usagePopoverManage: string;
  usagePopoverOpen: string;
  resetsIn: (duration: string) => string;
  /** 窓が戻る時刻 (全体ボードのカード)。when は resetClock (usage-meter.ts) が作る。 */
  resetsAt: (when: string) => string;
  /** 曜日の短い名前 (日曜から)。 */
  weekdays: readonly string[];
  /** 24 時間以上先の日付。 */
  resetDate: (month: number, day: number) => string;
  /** カードの 2 行目: ログイン済みだがメールアドレスが分からない。 */
  cardNoEmail: string;
  resetPassed: string;
  duration: (ms: number) => string;
  warn: string;
  observed: (ago: string) => string;
  /** 1 分未満。 */
  observedJustNow: string;
  observedStale: (ago: string) => string;
  observedTitle: (time: string) => string;
  usageUnavailable: string;
  /** 同じ設定ディレクトリに別のアカウントの上限が混ざっている (短い札)。 */
  usageMixed: string;
  /** その説明。others = 別の記録の値 (枠と割合とリセット)。 */
  usageMixedHint: (others: string) => string;
  usageReason: Record<UsageUnavailableReason, string>;
  /** カードの［使用量の取得を有効にする…］(statusLine の確認の画面を開く)。 */
  usageEnable: string;
  /** 最下段の使用量: 有効にするボタンのある全体ボードへ移る。 */
  usagePopoverEnable: string;
  // 使用量を確かめる (views/agents/usage-check.ts。カードと設定の使用量の行)
  usageCheck: string;
  /** 設定の行で複数のアカウントが並ぶときのボタン。 */
  usageCheckFor: (name: string) => string;
  /** ボタンと ⋯ の項目の title。わずかに使用量を使うことを書く。 */
  usageCheckTitle: string;
  usageChecking: string;
  /** 止まった理由 (見出しの 1 行)。 */
  usageCheckFailed: Record<UsageCheckFailure, string>;
  /** 利用者の次の手順。 */
  usageCheckNext: Record<
    Exclude<UsageCheckFailure, "onboarding" | "trust" | "login">,
    string
  >;
  /** 画面で止まったときの「このアカウントで開く」と、その title。 */
  usageCheckOpenHere: string;
  usageCheckOpenHereTitle: (folder: string) => string;
  usageCheckAgain: string;
  /** 開いた後の文。again は「もう一度確かめる」の文字。 */
  usageCheckAfterOpen: (
    kind: "answer" | "login" | "look",
    again: string,
  ) => string;
  /** 起動に失敗したとき、設定の起動コマンドの欄へ移るボタン。 */
  usageCheckOpenCommands: string;
  usageCheckOpenFailed: string;
  usageCheckRequestFailed: string;
  usageCheckCloseFailed: string;
  /** 畳んだ根拠の欄の見出し。 */
  usageCheckMore: string;
  usageCheckEvidence: string;
  agentsCount: (count: number) => string;
  hooksShort: (state: string) => string;
  registerUnregistered: string;
  registerUnregisteredTitle: (path: string) => string;
  // 設定の節 (1 アカウント 1 行)
  sectionTitle: string;
  sectionIntro: string;
  /** 表の列の見出し。 */
  columns: { account: string; email: string; state: string; checked: string };
  /** 状態の列。no-config-dir は未ログインとして出し、理由を 2 段目に書く。 */
  loginShown: Record<"in" | "out" | "unknown", string>;
  /** メールアドレスが無い行の列の中身。 */
  noEmail: string;
  /** 不明の理由 (CLI に訊いた結果)。 */
  unknownWhy: (detail: string) => string;
  /** ログイン済みなのにメールアドレスが無い理由。 */
  noEmailWhy: (detail: string) => string;
  /** 初回の案内を済ませた印を足せなかった (対話で開くと案内とログインをやり直させる)。 */
  onboardingMarkFailed: (detail: string) => string;
  checkedAgo: (ago: string) => string;
  checkedJustNow: string;
  checking: string;
  recheck: string;
  recheckTitle: (name: string) => string;
  loading: string;
  registryError: (path: string) => string;
  pathTitle: (path: string) => string;
  noConfigDir: (path: string) => string;
  /** 既定のアカウントの設定ディレクトリがまだ無い (初めて使う人。問題ではない)。 */
  defaultNotSetUp: (path: string) => string;
  add: string;
  /** 表示名の変更 (設定の行のボタン・帯の ⋯ のメニュー)。 */
  rename: string;
  renameTitle: (name: string) => string;
  renameDialogTitle: (name: string) => string;
  renameDescription: string;
  renameLabel: string;
  renameConfirm: string;
  renamed: (before: string, after: string) => string;
  renameEmpty: string;
  renameReserved: (name: string) => string;
  renameDuplicate: (name: string, agent: string) => string;
  /** 帯のカードの ⋯ のボタン。 */
  bandMenu: (name: string) => string;
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
  /** リンク元 (既定の設定ディレクトリ) の欄の名前。 */
  createSource: string;
  /** 下の一覧が何か (どのディレクトリの中身で、選ぶと何が起きるか)。 */
  shareIntro: (dir: string) => string;
  createLinks: string;
  createLinkMissing: (names: string) => string;
  usageReasonShort: Record<UsageUnavailableReason, string>;
  /** 3 つのまとまりの見出し。 */
  shareShared: string;
  shareOptional: string;
  shareBlocked: (count: number) => string;
  /** 「選べば共有できる」の見出しの下に 1 回だけ添える、既定でオフの理由。 */
  shareOptionalWhy: string;
  /** 「選べば共有できる」の行の［場所をコピー］と、その結果。 */
  copyLocation: string;
  copiedLocation: string;
  copyLocationFailed: string;
  blockedWhy: Record<BlockedReason, string>;
  shareNone: string;
  createAuthKeys: (keys: string) => string;
  createAfter: string;
  /** 作り終えた後の画面: 見出し・本文・主のボタン (ログイン)・後にする。 */
  createdTitle: (name: string) => string;
  createdBody: string;
  createdSignIn: string;
  createdLater: string;
  createRun: string;
  registerTitle: (name: string) => string;
  registerMissing: (path: string) => string;
  registerNotDir: (path: string) => string;
  registerBody: string;
  registerRun: string;
  added: (name: string) => string;
  // 使用量 (statusLine)
  usageTitle: string;
  /** 仕組みの説明 (開いたときだけ見える欄)。 */
  /** 使用量の「仕組み」の中。1 つが 1 段落。 */
  usageIntro: readonly string[];
  usageHow: string;
  usageReceiving: (when: string) => string;
  usageWaiting: string;
  usageOff: string;
  usageFile: (path: string) => string;
  statusLine: Record<StatusLineState, string>;
  statusLineCommand: (command: string) => string;
  statusLineWrapperMissing: string;
  statusLineInstall: string;
  statusLineUninstall: string;
  statusLineDialogTitle: (action: "install" | "uninstall") => string;
  statusLineFile: string;
  statusLineAfter: string;
  statusLineNone: string;
  statusLineNothing: string;
  /** 書けないファイルの確認の画面: 写す内容をコピーするボタンと、その結果。 */
  statusLineCopy: string;
  statusLineCopied: string;
  /** 差分の見た目の部品が読み込めず、差分を文字で出すとき。 */
  statusLineDiffFailed: string;
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
  commandsReset: string;
  commandsUnsaved: string;
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
  /** 起動の画面の見出しの下の 1 文。 */
  launchIntro: string;
  /** 起動するコマンド (環境変数を前に置いたシェルの書き方) の枠の見出し。 */
  launchPreviewLabel: string;
  launchCopy: string;
  launchCopied: string;
  launchCopyFailed: string;
  launchRun: string;
  launchStarted: (session: string) => string;
  launchRememberFailed: string;
  /** 起動はしたが、プロジェクトの statusLine を読めず使用量を記録できない。 */
  launchStatusLineFailed: string;
  launchNeedsLogin: string;
  launchNotSetUp: string;
  launchLoginUnknown: (detail: string) => string;
  launchNoProjects: string;
  /** 選んだ種類のアカウントが 1 つも無い。 */
  launchNoAccounts: string;
  currentServerProject: (name: string) => string;
  // 別のアカウントで続ける (起動の画面を使い回す)
  handoffDialogTitle: string;
  handoffIntro: (from: string) => string;
  handoffLog: string;
  handoffLogHint: string;
  /** アカウントの一覧で、前の担当が使っているアカウントに付ける札。 */
  handoffCurrent: string;
  handoffRun: string;
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
  language: "en",
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
    "The CLI did not report which account is signed in (see Settings → Accounts for the reason).",
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
  windowName: (window) =>
    windowName(window, { five: "5h", seven: "week", minutes: (n) => `${n}m` }),
  loginChecked: (ago) => `Checked ${ago} ago`,
  loginCheckedJustNow: "Checked just now",
  loggedOutHint: "Sign in to see usage and limits.",
  usagePopoverTitle: "Account usage",
  usagePopoverRefresh: "Check again",
  usagePopoverManage: "Manage accounts",
  usagePopoverOpen: "Show usage for every account",
  resetsIn: (duration) => `resets in ${duration}`,
  resetsAt: (when) => `resets ${when}`,
  weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  resetDate: (month, day) =>
    `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1]} ${day}`,
  cardNoEmail: "Email unknown",
  resetPassed: "window has reset; waiting for a new value",
  duration: durationFormatter({ minute: "m", hour: "h", day: "d", join: " " }),
  warn: "High",
  observed: (ago) => `as of ${ago} ago`,
  observedJustNow: "just now",
  observedStale: (ago) => `old value · ${ago} ago`,
  observedTitle: (time) => `Last value received at ${time}`,
  usageUnavailable: "Usage unavailable",
  usageMixed: "Mixed",
  usageMixedHint: (others) =>
    `Session logs in this config directory report limits of more than one account (also seen: ${others}). Sign in to each account in its own config directory so the numbers do not mix.`,
  usageReason: {
    "not-wrapped":
      "claude reports usage only to the status line, and usage collection is off for this account.",
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
  usageCheck: "Check usage",
  usageCheckFor: (name) => `Check usage (${name})`,
  usageCheckTitle:
    "Starts claude with this account in the background, sends one short message and reads the usage that comes back. This uses a little of your usage.",
  usageChecking: "Checking…",
  usageCheckFailed: {
    "not-wrapped": "Usage is not being received for this account",
    onboarding: "claude's first-run setup is not finished for this account",
    trust: "This account does not trust this folder yet",
    login: "This account is not signed in yet",
    timeout: "No usage arrived in time",
    "start-failed": "claude could not be started",
  },
  usageCheckNext: {
    "not-wrapped": "Once usage collection is on, the usage can be checked.",
    timeout:
      "claude may be waiting for something on its screen (accounts without Pro or Max report no limits).",
    "start-failed":
      "The launch command in Settings could not start claude. The reason is under Details.",
  },
  usageCheckOpenHere: "Open with this account",
  usageCheckOpenHereTitle: (folder) =>
    `Starts claude with this account in ${folder} and brings its terminal tab to the front.`,
  usageCheckAgain: "Check again",
  usageCheckAfterOpen: (kind, again) =>
    kind === "login"
      ? `Sign in in the tab that opened, then press ${again}.`
      : kind === "look"
        ? `Look at what claude waits for in the tab that opened, answer it, then press ${again}.`
        : `Answer in the tab that opened, then press ${again}.`,
  usageCheckOpenCommands: "Open the launch command",
  usageCheckOpenFailed: "Could not open it with this account",
  usageCheckRequestFailed: "Could not check the usage",
  usageCheckCloseFailed:
    "The tmux session opened for the check could not be closed",
  usageCheckMore: "Details",
  usageCheckEvidence: "Last lines of the claude screen:",
  usageEnable: "Turn on usage collection…",
  usagePopoverEnable: "Turn it on from the account card",
  agentsCount: (count) => `${count} running`,
  hooksShort: (state) => `Hooks: ${state}`,
  registerUnregistered: "Register",
  registerUnregisteredTitle: (path) =>
    `An agent runs with ${path}, which is not registered. Register it to name it and see its usage.`,
  sectionTitle: "Sign-in",
  sectionIntro:
    "One row per account (one settings directory). The state and the email come from the CLI itself: claude auth status, codex login status.",
  columns: {
    account: "Account",
    email: "Signed in as",
    state: "State",
    checked: "Last checked",
  },
  loginShown: { in: "Signed in", out: "Not signed in", unknown: "Unknown" },
  noEmail: "—",
  unknownWhy: (detail) => `Could not check: ${detail}`,
  noEmailWhy: (detail) => `No email: ${detail}`,
  onboardingMarkFailed: (detail) =>
    `Opening claude will run the first-run setup and ask you to sign in again, because code-viewer could not record that setup is done: ${detail}`,
  checkedAgo: (ago) => `${ago} ago`,
  checkedJustNow: "just now",
  checking: "Checking…",
  recheck: "Check again",
  recheckTitle: (name) => `Ask the CLI again whether ${name} is signed in`,
  loading: "Loading accounts…",
  registryError: (path) =>
    `The account registry ${path} cannot be read, so it is not changed. Only the default accounts are listed until it is fixed:`,
  pathTitle: (path) => path,
  noConfigDir: (path) => `The settings directory does not exist: ${path}`,
  defaultNotSetUp: (path) =>
    `Not used yet: ${path} is created when you sign in here or start the agent for the first time.`,
  add: "Add account…",
  rename: "Rename",
  renameTitle: (name) => `Change the display name of ${name}`,
  renameDialogTitle: (name) => `Rename ${name}`,
  renameDescription:
    "Only the name shown in code-viewer changes. The settings directory, the sign-in and the usage stay as they are.",
  renameLabel: "Name",
  renameConfirm: "Rename",
  renamed: (before, after) => `Renamed ${before} to ${after}.`,
  renameEmpty: "Enter a name.",
  renameReserved: (name) =>
    `"${name}" is the name of the default account. Choose another name.`,
  renameDuplicate: (name, agent) =>
    `Another ${agent} account is already named "${name}".`,
  bandMenu: (name) => `Actions for ${name}`,
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
  createSource: "Linked from (default settings directory)",
  shareIntro: (dir) =>
    `The items below are the files and folders in ${dir}. Each checked one becomes a link from the new directory to the one in ${dir}, so both accounts use the same thing (nothing is copied).`,
  createLinks: "Links that will be created",
  createLinkMissing: (names) =>
    `Not in the default directory, so not linked: ${names}`,
  usageReasonShort: {
    "not-wrapped": "Usage collection is off",
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
    "Not in the official list of settings, and code-viewer cannot check what is inside, so these are off. Copy location copies where each one is; if it holds no credentials, turning it on shares it.",
  copyLocation: "Copy location",
  copiedLocation: "Copied",
  copyLocationFailed: "Could not copy",
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
    "After it is created, the next screen offers to sign in. Nothing is sent anywhere until you sign in.",
  createdTitle: (name) => `Created ${name}`,
  createdBody:
    "Sign in and this account is ready to use. The official sign-in opens in a terminal tab and your browser.",
  createdSignIn: "Sign in",
  createdLater: "Later",
  createRun: "Create",
  registerTitle: (name) => `Register "${name}"`,
  registerMissing: (path) => `${path} does not exist.`,
  registerNotDir: (path) => `${path} is not a directory.`,
  registerBody:
    "The directory is registered as is. code-viewer does not change anything inside it.",
  registerRun: "Register",
  added: (name) => `Added ${name}.`,
  usageTitle: "Usage",
  usageIntro: [
    "claude reports its 5-hour and weekly usage only to the status line. code-viewer can wrap the status line command: it keeps the data it receives, runs your command with the same input and returns its output unchanged.",
    "codex usage is read from its session logs and needs no setting.",
  ],
  usageHow: "How it works",
  usageReceiving: (when) =>
    `Receiving the 5-hour and weekly usage (last received: ${when})`,
  usageWaiting:
    "On, but nothing received yet. It arrives when a claude session with this account gets a response.",
  usageOff: "Not receiving the 5-hour and weekly usage.",
  usageFile: (path) => `Settings file: ${path}`,
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
  statusLineAfter: "statusLine after",
  statusLineNone: "(none)",
  statusLineNothing: "Nothing to change.",
  statusLineCopy: "Copy what to paste",
  statusLineCopied:
    "Copied. Once it is pasted into the file this settings file is generated from, the next generated file receives the usage.",
  statusLineDiffFailed:
    "The diff view could not be loaded, so the change is shown as text.",
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
    "This settings file is generated elsewhere, so code-viewer cannot write it. Copy the part below and paste it into its source to receive usage:",
  backupAt: (path) => `Backup: ${path}`,
  usageFailures: (count) =>
    `The status line wrapper could not save usage ${count} time${count === 1 ? "" : "s"}`,
  usageFailuresLog: (path) => `Log: ${path}`,
  usageFailuresClear: "Clear",
  sharedBy: (names) => `Used by: ${names}`,
  commandsTitle: "Launch commands",
  commandsIntro:
    "The command run in a new tmux window by New agent. Runs in your interactive shell, so shell functions and aliases work.",
  commandsReset: "Restore default launch commands",
  commandsUnsaved: "Unsaved",
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
  launchIntro: "Start an agent in a project and a tmux session.",
  launchPreviewLabel: "Command preview",
  launchCopy: "Copy the command",
  launchCopied: "Copied",
  launchCopyFailed: "Could not copy the command",
  launchRun: "Launch",
  launchStarted: (session) => `Started in ${session}.`,
  launchRememberFailed: "Started, but the choice could not be remembered:",
  launchStatusLineFailed:
    "Started, but this session will not record usage because the project's statusLine could not be read:",
  launchNeedsLogin:
    "This account is not signed in. The agent will ask you to sign in.",
  launchNotSetUp:
    "This account has not been used yet (no settings directory). The agent sets it up and asks you to sign in.",
  launchLoginUnknown: (detail) => `Sign-in could not be checked: ${detail}`,
  launchNoProjects: "No project to choose.",
  launchNoAccounts: "No account of this kind.",
  currentServerProject: (name) => `${name} (this server)`,
  handoffDialogTitle: "Continue with another account",
  handoffIntro: (from) =>
    `Start an agent with another account. It reads the conversation log of ${from} and continues the work.`,
  handoffLog: "Conversation log",
  handoffLogHint:
    "code-viewer does not read it. The new agent reads it, and asks before it starts if anything is unclear.",
  handoffCurrent: "in use now",
  handoffRun: "Start and hand over",
};

export const ACCOUNTS_JA: AccountsText = {
  language: "ja",
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
    "どのアカウントでログインしているかを CLI が答えませんでした（理由は 設定 → アカウント に出ています）。",
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
  windowName: (window) =>
    windowName(window, {
      five: "5時間",
      seven: "週",
      minutes: (n) => `${n}分`,
    }),
  loginChecked: (ago) => `${ago}前に確認`,
  loginCheckedJustNow: "たった今確認",
  loggedOutHint: "ログインすると使用量と上限が見られます。",
  usagePopoverTitle: "アカウントの使用量",
  usagePopoverRefresh: "取り直す",
  usagePopoverManage: "アカウントを管理",
  usagePopoverOpen: "すべてのアカウントの使用量を見る",
  resetsIn: (duration) => `あと${duration}でリセット`,
  resetsAt: (when) => `${when} に戻る`,
  weekdays: ["日", "月", "火", "水", "木", "金", "土"],
  resetDate: (month, day) => `${month}/${day}`,
  cardNoEmail: "メールアドレスが分かりません",
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
  usageMixed: "混在",
  usageMixedHint: (others) =>
    `同じ設定ディレクトリの記録に、別のアカウントの上限が混ざっています (ほかに ${others})。アカウントごとに設定ディレクトリを分けてログインすると混ざりません。`,
  usageReason: {
    "not-wrapped":
      "claude は使用量をステータスラインにだけ渡します。このアカウントでは受け取りが無効です。",
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
  usageCheck: "使用量を確かめる",
  usageCheckFor: (name) => `使用量を確かめる（${name}）`,
  usageCheckTitle:
    "このアカウントの claude を裏で起こして短い一言を送り、返ってきた使用量を読みます。わずかに使用量を使います。",
  usageChecking: "確かめています…",
  usageCheckFailed: {
    "not-wrapped": "このアカウントの使用量を受け取っていません",
    onboarding: "このアカウントの claude の初回の案内がまだ済んでいません",
    trust: "このフォルダをこのアカウントでまだ信頼していません",
    login: "このアカウントはまだログインしていません",
    timeout: "時間内に使用量が届きませんでした",
    "start-failed": "claude を起動できませんでした",
  },
  usageCheckNext: {
    "not-wrapped": "使用量の受け取りを有効にすると、確かめられます。",
    timeout:
      "claude が画面で何かを待っているのかもしれません（Pro / Max 以外のアカウントには上限の情報がありません）。",
    "start-failed":
      "設定の起動コマンドで claude を起こせませんでした。理由は「詳しく」にあります。",
  },
  usageCheckOpenHere: "このアカウントで開く",
  usageCheckOpenHereTitle: (folder) =>
    `このアカウントで ${folder} の claude を起こし、ターミナルのタブで前に出します。`,
  usageCheckAgain: "もう一度確かめる",
  usageCheckAfterOpen: (kind, again) =>
    kind === "login"
      ? `開いたタブでログインしてから、「${again}」を押してください。`
      : kind === "look"
        ? `開いたタブで claude が待っているものに答えてから、「${again}」を押してください。`
        : `開いたタブで答えてから、「${again}」を押してください。`,
  usageCheckOpenCommands: "起動コマンドを開く",
  usageCheckOpenFailed: "このアカウントで開けませんでした",
  usageCheckRequestFailed: "使用量を確かめられませんでした",
  usageCheckCloseFailed:
    "確認のために開いた tmux のセッションを閉じられませんでした",
  usageCheckMore: "詳しく",
  usageCheckEvidence: "claude の画面の最後の行:",
  usageEnable: "使用量の取得を有効にする…",
  usagePopoverEnable: "アカウントのカードで有効にする",
  agentsCount: (count) => `${count} 件実行中`,
  hooksShort: (state) => `フック: ${state}`,
  registerUnregistered: "登録",
  registerUnregisteredTitle: (path) =>
    `登録していない ${path} で動いているエージェントがあります。登録すると名前が付き、使用量も見られます。`,
  sectionTitle: "ログイン",
  sectionIntro:
    "1 行が 1 つのアカウント（設定のディレクトリ 1 つ）です。状態とメールアドレスは CLI 自身に訊いています（claude auth status・codex login status）。",
  columns: {
    account: "アカウント",
    email: "ログイン中のメールアドレス",
    state: "状態",
    checked: "最後に確かめた時刻",
  },
  loginShown: { in: "ログイン済み", out: "未ログイン", unknown: "不明" },
  noEmail: "—",
  unknownWhy: (detail) => `確かめられませんでした: ${detail}`,
  noEmailWhy: (detail) => `メールアドレスを出せません: ${detail}`,
  onboardingMarkFailed: (detail) =>
    `claude を開くと初回の案内とログインをやり直させます。初回の案内を済ませた印を付けられませんでした: ${detail}`,
  checkedAgo: (ago) => `${ago}前`,
  checkedJustNow: "たった今",
  checking: "確かめています…",
  recheck: "確かめ直す",
  recheckTitle: (name) => `${name} のログインの状態を CLI に訊き直します`,
  loading: "アカウントを読み込んでいます…",
  registryError: (path) =>
    `アカウントの登録簿 ${path} を読めないため、書き換えません。直すまでは既定のアカウントだけを表示します:`,
  pathTitle: (path) => path,
  noConfigDir: (path) => `設定ディレクトリがありません: ${path}`,
  defaultNotSetUp: (path) =>
    `まだ使われていません: ${path} は、ここでログインするか、エージェントを初めて起動したときに作られます。`,
  add: "アカウントを追加…",
  rename: "名前を変更",
  renameTitle: (name) => `${name} の表示名を変える`,
  renameDialogTitle: (name) => `${name} の名前を変更`,
  renameDescription:
    "変わるのは code-viewer に表示する名前だけです。設定ディレクトリ・ログイン・使用量はそのままです。",
  renameLabel: "名前",
  renameConfirm: "変更",
  renamed: (before, after) => `${before} を ${after} に変更しました。`,
  renameEmpty: "名前を入れてください。",
  renameReserved: (name) =>
    `「${name}」は既定のアカウントの名前です。別の名前にしてください。`,
  renameDuplicate: (name, agent) =>
    `${agent} のほかのアカウントに「${name}」という名前が既にあります。`,
  bandMenu: (name) => `${name} の操作`,
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
  createSource: "リンク元（既定の設定ディレクトリ）",
  shareIntro: (dir) =>
    `下の項目は ${dir} の中にあるファイルとフォルダです。チェックしたものは、新しいディレクトリから ${dir} の同じ項目へのリンクになり、両方のアカウントで同じものを使います（コピーはしません）。`,
  createLinks: "作るリンク",
  createLinkMissing: (names) =>
    `既定のディレクトリに無いためリンクしないもの: ${names}`,
  usageReasonShort: {
    "not-wrapped": "使用量の受け取りが無効です",
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
    "公式の設定の一覧に無く、中身を code-viewer では確かめられないため、既定でオフです。［場所をコピー］で場所を写せます。認証情報が入っていなければ、オンにすると共有します。",
  copyLocation: "場所をコピー",
  copiedLocation: "コピーしました",
  copyLocationFailed: "コピーできませんでした",
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
    "作ったら、続けてログインの画面を出します。ログインするまで、どこにも何も送りません。",
  createdTitle: (name) => `「${name}」を作りました`,
  createdBody:
    "ログインすると、このアカウントで使えます。公式のログインがターミナルのタブとブラウザで開きます。",
  createdSignIn: "ログインする",
  createdLater: "あとで",
  createRun: "作る",
  registerTitle: (name) => `「${name}」を登録`,
  registerMissing: (path) => `${path} がありません。`,
  registerNotDir: (path) => `${path} はディレクトリではありません。`,
  registerBody:
    "このディレクトリをそのまま登録します。code-viewer は中身を変えません。",
  registerRun: "登録する",
  added: (name) => `${name} を追加しました。`,
  usageTitle: "使用量",
  usageIntro: [
    "claude は 5時間枠と週枠の使用量をステータスラインにだけ渡します。code-viewer はステータスラインのコマンドを包み、受け取ったデータを保存してから、あなたのコマンドに同じ入力を渡し、その出力をそのまま返します。",
    "codex の使用量はセッションの記録から読むので、設定は要りません。",
  ],
  usageHow: "仕組み",
  usageReceiving: (when) =>
    `5 時間と週の使用量を受け取っています（最後に受け取った時刻: ${when}）`,
  usageWaiting:
    "有効ですが、まだ届いていません。このアカウントの claude のセッションが応答を受け取ると届きます。",
  usageOff: "5 時間と週の使用量を受け取っていません。",
  usageFile: (path) => `設定ファイル: ${path}`,
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
  statusLineAfter: "変更後の statusLine",
  statusLineNone: "（なし）",
  statusLineNothing: "変えるものはありません。",
  statusLineCopy: "写す内容をコピー",
  statusLineCopied:
    "コピーしました。この設定ファイルの生成元に貼ると、次に生成したファイルから使用量を受け取れます。",
  statusLineDiffFailed:
    "差分の画面の部品を読み込めなかったので、変わる所を文字で出しています。",
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
    "この設定ファイルは別の場所から生成されているため、code-viewer からは書き込めません。下の内容をコピーして生成元に貼ると、使用量を受け取れます:",
  backupAt: (path) => `バックアップ: ${path}`,
  usageFailures: (count) =>
    `ステータスラインの包みが使用量を保存できなかったことが ${count} 件あります`,
  usageFailuresLog: (path) => `記録: ${path}`,
  usageFailuresClear: "消す",
  sharedBy: (names) => `使っているアカウント: ${names}`,
  commandsTitle: "起動コマンド",
  commandsIntro:
    "「新しいエージェント」で tmux の新しいウィンドウに実行するコマンド。あなたの対話シェルで動くので、シェルの関数やエイリアスも使えます。",
  commandsReset: "起動コマンドを既定に戻す",
  commandsUnsaved: "未保存",
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
  launchIntro:
    "プロジェクトと tmux のセッションを選んでエージェントを起動します。",
  launchPreviewLabel: "実行するコマンド",
  launchCopy: "コマンドをコピー",
  launchCopied: "コピーしました",
  launchCopyFailed: "コマンドをコピーできませんでした",
  launchRun: "起動",
  launchStarted: (session) => `${session} で起動しました。`,
  launchRememberFailed: "起動しましたが、選んだものを覚えられませんでした:",
  launchStatusLineFailed:
    "起動しましたが、プロジェクトの statusLine を読めなかったので、このセッションの使用量は記録されません:",
  launchNeedsLogin:
    "このアカウントは未ログインです。起動したエージェントがログインを求めます。",
  launchNotSetUp:
    "このアカウントはまだ使われていません (設定ディレクトリがありません)。起動したエージェントが用意し、ログインを求めます。",
  launchLoginUnknown: (detail) =>
    `ログイン状態を確かめられませんでした: ${detail}`,
  launchNoProjects: "選べるプロジェクトがありません。",
  launchNoAccounts: "この種類のアカウントがありません。",
  currentServerProject: (name) => `${name}（このサーバ）`,
  handoffDialogTitle: "別のアカウントで続ける",
  handoffIntro: (from) =>
    `別のアカウントでエージェントを起動し、${from} の会話記録を読んで続きをやらせます。`,
  handoffLog: "引き継ぐ会話記録",
  handoffLogHint:
    "中身は code-viewer では読みません。起動したエージェントが読み、わからないことは始める前に聞きます。",
  handoffCurrent: "いまの担当",
  handoffRun: "起動して引き継ぐ",
};
