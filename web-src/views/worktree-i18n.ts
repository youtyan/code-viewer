// worktree 画面の文言。アプリ全体の言語設定 (app.ts の STATE.language) と
// 同じ値で切り替える。切替時のライブ反映は worktree-view の localize() が担当。

import type { WorktreeNameError, WorktreeStatusKind } from "../core/worktree";

export type WorktreeLang = "en" | "ja";

export type WorktreeText = {
  /** この表の言語。Intl (相対時刻) に渡すために表自身が持つ。 */
  lang: WorktreeLang;
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
  commits: {
    heading: (base: string) => string;
    loading: string;
    none: string;
    loadFailed: string;
    truncated: (shown: number, total: number) => string;
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
    mediaUnavailable: string;
    diffTruncated: (shown: number, total: number) => string;
  };
  noCommit: string;
  /** 3 段目の「最終更新 X」。mtime ベースなのでコミット無しでも動く。 */
  lastTouched: (when: string) => string;
  /**
   * 同じ段の「最終コミット X」。時刻だけが裸で並び、隣の「最終更新」と何が
   * 違うのか読めなかったので、こちらにも言葉を付ける。
   */
  lastCommitted: (when: string) => string;
  /**
   * 行の 3 段目・4 段目。**値には全部ラベルを付ける。** 裸の「main」「25 件」
   * では、ブランチ名なのかフォルダ名なのか、何が 25 なのか読めなかった。
   */
  row: {
    branchLabel: string;
    files: (n: number) => string;
    noFiles: string;
    /** 基準ブランチの行だけに添える 1 行。他の行はチップの文で足りる。 */
    baseNote: string;
  };
  /**
   * 行と要約カードに出す状態チップ。**1 文ではなく数語。** 狭い行では 1 文が
   * 途中で切れ、一番大事な「衝突するか」が読めなかった。フル文は title に回す
   * (even 以降は diverge / merge の文をそのまま使う)。
   */
  status: {
    label: Record<WorktreeStatusKind, (base: string) => string>;
    /** 位置関係の文が無い 3 種は、title もここで持つ。 */
    baseTitle: string;
    noBranchTitle: string;
    uncheckedTitle: (base: string) => string;
    /** チップの隣に添える「2 ahead」「1 behind」。0 のものは出さない。 */
    driftAhead: (n: number) => string;
    driftBehind: (n: number) => string;
  };
  /**
   * 選んだ作業ツリーの要約。本文の先頭に置き、「どこのフォルダで、どういう
   * 状態で、次に何をするか」を書く。差分カードだけでは状態が読めなかった。
   */
  summary: {
    folder: string;
    branch: string;
    comparedWith: string;
    changes: string;
    uncommitted: (n: number) => string;
    committed: (n: number, base: string) => string;
    noChanges: string;
    nextTitle: string;
    /** 状態ごとの次の一手。コマンドが続くものは末尾を「:」で止める。 */
    next: {
      base: (base: string) => string;
      noBranch: string;
      unchecked: (base: string) => string;
      even: (base: string) => string;
      evenUncommitted: (n: number) => string;
      behind: (n: number, base: string) => string;
      ready: (base: string) => string;
      readyUncommitted: (n: number) => string;
      conflict: (files: string[], base: string) => string;
    };
    copyCommand: string;
  };
  /**
   * 2 本以上あるのに何も選んでいないときの案内。intro は 1 本しか無いときの
   * もので、2 本目ができた瞬間に消える。その先で行の読み方を説明する場所が
   * 無かったので、ここに凡例を置く。
   */
  overview: {
    title: string;
    pick: string;
    legendTitle: string;
    /** 基準ブランチ名が取れないときに、凡例のチップに入れる語。 */
    baseWord: string;
    legend: {
      ready: string;
      conflict: string;
      quiet: string;
      unchecked: string;
      files: string;
      current: string;
    };
    createHint: string;
  };
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
     * 起動中のサーバの URL。開いたタブが拡張などに阻まれても、ここから
     * 拾って別の方法で開ける。
     */
    copyServerUrl: string;
    copyServerUrlTitle: (url: string) => string;
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
    lang: "en",
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
      current: "viewing now",
      currentTitle: "The folder this code-viewer is showing right now",
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
    commits: {
      heading: (base) => `Commits ahead of ${base}`,
      loading: "Loading commits…",
      none: "No commits found.",
      loadFailed: "Failed to load commits.",
      truncated: (shown, total) => `showing ${shown} of ${total}`,
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
      mediaUnavailable: "Media not available",
      diffTruncated: (shown, total) =>
        `showing ${shown} of ${total} hunks — open the worktree in a new tab for the whole file`,
    },
    noCommit: "no commit",
    lastTouched: (when) => `updated ${when}`,
    lastCommitted: (when) => `last commit ${when}`,
    row: {
      branchLabel: "branch",
      files: (n) => (n === 1 ? "1 changed file" : `${n} changed files`),
      noFiles: "no changes",
      baseNote: "The other worktrees branch off from here and merge back here.",
    },
    status: {
      label: {
        base: () => "base branch",
        "no-branch": () => "no branch",
        unchecked: () => "not checked",
        even: (base) => `up to date with ${base}`,
        behind: (base) => `behind ${base}`,
        ready: (base) => `can merge into ${base}`,
        conflict: (base) => `conflicts with ${base}`,
      },
      baseTitle:
        "The other worktrees are compared with this branch and merge into it.",
      noBranchTitle:
        "No branch is checked out here, so there is nothing to merge.",
      uncheckedTitle: (base) => `Could not compare with ${base}.`,
      driftAhead: (n) => `${n} ahead`,
      driftBehind: (n) => `${n} behind`,
    },
    summary: {
      folder: "Folder",
      branch: "Branch",
      comparedWith: "Compared with",
      changes: "Changes",
      uncommitted: (n) =>
        n === 1
          ? "1 file edited, not committed yet"
          : `${n} files edited, not committed yet`,
      committed: (n, base) =>
        n === 1
          ? `1 file in commits not yet in ${base}`
          : `${n} files in commits not yet in ${base}`,
      noChanges: "nothing changed yet",
      nextTitle: "What to do next",
      next: {
        base: (base) =>
          `This is ${base}, the branch the other worktrees are compared with. Merging a worktree brings its commits here.`,
        noBranch:
          "No branch is checked out here, so its commits have nowhere to go. Create a branch inside this folder first (git switch -c <name>).",
        unchecked: (base) =>
          `Could not compare this branch with ${base}, so whether it merges is unknown. The reason is on its row.`,
        even: (base) =>
          `Same commits as ${base}, so there is nothing to merge yet. Edit and commit inside this folder; the commits will show up here as ahead of ${base}.`,
        evenUncommitted: (n) =>
          n === 1
            ? "1 edited file is not committed yet. Commit it inside this folder to make it mergeable."
            : `${n} edited files are not committed yet. Commit them inside this folder to make them mergeable.`,
        behind: (n, base) =>
          `${base} has ${n === 1 ? "1 new commit" : `${n} new commits`} this branch does not have, and this branch has no commits of its own. Nothing to merge yet. To catch up, run inside this folder:`,
        ready: (base) =>
          `This branch can be merged into ${base} without conflicts. Run from the ${base} folder:`,
        readyUncommitted: (n) =>
          n === 1
            ? "1 edited file is not committed and will not be included."
            : `${n} edited files are not committed and will not be included.`,
        conflict: (files, base) =>
          `Merging into ${base} would conflict in ${files.length === 1 ? "1 file" : `${files.length} files`}: ${files.join(", ")}. Bring ${base} into this branch first and resolve the conflicts, then merge. Run inside this folder:`,
      },
      copyCommand: "Copy command",
    },
    overview: {
      title: "Pick a worktree on the left",
      pick: "Each row is one folder with its own branch checked out. Pick one to see which files it changes and whether it can be merged back.",
      legendTitle: "How to read a row",
      baseWord: "the base branch",
      legend: {
        ready:
          "Its commits go into the base branch without conflicts. The merge command is in the summary card.",
        conflict: "Merging would conflict. The row also gets a red edge.",
        quiet: "Nothing to merge yet: the branch has no commits of its own.",
        unchecked: "The comparison could not run. The row says why.",
        files:
          "The files it changes: edits not committed yet, plus commits not in the base branch.",
        current: "The folder this code-viewer is showing.",
      },
      createHint: "Create adds a new worktree under .worktrees/.",
    },
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
      copyServerUrl: "Copy its address",
      copyServerUrlTitle: (url) => `Copy ${url}`,
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
    lang: "ja",
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
      current: "いま見ているフォルダ",
      currentTitle: "この code-viewer がいま映しているフォルダです",
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
    commits: {
      heading: (base) => `${base} に未マージのコミット`,
      loading: "コミットを読み込んでいます…",
      none: "コミットがありません。",
      loadFailed: "コミットを読み込めませんでした。",
      truncated: (shown, total) => `${total} 件のうち ${shown} 件を表示`,
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
      mediaUnavailable: "メディアを読み込めませんでした。",
      diffTruncated: (shown, total) =>
        `${total} 個のうち ${shown} 個のかたまりを表示しています。全部見るには、その作業ツリーを別タブで見てください`,
    },
    noCommit: "コミットなし",
    lastTouched: (when) => `最終更新 ${when}`,
    lastCommitted: (when) => `最終コミット ${when}`,
    row: {
      branchLabel: "ブランチ",
      files: (n) => `変更したファイル ${n} 件`,
      noFiles: "変更なし",
      baseNote: "他の作業ツリーはここから分かれ、ここに戻ります。",
    },
    status: {
      label: {
        base: () => "基準ブランチ",
        "no-branch": () => "ブランチなし",
        unchecked: () => "未確認",
        even: (base) => `${base} と同じ`,
        behind: (base) => `${base} より遅れ`,
        ready: (base) => `${base} にマージできます`,
        conflict: (base) => `${base} と衝突`,
      },
      baseTitle:
        "他の作業ツリーはこのブランチと比べられ、ここにマージされます。",
      noBranchTitle: "ブランチが無いので、マージするものがありません。",
      uncheckedTitle: (base) => `${base} と比べられませんでした。`,
      driftAhead: (n) => `${n} 先行`,
      driftBehind: (n) => `${n} 遅れ`,
    },
    summary: {
      folder: "フォルダ",
      branch: "ブランチ",
      comparedWith: "比較先",
      changes: "変更",
      uncommitted: (n) => `編集中で未コミットが ${n} ファイル`,
      committed: (n, base) => `${base} にまだ無いコミットで ${n} ファイル`,
      noChanges: "まだ変更はありません",
      nextTitle: "次にやること",
      next: {
        base: (base) =>
          `これは ${base} です。他の作業ツリーはこのブランチと比べられ、マージするとここにコミットが入ります。`,
        noBranch:
          "ブランチが無いので、コミットの行き先がありません。先にこのフォルダの中でブランチを作ってください (git switch -c 名前)。",
        unchecked: (base) =>
          `${base} と比べられなかったので、マージできるかは分かりません。理由は左の行に出ています。`,
        even: (base) =>
          `${base} と同じコミットなので、マージするものはまだありません。このフォルダで編集してコミットすると、${base} より進んだコミットとしてここに出ます。`,
        evenUncommitted: (n) =>
          `編集した ${n} ファイルがまだコミットされていません。このフォルダの中でコミットすると、マージできるようになります。`,
        behind: (n, base) =>
          `${base} には、このブランチに無い新しいコミットが ${n} 件あります。このブランチ自身のコミットは無いので、マージするものはまだありません。追いつくには、このフォルダの中で次を実行します:`,
        ready: (base) =>
          `このブランチは衝突なく ${base} にマージできます。${base} のフォルダで次を実行します:`,
        readyUncommitted: (n) =>
          `編集した ${n} ファイルは未コミットなので、マージには含まれません。`,
        conflict: (files, base) =>
          `${base} にマージすると ${files.length} ファイルで衝突します: ${files.join("、")}。先に ${base} をこのブランチに取り込んで衝突を直し、そのあとマージします。このフォルダの中で次を実行します:`,
      },
      copyCommand: "コマンドをコピー",
    },
    overview: {
      title: "左の一覧から作業ツリーを選んでください",
      pick: "1 行が 1 つのフォルダで、それぞれ別のブランチが展開されています。選ぶと、どのファイルを変えているか、元のブランチにマージできるかが出ます。",
      legendTitle: "行の読み方",
      baseWord: "基準ブランチ",
      legend: {
        ready:
          "コミットが衝突なく基準ブランチに入ります。マージのコマンドは要約カードにあります。",
        conflict: "マージすると衝突します。行の左端も赤くなります。",
        quiet:
          "マージするものがまだありません。このブランチ自身のコミットが無い状態です。",
        unchecked: "比較できませんでした。理由は行に出ます。",
        files:
          "そのフォルダが変えているファイル。未コミットの編集と、基準ブランチに無いコミットの両方です。",
        current: "この code-viewer が映しているフォルダです。",
      },
      createHint:
        "「作る」を押すと .worktrees/ の下に新しい作業ツリーができます。",
    },
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
      copyServerUrl: "アドレスをコピー",
      copyServerUrlTitle: (url) => `${url} をコピーします`,
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
