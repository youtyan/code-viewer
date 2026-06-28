// Session-only ログ。SQL 実行 / mutate コミット の成否・経過時間・エラー全文を
// 時系列で記録する。サーバ側永続化は行わない (reload で消える)。フッターパネル
// の「ログ履歴」タブで表示するための store。
//
// `query-history-view` の永続履歴とは別物: あちらはサーバが保存した直近クエリを
// fetch してくる。こちらはブラウザ in-memory のみで、エラーと SQL 全体を捕える。

export type SessionLogKind = "query" | "mutate";
export type SessionLogStatus = "ok" | "error";

export type SessionLogEntry = {
  id: string;
  timestamp: number;
  kind: SessionLogKind;
  status: SessionLogStatus;
  /** 一覧の見出しに出す短いラベル (SQL 1 行目 / "コミット (3 件)" など)。 */
  label: string;
  /** 詳細パネルに出す原文 (SQL 全体 / mutation の op 内訳など)。 */
  detail?: string;
  /** エラー文や成功時のサマリ。エラーは複数行ありうる。 */
  message?: string;
  /** 経過時間 (ms)。計測できなかった場合は undefined。 */
  elapsedMs?: number;
  /** クエリ結果の行数 (取得・影響)。kind="query" のときに使う。 */
  rowCount?: number;
};

export type SessionLogStore = {
  add(entry: Omit<SessionLogEntry, "id" | "timestamp">): SessionLogEntry;
  list(): readonly SessionLogEntry[];
  clear(): void;
  subscribe(listener: () => void): () => void;
};

const DEFAULT_MAX_ENTRIES = 500;

export function createSessionLog(
  options: { maxEntries?: number } = {},
): SessionLogStore {
  const max = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const entries: SessionLogEntry[] = [];
  const listeners = new Set<() => void>();
  let seq = 0;

  function emit(): void {
    for (const fn of listeners) fn();
  }

  function add(
    entry: Omit<SessionLogEntry, "id" | "timestamp">,
  ): SessionLogEntry {
    seq += 1;
    const next: SessionLogEntry = {
      ...entry,
      id: `sl-${seq}`,
      timestamp: Date.now(),
    };
    entries.push(next);
    // FIFO で頭から落とす (新しいものを優先表示する)。
    while (entries.length > max) entries.shift();
    emit();
    return next;
  }

  return {
    add,
    list: () => entries,
    clear() {
      if (entries.length === 0) return;
      entries.length = 0;
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
