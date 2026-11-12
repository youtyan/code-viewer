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
//
// 描き方: 開いている間の状態 (入力・押せるか・誤りの文言) は各 show* の中に持ち、
// 枠 (dialogTemplate) を重ね合わせの層 (views/ui/layer.ts) に描く。状態が変わったら
// layer.update() で描き直す。

import { ifDefined } from "lit/directives/if-defined.js";
import { live } from "lit/directives/live.js";
import { html, nothing, type TemplateResult } from "lit/html.js";
import { formatErrorDetail } from "../core/error-detail";
import { X_16_PATH } from "../core/icons";
import { isImeComposing } from "../core/keyboard";
import { pageLanguage } from "./page-language";
import { iconTemplate } from "./ui/icon";
import { createLayer } from "./ui/layer";

/** ボタンの既定の文言 (呼び出し側が渡さなかったとき)。 */
const DIALOG_TEXT = {
  en: { ok: "OK", cancel: "Cancel", save: "Save" },
  ja: { ok: "OK", cancel: "キャンセル", save: "保存" },
};

const BACKDROP_CLASS = "gdp-dialog-backdrop";
const DIALOG_CLASS = "gdp-dialog";
const TITLE_ID = "gdp-dialog-title";
const BODY_ID = "gdp-dialog-body";

const layer = createLayer("dialog");

type DialogButton = {
  label: string;
  /** gdp-dialog-cancel / gdp-dialog-confirm。 */
  role: "cancel" | "confirm";
  danger?: boolean;
  disabled?: boolean;
  onClick(): void;
};

type DialogFrame = {
  title?: string;
  /** 見出しの下の 1 文 (本文の前)。 */
  description?: string;
  /** 本文の文。 */
  bodyText?: string;
  /** 本文の文の後に置く中身 (入力の欄・呼び出し側の本文)。 */
  content?: unknown;
  wide?: boolean;
  buttons: DialogButton[];
  /** 右上の閉じる (取り消しと同じ扱い。Esc・背景を押すのと同じ)。説明は
   * 呼び出し側の取り消しのラベル (Cancel / キャンセル) をそのまま使う。 */
  close: { label: string; run(): void };
  /** 背景 (ダイアログの外) を押したとき。 */
  onBackdrop(): void;
};

function dialogTemplate(frame: DialogFrame): TemplateResult {
  return html`<div
    class=${BACKDROP_CLASS}
    @pointerdown=${(event: PointerEvent) => {
      if (event.target === event.currentTarget) frame.onBackdrop();
    }}
  >
    <div
      class=${frame.wide ? `${DIALOG_CLASS} gdp-dialog-wide` : DIALOG_CLASS}
      role="dialog"
      aria-modal="true"
      aria-labelledby=${ifDefined(frame.title ? TITLE_ID : undefined)}
      aria-describedby=${BODY_ID}
    >
      ${frame.title ? html`<div id=${TITLE_ID} class="gdp-dialog-title">${frame.title}</div>` : nothing}
      <button
        type="button"
        class="gdp-dialog-close"
        title=${frame.close.label}
        aria-label=${frame.close.label}
        tabindex="-1"
        @click=${() => frame.close.run()}
      >${iconTemplate(X_16_PATH, "octicon-x")}</button>
      ${frame.description ? html`<p class="gdp-dialog-description">${frame.description}</p>` : nothing}
      <div id=${BODY_ID} class="gdp-dialog-body">${frame.bodyText ?? nothing}${frame.content ?? nothing}</div>
      <div class="gdp-dialog-actions">${frame.buttons.map(
        (button) => html`<button
          type="button"
          class=${[
            "gdp-dialog-button",
            button.role === "cancel"
              ? "gdp-dialog-cancel"
              : "gdp-dialog-confirm",
            button.danger ? "gdp-dialog-danger" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          ?disabled=${!!button.disabled}
          @click=${() => button.onClick()}
        >${button.label}</button>`,
      )}</div>
    </div>
  </div>`;
}

/** 開いているダイアログの中の要素。 */
function inDialog<T extends Element>(selector: string): T | null {
  return layer.host()?.querySelector<T>(selector) ?? null;
}

function cancelButton(): HTMLButtonElement | null {
  return inDialog<HTMLButtonElement>(".gdp-dialog-cancel");
}

function confirmButton(): HTMLButtonElement | null {
  return inDialog<HTMLButtonElement>(".gdp-dialog-confirm");
}

// Tab / Shift+Tab の forward/backward を focusables 配列内で循環させる。
// 押せない部品 (値が正しくない間の確定など) は輪に入れない。入れると、その手前の
// 部品からの Tab がブラウザに任され、押せない部品を飛ばして dialog の外へ出た。
function trapTabKey(
  event: KeyboardEvent,
  candidates: (HTMLElement | null)[],
): boolean {
  if (event.key !== "Tab") return false;
  const focusables = candidates.filter(
    (element): element is HTMLElement =>
      !!element && !element.matches(":disabled") && !element.hidden,
  );
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
    const cancelLabel = opts.cancelLabel ?? DIALOG_TEXT[pageLanguage()].cancel;
    const done = (ok: boolean) => {
      document.removeEventListener("keydown", onKeydown);
      layer.hide();
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
      if (event.key === "Enter" && document.activeElement !== cancelButton()) {
        event.preventDefault();
        done(true);
        return;
      }
      trapTabKey(event, [cancelButton(), confirmButton()]);
    };
    layer.show(() =>
      dialogTemplate({
        title: opts.title,
        bodyText: opts.body,
        buttons: [
          { label: cancelLabel, role: "cancel", onClick: () => done(false) },
          {
            label: opts.confirmLabel ?? DIALOG_TEXT[pageLanguage()].ok,
            role: "confirm",
            danger: opts.danger,
            onClick: () => done(true),
          },
        ],
        close: { label: cancelLabel, run: () => done(false) },
        onBackdrop: () => done(false),
      }),
    );
    document.addEventListener("keydown", onKeydown);
    confirmButton()?.focus();
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
    const okLabel = opts.confirmLabel ?? DIALOG_TEXT[pageLanguage()].ok;
    const done = () => {
      document.removeEventListener("keydown", onKeydown);
      layer.hide();
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
      trapTabKey(event, [confirmButton()]);
    };
    layer.show(() =>
      dialogTemplate({
        title: opts.title,
        bodyText: opts.body,
        buttons: [
          {
            label: okLabel,
            role: "confirm",
            danger: opts.danger,
            onClick: done,
          },
        ],
        close: { label: okLabel, run: done },
        onBackdrop: done,
      }),
    );
    document.addEventListener("keydown", onKeydown);
    confirmButton()?.focus();
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
    const cancelLabel = opts.cancelLabel ?? DIALOG_TEXT[pageLanguage()].cancel;
    let value = opts.defaultValue ?? "";
    let valid = false;
    let errorText = "";
    const input = () => inDialog<HTMLInputElement>(".gdp-dialog-input");
    const computeValid = (): string | null => {
      if (opts.validate) return opts.validate(value);
      return value;
    };
    const syncValidity = () => {
      const normalized = computeValid();
      valid = normalized !== null && normalized !== "";
      errorText =
        !valid && value && opts.invalidMessage ? opts.invalidMessage : "";
      layer.update();
      return valid;
    };
    const done = (result: string | null) => {
      document.removeEventListener("keydown", onKeydown);
      layer.hide();
      previousFocus?.focus?.();
      resolve(result);
    };
    const trySubmit = () => {
      const normalized = computeValid();
      if (normalized === null || normalized === "") {
        syncValidity();
        input()?.focus();
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
      trapTabKey(event, [input(), cancelButton(), confirmButton()]);
    };
    layer.show(() =>
      dialogTemplate({
        title: opts.title,
        bodyText: opts.body,
        content: html`<input
            class="gdp-dialog-input"
            type="text"
            autocomplete="off"
            placeholder=${ifDefined(opts.placeholder || undefined)}
            aria-label=${ifDefined(opts.ariaLabel || undefined)}
            .value=${live(value)}
            @input=${(event: Event) => {
              value = (event.target as HTMLInputElement).value;
              syncValidity();
            }}
          /><div class="gdp-dialog-error" role="alert">${errorText}</div>`,
        buttons: [
          { label: cancelLabel, role: "cancel", onClick: () => done(null) },
          {
            label: opts.confirmLabel ?? DIALOG_TEXT[pageLanguage()].ok,
            role: "confirm",
            disabled: !valid,
            onClick: trySubmit,
          },
        ],
        close: { label: cancelLabel, run: () => done(null) },
        onBackdrop: () => done(null),
      }),
    );
    document.addEventListener("keydown", onKeydown);
    syncValidity();
    const field = input();
    field?.focus();
    if (field?.value) field.select();
  });
}

export type FormDialogOptions<T> = {
  title?: string;
  /** 見出しの下の 1 文 (何をする画面か)。 */
  description?: string;
  /** 本文 (要素かテンプレート)。 */
  /** 本文 (要素かテンプレート。view が描いたもの)。 */
  body: unknown;
  submit: () => T | Promise<T>;
  validate?: () => string | null;
  submitLabel?: string;
  cancelLabel?: string;
  // 確定ボタンを破壊的アクション (赤系) として表示する。
  danger?: boolean;
  focusTarget?: HTMLElement | null;
  /** 確定の操作が無い画面 (読むだけ、または本文のボタンで済む)。cancelLabel の
   * ボタン 1 つだけを出し、Enter も閉じるだけにする。 */
  closeOnly?: boolean;
  /** focusTarget が無いとき、本文のボタンではなく［取り消し］に最初の焦点を置く
   * (本文に副作用のあるボタンがあり、Enter で押されては困るとき)。 */
  focusCancel?: boolean;
  focusReturnTarget?: HTMLElement | null;
  /** 本文に整形済みの長い中身 (JSON など) を出すとき、横幅を広げる。 */
  wide?: boolean;
};

const FOCUSABLE_IN_BODY =
  'input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), textarea:not([disabled]):not([hidden]), button:not([disabled]):not([hidden]), a[href]:not([hidden]), [tabindex]:not([tabindex="-1"]):not([disabled]):not([hidden])';

export function showFormDialog<T>(
  opts: FormDialogOptions<T>,
): Promise<T | null> {
  return new Promise((resolve) => {
    const previousFocus =
      opts.focusReturnTarget ?? (document.activeElement as HTMLElement | null);
    const cancelLabel = opts.cancelLabel ?? DIALOG_TEXT[pageLanguage()].cancel;
    let busy = false;
    let errorText = "";

    const body = () => inDialog<HTMLElement>(".gdp-dialog-body");
    const focusables = (): HTMLElement[] => [
      ...Array.from(
        body()?.querySelectorAll<HTMLElement>(FOCUSABLE_IN_BODY) ?? [],
      ).filter((element) => element.offsetParent !== null),
      ...(cancelButton() ? [cancelButton() as HTMLElement] : []),
      ...(opts.closeOnly || !confirmButton()
        ? []
        : [confirmButton() as HTMLElement]),
    ];
    const done = (value: T | null) => {
      document.removeEventListener("keydown", onKeydown);
      layer.hide();
      previousFocus?.focus?.();
      resolve(value);
    };
    const trySubmit = async () => {
      if (busy) return;
      if (opts.closeOnly) {
        done(null);
        return;
      }
      const validationError = opts.validate?.() ?? null;
      if (validationError) {
        errorText = validationError;
        layer.update();
        return;
      }
      busy = true;
      errorText = "";
      layer.update();
      try {
        done(await opts.submit());
      } catch (err) {
        busy = false;
        console.error("[code-viewer] dialog submit failed", err);
        errorText = formatErrorDetail(err);
        layer.update();
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
        // 本文のボタンとリンクは押す (リンクの上の Enter で保存しない)。
        if (
          (document.activeElement instanceof HTMLButtonElement ||
            document.activeElement instanceof HTMLAnchorElement) &&
          body()?.contains(document.activeElement)
        ) {
          document.activeElement.click();
          return;
        }
        void trySubmit();
        return;
      }
      trapTabKey(event, focusables());
    };
    const cancelButtonSpec: DialogButton = {
      label: cancelLabel,
      role: "cancel",
      onClick: () => done(null),
    };
    layer.show(() =>
      dialogTemplate({
        title: opts.title,
        description: opts.description,
        content: html`${opts.body}<div class="gdp-dialog-error" role="alert">${errorText}</div>`,
        wide: opts.wide,
        buttons: opts.closeOnly
          ? [{ ...cancelButtonSpec, disabled: busy }]
          : [
              { ...cancelButtonSpec, disabled: busy },
              {
                label: opts.submitLabel ?? DIALOG_TEXT[pageLanguage()].save,
                role: "confirm",
                danger: opts.danger,
                disabled: busy,
                onClick: () => void trySubmit(),
              },
            ],
        close: {
          label: cancelLabel,
          run: () => {
            if (!busy) done(null);
          },
        },
        onBackdrop: () => {
          if (!busy) done(null);
        },
      }),
    );
    document.addEventListener("keydown", onKeydown);
    (
      opts.focusTarget ?? (opts.focusCancel ? cancelButton() : focusables()[0])
    )?.focus();
  });
}
