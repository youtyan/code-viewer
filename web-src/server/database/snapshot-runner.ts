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
//
// onProgress の意味:
//   - container !== "" && done === false: そのテーブルの処理開始 (index/total 付き)
//   - container === "" && done === true: 全体完了 (最後に 1 度だけ)

import type { DbKind } from "../../core/database/types";
import { isAbortLikeError, throwIfAborted } from "./adapters/abort";
import { asAsync } from "./adapters/async-facade";
import type { DatabaseAdapter } from "./adapters/types";
import {
  addSnapshotTableRows,
  beginSnapshotTableRevision,
  createSnapshot,
  finalizeSnapshot,
  finalizeSnapshotTableRevision,
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

type RunSnapshotOptions = {
  signal?: AbortSignal;
  schema?: string;
  onSnapshotId?: (snapshotId: string) => void;
};

export type SnapshotProgress = {
  container: string;
  done: boolean;
  index: number;
  total: number;
};

export async function runSnapshot(
  cwd: string,
  source: MaybeSnapshotSource,
  dbId: string,
  containers: string[],
  note: string,
  onProgress?: (progress: SnapshotProgress) => void,
  options: RunSnapshotOptions = {},
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
    options.schema,
  );

  try {
    options.onSnapshotId?.(snapshotId);

    const total = containers.length;
    for (let i = 0; i < containers.length; i++) {
      const container = containers[i];
      throwIfAborted(options.signal, "snapshot cancelled");
      onProgress?.({ container, done: false, index: i, total });

      // Redis の iterateForSnapshot 等は async / await が混じるので、
      // 順次 yield を消費する形にする。
      // pk 列情報は SQL 系のみ意味を持つので、ここでは空配列を渡す。
      // snapshot-store のスキーマは pk_columns_json を表示用のヒントとして
      // 持つだけで、diff 計算は row_key_hash + row_hash に依存しているので、
      // 空配列でも diff は正しく動く。
      let pkColumns: string[] = [];
      if ((snapshotSource as { model?: string }).model === "sql") {
        try {
          const cols = await asAsync(
            snapshotSource as SnapshotSource & DatabaseAdapter,
          ).columns(container, options.signal);
          pkColumns = cols.filter((c) => c.primaryKey).map((c) => c.name);
        } catch (err) {
          if (isAbortLikeError(err, options.signal)) throw err;
          // 非 SQL source や container が table ではない場合は無視。
        }
      }
      throwIfAborted(options.signal, "snapshot cancelled");

      const revisionId = await beginSnapshotTableRevision(
        cwd,
        snapshotId,
        container,
        pkColumns,
      );
      // snapshot-store は historically `rowKeyJson` フィールド名を使うので、
      // SnapshotItem.keyJson から rename して threshold ごとに流し込む。
      const pendingRows: Array<{
        rowKeyJson: string;
        rowHash: string;
        payloadJson: string;
      }> = [];
      const flushRows = async () => {
        if (pendingRows.length === 0) return;
        const rows = pendingRows.splice(0, pendingRows.length);
        await addSnapshotTableRows(cwd, revisionId, rows);
      };

      for await (const item of snapshotSource.iterateForSnapshot(
        container,
        options.signal,
      )) {
        throwIfAborted(options.signal, "snapshot cancelled");
        pendingRows.push({
          rowKeyJson: item.keyJson,
          rowHash: item.rowHash,
          payloadJson: item.payloadJson,
        });
        if (pendingRows.length >= SNAPSHOT_FLUSH_THRESHOLD) {
          await flushRows();
        }
      }
      throwIfAborted(options.signal, "snapshot cancelled");
      await flushRows();
      await finalizeSnapshotTableRevision(
        cwd,
        snapshotId,
        container,
        revisionId,
      );
    }

    await finalizeSnapshot(cwd, snapshotId);
    onProgress?.({ container: "", done: true, index: total, total });
    return snapshotId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finalizeSnapshot(cwd, snapshotId, msg);
    throw err;
  }
}
