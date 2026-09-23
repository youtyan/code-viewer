// キーで届いた部品の輪 (--focus-ring) は、どのテーマのどの面の上でも見える。
// 見えるの基準は WCAG 2.2 の 1.4.11 (部品の見た目の色の差 3:1)。
//
// 輪を 7 割に薄めていた頃は、ライトの地・hover・選んでいる行の上で 2.6〜3.0 しか
// なく、見えにくかった。値そのものは固定しない (色を変えても 3:1 を保てば通る)。
// 地がアクセントの塗りのボタンでは、輪と塗りが同じ色で接してボタンが少し大きく
// 見えるだけだったので、輪と部品の間に地の色の隙間を挟む。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
  resolveVar,
} from "./_css-fixture";

type Rgba = [number, number, number, number];

/** #rgb / #rrggbb と、透明と混ぜた color-mix (輪を薄める書き方) だけを読む。 */
function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const digits =
      hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join("") : hex[1];
    return [
      Number.parseInt(digits.slice(0, 2), 16),
      Number.parseInt(digits.slice(2, 4), 16),
      Number.parseInt(digits.slice(4, 6), 16),
      1,
    ];
  }
  const mix =
    /^color-mix\(in srgb,\s*(#[0-9a-f]+)\s+([\d.]+)%,\s*transparent\)$/i.exec(
      value.trim(),
    );
  if (mix) {
    const [r, g, b] = parseColor(mix[1]);
    return [r, g, b, Number(mix[2]) / 100];
  }
  throw new Error(`focus ring test: cannot read the color ${value}`);
}

function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  return [
    fg[0] * a + bg[0] * (1 - a),
    fg[1] * a + bg[1] * (1 - a),
    fg[2] * a + bg[2] * (1 - a),
    1,
  ];
}

function luminance([r, g, b]: Rgba): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const rules = baseRules(loadStyleSheet());
const block = (selector: string) =>
  cascadedDeclarations(rules, (s) => s === selector);
// テーマは同じ名前の値を差し替えるだけ (ui-surface.md)。後ろほど強い。
const light = block(":root");
const dark = new Map([...light, ...block('[data-theme="dark"]')]);
const themes = {
  light,
  dark,
  "dark graphite": new Map([
    ...dark,
    ...block('[data-theme="dark"][data-palette="graphite"]'),
  ]),
  "dark warm": new Map([
    ...dark,
    ...block('[data-theme="dark"][data-palette="warm"]'),
  ]),
};
// 輪が乗る面: 窓の地・サイドバー・木・本文・コード・hover・選んでいる行・前面のタブ・
// 一段沈んだ面 (検索の入口・Diff の上の段と木の切替の地。内側の輪はこの上に乗る)。
const SURFACES = [
  "--color-ground",
  "--color-nav",
  "--color-tree",
  "--color-doc",
  "--color-code",
  "--color-raised",
  "--color-select",
  "--color-tab-active",
  "--color-inset",
];

type Layer = { inset: boolean; spread: number; color: string };

/** `[inset] 0 0 0 <n>px <色>` をカンマで並べた box-shadow を層に分ける。 */
function layers(shadow: string): Layer[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < shadow.length; i += 1) {
    if (shadow[i] === "(") depth += 1;
    else if (shadow[i] === ")") depth -= 1;
    else if (shadow[i] === "," && depth === 0) {
      parts.push(shadow.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(shadow.slice(start));
  return parts.map((part) => {
    const layer = /^(inset )?0 0 0 (\d+)px (.+)$/.exec(part.trim());
    if (!layer) throw new Error(`focus ring test: unexpected layer ${part}`);
    return {
      inset: Boolean(layer[1]),
      spread: Number(layer[2]),
      color: layer[3],
    };
  });
}

/** 外の輪: 部品に接する隙間と、その外の色の輪。 */
function outerRing(vars: Map<string, string>): { gap: string; ring: string } {
  const [gap, ring, ...rest] = layers(resolveVar("var(--focus-ring)", vars));
  if (!ring || rest.length > 0 || gap.inset || ring.inset)
    throw new Error("focus ring test: --focus-ring is not a gap and a ring");
  if (gap.spread >= ring.spread)
    throw new Error("focus ring test: the gap is not inside the ring");
  return { gap: gap.color, ring: ring.color };
}

/** 内側の輪 (列の端から端までの行・横に送る箱)。 */
function insetRing(vars: Map<string, string>): string {
  const [ring, ...rest] = layers(resolveVar("var(--focus-ring-inset)", vars));
  if (rest.length > 0 || !ring.inset)
    throw new Error(
      "focus ring test: --focus-ring-inset is not one inset ring",
    );
  return ring.color;
}

const RINGS = {
  outer: (vars: Map<string, string>) => outerRing(vars).ring,
  inset: insetRing,
};

describe("the focus ring is visible on every surface", () => {
  test.each(
    Object.entries(themes).flatMap(([theme, vars]) =>
      Object.entries(RINGS).flatMap(([kind, color]) =>
        SURFACES.map((surface) => ({ theme, kind, color, surface, vars })),
      ),
    ),
  )("$theme, $kind ring on $surface: 3:1 or more", ({
    color,
    surface,
    vars,
  }) => {
    const bg = parseColor(resolveVar(`var(${surface})`, vars));
    const ring = over(parseColor(color(vars)), bg);
    expect(contrast(ring, bg)).toBeGreaterThanOrEqual(3);
  });
});

// 塗りのボタン (地がアクセント。Register repo・New agent・dialog の確定など)。
// 隙間が塗り (hover の濃い塗りも) から、輪が隙間から、それぞれ 3:1 以上離れる。
describe("the ring stays apart from a filled button", () => {
  test.each(
    Object.entries(themes).flatMap(([theme, vars]) =>
      ["--color-accent", "--color-accent-strong"].map((fill) => ({
        theme,
        fill,
        vars,
      })),
    ),
  )("$theme on $fill", ({ fill, vars }) => {
    const { gap, ring } = outerRing(vars);
    const fillColor = parseColor(resolveVar(`var(${fill})`, vars));
    const gapColor = over(parseColor(gap), fillColor);
    expect({
      gapToFill: contrast(gapColor, fillColor) >= 3,
      ringToGap: contrast(over(parseColor(ring), gapColor), gapColor) >= 3,
    }).toEqual({ gapToFill: true, ringToGap: true });
  });
});

// `inset var(--focus-ring)` は 1 層目にしか inset が付かず、外の輪が内側の輪の
// 外にもう 1 本出る。内側に描くときは --focus-ring-inset を使う。
test("no rule puts inset in front of the two-layer ring", () => {
  const offenders = rules
    .filter((rule) =>
      [...rule.declarations.values()].some((value) =>
        /inset\s+var\(--focus-ring\)/.test(value),
      ),
    )
    .map((rule) => rule.selector);
  expect(offenders).toEqual([]);
});

// キーで届くのにブラウザの既定の輪 (色も太さもほかと違う) だった部品も、同じ輪を描く。
describe("controls that had the browser's default ring draw the shared ring", () => {
  test.each([
    ".nav-note-link",
    // 差分のカードの見出しのボタン。
    ".gdp-file-header-icon",
    ".gdp-preview-file",
    ".gdp-view-file",
  ])("%s", (control) => {
    const focused = cascadedDeclarations(rules, (s) =>
      s
        .split(",")
        .map((part) => part.trim())
        .includes(`${control}:focus-visible`),
    );
    expect([
      focused.get("outline"),
      resolveVar(focused.get("box-shadow") ?? "", light),
    ]).toEqual(["none", resolveVar("var(--focus-ring)", light)]);
  });
});

// 差分の横に送る箱は、箱の外に描くと親の overflow で切れ、箱の中に描くと行番号の
// 列 (sticky) の下に隠れる。送らない親の面に、行番号より上の層で内側の輪を重ねる。
describe("a focused diff scroll box draws the shared ring above the line numbers", () => {
  const exactly = (selector: string) =>
    cascadedDeclarations(rules, (s) => s === selector);
  const lineNumbers = exactly("table.d2h-diff-table td.d2h-code-linenumber");

  test("the box drops the browser's ring", () => {
    expect(exactly(".d2h-code-wrapper:focus-visible").get("outline")).toBe(
      "none",
    );
  });

  test.each([".d2h-file-diff", ".d2h-file-side-diff"])("%s", (parent) => {
    const focused = `${parent}:has(> .d2h-code-wrapper:focus-visible)`;
    const ring = exactly(`${focused}::after`);
    expect({
      host: exactly(focused).get("position"),
      position: ring.get("position"),
      inset: ring.get("inset"),
      shadow: resolveVar(ring.get("box-shadow") ?? "", light),
      aboveLineNumbers:
        Number(ring.get("z-index")) > Number(lineNumbers.get("z-index")),
    }).toEqual({
      host: "relative",
      position: "absolute",
      inset: "0",
      shadow: resolveVar("var(--focus-ring-inset)", light),
      aboveLineNumbers: true,
    });
  });
});

// 木の行は列の端から端までで外の輪は切れるので、内側に描く。選んでいる行は光も残す。
describe("a focused tree row draws the shared ring inside", () => {
  test.each([
    ["#filelist li:focus-visible", "var(--focus-ring-inset)"],
    [
      "#filelist.tree .tree-file.active:focus-visible",
      "var(--focus-ring-inset), var(--glow-select)",
    ],
    [
      "#filelist li.active:focus-visible",
      "var(--focus-ring-inset), var(--glow-select)",
    ],
  ])("%s", (selector, expected) => {
    const focused = cascadedDeclarations(rules, (s) => s === selector);
    expect(resolveVar(focused.get("box-shadow") ?? "", light)).toBe(
      resolveVar(expected, light),
    );
  });

  test("the browser's ring is off", () => {
    expect(
      cascadedDeclarations(
        rules,
        (s) => s === "#filelist li:focus-visible",
      ).get("outline"),
    ).toBe("none");
  });
});

// 差分のカードの見出しの Viewed はチェックの箱ではなく文字ごと (label) を囲む。
// 隠れた行を出すボタンは行番号の列いっぱいに積まれ、外の輪が切れるので内側に描く。
describe("the diff card header's Viewed and the hidden-line buttons draw the shared ring", () => {
  const exactly = (selector: string) =>
    cascadedDeclarations(rules, (s) => s === selector);

  test("Viewed: the label draws the ring, the checkbox drops the browser's", () => {
    expect({
      checkbox: exactly(".d2h-file-collapse-input:focus-visible").get(
        "outline",
      ),
      label: resolveVar(
        exactly(
          ".d2h-file-collapse:has(> .d2h-file-collapse-input:focus-visible)",
        ).get("box-shadow") ?? "",
        light,
      ),
    }).toEqual({
      checkbox: "none",
      label: resolveVar("var(--focus-ring)", light),
    });
  });

  test("the hidden-line button draws the ring inside", () => {
    const focused = exactly(".gdp-expand-btn:focus-visible");
    expect([
      focused.get("outline"),
      resolveVar(focused.get("box-shadow") ?? "", light),
    ]).toEqual(["none", resolveVar("var(--focus-ring-inset)", light)]);
  });
});

// 実際の部品に当たる規則だけでカスケードを解き (当たりは happy-dom が決める)、
// フォーカスのある部品がどの輪を描くかを見る。一般の規則 (外の輪) と、輪と関係の
// ない規則 (木の全部開くの box-shadow: none のような) に負けていないことも分かる。
//
// - 自前の outline かブラウザの既定の輪だった部品は、共有の外の輪
// - 外の輪 (4px) が切れる所は内側の輪 (部品の位置は動かさない):
//   窓の上端に接する (左のサイドバーの頭・タブ列の操作・タブ列の左端の
//   プロジェクトの切替・右の列の頭)、右端に接する (畳んだ右の列の帯)、下端に接する
//   (最下段)、画面の絵柄 (右の列の頭
//   では上端、畳んだ帯では右端)、overflow で切る枠の中 (Diff の上の段と木の切替・
//   パンくずの段と「…」)、間の狭いカード (エージェントのカード)
describe("a focused control draws the ring that fits where it sits", () => {
  const PAGE = `
    <aside id="app-nav">
      <div class="nav-head">
        <button id="search-btn" class="nav-search">search</button>
        <button id="nav-collapse" class="nav-icon-action">hide</button>
      </div>
      <div class="nav-projects">
        <div class="nav-agents">
          <button id="nav-card" class="nav-agent agent-card">sample</button>
          <button id="nav-card-active" class="nav-agent agent-card active">sample</button>
        </div>
      </div>
    </aside>
    <footer id="statusbar">
      <button id="agent-status" class="agent-status">waiting 1</button>
      <button id="usage-item" class="usage-status-item">usage</button>
      <button id="status-action" class="statusbar-icon-action">stop</button>
      <div class="global-actions">
        <button id="auto-update" class="global-icon-action">auto</button>
      </div>
    </footer>
    <div class="agents-rows">
      <button id="board-card" class="agents-row agent-card">sample</button>
      <button id="board-card-active" class="agents-row agent-card active">sample</button>
    </div>
    <nav id="main-tabs">
      <div class="main-tabs-pane">
        <div id="tabs-lead" class="tabs-lead">
          <div id="view-head" class="view-head">
            <div class="view-head-row">
              <button id="lead-switcher" class="brand">sample</button>
            </div>
          </div>
        </div>
        <div class="main-tabs-strip">
          <button id="tab-new" class="main-tabs-action">new</button>
        </div>
        <div class="main-tabs-actions">
          <button id="tab-split" class="main-tabs-action">split</button>
        </div>
      </div>
    </nav>
    <div id="panel-head" class="panel-head">
      <div class="view-head">
        <div class="view-head-row">
          <button id="project-switcher" class="brand">sample</button>
        </div>
        <nav class="app-menu view-strip">
          <a id="head-view" class="app-menu-item view-strip-item" href="#files">files</a>
        </nav>
      </div>
      <div id="panel-rail" class="panel-rail">
        <button id="sidebar-toggle">show</button>
        <nav class="app-menu view-strip">
          <a id="rail-view" class="app-menu-item view-strip-item" href="#diff">diff</a>
        </nav>
      </div>
    </div>
    <header id="topbar">
      <div class="ref-pickers">
        <button id="ref-reset">reset</button>
        <button id="reload-prom">reload</button>
      </div>
      <div class="controls">
        <div class="seg">
          <button id="layout-split" class="active" data-layout="side-by-side">split</button>
          <button id="layout-unified" data-layout="line-by-line">unified</button>
        </div>
        <button id="ignore-ws" class="active">ws</button>
        <button id="hide-tests">no test</button>
      </div>
    </header>
    <aside id="sidebar">
      <div class="sb-head">
        <div class="sb-actions" role="group">
          <button id="sb-expand-all" class="sb-icon-action sb-tree-action">open</button>
          <button id="sb-collapse-all" class="sb-icon-action sb-tree-action">close</button>
        </div>
        <div class="seg sb-view-seg">
          <button id="view-tree" class="active" data-view="tree">tree</button>
          <button id="view-flat" data-view="flat">flat</button>
        </div>
      </div>
    </aside>
    <section class="gdp-repo-shell">
      <div class="gdp-file-detail-header gdp-repo-toolbar">
        <div class="gdp-file-detail-path">
          <nav class="gdp-file-breadcrumb">
            <button id="crumb-part" class="gdp-file-breadcrumb-part">sample</button>
            <span id="crumb-more" class="gdp-file-breadcrumb-ellipsis" tabindex="0">…</span>
            <button id="crumb-current" class="gdp-file-breadcrumb-current">file</button>
          </nav>
        </div>
        <button id="repo-history" class="gdp-btn gdp-btn-sm">History</button>
      </div>
      <div class="gdp-repo-sort-host">
        <div id="repo-sort" class="gdp-repo-sort-header">
          <span class="gdp-repo-sort-spacer"></span>
          <button id="sort-name" class="active" data-repo-sort="name">Name ↑</button>
          <button id="sort-size" data-repo-sort="size">Size</button>
        </div>
      </div>
    </section>`;

  beforeAll(() => {
    GlobalRegistrator.register();
    document.body.innerHTML = PAGE;
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  /** その部品に当たる規則だけで解いた、フォーカス中の outline と box-shadow。 */
  function focusedRing(id: string) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`focus ring test: missing #${id}`);
    element.focus();
    if (!element.matches(":focus-visible"))
      throw new Error(`focus ring test: #${id} did not take focus`);
    const won = cascadedDeclarations(
      rules,
      (selector) => !selector.includes("::") && element.matches(selector),
    );
    return {
      outline: won.get("outline"),
      shadow: resolveVar(won.get("box-shadow") ?? "none", light),
    };
  }

  const OUTER = "var(--focus-ring)";
  const INSET = "var(--focus-ring-inset)";
  test.each([
    // 自前の outline だった: プロジェクトの切替 (右の列の頭)・木の全部開く / 畳む
    ["project-switcher", OUTER],
    ["sb-expand-all", OUTER],
    ["sb-collapse-all", OUTER],
    // ブラウザの既定の輪だった: 本文のボタン・Diff の上の段・Files の一覧の並べ替え
    ["repo-history", OUTER],
    ["sort-name", OUTER],
    ["sort-size", OUTER],
    ["ref-reset", OUTER],
    ["reload-prom", OUTER],
    ["ignore-ws", OUTER],
    ["hide-tests", OUTER],
    // 窓の上端に接する
    ["search-btn", INSET],
    ["nav-collapse", INSET],
    ["lead-switcher", INSET],
    // 窓の下端に接する (最下段)
    ["agent-status", INSET],
    ["usage-item", INSET],
    ["status-action", INSET],
    ["auto-update", INSET],
    // 窓の右端に接する (畳んだ帯)
    ["sidebar-toggle", INSET],
    // 画面の絵柄 (右の列の頭では上端、畳んだ帯では右端)
    ["head-view", INSET],
    ["rail-view", INSET],
    // overflow で切る枠の中
    ["layout-unified", INSET],
    ["view-tree", INSET],
    ["view-flat", INSET],
    ["crumb-part", INSET],
    ["crumb-more", INSET],
    ["crumb-current", INSET],
    // 選んでいる表示の切替は光を残す
    ["layout-split", `${INSET}, var(--glow-select)`],
    // エージェントのカード (間が狭く、外の輪の下辺が次のカードに隠れる)。
    // 選んでいるカードは光を残す
    ["nav-card", INSET],
    ["nav-card-active", `${INSET}, var(--glow-select)`],
    ["board-card", INSET],
    ["board-card-active", `${INSET}, var(--glow-select)`],
  ])("#%s", (id, ring) => {
    expect(focusedRing(id)).toEqual({
      outline: "none",
      shadow: resolveVar(ring, light),
    });
  });

  // 右の列を畳むボタンは 1 つで、右の列の頭 (上端) と畳んだ帯 (右端) を移る
  // (views/sidebar.ts の placeSidebarToggle)。どちらも窓の端なので内側。
  test("the right column's toggle draws inside in the head row and on the rail", () => {
    const toggle = document.getElementById("sidebar-toggle");
    const row = document.querySelector(".view-head-row");
    const rail = document.getElementById("panel-rail");
    if (!toggle || !row || !rail)
      throw new Error("focus ring test: missing the toggle's places");
    row.append(toggle);
    const inHeadRow = focusedRing("sidebar-toggle");
    rail.prepend(toggle);
    expect({ inHeadRow, onRail: focusedRing("sidebar-toggle") }).toEqual({
      inHeadRow: { outline: "none", shadow: resolveVar(INSET, light) },
      onRail: { outline: "none", shadow: resolveVar(INSET, light) },
    });
  });

  // 並べ替えの帯はボタンの高さいっぱいで、すぐ下の一覧の面が外の輪の下辺を隠す。
  // フォーカスのある間だけ帯を上の層に置く (位置は動かさない)。
  test("the sort header lifts above the list while a button has the ring", () => {
    const header = document.getElementById("repo-sort");
    if (!header) throw new Error("focus ring test: missing the sort header");
    const layer = () => {
      const won = cascadedDeclarations(
        rules,
        (selector) => !selector.includes("::") && header.matches(selector),
      );
      return { position: won.get("position"), zIndex: won.get("z-index") };
    };
    (document.activeElement as HTMLElement | null)?.blur();
    const idle = layer();
    focusedRing("sort-name");
    expect({ idle, focused: layer() }).toEqual({
      idle: { position: undefined, zIndex: undefined },
      focused: { position: "relative", zIndex: "1" },
    });
  });

  // タブ列の操作は窓の上端にいる (＋は最後のタブのすぐ右、分割は右端)。
  test.each([
    "tab-new",
    "tab-split",
  ])("the tab strip's #%s draws inside", (id) => {
    expect(focusedRing(id)).toEqual({
      outline: "none",
      shadow: resolveVar(INSET, light),
    });
  });
});
