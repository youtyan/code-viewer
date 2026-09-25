// 設定の「エージェント連携」の節の、見出しの下の説明とヘルプへのリンク。
// 何のための設定かが読み取れなかった (仕組みの説明だけが長かった) ので、
// 入れると何が良くなるかを 1〜2 文で言い、入れ方はヘルプへ送る。
// 行 (claude / codex) の出し方はサーバの答えが要るので、ここでは見ない。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  AGENT_HOOKS_HELP_SECTION,
  createAgentHooksSettings,
} from "../views/agents/agent-hooks-settings";
import { agentsText } from "../views/agents/i18n";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

function setup(lang: "en" | "ja") {
  const opened: string[] = [];
  const section = createAgentHooksSettings({
    getText: () => agentsText(lang).hooks,
    trackLoad: (promise) => promise,
    actionHeaders: () => ({}),
    onChanged: () => undefined,
    helpLink: () => ({
      label: `Help › sample section (${lang})`,
      href: `/help?section=${AGENT_HOOKS_HELP_SECTION}`,
    }),
    openHelp: () => {
      opened.push(AGENT_HOOKS_HELP_SECTION);
    },
    openAgent: () => Promise.reject(new Error("openAgent is not used here")),
  });
  return { section, opened };
}

describe("the agent integration section", () => {
  test.each([
    [
      "en",
      "With these hooks, claude and codex tell code-viewer themselves when they are working, waiting for input or done, so the states shown are reliable. Other hooks in the file stay as they are.",
      "How to set them up and what they change: Help › sample section (en).",
    ],
    [
      "ja",
      "入れると、claude と codex が作業中・入力待ち・完了を自分で知らせるので、状態の表示が確かになります。ファイルにあるほかのフックはそのまま残ります。",
      "入れ方と、入れると何が変わるかは Help › sample section (ja) にあります。",
    ],
  ] as const)("in %s says what the hooks are for, then links to the help", (lang, intro, help) => {
    const { section } = setup(lang);
    const [title, first, second] = Array.from(
      section.element.children,
      (child) => child.textContent,
    );
    expect([title, first, second]).toEqual([
      agentsText(lang).hooks.title,
      intro,
      help,
    ]);
  });

  test("the link opens the help section in the app", () => {
    const { section, opened } = setup("en");
    const link = section.element.querySelector<HTMLAnchorElement>(
      ".gdp-help-shortcut-link a",
    );
    if (!link) throw new Error("missing help link");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect([link.getAttribute("href"), event.defaultPrevented, opened]).toEqual(
      ["/help?section=agent-hooks", true, ["agent-hooks"]],
    );
  });
});
