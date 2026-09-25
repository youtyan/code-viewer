// 入れ方の箱 (views/install-help.ts): 何が無いかの 1 文、コピーのボタンつきの
// コマンド (ヘルプの本文と同じ部品)、ヘルプの節へのリンク。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  installHelpBlock,
  NODE_PTY_INSTALL_COMMANDS,
  showInstallDialog,
  TMUX_INSTALL_COMMANDS,
} from "../views/install-help";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("how to install what is missing", () => {
  test.each([
    {
      name: "tmux (macOS and Linux)",
      commands: TMUX_INSTALL_COMMANDS,
      shown: [
        ["macOS (Homebrew)", "brew install tmux"],
        ["Debian / Ubuntu", "sudo apt install tmux"],
      ],
    },
    {
      name: "the shell dependency",
      commands: NODE_PTY_INSTALL_COMMANDS,
      shown: [
        ["npm", "npm install -g @youtyan/code-viewer --include=optional"],
      ],
    },
  ])("$name", async ({ commands, shown }) => {
    const opened: string[] = [];
    const box = installHelpBlock(
      {
        intro: "sample intro",
        commands,
        help: { label: "Help › sample", open: () => opened.push("help") },
      },
      "en",
    );
    document.body.appendChild(box);
    expect(box.querySelector(".install-help-intro")?.textContent).toBe(
      "sample intro",
    );
    const blocks = [...box.querySelectorAll(".gdp-help-command")];
    expect(
      blocks.map((block) => [
        block.querySelector(".gdp-help-command-title")?.textContent,
        block.querySelector("code")?.textContent,
      ]),
    ).toEqual(shown);
    // コピーのボタンはそのコマンドを写す。
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    blocks[0]
      ?.querySelector<HTMLButtonElement>(".gdp-help-command-copy")
      ?.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(shown[0]?.[1]);
    box.querySelector<HTMLButtonElement>(".install-help-link")?.click();
    expect(opened).toEqual(["help"]);
  });
});

test("the dialog for shells that cannot be opened: the words, the command and the server's reason", async () => {
  const closed = showInstallDialog({
    title: "Shells cannot be opened",
    help: {
      intro: "sample intro",
      commands: NODE_PTY_INSTALL_COMMANDS,
      help: { label: "Help › Terminal", open: () => undefined },
    },
    reason: "Cannot find module '@lydell/node-pty'\nsecond line",
    closeLabel: "Close",
    lang: "en",
  });
  const dialog = document.querySelector<HTMLElement>(".gdp-dialog");
  expect(dialog?.querySelector(".gdp-dialog-title")?.textContent).toBe(
    "Shells cannot be opened",
  );
  expect(dialog?.querySelector(".gdp-help-command code")?.textContent).toBe(
    NODE_PTY_INSTALL_COMMANDS[0].command,
  );
  // サーバの理由は丸めずに全部出す。
  expect(
    dialog?.querySelector("pre.agent-hooks-dialog-code")?.textContent,
  ).toBe("Cannot find module '@lydell/node-pty'\nsecond line");
  // 確定の操作は無く、［閉じる］1 つだけ (キャンセルと閉じるを並べない)。
  const buttons = [
    ...(dialog?.querySelectorAll<HTMLButtonElement>(
      ".gdp-dialog-actions button",
    ) ?? []),
  ];
  expect(buttons.map((button) => button.textContent)).toEqual(["Close"]);
  expect(document.activeElement).toBe(buttons[0]);
  buttons[0]?.click();
  expect(await closed).toBeNull();
});
