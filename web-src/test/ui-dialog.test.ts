// ui-dialog の API 動作を happy-dom 上で検証する。
// OK / Cancel / Escape / backdrop click が Promise を正しく解決すること、
// prompt の入力 + Enter 確定 + validate ロックが想定通り動くことを確認する。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import {
  clickDialogCancel,
  closeOpenDialog,
  getOpenDialog,
} from "./_dialog-helpers";

GlobalRegistrator.register();

const { showAlertDialog, showConfirmDialog, showFormDialog, showPromptDialog } =
  await import("../views/ui-dialog");

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
  test("traps Tab and restores focus after Escape", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const p = showConfirmDialog({ body: "Continue?" });
    await tick();
    const [cancel, confirm] = actionButtons();
    expect(document.activeElement).toBe(confirm);

    confirm.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    expect(document.activeElement).toBe(cancel);
    cancel.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(await p).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

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

  // 確定が押せない間 (値が正しくない間) は、Cancel の次の Tab で dialog の外
  // (body) へ抜けていた。押せない確定を飛ばして入力欄へ戻る。
  test.each([
    ["Tab on Cancel", ".gdp-dialog-cancel", false, ".gdp-dialog-input"],
    ["Shift+Tab on the field", ".gdp-dialog-input", true, ".gdp-dialog-cancel"],
  ])("with submit disabled, %s stays inside", async (_name, from, shiftKey, to) => {
    const p = showPromptDialog({
      title: "Path?",
      validate: (v) => (v.startsWith("/") ? v : null),
    });
    await tick();
    const start = getOpenDialog().querySelector<HTMLElement>(from);
    if (!start) throw new Error(`missing ${from}`);
    expect(actionButtons()[1].disabled).toBe(true);
    start.focus();
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    start.dispatchEvent(event);
    expect({
      trapped: event.defaultPrevented,
      focused: document.activeElement?.matches(to),
    }).toEqual({ trapped: true, focused: true });
    clickDialogCancel();
    expect(await p).toBeNull();
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

// 右上の閉じるボタンは取り消しと同じ (確定の値を返さない)。4 つの型のどれでも
// 同じ場所・同じ意味で、説明は取り消しのラベルを使う。
// 本文に置いたリンクや tabindex の部品も閉じ込めの輪に入る (入らないと、
// そこから Shift+Tab すると先頭へ飛ばされ、最初のフォーカスも取り消しに行く)。
describe("showFormDialog focus trap", () => {
  function part(html: string): HTMLElement {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content.firstElementChild as HTMLElement;
  }
  const key = (target: HTMLElement, name: string, shiftKey = false) => {
    const event = new KeyboardEvent("keydown", {
      key: name,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };

  test.each([
    ["a link", ['<a href="#sample">sample</a>', "<button>b</button>"], "a"],
    [
      "a tabindex=0 part",
      ['<div tabindex="0">p</div>', "<button>b</button>"],
      "div",
    ],
    [
      "a link after a tabindex=-1 part",
      ['<div tabindex="-1">p</div>', '<a href="#sample">sample</a>'],
      "a",
    ],
  ])("%s is first in the loop", async (_name, parts, first) => {
    const body = document.createElement("div");
    body.append(...parts.map(part));
    const result = showFormDialog({ body, submit: () => "saved" });
    await tick();
    const [, submit] = actionButtons();
    const head = body.querySelector<HTMLElement>(first);
    expect(document.activeElement).toBe(head);
    key(submit, "Tab");
    expect(document.activeElement).toBe(head);
    if (head) key(head, "Tab", true);
    expect(document.activeElement).toBe(submit);
    clickDialogCancel();
    expect(await result).toBeNull();
  });

  test("Shift+Tab from a link in the middle is left to the browser", async () => {
    const body = document.createElement("div");
    body.append(
      part("<button>b</button>"),
      part('<a href="#sample">sample</a>'),
    );
    const result = showFormDialog({ body, submit: () => "saved" });
    await tick();
    const link = body.querySelector<HTMLAnchorElement>("a");
    link?.focus();
    expect(link && key(link, "Tab", true)).toBe(false);
    expect(document.activeElement).toBe(link);
    clickDialogCancel();
    expect(await result).toBeNull();
  });

  test("Enter on a link follows it instead of submitting", async () => {
    const body = document.createElement("div");
    body.append(part('<a href="#sample">sample</a>'));
    let submitted = 0;
    const followed: string[] = [];
    const result = showFormDialog({
      body,
      submit: () => {
        submitted += 1;
        return "saved";
      },
    });
    await tick();
    const link = body.querySelector<HTMLAnchorElement>("a");
    link?.addEventListener("click", (event) => {
      event.preventDefault();
      followed.push(link.getAttribute("href") ?? "");
    });
    if (link) key(link, "Enter");
    await tick();
    expect({ submitted, followed }).toEqual({
      submitted: 0,
      followed: ["#sample"],
    });
    clickDialogCancel();
    expect(await result).toBeNull();
  });
});

describe("the close button in the corner cancels", () => {
  function closeButton(): HTMLButtonElement {
    const button =
      getOpenDialog().querySelector<HTMLButtonElement>(".gdp-dialog-close");
    if (!button) throw new Error("no close button");
    return button;
  }

  test.each([
    [
      "confirm",
      () => showConfirmDialog({ body: "Continue?", cancelLabel: "Keep" }),
      false,
      "Keep",
    ],
    [
      "prompt",
      () => showPromptDialog({ defaultValue: "x", cancelLabel: "Keep" }),
      null,
      "Keep",
    ],
    [
      "form",
      () =>
        showFormDialog({
          body: document.createElement("div"),
          submit: () => "saved",
          cancelLabel: "Keep",
        }),
      null,
      "Keep",
    ],
    [
      "alert",
      () => showAlertDialog({ body: "Done", confirmLabel: "OK" }),
      undefined,
      "OK",
    ],
  ] as const)("%s", async (_name, open, expected, label) => {
    const result = (open as () => Promise<unknown>)();
    await tick();
    const button = closeButton();
    expect(button.getAttribute("aria-label")).toBe(label);
    button.click();
    expect(await result).toBe(expected);
    expect(document.querySelector(".gdp-dialog-backdrop")).toBeNull();
  });
});
