// 最下段の左端の、アカウントごとの使用量と、押すと開くポップオーバー。
//
//   ◇ claude  42% · resets 1h58m   ◇ codex  91% High
//
//   ┌ Account usage                       ⟳ ┐
//   │ claude · Default        as of 15m ago │
//   │ 5h    42%        ▰▰▱▱▱  resets in 1h58m│
//   │ week  81% High   ▰▰▰▰▱  resets in 2d23h│
//   │ codex · Personal     Checked just now │
//   │ Not signed in                 Sign in │
//   │ Manage accounts →                     │
//   └────────────────────────────────────────┘
//
// 値はアカウントの一覧 (accounts-client) をそのまま使う。最下段には 1 アカウント
// 1 つの塊で最初の枠 (5 時間枠があればそれ) だけを出し、全部の枠と「いつの値か」は
// ポップオーバーに出す (古い値を今の値のように見せない)。80% 以上は「注意」の
// 文字と琥珀色 (色だけに頼らない)。使用量と作業の状態は別の情報なので、状態の
// 印は付けない。未ログインには値を作らない (0% や空のバーで代用しない)。
//
// 最下段に出すのは値が読めたアカウントだけ (読めないものの理由はポップオーバーと
// 全体ボードのカードに出る)。Esc・外側のクリックで閉じる。

import {
  type AccountStatus,
  usageIsStale,
  usageWindowViews,
} from "../../core/agent-accounts";
import { formatErrorDetail } from "../../core/error-detail";
import { createLayer } from "../ui/layer";
import { createRenderer, setAttributeIfChanged } from "../ui/renderer";
import type { AccountsClient } from "./accounts-client";
import { accountDisplayName } from "./accounts-dialogs";
import type { AgentsText } from "./i18n";
import {
  usageMeterTemplate,
  usageMixedText,
  usageObservedText,
} from "./usage-meter";
import {
  DEFAULT_VIEW,
  type UsageItemProps,
  type UsagePopoverAccount,
  type UsagePopoverProps,
  type UsageStatusView,
} from "./usage-status-view";

export type UsageStatusDeps = {
  root: HTMLElement;
  /** 使うのは一覧・購読・取り直しだけ。 */
  client: Pick<AccountsClient, "snapshot" | "subscribe" | "load">;
  getText(): AgentsText;
  openSettings(): void;
  /** 公式のログインを tmux で開く。戻り値は結果の文。 */
  login(account: AccountStatus): Promise<string>;
  /** 全体ボード (アカウントのカードのある画面) へ移る。 */
  openBoard(): void;
};

export type UsageStatus = {
  localize(): void;
  /** ポップオーバーが開いているか (テストと外からの確認用)。 */
  isOpen(): boolean;
};

export function createUsageStatusPresenter(
  deps: UsageStatusDeps,
  view: UsageStatusView = DEFAULT_VIEW,
): UsageStatus {
  const { root } = deps;
  let lastSignature = "";
  let open = false;
  let cleanup: (() => void) | null = null;
  /** ポップオーバーを開いたボタンの位置 (閉じたらそこへフォーカスを戻す)。 */
  let openerIndex = -1;
  let busy = false;
  let message: { ok: boolean; text: string } | null = null;
  let position: UsagePopoverProps["position"] = null;
  let items: UsageItemProps[] = [];
  const renderer = createRenderer(root, () =>
    view.items({
      label: deps.getText().sidebar.usageLabel,
      items,
      onToggle(id) {
        if (open) {
          close();
          return;
        }
        openPopover(items.findIndex((item) => item.id === id));
      },
    }),
  );
  const popover = createLayer("usage-popover");

  function itemProps(
    account: AccountStatus,
    now: number,
  ): UsageItemProps | null {
    if (account.usage.status !== "ok") return null;
    const text = deps.getText();
    const t = text.accounts;
    const views = usageWindowViews(account.usage, now);
    const [first] = views;
    if (!first) return null;
    const warnView = views.find((view) => view.warn);
    const mixed = usageMixedText(account.usage, now, t);
    const observed = usageObservedText(account.usage, account.login, now, t);
    const lines = [
      `${account.agent} · ${accountDisplayName(account, t)}`,
      ...usageWindowViews(account.usage, now).map((view) =>
        [
          t.window(view.window),
          view.warn ? t.warn : "",
          view.expired
            ? t.resetPassed
            : view.window.resetsAt > 0
              ? t.resetsIn(t.duration(view.window.resetsAt - now))
              : "",
        ]
          .filter(Boolean)
          .join(" · "),
      ),
      [observed.text, observed.title].filter(Boolean).join(" · "),
      mixed,
      t.usagePopoverOpen,
    ].filter(Boolean);
    return {
      id: account.id,
      kind: account.builtin
        ? account.agent
        : `${account.agent} · ${accountDisplayName(account, t)}`,
      warn: warnView !== undefined,
      stale: usageIsStale(account.usage.observedAt, now),
      expanded: open,
      // 枠は全部出す (claude は 5h と週の 2 つ。片方だけだと週の上限に気付けない)。
      windows: views.map((view) => ({
        name: t.windowName(view.window),
        value: `${Math.round(view.window.usedPercent)}%`,
        warn: view.warn,
      })),
      mixed: mixed ? t.usageMixed : null,
      warnLabel: warnView ? t.warn : null,
      reset:
        !warnView && !first.expired && first.window.resetsAt > 0
          ? t.resetsIn(t.duration(first.window.resetsAt - now))
          : null,
      title: text.sidebar.usageTitle(lines),
      ariaLabel: lines.join(", "),
    };
  }

  function render(force = false): void {
    const { data } = deps.client.snapshot();
    const now = Date.now();
    const next = JSON.stringify([
      deps.getText().sidebar.usageLabel,
      data?.accounts.map((account) => [
        account.id,
        account.name,
        account.usage,
      ]),
      open,
      // リセットまでの時間は分単位で変わる。
      Math.floor(now / 60_000),
    ]);
    if (!force && next === lastSignature) return;
    lastSignature = next;
    setAttributeIfChanged(
      root,
      "aria-label",
      deps.getText().sidebar.usageLabel,
    );
    items = (data?.accounts ?? [])
      .map((account) => itemProps(account, now))
      .filter((item): item is UsageItemProps => item !== null);
    // 閉じたあとに同じ位置のボタンへフォーカスを戻すので、いまここで描く。
    renderer.flush();
  }

  /** 1 アカウントのまとまり。 */
  function accountProps(
    account: AccountStatus,
    now: number,
  ): UsagePopoverAccount {
    const t = deps.getText().accounts;
    const name = `${account.agent} · ${accountDisplayName(account, t)}`;
    const observed = usageObservedText(account.usage, account.login, now, t);
    if (account.login.state === "logged-out")
      return {
        kind: "logged-out",
        name,
        observed,
        status: t.login["logged-out"],
        hint: t.loggedOutHint,
        login: {
          label: t.loginButton,
          title: t.loginTitle(accountDisplayName(account, t)),
          disabled: busy,
        },
        onLogin: () => void run(() => deps.login(account)),
      };
    const usage = account.usage;
    if (usage.status !== "ok")
      return {
        kind: "unavailable",
        name,
        observed,
        status: t.usageUnavailable,
        why: [t.usageReason[usage.reason], usage.detail]
          .filter(Boolean)
          .join(" "),
        // 包んでいない: 有効にするボタンはカードにある。そこへ移る。
        enable:
          usage.reason === "not-wrapped" ? `${t.usagePopoverEnable} →` : null,
        onEnable() {
          close();
          deps.openBoard();
        },
      };
    const mixed = usageMixedText(usage, now, t);
    return {
      kind: "usage",
      name,
      observed,
      meters: usageWindowViews(usage, now).map((view) =>
        usageMeterTemplate(view, now, t, { reset: "remaining" }),
      ),
      mixed: mixed || null,
    };
  }

  async function run(action: () => Promise<string>): Promise<void> {
    if (busy) return;
    busy = true;
    message = null;
    renderPanel();
    try {
      message = { ok: true, text: await action() };
    } catch (error) {
      console.error("[code-viewer] usage popover action failed", error);
      message = {
        ok: false,
        text: formatErrorDetail(error),
      };
    } finally {
      busy = false;
      renderPanel();
    }
  }

  function popoverProps(): UsagePopoverProps {
    const t = deps.getText().accounts;
    const { data, error } = deps.client.snapshot();
    const now = Date.now();
    return {
      label: t.usagePopoverTitle,
      title: t.usagePopoverTitle,
      refresh: { label: t.usagePopoverRefresh, busy },
      error: error ? `${t.bandLoadFailed}\n${error}` : null,
      loading: !data && !error ? t.loading : null,
      accounts: (data?.accounts ?? []).map((account) =>
        accountProps(account, now),
      ),
      message,
      manage: t.usagePopoverManage,
      position,
      onKeydown(event) {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        close();
      },
      onRefresh() {
        void run(async () => {
          await deps.client.load({ refreshLogin: true });
          const failure = deps.client.snapshot().error;
          if (failure) throw new Error(`${t.bandLoadFailed}\n${failure}`);
          return "";
        });
      },
      onManage() {
        close();
        deps.openSettings();
      },
    };
  }

  function panel(): HTMLElement | null {
    return popover.host()?.querySelector<HTMLElement>(".usage-popover") ?? null;
  }

  function renderPanel(): void {
    if (!open) return;
    popover.update();
  }

  function place(): void {
    const element = panel();
    if (!element) return;
    const anchor = root.getBoundingClientRect();
    const tokenEdge = Number.parseFloat(
      getComputedStyle(document.body).getPropertyValue("--space-4"),
    );
    const head = element.querySelector<HTMLElement>(".usage-popover-head");
    const computedEdge = head
      ? Number.parseFloat(getComputedStyle(head).paddingLeft)
      : Number.NaN;
    const edge = Number.isFinite(tokenEdge) ? tokenEdge : computedEdge;
    if (!Number.isFinite(edge)) {
      throw new Error("usage popover viewport inset is not a finite length");
    }
    const panelWidth = element.getBoundingClientRect().width;
    const rightmost = window.innerWidth - panelWidth - edge;
    position = {
      left: Math.max(edge, Math.min(anchor.left, rightmost)),
      bottom: Math.max(0, window.innerHeight - anchor.top),
    };
    popover.update();
  }

  function openPopover(index: number): void {
    if (open) return;
    open = true;
    openerIndex = index;
    message = null;
    position = null;
    popover.show(() => view.popover(popoverProps()));
    place();
    render(true);
    const unsubscribe = deps.client.subscribe(renderPanel);
    const onPointerDown = (event: Event) => {
      const target = event.target as Node;
      if (panel()?.contains(target) || root.contains(target)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", place);
    cleanup = () => {
      unsubscribe();
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", place);
    };
    panel()?.querySelector<HTMLElement>(".usage-popover-refresh")?.focus();
  }

  function close(): void {
    if (!open) return;
    cleanup?.();
    cleanup = null;
    open = false;
    popover.hide();
    // 開いたボタンと同じ位置のものへ戻す。
    const index = openerIndex;
    openerIndex = -1;
    render(true);
    root
      .querySelectorAll<HTMLElement>(".usage-status-item")
      [Math.max(0, index)]?.focus();
  }

  deps.client.subscribe(() => render());
  // 取り直しが無い間も、リセットまでの時間は進む。
  window.setInterval(() => {
    render();
    renderPanel();
  }, 60_000);
  render(true);
  return {
    localize: () => {
      render(true);
      renderPanel();
    },
    isOpen: () => open,
  };
}
