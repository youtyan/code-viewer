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
  /** 比較の基準にしているブランチが取れなかったときの注意。 */
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
    currentTitle: string;
    detached: string;
    detachedTitle: string;
    bare: string;
    bareTitle: string;
    /** title は git が返すロック理由 (lockedReason) をそのまま出す。 */
    locked: string;
    prunable: string;
    prunableTitle: string;
    missing: string;
    running: string;
    runningTitle: string;
  };
  /** 基準ブランチとの位置関係。基準名はこちらが持つ。 */
  diverge: {
    ahead: (n: number, base: string) => string;
    behind: (n: number, base: string) => string;
    even: (base: string) => string;
    /** 基準そのもの、または比べられない行。 */
    notComparable: string;
  };
  merge: {
    /** 基準名は diverge 側が言うので、こちらは可否だけを言う。 */
    clean: string;
    conflict: (n: number) => string;
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
    /**
     * prune は対象を 1 本に絞れないので、同じ状態の登録が他にあるなら
     * まとめて消えることを件数つきで伝える。
     */
    missingOthers: (n: number) => string;
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
    baseUnknown: "no base branch found",
    addParentHint: (path) => `New worktrees are created under ${path}`,
    gitignoreHint:
      "Git sees that directory as untracked. Add .worktrees/ to .gitignore to keep it out of git status.",
    badges: {
      current: "this folder",
      currentTitle: "This code-viewer is serving this folder",
      detached: "no branch",
      detachedTitle: "Not attached to any branch (detached HEAD)",
      bare: "bare",
      bareTitle: "A storage-only repository with no working files",
      locked: "locked",
      prunable: "stale entry",
      prunableTitle: "Only the git entry remains (e.g. the folder is gone)",
      missing: "folder is gone",
      running: "running",
      runningTitle: "A code-viewer for this folder is running on another port",
    },
    diverge: {
      ahead: (n, base) =>
        n === 1 ? `1 commit ahead of ${base}` : `${n} commits ahead of ${base}`,
      behind: (n, base) =>
        n === 1 ? `1 commit behind ${base}` : `${n} commits behind ${base}`,
      even: (base) => `same point as ${base}`,
      notComparable: "not compared",
    },
    merge: {
      clean: "merges cleanly",
      conflict: (n) =>
        n === 1
          ? "1 file would conflict on merge"
          : `${n} files would conflict on merge`,
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
      missingOthers: (n) =>
        n === 1
          ? "1 other entry whose folder is gone will be cleaned up at the same time."
          : `${n} other entries whose folders are gone will be cleaned up at the same time.`,
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
    baseUnknown: "比較の基準になるブランチが見つかりません",
    addParentHint: (path) => `追加した作業ツリーは ${path} に作られます`,
    gitignoreHint:
      "このディレクトリは git から未追跡に見えます。.worktrees/ を .gitignore に入れると git status に出なくなります。",
    badges: {
      current: "このフォルダ",
      currentTitle: "この code-viewer が開いているフォルダです",
      detached: "ブランチなし",
      detachedTitle: "どのブランチにも紐づいていません（detached HEAD）",
      bare: "bare",
      bareTitle: "作業ファイルを持たない保管用のリポジトリです",
      locked: "ロック中",
      prunable: "掃除できます",
      prunableTitle: "フォルダが無い等で管理情報だけ残っています",
      missing: "フォルダがありません",
      running: "起動中",
      runningTitle: "このフォルダ専用の code-viewer が別ポートで動いています",
    },
    diverge: {
      ahead: (n, base) => `${base} より ${n} コミット進んでいます`,
      behind: (n, base) => `${base} より ${n} コミット遅れています`,
      even: (base) => `${base} と同じ地点です`,
      notComparable: "比較なし",
    },
    merge: {
      clean: "そのままマージできます",
      conflict: (n) => `マージすると ${n} ファイルで衝突します`,
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
      missingOthers: (n) =>
        `フォルダが無くなっている他の登録 ${n} 件も、同時に整理されます。`,
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
