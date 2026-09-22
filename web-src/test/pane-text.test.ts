// エージェント・tmux のペインを 1 行で見せる文字の決まり (1 か所)。サイドバー
// の作業の欄・「＋」のメニューの行・パレットの補足・ターミナルのタブの名前が
// 同じ関数の値を使う。tmux / shell の既定の題名 (空・コマンド名・ホスト名の
// ような ASCII の 1 語) は作業の要約として見せず、状態の語にする。ホスト名は
// どこにも出さない。

import { describe, expect, test } from "vitest";
import type { AgentPane } from "../core/agent-overview";
import { paneTaskSummary } from "../core/agent-overview";
import { agentsText } from "../views/agents/i18n";
import { paneText } from "../views/agents/pane-text";

function pane(title: string): AgentPane {
  return {
    id: "%1",
    label: "sample:0.0",
    session: "sample",
    title,
    command: "claude",
    path: "/work/sample-repo",
    kind: "claude",
    state: "waiting",
    source: "screen",
    updatedAt: 0,
    watchedSince: 0,
    project: "/work/sample-repo",
    worktree: "",
    shownInShell: "",
    account: null,
  };
}

const EN = agentsText("en");

describe("pane text: one rule for every place", () => {
  test.each([
    {
      name: "the default title of tmux (a host name)",
      title: "sample-host",
      summary: null,
      shown: "Needs input",
    },
    {
      name: "an empty title",
      title: "",
      summary: null,
      shown: "Needs input",
    },
    {
      name: "a task summary written by the AI CLI",
      title: "✳ Review plan",
      summary: "Review plan",
      shown: "Review plan",
    },
    {
      name: "a Japanese title",
      title: "計画を見直す",
      summary: "計画を見直す",
      shown: "計画を見直す",
    },
  ])("$name", ({ title, summary, shown }) => {
    const target = pane(title);
    const text = paneText(target, EN);
    expect({
      summary: paneTaskSummary(target),
      sidebarTask: text.summary,
      tabName: text.headline,
      newTabMenuRow: text.row,
      paletteDetail: text.detail,
      tooltip: text.title,
    }).toEqual({
      summary,
      sidebarTask: shown,
      tabName: `claude · ${shown}`,
      newTabMenuRow: `claude · ${shown} · sample:0.0`,
      paletteDetail: `${shown} · sample:0.0`,
      tooltip:
        summary === null
          ? "Needs input\nsample:0.0 · claude"
          : `Needs input · ${shown}\nsample:0.0 · claude`,
    });
    for (const value of Object.values(text))
      expect(value).not.toContain("sample-host");
  });
});
