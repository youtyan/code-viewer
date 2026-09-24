// 止まらない CSS アニメーション (infinite) は、読み込み中・起動中のような「その間だけ
// 付く状態」の選択子にだけ置く。いつも出ている部品 (Live の点・見えていない読み込みの
// 帯・作業中の印) で回していて、ページが毎秒 60 回描き直され、端末の打鍵が画面に
// 出るまでの中央値が 27ms かかっていた (止めると 2ms 台)。
//
// 下の一覧は確かめた選択子。足すなら、その状態が終われば外れる (ずっと付かない) ことを
// 確かめてから足す。
import { expect, test } from "vitest";
import { loadStyleSheet } from "./_css-fixture";

const REVIEWED = [
  "#load-bar.active::after",
  "#reload-prom.spinning svg",
  "#reload.spinning",
  ".backend-state .empty-icon.backend-state-spinning .octicon",
  ".db-grid-refresh.spinning svg",
  ".db-query-history-refresh.spinning svg",
  ".db-refresh-btn.spinning svg",
  ".empty-action.spinning .empty-action-icon",
  ".gdp-file-shell.pending .gdp-shell-body",
  ".gdp-source-loading-spinner",
  ".history-refresh.spinning svg",
  ".nav-mark-starting",
];

test("infinite animations sit only on selectors of a passing state", () => {
  const selectors = loadStyleSheet()
    .filter((rule) =>
      /\binfinite\b/.test(rule.declarations.get("animation") ?? ""),
    )
    .map((rule) => rule.selector);
  expect([...new Set(selectors)].sort()).toEqual(REVIEWED);
});
