// プロジェクトの登録・開く・止める・ヘッダの切替の文言。エージェント一覧の
// 文言 (views/agents/i18n.ts) の projects に入れて、同じ言語設定で切り替える。

import type { ProjectColor } from "../../core/project-colors";

export type ProjectsText = {
  /** 見出しのメニューを開くボタン。 */
  menu: string;
  menuTitle: (name: string) => string;
  register: string;
  registerTitle: string;
  unregister: string;
  unregisterTitle: string;
  rename: string;
  /** メニューの「色」。押すと色の一覧に替わる。 */
  color: string;
  colorTitle: string;
  colorNames: Record<ProjectColor, string>;
  moveUp: string;
  moveDown: string;
  stopServer: string;
  stopServerTitle: string;
  stopServerNotLaunched: string;
  /** 登録したプロジェクトの印 (見出しの名前の横)。 */
  registeredMark: string;
  /** 起こしている間、見出しの「開く」の場所に出す。 */
  starting: string;
  startingTitle: (name: string) => string;
  openFailed: (name: string) => string;
  stopFailed: (name: string) => string;
  changeFailed: string;
  dismiss: string;
  openTitle: (name: string) => string;
  openStoppedTitle: (name: string) => string;
  openUnregisteredTitle: (name: string) => string;
  registerFirstTitle: string;
  registerFirstBody: (name: string, root: string) => string;
  registerAndOpen: string;
  cancel: string;
  unregisterConfirmTitle: (name: string) => string;
  unregisterConfirmBody: (root: string) => string;
  unregisterConfirm: string;
  stopConfirmTitle: (name: string) => string;
  stopConfirmBody: string;
  stopConfirm: string;
  renameTitle: string;
  renameLabel: string;
  renameHint: (folder: string) => string;
  save: string;
  addPathTitle: string;
  addPathLabel: string;
  addPathHint: string;
  addPathSubmit: string;
  registryProblem: (detail: string) => string;
  /** 入口のサーバの下で、このプロジェクトの裏のプロセスが止まった・起きなかった。 */
  backendStoppedTitle: (name: string) => string;
  backendFailedTitle: (name: string) => string;
  backendRestart: string;
  backendRestartFailed: string;
  /** 中央の面の空表示 (views/backend-state.ts)。 */
  backendStoppedHeading: string;
  backendSurfaceText: (name: string) => string;
  backendDialogText: string;
  backendDetails: string;
  backendStartingTitle: (name: string) => string;
  backendStartingText: string;
  close: string;
  /** ヘッダの切替。 */
  switcherTitle: string;
  switcherHint: string;
  switcherPlaceholder: string;
  switcherCurrent: string;
  switcherEmpty: string;
  switcherNoMatch: string;
  switcherRegisterCurrent: (name: string) => string;
  switcherRegisterCurrentHint: string;
  switcherAddPath: string;
  switcherCounts: (waiting: number, working: number) => string;
  switcherStopped: string;
  switcherButtonTitle: (key: string) => string;
};

export const PROJECTS_EN: ProjectsText = {
  menu: "⋯",
  menuTitle: (name) => `More for ${name}`,
  register: "Register project",
  registerTitle:
    "Keep this project in the list and the header switcher, even when no agent runs in it",
  unregister: "Remove from projects…",
  unregisterTitle:
    "Remove it from the registered projects. The repository is not touched.",
  rename: "Rename…",
  color: "Color…",
  colorTitle:
    "The project's color and initials, shared by the sidebar, the board, the switcher and the window's title bar",
  colorNames: {
    violet: "Violet",
    green: "Green",
    orange: "Orange",
    blue: "Blue",
    amber: "Amber",
    pink: "Pink",
    cyan: "Cyan",
    red: "Red",
    olive: "Olive",
  },
  moveUp: "Move up",
  moveDown: "Move down",
  stopServer: "Stop its code-viewer…",
  stopServerTitle: "Stop the code-viewer server that code-viewer started",
  stopServerNotLaunched:
    "Started outside code-viewer (or this screen) — stop it where it was started",
  registeredMark: "Registered project",
  starting: "Starting…",
  startingTitle: (name) => `Starting the code-viewer server for ${name}`,
  openFailed: (name) => `Could not open ${name}`,
  stopFailed: (name) => `Could not stop the code-viewer of ${name}`,
  changeFailed: "Could not change the registered projects",
  dismiss: "Dismiss",
  openTitle: (name) => `Open ${name} in this tab`,
  openStoppedTitle: (name) =>
    `Start the process for ${name} and open it in this tab`,
  openUnregisteredTitle: (name) =>
    `No code-viewer is running for ${name}. Register it to start one from here.`,
  registerFirstTitle: "Register this project?",
  registerFirstBody: (name, root) =>
    `No code-viewer is running for ${name}. code-viewer starts servers only for registered projects.\n\nRegister ${root} and open it?`,
  registerAndOpen: "Register and open",
  cancel: "Cancel",
  unregisterConfirmTitle: (name) => `Remove ${name} from projects?`,
  unregisterConfirmBody: (root) =>
    `${root} is only removed from the list. Nothing in the repository changes. Its running code-viewer, if any, keeps running.`,
  unregisterConfirm: "Remove",
  stopConfirmTitle: (name) => `Stop the code-viewer of ${name}?`,
  stopConfirmBody:
    "Its browser shells close. Tabs showing it stop updating. You can open it again from here.",
  stopConfirm: "Stop",
  renameTitle: "Rename project",
  renameLabel: "Name",
  renameHint: (folder) => `Leave empty to use the folder name (${folder}).`,
  save: "Save",
  addPathTitle: "Register a project by path",
  addPathLabel: "Path of the repository (or any folder inside it)",
  addPathHint:
    "An absolute path. A folder inside a repository or a worktree registers the repository.",
  addPathSubmit: "Register",
  registryProblem: (detail) =>
    `The registered projects cannot be read, so they are not shown and cannot be changed:\n${detail}`,
  backendStoppedTitle: (name) => `The process for ${name} stopped`,
  backendFailedTitle: (name) => `The process for ${name} did not start`,
  backendRestart: "Restart",
  backendRestartFailed: "The process for this project could not be restarted",
  backendStoppedHeading: "The process for this project is not running",
  backendSurfaceText: (name) =>
    `Restart it to show ${name} here. The terminal and the agents keep working.`,
  backendDialogText:
    "Restart it to show this project again. Details has the reason and the end of its output.",
  backendDetails: "Details",
  backendStartingTitle: (name) => `Starting the process for ${name}…`,
  backendStartingText: "The screen appears when it is ready.",
  close: "Close",
  switcherTitle: "Projects",
  switcherHint: "↑↓ move · Enter open · Esc close",
  switcherPlaceholder: "Filter projects",
  switcherCurrent: "this viewer",
  switcherEmpty: "No projects are registered yet.",
  switcherNoMatch: "No project matches.",
  switcherRegisterCurrent: (name) => `Register ${name}`,
  switcherRegisterCurrentHint:
    "Registered projects stay in the agents list and here, and open in this tab.",
  switcherAddPath: "Register by path…",
  switcherCounts: (waiting, working) =>
    `Waiting ${waiting} · Working ${working}`,
  switcherStopped: "not running",
  switcherButtonTitle: (key) => `Switch project (${key})`,
};

export const PROJECTS_JA: ProjectsText = {
  menu: "⋯",
  menuTitle: (name) => `${name} のその他の操作`,
  register: "プロジェクトに登録",
  registerTitle:
    "エージェントが居なくても、一覧とヘッダの切替にこのプロジェクトを出します",
  unregister: "登録を外す…",
  unregisterTitle: "登録したプロジェクトから外します。リポジトリには触りません",
  rename: "名前を変える…",
  color: "色…",
  colorTitle:
    "プロジェクトの色と頭文字。左の一覧・全体ボード・切替の小窓・窓の上端の帯で同じものを使います",
  colorNames: {
    violet: "紫",
    green: "緑",
    orange: "橙",
    blue: "青",
    amber: "黄",
    pink: "桃",
    cyan: "水色",
    red: "赤",
    olive: "黄緑",
  },
  moveUp: "上へ",
  moveDown: "下へ",
  stopServer: "code-viewer を止める…",
  stopServerTitle: "code-viewer が起こしたサーバを止めます",
  stopServerNotLaunched:
    "code-viewer の外で起動したサーバ (またはこの画面) です。起動した場所で止めてください",
  registeredMark: "登録したプロジェクト",
  starting: "起動中…",
  startingTitle: (name) => `${name} の code-viewer を起動しています`,
  openFailed: (name) => `${name} を開けませんでした`,
  stopFailed: (name) => `${name} の code-viewer を止められませんでした`,
  changeFailed: "登録したプロジェクトを変更できませんでした",
  dismiss: "閉じる",
  openTitle: (name) => `${name} をこのタブで開く`,
  openStoppedTitle: (name) => `${name} のプロセスを起動して、このタブで開く`,
  openUnregisteredTitle: (name) =>
    `${name} の code-viewer は動いていません。登録するとここから起動できます`,
  registerFirstTitle: "このプロジェクトを登録しますか？",
  registerFirstBody: (name, root) =>
    `${name} の code-viewer は動いていません。code-viewer がサーバを起動するのは、登録したプロジェクトだけです。\n\n${root} を登録して開きますか？`,
  registerAndOpen: "登録して開く",
  cancel: "キャンセル",
  unregisterConfirmTitle: (name) => `${name} の登録を外しますか？`,
  unregisterConfirmBody: (root) =>
    `${root} を一覧から外すだけです。リポジトリの中は何も変わりません。動いている code-viewer はそのまま動き続けます。`,
  unregisterConfirm: "外す",
  stopConfirmTitle: (name) => `${name} の code-viewer を止めますか？`,
  stopConfirmBody:
    "そのサーバのブラウザシェルは閉じます。それを開いているタブは更新されなくなります。ここからまた開けます。",
  stopConfirm: "止める",
  renameTitle: "プロジェクトの名前",
  renameLabel: "名前",
  renameHint: (folder) => `空にするとフォルダ名 (${folder}) に戻ります。`,
  save: "保存",
  addPathTitle: "パスを入力して登録",
  addPathLabel: "リポジトリのパス (中のフォルダでも可)",
  addPathHint:
    "絶対パスで入力します。リポジトリの中のフォルダや作業ツリーを指定すると、そのリポジトリを登録します。",
  addPathSubmit: "登録",
  registryProblem: (detail) =>
    `登録したプロジェクトを読めないため、表示も変更もできません:\n${detail}`,
  backendStoppedTitle: (name) => `${name} のプロセスが止まりました`,
  backendFailedTitle: (name) => `${name} のプロセスを起動できませんでした`,
  backendRestart: "再起動",
  backendRestartFailed: "このプロジェクトのプロセスを再起動できませんでした",
  backendStoppedHeading: "このプロジェクトのプロセスが止まっています",
  backendSurfaceText: (name) =>
    `再起動すると、ここに ${name} を表示します。ターミナルとエージェントはそのまま使えます。`,
  backendDialogText:
    "再起動すると、このプロジェクトをもう一度表示します。止まった理由と出力の末尾は「詳細」にあります。",
  backendDetails: "詳細",
  backendStartingTitle: (name) => `${name} のプロセスを起動しています…`,
  backendStartingText: "起動し終わると画面を表示します。",
  close: "閉じる",
  switcherTitle: "プロジェクト",
  switcherHint: "↑↓ 移動 · Enter 開く · Esc 閉じる",
  switcherPlaceholder: "プロジェクトを絞り込む",
  switcherCurrent: "この画面",
  switcherEmpty: "登録したプロジェクトはまだありません。",
  switcherNoMatch: "一致するプロジェクトはありません。",
  switcherRegisterCurrent: (name) => `${name} を登録`,
  switcherRegisterCurrentHint:
    "登録したプロジェクトは、エージェント一覧とここに常に並び、このタブで開けます。",
  switcherAddPath: "パスを入力して登録…",
  switcherCounts: (waiting, working) =>
    `入力待ち ${waiting} · 作業中 ${working}`,
  switcherStopped: "停止中",
  switcherButtonTitle: (key) => `プロジェクトを切り替える (${key})`,
};
