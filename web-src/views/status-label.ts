// 最下段の接続状態 (#status) の文言。状態ごとの文言を全部同じ升に重ねて置き、
// 見せるのは今の 1 つだけ (style.css の #status .status-label)。枠の幅は一番
// 長い文言で決まるので、状態が変わっても隣 (エージェントの件数・右の操作) が
// 動かない。文言を差し替えるだけだと Live と Loading の幅の差で隣が揺れていた。

/**
 * 状態ごとの文言 (app.ts の setStatus が重ねる並び: 稼働中・更新中・エラー・待機中)。
 * index.html の早いスクリプト (#first-status) が最初の描画で同じ文言を重ねて置く
 * (web-src/test/first-screen.test.ts が同じであることを確かめる)。
 */
export const STATUS_LABEL_TEXT = {
  en: { live: "Live", loading: "Loading", error: "Error", idle: "Idle" },
  ja: { live: "稼働中", loading: "更新中", error: "エラー", idle: "待機中" },
} as const;

export function renderStatusLabel(
  host: HTMLElement,
  labels: readonly string[],
  current: string,
): void {
  if (!labels.includes(current))
    throw new Error(
      `status label "${current}" is not one of: ${labels.join(", ")}`,
    );
  host.replaceChildren(
    ...labels.map((label) => {
      const span = document.createElement("span");
      span.textContent = label;
      if (label === current) span.className = "is-current";
      else span.setAttribute("aria-hidden", "true");
      return span;
    }),
  );
}

/** 今見せている文言 (重ねた升の中の 1 つ)。 */
export function currentStatusLabel(host: HTMLElement): string {
  return host.querySelector(".is-current")?.textContent ?? "";
}
