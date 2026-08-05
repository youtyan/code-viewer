// キーの変更 UI を happy-dom 上で動かす。押した打鍵がそのまま差分として
// 保存されること、記録中の打鍵がアプリのキーマップへ漏れないこと、衝突を
// 知らせつつ保存は止めないことを確かめる。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import type { KeymapOverrides } from "../core/keymap";
import { buildHelpKeybindingGroups } from "../views/help-keybindings";
import { renderHelpTable } from "../views/help-page";
import {
  clickDialogCancel,
  clickDialogConfirm,
  closeOpenDialog,
  getOpenDialog,
} from "./_dialog-helpers";

GlobalRegistrator.register();

const { createHelpKeybindingEditor } = await import(
  "../views/help-keybinding-editor"
);

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

afterEach(() => {
  closeOpenDialog();
  document.body.innerHTML = "";
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

type Harness = {
  article: HTMLElement;
  saved: KeymapOverrides[];
  changed: number;
  overrides: KeymapOverrides;
};

/** Help ページが組む DOM と同じ形を用意して、そこへ編集 UI を差す。 */
function setup(overrides: KeymapOverrides = {}): Harness {
  document.body.innerHTML = '<article id="article"></article>';
  const article = document.querySelector<HTMLElement>("#article");
  if (!article) throw new Error("missing article");

  const groups = buildHelpKeybindingGroups("en");
  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "gdp-help-group gdp-help-keybinding-group";
    section.appendChild(renderHelpTable(group.rows));
    article.appendChild(section);
  }

  const harness: Harness = { article, saved: [], changed: 0, overrides };
  const editor = createHelpKeybindingEditor({
    getLanguage: () => "en",
    getOverrides: () => harness.overrides,
    saveOverrides: (next) => {
      harness.saved.push(next);
      harness.overrides = next;
    },
    onChanged: () => {
      harness.changed++;
    },
  });
  editor.decorate(article, groups);
  return harness;
}

/** 「Toggle theme」の行を探して変更ダイアログを開く。 */
async function openDialogFor(article: HTMLElement, needle: string) {
  const row = Array.from(article.querySelectorAll("tr")).find((candidate) =>
    candidate.cells[1]?.textContent?.includes(needle),
  );
  if (!row) throw new Error(`no row for ${needle}`);
  const button = row.querySelector<HTMLButtonElement>(
    ".gdp-help-keybinding-actions button",
  );
  if (!button) throw new Error(`no change button for ${needle}`);
  button.click();
  await tick();
  return getOpenDialog();
}

function pressCapture(
  dialog: HTMLElement,
  init: KeyboardEventInit & { key: string },
): void {
  const add = dialog.querySelector<HTMLButtonElement>(
    ".gdp-kbe-action-buttons button",
  );
  if (!add) throw new Error("no capture button");
  add.click();
  document.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
  );
}

describe("keybinding editor", () => {
  test("puts a change button on every documented row", () => {
    const { article } = setup();

    const buttons = article.querySelectorAll(
      ".gdp-help-keybinding-actions button",
    );

    expect(buttons.length).toBeGreaterThan(0);
    expect(article.querySelector(".gdp-kbe-toolbar")).not.toBeNull();
  });

  test("marks the rows the user already changed", () => {
    const { article } = setup({ "toggle-theme": [{ key: "x" }] });

    const row = Array.from(article.querySelectorAll("tr")).find((candidate) =>
      candidate.cells[1]?.textContent?.includes("Toggle theme"),
    );

    expect(row?.querySelector(".gdp-kbe-changed")).not.toBeNull();
  });

  test("saves the key that was pressed", async () => {
    const harness = setup();
    const dialog = await openDialogFor(harness.article, "Toggle theme");

    // まず既定の t を外してから、新しい打鍵を記録する。
    dialog.querySelector<HTMLButtonElement>(".gdp-kbe-chip-remove")?.click();
    pressCapture(dialog, { key: "X", ctrlKey: true });
    clickDialogConfirm();
    await tick();

    expect(harness.saved).toEqual([
      { "toggle-theme": [{ key: "x", ctrl: true }] },
    ]);
    expect(harness.changed).toBe(1);
  });

  test("keeps the pressed key away from the rest of the app", async () => {
    const harness = setup();
    const dialog = await openDialogFor(harness.article, "Toggle theme");
    let leaked = 0;
    const listener = () => {
      leaked++;
    };
    document.addEventListener("keydown", listener);

    pressCapture(dialog, { key: "Escape" });
    document.removeEventListener("keydown", listener);

    expect(leaked).toBe(0);
    expect(getOpenDialog()).toBeTruthy();
  });

  test("records Escape as an ordinary key", async () => {
    const harness = setup();
    const dialog = await openDialogFor(harness.article, "Toggle theme");

    dialog.querySelector<HTMLButtonElement>(".gdp-kbe-chip-remove")?.click();
    pressCapture(dialog, { key: "Escape" });
    clickDialogConfirm();
    await tick();

    expect(harness.saved).toEqual([{ "toggle-theme": [{ key: "escape" }] }]);
  });

  test.each([
    { name: "Shift", key: "Shift" },
    { name: "Control", key: "Control" },
    { name: "Alt", key: "Alt" },
    { name: "Meta", key: "Meta" },
  ])("does not accept $name on its own", async ({ key }) => {
    const harness = setup();
    const dialog = await openDialogFor(harness.article, "Toggle theme");

    dialog.querySelector<HTMLButtonElement>(".gdp-kbe-chip-remove")?.click();
    pressCapture(dialog, { key });
    clickDialogConfirm();
    await tick();

    expect(harness.saved).toEqual([{ "toggle-theme": [] }]);
  });

  test("ignores keys typed while the IME is composing", async () => {
    const harness = setup();
    const dialog = await openDialogFor(harness.article, "Toggle theme");

    dialog.querySelector<HTMLButtonElement>(".gdp-kbe-chip-remove")?.click();
    pressCapture(dialog, { key: "a", isComposing: true });
    // 変換中の打鍵は捨てるので、続けて押した打鍵が記録される。
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "b",
      }),
    );
    clickDialogConfirm();
    await tick();

    expect(harness.saved).toEqual([{ "toggle-theme": [{ key: "b" }] }]);
  });

  test("removing every key disables the action", async () => {
    const harness = setup();
    const dialog = await openDialogFor(harness.article, "Toggle theme");

    dialog.querySelector<HTMLButtonElement>(".gdp-kbe-chip-remove")?.click();
    clickDialogConfirm();
    await tick();

    expect(harness.saved).toEqual([{ "toggle-theme": [] }]);
    expect(dialogless(harness)).toBe(true);
  });

  test("restore default drops the action from the saved overrides", async () => {
    const harness = setup({ "toggle-theme": [{ key: "x" }] });
    const dialog = await openDialogFor(harness.article, "Toggle theme");

    const buttons = dialog.querySelectorAll<HTMLButtonElement>(
      ".gdp-kbe-action-buttons button",
    );
    buttons[1].click();
    clickDialogConfirm();
    await tick();

    expect(harness.saved).toEqual([{}]);
  });

  test("warns about a clash but still lets it be saved", async () => {
    const harness = setup();
    const dialog = await openDialogFor(harness.article, "Toggle theme");

    dialog.querySelector<HTMLButtonElement>(".gdp-kbe-chip-remove")?.click();
    // s は split レイアウトが使っている。
    pressCapture(dialog, { key: "s" });

    const warning =
      dialog.querySelector(".gdp-kbe-warnings")?.textContent ?? "";
    expect(warning).toContain("layout-split");

    clickDialogConfirm();
    await tick();
    expect(harness.saved).toEqual([{ "toggle-theme": [{ key: "s" }] }]);
  });

  test("cancelling saves nothing", async () => {
    const harness = setup();
    const dialog = await openDialogFor(harness.article, "Toggle theme");

    dialog.querySelector<HTMLButtonElement>(".gdp-kbe-chip-remove")?.click();
    clickDialogCancel();
    await tick();

    expect(harness.saved).toEqual([]);
    expect(harness.changed).toBe(0);
  });

  test("restore all defaults clears every override", () => {
    const harness = setup({ "toggle-theme": [{ key: "x" }] });

    harness.article
      .querySelector<HTMLButtonElement>(".gdp-kbe-toolbar button")
      ?.click();

    expect(harness.saved).toEqual([{}]);
    expect(harness.changed).toBe(1);
  });
});

function dialogless(harness: Harness): boolean {
  return (
    harness.saved.length === 1 &&
    document.querySelector(".gdp-dialog-backdrop") === null
  );
}
