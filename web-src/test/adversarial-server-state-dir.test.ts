// codeViewerStateDir は XDG_STATE_HOME をそのまま根にしていた。相対パス
// (XDG Base Directory の決まりでは無視すべき値) だと、状態ディレクトリは
// 各プロセスの作業ディレクトリからの相対になった。入口は起動した場所、裏は
// プロジェクトの根 (worktree/open.ts の spawn の cwd)、フックはエージェントの
// 作業場所で動くので、entry.json を 3 者が別々の場所に読み書きする。
// いまは相対の値を無視し、理由を 1 回だけ出す。
// 読んだ範囲の帰結 (実プロセスでは確かめていない):
// - 裏の持ち主の確認 (preview.ts の verifyEntryOwner) が "entry.json has no
//   entry owner" になり、10 秒後に裏が自分で終わる
// - 別の場所で打った `code-viewer` は入口を見つけられず、2 つ目の入口を起こす
// - フックの申告は入口を見つけられない

import { isAbsolute } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { codeViewerStateDir } from "../server/user-state-dir";

describe("codeViewerStateDir with a relative XDG_STATE_HOME", () => {
  test("相対の XDG_STATE_HOME を無視して ~/.local/state の下 (絶対パス) にし、理由を 1 回だけ出す", () => {
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const dirs = [1, 2].map(() =>
      codeViewerStateDir(
        { XDG_STATE_HOME: "relative-state" },
        "/home/sample-user",
      ),
    );
    const calls = [...errors.mock.calls];
    errors.mockRestore();
    for (const dir of dirs) {
      expect(isAbsolute(dir)).toBe(true);
      expect(dir).toBe("/home/sample-user/.local/state/code-viewer");
    }
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.[0])).toContain("XDG_STATE_HOME=relative-state");
  });
});
