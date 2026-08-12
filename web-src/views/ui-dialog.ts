// Promise ベースの confirm / prompt ダイアログ。
//
// 由来: 以前は repo-view.ts 内に gdp-trash-dialog として close-by-Esc / Tab
// focus trap / backdrop click / IME 配慮を含むローカル実装があった。同じ
// 仕組みを別の箇所でも使い回したいので汎用化し、window.confirm / window.prompt
// を直接呼ばずに済むようにする。
//
// 設計方針:
//   - DOM の差分は最小 (title 任意 / body 必須 / actions)。
//   - showConfirmDialog → Promise<boolean>。OK / Cancel / Esc / backdrop。
//   - showPromptDialog  → Promise<string | null>。入力 + Enter で確定、Esc で null。
//   - 多重起動は許容しない (既存ダイアログを閉じてから開く)。
import { isImeComposing } from "../core/keyboard";

const BACKDROP_CLASS = "gdp-dialog-backdrop";
const DIALOG_CLASS = "gdp-dialog";

function closeOpenDialog(): void {
  document.querySelector<HTMLElement>(`.${BACKDROP_CLASS}`)?.remove();
}

function createDialogShell(
  titleText: string | undefined,
  bodyText: string | undefined,
  actions: HTMLElement[],
): { backdrop: HTMLElement; body: HTMLElement } {
  closeOpenDialog();
  const backdrop = document.createElement("div");
  backdrop.className = BACKDROP_CLASS;
  const dialog = document.createElement("div");
  dialog.className = DIALOG_CLASS;
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  if (titleText) {
    const titleId = "gdp-dialog-title";
    dialog.setAttribute("aria-labelledby", titleId);
    const heading = document.createElement("div");
    heading.id = titleId;
    heading.className = "gdp-dialog-title";
    heading.textContent = titleText;
    dialog.appendChild(heading);
  }
  const bodyId = "gdp-dialog-body";
  dialog.setAttribute("aria-describedby", bodyId);
  const body = document.createElement("div");
  body.id = bodyId;
  body.className = "gdp-dialog-body";
  if (bodyText) body.textContent = bodyText;
  dialog.appendChild(body);
  const actionRow = document.createElement("div");
  actionRow.className = "gdp-dialog-actions";
  actionRow.append(...actions);
  dialog.appendChild(actionRow);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  return { backdrop, body };
}

// Tab / Shift+Tab の forward/backward を focusables 配列内で循環させる。
function trapTabKey(event: KeyboardEvent, focusables: HTMLElement[]): boolean {
  if (event.key !== "Tab") return false;
  const index = focusables.indexOf(document.activeElement as HTMLElement);
  if (index < 0) {
    event.preventDefault();
    focusables[0]?.focus();
    return true;
  }
  if (event.shiftKey && index <= 0) {
    event.preventDefault();
    focusables[focusables.length - 1]?.focus();
    return true;
  }
  if (!event.shiftKey && index === focusables.length - 1) {
    event.preventDefault();
    focusables[0]?.focus();
    return true;
  }
  return false;
}

export type ConfirmDialogOptions = {
  title?: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // 確認ボタンを破壊的アクション (赤系) として表示する。
  danger?: boolean;
  // ダイアログ閉じた後に focus を戻す要素。省略時は呼び出し時点の activeElement。
  focusReturnTarget?: HTMLElement | null;
};

export function showConfirmDialog(
  opts: ConfirmDialogOptions,
): Promise<boolean> {
  return new Promise((resolve) => {
    const previousFocus =
      opts.focusReturnTarget ?? (document.activeElement as HTMLElement | null);
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "gdp-btn gdp-btn-sm";
    cancel.textContent = opts.cancelLabel ?? "Cancel";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "gdp-btn gdp-btn-sm";
    if (opts.danger) confirm.classList.add("gdp-dialog-danger");
    confirm.textContent = opts.confirmLabel ?? "OK";
    const done = (ok: boolean) => {
      document.removeEventListener("keydown", onKeydown);
      closeOpenDialog();
      previousFocus?.focus?.();
      resolve(ok);
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (isImeComposing(event)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        done(false);
        return;
      }
      if (event.key === "Enter" && document.activeElement !== cancel) {
        event.preventDefault();
        done(true);
        return;
      }
      trapTabKey(event, [cancel, confirm]);
    };
    cancel.addEventListener("click", () => done(false));
    confirm.addEventListener("click", () => done(true));
    const { backdrop } = createDialogShell(opts.title, opts.body, [
      cancel,
      confirm,
    ]);
    backdrop.addEventListener("pointerdown", (event) => {
      if (event.target === backdrop) done(false);
    });
    document.addEventListener("keydown", onKeydown);
    confirm.focus();
  });
}

export type AlertDialogOptions = {
  title?: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
  focusReturnTarget?: HTMLElement | null;
};

// 通知系 (OK ボタンのみ)。window.alert の代替。
export function showAlertDialog(opts: AlertDialogOptions): Promise<void> {
  return new Promise((resolve) => {
    const previousFocus =
      opts.focusReturnTarget ?? (document.activeElement as HTMLElement | null);
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "gdp-btn gdp-btn-sm";
    if (opts.danger) ok.classList.add("gdp-dialog-danger");
    ok.textContent = opts.confirmLabel ?? "OK";
    const done = () => {
      document.removeEventListener("keydown", onKeydown);
      closeOpenDialog();
      previousFocus?.focus?.();
      resolve();
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (isImeComposing(event)) return;
      if (event.key === "Escape" || event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        done();
        return;
      }
      trapTabKey(event, [ok]);
    };
    ok.addEventListener("click", done);
    const { backdrop } = createDialogShell(opts.title, opts.body, [ok]);
    backdrop.addEventListener("pointerdown", (event) => {
      if (event.target === backdrop) done();
    });
    document.addEventListener("keydown", onKeydown);
    ok.focus();
  });
}

export type PromptDialogOptions = {
  title?: string;
  body?: string;
  defaultValue?: string;
  placeholder?: string;
  ariaLabel?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // 入力値を正規化 / 検証する。null を返したら無効 (Submit を無効化)、
  // 文字列を返したらそれを確定値とする。
  validate?: (value: string) => string | null;
  invalidMessage?: string;
  focusReturnTarget?: HTMLElement | null;
};

export function showPromptDialog(
  opts: PromptDialogOptions,
): Promise<string | null> {
  return new Promise((resolve) => {
    const previousFocus =
      opts.focusReturnTarget ?? (document.activeElement as HTMLElement | null);
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "gdp-btn gdp-btn-sm";
    cancel.textContent = opts.cancelLabel ?? "Cancel";
    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "gdp-btn gdp-btn-sm";
    submit.textContent = opts.confirmLabel ?? "OK";
    const input = document.createElement("input");
    input.className = "gdp-dialog-input";
    input.type = "text";
    input.autocomplete = "off";
    if (opts.placeholder) input.placeholder = opts.placeholder;
    if (opts.ariaLabel) input.setAttribute("aria-label", opts.ariaLabel);
    input.value = opts.defaultValue ?? "";
    const error = document.createElement("div");
    error.className = "gdp-dialog-error";
    error.setAttribute("role", "alert");
    const computeValid = (): string | null => {
      if (opts.validate) return opts.validate(input.value);
      return input.value;
    };
    const syncValidity = () => {
      const normalized = computeValid();
      const valid = normalized !== null && normalized !== "";
      submit.disabled = !valid;
      error.textContent =
        !valid && input.value && opts.invalidMessage ? opts.invalidMessage : "";
      return valid;
    };
    const done = (value: string | null) => {
      document.removeEventListener("keydown", onKeydown);
      closeOpenDialog();
      previousFocus?.focus?.();
      resolve(value);
    };
    const trySubmit = () => {
      const normalized = computeValid();
      if (normalized === null || normalized === "") {
        syncValidity();
        input.focus();
        return;
      }
      done(normalized);
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (isImeComposing(event)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        done(null);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        trySubmit();
        return;
      }
      trapTabKey(event, [input, cancel, submit]);
    };
    cancel.addEventListener("click", () => done(null));
    submit.addEventListener("click", trySubmit);
    input.addEventListener("input", syncValidity);
    const { body } = createDialogShell(opts.title, opts.body, [cancel, submit]);
    body.append(input, error);
    body.parentElement?.parentElement?.addEventListener(
      "pointerdown",
      (event) => {
        const target = event.target as HTMLElement | null;
        if (target?.classList.contains(BACKDROP_CLASS)) done(null);
      },
    );
    document.addEventListener("keydown", onKeydown);
    syncValidity();
    input.focus();
    if (input.value) input.select();
  });
}

export type FormDialogOptions<T> = {
  title?: string;
  body: HTMLElement;
  submit: () => T | Promise<T>;
  validate?: () => string | null;
  submitLabel?: string;
  cancelLabel?: string;
  // 確定ボタンを破壊的アクション (赤系) として表示する。
  danger?: boolean;
  focusTarget?: HTMLElement | null;
  focusReturnTarget?: HTMLElement | null;
};

export function showFormDialog<T>(
  opts: FormDialogOptions<T>,
): Promise<T | null> {
  return new Promise((resolve) => {
    const previousFocus =
      opts.focusReturnTarget ?? (document.activeElement as HTMLElement | null);
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "gdp-btn gdp-btn-sm";
    cancel.textContent = opts.cancelLabel ?? "Cancel";
    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "gdp-btn gdp-btn-sm";
    if (opts.danger) submit.classList.add("gdp-dialog-danger");
    submit.textContent = opts.submitLabel ?? "Save";
    const error = document.createElement("div");
    error.className = "gdp-dialog-error";
    error.setAttribute("role", "alert");
    let busy = false;

    const focusables = (): HTMLElement[] => [
      ...Array.from(
        opts.body.querySelectorAll<HTMLElement>(
          "input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), textarea:not([disabled]):not([hidden]), button:not([disabled]):not([hidden])",
        ),
      ).filter((element) => element.offsetParent !== null),
      cancel,
      submit,
    ];
    const done = (value: T | null) => {
      document.removeEventListener("keydown", onKeydown);
      closeOpenDialog();
      previousFocus?.focus?.();
      resolve(value);
    };
    const trySubmit = async () => {
      if (busy) return;
      const validationError = opts.validate?.() ?? null;
      if (validationError) {
        error.textContent = validationError;
        return;
      }
      busy = true;
      cancel.disabled = true;
      submit.disabled = true;
      error.textContent = "";
      try {
        done(await opts.submit());
      } catch (err) {
        busy = false;
        cancel.disabled = false;
        submit.disabled = false;
        error.textContent = err instanceof Error ? err.message : String(err);
      }
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (isImeComposing(event) || busy) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        done(null);
        return;
      }
      if (
        event.key === "Enter" &&
        !(document.activeElement instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault();
        if (
          document.activeElement instanceof HTMLButtonElement &&
          opts.body.contains(document.activeElement)
        ) {
          document.activeElement.click();
          return;
        }
        void trySubmit();
        return;
      }
      trapTabKey(event, focusables());
    };
    cancel.addEventListener("click", () => done(null));
    submit.addEventListener("click", () => void trySubmit());
    const { backdrop, body } = createDialogShell(opts.title, undefined, [
      cancel,
      submit,
    ]);
    body.append(opts.body, error);
    backdrop.addEventListener("pointerdown", (event) => {
      if (event.target === backdrop && !busy) done(null);
    });
    document.addEventListener("keydown", onKeydown);
    (opts.focusTarget ?? focusables()[0])?.focus();
  });
}
