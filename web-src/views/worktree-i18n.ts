// worktree 画面の文言。アプリ全体の言語設定 (app.ts の STATE.language) と
// 同じ値で切り替える。切替時のライブ反映は worktree-view の localize() が担当。

import type { WorktreeNameError } from "../core/worktree";

export type WorktreeLang = "en" | "ja";

export type WorktreeText = {
  title: string;
  ariaLabel: string;
  loading: string;
  loadFailed: string;
  empty: string;
  refresh: string;
  refreshTitle: string;
  count: (n: number) => string;
  /** 位置関係の基準にしているブランチ。 */
  baseLabel: (branch: string) => string;
  baseUnknown: string;
  addParentHint: (path: string) => string;
  /**
   * 追加先はリポジトリの中なので、git からは未追跡ディレクトリに見える。
   * .gitignore を書き換えるかどうかはリポジトリ側の判断なので、こちらでは
   * 触らずに伝えるだけにする。
   */
  gitignoreHint: string;
  badges: {
    current: string;
    detached: string;
    bare: string;
    locked: string;
    prunable: string;
    missing: string;
    running: string;
  };
  /** 基準ブランチとの位置関係。 */
  diverge: {
    ahead: (n: number) => string;
    behind: (n: number) => string;
    even: string;
    aheadTitle: (n: number, base: string) => string;
    behindTitle: (n: number, base: string) => string;
    /** 基準そのもの、または比べられない行。 */
    notComparable: string;
  };
  merge: {
    clean: (base: string) => string;
    conflict: (n: number, base: string) => string;
    unknown: string;
    conflictListLabel: string;
  };
  files: {
    /** 見出し。n は全体の数。 */
    heading: (n: number) => string;
    none: string;
    uncommitted: string;
    committed: string;
    /** 上限で切られたとき。 */
    truncated: (shown: number, total: number) => string;
    overlapMark: string;
    overlapTitle: (others: string[]) => string;
    statusTitles: Record<string, string>;
  };
  overlaps: {
    heading: (n: number) => string;
    intro: string;
    entry: (path: string, worktrees: string[]) => string;
  };
  /** 3 つのペインの見出しと、まだ何も選んでいないときの案内。 */
  panes: {
    worktrees: string;
    files: string;
    diff: string;
    filterWorktrees: string;
    filterFiles: string;
    noWorktreeMatch: string;
    noFileMatch: string;
    selectWorktree: string;
    selectFile: string;
    diffLoading: string;
    diffEmpty: string;
    diffFailed: string;
    diffTruncated: (shown: number, total: number) => string;
  };
  noCommit: string;
  open: string;
  openTitle: string;
  opening: string;
  openFailed: string;
  add: string;
  addTitle: string;
  addFailed: string;
  addDialog: {
    title: string;
    nameLabel: string;
    namePlaceholder: string;
    branchLabel: string;
    branchPlaceholder: string;
    branchHint: string;
    submit: string;
  };
  remove: string;
  removeTitle: string;
  removeDialog: {
    title: string;
    body: (name: string) => string;
    /** フォルダのフルパスを伝える行。「元に戻せません」を必ず含める。 */
    diskNote: (path: string) => string;
    branchNote: (branch: string) => string;
    dirtyNote: (count: number) => string;
    /** dirtyNote の 2 行目。変更を失うことそのものを伝える。 */
    dirtyLose: string;
    force: string;
    /** 変更があるのにチェック無しで確定しようとしたときの検証メッセージ。 */
    forceRequired: string;
    /** フォルダが既に無い行の文面。「消えます」とは言えないので別にする。 */
    missingBody: (name: string) => string;
    missingNote: string;
    submit: string;
  };
  removeFailed: string;
  cancel: string;
  nameErrors: Record<WorktreeNameError, string>;
};

const EN_STATUS_TITLES: Record<string, string> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  U: "untracked",
};

const JA_STATUS_TITLES: Record<string, string> = {
  M: "変更",
  A: "追加",
  D: "削除",
  R: "リネーム",
  C: "コピー",
  U: "未追跡",
};

const TEXT: Record<WorktreeLang, WorktreeText> = {
  en: {
    title: "Worktrees",
    ariaLabel: "Git worktrees",
    loading: "Loading worktrees…",
    loadFailed: "Failed to load worktrees.",
    empty: "No worktrees.",
    refresh: "Reload",
    refreshTitle: "Reload the worktree list",
    count: (n) => (n === 1 ? "1 worktree" : `${n} worktrees`),
    baseLabel: (branch) => `compared with ${branch}`,
    baseUnknown: "no base branch found",
    addParentHint: (path) => `New worktrees are created under ${path}`,
    gitignoreHint:
      "Git sees that directory as untracked. Add .worktrees/ to .gitignore to keep it out of git status.",
    badges: {
      current: "this server",
      detached: "detached",
      bare: "bare",
      locked: "locked",
      prunable: "prunable",
      missing: "missing",
      running: "running",
    },
    diverge: {
      ahead: (n) => `${n} ahead`,
      behind: (n) => `${n} behind`,
      even: "up to date",
      aheadTitle: (n, base) =>
        `${n} commit(s) here that ${base} does not have yet`,
      behindTitle: (n, base) =>
        `${n} commit(s) on ${base} that are missing here`,
      notComparable: "not compared",
    },
    merge: {
      clean: (base) => `merges into ${base} cleanly`,
      conflict: (n, base) =>
        n === 1
          ? `1 file would conflict with ${base}`
          : `${n} files would conflict with ${base}`,
      unknown: "could not check the merge",
      conflictListLabel: "Conflicting files",
    },
    files: {
      heading: (n) => (n === 1 ? "1 changed file" : `${n} changed files`),
      none: "No changes.",
      uncommitted: "Not committed yet",
      committed: "Committed, not merged",
      truncated: (shown, total) => `showing ${shown} of ${total}`,
      // 行の中に置くので短くする。誰と重なっているかは title に入る。
      overlapMark: "shared",
      overlapTitle: (others) => `Also changed in: ${others.join(", ")}`,
      statusTitles: EN_STATUS_TITLES,
    },
    overlaps: {
      heading: (n) =>
        n === 1
          ? "1 file is touched by more than one worktree"
          : `${n} files are touched by more than one worktree`,
      intro:
        "Merging one of them will make the others conflict on these files.",
      entry: (path, worktrees) => `${path} — ${worktrees.join(", ")}`,
    },
    panes: {
      worktrees: "Worktrees",
      files: "Files",
      diff: "Diff",
      filterWorktrees: "Filter worktrees…",
      filterFiles: "Filter files…",
      noWorktreeMatch: "No worktree matches.",
      noFileMatch: "No file matches.",
      selectWorktree: "Pick a worktree to see what it is changing.",
      selectFile: "Pick a file to see its diff.",
      diffLoading: "Loading the diff…",
      diffEmpty: "No textual diff (binary, or the file is unchanged).",
      diffFailed: "Failed to load the diff.",
      diffTruncated: (shown, total) =>
        `showing ${shown} of ${total} hunks — open the worktree for the whole file`,
    },
    noCommit: "no commit",
    open: "Open",
    openTitle: "Open code-viewer for this worktree in a new tab",
    opening: "Starting…",
    openFailed: "Failed to open this worktree.",
    add: "Add",
    addTitle: "Create a new worktree",
    addFailed: "Failed to create the worktree.",
    addDialog: {
      title: "Add worktree",
      nameLabel: "Directory name",
      namePlaceholder: "feature-x",
      branchLabel: "Branch",
      branchPlaceholder: "same as the directory name",
      branchHint:
        "An existing branch is checked out; a new one is created otherwise.",
      submit: "Create",
    },
    remove: "Remove",
    removeTitle: "Delete this worktree",
    removeDialog: {
      title: "Delete worktree",
      body: (name) => `Delete the worktree "${name}"?`,
      diskNote: (path) =>
        `The folder ${path} and everything in it will be deleted from disk. This cannot be undone.`,
      branchNote: (branch) =>
        `The branch ${branch} and its committed work are kept.`,
      dirtyNote: (count) =>
        count === 1
          ? "1 file has uncommitted changes."
          : `${count} files have uncommitted changes.`,
      dirtyLose: "Deleting the worktree will lose them.",
      force: "Delete even with uncommitted changes",
      forceRequired: "To delete it anyway, check the box first.",
      missingBody: (name) => `Remove the entry for "${name}"?`,
      missingNote:
        "Its folder is already gone from disk; only the git entry is removed.",
      submit: "Delete",
    },
    removeFailed: "Failed to delete the worktree.",
    cancel: "Cancel",
    nameErrors: {
      empty: "Enter a name.",
      control: "Control characters cannot be used.",
      separator: "Path separators cannot be used.",
      relative: "This name is not allowed.",
      "leading-dot": "The name cannot start with a dot.",
      "too-long": "The name is too long.",
    },
  },
  ja: {
    title: "作業ツリー",
    ariaLabel: "git の作業ツリー",
    loading: "作業ツリーを読み込んでいます…",
    loadFailed: "作業ツリーを読み込めませんでした。",
    empty: "作業ツリーがありません。",
    refresh: "再読み込み",
    refreshTitle: "一覧を読み直す",
    count: (n) => `${n} 本`,
    baseLabel: (branch) => `${branch} と比較`,
    baseUnknown: "比較の基準になるブランチが見つかりません",
    addParentHint: (path) => `追加した作業ツリーは ${path} に作られます`,
    gitignoreHint:
      "このディレクトリは git から未追跡に見えます。.worktrees/ を .gitignore に入れると git status に出なくなります。",
    badges: {
      current: "この画面",
      detached: "detached",
      bare: "bare",
      locked: "ロック中",
      prunable: "整理対象",
      missing: "ディレクトリなし",
      running: "起動中",
    },
    diverge: {
      ahead: (n) => `${n} 進んでいる`,
      behind: (n) => `${n} 遅れている`,
      even: "差はありません",
      aheadTitle: (n, base) => `${base} にまだ無いコミットが ${n} 件あります`,
      behindTitle: (n, base) =>
        `${base} にあってここに無いコミットが ${n} 件あります`,
      notComparable: "比較なし",
    },
    merge: {
      clean: (base) => `${base} にそのまま入ります`,
      conflict: (n, base) => `${base} と ${n} ファイルで衝突します`,
      unknown: "マージできるか確かめられませんでした",
      conflictListLabel: "衝突するファイル",
    },
    files: {
      heading: (n) => `変更 ${n} 件`,
      none: "変更はありません。",
      uncommitted: "未コミット",
      committed: "コミット済み・未マージ",
      truncated: (shown, total) => `${total} 件のうち ${shown} 件を表示`,
      // 行の中に置くので短くする。誰と重なっているかは title に入る。
      overlapMark: "重複",
      overlapTitle: (others) =>
        `同じファイルを触っている: ${others.join("、")}`,
      statusTitles: JA_STATUS_TITLES,
    },
    overlaps: {
      heading: (n) => `${n} 個のファイルを 2 本以上が触っています`,
      intro: "どれか 1 本をマージすると、残りはこのファイルで衝突します。",
      entry: (path, worktrees) => `${path} — ${worktrees.join("、")}`,
    },
    panes: {
      worktrees: "作業ツリー",
      files: "ファイル",
      diff: "差分",
      filterWorktrees: "作業ツリーを絞り込み…",
      filterFiles: "ファイルを絞り込み…",
      noWorktreeMatch: "該当する作業ツリーがありません。",
      noFileMatch: "該当するファイルがありません。",
      selectWorktree: "作業ツリーを選ぶと、何を触っているかが出ます。",
      selectFile: "ファイルを選ぶと差分が出ます。",
      diffLoading: "差分を読み込んでいます…",
      diffEmpty: "テキストの差分はありません（バイナリか、変更なし）。",
      diffFailed: "差分を読み込めませんでした。",
      diffTruncated: (shown, total) =>
        `${total} 個のうち ${shown} 個のかたまりを表示しています。全部見るにはその作業ツリーを開いてください`,
    },
    noCommit: "コミットなし",
    open: "開く",
    openTitle: "この作業ツリーの code-viewer を新しいタブで開く",
    opening: "起動中…",
    openFailed: "この作業ツリーを開けませんでした。",
    add: "追加",
    addTitle: "作業ツリーを新しく作る",
    addFailed: "作業ツリーを作れませんでした。",
    addDialog: {
      title: "作業ツリーの追加",
      nameLabel: "ディレクトリ名",
      namePlaceholder: "feature-x",
      branchLabel: "ブランチ",
      branchPlaceholder: "ディレクトリ名と同じ",
      branchHint:
        "既にあるブランチならそれをチェックアウトし、無ければ新しく作ります。",
      submit: "作成",
    },
    remove: "削除",
    removeTitle: "この作業ツリーを削除する",
    removeDialog: {
      title: "作業ツリーの削除",
      body: (name) => `作業ツリー「${name}」を削除しますか。`,
      diskNote: (path) =>
        `フォルダ ${path} とその中身はディスクから消えます。元に戻せません。`,
      branchNote: (branch) =>
        `ブランチ ${branch} と、コミット済みの内容は残ります。`,
      dirtyNote: (count) => `コミットしていない変更が ${count} 件あります。`,
      dirtyLose: "削除するとこれらの変更は失われます。",
      force: "変更が残っていても削除する",
      forceRequired: "変更を捨てて削除するには、チェックを入れてください。",
      missingBody: (name) => `作業ツリー「${name}」の登録を消しますか。`,
      missingNote:
        "フォルダは既にディスク上にありません。git の管理情報だけを消します。",
      submit: "削除する",
    },
    removeFailed: "作業ツリーを削除できませんでした。",
    cancel: "キャンセル",
    nameErrors: {
      empty: "名前を入力してください。",
      control: "制御文字は使えません。",
      separator: "パス区切りは使えません。",
      relative: "この名前は使えません。",
      "leading-dot": "ドットで始まる名前は使えません。",
      "too-long": "名前が長すぎます。",
    },
  },
};

export function worktreeText(lang: WorktreeLang): WorktreeText {
  return TEXT[lang];
}
