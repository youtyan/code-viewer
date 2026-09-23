// 電話の幅の骨格 (views/mobile-shell.ts): 部品の出し分け・引き出しと面の
// 開け閉め・下端の帯・端末の操作札・言語の切替。配置は CSS (mobile-shell-css.test.ts)。
import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import {
  PHONE_MEDIA_QUERY,
  type TerminalSoftKey,
  TOUCH_MEDIA_QUERY,
} from "../core/mobile-layout";
import { installMobileShell, type MobileShell } from "../views/mobile-shell";
import { q } from "./_test-helpers";

type Viewport = { width: number; height: number; coarse: boolean };

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

let shell: MobileShell | null = null;
let sent: TerminalSoftKey[] = [];
let focused = 0;
let routeClicks: string[] = [];
let language: "en" | "ja" = "en";

/** 作った media query の見張り。幅を変えたら change を送る。 */
let mediaLists: { list: EventTarget & { matches: boolean }; query: string }[] =
  [];
let current: Viewport = { width: 0, height: 0, coarse: false };

function matchesQuery(query: string): boolean {
  if (query === TOUCH_MEDIA_QUERY) return current.coarse;
  if (query === PHONE_MEDIA_QUERY)
    return current.width <= 640 || (current.coarse && current.height <= 500);
  throw new Error(`unexpected media query in test: ${query}`);
}

/**
 * 表示領域の幅・高さと指の画面かを決める。happy-dom は documentElement の
 * clientWidth を 0 で返し、matchMedia が pointer を知らないので、両方を差し替える。
 */
function setViewport(viewport: Viewport): void {
  current = viewport;
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    get: () => current.width,
  });
  Object.defineProperty(document.documentElement, "clientHeight", {
    configurable: true,
    get: () => current.height,
  });
  window.matchMedia = ((query: string) => {
    const list = Object.assign(new EventTarget(), {
      media: query,
      get matches() {
        return matchesQuery(query);
      },
    });
    mediaLists.push({ list, query });
    return list;
  }) as unknown as typeof window.matchMedia;
}

/** 窓の大きさが変わった (向きを変えた・窓を広げた)。 */
function resizeTo(viewport: Viewport): void {
  current = viewport;
  for (const { list } of mediaLists) list.dispatchEvent(new Event("change"));
}

function install(viewport: Viewport): MobileShell {
  setViewport(viewport);
  shell = installMobileShell({
    getLanguage: () => language,
    sendTerminalKey: (key) => sent.push(key),
    focusTerminal: () => {
      focused++;
    },
  });
  return shell;
}

const PHONE: Viewport = { width: 390, height: 844, coarse: true };
const DESKTOP: Viewport = { width: 1280, height: 800, coarse: false };
const TABLET: Viewport = { width: 1024, height: 1366, coarse: true };

beforeEach(() => {
  mediaLists = [];
  sent = [];
  focused = 0;
  routeClicks = [];
  language = "en";
  document.documentElement.lang = "en";
  document.body.className = "";
  document.body.innerHTML = `
    <div id="app">
      <aside id="app-nav">
        <button id="search-btn" type="button">Search</button>
        <div class="nav-project-head">
          <button class="nav-twisty" type="button">v</button>
          <button class="nav-project-toggle" type="button">repo-a</button>
        </div>
        <button class="nav-agent" type="button">agent</button>
        <a id="nav-board-link" data-route="agents" href="/agents">All agents</a>
      </aside>
      <div id="tabs-lead"></div>
      <header id="topbar"><div class="controls"></div></header>
      <div class="main-pane-host" data-side="left" data-kind="terminal">
        <textarea class="xterm-helper-textarea"></textarea>
      </div>
      <div id="panel-head">
        <a class="view-strip-item" data-route="repo" href="/">Files</a>
        <a class="view-strip-item" data-route="diff" href="/todif">Diff</a>
      </div>
      <aside id="sidebar">
        <ul id="filelist">
          <li class="tree-dir"><span class="dir-label">src</span></li>
          <li class="tree-file"><span class="file-label">a.ts</span></li>
        </ul>
      </aside>
      <aside id="history-panel"><div class="history-item">commit</div></aside>
    </div>`;
  for (const link of document.querySelectorAll<HTMLAnchorElement>("a")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      routeClicks.push(link.dataset.route ?? "");
    });
  }
});

afterEach(() => {
  shell?.dispose();
  shell = null;
});

function barButton(index: number): HTMLButtonElement {
  return q<HTMLButtonElement>(
    document,
    `#mobile-bar .mobile-bar-item:nth-child(${index})`,
  );
}

describe("幅の段で部品を出し分ける", () => {
  test.each([
    {
      name: "電話",
      viewport: PHONE,
      tier: "phone",
      menu: false,
      bar: false,
      keys: false,
    },
    {
      name: "デスクトップ",
      viewport: DESKTOP,
      tier: "desktop",
      menu: true,
      bar: true,
      keys: true,
    },
    {
      name: "指のタブレット (幅 1024)",
      viewport: TABLET,
      tier: "desktop",
      menu: true,
      bar: true,
      keys: false,
    },
    {
      name: "横向きの電話 (844×390)",
      viewport: { width: 844, height: 390, coarse: true },
      tier: "phone",
      menu: false,
      bar: false,
      keys: false,
    },
  ])("$name: 段 $tier・メニューの hidden $menu・帯の hidden $bar・札の hidden $keys", ({
    viewport,
    tier,
    menu,
    bar,
    keys,
  }) => {
    const created = install(viewport);
    expect(created.tier()).toBe(tier);
    expect(q<HTMLElement>(document, "#mobile-nav-open").hidden).toBe(menu);
    expect(q<HTMLElement>(document, "#mobile-bar").hidden).toBe(bar);
    expect(q<HTMLElement>(document, "#mobile-scrim").hidden).toBe(bar);
    expect(q<HTMLElement>(document, "#mobile-keys").hidden).toBe(keys);
  });

  test("デスクトップでは body の class も引き出しの inert も付けない", () => {
    install(DESKTOP);
    expect(document.body.className).toBe("");
    expect(q<HTMLElement>(document, "#app-nav").inert).toBe(false);
  });

  test("引き出しを開くボタンはタブ列の左の先頭に入る", () => {
    install(PHONE);
    expect(q<HTMLElement>(document, "#tabs-lead").firstElementChild?.id).toBe(
      "mobile-nav-open",
    );
  });
});

describe("デスクトップの見た目を変えない (実物の style.css)", () => {
  // hidden は UA の [hidden] { display: none } で消える。author の規則が display を
  // 決めると hidden が負けて場所を取る (引き出しのボタンに global-icon-action を
  // 付けたら、デスクトップのタブ列の左が 28px 広がった)。happy-dom は UA の
  // [hidden] を当てないので、「author の規則が display を付けていない」=「同じ
  // タグの素の要素と同じ display」で見る。happy-dom の窓は 1024 幅でマウス。
  test.each([
    "#mobile-nav-open",
    "#mobile-bar",
    "#mobile-scrim",
    "#mobile-keys",
    ".mobile-wrap-toggle",
  ])("%s には display を付けない", (selector) => {
    const style = document.createElement("style");
    style.textContent = readFileSync("web/style.css", "utf8");
    document.head.appendChild(style);
    try {
      install(DESKTOP);
      const added = q<HTMLElement>(document, selector);
      expect(added.hidden).toBe(true);
      const bare = document.createElement(added.tagName);
      document.body.appendChild(bare);
      expect(getComputedStyle(added).display).toBe(
        getComputedStyle(bare).display,
      );
    } finally {
      style.remove();
    }
  });
});

describe("幅の段が変わったとき", () => {
  test("電話からデスクトップへ広げたら、開いていた引き出しを閉じて部品を隠す", () => {
    const created = install(PHONE);
    created.openDrawer();
    resizeTo(DESKTOP);
    expect(created.tier()).toBe("desktop");
    expect(document.body.classList.contains("mobile-nav-open")).toBe(false);
    expect(q<HTMLElement>(document, "#mobile-bar").hidden).toBe(true);
    expect(q<HTMLElement>(document, "#app-nav").inert).toBe(false);
  });

  test("デスクトップから電話へ狭めたら、部品を出して引き出しを閉じた状態にする", () => {
    const created = install(DESKTOP);
    resizeTo(PHONE);
    expect(created.tier()).toBe("phone");
    expect(q<HTMLElement>(document, "#mobile-bar").hidden).toBe(false);
    expect(q<HTMLElement>(document, "#app-nav").inert).toBe(true);
  });
});

describe("引き出し (左のサイドバー)", () => {
  test("閉じている間は Tab で入れず、開くと入れて先頭にフォーカスが移る", () => {
    install(PHONE);
    const nav = q<HTMLElement>(document, "#app-nav");
    expect(nav.inert).toBe(true);
    barButton(1).click();
    expect(document.body.classList.contains("mobile-nav-open")).toBe(true);
    expect(barButton(1).getAttribute("aria-expanded")).toBe("true");
    expect(q(document, "#mobile-nav-open").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(nav.inert).toBe(false);
    expect(document.activeElement?.id).toBe("search-btn");
  });

  test.each([
    { name: "エージェントの行", selector: ".nav-agent", closes: true },
    {
      name: "プロジェクトの名前 (移る)",
      selector: ".nav-project-toggle",
      closes: true,
    },
    { name: "全体ボードのリンク", selector: "#nav-board-link", closes: true },
    { name: "検索の入口", selector: "#search-btn", closes: true },
    {
      name: "プロジェクトの山形 (畳むだけ)",
      selector: ".nav-twisty",
      closes: false,
    },
  ])("$name を押すと閉じる: $closes", ({ selector, closes }) => {
    install(PHONE);
    q<HTMLButtonElement>(document, "#mobile-nav-open").click();
    q<HTMLElement>(document, selector).click();
    expect(document.body.classList.contains("mobile-nav-open")).toBe(!closes);
  });

  test("押した行が描き直しで外されても閉じる (捕捉の段で見る)", () => {
    install(PHONE);
    q<HTMLButtonElement>(document, "#mobile-nav-open").click();
    const row = q<HTMLElement>(document, ".nav-agent");
    row.addEventListener("click", () => row.remove());
    row.click();
    expect(document.body.classList.contains("mobile-nav-open")).toBe(false);
  });

  test.each([
    {
      name: "Escape",
      act: () =>
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    },
    {
      name: "暗い覆い",
      act: () => q<HTMLElement>(document, "#mobile-scrim").click(),
    },
    {
      name: "同じボタンをもう一度",
      act: () => q<HTMLButtonElement>(document, "#mobile-nav-open").click(),
    },
  ])("$name で閉じ、開く前のフォーカスへ戻す", ({ act }) => {
    install(PHONE);
    const opener = q<HTMLButtonElement>(document, "#mobile-nav-open");
    opener.focus();
    opener.click();
    act();
    expect(document.body.classList.contains("mobile-nav-open")).toBe(false);
    expect(q<HTMLElement>(document, "#app-nav").inert).toBe(true);
    expect(document.activeElement).toBe(opener);
  });
});

describe("面 (右の列と一覧の列) と下端の帯", () => {
  test("一覧のボタンで面を開き、引き出しとは同時に開かない", () => {
    install(PHONE);
    barButton(1).click();
    barButton(5).click();
    expect(document.body.classList.contains("mobile-sheet-open")).toBe(true);
    expect(document.body.classList.contains("mobile-nav-open")).toBe(false);
    expect(barButton(5).getAttribute("aria-expanded")).toBe("true");
  });

  test.each([
    {
      name: "ファイルの行",
      selector: "#filelist .tree-file .file-label",
      closes: true,
    },
    // 面の下の段にそのコミットの変更ファイルが出るので、続けて選べるよう閉じない。
    { name: "コミットの行", selector: ".history-item", closes: false },
    {
      name: "画面の入口",
      selector: '.view-strip-item[data-route="diff"]',
      closes: true,
    },
    {
      name: "フォルダの行 (開くだけ)",
      selector: "#filelist .tree-dir .dir-label",
      closes: false,
    },
  ])("$name を押すと面を閉じる: $closes", ({ selector, closes }) => {
    install(PHONE);
    barButton(5).click();
    q<HTMLElement>(document, selector).click();
    expect(document.body.classList.contains("mobile-sheet-open")).toBe(!closes);
  });

  test.each([
    { name: "ファイル", index: 2, route: "repo" },
    { name: "差分", index: 3, route: "diff" },
    { name: "エージェント", index: 4, route: "agents" },
  ])("帯の $name は既存の入口のリンクを押す", ({ index, route }) => {
    install(PHONE);
    barButton(5).click();
    barButton(index).click();
    expect(routeClicks).toEqual([route]);
    expect(document.body.classList.contains("mobile-sheet-open")).toBe(false);
  });
});

describe("端末の操作札", () => {
  test.each<{ key: TerminalSoftKey }>([
    { key: "escape" },
    { key: "tab" },
    { key: "shiftTab" },
    { key: "ctrlC" },
    { key: "up" },
    { key: "down" },
    { key: "enter" },
  ])("$key の札は端末へそのキーを送る", ({ key }) => {
    install(PHONE);
    q<HTMLButtonElement>(document, `#mobile-keys [data-key="${key}"]`).click();
    expect(sent).toEqual([key]);
  });

  test("キーボードの札は端末に入力を向ける", () => {
    install(PHONE);
    q<HTMLButtonElement>(document, "#mobile-keys .mobile-key-keyboard").click();
    expect(focused).toBe(1);
  });

  // ⌨ は出す / しまうの切替。端末に入力が向いている (キーボードが出ている) 間は
  // 入力を外してしまい、名前も「しまう」になる。
  test("キーボードの札は、端末に入力が向いていればしまう", () => {
    install(PHONE);
    const keyboard = q<HTMLButtonElement>(
      document,
      "#mobile-keys .mobile-key-keyboard",
    );
    const input = q<HTMLTextAreaElement>(document, ".xterm-helper-textarea");
    input.focus();
    const whileTyping = keyboard.getAttribute("aria-label");
    keyboard.click();
    expect({
      whileTyping,
      focusedTerminal: focused,
      inputStillFocused: document.activeElement === input,
      after: keyboard.getAttribute("aria-label"),
    }).toEqual({
      whileTyping: "Hide keyboard",
      focusedTerminal: 0,
      inputStillFocused: false,
      after: "Show keyboard",
    });
  });

  test("札を押してもフォーカスを端末から奪わない (pointerdown を止める)", () => {
    install(PHONE);
    const event = new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
    });
    q<HTMLButtonElement>(
      document,
      '#mobile-keys [data-key="enter"]',
    ).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("言語", () => {
  test("html の lang が変わると帯と札の名前を当て直す", async () => {
    install(PHONE);
    expect(barButton(3).textContent).toBe("Diff");
    expect(
      q(document, '#mobile-keys [data-key="ctrlC"]').getAttribute("aria-label"),
    ).toBe("Control+C (interrupt)");
    language = "ja";
    document.documentElement.lang = "ja";
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(barButton(3).textContent).toBe("差分");
    expect(
      q(document, '#mobile-keys [data-key="ctrlC"]').getAttribute("aria-label"),
    ).toBe("Ctrl+C (中断)");
    expect(q(document, '#mobile-keys [data-key="ctrlC"]').textContent).toBe(
      "Ctrl+C",
    );
  });
});

describe("dispose", () => {
  test("足した部品を外し、引き出しの inert を戻す", () => {
    const created = install(PHONE);
    created.openDrawer();
    created.dispose();
    shell = null;
    expect(
      document.querySelector(
        "#mobile-bar, #mobile-keys, #mobile-scrim, #mobile-nav-open",
      ),
    ).toBeNull();
    expect(document.body.classList.contains("mobile-nav-open")).toBe(false);
    expect(q<HTMLElement>(document, "#app-nav").inert).toBe(false);
  });
});

describe("差分の折り返し (Diff の上の帯の端)", () => {
  test("電話の段だけに出し、押すと body の印と押した状態が切り替わる", () => {
    install(PHONE);
    const toggle = q<HTMLButtonElement>(
      document,
      "#topbar .mobile-wrap-toggle",
    );
    const shown = !toggle.hidden;
    toggle.click();
    const on = [
      document.body.classList.contains("mobile-diff-wrap"),
      toggle.getAttribute("aria-pressed"),
    ];
    toggle.click();
    expect({
      shown,
      on,
      off: [
        document.body.classList.contains("mobile-diff-wrap"),
        toggle.getAttribute("aria-pressed"),
      ],
      label: toggle.textContent,
    }).toEqual({
      shown: true,
      on: [true, "true"],
      off: [false, "false"],
      label: "Wrap",
    });
  });

  test("デスクトップでは出さない", () => {
    install(DESKTOP);
    expect(q<HTMLButtonElement>(document, ".mobile-wrap-toggle").hidden).toBe(
      true,
    );
  });
});

describe("下端の帯の今の画面と入力待ちの件数", () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const current = () =>
    [...document.querySelectorAll("#mobile-bar .mobile-bar-item")]
      .filter((item) => item.getAttribute("aria-current") === "page")
      .map((item) => item.querySelector(".mobile-bar-label")?.textContent);

  test("画面の印に合わせて印を付け、前面がタブ (端末など) の間は外す", async () => {
    install(PHONE);
    document.body.classList.add("gdp-diff-page");
    await tick();
    const onDiff = current();
    q(document, '.main-pane-host[data-side="left"]').classList.add("is-shown");
    await tick();
    const underTerminal = current();
    q(document, '.main-pane-host[data-side="left"]').classList.remove(
      "is-shown",
    );
    document.body.classList.replace("gdp-diff-page", "gdp-agents-page");
    await tick();
    expect({ onDiff, underTerminal, onAgents: current() }).toEqual({
      onDiff: ["Diff"],
      underTerminal: [],
      onAgents: ["Agents"],
    });
  });

  test("入力待ちがあれば「エージェント」に件数の札を出し、名前にも添える", () => {
    const created = install(PHONE);
    const agents = barButton(4);
    const badge = q<HTMLElement>(agents, ".mobile-bar-badge");
    created.setWaitingAgents(2);
    const waiting = [
      badge.hidden,
      badge.textContent,
      agents.getAttribute("aria-label"),
    ];
    created.setWaitingAgents(0);
    expect({
      waiting,
      none: [
        badge.hidden,
        badge.textContent,
        agents.getAttribute("aria-label"),
      ],
    }).toEqual({
      waiting: [false, "2", "Agents (2 need input)"],
      none: [true, "", "Agents"],
    });
  });
});

describe("引き出しは指に付いて動く", () => {
  function touch(type: string, x: number, y = 100) {
    const point = {
      clientX: x,
      clientY: y,
      identifier: 0,
      target: document.body,
    };
    document.dispatchEvent(
      new TouchEvent(type, {
        bubbles: true,
        touches: type === "touchend" ? [] : [point as unknown as Touch],
        changedTouches: [point as unknown as Touch],
      }),
    );
  }

  test("左端から右へ動かしている間は引き出しに位置が付き、離すと外して開く", () => {
    install(PHONE);
    const nav = q<HTMLElement>(document, "#app-nav");
    touch("touchstart", 4);
    touch("touchmove", 104);
    const dragging = {
      transform: nav.style.transform,
      transition: nav.style.transition,
    };
    touch("touchend", 104);
    expect({
      dragging,
      released: nav.style.transform,
      open: document.body.classList.contains("mobile-nav-open"),
    }).toEqual({
      dragging: { transform: "translateX(0px)", transition: "none" },
      released: "",
      open: true,
    });
  });

  test("縦のスクロールでは動かさない", () => {
    install(PHONE);
    const nav = q<HTMLElement>(document, "#app-nav");
    touch("touchstart", 4, 100);
    touch("touchmove", 20, 300);
    expect(nav.style.transform).toBe("");
    touch("touchend", 20, 300);
  });
});
