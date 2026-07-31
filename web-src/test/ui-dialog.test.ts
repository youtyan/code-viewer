// ui-dialog の API 動作を happy-dom 上で検証する。
// OK / Cancel / Escape / backdrop click が Promise を正しく解決すること、
// prompt の入力 + Enter 確定 + validate ロックが想定通り動くことを確認する。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import { closeOpenDialog, getOpenDialog } from "./_dialog-helpers";

GlobalRegistrator.register();

const { showAlertDialog, showConfirmDialog, showPromptDialog } = await import(
  "../views/ui-dialog"
);

const tick = () => new Promise((r) => setTimeout(r, 10));

function actionButtons(): HTMLButtonElement[] {
  return Array.from(
    getOpenDialog().querySelectorAll<HTMLButtonElement>(
      ".gdp-dialog-actions button",
    ),
  );
}

afterEach(() => {
  closeOpenDialog();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

describe("showConfirmDialog", () => {
  test("clicking confirm resolves true", async () => {
    const p = showConfirmDialog({ body: "Continue?", confirmLabel: "Go" });
    await tick();
    const buttons = actionButtons();
    expect(buttons[1].textContent).toBe("Go");
    buttons[1].click();
    expect(await p).toBe(true);
  });

  test("clicking cancel resolves false", async () => {
    const p = showConfirmDialog({ body: "Continue?" });
    await tick();
    actionButtons()[0].click();
    expect(await p).toBe(false);
  });

  test("Escape resolves false", async () => {
    const p = showConfirmDialog({ body: "Continue?" });
    await tick();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(await p).toBe(false);
  });

  test("danger flag adds gdp-dialog-danger class to confirm", async () => {
    const p = showConfirmDialog({ body: "Delete?", danger: true });
    await tick();
    expect(actionButtons()[1].classList.contains("gdp-dialog-danger")).toBe(
      true,
    );
    actionButtons()[0].click();
    await p;
  });
});

describe("showPromptDialog", () => {
  test("typing + Enter resolves with the value", async () => {
    const p = showPromptDialog({ title: "Name?", confirmLabel: "Save" });
    await tick();
    const input = document.querySelector<HTMLInputElement>(".gdp-dialog-input");
    if (!input) throw new Error("input missing");
    input.value = "Alice";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(await p).toBe("Alice");
  });

  test("Escape resolves null", async () => {
    const p = showPromptDialog({ title: "Name?" });
    await tick();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(await p).toBeNull();
  });

  test("validate=null keeps submit disabled and Enter is no-op", async () => {
    const p = showPromptDialog({
      title: "Folder?",
      validate: (v) => (v.includes("/") ? null : v.trim() || null),
      invalidMessage: "no slashes",
    });
    await tick();
    const input = document.querySelector<HTMLInputElement>(".gdp-dialog-input");
    if (!input) throw new Error("input missing");
    // 不正値 → Submit 無効 + エラー表示
    input.value = "a/b";
    input.dispatchEvent(new Event("input"));
    const submit = actionButtons()[1];
    expect(submit.disabled).toBe(true);
    const error = document.querySelector<HTMLElement>(".gdp-dialog-error");
    expect(error?.textContent).toBe("no slashes");
    // 正しい値 → Submit 有効 + Enter で解決
    input.value = "ok";
    input.dispatchEvent(new Event("input"));
    expect(submit.disabled).toBe(false);
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(await p).toBe("ok");
  });
});

describe("showAlertDialog", () => {
  test("clicking OK resolves", async () => {
    const p = showAlertDialog({ title: "Heads up", body: "Done" });
    await tick();
    const buttons = actionButtons();
    expect(buttons.length).toBe(1);
    buttons[0].click();
    expect(await p).toBeUndefined();
  });

  test("Escape resolves", async () => {
    const p = showAlertDialog({ body: "Done" });
    await tick();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(await p).toBeUndefined();
  });
});
