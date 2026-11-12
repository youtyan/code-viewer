// データストアのスナップショットの画面 (views/database/snapshot-view.ts)。描き方を
// 記録する view に差し替え、一覧・比較の選び方・取得の選択欄・取得中の行で
// presenter が view に渡す値を見る。

import "./_dom";
import { afterEach, describe, expect, test } from "vitest";
import type { SnapshotMeta } from "../core/database/types";
import {
  createSnapshotView,
  DEFAULT_VIEW,
  type SnapshotViewProps,
} from "../views/database/snapshot-view";
import { waitFor } from "./_test-helpers";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  document.body.replaceChildren();
});

function snapshot(id: string, createdAt: string): SnapshotMeta {
  return {
    id,
    dbId: "sample.db",
    createdAt,
    tables: ["sample_table"],
    note: "",
    status: "done",
  } as SnapshotMeta;
}

describe("the snapshot view presenter", () => {
  test("lists snapshots, picks the two newest to compare, and tracks a job", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          snapshots: [
            snapshot("sample-new", "2026-10-02T00:00:00Z"),
            snapshot("sample-old", "2026-10-01T00:00:00Z"),
          ],
        }),
        { status: 200 },
      )) as typeof fetch;
    const shown: SnapshotViewProps[] = [];
    const view = createSnapshotView(
      {
        getDbId: () => "sample.db",
        getSchema: () => null,
        getTables: () => [
          { name: "sample_table", type: "table", rowCount: 1 },
          { name: "sample_view", type: "view", rowCount: null },
        ],
      },
      (props) => {
        shown.push(props);
        return DEFAULT_VIEW(props);
      },
    );
    document.body.append(view.el);
    const last = () => shown[shown.length - 1] as SnapshotViewProps | undefined;

    view.refresh();
    await waitFor(() => last()?.left.snapshots.length === 2);
    expect([
      last()?.left.snapshots.map((s) => s.id),
      last()?.left.diffBefore,
      last()?.left.diffAfter,
    ]).toEqual([["sample-new", "sample-old"], "sample-old", "sample-new"]);

    last()?.onCreate();
    expect([
      last()?.selector.visible,
      last()?.selector.tables.map((t) => t.name),
      [...(last()?.selector.selected ?? [])],
    ]).toEqual([true, ["sample_table"], ["sample_table"]]);

    view.handleSse(
      JSON.stringify({
        action: "progress",
        dbId: "sample.db",
        id: "sample-job",
        table: "sample_table",
        index: 1,
        total: 2,
      }),
    );
    expect(
      last()?.jobs.map(({ job, cancelling }) => [
        job.id,
        job.table,
        cancelling,
      ]),
    ).toEqual([["sample-job", "sample_table", false]]);
    view.dispose();
  });
});
