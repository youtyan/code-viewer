// 窓の中の知らせ。見ていないペインが入力待ち・完了になったとき、窓が前面なら
// 画面の右下に出し、押すとそのペインを開く (OS の通知の代わり。どちらに出すかは
// core/agent-overview.ts の agentAlertPlace、出すのは agent-monitor.ts)。
//
// 前面で作業している人には OS の通知の帯が届きにくく、押してもタブを探すことに
// なる。窓の中なら押せばその場で開く。しばらくすると消え、× でも閉じる。同じ
// ペインの同じ変化は 1 枚に畳む (OS の通知の tag と同じ)。

import { html, nothing } from "lit/html.js";
import type { AgentTransition } from "../../core/agent-overview";
import { X_16_PATH } from "../../core/icons";
import { iconTemplate } from "../ui/icon";
import { createRenderer, templateElement } from "../ui/renderer";

/** 出しておく時間。 */
export const ATTENTION_TOAST_MS = 8000;
/** 同時に出す数 (古いものから消す)。 */
export const ATTENTION_TOAST_LIMIT = 3;

export type AttentionToast = {
  /** ペインと変化の組 (同じものは 1 枚に畳む)。 */
  key: string;
  pane: string;
  transition: AgentTransition;
  title: string;
  body: string;
};

export type AttentionToastViewProps = {
  toasts: AttentionToast[];
  closeLabel: string;
  onOpen(key: string): void;
  onClose(key: string): void;
};

export type AttentionToastView = (props: AttentionToastViewProps) => unknown;

export const DEFAULT_VIEW: AttentionToastView = (props) =>
  props.toasts.length === 0
    ? nothing
    : html`<div class="attention-toasts" role="status" aria-live="polite">${props.toasts.map(
        (toast) =>
          html`<div class="attention-toast" data-transition=${toast.transition}><button
              type="button"
              class="attention-toast-open"
              @click=${() => props.onOpen(toast.key)}
            ><span class="attention-toast-title">${toast.title}</span><span
                class="attention-toast-body"
              >${toast.body}</span></button
            ><button
              type="button"
              class="attention-toast-close"
              title=${props.closeLabel}
              aria-label=${props.closeLabel}
              @click=${() => props.onClose(toast.key)}
            >${iconTemplate(X_16_PATH)}</button></div>`,
      )}</div>`;

export type AttentionToastsDeps = {
  /** × の名前 (いまの言語)。 */
  closeLabel(): string;
  /** 押した。そのペインを開く。 */
  open(pane: string): void;
};

export type AttentionToasts = {
  show(toast: Omit<AttentionToast, "key">): void;
  dispose(): void;
};

export function createAttentionToasts(
  deps: AttentionToastsDeps,
  view: AttentionToastView = DEFAULT_VIEW,
): AttentionToasts {
  const host = templateElement(html`<div class="attention-toast-host"></div>`);
  document.body.append(host);
  let toasts: AttentionToast[] = [];
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const renderer = createRenderer(host, () =>
    view({
      toasts,
      closeLabel: deps.closeLabel(),
      onOpen(key) {
        const toast = toasts.find((item) => item.key === key);
        remove(key);
        if (toast) deps.open(toast.pane);
      },
      onClose: remove,
    }),
  );

  function forget(key: string): void {
    const timer = timers.get(key);
    if (timer) clearTimeout(timer);
    timers.delete(key);
  }

  function remove(key: string): void {
    forget(key);
    toasts = toasts.filter((item) => item.key !== key);
    renderer.request();
  }

  return {
    show(next) {
      const key = `${next.pane}:${next.transition}`;
      forget(key);
      const kept = [
        ...toasts.filter((item) => item.key !== key),
        { ...next, key },
      ];
      for (const dropped of kept.slice(0, -ATTENTION_TOAST_LIMIT))
        forget(dropped.key);
      toasts = kept.slice(-ATTENTION_TOAST_LIMIT);
      timers.set(
        key,
        setTimeout(() => remove(key), ATTENTION_TOAST_MS),
      );
      renderer.request();
    },
    dispose() {
      for (const key of [...timers.keys()]) forget(key);
      toasts = [];
      host.remove();
    },
  };
}
