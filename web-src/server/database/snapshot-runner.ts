// snapshot-runner.ts は capability mixin (SnapshotIterable) 経由で
// generic に snapshot を取る薄いエンジン。
// 個々の data source (SQL / Redis / 将来の S3 / ES) は iterateForSnapshot
// と listSnapshotContainers を実装するだけで snapshot 機能を得られる。
//
// row 作成ロジックは各 adapter が持つ (sources/sql-snapshot.ts や Redis adapter の
// inline 実装)。runner 側はそれを呼び出して snapshot-store に流すだけ。
//
// 後方互換: 旧 signature `runSnapshot(cwd, adapter, dbId, tables, note, onProgress)`
// は維持する。`adapter` は SnapshotIterable を満たす必要があり、
// 持たない場合は明示的にエラーを返す。

import type { DbKind } from "../../core/database/types";
import {
  addSnapshotTableData,
  createSnapshot,
  finalizeSnapshot,
} from "./snapshot-store";
import type { SnapshotIterable } from "./sources/types";
import { hasSnapshotCapability } from "./sources/types";

const SNAPSHOT_FLUSH_THRESHOLD = 500;

// runSnapshot に渡せる最小限の source shape。
// SnapshotIterable に加えて、snapshot メタに kind を載せるため kind を持つ。
type SnapshotSource = SnapshotIterable & { readonly kind: DbKind };

// 既存呼び出し元 (handle.ts 等) は `DatabaseAdapter` 型で adapter を持っているので、
// runtime で capability check して narrow する設計にする。caller は cast 不要。
type MaybeSnapshotSource = { readonly kind: DbKind } & {
  capabilities?: unknown;
};

export async function runSnapshot(
  cwd: string,
  source: MaybeSnapshotSource,
  dbId: string,
  containers: string[],
  note: string,
  onProgress?: (container: string, done: boolean) => void,
): Promise<string> {
  if (!hasSnapshotCapability(source)) {
    throw new Error(
      "data source does not support snapshot (missing SnapshotIterable capability)",
    );
  }
  // この時点で source は SnapshotIterable を持つことが保証されている。
  const snapshotSource = source as SnapshotSource;

  const snapshotId = await createSnapshot(
    cwd,
    dbId,
    snapshotSource.kind,
    containers,
    note,
  );

  try {
    for (const container of containers) {
      onProgress?.(container, false);

      // snapshot-store の addSnapshotTableData は historically `rowKeyJson`
      // フィールド名を使うので、SnapshotItem.keyJson から rename して詰める。
      const collected: Array<{
        rowKeyJson: string;
        rowHash: string;
        payloadJson: string;
      }> = [];
      // Redis の iterateForSnapshot 等は async / await が混じるので、
      // 順次 yield を消費する形にする。
      // pk 列情報は SQL 系のみ意味を持つので、ここでは空配列を渡す。
      // snapshot-store のスキーマは pk_columns_json を表示用のヒントとして
      // 持つだけで、diff 計算は row_key_hash + row_hash に依存しているので、
      // 空配列でも diff は正しく動く。
      let pkColumns: string[] = [];
      try {
        const adapterAny = snapshotSource as {
          getColumns?: (t: string) => unknown;
        };
        if (typeof adapterAny.getColumns === "function") {
          const cols = adapterAny.getColumns(container) as Array<{
            name: string;
            primaryKey: boolean;
          }>;
          pkColumns = cols.filter((c) => c.primaryKey).map((c) => c.name);
        }
      } catch {
        // 非 SQL source や container が table ではない場合は無視。
      }

      for await (const item of snapshotSource.iterateForSnapshot(container)) {
        collected.push({
          rowKeyJson: item.keyJson,
          rowHash: item.rowHash,
          payloadJson: item.payloadJson,
        });
        // 大量データに備えて threshold ごとに flush しても良いが、
        // 既存 snapshot-store は table 単位で 1 回 commit する仕様なので
        // ここではメモリに溜めてから一括書き込みする (旧実装と同じ挙動)。
      }

      // SNAPSHOT_FLUSH_THRESHOLD は将来 streaming 化する際の hook。
      // 現状は単純に全件まとめて書く。
      void SNAPSHOT_FLUSH_THRESHOLD;

      await addSnapshotTableData(
        cwd,
        snapshotId,
        container,
        pkColumns,
        collected,
      );
    }

    await finalizeSnapshot(cwd, snapshotId);
    onProgress?.("", true);
    return snapshotId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finalizeSnapshot(cwd, snapshotId, msg);
    throw err;
  }
}
