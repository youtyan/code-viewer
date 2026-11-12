// 左のサイドバーのプロジェクトの行に出す、主でないブランチと上流との差 (↑2 ↓1)。
//
// 入口のサーバが登録したプロジェクトの git を直接読む (寝ているプロジェクトのために
// 裏のプロセスを起こさない)。読むのは一覧 (/_agent/overview) を作るときに、次の
// どれかに当たるものだけ:
//
// - まだ読んでいない
// - そのプロジェクトのエージェントのターンが終わった (作業中のペインが居なくなった。
//   commit・checkout はたいていエージェントのターンの中で起きる)
// - そのプロジェクトへ移った (いま選ばれているプロジェクトが変わった)
// - 前に読んでから BRANCH_STATUS_FALLBACK_MS 経った (外のエディタ・端末での変更の予備)
//
// 読むのは裏で、一覧の応答は待たない (次の一覧に載る)。git は読むだけの指定で走る
// (server.md・git.ts の gitInvocation)。読めなかった理由は一覧の errors に出す。

import { formatErrorDetail } from "../../core/error-detail";
import type { BranchStatus } from "../git";
import { branchStatusResultAsync } from "../git";

/** 予備の読み直しの間隔。 */
export const BRANCH_STATUS_FALLBACK_MS = 5 * 60_000;

export type BranchStatusEntry =
  | { status: "ok"; value: BranchStatus }
  | { status: "error"; error: string };

export type BranchStatusTracker = {
  /**
   * 一覧を作るたびに呼ぶ。roots は git のプロジェクト、working は作業中の
   * ペインが居るプロジェクト、selected はいま選ばれているプロジェクト。
   * 読み直しが要るものを裏で読み始める (待たない)。
   */
  note(input: {
    roots: readonly string[];
    working: ReadonlySet<string>;
    selected: string | null;
  }): void;
  get(root: string): BranchStatusEntry | undefined;
};

export function createBranchStatusTracker(
  read: (
    root: string,
  ) => Promise<BranchStatus & { error?: string }> = branchStatusResultAsync,
  now: () => number = Date.now,
): BranchStatusTracker {
  const cache = new Map<string, { entry: BranchStatusEntry; at: number }>();
  const reading = new Set<string>();
  let wasWorking = new Set<string>();
  let lastSelected: string | null = null;

  function start(root: string): void {
    if (reading.has(root)) return;
    reading.add(root);
    const at = now();
    read(root)
      .then(
        (result) => {
          const { error, ...value } = result;
          cache.set(root, {
            entry: error ? { status: "error", error } : { status: "ok", value },
            at,
          });
        },
        (cause: unknown) => {
          // 読み方そのものが投げた (git を起こせない など)。理由は一覧の errors に出す。
          console.error(`[code-viewer] branch status of ${root} failed`, cause);
          cache.set(root, {
            entry: {
              status: "error",
              error: formatErrorDetail(cause),
            },
            at,
          });
        },
      )
      .finally(() => reading.delete(root));
  }

  return {
    note({ roots, working, selected }) {
      const due = new Set<string>();
      for (const root of roots) {
        const known = cache.get(root);
        if (!known) due.add(root);
        else if (now() - known.at >= BRANCH_STATUS_FALLBACK_MS) due.add(root);
        if (wasWorking.has(root) && !working.has(root)) due.add(root);
      }
      if (selected && selected !== lastSelected && roots.includes(selected))
        due.add(selected);
      lastSelected = selected;
      wasWorking = new Set(working);
      for (const root of cache.keys())
        if (!roots.includes(root)) cache.delete(root);
      for (const root of due) start(root);
    },
    get(root) {
      return cache.get(root)?.entry;
    },
  };
}
