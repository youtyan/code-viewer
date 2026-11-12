// 最下段の使用量の欄と、押すと開くポップオーバーの表示。usage-status.ts
// (presenter) が渡す値だけから描く。

import { html, nothing, type TemplateResult } from "lit/html.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { SYNC_16_PATH } from "../../core/icons";
import { iconTemplate } from "../ui/icon";

export type UsageItemProps = {
  id: string;
  kind: string;
  warn: boolean;
  stale: boolean;
  expanded: boolean;
  windows: { name: string; value: string; warn: boolean }[];
  mixed: string | null;
  warnLabel: string | null;
  reset: string | null;
  title: string;
  ariaLabel: string;
};

export type UsagePopoverAccount =
  | {
      kind: "logged-out";
      name: string;
      observed: { text: string; title: string; stale: boolean };
      status: string;
      hint: string;
      login: { label: string; title: string; disabled: boolean };
      onLogin(): void;
    }
  | {
      kind: "unavailable";
      name: string;
      observed: { text: string; title: string; stale: boolean };
      status: string;
      why: string;
      enable: string | null;
      onEnable(): void;
    }
  | {
      kind: "usage";
      name: string;
      observed: { text: string; title: string; stale: boolean };
      meters: TemplateResult[];
      mixed: string | null;
    };

export type UsagePopoverProps = {
  label: string;
  title: string;
  refresh: { label: string; busy: boolean };
  error: string | null;
  loading: string | null;
  accounts: UsagePopoverAccount[];
  message: { ok: boolean; text: string } | null;
  manage: string;
  position: { left: number; bottom: number } | null;
  onKeydown(event: KeyboardEvent): void;
  onRefresh(): void;
  onManage(): void;
};

export type UsageStatusViewProps = {
  label: string;
  items: UsageItemProps[];
  onToggle(id: string, event: Event): void;
};

export type UsageStatusView = {
  items(props: UsageStatusViewProps): unknown;
  popover(props: UsagePopoverProps): unknown;
};

function itemTemplate(
  props: UsageStatusViewProps,
  item: UsageItemProps,
): TemplateResult {
  const cls = [
    "usage-status-item",
    item.warn ? "warn" : "",
    item.stale ? "stale" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return html`<button
    type="button"
    class=${cls}
    aria-haspopup="dialog"
    aria-expanded=${String(item.expanded)}
    title=${item.title}
    aria-label=${item.ariaLabel}
    @click=${(event: Event) => props.onToggle(item.id, event)}
    @keydown=${(event: KeyboardEvent) => {
      // 画面全体のキー操作が Enter の既定の動作 (click) を止めるので、キーで開く
      // ときはここで受ける (全体ボードの行と同じ扱い)。
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      props.onToggle(item.id, event);
    }}
  ><span class="usage-status-kind">${item.kind}</span>${item.windows.map(
    (window) =>
      html`<span class=${window.warn ? "usage-status-window warn" : "usage-status-window"}
        ><span class="usage-status-window-name">${window.name}</span><span
          class="usage-status-value"
        >${window.value}</span></span
      >`,
  )}${item.mixed ? html`<span class="usage-status-mixed">${item.mixed}</span>` : nothing}${
    item.warnLabel
      ? html`<span class="usage-status-warn">${item.warnLabel}</span>`
      : item.reset
        ? html`<span class="usage-status-reset">${item.reset}</span>`
        : nothing
  }</button>`;
}

function accountTemplate(account: UsagePopoverAccount): TemplateResult {
  const head = html`<div class="usage-popover-account-head"><span
      class="usage-popover-account-name"
    >${account.name}</span><span
      class=${account.observed.stale ? "usage-popover-observed stale" : "usage-popover-observed"}
      title=${ifDefined(account.observed.title || undefined)}
    >${account.observed.text}</span></div>`;
  if (account.kind === "logged-out")
    return html`<section class="usage-popover-account">${head}<div
        class="usage-popover-login"
      ><div class="usage-popover-login-words"><span class="usage-popover-status"
            >${account.status}</span
          ><span class="usage-popover-hint">${account.hint}</span></div
        ><button
          type="button"
          class="usage-popover-link"
          title=${account.login.title}
          ?disabled=${account.login.disabled}
          @click=${() => account.onLogin()}
        >${account.login.label}</button></div></section>`;
  if (account.kind === "unavailable")
    return html`<section class="usage-popover-account">${head}<div
        class="usage-popover-status"
      >${account.status}</div><div class="usage-popover-hint">${account.why}</div>${
        account.enable
          ? html`<button
              type="button"
              class="usage-popover-link usage-popover-enable"
              @click=${() => account.onEnable()}
            >${account.enable}</button>`
          : nothing
      }</section>`;
  return html`<section class="usage-popover-account">${head}${account.meters}${
    account.mixed
      ? html`<div class="usage-popover-hint usage-popover-mixed">${account.mixed}</div>`
      : nothing
  }</section>`;
}

function popoverTemplate(props: UsagePopoverProps): TemplateResult {
  const style = props.position
    ? `left: ${props.position.left}px; bottom: ${props.position.bottom}px;`
    : undefined;
  return html`<div
    class="usage-popover"
    role="dialog"
    tabindex="-1"
    aria-label=${props.label}
    style=${ifDefined(style)}
    @keydown=${(event: KeyboardEvent) => props.onKeydown(event)}
  ><div class="usage-popover-head"><strong class="usage-popover-title">${props.title}</strong><button
    type="button"
    class="agents-icon-action usage-popover-refresh"
    title=${props.refresh.label}
    aria-label=${props.refresh.label}
    ?disabled=${props.refresh.busy}
    aria-busy=${String(props.refresh.busy)}
    @click=${() => props.onRefresh()}
  >${iconTemplate(SYNC_16_PATH, "octicon-sync")}</button></div><div class="usage-popover-body">${
    props.error
      ? html`<div class="usage-popover-error">${props.error}</div>`
      : nothing
  }${props.accounts.map(accountTemplate)}${
    props.loading
      ? html`<div class="usage-popover-hint">${props.loading}</div>`
      : nothing
  }</div>${
    props.message?.text
      ? html`<div class=${props.message.ok ? "usage-popover-result" : "usage-popover-error"}>${props.message.text}</div>`
      : nothing
  }<button type="button" class="usage-popover-manage" @click=${() => props.onManage()}><span
    class=""
  >${props.manage}</span><span class="">→</span></button></div>`;
}

export const DEFAULT_VIEW: UsageStatusView = {
  items: (props) => props.items.map((item) => itemTemplate(props, item)),
  popover: popoverTemplate,
};
