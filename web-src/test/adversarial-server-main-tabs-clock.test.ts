// 前の版は覚えるプロジェクトが上限を超えると savedAt の古い順に忘れ、時計が
// 戻った後 (手で合わせ直した・仮想機械の復元など) に保存すると、いま保存した
// 配置が同じ書き込みの中で消えていた。今はタブが全プロジェクト共通の 1 つの
// 配置で、窓どうしの突き合わせは時刻でなく版の番号 (rev) で見る。時計が戻っても、
// 最後に書いた配置が読み戻せ、版の番号は進む。

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { LAYOUT_VERSION } from "../core/main-tabs";
import { loadMainTabs, saveMainTabs } from "../server/main-tabs-store";

const layoutOf = (path: string) => ({
  version: LAYOUT_VERSION,
  focused: "left",
  panes: [
    {
      side: "left",
      activeId: "t1",
      tabs: [
        {
          id: "t1",
          preview: false,
          target: { kind: "file", path, project: "/work/sample-app" },
        },
      ],
    },
  ],
});

describe("saving main tabs after the clock went back", () => {
  test("時計が戻った後に保存しても、最後に書いた配置が読み戻せ、版の番号は進む", async () => {
    const path = join(
      mkdtempSync(join(tmpdir(), "cv-adversarial-tabs-")),
      "main-tabs.json",
    );
    const later = 2_000_000_000_000;
    await saveMainTabs(
      path,
      { baseRev: null, base: null, layout: layoutOf("before.ts") },
      later,
    );
    // 時計が 1 時間戻った後の保存。
    await saveMainTabs(
      path,
      { baseRev: 1, base: layoutOf("before.ts"), layout: layoutOf("after.ts") },
      later - 3_600_000,
    );
    expect(await loadMainTabs(path)).toEqual({
      kind: "ok",
      rev: 2,
      layout: layoutOf("after.ts"),
    });
  });
});
