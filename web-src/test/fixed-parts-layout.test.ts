// 固定であるべき部品が、状態や後から届く中身で動かないこと
// (ui-layout.md の「固定であるべき部品の一覧」「切替で CLS 0 を保つ」)。
//
// happy-dom は寸法を計算しないので、実画面の矩形の代わりに次を見る:
// - 状態で幅が変わる部品は、どの状態でも寸法を決める宣言が同じで、中身
//   (重ねて置いた文言) も同じであること
// - JS が後から絵を差し込む箱は、最初から絵と同じ大きさを持つこと
// - 後から出入りする印は、ボタンの流れの外 (角に重ねる) に置くこと

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { currentStatusLabel, renderStatusLabel } from "../views/status-label";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
  resolveVar,
} from "./_css-fixture";

const rules = baseRules(loadStyleSheet());

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

/** 箱の大きさに効く宣言 (色や影は幅を変えないので見ない)。 */
const BOX_PROPERTIES = [
  "display",
  "width",
  "min-width",
  "max-width",
  "height",
  "padding",
  "border",
  "font-size",
  "font-weight",
  "letter-spacing",
  "gap",
];

function boxDeclarations(
  matches: (selector: string) => boolean,
): Record<string, string | undefined> {
  const declarations = cascadedDeclarations(rules, matches);
  return Object.fromEntries(
    BOX_PROPERTIES.map((prop) => [prop, declarations.get(prop)]),
  );
}

/** :root と body の変数 (既定の密度)。 */
const rootVariables = cascadedDeclarations(
  rules,
  (selector) => selector === ":root" || selector === "body",
);

describe("最下段の接続状態 (#status) は状態で幅を変えない", () => {
  const STATES = ["live", "refreshing", "error"] as const;
  const statusBox = (state: string | null) =>
    boxDeclarations((selector) =>
      [
        "#status",
        "#statusbar #status",
        ...(state ? [`#status.${state}`, `#statusbar #status.${state}`] : []),
      ].includes(selector),
    );

  test.each(STATES)("%s の箱は待機中と同じ", (state) => {
    expect(statusBox(state)).toEqual(statusBox(null));
  });

  const LABELS = ["Live", "Loading", "Error", "Idle"];

  test.each(
    LABELS,
  )("%s を見せても、升には 4 つの文言が同じ順に入る", (current) => {
    const host = document.createElement("span");
    renderStatusLabel(host, LABELS, current);
    expect({
      texts: [...host.children].map((child) => child.textContent),
      current: currentStatusLabel(host),
      shown: [...host.querySelectorAll(".is-current")].length,
      hiddenFromReaders: [...host.querySelectorAll('[aria-hidden="true"]')].map(
        (child) => child.textContent,
      ),
    }).toEqual({
      texts: LABELS,
      current,
      shown: 1,
      hiddenFromReaders: LABELS.filter((label) => label !== current),
    });
  });

  test("文言は同じ升に重ね、今の 1 つだけ見せる", () => {
    const at = (selector: string) =>
      cascadedDeclarations(rules, (s) => s === selector);
    expect({
      label: at("#status .status-label").get("display"),
      span: [
        at("#status .status-label > span").get("grid-area"),
        at("#status .status-label > span").get("visibility"),
      ],
      current: at("#status .status-label > span.is-current").get("visibility"),
    }).toEqual({
      label: "inline-grid",
      span: ["1 / 1", "hidden"],
      current: "visible",
    });
  });

  test("一覧に無い文言は理由つきで投げる", () => {
    expect(() =>
      renderStatusLabel(document.createElement("span"), LABELS, "Busy"),
    ).toThrow('status label "Busy" is not one of: Live, Loading, Error, Idle');
  });
});

describe("JS が後から絵を差し込む箱は、最初から絵と同じ大きさ", () => {
  test.each([
    { host: ".nav-search", part: "左のサイドバーの検索" },
    { host: ".nav-foot-item", part: "左のサイドバーの足元" },
    { host: ".nav-icon-action", part: "左のサイドバーの頭の絵のボタン" },
  ])("$part ($host)", ({ host }) => {
    const size = (selector: string) => {
      const declarations = cascadedDeclarations(rules, (s) => s === selector);
      return ["width", "height"].map((prop) => {
        const value = declarations.get(prop);
        if (!value) throw new Error(`${selector} has no ${prop}`);
        return resolveVar(value, rootVariables);
      });
    };
    expect(size(`${host} .goi-icon`)).toEqual(size(`${host} svg`));
  });
});

describe("後から出入りする印は、ボタンの流れの外 (角に重ねる)", () => {
  test.each([
    {
      part: "注釈の件数",
      host: "#annotations-toggle",
      badge: "#annotations-count",
    },
    { part: "診断の結果の点", host: "#doctor-btn", badge: ".doctor-badge" },
  ])("$part ($badge)", ({ host, badge }) => {
    const at = (selector: string) =>
      cascadedDeclarations(rules, (s) => s === selector);
    const display = at(badge).get("display");
    expect({
      host: at(host).get("position"),
      badge: at(badge).get("position"),
      // display を指定した印は、[hidden] を自分で消さないと隠れない。
      hidden: display ? at(`${badge}[hidden]`).get("display") : "none",
    }).toEqual({ host: "relative", badge: "absolute", hidden: "none" });
  });
});

describe("後から中身が入る行は、最初から中身 1 つ分の高さを取る", () => {
  const px = (value: string | undefined, index = 0) => {
    const part = value?.split(/\s+/)[index];
    const number = part?.endsWith("px") ? Number.parseFloat(part) : Number.NaN;
    if (!Number.isFinite(number))
      throw new Error(`not a px length: ${JSON.stringify(value)}`);
    return number;
  };
  const at = (...selectors: string[]) =>
    cascadedDeclarations(rules, (s) => selectors.includes(s));

  test("Data のタブの列 (.db-tabs-list) はチップ 1 つの行の高さ", () => {
    const chip = at(".db-tabs-chip", ".db-root .db-tabs-chip");
    const close = at(".db-tabs-chip-close", ".db-root .db-tabs-chip-close");
    const list = at(".db-tabs-list", ".db-root .db-tabs-list");
    const chipHeight =
      px(close.get("min-height")) +
      px(chip.get("padding"), 0) +
      px(chip.get("padding"), 2) +
      2 * px(chip.get("border"));
    const rowHeight = chipHeight + 2 * px(list.get("padding"), 0);
    expect(px(list.get("min-height"))).toBe(rowHeight);
  });
});

describe("端末の案内と状態行は、どちらか一方だけ見せる (同じ要素を動かさない)", () => {
  const at = (selector: string) =>
    cascadedDeclarations(rules, (s) => s === selector).get("display");
  test.each([
    {
      state: "何も映していない",
      hint: ".terminal-slot:has(.terminal-screen:empty) > .terminal-empty-hint:not([hidden])",
      status: ".terminal-slot:has(.terminal-screen:empty) > .terminal-status",
      expected: { hint: "grid", status: "none" },
    },
    {
      state: "映している",
      hint: ".terminal-empty-hint",
      status: ".terminal-status",
      expected: { hint: "none", status: undefined },
    },
  ])("$state", ({ hint, status, expected }) => {
    expect({ hint: at(hint), status: at(status) }).toEqual(expected);
  });
});
