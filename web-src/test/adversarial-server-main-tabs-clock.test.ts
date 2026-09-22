// saveProjectMainTabs は覚えるプロジェクトが上限 (200) を超えると、savedAt の
// 古い順に忘れる。savedAt は保存した側の時計 (Date.now) なので、時計が
// 戻った後 (手で合わせ直した・仮想機械の復元など) に保存すると、いま保存した
// プロジェクトがいちばん古く見え、同じ書き込みの中で消えていた。保存は成功を
// 返すので、画面は保存できたと思ったまま、次に開くと空のタブから始まった。
// いまは保存したものを整理の対象から外す。

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  loadProjectMainTabs,
  MAX_MAIN_TABS_PROJECTS,
  saveProjectMainTabs,
} from "../server/main-tabs-store";

describe("saving main tabs after the clock went back", () => {
  test("時計が戻った後に保存しても、いま保存したプロジェクトの配置が読み戻せる", async () => {
    const path = join(
      mkdtempSync(join(tmpdir(), "cv-adversarial-tabs-")),
      "main-tabs.json",
    );
    const later = 2_000_000_000_000;
    for (let i = 0; i < MAX_MAIN_TABS_PROJECTS; i += 1) {
      await saveProjectMainTabs(
        path,
        `/work/sample-${i}`,
        { tabs: [] },
        later + i,
      );
    }
    const layout = { tabs: [{ kind: "sample" }] };
    // 時計が 1 時間戻った後の保存。
    await saveProjectMainTabs(
      path,
      "/work/sample-new",
      layout,
      later - 3_600_000,
    );

    expect(loadProjectMainTabs(path, "/work/sample-new")).toEqual(layout);
  });
});
