// index.html の body の早いスクリプト (#first-screen・#first-status・#first-project) が、最初の
// 描画で付ける印と置く文言が、app.js が後から付けるものと同じであること。違えば
// JS の後に並びが動く (読み込みの CLS)。
//
// 比べる相手は app.ts が使う本物の決まり: 画面の印 core/page-mode.ts の
// pageModeClasses (route は core/routes.ts の parseRoute)、一覧の列 core/list-column.ts
// の listColumnKindFor と listColumnLayout (一覧の幅・変更ファイルの一覧とファイル
// 一覧を幅のために畳むか)、最下段の文言 views/status-label.ts の renderStatusLabel と
// STATUS_LABEL_TEXT。
//
// happy-dom は var() を含むカスタムプロパティを解決しないので、スクリプトが読む
// 骨格の変数 (--nav-w など) は _css-fixture.ts で style.css から解決した値を渡す。

import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { withoutProjectPrefix } from "../core/api-url";
import { listColumnKindFor, listColumnLayout } from "../core/list-column";
import {
  PAGE_MODE_CLASSES,
  pageModeClasses,
  worktreeOverview,
} from "../core/page-mode";
import { HISTORY_WIDTH, SIDEBAR_WIDTH } from "../core/panel-sizes";
import { parseRoute } from "../core/routes";
import { COMFORTABLE_PANE_WIDTH } from "../views/main-tabs/main-tabs-view";
import {
  EARLY_PROJECTS_MAX,
  withEarlyProject,
} from "../views/shell/early-look";
import { renderStatusLabel, STATUS_LABEL_TEXT } from "../views/status-label";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
  resolveVar,
} from "./_css-fixture";

const html = readFileSync("web/index.html", "utf8");

function inlineScript(id: string): string {
  const match = new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`).exec(
    html,
  );
  if (!match) throw new Error(`index.html has no <script id="${id}">`);
  return match[1];
}

// 既定の密度の骨格の変数 (body で決まる値)。
const rules = baseRules(loadStyleSheet());
const variables = new Map([
  ...cascadedDeclarations(rules, (s) => s === ":root" || s === "html"),
  ...cascadedDeclarations(rules, (s) => s === "body"),
]);
const cssPx = (name: string) =>
  Number.parseFloat(resolveVar(`var(${name})`, variables));
const TREE_RAIL = cssPx("--panelcol-rail-w");
// 画面の入口の縦の帯の幅は calc(<長さ> * <数>) (密度で変わる)。
const VIEW_RAIL = (() => {
  const value = resolveVar("var(--view-rail-w)", variables);
  const product = /^calc\(([\d.]+)px \* ([\d.]+)\)$/.exec(value);
  if (!product) throw new Error(`--view-rail-w is not calc(px * n): ${value}`);
  return Number(product[1]) * Number(product[2]);
})();
const NAV_W = cssPx("--nav-w");

type Look = {
  projects?: ReturnType<typeof withEarlyProject>;
  navCollapsed?: boolean;
  navWidth?: number;
  sidebarHidden?: boolean;
  sidebarWidth?: number;
  historyWidth?: number;
  language?: "en" | "ja";
};

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

beforeEach(() => {
  document.body.className = "";
  for (const name of [...document.body.getAttributeNames()])
    document.body.removeAttribute(name);
  document.documentElement.removeAttribute("style");
  localStorage.clear();
});

/**
 * #first-screen を、その URL・窓の幅・控えで走らせる。骨格の変数は style.css の
 * 既定と、head のスクリプト・この画面のスクリプトが html に書いた値から読む。
 */
function runFirstScreen(url: string, width: number, look: Look) {
  (
    window as unknown as { happyDOM: { setURL(url: string): void } }
  ).happyDOM.setURL(`http://127.0.0.1${url}`);
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    value: width,
  });
  localStorage.setItem("code-viewer:early-look", JSON.stringify(look));
  const nav = look.navCollapsed ? 0 : look.navWidth || NAV_W;
  const real = window.getComputedStyle.bind(window);
  window.getComputedStyle = ((element: Element) => {
    if (element !== document.body) return real(element);
    const inline = (name: string) =>
      document.documentElement.style.getPropertyValue(name);
    const values: Record<string, string> = {
      "--nav-w": `${nav}px`,
      "--history-w": inline("--history-w") || `${cssPx("--history-w")}px`,
      "--sidebar-w": inline("--sidebar-w") || `${cssPx("--sidebar-w")}px`,
      "--panelcol-rail-w": `${TREE_RAIL}px`,
      "--view-rail-w": `${VIEW_RAIL}px`,
    };
    return {
      getPropertyValue: (name: string) => values[name] ?? "",
    } as CSSStyleDeclaration;
  }) as typeof window.getComputedStyle;
  try {
    new Function(inlineScript("first-screen"))();
  } finally {
    window.getComputedStyle = real;
  }
  return { nav };
}

function expected(url: string, width: number, look: Look, nav: number) {
  const parsed = new URL(`http://127.0.0.1${url}`);
  const route = parseRoute(
    withoutProjectPrefix(parsed.pathname),
    parsed.search,
    { from: "HEAD", to: "worktree" },
  );
  // 画面でない URL でも、利用者のファイル一覧の畳みは当てる (app.ts も画面に
  // よらず当てる)。
  if (route.screen === "unknown")
    return {
      page: [],
      overview: false,
      list: null,
      hidden: look.sidebarHidden === true,
      layout: null,
    };
  const hostedSourceOpen =
    route.screen === "history" && !!parsed.searchParams.get("source");
  const pageClasses = pageModeClasses(route, hostedSourceOpen);
  const page = [...pageClasses].sort();
  const overview = worktreeOverview(route);
  // 直接開いたときの前面は URL の画面のタブ。
  const list = listColumnKindFor({
    has: (pageClass) => pageClasses.has(pageClass as never),
    worktreeOverview: overview,
    leftFrontIsPage: true,
  });
  const userHidden = look.sidebarHidden === true;
  const files = look.sidebarWidth || SIDEBAR_WIDTH.default;
  const layout = listColumnLayout({
    room: width - nav,
    files: userHidden ? 0 : files,
    filesRail: VIEW_RAIL,
    filesKeptOpen: false,
    preferred: list ? look.historyWidth || HISTORY_WIDTH.default : 0,
    compact: HISTORY_WIDTH.min,
    tree: list === "history" || list === "worktree" ? files : 0,
    treeRail: TREE_RAIL,
    treeKeptOpen: false,
    need: COMFORTABLE_PANE_WIDTH,
  });
  return {
    page,
    overview,
    list,
    hidden: userHidden || layout.filesFolded,
    layout: list
      ? { width: `${layout.width}px`, folded: layout.treeFolded }
      : null,
  };
}

function actual() {
  const body = document.body;
  const list = body.getAttribute("data-list-column");
  return {
    page: [...body.classList]
      .filter((name) => (PAGE_MODE_CLASSES as readonly string[]).includes(name))
      .sort(),
    overview: body.hasAttribute("data-worktree-overview"),
    list,
    hidden: body.classList.contains("gdp-sidebar-hidden"),
    layout: list
      ? {
          width: document.documentElement.style.getPropertyValue("--list-w"),
          folded: body.hasAttribute("data-list-tree-folded"),
        }
      : null,
  };
}

const URLS = [
  "/",
  "/index.html",
  "/doctor",
  "/p/0123456789abcdef",
  "/p/0123456789abcdef/",
  "/p/0123456789abcdef/todif?from=HEAD&to=worktree",
  "/todiff",
  "/history",
  "/history?commit=abc&source=src%2Fa.ts",
  "/worktree",
  "/worktree?wt=%2Fsample%2Frepo-a-wt",
  "/database?db=sample_db",
  "/journal",
  "/agents",
  "/help",
  "/tools",
  "/search?q=sample",
  "/file?path=src%2Fa.ts",
  "/file?path=src%2Fa.ts&view=blob",
  "/file?path=src%2Fa.ts&view=blame",
  "/file?path=src%2Fa.ts&view=history",
  "/file?path=src%2Fa.ts&target=HEAD",
  "/file?path=src%2Fa.ts&preview=1",
  "/file",
  "/sample-unknown",
];

const LOOKS: Array<{ name: string; look: Look }> = [
  { name: "控えなし", look: {} },
  {
    name: "広げた一覧と木・左を畳んだ",
    look: { navCollapsed: true, historyWidth: 420, sidebarWidth: 300 },
  },
  {
    name: "利用者がファイル一覧を畳んだ・左 320",
    look: { sidebarHidden: true, navWidth: 320 },
  },
];

describe("#first-screen は app.ts と同じ印を付ける", () => {
  for (const { name, look } of LOOKS)
    for (const width of [1100, 1280, 1600, 1900])
      test.each(URLS)(`${name}・窓 ${width}: %s`, (url) => {
        const { nav } = runFirstScreen(url, width, look);
        expect(actual()).toEqual(expected(url, width, look, nav));
      });

  test("控えの幅は html に書き、app.ts が書くまでの間も同じ幅で描く", () => {
    runFirstScreen("/", 1280, { sidebarWidth: 300, historyWidth: 420 });
    const style = document.documentElement.style;
    expect([
      style.getPropertyValue("--sidebar-w"),
      style.getPropertyValue("--history-w"),
    ]).toEqual(["300px", "420px"]);
  });

  test("骨格の変数が長さでなければ理由つきで投げる (黙って既定で描かない)", () => {
    (
      window as unknown as { happyDOM: { setURL(url: string): void } }
    ).happyDOM.setURL("http://127.0.0.1/history");
    const real = window.getComputedStyle.bind(window);
    window.getComputedStyle = (() => ({
      getPropertyValue: () => "",
    })) as unknown as typeof window.getComputedStyle;
    try {
      expect(() => new Function(inlineScript("first-screen"))()).toThrow(
        /--nav-w is not a length/,
      );
    } finally {
      window.getComputedStyle = real;
    }
  });
});

describe("#first-status は setStatus と同じ文言を同じ並びで重ねる", () => {
  function runFirstStatus(url: string, look: Look): string {
    (
      window as unknown as { happyDOM: { setURL(url: string): void } }
    ).happyDOM.setURL(`http://127.0.0.1${url}`);
    localStorage.setItem("code-viewer:early-look", JSON.stringify(look));
    document.body.innerHTML =
      '<span id="status"><span class="status-label"></span></span>';
    new Function(inlineScript("first-status"))();
    return document.querySelector("#status .status-label")?.innerHTML ?? "";
  }

  function rendered(language: "en" | "ja"): string {
    const host = document.createElement("span");
    const text = STATUS_LABEL_TEXT[language];
    renderStatusLabel(
      host,
      [text.live, text.loading, text.error, text.idle],
      text.idle,
    );
    return host.innerHTML;
  }

  test.each([
    { name: "控えなし", url: "/", look: {}, language: "en" as const },
    {
      name: "控え ja",
      url: "/",
      look: { language: "ja" as const },
      language: "ja" as const,
    },
    {
      name: "控え en",
      url: "/",
      look: { language: "en" as const },
      language: "en" as const,
    },
    {
      name: "?lang=ja が控えに勝つ",
      url: "/?lang=ja",
      look: { language: "en" as const },
      language: "ja" as const,
    },
    {
      name: "?lang=en が控えに勝つ",
      url: "/?lang=en",
      look: { language: "ja" as const },
      language: "en" as const,
    },
  ])("$name → $language", ({ url, look, language }) => {
    expect(runFirstStatus(url, look)).toBe(rendered(language));
  });
});

describe("ファイル一覧を畳むボタンは最初から頭の行の右端にある", () => {
  test("index.html: 絵柄の後の .view-head-row の中に #sidebar-toggle が 1 つ", () => {
    // 読み込み (link・script) は外して形だけを読む (happy-dom が取りに行く)。
    const markup = html
      .replace(/<link [^>]*>/g, "")
      .replace(/<script[\s\S]*?<\/script>/g, "");
    const page = new DOMParser().parseFromString(markup, "text/html");
    const toggles = page.querySelectorAll("#sidebar-toggle");
    const toggle = toggles[0];
    const row = toggle?.parentElement;
    expect({
      count: toggles.length,
      row: row?.className,
      afterStrip: row?.previousElementSibling?.classList.contains("view-strip"),
      head: row?.parentElement?.id,
    }).toEqual({
      count: 1,
      row: "view-head-row",
      afterStrip: true,
      head: "view-head",
    });
  });
});

// 一覧の列の頭の 1 段目 (いま見ているプロジェクト) は、app.ts が控えた
// (views/shell/early-look.ts の rememberEarlyProject) 名前・ブランチ・頭文字を、
// #first-project が最初の描画で出す。控えはプロジェクトの鍵 (`/p/<鍵>`) ごと。
describe("頭の 1 段目のプロジェクトは最初の描画から控えで出す (#first-project)", () => {
  const KEY_A = "0123456789abcdef";
  const KEY_B = "fedcba9876543210";
  const SAMPLE = {
    name: "sample-app",
    branch: "main",
    mark: "SA",
    color: "green" as const,
  };
  const OTHER = {
    name: "other-app",
    branch: "topic",
    mark: "OA",
    color: "blue" as const,
  };

  function runFirstProject(url: string, look: Look | null) {
    const markup = html
      .replace(/<link [^>]*>/g, "")
      .replace(/<script[\s\S]*?<\/script>/g, "");
    const page = new DOMParser().parseFromString(markup, "text/html");
    const head = page.getElementById("panel-head");
    if (!head) throw new Error("index.html has no #panel-head");
    document.body.innerHTML = head.outerHTML;
    (
      window as unknown as { happyDOM: { setURL(url: string): void } }
    ).happyDOM.setURL(`http://127.0.0.1${url}`);
    if (look)
      localStorage.setItem("code-viewer:early-look", JSON.stringify(look));
    new Function(inlineScript("first-project"))();
    const branch = document.getElementById("project-branch");
    return {
      name: document.getElementById("project-title")?.textContent,
      title: document.getElementById("project-title")?.title,
      label: document
        .getElementById("project-switcher")
        ?.getAttribute("aria-label"),
      mark: document.getElementById("project-mark")?.textContent,
      color: document.getElementById("project-mark")?.dataset.projectColor,
      branch: branch?.hidden
        ? null
        : branch?.querySelector(".project-branch-name")?.textContent,
    };
  }

  const shown = (
    project: { name: string; mark: string; color: string | null },
    branch: string | null,
  ) => ({
    name: project.name,
    title: project.name,
    label: project.name,
    mark: project.mark,
    color: project.color ?? "none",
    branch,
  });
  // 控えが無ければ、四角は色なし (index.html の既定) で中身は空。
  const empty = {
    name: "",
    title: "",
    label: null,
    mark: "",
    color: "none",
    branch: null,
  };

  test.each([
    {
      name: "入口の下の画面: その鍵の控え",
      url: `/p/${KEY_A}/history`,
      look: { projects: withEarlyProject({}, KEY_A, SAMPLE) },
      expected: shown(SAMPLE, "main"),
    },
    {
      name: "ほかのプロジェクトの控えがあっても、その鍵の控えだけ",
      url: `/p/${KEY_B}/`,
      look: {
        projects: withEarlyProject(
          withEarlyProject({}, KEY_B, OTHER),
          KEY_A,
          SAMPLE,
        ),
      },
      expected: shown(OTHER, "topic"),
    },
    {
      name: "その鍵の控えが無い (初めて開いたプロジェクト): 空のまま",
      url: `/p/${KEY_B}/file?path=README.md`,
      look: { projects: withEarlyProject({}, KEY_A, SAMPLE) },
      expected: empty,
    },
    {
      name: "前置きの無い画面 (1 つで完結するサーバ): 鍵は空",
      url: "/todif?from=HEAD&to=worktree",
      look: { projects: withEarlyProject({}, "", SAMPLE) },
      expected: shown(SAMPLE, "main"),
    },
    {
      name: "ブランチが無い (HEAD が切り離されている): ブランチは出さない",
      url: `/p/${KEY_A}/`,
      look: {
        projects: withEarlyProject({}, KEY_A, { ...SAMPLE, branch: "" }),
      },
      expected: shown(SAMPLE, null),
    },
    {
      name: "色が分からない (登録していない) プロジェクト: 四角は色なし",
      url: `/p/${KEY_A}/`,
      look: {
        projects: withEarlyProject({}, KEY_A, { ...SAMPLE, color: null }),
      },
      expected: shown({ ...SAMPLE, color: null }, "main"),
    },
    {
      name: "控えが無い",
      url: `/p/${KEY_A}/`,
      look: null,
      expected: empty,
    },
    {
      name: "プロジェクトの控えを持たない古い控え",
      url: `/p/${KEY_A}/`,
      look: { sidebarWidth: 240 },
      expected: empty,
    },
  ])("$name", ({ url, look, expected }) => {
    expect(runFirstProject(url, look)).toEqual(expected);
  });
});

describe("プロジェクトの控えは最近のものから上限まで (withEarlyProject)", () => {
  const entry = (name: string) => ({
    name,
    branch: "main",
    mark: "SA",
    color: "violet" as const,
  });
  const keys = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      index.toString(16).padStart(16, "0"),
    );

  test.each([
    {
      name: "新しい鍵は最後に足す",
      before: ["a"],
      key: "b",
      after: ["a", "b"],
    },
    {
      name: "ある鍵は最後へ移して書き直す (ほかは残す)",
      before: ["a", "b", "c"],
      key: "a",
      after: ["b", "c", "a"],
    },
    {
      name: "上限を超えたら古いものから落とす",
      before: keys(EARLY_PROJECTS_MAX),
      key: "new",
      after: [...keys(EARLY_PROJECTS_MAX).slice(1), "new"],
    },
  ])("$name", ({ before, key, after }) => {
    const projects = Object.fromEntries(
      before.map((k) => [k, entry(`old-${k}`)]),
    );
    const next = withEarlyProject(projects, key, entry("fresh"));
    expect({ keys: Object.keys(next), written: next[key] }).toEqual({
      keys: after,
      written: entry("fresh"),
    });
  });
});

// このセッションで初めて控えを書くのが別の値 (テーマなど) でも、ほかの
// プロジェクトの控えは消さない (入口の下でプロジェクトを行き来すると、行った先
// ごとに控えが 1 つずつ残る)。
describe("控えを書き直しても、ほかのプロジェクトの控えは残る", () => {
  test.each([
    { name: "先に別の値を書く", first: "look" },
    { name: "先にプロジェクトを書く", first: "project" },
  ] as const)("$name", async ({ first }) => {
    vi.resetModules();
    const saved = {
      name: "saved-app",
      branch: "main",
      mark: "SA",
      color: "orange" as const,
    };
    localStorage.setItem(
      "code-viewer:early-look",
      JSON.stringify({ theme: "dark", projects: { aaaa: saved } }),
    );
    const early = await import("../views/shell/early-look");
    const here = {
      name: "sample-app",
      branch: "topic",
      mark: "SA",
      color: null,
    };
    if (first === "look") early.rememberEarlyLook({ theme: "light" });
    early.rememberEarlyProject("bbbb", here);
    early.rememberEarlyLook({ theme: "light" });
    const stored = JSON.parse(
      localStorage.getItem("code-viewer:early-look") ?? "{}",
    );
    expect({ theme: stored.theme, projects: stored.projects }).toEqual({
      theme: "light",
      projects: { aaaa: saved, bbbb: here },
    });
  });
});

// 作業ツリーの一覧だけの表示かは route だけで決まる (app.ts は画面の印と同じときに
// 付ける。worktree-view.ts が一覧を読むまで待つと、一覧が列の位置から本文へ動いた)。
describe("作業ツリーの一覧だけの表示 (worktreeOverview)", () => {
  test.each([
    { url: "/worktree", overview: true },
    { url: "/worktree?wt=%2Fsample%2Frepo-a-wt", overview: false },
    { url: "/history", overview: false },
    { url: "/", overview: false },
  ])("$url → $overview", ({ url, overview }) => {
    const parsed = new URL(`http://127.0.0.1${url}`);
    const route = parseRoute(parsed.pathname, parsed.search, {
      from: "HEAD",
      to: "worktree",
    });
    expect(worktreeOverview(route)).toBe(overview);
  });
});
