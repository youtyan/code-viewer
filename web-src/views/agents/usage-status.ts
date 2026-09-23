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
import { iconSvg, SYNC_16_PATH } from "../../core/icons";
import type { AccountsClient } from "./accounts-client";
import { accountDisplayName, el } from "./accounts-dialogs";
import type { AgentsText } from "./i18n";
import {
  usageMeterRow,
  usageMixedText,
  usageObservedText,
} from "./usage-meter";

export type UsageStatusDeps = {
  root: HTMLElement;
  /** 使うのは一覧・購読・取り直しだけ。 */
  client: Pick<AccountsClient, "snapshot" | "subscribe" | "load">;
  getText(): AgentsText;
  openSettings(): void;
  /** 公式のログインを tmux で開く。戻り値は結果の文。 */
  login(account: AccountStatus): Promise<string>;
};

export type UsageStatus = {
  localize(): void;
  /** ポップオーバーが開いているか (テストと外からの確認用)。 */
  isOpen(): boolean;
};

export function mountUsageStatus(deps: UsageStatusDeps): UsageStatus {
  const { root } = deps;
  let lastSignature = "";
  let panel: HTMLElement | null = null;
  let cleanup: (() => void) | null = null;
  /** ポップオーバーを開いたボタン (閉じたらそこへフォーカスを戻す)。 */
  let opener: HTMLElement | null = null;
  let busy = false;
  let message: { ok: boolean; text: string } | null = null;

  function item(account: AccountStatus, now: number): HTMLElement | null {
    if (account.usage.status !== "ok") return null;
    const text = deps.getText();
    const t = text.accounts;
    const views = usageWindowViews(account.usage, now);
    const [first] = views;
    if (!first) return null;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "usage-status-item";
    const warnView = views.find((view) => view.warn);
    button.classList.toggle("warn", warnView !== undefined);
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", String(panel !== null));
    const kind = document.createElement("span");
    kind.className = "usage-status-kind";
    kind.textContent = account.builtin
      ? account.agent
      : `${account.agent} · ${accountDisplayName(account, t)}`;
    button.appendChild(kind);
    // 枠は全部出す (claude は 5h と週の 2 つ。片方だけだと週の上限に気付けない)。
    for (const view of views) {
      const windowEl = document.createElement("span");
      windowEl.className = "usage-status-window";
      windowEl.classList.toggle("warn", view.warn);
      const name = document.createElement("span");
      name.className = "usage-status-window-name";
      name.textContent = t.windowName(view.window);
      const value = document.createElement("span");
      value.className = "usage-status-value";
      value.textContent = `${Math.round(view.window.usedPercent)}%`;
      windowEl.append(name, value);
      button.appendChild(windowEl);
    }
    const mixed = usageMixedText(account.usage, now, t);
    if (mixed) {
      const mark = document.createElement("span");
      mark.className = "usage-status-mixed";
      mark.textContent = t.usageMixed;
      button.appendChild(mark);
    }
    if (warnView) {
      const warn = document.createElement("span");
      warn.className = "usage-status-warn";
      warn.textContent = t.warn;
      button.appendChild(warn);
    } else if (!first.expired && first.window.resetsAt > 0) {
      const reset = document.createElement("span");
      reset.className = "usage-status-reset";
      reset.textContent = t.resetsIn(t.duration(first.window.resetsAt - now));
      button.appendChild(reset);
    }
    const observed = usageObservedText(account.usage, account.login, now, t);
    button.classList.toggle(
      "stale",
      usageIsStale(account.usage.observedAt, now),
    );
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
    button.title = text.sidebar.usageTitle(lines);
    button.setAttribute("aria-label", lines.join(", "));
    const toggle = () => {
      if (panel) {
        close();
        return;
      }
      open(button);
    };
    button.addEventListener("click", toggle);
    // 画面全体のキー操作が Enter の既定の動作 (click) を止めるので、キーで開く
    // ときはここで受ける (全体ボードの行と同じ扱い)。
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      toggle();
    });
    return button;
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
      panel !== null,
      // リセットまでの時間は分単位で変わる。
      Math.floor(now / 60_000),
    ]);
    if (!force && next === lastSignature) return;
    lastSignature = next;
    root.setAttribute("aria-label", deps.getText().sidebar.usageLabel);
    root.replaceChildren(
      ...(data?.accounts ?? [])
        .map((account) => item(account, now))
        .filter((node): node is HTMLElement => node !== null),
    );
  }

  /** 1 アカウントのまとまり。 */
  function accountBlock(account: AccountStatus, now: number): HTMLElement {
    const t = deps.getText().accounts;
    const block = el("section", "usage-popover-account");
    const head = el("div", "usage-popover-account-head");
    const name = el(
      "span",
      "usage-popover-account-name",
      `${account.agent} · ${accountDisplayName(account, t)}`,
    );
    const observed = usageObservedText(account.usage, account.login, now, t);
    const when = el(
      "span",
      `usage-popover-observed${observed.stale ? " stale" : ""}`,
      observed.text,
    );
    if (observed.title) when.title = observed.title;
    head.append(name, when);
    block.appendChild(head);

    if (account.login.state === "logged-out") {
      const row = el("div", "usage-popover-login");
      const words = el("div", "usage-popover-login-words");
      words.append(
        el("span", "usage-popover-status", t.login["logged-out"]),
        el("span", "usage-popover-hint", t.loggedOutHint),
      );
      const login = el("button", "usage-popover-link", t.loginButton);
      login.type = "button";
      login.title = t.loginTitle(accountDisplayName(account, t));
      login.disabled = busy;
      login.addEventListener("click", () => {
        void run(() => deps.login(account));
      });
      row.append(words, login);
      block.appendChild(row);
      return block;
    }
    const usage = account.usage;
    if (usage.status !== "ok") {
      const line = el("div", "usage-popover-status", t.usageUnavailable);
      const why = el(
        "div",
        "usage-popover-hint",
        [t.usageReason[usage.reason], usage.detail].filter(Boolean).join(" "),
      );
      block.append(line, why);
      return block;
    }
    for (const view of usageWindowViews(usage, now)) {
      block.appendChild(usageMeterRow(view, now, t, { showReset: true }));
    }
    const mixed = usageMixedText(usage, now, t);
    if (mixed) {
      block.appendChild(
        el("div", "usage-popover-hint usage-popover-mixed", mixed),
      );
    }
    return block;
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

  function renderPanel(): void {
    if (!panel) return;
    const text = deps.getText();
    const t = text.accounts;
    const { data, error } = deps.client.snapshot();
    const now = Date.now();
    const focusedClass =
      document.activeElement instanceof HTMLElement &&
      panel.contains(document.activeElement)
        ? document.activeElement.className
        : null;
    panel.setAttribute("aria-label", t.usagePopoverTitle);
    const head = el("div", "usage-popover-head");
    const title = el("strong", "usage-popover-title", t.usagePopoverTitle);
    const refresh = el("button", "agents-icon-action usage-popover-refresh");
    refresh.type = "button";
    refresh.innerHTML = iconSvg("octicon-sync", SYNC_16_PATH);
    refresh.title = t.usagePopoverRefresh;
    refresh.setAttribute("aria-label", t.usagePopoverRefresh);
    refresh.disabled = busy;
    refresh.setAttribute("aria-busy", String(busy));
    refresh.addEventListener("click", () => {
      void run(async () => {
        await deps.client.load({ refreshLogin: true });
        const failure = deps.client.snapshot().error;
        if (failure) throw new Error(`${t.bandLoadFailed}\n${failure}`);
        return "";
      });
    });
    head.append(title, refresh);
    const body = el("div", "usage-popover-body");
    if (error) {
      body.appendChild(
        el("div", "usage-popover-error", `${t.bandLoadFailed}\n${error}`),
      );
    }
    for (const account of data?.accounts ?? []) {
      body.appendChild(accountBlock(account, now));
    }
    if (!data && !error)
      body.appendChild(el("div", "usage-popover-hint", t.loading));
    const children: HTMLElement[] = [head, body];
    if (message?.text) {
      children.push(
        el(
          "div",
          message.ok ? "usage-popover-result" : "usage-popover-error",
          message.text,
        ),
      );
    }
    const manage = el("button", "usage-popover-manage");
    manage.type = "button";
    manage.append(el("span", "", t.usagePopoverManage), el("span", "", "→"));
    manage.addEventListener("click", () => {
      close();
      deps.openSettings();
    });
    children.push(manage);
    panel.replaceChildren(...children);
    if (focusedClass) {
      panel
        .querySelector<HTMLElement>(`.${focusedClass.split(" ").join(".")}`)
        ?.focus();
    }
  }

  function place(): void {
    if (!panel) return;
    const anchor = root.getBoundingClientRect();
    const tokenEdge = Number.parseFloat(
      getComputedStyle(document.body).getPropertyValue("--space-4"),
    );
    const head = panel.querySelector<HTMLElement>(".usage-popover-head");
    const computedEdge = head
      ? Number.parseFloat(getComputedStyle(head).paddingLeft)
      : Number.NaN;
    const edge = Number.isFinite(tokenEdge) ? tokenEdge : computedEdge;
    if (!Number.isFinite(edge)) {
      throw new Error("usage popover viewport inset is not a finite length");
    }
    const panelWidth = panel.getBoundingClientRect().width;
    const rightmost = window.innerWidth - panelWidth - edge;
    panel.style.left = `${Math.max(edge, Math.min(anchor.left, rightmost))}px`;
    panel.style.bottom = `${Math.max(0, window.innerHeight - anchor.top)}px`;
  }

  function open(from: HTMLElement): void {
    if (panel) return;
    opener = from;
    message = null;
    panel = el("div", "usage-popover");
    panel.setAttribute("role", "dialog");
    panel.tabIndex = -1;
    panel.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    });
    document.body.appendChild(panel);
    renderPanel();
    place();
    render(true);
    const unsubscribe = deps.client.subscribe(renderPanel);
    const onPointerDown = (event: Event) => {
      const target = event.target as Node;
      if (panel?.contains(target) || root.contains(target)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", place);
    cleanup = () => {
      unsubscribe();
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", place);
    };
    panel.querySelector<HTMLElement>(".usage-popover-refresh")?.focus();
  }

  function close(): void {
    if (!panel) return;
    cleanup?.();
    cleanup = null;
    panel.remove();
    panel = null;
    // 開いたボタンは描き直しで作り直されるので、同じ位置のものへ戻す。
    const index = opener ? [...root.children].indexOf(opener) : -1;
    opener = null;
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
    isOpen: () => panel !== null,
  };
}
