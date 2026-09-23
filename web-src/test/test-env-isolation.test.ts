// テストが起こすサーバ・CLI が、開発者の tmux に触らないこと。vitest の
// globalSetup (scripts/vitest-global-setup.mjs) が tmux のソケットの場所を
// テストの間だけの一時ディレクトリに向け、TMUX・TMUX_PANE を外している。
// ここが外れると、サーバを起こすテスト (`--standalone` も巡回する) が開発者の
// ペインを読む (agents.md 9・10)。登録簿と状態ディレクトリは verify の実行者が
// 自分の一時ディレクトリを渡すことがあるので、ここでは場所を決め打ちしない。
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";

describe("the tmux environment every test inherits", () => {
  test("the tmux socket directory is under the temporary directory", () => {
    expect(process.env.TMUX_TMPDIR?.startsWith(tmpdir())).toBe(true);
  });

  test.each([
    ["TMUX"],
    ["TMUX_PANE"],
  ])("%s is not set (tmux would prefer the developer's server)", (name) => {
    expect(process.env[name]).toBeUndefined();
  });
});
