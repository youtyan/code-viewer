// エージェント一覧・ヘッダの件数表示・通知の文言。アプリ全体の言語設定
// (app.ts の STATE.language) で切り替える。切替時のライブ反映は agents-view と
// agent-status の localize() が担当する。

import type {
  AgentHookState,
  HookAction,
  HookAgent,
  HookRowAction,
} from "../../core/agent-hooks";
import type { AgentKind, AgentTransition } from "../../core/agent-overview";
import type { AgentState } from "../../core/agent-state";
import { elapsedBucket } from "../../core/terminal-board";
import {
  PROJECTS_EN,
  PROJECTS_JA,
  type ProjectsText,
} from "../projects/projects-i18n";
import { terminalText } from "../terminal/i18n";
import { ACCOUNTS_EN, ACCOUNTS_JA, type AccountsText } from "./accounts-i18n";
import type { PanePreviewText } from "./pane-preview";

export type AgentsLang = "en" | "ja";

export type AgentsText = {
  title: string;
  ariaLabel: string;
  /** 状態の名前。行・絞り込み・件数に使う。 */
  state: Record<AgentState, string>;
  kind: Record<AgentKind, string>;
  /** 種類が分からないペイン (ただのシェルなど)。 */
  kindShell: string;
  filterLabel: string;
  filterAll: string;
  /** 待機の札。done (申告による完了) もここに入る。 */
  filterIdle: string;
  allPanes: string;
  allPanesTitle: string;
  refresh: string;
  loading: string;
  loadFailed: string;
  tmuxFailed: string;
  /** 観測・問い合わせの失敗をまとめた欄の見出し。 */
  problems: (count: number) => string;
  unread: string;
  unreadWaiting: string;
  unreadFinished: string;
  /** エージェントのカードの札 (見ていない間に入力待ちになった・終わった)。 */
  cardBadge: Record<AgentTransition, string>;
  /** 状態が変わってからの経過。刻み方はターミナルの一覧と同じ。 */
  elapsed: (ms: number) => string;
  /** 状態が変わった瞬間を見ていないペインの経過時間の欄。 */
  elapsedUnknown: string;
  /**
   * その欄のツールチップ。見始めてから変わっていないので、分かるのは
   * 「少なくともこれだけ前から」という下限だけ。
   */
  elapsedAtLeast: (lowerBound: string) => string;
  /** 見始めて 1 分未満。下限と言えるほどの長さが無い。 */
  elapsedJustWatched: string;
  openPane: string;
  /** 行の右クリックのメニュー: 反対の面で開く。 */
  openPaneOpposite: string;
  /** サイドバーの行の説明に添える、修飾キーの案内。 */
  openPaneOppositeHint: string;
  /** 行・タブの右クリックのメニュー: 別のアカウントで続ける (views/agents/handoff.ts)。 */
  handoff: string;
  handoffTitle: string;
  /** 会話記録の場所が分からないとき。押せない項目の下に出す、フックの案内。 */
  handoffNeedsHooks: string;
  handoffNeedsHooksTitle: string;
  openServer: string;
  openServerTitle: (url: string) => string;
  currentServer: string;
  currentServerTitle: string;
  serverProblem: (detail: string) => string;
  outsideGit: string;
  projectError: (detail: string) => string;
  worktreeTitle: (name: string) => string;
  toggleProject: string;
  emptyNoTmuxTitle: string;
  emptyNoTmuxBody: string;
  emptyNotInstalledTitle: string;
  emptyNotInstalledBody: string;
  emptyNoAgentsTitle: string;
  emptyNoAgentsBody: string;
  emptyNoAgentsAction: string;
  /** エージェント 0 の案内: プロジェクトを登録する操作と、キーの説明。 */
  emptyRegisterProject: string;
  emptyKeysLabel: string;
  emptyKeyBoard: string;
  emptyNoMatchTitle: (filter: string) => string;
  emptyNoMatchBody: string;
  emptyNoMatchAction: string;
  notifyEnable: string;
  /** 最初の入力待ちで、サイドバーに 1 度だけ出す案内。 */
  notifyHint: string;
  notifyEnableTitle: string;
  notifyOn: string;
  notifyOnTitle: string;
  notifyNotYet: string;
  notifyAskAgain: string;
  notifyDenied: string;
  notifyDeniedHelp: string;
  notifyUnsupported: string;
  notifyRequestFailed: string;
  /** ブラウザ通知の本文。 */
  notifyWaitingTitle: (project: string) => string;
  notifyFinishedTitle: (project: string) => string;
  /** ヘッダの件数表示。 */
  headerWaiting: string;
  headerWorking: string;
  headerTitle: (waiting: number, working: number) => string;
  headerFailed: (detail: string) => string;
  keyboardHint: string;
  /** 全体ボードの表 (見出しの行・列の名前・空のプロジェクト)。 */
  board: AgentsBoardText;
  /** フックが未設定のときに一覧の上に出す 1 行。 */
  hookHint: (agents: string) => string;
  hookHintOpen: string;
  hookHintClose: string;
  /** 設定画面の「エージェント連携」。 */
  hooks: AgentHooksText;
  /** アカウント・使用量・起動。 */
  accounts: AccountsText;
  projects: ProjectsText;
  /** 「読んだ」をほかの code-viewer サーバへ伝えられなかった。 */
  readRelayFailed: string;
  /** 左のサイドバー (views/agents/agents-sidebar.ts・views/shell/app-nav.ts)。 */
  sidebar: AgentsSidebarText;
  /** 行に載せたときのシェルの覗き窓 (views/agents/pane-preview.ts)。 */
  preview: PanePreviewText;
};

export type AgentsBoardText = {
  allAgents: string;
  /** 登録してあるがエージェントの居ないプロジェクトの行。 */
  noAgents: string;
  /** プロジェクトの見出しのツールチップに出す件数。 */
  projectCounts: (summary: string) => string;
};

export type AgentsSidebarText = {
  ariaLabel: string;
  projects: string;
  board: string;
  search: string;
  collapse: string;
  expand: string;
  resize: string;
  newAgent: string;
  settings: string;
  help: string;
  /** いま見ているプロジェクトの印のツールチップ。 */
  current: string;
  /** 下の区画 (登録していないが tmux にエージェントが居るプロジェクト)。 */
  detected: string;
  detectedTitle: string;
  /** 一覧の下の、起動中でない登録プロジェクトの節の見出し (件数つき)。 */
  stopped: (count: number) => string;
  stoppedTitle: string;
  /** プロジェクトのサーバを起こしている最中 (見出しの中)。 */
  starting: string;
  /** 登録したプロジェクトの見出しのツールチップ (並べ替えの仕方)。 */
  reorderHint: string;
  /** 登録したプロジェクトが 1 つも無いときの見出しと説明。 */
  noProjectsTitle: string;
  noProjectsBody: string;
  /** 一覧の下に出す 1 行の案内 (大きな箱は全体ボードに任せる)。 */
  noTmux: string;
  notInstalled: string;
  noAgents: string;
  problems: (count: number) => string;
  /** 使用量 (最下段)。 */
  usageLabel: string;
  usageTitle: (lines: string[]) => string;
};

export type AgentHooksText = {
  title: string;
  /** 入れると何が良くなるか (節の見出しの下の 1〜2 文)。 */
  intro: string;
  /** その下の 1 行。リンクの文字 (ヘルプの節の名前) を挟む。 */
  helpBefore: string;
  helpAfter: string;
  state: Record<AgentHookState, string>;
  action: Record<HookRowAction["kind"], string>;
  actionTitle: (agent: HookAgent, action: string) => string;
  loading: string;
  loadFailed: string;
  symlinkTo: (target: string) => string;
  /** 読めるが書けない (生成された) 設定ファイルの行に出す 1 文。 */
  generated: string;
  noConfigDir: (dir: string) => string;
  broken: (detail: string) => string;
  dialogTitle: (agent: HookAgent, action: HookAction) => string;
  dialogFile: string;
  dialogLinkTarget: string;
  dialogAdded: string;
  dialogRemoved: string;
  dialogNothing: string;
  dialogBackup: (path: string) => string;
  dialogNewFile: string;
  dialogKept: (count: number) => string;
  dialogFormatting: string;
  dialogLauncher: (path: string) => string;
  /** 生成された設定ファイルのとき、確認の画面の代わりに出す手順。 */
  guideTitle: (agent: HookAgent, action: HookAction) => string;
  guideSteps: Record<HookAction, readonly string[]>;
  guideLauncher: (path: string) => string;
  guideDetails: string;
  dialogCopy: string;
  dialogCopied: string;
  run: Record<HookAction, string>;
  cancel: string;
  close: string;
  planFailed: string;
  applied: Record<HookAction, string>;
  unchanged: string;
  backupAt: (path: string) => string;
  launcherWritten: (path: string) => string;
  applyFailed: string;
  /** どの時点から効くか。公式ドキュメントの記述に合わせる。 */
  effect: Record<HookAgent, Record<HookAction, string>>;
  failures: (count: number) => string;
  failuresLog: (path: string) => string;
  failuresClear: string;
  failuresClearFailed: string;
  failureLine: (time: string, stage: string, where: string) => string;
};

const HOOKS_EN: AgentHooksText = {
  title: "Agent integration",
  intro:
    "With these hooks, claude and codex tell code-viewer themselves when they are working, waiting for input or done, so the states shown are reliable. Other hooks in the file stay as they are.",
  helpBefore: "How to set them up and what they change: ",
  helpAfter: ".",
  state: {
    "no-config-dir": "Not used",
    unreadable: "File unreadable",
    none: "Not set up",
    partial: "Partly set up",
    installed: "Set up",
    broken: "Hook target missing",
  },
  action: {
    install: "Set up",
    uninstall: "Remove",
    repair: "Repair",
    "guide-install": "Show how to set up",
    "guide-uninstall": "Show how to remove",
  },
  actionTitle: (agent, action) =>
    `${action} the code-viewer hooks for ${agent}`,
  loading: "Checking…",
  loadFailed: "Could not check the agent hooks.",
  symlinkTo: (target) => `link to ${target}`,
  generated:
    "This settings file is generated elsewhere, so code-viewer cannot write it. Paste the hooks into where it is generated from.",
  noConfigDir: (dir) => `${dir} does not exist.`,
  broken: (detail) =>
    `The hooks are there but what they call is gone. Repair rewrites it.\n${detail}`,
  dialogTitle: (agent, action) =>
    action === "install"
      ? `Set up hooks for ${agent}`
      : `Remove the code-viewer hooks from ${agent}`,
  dialogFile: "File",
  dialogLinkTarget: "Link target",
  dialogAdded: "Added (at the end of each event)",
  dialogRemoved: "Removed",
  dialogNothing:
    "The file already has exactly these hooks. Nothing in it changes.",
  dialogBackup: (path) =>
    `The current content is saved to ${path} before writing.`,
  dialogNewFile:
    "The file does not exist yet and will be created (nothing to back up).",
  dialogKept: (count) =>
    count === 0
      ? "There are no other hooks in this file."
      : `The ${count} existing hook${count === 1 ? "" : "s"} from other tools stay as they are.`,
  dialogFormatting:
    "The file is re-indented when written (the settings themselves do not change).",
  dialogLauncher: (path) => `Writes the launcher the hooks call: ${path}`,
  guideTitle: (agent, action) =>
    action === "install"
      ? `Set up hooks for ${agent} in your generated settings`
      : `Remove the code-viewer hooks for ${agent} from your generated settings`,
  guideSteps: {
    install: [
      "Copy the hooks below.",
      "Add them to the hooks of wherever this settings file is generated from (your dotfiles, for example).",
      "Regenerate the settings file. Once it has the hooks, this row changes to Set up by itself.",
    ],
    uninstall: [
      "Copy the hooks below.",
      "Remove them from the hooks of wherever this settings file is generated from.",
      "Regenerate the settings file. Once they are gone, this row changes to Not set up by itself.",
    ],
  },
  guideLauncher: (path) =>
    `Copying also writes the launcher these hooks call: ${path}`,
  guideDetails: "Details: why code-viewer cannot write this file",
  dialogCopy: "Copy the hooks",
  dialogCopied: "Copied",
  run: { install: "Set up", uninstall: "Remove" },
  cancel: "Cancel",
  close: "Close",
  planFailed: "Could not prepare the change.",
  applied: { install: "Set up.", uninstall: "Removed." },
  unchanged: "Nothing needed to change.",
  backupAt: (path) => `Backup: ${path}`,
  launcherWritten: (path) => `Launcher written: ${path}`,
  applyFailed: "Could not change the settings file. Nothing was written.",
  effect: {
    claude: {
      install:
        "Running claude sessions normally pick this up on their own (claude watches its settings file). If one does not, check /hooks in it or restart it.",
      uninstall:
        "Running claude sessions normally stop calling the hooks on their own.",
    },
    codex: {
      install:
        "codex runs a new hook only after you trust it: open /hooks in codex and trust the code-viewer hooks. The codex documentation does not say whether running sessions pick up new hooks, so count on sessions started from now on.",
      uninstall:
        "Sessions started from now on no longer call the hooks. Already running ones may keep them until restarted.",
    },
  },
  failures: (count) =>
    `${count} hook report${count === 1 ? "" : "s"} did not reach code-viewer`,
  failuresLog: (path) => `Full log: ${path}`,
  failuresClear: "Clear",
  failuresClearFailed: "Could not clear the log.",
  failureLine: (time, stage, where) =>
    `${time}  ${stage}${where ? `  ${where}` : ""}`,
};

const HOOKS_JA: AgentHooksText = {
  title: "エージェント連携",
  intro:
    "入れると、claude と codex が作業中・入力待ち・完了を自分で知らせるので、状態の表示が確かになります。ファイルにあるほかのフックはそのまま残ります。",
  helpBefore: "入れ方と、入れると何が変わるかは ",
  helpAfter: " にあります。",
  state: {
    "no-config-dir": "使っていません",
    unreadable: "ファイルが読めません",
    none: "未設定",
    partial: "一部だけ設定済み",
    installed: "設定済み",
    broken: "呼び先がありません",
  },
  action: {
    install: "入れる",
    uninstall: "外す",
    repair: "直す",
    "guide-install": "入れ方を見る",
    "guide-uninstall": "外し方を見る",
  },
  actionTitle: (agent, action) => `${agent} の code-viewer のフックを${action}`,
  loading: "確認しています…",
  loadFailed: "エージェントのフックを確認できませんでした。",
  symlinkTo: (target) => `${target} へのリンク`,
  generated:
    "この設定ファイルは別の場所から生成されているため、code-viewer からは書き込めません。生成元に貼り付けてください。",
  noConfigDir: (dir) => `${dir} がありません。`,
  broken: (detail) =>
    `フックはありますが、呼び先がなくなっています。「直す」で書き直せます。\n${detail}`,
  dialogTitle: (agent, action) =>
    action === "install"
      ? `${agent} にフックを入れる`
      : `${agent} から code-viewer のフックを外す`,
  dialogFile: "ファイル",
  dialogLinkTarget: "リンク先",
  dialogAdded: "足すもの (各出来事の末尾に追加)",
  dialogRemoved: "消すもの",
  dialogNothing:
    "このファイルには既にこのとおりのフックがあります。中身は変わりません。",
  dialogBackup: (path) => `書く前の中身を ${path} に残します。`,
  dialogNewFile:
    "ファイルがまだ無いので、新しく作ります (バックアップするものはありません)。",
  dialogKept: (count) =>
    count === 0
      ? "このファイルにほかのフックはありません。"
      : `既にあるフック ${count} 件はそのまま残ります。`,
  dialogFormatting:
    "書くときに字下げが整え直されます (設定の中身は変わりません)。",
  dialogLauncher: (path) => `フックが呼ぶ起動スクリプトを書きます: ${path}`,
  guideTitle: (agent, action) =>
    action === "install"
      ? `${agent} のフックを生成元に入れる`
      : `${agent} の code-viewer のフックを生成元から外す`,
  guideSteps: {
    install: [
      "下のフックをコピーします。",
      "この設定ファイルを生成している元 (dotfiles など) の hooks に足します。",
      "設定ファイルを生成し直します。フックが入ると、この行は自動で「設定済み」に変わります。",
    ],
    uninstall: [
      "下のフックをコピーします。",
      "この設定ファイルを生成している元の hooks から消します。",
      "設定ファイルを生成し直します。フックが消えると、この行は自動で「未設定」に変わります。",
    ],
  },
  guideLauncher: (path) =>
    `コピーするときに、フックが呼ぶ起動スクリプトも用意します: ${path}`,
  guideDetails: "詳細: code-viewer がこのファイルに書き込めない理由",
  dialogCopy: "フックをコピー",
  dialogCopied: "コピーしました",
  run: { install: "入れる", uninstall: "外す" },
  cancel: "取消",
  close: "閉じる",
  planFailed: "変更の内容を用意できませんでした。",
  applied: { install: "入れました。", uninstall: "外しました。" },
  unchanged: "変更は必要ありませんでした。",
  backupAt: (path) => `バックアップ: ${path}`,
  launcherWritten: (path) => `起動スクリプトを書きました: ${path}`,
  applyFailed: "設定ファイルを変更できませんでした。何も書いていません。",
  effect: {
    claude: {
      install:
        "動いている claude にも、通常はそのまま効きます (claude が設定ファイルの変更を読み直すため)。効かないときは claude の /hooks で確かめるか、起動し直してください。",
      uninstall: "動いている claude からも、通常はそのまま外れます。",
    },
    codex: {
      install:
        "codex は、信頼するまでフックを実行しません。codex で /hooks を開き、code-viewer のフックを信頼してください。動いている codex に効くかは公式の説明に無いため、確実なのはこれから起動するものです。",
      uninstall:
        "これから起動する codex では呼ばれません。動いているものには、起動し直すまで残ることがあります。",
    },
  },
  failures: (count) =>
    `フックの申告が code-viewer に届かなかったことが ${count} 件あります`,
  failuresLog: (path) => `記録の全体: ${path}`,
  failuresClear: "記録を消す",
  failuresClearFailed: "記録を消せませんでした。",
  failureLine: (time, stage, where) =>
    `${time}  ${stage}${where ? `  ${where}` : ""}`,
};

const EN: AgentsText = {
  title: "Agents",
  ariaLabel: "Coding agents in tmux",
  state: {
    waiting: "Needs input",
    working: "Working",
    done: "Finished · unread",
    idle: "Idle",
  },
  kind: { claude: "claude", codex: "codex", other: "agent" },
  kindShell: "shell",
  filterLabel: "State",
  filterAll: "All",
  filterIdle: "Idle",
  allPanes: "All panes",
  allPanesTitle: "Also show panes where no agent is running (plain shells)",
  refresh: "Refresh",
  loading: "Loading tmux panes…",
  loadFailed: "Could not load the agent list.",
  tmuxFailed: "Could not list tmux panes.",
  problems: (count) =>
    `${count} problem${count === 1 ? "" : "s"} while reading agent state`,
  unread: "Unread",
  unreadWaiting: "Started waiting for input while you were away",
  unreadFinished: "Finished while you were away",
  cardBadge: { waiting: "Needs input", finished: "Done" },
  elapsed: (ms) => terminalText("en").elapsed(elapsedBucket(ms)),
  elapsedUnknown: "–",
  elapsedAtLeast: (lowerBound) =>
    `No change seen since this viewer started watching: in this state for at least ${lowerBound}`,
  elapsedJustWatched:
    "Just started watching: when it entered this state is not known",
  openPane: "Open in a tab",
  openPaneOpposite: "Open in the opposite pane",
  openPaneOppositeHint: "Alt+click: open in the opposite pane",
  handoff: "Continue with another account…",
  handoffTitle:
    "Start claude or codex with another account in a new window of the same tmux session, and have it read this agent's conversation log and continue",
  handoffNeedsHooks: "Needs the agent hooks — show how to install",
  handoffNeedsHooksTitle:
    "The hooks tell code-viewer where the conversation log is. After installing them, send the agent one message.",
  openServer: "Open",
  openServerTitle: (url) =>
    `Open the code-viewer running for this project (${url})`,
  currentServer: "selected",
  currentServerTitle: "This project is the one shown on this screen",
  serverProblem: (detail) =>
    `A code-viewer is registered for this project but could not be reached: ${detail}`,
  outsideGit: "not a git repository",
  projectError: (detail) => `Could not read the git repository: ${detail}`,
  worktreeTitle: (name) => `Running in the worktree "${name}"`,
  toggleProject: "Collapse or expand this project",
  emptyNoTmuxTitle: "tmux is not running",
  emptyNoTmuxBody:
    "Agents are listed here when they run inside tmux. New agent starts claude or codex in a new tmux session for you, or run them in tmux yourself (“tmux new -s work”).",
  emptyNotInstalledTitle: "tmux was not found",
  emptyNotInstalledBody:
    "This list reads agents from tmux. Install tmux (or pass --bin tmux=<path>) and run your agents inside it.",
  emptyNoAgentsTitle: "No agents are running",
  emptyNoAgentsBody:
    "Start one with New agent, or launch claude or codex in a tmux pane; it appears here, grouped by project.",
  emptyNoAgentsAction: "Show all panes",
  emptyRegisterProject: "Register a project…",
  emptyKeysLabel: "Keys",
  emptyKeyBoard: "All agents",
  emptyNoMatchTitle: (filter) => `No agents are “${filter}”`,
  emptyNoMatchBody: "Agents in other states are hidden by the filter.",
  emptyNoMatchAction: "Clear filter",
  notifyEnable: "Enable notifications",
  notifyHint:
    "An agent needs input. Allow notifications to hear about it while you are in another tab or window.",
  notifyEnableTitle:
    "Get a desktop notification when an agent needs input or finishes",
  notifyOn: "Notifications on",
  notifyOnTitle: "Choose which changes notify you in Settings",
  notifyNotYet: "Notifications are not allowed yet",
  notifyAskAgain: "Ask again",
  notifyDenied: "Notifications are blocked",
  notifyDeniedHelp:
    "Allow notifications for this site from the icon at the left of the address bar, then reload.",
  notifyUnsupported: "This browser cannot show notifications",
  notifyRequestFailed: "Could not ask for notification permission",
  notifyWaitingTitle: (project) => `Needs input · ${project}`,
  notifyFinishedTitle: (project) => `Finished · ${project}`,
  headerWaiting: "Needs input",
  headerWorking: "Working",
  headerTitle: (waiting, working) =>
    `Agents: ${waiting} need input, ${working} working. Open the agent list (g a)`,
  headerFailed: (detail) => `Could not read the agent list: ${detail}`,
  keyboardHint: "↑↓ move · Enter open",
  board: {
    allAgents: "All agents",
    noAgents: "No agents",
    projectCounts: (summary) => summary || "No agents",
  },
  hookHint: (agents) =>
    `Finish detection is off for ${agents}. Hooks make it reliable.`,
  hookHintOpen: "Set up",
  hookHintClose: "Hide this",
  hooks: HOOKS_EN,
  accounts: ACCOUNTS_EN,
  projects: PROJECTS_EN,
  readRelayFailed:
    "Marked as read here, but some other code-viewer servers were not told (they may still show it as unread):",
  sidebar: {
    ariaLabel: "Projects and agents",
    projects: "Projects",
    board: "All agents (g a)",
    // 押すと開くパレットはプロジェクト・エージェント・ファイルなどをまとめて探す
    // (ボタンの title と同じ意味の短い形。app.ts の global.search)。
    search: "Search",
    collapse: "Hide sidebar",
    expand: "Show sidebar",
    resize: "Resize sidebar",
    newAgent: "New agent",
    settings: "Settings",
    help: "Help",
    current: "This window shows this project",
    detected: "Detected in tmux",
    starting: "Starting…",
    detectedTitle:
      "Projects with agents in tmux that are not registered. Opening one registers it.",
    stopped: (count) => `Not running (${count})`,
    stoppedTitle:
      "Registered projects with no agent, no shell and no running process. Opening one starts it.",
    noProjectsTitle: "No projects yet",
    noProjectsBody: "Register a repository and it is listed here.",
    reorderHint: "Drag, or Alt+↑ / Alt+↓, to reorder",
    noTmux: "tmux is not running",
    notInstalled: "tmux was not found",
    noAgents: "No agents are running",
    problems: (count) =>
      `${count} problem${count === 1 ? "" : "s"} reading agents — open the board`,
    usageLabel: "Usage by account",
    usageTitle: (lines) => lines.join("\n"),
  },
  preview: {
    label: (name) => `Preview: ${name}`,
    loading: "Loading…",
    gone: "This pane has closed.",
    failed: (detail) => `Could not read the pane.\n${detail}`,
  },
};

const JA: AgentsText = {
  title: "エージェント",
  ariaLabel: "tmux で動いているコーディングエージェント",
  state: {
    waiting: "入力待ち",
    working: "作業中",
    done: "完了・未読",
    idle: "待機",
  },
  kind: { claude: "claude", codex: "codex", other: "エージェント" },
  kindShell: "シェル",
  filterLabel: "状態",
  filterAll: "すべて",
  filterIdle: "待機",
  allPanes: "すべてのペイン",
  allPanesTitle: "エージェントが動いていないペイン (ただのシェル) も出す",
  refresh: "再読み込み",
  loading: "tmux のペインを読み込んでいます…",
  loadFailed: "エージェント一覧を取得できませんでした。",
  tmuxFailed: "tmux のペイン一覧を取得できませんでした。",
  problems: (count) => `状態の読み取りで ${count} 件の問題があります`,
  unread: "未読",
  unreadWaiting: "見ていない間に入力待ちになりました",
  unreadFinished: "見ていない間に終わりました",
  cardBadge: { waiting: "入力待ち", finished: "完了" },
  elapsed: (ms) => terminalText("ja").elapsed(elapsedBucket(ms)),
  elapsedUnknown: "–",
  elapsedAtLeast: (lowerBound) =>
    `見始めてから変化なし。少なくとも ${lowerBound} 前からこの状態です`,
  elapsedJustWatched: "見始めたばかりで、この状態になった時刻は分かりません",
  openPane: "タブで開く",
  openPaneOpposite: "反対の面で開く",
  openPaneOppositeHint: "Alt+クリック: 反対の面で開く",
  handoff: "別のアカウントで続ける…",
  handoffTitle:
    "同じ tmux のセッションの新しいウィンドウで、別のアカウントの claude か codex を起動し、このエージェントの会話記録を読んで続きをやらせます",
  handoffNeedsHooks: "フックを入れると使えます（入れ方を見る）",
  handoffNeedsHooksTitle:
    "会話記録の場所はフックから受け取ります。入れた後、そのエージェントに一度話しかけると使えます。",
  openServer: "開く",
  openServerTitle: (url) =>
    `このプロジェクトを開いている code-viewer へ移動 (${url})`,
  currentServer: "選択中",
  currentServerTitle: "いまこの画面で選んでいるプロジェクトです",
  serverProblem: (detail) =>
    `このプロジェクトの code-viewer が登録されていますが、応答がありません: ${detail}`,
  outsideGit: "git 管理外",
  projectError: (detail) => `git リポジトリを読めませんでした: ${detail}`,
  worktreeTitle: (name) => `作業ツリー「${name}」で動いています`,
  toggleProject: "このプロジェクトを畳む / 開く",
  emptyNoTmuxTitle: "tmux が動いていません",
  emptyNoTmuxBody:
    "エージェントは tmux の中で動いているとここに並びます。「新しいエージェント」で claude や codex を新しい tmux のセッションに起動できます (自分で「tmux new -s work」から起動してもかまいません)。",
  emptyNotInstalledTitle: "tmux が見つかりません",
  emptyNotInstalledBody:
    "この一覧は tmux からエージェントを読み取ります。tmux をインストールし (場所が違うなら --bin tmux=<パス>)、その中でエージェントを動かしてください。",
  emptyNoAgentsTitle: "エージェントが動いていません",
  emptyNoAgentsBody:
    "「新しいエージェント」で起動するか、tmux のペインで claude や codex を起動すると、プロジェクトごとにここへ並びます。",
  emptyNoAgentsAction: "すべてのペインを表示",
  emptyRegisterProject: "プロジェクトを登録…",
  emptyKeysLabel: "キー",
  emptyKeyBoard: "すべてのエージェント",
  emptyNoMatchTitle: (filter) => `「${filter}」のエージェントはありません`,
  emptyNoMatchBody: "ほかの状態のエージェントは絞り込みで隠れています。",
  emptyNoMatchAction: "絞り込みを解除",
  notifyEnable: "通知を有効にする",
  notifyHint:
    "エージェントが入力を待っています。通知を許可すると、別のタブや窓にいても知らせます。",
  notifyEnableTitle:
    "エージェントが入力待ちになったとき・終わったときにデスクトップへ通知します",
  notifyOn: "通知は有効です",
  notifyOnTitle: "どの変化で通知するかは設定で選べます",
  notifyNotYet: "まだ許可されていません",
  notifyAskAgain: "もう一度求める",
  notifyDenied: "通知がブロックされています",
  notifyDeniedHelp:
    "アドレスバー左のアイコンからこのサイトの「通知」を許可し、再読み込みしてください。",
  notifyUnsupported: "このブラウザは通知に対応していません",
  notifyRequestFailed: "通知の許可を求められませんでした",
  notifyWaitingTitle: (project) => `入力待ち · ${project}`,
  notifyFinishedTitle: (project) => `完了 · ${project}`,
  headerWaiting: "入力待ち",
  headerWorking: "作業中",
  headerTitle: (waiting, working) =>
    `エージェント: 入力待ち ${waiting} · 作業中 ${working}。一覧を開く (g a)`,
  headerFailed: (detail) => `エージェント一覧を取得できませんでした: ${detail}`,
  keyboardHint: "↑↓ 移動 · Enter 開く",
  board: {
    allAgents: "すべてのエージェント",
    noAgents: "エージェントはいません",
    projectCounts: (summary) => summary || "エージェントはいません",
  },
  hookHint: (agents) =>
    `${agents} の完了の検知を有効にできます (フックが未設定です)。`,
  hookHintOpen: "設定する",
  hookHintClose: "閉じる",
  hooks: HOOKS_JA,
  accounts: ACCOUNTS_JA,
  projects: PROJECTS_JA,
  readRelayFailed:
    "ここでは既読にしましたが、ほかの code-viewer サーバの一部に伝えられませんでした (そちらでは未読のまま見えることがあります):",
  sidebar: {
    ariaLabel: "プロジェクトとエージェント",
    projects: "プロジェクト",
    board: "すべてのエージェント (g a)",
    search: "検索",
    collapse: "サイドバーを隠す",
    expand: "サイドバーを表示",
    resize: "サイドバーの幅を変える",
    newAgent: "新しいエージェント",
    settings: "設定",
    help: "ヘルプ",
    current: "この画面がこのプロジェクトです",
    detected: "tmux で検出",
    starting: "起動中…",
    detectedTitle:
      "登録していないが tmux でエージェントが動いているプロジェクト。開くと登録されます。",
    stopped: (count) => `停止中 (${count})`,
    stoppedTitle:
      "エージェントもシェルも無く、プロセスも動いていない登録済みのプロジェクト。開くと起動します。",
    noProjectsTitle: "プロジェクトはまだありません",
    noProjectsBody: "リポジトリを登録すると、ここに並びます。",
    reorderHint: "ドラッグか Alt+↑ / Alt+↓ で並べ替え",
    noTmux: "tmux が動いていません",
    notInstalled: "tmux が見つかりません",
    noAgents: "エージェントが動いていません",
    problems: (count) =>
      `エージェントの読み取りで ${count} 件の問題 — ボードで確認`,
    usageLabel: "アカウントごとの使用量",
    usageTitle: (lines) => lines.join("\n"),
  },
  preview: {
    label: (name) => `プレビュー: ${name}`,
    loading: "読み込み中…",
    gone: "このペインは閉じられました。",
    failed: (detail) => `ペインを読めませんでした。\n${detail}`,
  },
};

const TEXT: Record<AgentsLang, AgentsText> = { en: EN, ja: JA };

export function agentsText(lang: AgentsLang): AgentsText {
  return TEXT[lang];
}
