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
  /**
   * 追加先はリポジトリの中なので、git からは未追跡ディレクトリに見える。
   * .gitignore を書き換えるかどうかはリポジトリ側の判断なので、こちらでは
   * 触らずに伝えるだけにする。作るかどうかの判断には要らないので、ダイアログ
   * では本文に並べず「?」の title に逃がす。
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
  /** 3 段目の「最終更新 X」。mtime ベースなのでコミット無しでも動く。 */
  lastTouched: (when: string) => string;
  /**
   * 選んでいる作業ツリーへの操作。一覧の上に固定して出す。
   *
   * 行の中に置くと、選んだ瞬間にその場へボタンが現れて誤爆が怖い、という
   * 実際の声があった。位置を固定し、対象は名前で示す。
   */
  actions: {
    /** 行の右端の「…」。押すまで操作は 1 つも出さない。 */
    menuTitle: string;
    menuFor: (name: string) => string;
    openFolder: string;
    openFolderTitle: string;
    /** メニューには色を変える先が無いので、失敗はメッセージ欄に出す。 */
    openFolderFailed: string;
    copyPath: string;
    copyPathTitle: string;
    copyFailed: string;
    /** 「開く」で起こしたサーバを止める。起動中の行にだけ出す。 */
    stopServer: string;
    stopServerTitle: string;
    stopFailed: string;
    /**
     * そのまま入る作業ツリーだけに出す、取り込むコマンドのコピー。
     * 実行はしない (このアプリはリポジトリを書き換えない)。
     */
    copyMerge: string;
    copyMergeTitle: (base: string, branch: string) => string;
  };
  /** 変更がまだ無い作業ツリーの右ペイン。次にやることを書く。 */
  emptyDiff: {
    title: string;
    body: (path: string) => string;
  };
  /** まだ 1 本も作っていないときの説明。永続化はしない。 */
  intro: {
    /** 右ペインのカード。 */
    cardTitle: string;
    cardWhat: string;
    cardWhy: string;
    cardHow: string;
    cardButton: string;
    /** 左パネルのメイン行の下に出す 1 行。 */
    listNote: string;
    /** ⇄ の意味。重なりが 1 件も無いときは出さない。 */
    overlapLegend: string;
  };
  open: string;
  openTitle: string;
  opening: string;
  openFailed: string;
  add: string;
  addTitle: string;
  addFailed: string;
  addDialog: {
    title: string;
    /** 何のための操作かを 1 行で。未経験者はここで初めて意味を知る。 */
    intro: string;
    nameLabel: string;
    namePlaceholder: string;
    branchLabel: string;
    branchPlaceholder: string;
    branchHint: string;
    /** 入力に連動して「どこに何ができるか」を実パスで見せる行の見出し。 */
    targetLabel: string;
    /** 名前を入れる前の作成先。末尾がまだ決まっていないことを示す。 */
    targetPending: (parent: string) => string;
    /** gitignore の注記を出す「?」の aria-label。中身は gitignoreHint。 */
    gitignoreLabel: string;
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
     * ロックされた登録は git worktree prune が黙って飛ばす (終了コードは 0)。
     * 押しても消えないことを先に言う。
     */
    lockedNote: string;
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
        `showing ${shown} of ${total} hunks — open the worktree in a new tab for the whole file`,
    },
    noCommit: "no commit",
    lastTouched: (when) => `updated ${when}`,
    actions: {
      menuTitle: "Actions for this worktree",
      menuFor: (name) => `Actions for ${name}`,
      openFolder: "Open folder",
      openFolderTitle: "Open this folder in the OS file manager",
      openFolderFailed: "Could not open that folder.",
      copyPath: "Copy path",
      copyPathTitle: "Copy the path to this folder",
      copyFailed: "Could not copy to the clipboard.",
      stopServer: "Stop its server",
      stopServerTitle: "Stop the code-viewer running for this folder",
      stopFailed: "Failed to stop the server.",
      copyMerge: "Copy merge command",
      copyMergeTitle: (base, branch) =>
        `Copy the command that merges ${branch} into ${base}`,
    },
    emptyDiff: {
      title: "No changes yet.",
      body: (path) => `Edit files in ${path} and the diffs will show up here.`,
    },
    intro: {
      cardTitle: "What is a worktree?",
      cardWhat:
        "A worktree (git worktree) is a second checkout of this repository, in a separate folder on a separate branch.",
      cardWhy:
        "Keep main open here while a bugfix branch stays open over there — no branch switching, no stashing.",
      cardHow:
        'When you click "Create": a new folder appears at .worktrees/<name>, with the branch checked out in it. Edit files there as usual. The changes show up on this screen as diffs.',
      cardButton: "Create a worktree",
      listNote:
        "This is the only folder right now. New worktrees will appear here.",
      overlapLegend: "⇄ = another worktree is changing this file too",
    },
    open: "Open in a new tab",
    openTitle: "Start a code-viewer for this folder and open it in a new tab",
    opening: "Starting…",
    openFailed: "Failed to open this worktree.",
    add: "Create",
    addTitle: "Create a new worktree",
    addFailed: "Failed to create the worktree.",
    addDialog: {
      title: "Create a worktree",
      intro:
        "Work on two things side by side, in separate folders, without switching branches.",
      nameLabel: "Folder name",
      namePlaceholder: "feature-x",
      branchLabel: "Branch",
      branchPlaceholder: "same as the folder name",
      branchHint:
        "An existing branch name opens that branch. Otherwise a new one starts from where you are now.",
      targetLabel: "Creates",
      targetPending: (parent) => `${parent}/…`,
      gitignoreLabel: "About this folder and git status",
      submit: "Create",
    },
    remove: "Delete this worktree",
    removeTitle: "Delete this worktree and its folder",
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
      lockedNote:
        "This entry is locked, so git will leave it in place. Unlock it first.",
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
        `${total} 個のうち ${shown} 個のかたまりを表示しています。全部見るには、その作業ツリーを別タブで見てください`,
    },
    noCommit: "コミットなし",
    lastTouched: (when) => `最終更新 ${when}`,
    actions: {
      menuTitle: "この作業ツリーへの操作",
      menuFor: (name) => `${name} への操作`,
      openFolder: "フォルダを開く",
      openFolderTitle: "このフォルダをファイルマネージャで開きます",
      openFolderFailed: "そのフォルダを開けませんでした。",
      copyPath: "パスをコピー",
      copyPathTitle: "このフォルダの場所をコピーします",
      copyFailed: "クリップボードにコピーできませんでした。",
      stopServer: "サーバを止める",
      stopServerTitle: "このフォルダで動いている code-viewer を止めます",
      stopFailed: "サーバを止められませんでした。",
      copyMerge: "マージのコマンドをコピー",
      copyMergeTitle: (base, branch) =>
        `${branch} を ${base} に取り込むコマンドをコピーします`,
    },
    emptyDiff: {
      title: "まだ変更はありません。",
      body: (path) => `${path} でファイルを編集すると、ここに差分が出ます。`,
    },
    intro: {
      cardTitle: "作業ツリー（git worktree）とは",
      cardWhat:
        "同じリポジトリを、ブランチを切り替えずに別フォルダでもう 1 つ開く仕組みです。",
      cardWhy:
        "main で作業しながら、別フォルダで修正用のブランチを開いておけます。2 つの作業を並べて進められます。",
      cardHow:
        "「作る」を押すと .worktrees/〈名前〉 にフォルダができ、指定したブランチがそこに展開されます。あとはそのフォルダで普通に編集してください。変更はこの画面に差分として出ます。",
      cardButton: "作業ツリーを作る",
      listNote:
        "いまはこのフォルダだけです。作業ツリーを作ると、ここに並びます。",
      overlapLegend: "⇄ = 他の作業ツリーも同じファイルを触っている",
    },
    open: "別タブで見る",
    openTitle: "このフォルダ専用の code-viewer を起動して新しいタブで開きます",
    opening: "起動中…",
    openFailed: "この作業ツリーを開けませんでした。",
    add: "作る",
    addTitle: "作業ツリーを新しく作る",
    addFailed: "作業ツリーを作れませんでした。",
    addDialog: {
      title: "作業ツリーを作る",
      intro:
        "ブランチを切り替えずに、別フォルダで 2 つの作業を並べて進められます。",
      nameLabel: "フォルダ名",
      namePlaceholder: "feature-x",
      branchLabel: "ブランチ",
      branchPlaceholder: "フォルダ名と同じ",
      branchHint:
        "既にあるブランチ名ならそれを開きます。無ければ、いまの地点から新しく作ります。",
      targetLabel: "作成先",
      targetPending: (parent) => `${parent}/…`,
      gitignoreLabel: "このフォルダと git status について",
      submit: "作る",
    },
    remove: "この作業ツリーを削除",
    removeTitle: "この作業ツリーをフォルダごと削除します",
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
      lockedNote:
        "この登録はロックされているので、git はそのまま残します。先にロックを外してください。",
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
