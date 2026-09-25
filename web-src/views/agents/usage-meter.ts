// 使用量の 1 枠 (5h / week) の行と、「いつの値か」の文言。全体ボードのカードと、
// 最下段から開くポップオーバーが同じものを使う (同じ値が場所で違って見えない)。
//
//   5h    42%        ▰▰▰▱▱▱▱   resets in 1h 58m
//   week  81% High   ▰▰▰▰▰▰▱
//
// 80% 以上は琥珀の色と「注意」の文字の両方で示す (色だけに頼らない)。リセットの
// 時刻を過ぎた値は今の値ではないので、割合を薄くして「リセット済み」と書く。

import type {
  AccountLogin,
  AccountUsage,
  UsageWindowView,
} from "../../core/agent-accounts";
import { usageIsStale } from "../../core/agent-accounts";
import type { AccountsText } from "./accounts-i18n";

/** バーの幅に使う割合。100 を超えた値もバーは満杯で止める。 */
export function usageBarPercent(usedPercent: number): number {
  if (!Number.isFinite(usedPercent) || usedPercent <= 0) return 0;
  return Math.min(100, usedPercent);
}

/**
 * 窓が戻る時刻の書き方 (全体ボードのカード)。今日なら時刻だけ、今日でなく
 * 24 時間より先でなければ曜日つき、24 時間以上先なら日付つき。時刻は利用者の
 * 時計 (ブラウザの時間帯) で書く。
 */
export function resetClock(
  resetsAt: number,
  now: number,
  t: AccountsText,
): string {
  const at = new Date(resetsAt);
  const today = new Date(now);
  const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  const sameDay =
    at.getFullYear() === today.getFullYear() &&
    at.getMonth() === today.getMonth() &&
    at.getDate() === today.getDate();
  if (sameDay) return t.resetsAt(time);
  if (resetsAt - now < 24 * 60 * 60_000) {
    return t.resetsAt(`${t.weekdays[at.getDay()] ?? ""} ${time}`);
  }
  return t.resetsAt(`${t.resetDate(at.getMonth() + 1, at.getDate())} ${time}`);
}

/**
 * reset: 右端に書くもの。remaining = 「あと 1時間58分でリセット」(最下段・起動の
 * 画面)、clock = 「06:10 に戻る」(全体ボードのカード。棒を % の前に置く)、none = 書かない。
 */
export function usageMeterRow(
  view: UsageWindowView,
  now: number,
  t: AccountsText,
  options: { reset: "remaining" | "clock" | "none" },
): HTMLElement {
  const row = document.createElement("div");
  row.className = "usage-meter";
  row.classList.toggle("warn", view.warn);
  row.classList.toggle("expired", view.expired);
  const name = document.createElement("span");
  name.className = "usage-meter-name";
  name.textContent = t.windowName(view.window);
  const value = document.createElement("span");
  value.className = "usage-meter-value";
  const percent = document.createElement("span");
  percent.textContent = `${Math.round(view.window.usedPercent)}%`;
  value.appendChild(percent);
  if (view.warn) {
    const warn = document.createElement("span");
    warn.className = "usage-meter-warn";
    warn.textContent = t.warn;
    value.appendChild(warn);
  }
  const bar = document.createElement("span");
  bar.className = "usage-meter-bar";
  bar.setAttribute("aria-hidden", "true");
  const fill = document.createElement("span");
  fill.className = "usage-meter-fill";
  fill.style.width = `${usageBarPercent(view.window.usedPercent)}%`;
  bar.appendChild(fill);
  if (options.reset === "clock") {
    row.classList.add("usage-meter-clock");
    row.append(name, bar, value);
  } else {
    row.append(name, value, bar);
  }
  const reset = view.expired
    ? t.resetPassed
    : view.window.resetsAt <= 0
      ? ""
      : options.reset === "clock"
        ? resetClock(view.window.resetsAt, now, t)
        : t.resetsIn(t.duration(view.window.resetsAt - now));
  if (options.reset !== "none") {
    const resetEl = document.createElement("span");
    resetEl.className = "usage-meter-reset";
    resetEl.textContent = reset;
    row.appendChild(resetEl);
  }
  row.title = [
    `${t.windowName(view.window)} ${Math.round(view.window.usedPercent)}%`,
    view.warn ? t.warn : "",
    reset,
    view.window.resetsAt > 0
      ? new Date(view.window.resetsAt).toLocaleString()
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return row;
}

/**
 * 同じ設定ディレクトリに別のアカウントの上限が混ざっているときの説明。
 * 混ざっていなければ空。
 */
export function usageMixedText(
  usage: AccountUsage,
  now: number,
  t: AccountsText,
): string {
  if (usage.status !== "ok" || !usage.mixed) return "";
  const others = usage.mixed.windows
    .map((window) =>
      [
        t.window(window),
        window.resetsAt > 0
          ? t.resetsIn(t.duration(window.resetsAt - now))
          : "",
      ]
        .filter(Boolean)
        .join(" · "),
    )
    .join(", ");
  return t.usageMixedHint(others);
}

/**
 * 「いつの値か」。使用量の値があればその時刻、無ければログインを確かめた時刻。
 * どちらも無いときは空 (時刻を作らない)。
 */
export function usageObservedText(
  usage: AccountUsage,
  login: AccountLogin,
  now: number,
  t: AccountsText,
): { text: string; title: string; stale: boolean } {
  const observedAt = usage.observedAt;
  if (usage.status === "ok" && observedAt > 0) {
    const ago = t.duration(now - observedAt);
    const stale = usageIsStale(observedAt, now);
    return {
      text: stale
        ? t.observedStale(ago)
        : now - observedAt < 60_000
          ? t.observedJustNow
          : t.observed(ago),
      title: t.observedTitle(new Date(observedAt).toLocaleString()),
      stale,
    };
  }
  if (login.checkedAt > 0) {
    return {
      text:
        now - login.checkedAt < 60_000
          ? t.loginCheckedJustNow
          : t.loginChecked(t.duration(now - login.checkedAt)),
      title: new Date(login.checkedAt).toLocaleString(),
      stale: false,
    };
  }
  return { text: "", title: "", stale: false };
}
