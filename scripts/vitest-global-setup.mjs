// CLI を起動して確かめるテストは、TypeScript を都度変換する tsx ではなく
// 配布物と同じバンドルを起動する。起動が 3 倍以上速く、実際に配られるものを
// そのまま検証できる。テスト全体で 1 回だけ焼く。
//
// もう 1 つ、テストが起こすサーバの登録簿とフックの状態ディレクトリを、
// テストの間だけの一時ディレクトリに向ける。向けないと、サーバを起こす
// テストが開発者の ~/.cache/code-viewer/servers に登録を書き、強制終了で
// 消えないまま積み上がる (実際に数千件溜まっていた)。個別に上書きする
// テストはそのまま自分の場所を使う。
//
// tmux も同じ。テストが起こすサーバ (`--standalone` も) は tmux を巡回するので、
// ソケットの場所 (TMUX_TMPDIR) をテストの間だけのものにし、TMUX・TMUX_PANE を
// 外す。外さないと tmux は環境変数のソケットを優先し、開発者の tmux を読む
// (agents.md の 9・10)。開発者が TMUX_TMPDIR を設定していても上書きする。

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServerBundle } from "./bundles.mjs";

export default async function setup() {
  await buildServerBundle();
  const root = mkdtempSync(join(tmpdir(), "code-viewer-vitest-"));
  process.env.CODE_VIEWER_TEST_SERVER_REGISTRY_DIR ??= join(root, "servers");
  process.env.CODE_VIEWER_TEST_STATE_DIR ??= join(root, "state");
  mkdirSync(join(root, "tmux"));
  process.env.TMUX_TMPDIR = join(root, "tmux");
  delete process.env.TMUX;
  delete process.env.TMUX_PANE;
  return () => {
    rmSync(root, { recursive: true, force: true });
  };
}
