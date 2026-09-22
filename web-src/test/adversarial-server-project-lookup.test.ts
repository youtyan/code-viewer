// 入口の projects.lookup は、知らない鍵を引くたびに、登録したプロジェクト
// 全部の `git worktree list` を見る (10 秒覚える)。覚えるのが結果が返って
// からだったので、覚えていない間に同じ鍵の要求が重なると、重なった数 ×
// プロジェクト数だけ git を立てていた。いまは返る前の 1 本を覚えて待たせる。知らない鍵は珍しくない: 登録から外した
// プロジェクトを開いたままのタブは、入口宛ての要求 (エージェント一覧の
// 取り直し・tmux・シェル) の PROJECT_HEADER に外した鍵を付け続ける
// (entry/server.ts の selectedRoot)。

import { describe, expect, test } from "vitest";
import { createEntryProjects } from "../server/entry/projects";

describe("entry project lookup of an unknown key under concurrent requests", () => {
  test("重なった要求でも、登録したプロジェクト 1 つにつき git worktree list は 1 回", async () => {
    const roots = ["/work/sample-a", "/work/sample-b", "/work/sample-c"];
    const listed: string[] = [];
    const gate: { open?: () => void } = {};
    const opened = new Promise<void>((resolve) => {
      gate.open = resolve;
    });
    const projects = createEntryProjects({
      registryRoots: () => roots,
      worktreePaths: async (root) => {
        listed.push(root);
        await opened;
        return [root];
      },
      now: () => 1_000_000,
    });
    const unknownKey = "0123456789abcdef";

    const lookups = Array.from({ length: 5 }, () =>
      projects.lookup(unknownKey),
    );
    // 最初の git が返る前に、5 つの要求が揃って待っている。
    await new Promise((resolve) => setTimeout(resolve, 10));
    gate.open?.();
    const results = await Promise.all(lookups);

    expect(results.every((result) => result.status === "unknown")).toBe(true);
    expect(listed).toHaveLength(roots.length);
  });
});
