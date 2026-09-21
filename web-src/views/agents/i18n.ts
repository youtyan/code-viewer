// エージェント一覧・ヘッダの件数表示・通知の文言。アプリ全体の言語設定
// (app.ts の STATE.language) で切り替える。切替時のライブ反映は agents-view と
// agent-status の localize() が担当する。

import type { AgentKind } from "../../core/agent-overview";
import type { AgentState } from "../../core/agent-state";
import { elapsedBucket } from "../../core/terminal-board";
import { terminalText } from "../terminal/i18n";

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
  emptyNoMatchTitle: (filter: string) => string;
  emptyNoMatchBody: string;
  emptyNoMatchAction: string;
  notifyEnable: string;
  notifyEnableTitle: string;
  notifyOn: string;
  notifyOnTitle: string;
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
};

const EN: AgentsText = {
  title: "Agents",
  ariaLabel: "Coding agents in tmux",
  state: {
    waiting: "Needs input",
    working: "Working",
    done: "Finished",
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
  elapsed: (ms) => terminalText("en").elapsed(elapsedBucket(ms)),
  elapsedUnknown: "–",
  elapsedAtLeast: (lowerBound) =>
    `No change seen since this viewer started watching: in this state for at least ${lowerBound}`,
  elapsedJustWatched:
    "Just started watching: when it entered this state is not known",
  openPane: "Open in terminal",
  openServer: "Open",
  openServerTitle: (url) =>
    `Open the code-viewer running for this project (${url})`,
  currentServer: "this viewer",
  currentServerTitle: "This code-viewer is showing this project",
  serverProblem: (detail) =>
    `A code-viewer is registered for this project but could not be reached: ${detail}`,
  outsideGit: "not a git repository",
  projectError: (detail) => `Could not read the git repository: ${detail}`,
  worktreeTitle: (name) => `Running in the worktree "${name}"`,
  toggleProject: "Collapse or expand this project",
  emptyNoTmuxTitle: "tmux is not running",
  emptyNoTmuxBody:
    "Agents are listed here when they run inside tmux. Start one with “tmux new -s work”, then launch claude or codex in it.",
  emptyNotInstalledTitle: "tmux was not found",
  emptyNotInstalledBody:
    "This list reads agents from tmux. Install tmux (or pass --bin tmux=<path>) and run your agents inside it.",
  emptyNoAgentsTitle: "No agents are running",
  emptyNoAgentsBody:
    "Launch claude or codex in a tmux pane and it appears here, grouped by project.",
  emptyNoAgentsAction: "Show all panes",
  emptyNoMatchTitle: (filter) => `No agents are “${filter}”`,
  emptyNoMatchBody: "Agents in other states are hidden by the filter.",
  emptyNoMatchAction: "Clear filter",
  notifyEnable: "Enable notifications",
  notifyEnableTitle:
    "Get a desktop notification when an agent needs input or finishes",
  notifyOn: "Notifications on",
  notifyOnTitle: "Choose which changes notify you in Settings",
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
};

const JA: AgentsText = {
  title: "エージェント",
  ariaLabel: "tmux で動いているコーディングエージェント",
  state: {
    waiting: "入力待ち",
    working: "作業中",
    done: "完了",
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
  elapsed: (ms) => terminalText("ja").elapsed(elapsedBucket(ms)),
  elapsedUnknown: "–",
  elapsedAtLeast: (lowerBound) =>
    `見始めてから変化なし。少なくとも ${lowerBound} 前からこの状態です`,
  elapsedJustWatched: "見始めたばかりで、この状態になった時刻は分かりません",
  openPane: "ターミナルで開く",
  openServer: "開く",
  openServerTitle: (url) =>
    `このプロジェクトを開いている code-viewer へ移動 (${url})`,
  currentServer: "この画面",
  currentServerTitle: "いま見ている code-viewer がこのプロジェクトです",
  serverProblem: (detail) =>
    `このプロジェクトの code-viewer が登録されていますが、応答がありません: ${detail}`,
  outsideGit: "git 管理外",
  projectError: (detail) => `git リポジトリを読めませんでした: ${detail}`,
  worktreeTitle: (name) => `作業ツリー「${name}」で動いています`,
  toggleProject: "このプロジェクトを畳む / 開く",
  emptyNoTmuxTitle: "tmux が動いていません",
  emptyNoTmuxBody:
    "エージェントは tmux の中で動いているとここに並びます。「tmux new -s work」で tmux を起動し、その中で claude や codex を起動してください。",
  emptyNotInstalledTitle: "tmux が見つかりません",
  emptyNotInstalledBody:
    "この一覧は tmux からエージェントを読み取ります。tmux をインストールし (場所が違うなら --bin tmux=<パス>)、その中でエージェントを動かしてください。",
  emptyNoAgentsTitle: "エージェントが動いていません",
  emptyNoAgentsBody:
    "tmux のペインで claude や codex を起動すると、プロジェクトごとにここへ並びます。",
  emptyNoAgentsAction: "すべてのペインを表示",
  emptyNoMatchTitle: (filter) => `「${filter}」のエージェントはありません`,
  emptyNoMatchBody: "ほかの状態のエージェントは絞り込みで隠れています。",
  emptyNoMatchAction: "絞り込みを解除",
  notifyEnable: "通知を有効にする",
  notifyEnableTitle:
    "エージェントが入力待ちになったとき・終わったときにデスクトップへ通知します",
  notifyOn: "通知は有効です",
  notifyOnTitle: "どの変化で通知するかは設定で選べます",
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
};

const TEXT: Record<AgentsLang, AgentsText> = { en: EN, ja: JA };

export function agentsText(lang: AgentsLang): AgentsText {
  return TEXT[lang];
}
