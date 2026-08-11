// worktree 一覧画面が扱う「作業ツリー 1 本」の形と、`git worktree list
// --porcelain -z` の読み取り。URL (/worktree)、サーバの一覧レスポンス、クライアント
// の表描画が同じ 1 つの型を参照するように、client / server 双方から import
// できる core に置く (core/tmux.ts と同じ役割)。

/**
 * `git worktree list --porcelain -z` の 1 ブロックをそのまま写したもの。
 * git が出す事実だけで、変更数やサーバ URL のような後付けの情報は持たない。
 */
export type WorktreeRef = {
  path: string;
  /** コミット SHA。bare にはコミットが無いので空。 */
  head: string;
  /** `refs/heads/` を剥がしたブランチ名。detached と bare では空。 */
  branch: string;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  /** `locked` に理由が添えられていればその文字列。無ければ空。 */
  lockedReason: string;
  prunable: boolean;
  prunableReason: string;
};

import type { CommitMeta } from "./types";

/**
 * 基準ブランチとの位置関係。「今どれだけ離れていて、戻せるのか」を 1 つに
 * まとめたもの。
 */
export type WorktreeDivergence = {
  /** 比べた相手のブランチ名。 */
  base: string;
  /** base に無く、こちらにあるコミット数。 */
  ahead: number;
  /** こちらに無く、base にあるコミット数。 */
  behind: number;
  /**
   * base に取り込んだらどうなるか。
   *
   * - clean: そのまま入る
   * - conflict: 衝突する (conflicts にファイル)
   * - unknown: 判定できなかった (git が古い / 実行に失敗した)
   *
   * **unknown を clean と混ぜない。**「衝突しない」と「調べられなかった」は
   * 別のことで、混ぜると安全側に倒れない。
   */
  mergeState: "clean" | "conflict" | "unknown";
  conflicts: string[];
};

/** その変更が、まだコミットされていないのか、分岐後のコミットに入っているか。 */
export type WorktreeFileOrigin = "uncommitted" | "committed";

/** その worktree が触っているファイル 1 件。 */
export type WorktreeFileChange = {
  path: string;
  /** rename/copy 前のパス。重なり検出では path と同じく数える。 */
  oldPath?: string;
  /** git の status 文字 (M / A / D / R / C)。未追跡は "U"。 */
  status: string;
  additions: number;
  deletions: number;
  origin: WorktreeFileOrigin;
};

/**
 * 2 本以上の worktree が同じファイルを触っている状態。
 *
 * 別々のエージェントを並行で走らせるとここが事故になる。どちらかをマージした
 * 瞬間にもう片方が衝突するので、始まる前に見えている必要がある。
 */
export type WorktreeOverlap = {
  path: string;
  /** そのファイルを触っている worktree の id。必ず 2 件以上。 */
  worktreeIds: string[];
};

/**
 * 画面に出す 1 行。`WorktreeRef` に、そのパスを cwd にして初めて分かること
 * (未コミット変更の数・最終コミット・そこで動いている code-viewer) を足す。
 */
export type WorktreeItem = WorktreeRef & {
  /** URL と重なり検出で使う一意な識別子。実パスと同じ値。 */
  id: string;
  /** 表示用の短い名前。パスの末尾。 */
  name: string;
  /** リポジトリルートからの相対パス。外に在るなら絶対パスのまま。 */
  displayPath: string;
  /** このサーバが見ている作業ツリーか。 */
  current: boolean;
  /** ディレクトリが消えている (prunable の主な原因)。 */
  missing: boolean;
  /**
   * 未コミット変更のエントリ数。数えられなかったときは 0 で、そのことは
   * error に出る。画面は「変更なし」と「数えられなかった」を別に描く。
   */
  changedCount: number;
  /**
   * この行の情報が欠けている理由。git status と git log のどちらが失敗しても
   * ここに入る (両方なら改行で連結)。取れているなら空。
   */
  error: string;
  lastCommit: CommitMeta | null;
  /**
   * その作業ツリーで最後にファイルが書き変わった時刻 (ISO 8601)。
   * 変更ファイルの mtime の最新で、コミットせずに置かれた作業ツリーでも
   * 動く。取れなければ最終コミットの時刻に落ち、それも無ければ null
   * (読み取りに失敗したなら、その理由は error に入る)。
   */
  lastTouched: string | null;
  /** そのパスで動いている code-viewer の URL。無ければ空。 */
  serverUrl: string;
  /** 基準ブランチとの位置関係。基準そのものの行と、調べられなかった行は null。 */
  divergence: WorktreeDivergence | null;
  /**
   * 触っているファイル。未コミットと分岐後のコミットの両方が入る。
   * 件数を切ると重なりと差分一覧が欠けるため、全件を返す。
   */
  files: WorktreeFileChange[];
  /** files の総数。一覧の見出し用。 */
  fileCount: number;
};

/** 名前が使えない理由。文言は表示側の i18n で解決する。 */
export type WorktreeNameError =
  | "empty"
  | "control"
  | "separator"
  | "relative"
  | "leading-dot"
  | "too-long";

/** ディレクトリ名 1 つぶんなので、区切りも `..` も入らない。 */
export const WORKTREE_NAME_MAX_LENGTH = 100;

export function worktreeNameError(name: string): WorktreeNameError | null {
  if (!name) return "empty";
  if (name.length > WORKTREE_NAME_MAX_LENGTH) return "too-long";
  for (const ch of name) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127) return "control";
  }
  if (name.includes("/") || name.includes("\\")) return "separator";
  if (name === "." || name === "..") return "relative";
  if (name.startsWith(".")) return "leading-dot";
  return null;
}

/** ブランチ名は git の refname 規則に任せきれないぶんだけ先に弾く。 */
export function worktreeBranchError(branch: string): WorktreeNameError | null {
  if (!branch) return "empty";
  if (branch.length > WORKTREE_NAME_MAX_LENGTH) return "too-long";
  for (const ch of branch) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127) return "control";
  }
  // ブランチ名は `feature/foo` のように `/` を含んでよいので separator は見ない。
  if (branch.startsWith("-") || branch.includes("..")) return "relative";
  return null;
}

function emptyRef(path: string): WorktreeRef {
  return {
    path,
    head: "",
    branch: "",
    detached: false,
    bare: false,
    locked: false,
    lockedReason: "",
    prunable: false,
    prunableReason: "",
  };
}

/**
 * `git worktree list --porcelain -z` を読む。出力は
 *
 *   worktree <path>
 *   HEAD <sha>
 *   branch refs/heads/<name>     (detached なら `detached`、bare なら両方無し)
 *   locked [<reason>]
 *   prunable <reason>
 *
 * の属性が NUL で区切られて並ぶ。`worktree` 属性が現れた時点で新しいブロック
 * として扱うので、区切り用の空属性や末尾の NUL が無くても同じ結果になる。
 *
 * git を呼ばない純粋な変換なので、ここだけをテストすれば書式の取り違えを
 * 検出できる (server/tmux/panes.ts の parseTmuxPanes と同じ方針)。
 */
export function parseWorktreeList(stdout: string): WorktreeRef[] {
  const refs: WorktreeRef[] = [];
  let current: WorktreeRef | null = null;
  const nulDelimited = stdout.includes("\0");
  const records = nulDelimited ? stdout.split("\0") : stdout.split("\n");
  for (const rawRecord of records) {
    // 改行区切りは旧形式を読む呼び出し側との互換用。-z 形式ではパス末尾の
    // CR も有効な文字なので削らない。
    const line = nulDelimited ? rawRecord : rawRecord.replace(/\r$/, "");
    if (!line) continue;
    if (line.startsWith("worktree ")) {
      current = emptyRef(line.slice("worktree ".length));
      refs.push(current);
      continue;
    }
    // `worktree` 行より前に属性行が来ることは無いが、来ても落ちない。
    if (!current) continue;
    if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length);
      current.branch = ref.startsWith("refs/heads/")
        ? ref.slice("refs/heads/".length)
        : ref;
    } else if (line === "detached") {
      current.detached = true;
    } else if (line === "bare") {
      current.bare = true;
    } else if (line === "locked" || line.startsWith("locked ")) {
      current.locked = true;
      current.lockedReason = line.slice("locked".length).trim();
    } else if (line === "prunable" || line.startsWith("prunable ")) {
      current.prunable = true;
      current.prunableReason = line.slice("prunable".length).trim();
    }
  }
  return refs;
}

/** 一覧のうち、そのパスが指す作業ツリー。無ければ null。 */
export function findWorktree<T extends { path: string }>(
  worktrees: T[],
  path: string,
): T | null {
  return worktrees.find((entry) => entry.path === path) || null;
}

/**
 * `git rev-list --left-right --count <base>...<branch>` を読む。
 *
 * 出力は `<base にしか無い数>\t<branch にしか無い数>` の 1 行。左が behind、
 * 右が ahead になる (base 側に積まれたぶんだけ、この作業ツリーは遅れている)。
 */
export function parseAheadBehind(
  stdout: string,
): { behind: number; ahead: number } | null {
  const parts = stdout.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const behind = Number(parts[0]);
  const ahead = Number(parts[1]);
  if (!Number.isInteger(behind) || !Number.isInteger(ahead)) return null;
  if (behind < 0 || ahead < 0) return null;
  return { behind, ahead };
}

/**
 * `git merge-tree --write-tree --name-only <base> <branch>` を読む。
 *
 * 1 行目は書き出された tree の OID。衝突があるとその次から空行までに衝突した
 * パスが並び、空行の後は人向けのメッセージになる。衝突の有無は終了コードで
 * 判断するので、ここは「どのファイルか」だけを取り出す。
 */
export function parseMergeTreeConflicts(stdout: string): string[] {
  const lines = stdout.split("\n");
  const conflicts: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    if (!line) break;
    conflicts.push(line);
  }
  return conflicts;
}

/**
 * 2 本以上の作業ツリーが同じファイルを触っている箇所を挙げる。
 *
 * 並行して走らせたエージェントが同じ場所を書いていることは、片方をマージする
 * まで表に出ない。触っている本数が多い順に返すので、画面はそのまま上から出す。
 */
export function findWorktreeOverlaps(
  items: Array<{ id: string; files: WorktreeFileChange[] }>,
): WorktreeOverlap[] {
  const byPath = new Map<string, string[]>();
  for (const item of items) {
    // 同じ作業ツリーが未コミットと分岐後の両方で同じファイルを持つので、
    // 1 本につき 1 回だけ数える。
    const counted = new Set<string>();
    for (const file of item.files) {
      for (const path of [file.path, file.oldPath]) {
        if (!path || counted.has(path)) continue;
        counted.add(path);
        const owners = byPath.get(path);
        if (owners) owners.push(item.id);
        else byPath.set(path, [item.id]);
      }
    }
  }
  const overlaps: WorktreeOverlap[] = [];
  for (const [path, worktreeIds] of byPath) {
    if (worktreeIds.length >= 2) overlaps.push({ path, worktreeIds });
  }
  overlaps.sort(
    (a, b) =>
      b.worktreeIds.length - a.worktreeIds.length || (a.path < b.path ? -1 : 1),
  );
  return overlaps;
}
