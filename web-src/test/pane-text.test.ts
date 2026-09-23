// エージェント・tmux のペインを 1 行で見せる文字の決まり (1 か所)。サイドバー
// の作業の欄・「＋」のメニューの行・パレットの補足・ターミナルのタブの名前が
// 同じ関数の値を使う。tmux / shell の既定の題名 (空・コマンド名・ホスト名の
// ような ASCII の 1 語) は作業の要約として見せず、状態の語にする。ホスト名は
// どこにも出さない。

import { describe, expect, test } from "vitest";
import type { AgentPane } from "../core/agent-overview";
import { paneTaskSummary } from "../core/agent-overview";
import { agentsText } from "../views/agents/i18n";
import { paneText, shellName } from "../views/agents/pane-text";
import { agentPane } from "./_test-helpers";

function pane(title: string): AgentPane {
  return agentPane({
    id: "%1",
    label: "sample:0.0",
    title,
    path: "/work/sample-repo",
    state: "waiting",
    source: "screen",
    project: "/work/sample-repo",
  });
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

describe("shell name: Shell and the order it was opened, never the id", () => {
  const words = {
    shell: "Shell",
    signIn: "Sign in",
    defaultAccount: "Default",
  };
  const sessions = [
    { id: "shell-zzzz01", createdAt: "2026-01-01T00:00:02.000Z" },
    { id: "shell-aaaa01", createdAt: "2026-01-01T00:00:01.000Z" },
    { id: "shell-bbbb01", createdAt: "2026-01-01T00:00:02.000Z" },
  ];
  test.each([
    { name: "the first opened", session: "shell-aaaa01", expected: "Shell 1" },
    {
      name: "the same time falls back to the id order",
      session: "shell-bbbb01",
      expected: "Shell 2",
    },
    { name: "the last opened", session: "shell-zzzz01", expected: "Shell 3" },
    {
      name: "not in the list yet (before it is fetched)",
      session: "shell-cccc01",
      expected: "Shell",
    },
  ])("$name → $expected", ({ session, expected }) => {
    expect(shellName(session, sessions, words, () => false)).toBe(expected);
  });

  // ログインのウィンドウを映すシェルは、番号でなく用途とアカウントで呼ぶ。
  test.each([
    {
      account: "Work",
      agent: "claude" as const,
      expected: "Sign in · claude · Work",
    },
    {
      account: "",
      agent: "codex" as const,
      expected: "Sign in · codex · Default",
    },
  ])("sign-in $agent '$account' → $expected", ({
    account,
    agent,
    expected,
  }) => {
    const signIn = {
      id: "shell-dddd01",
      createdAt: "2026-01-01T00:00:03.000Z",
      purpose: { kind: "sign-in" as const, agent, account },
    };
    expect(
      shellName(signIn.id, [...sessions, signIn], words, () => false),
    ).toBe(expected);
  });

  test("closing an earlier shell renumbers the later ones", () => {
    const rest = sessions.filter((item) => item.id !== "shell-aaaa01");
    expect(shellName("shell-zzzz01", rest, words, () => false)).toBe("Shell 2");
  });

  test("shells showing an agent are not counted", () => {
    const agent = (id: string) => id === "shell-aaaa01";
    expect(shellName("shell-bbbb01", sessions, words, agent)).toBe("Shell 1");
  });

  test("an empty list names every shell by the word alone", () => {
    expect(
      shellName("shell-aaaa01", [], { ...words, shell: "シェル" }, () => false),
    ).toBe("シェル");
  });
});
