// SP の骨格: 左のサイドバーの引き出し (drawer)・一覧の列 (ファイル一覧と、その
// 画面の一覧) を下から出す面 (sheet)・下端の切替の帯・端末の操作札。
//
// 配置と見た目は style.css 末尾の「Phone (SP)」の節が media query だけで決める
// (JS が動く前の初回描画から崩れない)。ここが持つのは開け閉めの状態
// (body の mobile-nav-open / mobile-sheet-open) と、デスクトップでは要らない
// 部品を hidden にすることだけ。デスクトップ (幅の段が desktop で、指の画面でも
// ない) では足した部品は全部 hidden で、骨格の class も付けない。
//
// 電話の段かは views/shell/workspace.ts の phoneMediaQuery (CSS の条件 PHONE_MEDIA_QUERY。
// 外側のページと面の中では電話の段に入らない)。

import { createRef, type Ref, ref } from "lit/directives/ref.js";
import { html, nothing } from "lit/html.js";
import {
  CHEVRON_DOWN_12_PATH,
  CHEVRON_LEFT_16_PATH,
  SIDEBAR_HIDE_16_PATHS,
  SIDEBAR_SHOW_16_PATHS,
} from "../core/icons";
import {
  bottomSwipeAction,
  drawerDragOffset,
  edgeSwipeAction,
  gestureAxis,
  LONG_PRESS_MS,
  LONG_PRESS_TARGETS,
  longPressMoved,
  type MobileBarView,
  mobileBarCurrent,
  mobileListAvailable,
  pinchFontSize,
  softKeyboardInset,
  TERMINAL_SOFT_KEYS,
  type TerminalSoftKey,
  TOUCH_MEDIA_QUERY,
  type ViewportTier,
} from "../core/mobile-layout";
import { MAX_TERMINAL_FONT_SIZE, MIN_TERMINAL_FONT_SIZE } from "../core/tmux";
import type { TabListEntry } from "./main-tabs/main-tabs-presenter";
import { CLOSE_ICON_PATH, pageIconPaths } from "./main-tabs/tab-icons";
import {
  type MobileShellLang,
  type MobileShellText,
  mobileShellText,
  SOFT_KEY_CAPS,
} from "./mobile-shell-i18n";
import {
  type ProjectLook,
  projectMarkTemplate,
} from "./projects/project-looks";
import { phoneMediaQuery } from "./shell/workspace";
import { iconTemplate } from "./ui/icon";
import { templateElement, templateFragment } from "./ui/renderer";

export type MobileShellDeps = {
  getLanguage(): MobileShellLang;
  /** 前面 (左の面) の端末へ操作札のキーを送る。 */
  sendTerminalKey(key: TerminalSoftKey): void;
  /** 前面 (左の面) の端末に入力を向ける (ソフトキーボードが出る)。 */
  focusTerminal(): void;
  /**
   * 開いているタブの一覧の面 (電話の段のタブ列の右端の入口から開く。
   * main-tabs-view.ts の tabList など)。無ければ面を作らない。
   */
  tabs?: MobileTabsDeps;
  /** 左の面の端末の文字の大きさ (電話の段の値)。ピンチで変える。 */
  terminalFontSize?(): number;
  setTerminalFontSize?(size: number): void;
};

export type MobileTabsDeps = {
  list(): TabListEntry[];
  bringToFront(id: string): void;
  close(id: string): void;
  /** タブ列を描き直したら呼ぶ。外す関数を返す。 */
  onRender(listener: () => void): () => void;
};

export type MobileShell = {
  /** 今の幅の段。 */
  tier(): ViewportTier;
  openDrawer(): void;
  openSheet(): void;
  /** 開いているタブの一覧の面を開く。 */
  openTabs(): void;
  /** 開いている引き出し・面を閉じる。 */
  close(): void;
  /** 下端の帯の「エージェント」に出す入力待ちの件数 (0 で札を隠す)。 */
  setWaitingAgents(count: number): void;
  /**
   * 左上のボタンに出す、いま見ているプロジェクト (色の四角と頭文字・名前)。
   * null なら引き出しの絵だけ。押すと引き出し (プロジェクトの一覧) が開く。
   */
  setProject(look: ProjectLook | null): void;
  /** 足した部品と見張りを外す (テスト用。アプリは一度だけ作る)。 */
  dispose(): void;
};

type Panel = "drawer" | "sheet" | "tabs";

const OPEN_CLASS: Record<Panel, string> = {
  drawer: "mobile-nav-open",
  sheet: "mobile-sheet-open",
  tabs: "mobile-tabs-open",
};

/** ピンチで端末の文字を変える場所 (左の面の端末)。 */
const TERMINAL_HOST = '.main-pane-host[data-side="left"][data-kind="terminal"]';

/** 押したら引き出しを閉じるもの (移る・開く)。山形や行の操作では閉じない。 */
const DRAWER_CLOSING_TARGETS =
  ".nav-agent, .nav-project-toggle, a[href], #nav-launch, #search-btn";

/**
 * 押したら面を閉じるもの (ファイル・コミット・画面の入口・タブ列)。変更ファイルの
 * 一覧のフォルダの行では閉じない (開閉するだけ)。ファイル一覧のフォルダの行は
 * そのフォルダを本文に開くので閉じる (開閉は三角とフォルダの絵。そこでは閉じない)。
 * コミットは閉じて、本文にそのコミットの差分を出す (閉じないと、
 * 押した結果が面の下に隠れ、何が起きたか分からない)。ファイルを絞りたいときは
 * 「一覧」を開き直すと、そのコミットの変更ファイルが面の下の段に出る。面は
 * タブ列の下を全部使い、タブ列は覆わない (＋のメニューなどが面の下に出る)。
 */
function closesSheet(target: Element): boolean {
  if (target.closest(".view-strip-item, .history-item, #main-tabs"))
    return true;
  if (target.closest("#file-list-rows .tree-dir"))
    return !target.closest(".chev, .dir-icon");
  // ファイル一覧 (#file-list-rows) と変更ファイルの一覧 (#filelist) の行。
  const row = target.closest("#filelist li, #file-list-rows li");
  return row !== null && !row.classList.contains("tree-dir");
}

function requireElement(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found)
    throw new Error(`mobile shell: ${selector} is missing from index.html`);
  return found;
}

/**
 * 電話の段の部品の描き方。部品は既存の画面 (#app・#topbar・タブ列) の中に
 * 置かれ、出し分けと文言は presenter が書き込むので、view は形だけを持つ。
 */
export type MobileShellView = {
  menuButton: (onClick: () => void) => unknown;
  /** 左上のボタンの中身。プロジェクトが分からない間は引き出しの絵。 */
  menuContent: (project: ProjectLook | null) => unknown;
  scrim: (onClick: () => void) => unknown;
  bar: (items: Node[]) => unknown;
  barButton: (
    paths: string | readonly string[],
    onClick: () => void,
  ) => unknown;
  agentsBadge: () => unknown;
  wrapButton: (onClick: () => void) => unknown;
  historyBackButton: (onClick: () => void) => unknown;
  /** 端末の操作札。ソフトキーボードに無いキーと、⌨ の出す・しまう。 */
  keys: (props: {
    onKey: (key: TerminalSoftKey) => void;
    onKeyboard: () => void;
  }) => unknown;
  /** 開いているタブの一覧の面。 */
  tabsSheet: (props: {
    refs: {
      title: Ref<HTMLElement>;
      close: Ref<HTMLButtonElement>;
      list: Ref<HTMLElement>;
    };
    onClose: () => void;
    onListClick: (event: Event) => void;
  }) => unknown;
  /** タブの一覧の中身 (プロジェクトごとのまとまり。空なら案内)。 */
  tabGroups: (props: {
    text: MobileShellText;
    groups: { project: ProjectLook | null; entries: TabListEntry[] }[];
  }) => unknown;
};

const tabsCloseIcon = () => iconTemplate(CLOSE_ICON_PATH, "mobile-tabs-x-icon");

function tabRowTemplate(entry: TabListEntry, t: MobileShellText): unknown {
  const closeLabel = t.closeTab(entry.name);
  return html`<li
    class=${[
      "mobile-tabs-row",
      entry.front ? "is-front" : "",
      entry.preview ? "is-preview" : "",
    ]
      .filter(Boolean)
      .join(" ")}
    data-tab-id=${entry.id}
  ><button
      type="button"
      class="mobile-tabs-open"
      title=${entry.title}
      aria-current=${entry.front ? "true" : nothing}
    ><span class="mobile-tabs-icon">${entry.icon}</span><span
        class="mobile-tabs-name"
        >${entry.name}</span
      >${
        entry.parked
          ? html`<span class="mobile-tabs-parked" title=${t.tabsParkedTitle}
              >${t.tabsParked}</span
            >`
          : nothing
      }</button
    ><button
      type="button"
      class="mobile-tabs-x"
      title=${closeLabel}
      aria-label=${closeLabel}
    >${tabsCloseIcon()}</button></li>`;
}

export const DEFAULT_VIEW: MobileShellView = {
  // global-icon-action を付けない: その規則は display を決めるので、デスクトップで
  // hidden にしても場所を取る (タブ列の左が 28px 広がった)。見た目は SP の節だけ。
  menuButton: (onClick) =>
    html`<button
      id="mobile-nav-open"
      type="button"
      class="mobile-nav-button"
      aria-controls="app-nav"
      @click=${onClick}
    ></button>`,
  menuContent: (project) =>
    project === null
      ? iconTemplate(SIDEBAR_SHOW_16_PATHS, "mobile-nav-icon")
      : html`${projectMarkTemplate(project, "mobile-nav-project-mark")}<span
            class="mobile-nav-project-chevron"
            >${iconTemplate(CHEVRON_DOWN_12_PATH, "mobile-nav-icon")}</span
          >`,
  scrim: (onClick) =>
    html`<div id="mobile-scrim" class="mobile-scrim" @click=${onClick}></div>`,
  bar: (items) => html`<nav id="mobile-bar" class="mobile-bar">${items}</nav>`,
  barButton: (paths, onClick) =>
    html`<button type="button" class="mobile-bar-item" @click=${onClick}
      >${iconTemplate(paths, "mobile-bar-icon")}<span
        class="mobile-bar-label"
      ></span></button
    >`,
  agentsBadge: () =>
    html`<span class="mobile-bar-badge" aria-hidden="true" hidden></span>`,
  // .controls の中に置かない: その規則は display を決めるので、デスクトップで
  // hidden にしても場所を取る。見た目は SP の節だけ。
  wrapButton: (onClick) =>
    html`<button type="button" class="mobile-wrap-toggle" @click=${onClick}></button>`,
  historyBackButton: (onClick) =>
    html`<button type="button" class="mobile-history-back" @click=${onClick}
      >${iconTemplate(CHEVRON_LEFT_16_PATH, "mobile-history-back-icon")}</button
    >`,
  // 押してもフォーカスを端末から奪わない (キーボードが閉じない)。
  keys: ({ onKey, onKeyboard }) =>
    html`<div
      id="mobile-keys"
      class="mobile-keys"
      role="toolbar"
      @pointerdown=${(event: Event) => {
        if ((event.target as Element).closest(".mobile-key"))
          event.preventDefault();
      }}
    >${TERMINAL_SOFT_KEYS.map(
      (key) =>
        html`<button
          type="button"
          class="mobile-key"
          data-key=${key}
          @click=${() => onKey(key)}
        >${SOFT_KEY_CAPS[key]}</button>`,
    )}<button
        type="button"
        class="mobile-key mobile-key-keyboard"
        @click=${onKeyboard}
      >⌨</button></div>`,
  tabsSheet: ({ refs, onClose, onListClick }) =>
    html`<section
      id="mobile-tabs"
      class="mobile-tabs"
      role="dialog"
      aria-labelledby="mobile-tabs-title"
    ><div class="mobile-tabs-head"><h2
          class="mobile-tabs-title"
          id="mobile-tabs-title"
          ${ref(refs.title)}
        ></h2><button
          type="button"
          class="mobile-tabs-x mobile-tabs-dismiss"
          ${ref(refs.close)}
          @click=${onClose}
        >${tabsCloseIcon()}</button></div
      ><ul class="mobile-tabs-list" ${ref(refs.list)} @click=${onListClick}></ul></section>`,
  tabGroups: ({ text: t, groups }) =>
    groups.length === 0
      ? html`<li class="mobile-tabs-empty">${t.tabsEmpty}</li>`
      : groups.map(({ project, entries }) => {
          const name = project?.name ?? t.tabsShared;
          return html`<li class="mobile-tabs-group"><div
              class="mobile-tabs-group-head"
            >${project ? projectMarkTemplate(project) : nothing}<span
                class="mobile-tabs-group-name"
                >${name}</span
              ></div
            ><ul class="mobile-tabs-group-list" aria-label=${name}>${entries.map(
              (entry) => tabRowTemplate(entry, t),
            )}</ul></li>`;
        }),
};

export function installMobileShell(
  deps: MobileShellDeps,
  view: MobileShellView = DEFAULT_VIEW,
): MobileShell {
  const app = requireElement("#app");
  const nav = requireElement("#app-nav");
  const lead = requireElement("#tabs-lead");
  const phoneQuery = phoneMediaQuery();
  const touchQuery = window.matchMedia(TOUCH_MEDIA_QUERY);

  const topbar = requireElement("#topbar");
  const listening = new AbortController();
  const { signal } = listening;
  let current: ViewportTier = "desktop";
  let open: Panel | null = null;
  let waitingAgents = 0;
  /** 左上のボタンに出しているプロジェクト (setProject)。 */
  let project: ProjectLook | null = null;
  /** 左上のボタンを最後に描いた中身 (同じなら描き直さない)。 */
  let menuButtonSignature = "";
  /** 開く前にフォーカスがあった場所 (閉じたら戻す)。 */
  let returnFocus: HTMLElement | null = null;

  const menuButton = templateElement<HTMLButtonElement>(
    view.menuButton(() => toggle("drawer")),
  );
  lead.prepend(menuButton);

  const scrim = templateElement(view.scrim(() => close()));

  // 下端の切替の帯。電話で使う 3 場面 (エージェント・Diff とファイル・
  // プロジェクト) の入口だけを置く。画面へ移るものは既存の入口のリンクを
  // 押す (タブの開き方・URL は入口と同じ経路に任せる)。
  const barItems = {
    projects: barButton(SIDEBAR_SHOW_16_PATHS, () => toggle("drawer")),
    files: barButton(pageIconPaths("repo"), () =>
      followLink('a.view-strip-item[data-route="repo"]'),
    ),
    diff: barButton(pageIconPaths("diff"), () =>
      followLink('a.view-strip-item[data-route="diff"]'),
    ),
    agents: barButton(pageIconPaths("agents"), () =>
      followLink("#nav-board-link"),
    ),
    list: barButton(SIDEBAR_HIDE_16_PATHS, () => toggle("sheet")),
  };
  barItems.projects.setAttribute("aria-controls", "app-nav");
  // 面に出すのはファイル一覧か、一覧を出す画面ではその一覧 (style.css の SP の節)。
  barItems.list.setAttribute("aria-controls", "file-list sidebar");
  const bar = templateElement(view.bar(Object.values(barItems)));
  // 「エージェント」の入力待ちの件数の札 (最下段の件数と同じ数え方。app.ts が渡す)。
  const agentsBadge = templateElement(view.agentsBadge());
  barItems.agents.append(agentsBadge);
  const pageViews: Record<MobileBarView, HTMLButtonElement> = {
    files: barItems.files,
    diff: barItems.diff,
    agents: barItems.agents,
  };

  // 差分の長い行を折り返す切替 (電話の段だけ。Diff の上の帯の端に置く)。
  // .controls の中に置かない: その規則は display を決めるので、デスクトップで
  // hidden にしても場所を取る。見た目は SP の節だけ。状態はこのセッションだけ。
  // 既定は折り返す (幅 390 では長い行を横に送って読むことになった)。印は電話の
  // 段の間だけ付ける (apply)。
  let diffWrap = true;
  const wrapButton = templateElement<HTMLButtonElement>(
    view.wrapButton(() => {
      diffWrap = !diffWrap;
      syncDiffWrap();
    }),
  );
  topbar.append(wrapButton);

  // History の選んだコミットの差分から一覧へ戻る ‹ (上の帯の左端)。差分の頭の
  // 「‹ 履歴の一覧」は差分と一緒に流れ、下まで読むと戻る所が無かった。戻り方は
  // その頭のボタン (history-view.ts の backToList) に任せる。出すのはそのボタンが
  // ある間だけ (style.css の SP の節)。
  const historyBackButton = templateElement<HTMLButtonElement>(
    view.historyBackButton(() =>
      requireElement("#history-commit-info .hci-back").click(),
    ),
  );
  topbar.prepend(historyBackButton);

  // 端末の操作札。ソフトキーボードに無いキー (Esc・Ctrl+C・矢印) と、確定の
  // Enter。押してもフォーカスを端末から奪わない (キーボードが閉じない)。
  const keys = templateElement(
    view.keys({
      onKey: (key) => deps.sendTerminalKey(key),
      // ⌨ は出す / しまうの切替。端末に入力が向いていれば (キーボードが出ている)
      // 外してしまい、向いていなければ端末に向けて出す。
      onKeyboard: () => {
        const typing = terminalTyping();
        if (typing) typing.blur();
        else deps.focusTerminal();
        localize();
      },
    }),
  );
  const keyButtons = [
    ...keys.querySelectorAll<HTMLButtonElement>(".mobile-key[data-key]"),
  ];
  const keyboardButton = keys.querySelector<HTMLButtonElement>(
    ".mobile-key-keyboard",
  );
  if (!keyboardButton)
    throw new Error("mobile shell: the keyboard key was not drawn");

  // 開いているタブの一覧の面 (電話の段)。タブ列の右端の入口 (main-tabs-view.ts
  // の listButton) から開く。行を押すとそのタブを前面に出して閉じ、×でタブを
  // 閉じる (面は開いたまま)。
  const tabsRefs = {
    title: createRef<HTMLElement>(),
    close: createRef<HTMLButtonElement>(),
    list: createRef<HTMLElement>(),
  };
  const tabs = deps.tabs;
  const tabsSheet = tabs
    ? templateElement(
        view.tabsSheet({
          refs: tabsRefs,
          onClose: () => close(),
          onListClick: (event) => {
            const target = event.target as Element;
            const row = target.closest<HTMLElement>(".mobile-tabs-row");
            const id = row?.dataset.tabId;
            if (!id) return;
            if (target.closest(".mobile-tabs-x")) {
              tabs.close(id);
              return;
            }
            close();
            tabs.bringToFront(id);
          },
        }),
      )
    : null;
  let stopTabsRender: (() => void) | null = null;
  if (tabs)
    stopTabsRender = tabs.onRender(() => {
      if (open === "tabs") renderTabs();
    });

  app.append(scrim, keys, bar, ...(tabsSheet ? [tabsSheet] : []));

  /** タブの一覧の面の中身を今のタブから組み直す (×の後も面は開いたまま)。 */
  function renderTabs(): void {
    if (!deps.tabs) return;
    const tabsTitle = tabsRefs.title.value;
    const tabsCloseButton = tabsRefs.close.value;
    const tabsList = tabsRefs.list.value;
    if (!tabsTitle || !tabsCloseButton || !tabsList)
      throw new Error("mobile shell: the tab list was not drawn");
    const t = text();
    const entries = deps.tabs.list();
    tabsTitle.textContent = t.tabsTitle(entries.length);
    tabsCloseButton.title = t.close;
    tabsCloseButton.setAttribute("aria-label", t.close);
    // 閉じたタブの行にフォーカスがあったら、同じ位置の行 (無ければ前の行) へ移す。
    const focusedRow =
      document.activeElement instanceof HTMLElement &&
      tabsList.contains(document.activeElement)
        ? [...tabsList.querySelectorAll(".mobile-tabs-row")].indexOf(
            document.activeElement.closest(".mobile-tabs-row") as Element,
          )
        : -1;
    if (entries.length === 0) {
      tabsList.replaceChildren(
        templateFragment(view.tabGroups({ text: t, groups: [] })),
      );
      return;
    }
    // プロジェクトごとにまとめる (タブ列のグループと同じ)。並びは最初に出てきた
    // 順で、どのプロジェクトのものでもないタブは最後。
    const groups = new Map<string | null, TabListEntry[]>();
    for (const entry of entries) {
      const key = entry.project?.root ?? null;
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    const shared = groups.get(null);
    groups.delete(null);
    if (shared) groups.set(null, shared);
    tabsList.replaceChildren(
      templateFragment(
        view.tabGroups({
          text: t,
          groups: [...groups.values()].map((group) => ({
            project: group[0]?.project ?? null,
            entries: group,
          })),
        }),
      ),
    );
    if (focusedRow >= 0) {
      const rows = tabsList.querySelectorAll<HTMLElement>(".mobile-tabs-open");
      rows[Math.min(focusedRow, rows.length - 1)]?.focus({
        preventScroll: true,
      });
    }
  }

  function barButton(
    paths: string | string[],
    onClick: () => void,
  ): HTMLButtonElement {
    return templateElement<HTMLButtonElement>(view.barButton(paths, onClick));
  }

  /** 左の面の端末に入力が向いているなら、その要素 (xterm の入力欄)。 */
  function terminalTyping(): HTMLElement | null {
    const active = document.activeElement;
    return active instanceof HTMLElement &&
      active.closest('.main-pane-host[data-side="left"][data-kind="terminal"]')
      ? active
      : null;
  }

  function hasPageClass(name: string): boolean {
    return document.body.classList.contains(name);
  }

  /** 左の面の前面がタブ (端末・画像など) で、画面が隠れているか。 */
  function coveredByTab(): boolean {
    return (
      document
        .querySelector('.main-pane-host[data-side="left"]')
        ?.classList.contains("is-shown") ?? false
    );
  }

  /**
   * 今の画面に一覧があるか。帯の「一覧」と面はその画面だけ (画面を移った直後
   * でも正しいように、見張りを待たずに body の印から読む)。
   */
  function listAvailable(): boolean {
    return mobileListAvailable(
      hasPageClass,
      coveredByTab(),
      document.body.hasAttribute("data-worktree-overview"),
    );
  }

  /**
   * 帯の入口に「いま見ている画面」の印と、入力待ちの件数を付け直す。開いたまま
   * 一覧の無い画面へ移ったら面を閉じる。
   */
  function syncBar(): void {
    const now = mobileBarCurrent(hasPageClass, coveredByTab());
    barItems.list.hidden = !listAvailable();
    if (barItems.list.hidden && open === "sheet") close();
    for (const [view, button] of Object.entries(pageViews)) {
      if (view === now) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    agentsBadge.hidden = waitingAgents === 0;
    agentsBadge.textContent = waitingAgents > 0 ? String(waitingAgents) : "";
    const t = text();
    const agentsLabel =
      waitingAgents > 0 ? t.agentsWaiting(waitingAgents) : t.agents;
    barItems.agents.title = agentsLabel;
    barItems.agents.setAttribute("aria-label", agentsLabel);
  }

  function followLink(selector: string): void {
    close();
    requireElement(selector).click();
  }

  function text(): MobileShellText {
    return mobileShellText(deps.getLanguage());
  }

  /**
   * 左上のボタン: いまのプロジェクトの色の四角と頭文字・▾ (タブ列はこのプロジェクトの
   * タブだけなので、どのプロジェクトのタブかがここで分かる)。名前は出さない (名前
   * まで並べるとタブが 1 枚半しか見えなかった)。名前は引き出しと読み上げに出す。
   * 分からない間は引き出しの絵。
   */
  function renderMenuButton(): void {
    const t = text();
    // 中身が同じなら作り直さない: 押した瞬間 (フォーカスが移る) にも呼ばれ、
    // 押した要素を入れ替えると離したときの click が出ず、引き出しが開かなかった。
    const signature = JSON.stringify([
      t.projects,
      project && [project.name, project.initials, project.color],
    ]);
    if (signature === menuButtonSignature) return;
    menuButtonSignature = signature;
    menuButton.classList.toggle("mobile-nav-project", project !== null);
    menuButton.replaceChildren(templateFragment(view.menuContent(project)));
    if (!project) {
      menuButton.title = t.projects;
      menuButton.setAttribute("aria-label", t.projects);
      return;
    }
    const label = `${t.projects}: ${project.name}`;
    menuButton.title = label;
    menuButton.setAttribute("aria-label", label);
  }

  function localize(): void {
    const t = text();
    renderMenuButton();
    bar.setAttribute("aria-label", t.bar);
    for (const [name, button] of Object.entries(barItems)) {
      const label = t[name as keyof typeof barItems];
      const span = button.querySelector(".mobile-bar-label");
      if (span) span.textContent = label;
      button.title = label;
    }
    scrim.title = t.close;
    keys.setAttribute("aria-label", t.keys);
    for (const button of keyButtons) {
      const label = t.keyLabel[button.dataset.key as TerminalSoftKey];
      button.title = label;
      button.setAttribute("aria-label", label);
    }
    const keyboardLabel = terminalTyping() ? t.keyboardHide : t.keyboard;
    keyboardButton.title = keyboardLabel;
    keyboardButton.setAttribute("aria-label", keyboardLabel);
    wrapButton.textContent = t.wrap;
    wrapButton.title = t.wrapTitle;
    historyBackButton.title = t.historyBack;
    historyBackButton.setAttribute("aria-label", t.historyBack);
    syncBar();
  }

  function setOpen(next: Panel | null): void {
    if (next === open || (next === "sheet" && !listAvailable())) return;
    const wasOpen = open;
    open = next;
    for (const panel of ["drawer", "sheet", "tabs"] as const) {
      document.body.classList.toggle(OPEN_CLASS[panel], open === panel);
    }
    menuButton.setAttribute("aria-expanded", String(open === "drawer"));
    barItems.projects.setAttribute("aria-expanded", String(open === "drawer"));
    barItems.list.setAttribute("aria-expanded", String(open === "sheet"));
    // 閉じた引き出しは画面の外にあるので、Tab で入らないようにする。
    nav.inert = current === "phone" && open !== "drawer";
    if (open && !wasOpen) {
      returnFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    if (open === "drawer") {
      nav
        .querySelector<HTMLElement>("button, a[href]")
        ?.focus({ preventScroll: true });
    }
    if (open === "tabs") {
      renderTabs();
      const tabsList = tabsRefs.list.value;
      (
        tabsList?.querySelector<HTMLElement>(".is-front .mobile-tabs-open") ??
        tabsList?.querySelector<HTMLElement>(".mobile-tabs-open") ??
        tabsRefs.close.value
      )?.focus({ preventScroll: true });
    }
    if (!open && wasOpen) {
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      returnFocus = null;
    }
  }

  function toggle(panel: Panel): void {
    setOpen(open === panel ? null : panel);
  }

  function close(): void {
    setOpen(null);
  }

  /** ソフトキーボードが隠している高さ。骨格の下端をその分だけ上げる。 */
  function syncKeyboardInset(): void {
    const viewport = window.visualViewport;
    const covered =
      viewport && current === "phone"
        ? softKeyboardInset({
            innerHeight: window.innerHeight,
            viewportHeight: viewport.height,
            viewportOffsetTop: viewport.offsetTop,
            scale: viewport.scale,
          })
        : 0;
    document.body.classList.toggle("mobile-keyboard-open", covered > 0);
    if (covered > 0) {
      document.documentElement.style.setProperty(
        "--sp-keyboard-h",
        `${covered}px`,
      );
    } else {
      document.documentElement.style.removeProperty("--sp-keyboard-h");
    }
  }

  function syncDiffWrap(): void {
    const on = current === "phone" && diffWrap;
    document.body.classList.toggle("mobile-diff-wrap", on);
    wrapButton.setAttribute("aria-pressed", String(diffWrap));
  }

  function apply(): void {
    current = phoneQuery.matches ? "phone" : "desktop";
    const phone = current === "phone";
    menuButton.hidden = !phone;
    bar.hidden = !phone;
    wrapButton.hidden = !phone;
    historyBackButton.hidden = !phone;
    syncDiffWrap();
    scrim.hidden = !phone;
    if (tabsSheet) tabsSheet.hidden = !phone;
    keys.hidden = !(phone || touchQuery.matches);
    if (!phone) {
      close();
      nav.inert = false;
    } else {
      nav.inert = open !== "drawer";
    }
    syncKeyboardInset();
  }

  // 捕捉の段で見る: 行の click はサイドバーを描き直して行を DOM から外すので、
  // 浮上の段では押したものがもう引き出しの中に無い。
  document.addEventListener(
    "click",
    (event) => {
      if (!open || !(event.target instanceof Element)) return;
      const target = event.target;
      if (
        open === "drawer" &&
        nav.contains(target) &&
        target.closest(DRAWER_CLOSING_TARGETS)
      ) {
        close();
      } else if (open === "sheet" && closesSheet(target)) {
        close();
      }
    },
    { capture: true, signal },
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (open && event.key === "Escape") {
        event.preventDefault();
        close();
      }
    },
    { signal },
  );

  // 左端からのスワイプで開き、開いている間は左へのスワイプで閉じる。指を
  // 動かしている間は引き出しが指に付いて動く (drawerDragOffset)。離したときに
  // 開くか閉じるかは edgeSwipeAction が決める。縦で動き始めた指 (gestureAxis)
  // では引き出しを動かさない。
  let touchStart: {
    x: number;
    y: number;
    drawerOpen: boolean;
    axis: "x" | "y" | null;
  } | null = null;
  let dragging = false;
  function endDrag(): void {
    if (!dragging) return;
    dragging = false;
    nav.style.removeProperty("transform");
    nav.style.removeProperty("transition");
    nav.style.removeProperty("visibility");
  }
  document.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.touches[0];
      endDrag();
      touchStart =
        current === "phone" && event.touches.length === 1 && touch
          ? {
              x: touch.clientX,
              y: touch.clientY,
              drawerOpen: open === "drawer",
              axis: null,
            }
          : null;
    },
    { passive: true, signal },
  );
  document.addEventListener(
    "touchmove",
    (event) => {
      const start = touchStart;
      const touch = event.touches[0];
      if (!start || !touch || current !== "phone") return;
      start.axis ??= gestureAxis(
        touch.clientX - start.x,
        touch.clientY - start.y,
      );
      if (start.axis !== "x") return;
      const offset = drawerDragOffset({
        startX: start.x,
        startY: start.y,
        x: touch.clientX,
        y: touch.clientY,
        drawerOpen: start.drawerOpen,
        width: nav.getBoundingClientRect().width,
      });
      if (offset === null) return;
      dragging = true;
      nav.style.transition = "none";
      nav.style.visibility = "visible";
      nav.style.transform = `translateX(${offset}px)`;
    },
    { passive: true, signal },
  );
  document.addEventListener(
    "touchend",
    (event) => {
      const start = touchStart;
      touchStart = null;
      endDrag();
      const touch = event.changedTouches[0];
      if (!start || !touch || current !== "phone") return;
      const action =
        start.axis === "y"
          ? null
          : edgeSwipeAction({
              startX: start.x,
              startY: start.y,
              endX: touch.clientX,
              endY: touch.clientY,
              drawerOpen: start.drawerOpen,
            });
      if (action === "open") setOpen("drawer");
      else if (action === "close" && open === "drawer") close();
      else if (!action) followBottomSwipe(start, touch);
    },
    { passive: true, signal },
  );

  /**
   * 下端の帯から上への指の動きで一覧の面を開き、開いている面 (一覧・タブ) の
   * 頭の行から下への動きで閉じる (bottomSwipeAction)。
   */
  function followBottomSwipe(
    start: { x: number; y: number; drawerOpen: boolean },
    touch: Touch,
  ): void {
    if (start.drawerOpen || bar.hidden) return;
    const head =
      open === "sheet"
        ? document.getElementById("panel-head")
        : open === "tabs"
          ? tabsSheet?.querySelector(".mobile-tabs-head")
          : null;
    const headRect = head?.getBoundingClientRect() ?? null;
    const action = bottomSwipeAction({
      startX: start.x,
      startY: start.y,
      endX: touch.clientX,
      endY: touch.clientY,
      barTop: bar.getBoundingClientRect().top,
      sheetHead: headRect
        ? { top: headRect.top, bottom: headRect.bottom }
        : null,
    });
    if (action === "open" && !open) setOpen("sheet");
    else if (action === "close") close();
  }

  // 長押しで右クリックのメニュー (LONG_PRESS_TARGETS の行)。既存の contextmenu の
  // 入口 (行ごとの右クリック) をそのまま使うため、指を置いた要素へ contextmenu を
  // 送る。長押しで出るブラウザの文字の選択と既定のメニューは、行の CSS
  // (-webkit-touch-callout・user-select) と、下の本物の contextmenu の扱いで止める。
  let press: {
    x: number;
    y: number;
    target: Element;
    timer: ReturnType<typeof setTimeout>;
    fired: boolean;
    /** 指を置いた要素に付けた見張りを外す。 */
    stop: AbortController;
  } | null = null;
  /** 合成のメニューを出した時刻 (後から届く本物の contextmenu を 2 重に出さない)。 */
  let firedAt = Number.NEGATIVE_INFINITY;
  function cancelPress(): void {
    if (!press) return;
    clearTimeout(press.timer);
    press.stop.abort();
    press = null;
  }
  function firePress(): void {
    if (!press) return;
    press.fired = true;
    firedAt = performance.now();
    press.target.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: press.x,
        clientY: press.y,
      }),
    );
  }
  // 指の動きと離すのは、指を置いた要素で見る: touchmove / touchend はその要素へ
  // 届き続けるが、メニューを出した行が描き直しで DOM から外れると document まで
  // 上がってこない (ファイル一覧で、離したときの click が止まらずメニューが閉じた)。
  document.addEventListener(
    "touchstart",
    (event) => {
      cancelPress();
      const touch = event.touches[0];
      const target = event.target;
      if (
        event.touches.length !== 1 ||
        !touch ||
        !(target instanceof Element) ||
        !target.closest(LONG_PRESS_TARGETS)
      )
        return;
      const stop = new AbortController();
      const current = {
        x: touch.clientX,
        y: touch.clientY,
        target,
        timer: setTimeout(firePress, LONG_PRESS_MS),
        fired: false,
        stop,
      };
      press = current;
      target.addEventListener(
        "touchmove",
        (move) => {
          const now = (move as TouchEvent).touches[0];
          if (
            !current.fired &&
            (!now ||
              longPressMoved(current, { x: now.clientX, y: now.clientY }))
          )
            cancelPress();
        },
        { passive: true, signal: stop.signal },
      );
      // 長押しでメニューを出したら、指を離したときの click (行を開く) を止める。
      // preventDefault するので passive にしない。
      target.addEventListener(
        "touchend",
        (end) => {
          if (current.fired && end.cancelable) end.preventDefault();
          cancelPress();
        },
        { signal: stop.signal },
      );
      target.addEventListener("touchcancel", cancelPress, {
        passive: true,
        signal: stop.signal,
      });
    },
    { passive: true, signal },
  );
  // 長押しで本物の contextmenu を出すブラウザ (Android) と 2 重にしない: 先に
  // 本物が来たら合成をやめ、合成の後に来た本物は止める。
  document.addEventListener(
    "contextmenu",
    (event) => {
      if (!event.isTrusted) return;
      if (press && !press.fired) {
        clearTimeout(press.timer);
        press.fired = true;
        return;
      }
      if (performance.now() - firedAt < LONG_PRESS_MS * 2) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    { capture: true, signal },
  );

  // 左の面の端末の上の 2 本指のピンチで、端末の文字の大きさを変える (電話の段の
  // 値。保存したデスクトップの値は変えない)。ページの拡大は style.css の
  // touch-action で止める。
  let pinch: { startSize: number; startDistance: number; size: number } | null =
    null;
  const fingerDistance = (touches: TouchList): number => {
    const a = touches[0];
    const b = touches[1];
    return a && b
      ? Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      : 0;
  };
  document.addEventListener(
    "touchstart",
    (event) => {
      pinch = null;
      if (
        event.touches.length !== 2 ||
        current !== "phone" ||
        !deps.terminalFontSize ||
        !(event.target instanceof Element) ||
        !event.target.closest(TERMINAL_HOST)
      )
        return;
      const size = deps.terminalFontSize();
      pinch = {
        startSize: size,
        startDistance: fingerDistance(event.touches),
        size,
      };
    },
    { passive: true, signal },
  );
  document.addEventListener(
    "touchmove",
    (event) => {
      if (!pinch || event.touches.length !== 2) return;
      const size = pinchFontSize({
        startSize: pinch.startSize,
        startDistance: pinch.startDistance,
        distance: fingerDistance(event.touches),
        min: MIN_TERMINAL_FONT_SIZE,
        max: MAX_TERMINAL_FONT_SIZE,
      });
      if (size === pinch.size) return;
      pinch.size = size;
      deps.setTerminalFontSize?.(size);
    },
    { passive: true, signal },
  );
  document.addEventListener(
    "touchend",
    (event) => {
      if (event.touches.length < 2) pinch = null;
    },
    { passive: true, signal },
  );
  document.addEventListener(
    "touchcancel",
    () => {
      touchStart = null;
      endDrag();
    },
    { passive: true, signal },
  );

  // 画面の切替 (body の画面の印) と、左の面の前面のタブ (端末など) の出し入れで
  // 帯の「いま見ている画面」を付け直す。
  const pageObserver = new MutationObserver(syncBar);
  pageObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["class", "data-worktree-overview"],
  });
  const leftHost = document.querySelector('.main-pane-host[data-side="left"]');
  if (leftHost)
    pageObserver.observe(leftHost, {
      attributes: true,
      attributeFilter: ["class"],
    });
  // ⌨ の名前 (出す / しまう) は端末に入力が向いているかで変わる。
  document.addEventListener("focusin", localize, { signal });
  document.addEventListener("focusout", localize, { signal });

  phoneQuery.addEventListener("change", apply, { signal });
  touchQuery.addEventListener("change", apply, { signal });
  window.addEventListener("resize", apply, { signal });
  window.visualViewport?.addEventListener("resize", syncKeyboardInset, {
    signal,
  });
  window.visualViewport?.addEventListener("scroll", syncKeyboardInset, {
    signal,
  });
  // 言語の切替は app.ts が html の lang に書く。それを見て当て直す。
  // タブの一覧は開いている間だけ組み直す (localize はフォーカスの出入りでも
  // 呼ぶので、そこで組み直すとフォーカスのある行が消える)。
  const langObserver = new MutationObserver(() => {
    localize();
    if (open === "tabs") renderTabs();
  });
  langObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"],
  });

  localize();
  apply();

  return {
    tier: () => current,
    openDrawer: () => setOpen("drawer"),
    openSheet: () => setOpen("sheet"),
    openTabs: () => setOpen("tabs"),
    close,
    setWaitingAgents(count) {
      waitingAgents = count;
      syncBar();
    },
    setProject(look) {
      project = look;
      renderMenuButton();
    },
    dispose() {
      close();
      endDrag();
      cancelPress();
      listening.abort();
      langObserver.disconnect();
      pageObserver.disconnect();
      wrapButton.remove();
      historyBackButton.remove();
      document.body.classList.remove("mobile-diff-wrap");
      nav.inert = false;
      menuButton.remove();
      scrim.remove();
      keys.remove();
      bar.remove();
      stopTabsRender?.();
      tabsSheet?.remove();
    },
  };
}
