// メインの面のタブ列 (最上段、`#main-tabs`)。1 面か左右 2 面。
//
// 本文 (#content) は 1 つで、左の面に描く。本文の route は URL の route。
// 画面 (page) のタブは左の面にだけ置く (core/main-tabs.ts の canPlace)。
// ファイルのタブは右の面にも置け、右の面のファイルは app.ts が面の箱に 2 つ目
// のソース表示で描く (その route はここが覚える: paneRoute / openRouteRight)。
// ターミナルと画像も面ごとの箱に描く。左の面で何も選んでいないときは本文の
// 既定 (フォルダ表示 = repo の route) を出す。Files のタブは無い。
//
// route が変わるたび (setRoute / applyRouteFromLocation の後) に syncRoute が
// 呼ばれ、その route のタブを開くか前面に出す (フォルダ表示なら選択を外す)。だから URL・戻る・進む・既存の
// 全部の入口 (木・パレット・行リンク・Diff や History から開く) がそのまま
// タブになる。
//
// 配置は core/main-tabs.ts の純関数だけで変える。タブごとの最後の route は
// ここが覚える (モデルの target は同一判定に要る分だけ: ファイルならパス)。
//
// 保存はプロジェクトごと (/_state/tabs)。読み戻しが済むまでは保存しない
// (起動直後の 1 枚だけの配置で、保存してあった配置を上書きしないため)。

import type { AgentState } from "../../core/agent-state";
import { attachDragResizer } from "../../core/drag-resizer";
import { iconSvg } from "../../core/icons";
import { isImeComposing } from "../../core/keyboard";
import {
  activate,
  activateIndex,
  activeTab,
  allTabs,
  type ClosedTab,
  COMMON_TABS_VERSION,
  canPlace,
  canSplit,
  close,
  closedTabs,
  closeOthers,
  closeToRight,
  DEFAULT_SPLIT,
  emptyLayout,
  findTab,
  focusPane,
  frontTab,
  isNewerLayoutVersion,
  keepOpen,
  LAYOUT_VERSION,
  type Layout,
  move,
  moveToOtherSide,
  nextTab,
  type OpenOptions,
  open,
  openRight,
  openSide,
  PAGE_KINDS,
  type PageKind,
  type PaneSide,
  type ParkedRight,
  parkRight,
  parseCommonTabs,
  parseLayout,
  prevTab,
  pushClosed,
  reopenClosed,
  type SerializedCommonTabs,
  type SerializedLayout,
  type SerializedPageRoute,
  sameTarget,
  serializeCommonTabs,
  serializeLayout,
  setSplit,
  showHome,
  sideOfTarget,
  splitBlocker,
  splitRight,
  type Tab,
  type TabTarget,
  tabMenu,
  unparkRight,
  unsplit,
  WORKTREE_REF,
  withCommonTabs,
} from "../../core/main-tabs";
import type { AppRoute } from "../../core/routes";
import { basenameOf } from "../../core/terminal-board";
import { terminalImageExtension } from "../../core/terminal-images";
import {
  TAB_PROJECT_SEPARATOR,
  type TerminalTabName,
  type TerminalTabProject,
  terminalTabName,
} from "../../core/terminal-tab-name";
import { isToolId } from "../../core/tools";
import type { ContextMenuItem } from "../context-menu";
import { showContextMenu } from "../context-menu";
import { type MainTabsLang, mainTabsText } from "./i18n";
import {
  CLOSE_ICON_PATH,
  type PageIconPaths,
  pageIconPaths,
} from "./tab-icons";

/** 保存をまとめる間隔。並べ替えや連続した移動を 1 回の書き込みにする。 */
const SAVE_DELAY_MS = 300;
const DRAG_TYPE = "application/x-code-viewer-main-tab";
/** 2 面のときの各面の最小の幅 (px)。これが 2 つ置けない幅では分割しない。 */
const MIN_PANE_WIDTH = 360;
/**
 * 2 面がゆとりを持って並ぶ幅。これを下回るなら、右の列を畳めば並ぶので、
 * 2 面の間だけ自動で畳む (app.ts の syncPanelColumnForSplit)。Data の全体検索と
 * クエリの欄が縦に積まれ始める幅 (560px) の少し下に置いてある: ここを 560 に
 * すると 1600px の窓でも畳むことになり、畳まないで済む幅まで畳んでしまう。
 */
export const COMFORTABLE_PANE_WIDTH = 480;
/**
 * 利用者が自分で右の列を開いたときだけ許す、面の幅の下限。ここまでは両面を
 * 同じ比で縮め、中身は自分の箱の中で横に送ってもらう (右の面を先に畳まない)。
 */
const TIGHT_PANE_WIDTH = 320;
/** 面の境界の線の幅 (px)。CSS の --split-divider-w へ JS が書く。 */
export const SPLIT_DIVIDER_WIDTH = 1;
const SIDES: readonly PaneSide[] = ["left", "right"];

export type FrontChange = "navigate" | "sync" | "stay";

/** 面ごとの前面のタブと、本文 (route の中身) を置く面。 */
export type PanesView = {
  split: boolean;
  focused: PaneSide;
  fronts: Record<PaneSide, Tab | null>;
  /** 本文を置く面。どちらの前面も route のタブでなければ null。 */
  routeSide: PaneSide | null;
};

export type MainTabsDeps = {
  mount: HTMLElement;
  /**
   * 左の面のタブ列の先頭に置く箱 (プロジェクト名と画面の入口を、木の列が
   * 出ていないときに置く場所)。中身は呼び出し側が入れ替える。
   */
  lead?: HTMLElement;
  /**
   * 右の列 (画面の右端の固定の列) の頭。本文の幅はタブ列の左端からこの左まで
   * で数える (畳んでいれば細い帯の幅)。無ければ右の列は無いものとする。
   */
  panelColumn?: HTMLElement;
  getLanguage(): MainTabsLang;
  /** page のタブの名前 (画面の入口と同じ文言)。 */
  pageLabel(page: PageKind): string;
  /** その route を開く (replace なら履歴を積まない)。 */
  navigate(route: AppRoute, replace?: boolean): void;
  /** 今の画面の route (URL の最新)。タブを離れるときに覚える。 */
  currentRoute(): AppRoute;
  /** 覚えた route が無いタブ (読み戻したタブ) を開くときの route。 */
  defaultRoute(target: TabTarget): AppRoute;
  /** 本文の既定 (フォルダ表示) の route。まだ一度も出していないときに使う。 */
  homeRoute(): AppRoute;
  copyPath(path: string): void;
  /**
   * ＋ボタン。その面の新しいタブのメニュー (ファイル・新しいシェル・既存の
   * セッション) を anchor の下に開く。
   */
  onNewTab(side: PaneSide, anchor: HTMLElement): void;
  /** ターミナルのタブの右クリックの「セッションを止める」。 */
  stopTerminal(session: string): void;
  /** ターミナルのタブの右クリックに足す、端末の操作 (文字の大きさなど)。 */
  terminalMenuItems(): ContextMenuItem[];
  /**
   * 保存した配置。layout はこのプロジェクトの配置、common はプロジェクトに
   * 属さないタブ (全プロジェクトで 1 つ)。どちらも無ければ null。
   */
  loadSaved(): Promise<{ layout: unknown; common: unknown }>;
  /** common は、共通のタブを書いてよいとき (読めた・まだ無かった) だけ渡る。 */
  save(
    layout: SerializedLayout,
    keepalive: boolean,
    common?: SerializedCommonTabs,
  ): Promise<void>;
  /**
   * 読めなかった保存値を、上書きする前に同じ場所へ退避する
   * (`main-tabs.json.broken-<時刻>`)。退避した先のパスを返す。
   */
  backupSaved(): Promise<string>;
  /**
   * ターミナルのタブの名前と状態 (エージェントを映していれば、その状態)。
   * project はエージェントのペインが属するプロジェクト (別のプロジェクトなら
   * タブの名前の前に付ける。core/terminal-tab-name.ts)。
   */
  terminalInfo(session: string): {
    label: string;
    state: AgentState | null;
    project?: TerminalTabProject | null;
  };
  /**
   * 面の前面のタブ・フォーカス・分割が変わった。how は URL の扱い:
   * navigate = これから route へ移る (URL はそちらが積む)、sync = URL から
   * 来た (URL は触らない)、stay = 移らずに前面だけ変わった (URL を積み直す)。
   */
  onPanes(view: PanesView, how: FrontChange): void;
  /** 開いているターミナルのタブ (一覧の印) と、閉じたもの (購読をやめる)。 */
  onTerminals(open: ReadonlySet<string>, closed: string[]): void;
  /**
   * 右の列に今の画面の一覧 (History・作業ツリー) を出しているか。出している間は
   * 右の列を畳まないので、右の面を預けたときの説明をそれに合わせる。
   */
  panelColumnHoldsList?(): boolean;
  /**
   * 本文の左の一覧の列の幅 (出していなければ 0)。本文の幅はタブ列の左端から
   * これと右の列を引いた幅。
   */
  listColumnWidth?(): number;
};

export type MainTabsHandle = {
  /**
   * route が変わった。その route のタブを開くか前面に出す。activate = false
   * (URL の置き換えだけ) なら、前面のタブは変えずに覚えた route だけ更新する。
   */
  syncRoute(route: AppRoute, activate?: boolean): void;
  /** そのシェルのターミナルのタブを開いて前面に出す。 */
  openTerminal(session: string, pane?: OpenOptions["pane"]): void;
  /** そのシェルのターミナルのタブを閉じる (シェルは止めない)。 */
  closeTerminal(session: string): void;
  /** 端末のタブが映しているシェル。 */
  terminalSessions(): string[];
  /**
   * それらのシェルの端末のタブを閉じる。入口のサーバを起こし直すと、保存した
   * 配置のシェルは全部消えて付き直せない (シェルは入口のプロセスの子)。残すと
   * 番号の無い「Shell」のタブが並んだ (app.ts の closeTabsOfGoneShells)。
   */
  closeTerminals(sessions: readonly string[]): void;
  /** 画像のタブを開いて前面に出す。 */
  openImage(path: string, pane?: OpenOptions["pane"]): void;
  /** フォーカスのある面の＋のメニューを開く (キー操作・パレットから)。 */
  openNewTabMenu(): void;
  /** 左の面の選択を外して本文の既定 (フォルダ表示) を出す (Files の入口)。 */
  showHome(): void;
  /** フォーカスのある面の前面のタブ。 */
  front(): Tab | null;
  /** 今の面の様子 (前面・フォーカス・本文を置く面)。 */
  panes(): PanesView;
  /**
   * いまの本文の幅 (右の列は今の状態のまま) で、2 面がゆとりを持って
   * (COMFORTABLE_PANE_WIDTH) 並ぶか。false なら右の列を畳むと並ぶ (app.ts が
   * 2 面の間だけ自動で畳む)。
   */
  splitFitsWithPanelColumn(): boolean;
  /** そのシェルのターミナルのタブがあるか。 */
  hasTerminal(session: string): boolean;
  /**
   * run の中で開いたファイル・画像を固定のタブで開く (ui-surface.md のタブの
   * 決まり: 中ボタン・⌘/Ctrl＋クリック・Shift+Enter・「新しいタブで開く」)。
   * run は route を同期で置くこと (await の後で開くと仮のタブになる)。
   */
  openingNewTab(run: () => void): void;
  /** page のタブがあれば、そのタブが最後に見ていた route。 */
  routeForPage(page: PageKind): AppRoute | null;
  /**
   * 右の面の前面がファイルのタブなら、その route (右の面のソース表示が描く)。
   * 左の面は本文 (URL の route) なので null。
   */
  paneRoute(side: PaneSide): AppRoute | null;
  /**
   * ファイルの route を右の面に開いて前面に出し、その route を覚える
   * (Alt+クリック・右にフォーカスがあるときの木・右の面の中の移動・URL の
   * pane=right)。同じファイルが右の面にあればそのタブの route を差し替える。
   * 1 面で 2 面を置けない幅なら開かずに false。fromUrl なら URL から来た
   * (onPanes に sync を渡す: URL を積まない)。
   */
  openRouteRight(route: FileRoute, fromUrl?: boolean): boolean;
  /** そのファイルの route を面を指定せずに開いたら、どちらの面の前面に出るか。 */
  sideForRoute(route: FileRoute): PaneSide;
  /**
   * その route のタブが今ある面 (左を先に見る)。無ければ null。戻る・進むで
   * 既にあるタブを前面に出すだけにするために使う (新しい仮のタブを作らない)。
   */
  sideHolding(route: AppRoute): PaneSide | null;
  /** 面にフォーカスを移す。2 面でなければ何もしない。 */
  focusSide(side: PaneSide): void;
  /** 画面の x 座標がどちらの面か (2 面でないか、右の列の上なら null)。 */
  sideAt(clientX: number): PaneSide | null;
  focusOther(): void;
  /**
   * フォーカスのある面の前面のタブの右クリックのメニューを、そのタブの下に
   * 開く (キーで開く入口)。前面のタブが無ければ開かずに false。
   */
  openFrontMenu(): boolean;
  next(): void;
  previous(): void;
  closeActive(): void;
  /**
   * いちばん新しく閉じたタブを固定のタブで開き直す (PWA の窓の ⌘/Ctrl+Shift+T)。
   * 開き直せるものが無ければ false。
   */
  reopenClosed(): boolean;
  activateNth(n: number): void;
  /**
   * 保存した配置を読み戻す。rightRoute は URL が右の面のファイルを指して
   * いた (pane=right) とき: 左の面は保存した前面のまま、右の面にそのファイルを
   * 開いて前面に出す。keepSavedFront は URL が前面のシェル (?terminal=) か
   * 開くペイン (?open-pane=) を持っていたとき: 前面がターミナルでも残す。
   */
  restore(options?: {
    rightRoute?: FileRoute;
    keepSavedFront?: boolean;
  }): Promise<void>;
  flush(keepalive: boolean): void;
  localize(): void;
  /**
   * 本文の幅が、観測できない理由 (一覧の列の幅) で変わった。面の幅と 2 面の
   * 可否を合わせ直す。
   */
  refit(): void;
  /** テストと確認用。 */
  layout(): Layout;
};

type FileRoute = Extract<AppRoute, { screen: "file" }>;

export function isPageKind(value: string | undefined): value is PageKind {
  return (PAGE_KINDS as readonly (string | undefined)[]).includes(value);
}

/** タブの名前に添える版の印。コミットの sha は 7 文字、ほか (ブランチ・HEAD) はそのまま。 */
function shortRef(ref: string): string {
  return /^[0-9a-f]{8,40}$/i.test(ref) ? ref.slice(0, 7) : ref;
}

/** ファイルと各画面 (route で中身が決まり、本文に描くタブ)。 */
export function isRouteTab(tab: Tab | null): boolean {
  return tab?.target.kind === "file" || tab?.target.kind === "page";
}

/**
 * route をタブの中身に。画像のファイルを開く route (view が無いか blob) は
 * 画像のタブ。画像でも履歴・blame の route はファイルのタブ (ファイルの画面の
 * History / Blame を無くさない)。タブにならない route は null: フォルダ表示
 * (repo) は左の面の本文の既定で、タブにしない。
 */
export function routeTarget(route: AppRoute): TabTarget | null {
  switch (route.screen) {
    case "file":
      if (
        terminalImageExtension(route.path) !== null &&
        (route.view === undefined || route.view === "blob")
      )
        return { kind: "image", path: route.path };
      // 作業ツリー以外の版は別のタブ (target の ref。作業ツリーは書かない)。
      return {
        kind: "file",
        path: route.path,
        ...(route.line === undefined ? {} : { line: route.line }),
        ...(route.ref && route.ref !== WORKTREE_REF ? { ref: route.ref } : {}),
      };
    case "diff":
    case "history":
    case "worktree":
    case "database":
    case "journal":
    case "agents":
    case "tools":
    case "search":
    case "help":
      return { kind: "page", page: route.screen };
    case "repo":
    case "unknown":
      return null;
  }
}

/**
 * 本文を出す面。route のタブは左の面にしか置けないので、左の前面が route の
 * タブか、何も選んでいない (本文の既定) なら左。左の前面がターミナルか画像
 * なら本文は隠れる (null)。
 */
function routeSideOf(layout: Layout): PaneSide | null {
  const front = frontTab(layout, "left");
  return front === null || isRouteTab(front) ? "left" : null;
}

function panesView(layout: Layout): PanesView {
  return {
    split: !!layout.panes.right,
    focused: layout.focused,
    fronts: {
      left: frontTab(layout, "left"),
      right: frontTab(layout, "right"),
    },
    routeSide: routeSideOf(layout),
  };
}

function sameView(a: PanesView, b: PanesView): boolean {
  return (
    a.split === b.split &&
    a.focused === b.focused &&
    a.routeSide === b.routeSide &&
    a.fronts.left?.id === b.fronts.left?.id &&
    a.fronts.right?.id === b.fronts.right?.id
  );
}

export function createMainTabsView(deps: MainTabsDeps): MainTabsHandle {
  let layout: Layout = emptyLayout();
  const routes = new Map<string, AppRoute>();
  let restored = false;
  let saveEnabled = false;
  /** 共通のタブも書くか。読めなかった・新しい版の値は上書きしない。 */
  let commonSaveEnabled = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let dragId: string | null = null;
  /**
   * 窓が 2 面を出せる幅より狭い間、預かっている右の面 (fitToWidth)。この間の
   * layout は 1 面で、操作・描画・キーは 1 面の決まりで動く。保存と、窓が
   * 広がったときだけ戻す。
   */
  let parked: ParkedRight | null = null;
  /**
   * 本文の面に合わせて route へ移るときの、元のフォーカス。移った先の
   * syncRoute がその route のタブの面へフォーカスを持って行かないようにする。
   */
  let keepFocus: PaneSide | null = null;
  /** 最後に出したフォルダ表示の route (Files に戻ったとき同じフォルダを出す)。 */
  let lastHome: AppRoute | null = null;
  /** 利用者が閉じたタブ (新しい順。core/main-tabs.ts の pushClosed)。 */
  let closedHistory: ClosedTab[] = [];
  /** openingNewTab の run の間だけ true。開くタブを仮にしない。 */
  let openingKept = false;

  /** 仮にするかの指定 (openingNewTab の間は固定)。 */
  function keptOption(): Pick<OpenOptions, "preview"> {
    return openingKept ? { preview: false } : {};
  }

  // 面ごとのタブ列。strip は横に送る箱 (タブの幅の入れ物) で、中にタブの並び
  // (list、role=tablist) と、そのすぐ右の ＋ を置く (ブラウザのタブと同じく、
  // ＋ はタブと一緒に動き、一緒に送られる)。分割のボタンは列の外の右端。
  type Section = {
    el: HTMLElement;
    strip: HTMLElement;
    list: HTMLElement;
    newButton: HTMLButtonElement;
    splitButton: HTMLButtonElement;
  };
  const sections = {} as Record<PaneSide, Section>;
  for (const side of SIDES) sections[side] = createSection(side);

  // 面の境界。掴みしろ 6px、線は 1px (ホバー・ドラッグ中は 2px の強調)。
  const divider = document.createElement("div");
  divider.className = "main-split-divider";
  divider.role = "separator";
  divider.tabIndex = 0;
  divider.setAttribute("aria-orientation", "vertical");
  // 1 面のとき、タブを右端へドラッグすると出る分割のドロップ先。
  const dropZone = document.createElement("div");
  dropZone.className = "main-split-drop";
  dropZone.hidden = true;
  const dropIcon = document.createElement("span");
  dropIcon.className = "main-split-drop-icon";
  dropIcon.innerHTML = iconSvg("main-tabs-action-icon", pageIconPaths("split"));
  const dropLabel = document.createElement("span");
  dropLabel.className = "main-split-drop-label";
  dropZone.append(dropIcon, dropLabel);
  document.body.append(divider, dropZone);

  function text() {
    return mainTabsText(deps.getLanguage());
  }

  function createSection(side: PaneSide): Section {
    const el = document.createElement("div");
    el.className = "main-tabs-pane";
    el.dataset.side = side;
    const strip = document.createElement("div");
    strip.className = "main-tabs-strip";
    // tablist にはタブだけを置く (押せるボタンを混ぜない)。
    const list = document.createElement("div");
    list.className = "main-tabs-list";
    list.setAttribute("role", "tablist");
    const actions = document.createElement("div");
    actions.className = "main-tabs-actions";
    const newButton = document.createElement("button");
    newButton.type = "button";
    newButton.className = "main-tabs-action main-tabs-new";
    newButton.innerHTML = iconSvg(
      "main-tabs-action-icon",
      pageIconPaths("new"),
    );
    // 押すとメニュー (ファイル・新しいシェル・セッション) が開く。
    newButton.setAttribute("aria-haspopup", "menu");
    newButton.addEventListener("click", () => {
      focusSide(side);
      openNewTabMenuIn(side);
    });
    const splitButton = document.createElement("button");
    splitButton.type = "button";
    splitButton.className = "main-tabs-action main-tabs-split";
    // 右の面は 2 面のときだけあるので、右の面のボタンは常に「1 面に戻す」。
    splitButton.innerHTML = iconSvg(
      "main-tabs-action-icon",
      pageIconPaths(side === "right" ? "unsplit" : "split"),
    );
    splitButton.addEventListener("click", () => {
      if (side === "right") {
        changeAndGo(unsplit);
        return;
      }
      const front = frontTab(layout, "left");
      if (front && splitBlocker(layout) === null && splitAllowed())
        changeAndGo((l) => splitRight(l, front.id));
    });
    actions.append(splitButton);
    strip.append(list, newButton);
    if (side === "left" && deps.lead) el.append(deps.lead);
    el.append(strip, actions);
    wireStrip(strip, side);
    return { el, strip, list, newButton, splitButton };
  }

  function labelOf(target: TabTarget): string {
    switch (target.kind) {
      case "file":
        // 作業ツリー以外の版だけ、版の短い印を添える (同じ名前のタブを見分ける)。
        return target.ref === undefined
          ? basenameOf(target.path)
          : `${basenameOf(target.path)} @ ${shortRef(target.ref)}`;
      case "image":
        return basenameOf(target.path);
      case "terminal":
        return deps.terminalInfo(target.session).label;
      case "page":
        return deps.pageLabel(target.page);
    }
  }

  function iconOf(target: TabTarget): PageIconPaths {
    switch (target.kind) {
      case "file":
        return pageIconPaths("file");
      case "image":
        return pageIconPaths("image");
      case "terminal":
        return pageIconPaths("terminal");
      case "page":
        return pageIconPaths(target.page);
    }
  }

  // ---- 幅 ----

  /** 右の列の幅 (畳んでいれば細い帯の幅)。 */
  function panelColumnWidth(): number {
    return deps.panelColumn?.getBoundingClientRect().width ?? 0;
  }

  /**
   * 本文の横幅 (タブ列の左端から右の列の左まで、一覧の列を除く)。面の最小幅は
   * この幅で数える (右の列と一覧の列を含めない)。
   */
  function mainWidth(): number {
    return (
      document.documentElement.clientWidth -
      deps.mount.getBoundingClientRect().left -
      panelColumnWidth() -
      (deps.listColumnWidth?.() ?? 0)
    );
  }

  /**
   * 2 面を置ける幅か。下限は詰めたときの幅 (TIGHT_PANE_WIDTH)。ゆとりのある
   * 幅 (MIN_PANE_WIDTH) を下回るときは、右の列を畳めば戻るので、畳む判断は
   * splitFitsWithPanelColumn() を見る側 (app.ts) が行う。
   */
  function splitAllowed(): boolean {
    return mainWidth() >= TIGHT_PANE_WIDTH * 2 + SPLIT_DIVIDER_WIDTH;
  }

  /**
   * 比から左の面の幅 (px) を決める。ゆとりのある最小幅を守れないときは詰めた
   * 下限まで、それも守れないときは半分ずつ。
   */
  function leftWidthFor(ratio: number): number {
    const width = mainWidth();
    const { min, max } = paneBounds(width);
    if (max < min) return Math.round((width - SPLIT_DIVIDER_WIDTH) / 2);
    return Math.min(max, Math.max(min, Math.round(width * ratio)));
  }

  /** 左の面の幅の下限と上限 (px)。ゆとりの最小幅を守れないときは詰めた下限。 */
  function paneBounds(width: number): { min: number; max: number } {
    const min =
      width >= MIN_PANE_WIDTH * 2 + SPLIT_DIVIDER_WIDTH
        ? MIN_PANE_WIDTH
        : TIGHT_PANE_WIDTH;
    return { min, max: width - min - SPLIT_DIVIDER_WIDTH };
  }

  /** 預かっている右の面を戻した配置 (保存とターミナルの数え方に使う)。 */
  function fullLayout(): Layout {
    return parked ? unparkRight(layout, parked) : layout;
  }

  /**
   * 窓の幅に合わせて右の面を預ける・戻す。狭ければ左だけにし (右の面は隠す)、
   * 2 面を出せる幅になれば戻す。変えたら true。
   */
  function fitToWidth(): boolean {
    if (layout.panes.right && !splitAllowed()) {
      const result = parkRight(layout);
      layout = result.layout;
      parked = result.parked;
      return true;
    }
    if (parked && splitAllowed()) {
      layout = unparkRight(layout, parked);
      parked = null;
      return true;
    }
    return false;
  }

  /**
   * 面の幅を CSS 変数に書く (TS が出所。ui-layout.md の「JS 側に出るジオメトリ」)。
   * 境界 (role=separator) には左の面の幅を本文の幅に対する % で持たせる
   * (フォーカスできる separator は値が読めること)。
   */
  function applyGeometry(): void {
    const root = document.documentElement.style;
    const split = !!layout.panes.right;
    document.body.classList.toggle("main-split", split);
    const width = mainWidth();
    root.setProperty("--main-w", `${width}px`);
    if (!split) {
      root.removeProperty("--split-left-w");
      root.removeProperty("--split-right-w");
      return;
    }
    const left = leftWidthFor(layout.split ?? DEFAULT_SPLIT);
    root.setProperty("--split-left-w", `${left}px`);
    root.setProperty(
      "--split-right-w",
      `${width - left - SPLIT_DIVIDER_WIDTH}px`,
    );
    root.setProperty("--split-divider-w", `${SPLIT_DIVIDER_WIDTH}px`);
    if (width <= 0) return;
    const { min, max } = paneBounds(width);
    const percent = (px: number) => String(Math.round((px / width) * 100));
    divider.setAttribute("aria-valuenow", percent(left));
    divider.setAttribute("aria-valuemin", percent(Math.min(min, left)));
    divider.setAttribute("aria-valuemax", percent(Math.max(max, left)));
  }

  attachDragResizer({
    handle: divider,
    getSize: () => leftWidthFor(layout.split ?? DEFAULT_SPLIT),
    applySize: (size) => {
      const width = mainWidth();
      const { min, max } = paneBounds(width);
      const clamped = Math.min(max, Math.max(min, size));
      // ドラッグ中は描き直さず、比と幅だけ変える。保存は onEnd で。
      layout = setSplit(layout, clamped / width);
      applyGeometry();
    },
    direction: 1,
    axis: "x",
    onEnd: () => scheduleSave(),
    activeClassTarget: document.body,
    activeClassName: "main-split-resizing",
  });
  /**
   * 前面のタブが列の外にあれば、列だけを横に送って見せる (scrollIntoView は
   * 外側の箱まで動かすことがあるので使わない)。
   */
  function revealFront(strip: HTMLElement): void {
    const tab = strip.querySelector<HTMLElement>(".main-tab-active");
    if (!tab) return;
    // 前面が最後のタブなら、すぐ右の ＋ まで見せる (タブだけだと ＋ が数 px
    // だけ列の外に残った)。
    const plus = tab.nextElementSibling
      ? null
      : strip.querySelector<HTMLElement>(".main-tabs-new");
    revealIn(strip, plus ?? tab);
    if (plus) revealIn(strip, tab);
  }

  /** strip の中の el が見えるところまで、列だけを横に送る。 */
  function revealIn(strip: HTMLElement, el: HTMLElement): void {
    const box = strip.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    if (rect.left < box.left) strip.scrollLeft -= box.left - rect.left;
    else if (rect.right > box.right) strip.scrollLeft += rect.right - box.right;
  }

  /**
   * その面の ＋ のメニューを開く。＋ はタブと一緒に送られるので、列の外に
   * 出ていれば先に見える位置まで送る (メニューを ＋ の下に出すため)。
   */
  function openNewTabMenuIn(side: PaneSide): void {
    const { strip, newButton } = sections[side];
    revealIn(strip, newButton);
    deps.onNewTab(side, newButton);
  }
  // 列が狭くなると (窓・面・右の列の幅) 前面のタブが列の外へ出ることがある。
  const stripObserver = new ResizeObserver((entries) => {
    for (const entry of entries)
      if (entry.target instanceof HTMLElement) revealFront(entry.target);
  });
  for (const side of SIDES) stripObserver.observe(sections[side].strip);

  /** 窓・本文・右の列の寸法が変わったあとに、面の幅と 2 面の可否を合わせる。 */
  function followGeometry(): void {
    const before = panesView(layout);
    if (!fitToWidth()) {
      applyGeometry();
      renderActions();
      return;
    }
    // 右の面を隠した・戻した: 描き直して、面の変化を画面へ知らせる。
    pruneRoutes();
    applyGeometry();
    render();
    scheduleSave();
    const after = panesView(layout);
    if (!sameView(before, after)) deps.onPanes(after, "stay");
    followRouteSide("stay");
  }
  const geometryObserver = new ResizeObserver(followGeometry);
  geometryObserver.observe(deps.mount);
  // 右の列の幅が変わる (畳む・幅を変える・History の一覧の幅) と本文の幅も変わる。
  if (deps.panelColumn) geometryObserver.observe(deps.panelColumn);
  // ResizeObserver は描画の段で届くので、背面のタブ (document.hidden) では前面に
  // 戻るまで届かない。読み込み直後は面の幅を右の列が開いたまま (240px) で数え、
  // そのあと 2 面のために右の列を畳む (body の印) ので、--split-left-w が畳む前の
  // 幅 (1280 で 380px) のまま残り、面の中身だけが畳んだあとの幅で並んでいた。
  // 右の列の開閉・画面の切替は body の印で起きるので、それも見て合わせ直す
  // (MutationObserver は背面でも届く)。
  new MutationObserver(followGeometry).observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });

  // ---- 保存 ----

  function scheduleSave(): void {
    if (!saveEnabled) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => flush(false), SAVE_DELAY_MS);
  }

  function flush(keepalive: boolean): void {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    const full = fullLayout();
    deps
      .save(
        serializeLayout(full, savedPageRoute),
        keepalive,
        commonSaveEnabled ? serializeCommonTabs(full) : undefined,
      )
      .catch((error: unknown) => {
        console.error("[code-viewer] main tabs could not be saved", error);
      });
  }

  /**
   * 保存するタブの route。Search の検索語と Tools の道具、ファイルの Preview
   * だけ (ほかの欄は target と今の画面から作り直せる)。前面でないタブの中身が、
   * リロードのたびに空に戻る・Code に戻るのを止める。
   */
  function savedPageRoute(tab: Tab): SerializedPageRoute | undefined {
    const route = routes.get(tab.id);
    if (!route) return undefined;
    if (route.screen === "search") return route.q ? { q: route.q } : undefined;
    if (route.screen === "tools")
      return route.tool ? { tool: route.tool } : undefined;
    if (route.screen === "file")
      return route.preview ? { preview: true } : undefined;
    return undefined;
  }

  /** 読み戻したタブに、保存してあった検索語・道具・Preview を戻す。 */
  function seedPageRoutes(
    target: Layout,
    saved: Record<string, SerializedPageRoute>,
  ): void {
    for (const tab of allTabs(target)) {
      const route = saved[tab.id];
      if (!route) continue;
      const base = deps.defaultRoute(tab.target);
      if (base.screen === "file" && route.preview) {
        routes.set(tab.id, { ...base, preview: true });
      } else if (base.screen === "search" && route.q !== undefined) {
        routes.set(tab.id, { ...base, q: route.q });
      } else if (base.screen === "tools" && route.tool !== undefined) {
        // この版に無い道具は選べない。既定 (道具なし) に落とすが、黙って
        // 捨てずに理由を残す。
        if (isToolId(route.tool))
          routes.set(tab.id, { ...base, tool: route.tool });
        else
          console.info(
            `[code-viewer] main tabs: saved tool ${JSON.stringify(route.tool)} is not known to this version; the Tools tab opens without a tool`,
          );
      }
    }
  }

  /** モデルから消えたタブの route を忘れる。 */
  function pruneRoutes(): void {
    for (const id of [...routes.keys()])
      if (!findTab(layout, id)) routes.delete(id);
  }

  function terminalsOf(target: Layout): Set<string> {
    const out = new Set<string>();
    for (const tab of allTabs(target))
      if (tab.target.kind === "terminal") out.add(tab.target.session);
    return out;
  }

  function routeOf(tab: Tab): AppRoute {
    return routes.get(tab.id) ?? deps.defaultRoute(tab.target);
  }

  function commit(next: Layout, how: FrontChange = "stay"): void {
    const before = panesView(layout);
    const terminalsBefore = terminalsOf(fullLayout());
    layout = next;
    fitToWidth();
    pruneRoutes();
    applyGeometry();
    render();
    scheduleSave();
    const terminals = terminalsOf(fullLayout());
    const closed = [...terminalsBefore].filter((id) => !terminals.has(id));
    if (
      closed.length > 0 ||
      [...terminals].some((id) => !terminalsBefore.has(id))
    )
      deps.onTerminals(terminals, closed);
    const after = panesView(layout);
    if (!sameView(before, after)) deps.onPanes(after, how);
    followRouteSide(how);
  }

  /**
   * 本文の面の前面のタブと、いま描いている route が食い違ったら、その
   * タブの route へ移る (面を閉じた・フォーカスを移した後など)。フォーカスは
   * そのまま。URL から来たとき (sync) は履歴を積まない。
   */
  function followRouteSide(how: FrontChange): void {
    if (how === "navigate") return;
    const side = routeSideOf(layout);
    if (!side) return;
    // フォーカスが反対の面にあるなら、本文は裏で移すだけ。URL はフォーカスの
    // ある面のもの (app の navigate が合わせ直す) なので、履歴を積まない
    // (積むと、分割した直後の戻るが同じ URL に 1 回止まる)。
    const replace = how === "sync" || layout.focused !== side;
    const tab = frontTab(layout, side);
    if (!tab) {
      // 本文の既定 (フォルダ表示)。どのフォルダかは URL が持つので、フォルダ
      // 表示ならそのまま。
      if (deps.currentRoute().screen === "repo") return;
      keepFocus = layout.focused;
      deps.navigate(homeRoute(), replace);
      return;
    }
    const route = routeOf(tab);
    if (JSON.stringify(route) === JSON.stringify(deps.currentRoute())) return;
    keepFocus = layout.focused;
    deps.navigate(route, replace);
  }

  /**
   * 今のタブの route を覚えてから、配置を変えて前面のタブへ移る。ターミナルと
   * 画像のタブは route を持たない (本文の route は下に残ったまま)。その route
   * のタブへ戻るだけなら移り直さない (描き直してスクロールを失わない)。
   */
  function changeAndGo(change: (current: Layout) => Layout): void {
    rememberRoute();
    const next = change(layout);
    const after = activeTab(next);
    if (!after) {
      // 左の面で何も選んでいない: 本文の既定 (フォルダ表示) を出す。
      if (deps.currentRoute().screen === "repo") {
        commit(next, "stay");
        return;
      }
      commit(next, "navigate");
      deps.navigate(homeRoute());
      return;
    }
    // 右の面のファイルは本文ではなく右の面の箱に描く (app の showPanes)。
    if (!isRouteTab(after) || next.focused === "right") {
      commit(next, "stay");
      return;
    }
    const route = routeOf(after);
    if (JSON.stringify(route) === JSON.stringify(deps.currentRoute())) {
      commit(next, "stay");
      return;
    }
    commit(next, "navigate");
    deps.navigate(route);
  }

  /**
   * 利用者が閉じた (×・中ボタン・Delete・右クリック・g x)。閉じたタブを履歴に
   * 積む (reopenClosed で開き直せる)。シェルが消えて閉じたタブは積まない
   * (closeTerminal / closeTerminals はこれを通らない)。
   */
  function closeByUser(change: (current: Layout) => Layout): void {
    const before = layout;
    changeAndGo(change);
    closedHistory = pushClosed(closedHistory, closedTabs(before, layout));
  }

  /** 本文に出ている route のタブ (か本文の既定) の、今の route を覚える。 */
  function rememberRoute(): void {
    const side = routeSideOf(layout);
    if (!side) return;
    const tab = frontTab(layout, side);
    const current = deps.currentRoute();
    if (tab) routes.set(tab.id, current);
    else if (current.screen === "repo") lastHome = current;
  }

  function homeRoute(): AppRoute {
    return lastHome ?? deps.homeRoute();
  }

  function syncRoute(route: AppRoute, activateTab = true): void {
    if (route.screen === "repo") {
      // フォルダ表示はタブにしない: 左の面の選択を外して本文の既定にする。
      lastHome = route;
      if (!activateTab && routeSideOf(layout) === null) return;
      let next = showHome(layout);
      if (keepFocus) {
        next = focusPane(next, keepFocus);
        keepFocus = null;
      }
      commit(next, "sync");
      return;
    }
    const target = routeTarget(route);
    if (!target) return;
    if (!activateTab && routeSideOf(layout) === null) {
      // 前面はターミナルか画像のまま。下に残っている画面の route だけ覚え直す。
      const existing = layout.panes.left.tabs.find((tab) =>
        sameTarget(tab.target, target),
      );
      if (existing) routes.set(existing.id, route);
      return;
    }
    // 本文の route は左の面のタブ (右の面に同じファイルがあっても左で開く)。
    // 画像は面を選ばない (フォーカスのある面の箱に出す)。
    let next = open(layout, target, {
      ...(target.kind === "image" ? {} : { pane: "left" as const }),
      ...keptOption(),
    });
    const tab = activeTab(next);
    if (tab && isRouteTab(tab)) routes.set(tab.id, route);
    if (keepFocus) {
      next = focusPane(next, keepFocus);
      keepFocus = null;
    }
    commit(next, "sync");
  }

  /**
   * ファイルの route を右の面に開く (1 面で 2 面を置けない幅なら false)。
   * restoring (読み戻しから) のときは、本文の今の route を左の前面のタブに
   * 覚えない: 読み戻した直後の本文はまだそのタブを描いていない。
   */
  function openRightRoute(
    route: FileRoute,
    how: FrontChange,
    restoring = false,
  ): boolean {
    const target = routeTarget(route);
    if (!target || target.kind === "page")
      throw new Error(
        `main tabs: ${JSON.stringify(route)} cannot be opened in the right pane`,
      );
    if (!layout.panes.right && !splitAllowed()) return false;
    if (!restoring) rememberRoute();
    const next = openRight(layout, target, keptOption());
    const tab = frontTab(next, "right");
    if (tab && target.kind === "file") routes.set(tab.id, route);
    commit(next, how);
    return true;
  }

  function focusSide(side: PaneSide): void {
    if (!layout.panes.right || layout.focused === side) return;
    rememberRoute();
    commit(focusPane(layout, side));
  }

  function menuFor(tab: Tab): ContextMenuItem[] {
    const state = tabMenu(layout, tab.id);
    const current = text();
    const path =
      tab.target.kind === "file" || tab.target.kind === "image"
        ? tab.target.path
        : null;
    const repoImage =
      tab.target.kind === "image" && !tab.target.path.startsWith("/")
        ? tab.target.path
        : null;
    return [
      {
        label: current.close,
        disabled: !state.close,
        onSelect: () => closeByUser((l) => close(l, tab.id)),
      },
      {
        label: current.closeOthers,
        disabled: !state.closeOthers,
        onSelect: () => closeByUser((l) => closeOthers(l, tab.id)),
      },
      {
        label: current.closeToRight,
        disabled: !state.closeToRight,
        onSelect: () => closeByUser((l) => closeToRight(l, tab.id)),
      },
      { kind: "separator" },
      {
        label: current.keepOpen,
        disabled: !state.keepOpen,
        onSelect: () => commit(keepOpen(layout, tab.id)),
      },
      {
        label: current.splitRight,
        // 狭くて 2 面が置けない幅では無効 (モデルの可否に幅の条件を足す)。
        disabled: !state.splitRight || !splitAllowed(),
        onSelect: () => changeAndGo((l) => splitRight(l, tab.id)),
      },
      {
        label: current.moveToOtherSide,
        disabled: !state.moveToOtherSide,
        onSelect: () => changeAndGo((l) => moveToOtherSide(l, tab.id)),
      },
      {
        label: current.moveLeft,
        disabled: !state.moveLeft,
        onSelect: () => moveWithin(tab.id, -1),
      },
      {
        label: current.moveRight,
        disabled: !state.moveRight,
        onSelect: () => moveWithin(tab.id, 1),
      },
      { kind: "separator" },
      // ターミナルのタブ: 端末の操作と、シェルそのものを止める (閉じるはタブだけ)。
      ...(tab.target.kind === "terminal"
        ? [
            ...deps.terminalMenuItems(),
            { kind: "separator" as const },
            {
              label: current.stopSession,
              title: current.stopSessionTitle,
              danger: true,
              onSelect: () => {
                if (tab.target.kind === "terminal")
                  deps.stopTerminal(tab.target.session);
              },
            },
          ]
        : []),
      // リポジトリの中の画像は、ファイルの画面の履歴 (History) へ行けるように。
      ...(repoImage !== null
        ? [
            {
              label: current.fileHistory,
              onSelect: () => {
                const route = deps.defaultRoute({
                  kind: "file",
                  path: repoImage,
                });
                if (route.screen !== "file")
                  throw new Error(
                    `main tabs: the file route of ${repoImage} is ${route.screen}`,
                  );
                deps.navigate({ ...route, view: "history" });
              },
            },
          ]
        : []),
      {
        label: current.copyPath,
        disabled: !state.copyPath || path === null,
        onSelect: () => {
          if (path !== null) deps.copyPath(path);
        },
      },
    ];
  }

  // ---- ドラッグ ----

  function dropIndex(strip: HTMLElement, clientX: number): number {
    const tabs = [...strip.querySelectorAll<HTMLElement>(".main-tab")];
    for (let index = 0; index < tabs.length; index += 1) {
      const rect = tabs[index].getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) return index;
    }
    return tabs.length;
  }

  function clearDropMarks(): void {
    for (const el of document.querySelectorAll(".main-tab-drop-before"))
      el.classList.remove("main-tab-drop-before");
    for (const side of SIDES)
      sections[side].strip.classList.remove("main-tabs-drop-end");
    dropZone.classList.remove("main-split-drop-over");
  }

  function endDrag(): void {
    dragId = null;
    clearDropMarks();
    dropZone.hidden = true;
    document.body.classList.remove("main-tab-drag-active");
  }

  // 描き直しで掴んだタブの要素が外れると、ブラウザによっては dragend が届かず、
  // 掴んでいる印 (body.main-tab-drag-active・右に分割の落とす先) が残る。ドラッグの
  // 間はポインタの移動は届かないので、ボタンを離した移動が来たら終わっている。
  document.addEventListener(
    "pointermove",
    (event) => {
      if (dragId !== null && event.buttons === 0) endDrag();
    },
    { passive: true },
  );

  /** そのタブを同じ面の中で delta だけ動かす (端では止まる)。 */
  function moveWithin(id: string, delta: number): void {
    const found = findTab(layout, id);
    if (!found) return;
    const result = move(layout, id, found.side, found.index + delta);
    if (result.moved === false)
      throw new Error(`main tabs: tab ${id} was not moved: ${result.reason}`);
    commit(result.layout);
  }

  /** その面の列の、そのタブの要素 (無ければ前面のタブ) にフォーカスを置く。 */
  function focusTabIn(side: PaneSide, id: string | null): void {
    const strip = sections[side].strip;
    const el =
      (id === null
        ? null
        : strip.querySelector<HTMLElement>(
            `.main-tab[data-tab-id="${CSS.escape(id)}"]`,
          )) ?? strip.querySelector<HTMLElement>(".main-tab-active");
    if (!el) return;
    for (const other of strip.querySelectorAll<HTMLElement>(".main-tab"))
      other.tabIndex = other === el ? 0 : -1;
    el.focus({ preventScroll: true });
  }

  /**
   * タブ列のキー (roving tabindex): ←→ Home End でタブを移り、Enter / Space で
   * 前面に、Delete で閉じ、Ctrl+Shift+PageUp / PageDown で並べ替える。
   */
  function onStripKeydown(event: KeyboardEvent, side: PaneSide): void {
    const el = (event.target as Element).closest<HTMLElement>(".main-tab");
    const id = el?.dataset.tabId;
    if (!el || id === undefined || isImeComposing(event)) return;
    const tabs = [
      ...sections[side].strip.querySelectorAll<HTMLElement>(".main-tab"),
    ];
    const index = tabs.indexOf(el);
    const { key } = event;
    if (key === "ContextMenu" || (key === "F10" && event.shiftKey)) {
      const tab = findTab(layout, id)?.tab;
      if (!tab) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      // 戻り先はタブの id で探す。メニューを開いている間もタブ列は数秒おきに
      // 描き直され、開いたときのタブの要素は外れている (Escape でフォーカスが
      // body に落ちていた)。項目がダイアログなどへフォーカスを移したときは
      // 奪わない。
      showContextMenu(el, menuFor(tab), {
        at: { x: rect.left, y: rect.bottom + 4 },
        focusReturn: null,
        onClose: () =>
          queueMicrotask(() => {
            const lost =
              document.activeElement === null ||
              document.activeElement === document.body;
            if (lost) focusTabIn(layout.panes.right ? side : "left", id);
          }),
      });
      return;
    }
    // 並べ替え: Ctrl+Shift+PageUp / PageDown。OS やブラウザが先に取る環境の
    // ために Ctrl+Shift+← → (mac は ⌘+Shift+← → も) でも同じ。
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey) {
      const delta =
        key === "PageUp" || key === "ArrowLeft"
          ? -1
          : key === "PageDown" || key === "ArrowRight"
            ? 1
            : 0;
      if (delta === 0) return;
      event.preventDefault();
      moveWithin(id, delta);
      focusTabIn(side, id);
      return;
    }
    if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey)
      return;
    const step: Record<string, number | undefined> = {
      ArrowLeft: index - 1,
      ArrowRight: index + 1,
      Home: 0,
      End: tabs.length - 1,
    };
    const to = step[key];
    if (to !== undefined) {
      event.preventDefault();
      const target = tabs[(to + tabs.length) % tabs.length];
      focusTabIn(side, target.dataset.tabId ?? null);
      return;
    }
    if (key === "Enter" || key === " ") {
      event.preventDefault();
      if (activeTab(layout)?.id !== id) changeAndGo((l) => activate(l, id));
      focusTabIn(side, id);
      return;
    }
    if (key === "Delete") {
      event.preventDefault();
      closeByUser((l) => close(l, id));
      // 閉じた面が残っていれば、次に前面になったタブへ (1 面に戻れば左へ)。
      focusTabIn(layout.panes.right ? side : "left", null);
    }
  }

  function wireStrip(strip: HTMLElement, side: PaneSide): void {
    strip.addEventListener("keydown", (event) => onStripKeydown(event, side));
    strip.addEventListener("dragover", (event) => {
      if (!dragId) return;
      // 右の面に置けない種類 (ファイル・画面) は落とす先にしない。
      const dragged = findTab(layout, dragId);
      if (dragged && !canPlace(dragged.tab.target, side)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      clearDropMarks();
      const index = dropIndex(strip, event.clientX);
      const tabs = strip.querySelectorAll<HTMLElement>(".main-tab");
      if (index < tabs.length)
        tabs[index].classList.add("main-tab-drop-before");
      else strip.classList.add("main-tabs-drop-end");
    });
    strip.addEventListener("dragleave", (event) => {
      if (!strip.contains(event.relatedTarget as Node | null)) clearDropMarks();
    });
    strip.addEventListener("drop", (event) => {
      if (!dragId) return;
      event.preventDefault();
      const id = dragId;
      const found = findTab(layout, id);
      const index0 = dropIndex(strip, event.clientX);
      endDrag();
      if (!found) return;
      // 同じ面で自分より右へ落とすと、自分が抜けた分だけ 1 つ左にずれる。
      const index =
        found.side === side && index0 > found.index ? index0 - 1 : index0;
      const result = move(layout, id, side, index);
      if (result.moved === false) {
        console.error(
          `[code-viewer] main tab ${id} was not moved: ${result.reason}`,
        );
        return;
      }
      if (found.side === side) commit(result.layout);
      else changeAndGo(() => result.layout);
    });
    // 縦のホイールでも横に送る (トラックパッドの無いマウスで端のタブへ行けるように)。
    strip.addEventListener(
      "wheel",
      (event) => {
        if (
          event.deltaY === 0 ||
          Math.abs(event.deltaX) > Math.abs(event.deltaY)
        )
          return;
        if (strip.scrollWidth <= strip.clientWidth) return;
        event.preventDefault();
        strip.scrollLeft += event.deltaY;
      },
      { passive: false },
    );
  }

  dropZone.addEventListener("dragover", (event) => {
    if (!dragId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    dropZone.classList.add("main-split-drop-over");
  });
  dropZone.addEventListener("dragleave", () =>
    dropZone.classList.remove("main-split-drop-over"),
  );
  dropZone.addEventListener("drop", (event) => {
    if (!dragId) return;
    event.preventDefault();
    const id = dragId;
    endDrag();
    changeAndGo((l) => splitRight(l, id));
  });

  /** タブの名前 (別のプロジェクトのペインならプロジェクト名つき)。 */
  function nameOf(target: TabTarget): TerminalTabName {
    if (target.kind === "terminal") {
      const info = deps.terminalInfo(target.session);
      return terminalTabName(info.label, info.project ?? null);
    }
    const title = labelOf(target);
    return { project: null, title, full: title };
  }

  function renderTab(tab: Tab, active: boolean, side: PaneSide): HTMLElement {
    const current = text();
    const tabName = nameOf(tab.target);
    const label = tabName.full;
    const el = document.createElement("div");
    el.className = "main-tab";
    el.classList.toggle("main-tab-active", active);
    // 上端の線はフォーカスのある面の選択タブだけ (もう一方は面の明るさ)。
    el.classList.toggle(
      "main-tab-focused",
      active && (!layout.panes.right || layout.focused === side),
    );
    el.classList.toggle("main-tab-preview", tab.preview);
    el.classList.toggle("main-tab-file", tab.target.kind === "file");
    // 掴んでいる最中に描き直した (端末の名前・未読の更新など) ときも、掴んで
    // いるタブの印を付け直す (要素が入れ替わって印が消えていた)。
    el.classList.toggle("main-tab-dragging", tab.id === dragId);
    el.dataset.tabId = tab.id;
    el.dataset.kind = tab.target.kind;
    el.setAttribute("role", "tab");
    el.setAttribute("aria-selected", String(active));
    el.tabIndex = active ? 0 : -1;
    el.draggable = true;
    el.title =
      tab.target.kind === "file" || tab.target.kind === "image"
        ? tab.target.path
        : label;
    if (tab.target.kind === "file" && tab.target.ref !== undefined)
      el.title += ` @ ${tab.target.ref}`;
    if (tab.preview) el.title += `\n${current.previewHint}`;
    const icon = document.createElement("span");
    icon.className = "main-tab-icon";
    const state =
      tab.target.kind === "terminal"
        ? deps.terminalInfo(tab.target.session).state
        : null;
    // エージェントを映しているターミナルは、絵の代わりに状態の印 (形で区別する)。
    icon.innerHTML = state
      ? `<i class="terminal-mark terminal-mark-${state}" aria-hidden="true"></i>`
      : iconSvg("main-tab-svg", iconOf(tab.target));
    const name = document.createElement("span");
    name.className = "main-tab-name";
    if (tabName.project === null) name.textContent = label;
    else {
      // 狭くなったら題より先にプロジェクト名を省略する (style.css の
      // .main-tab-project)。
      const project = document.createElement("span");
      project.className = "main-tab-project";
      project.textContent = `${tabName.project}${TAB_PROJECT_SEPARATOR}`;
      const title = document.createElement("span");
      title.className = "main-tab-title";
      title.textContent = tabName.title;
      name.classList.add("main-tab-name-project");
      name.append(project, title);
    }
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "main-tab-close";
    closeButton.tabIndex = -1;
    closeButton.title = current.closeTab(label);
    // 読み上げではタブの名前に混ざる (role=tab の中の押せるボタン)。キーでは
    // タブの上の Delete で閉じるので、閉じるボタンは支援技術から隠す。
    closeButton.setAttribute("aria-hidden", "true");
    closeButton.innerHTML = iconSvg("main-tab-close-svg", CLOSE_ICON_PATH);
    closeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      closeByUser((l) => close(l, tab.id));
    });
    el.append(icon, name, closeButton);

    el.addEventListener("click", () => {
      if (activeTab(layout)?.id === tab.id) return;
      changeAndGo((l) => activate(l, tab.id));
    });
    el.addEventListener("dblclick", (event) => {
      if ((event.target as Element).closest(".main-tab-close")) return;
      commit(keepOpen(layout, tab.id));
    });
    // 中ボタンで閉じる。
    el.addEventListener("auxclick", (event) => {
      if (event.button !== 1) return;
      event.preventDefault();
      closeByUser((l) => close(l, tab.id));
    });
    el.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showContextMenu(el, menuFor(tab), {
        at: { x: event.clientX, y: event.clientY },
      });
    });
    el.addEventListener("dragstart", (event) => {
      dragId = tab.id;
      event.dataTransfer?.setData(DRAG_TYPE, tab.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      el.classList.add("main-tab-dragging");
      // body にはタブと別の印を付ける (同じ名前だとタブを薄くする規則が画面全体に当たっていた)。
      document.body.classList.add("main-tab-drag-active");
      // 1 面で、右に置ける種類 (ファイル・ターミナル・画像) のときだけ右に分割の落とす先を出す。
      dropZone.hidden = !(
        !layout.panes.right &&
        canSplit(layout) &&
        canPlace(tab.target, "right") &&
        splitAllowed()
      );
    });
    el.addEventListener("dragend", () => {
      el.classList.remove("main-tab-dragging");
      endDrag();
    });
    return el;
  }

  function renderActions(): void {
    const current = text();
    // 押せない理由は 1 つだけ出す (条件を全部並べると、どれに当たったか読めない)。
    const blocker = splitBlocker(layout) ?? (splitAllowed() ? null : "narrow");
    const allowed = blocker === null;
    for (const side of SIDES) {
      const { newButton, splitButton, list } = sections[side];
      list.setAttribute(
        "aria-label",
        current.tabList(layout.panes.right ? side : null),
      );
      newButton.title = current.newTab;
      newButton.setAttribute("aria-label", current.newTab);
      // 右の面 (2 面のときだけある): 常に 1 面に戻せる。
      // 左の面: 2 面のときと、狭くて置けないときは無効。右の面を隠している
      // 間は、このボタンが「広げれば戻る」の印になる。
      const left = side === "left";
      // disabled にすると Tab で届かず、押せない理由 (title) を読めない。
      splitButton.setAttribute("aria-disabled", String(left && !allowed));
      splitButton.classList.toggle("main-tabs-action-parked", left && !!parked);
      const label = !left
        ? current.unsplit
        : parked
          ? deps.panelColumnHoldsList?.()
            ? current.rightParkedForList(parked.pane.tabs.length)
            : current.rightParked(parked.pane.tabs.length)
          : blocker === null
            ? current.splitRight
            : current.splitBlocked[blocker];
      splitButton.title = label;
      splitButton.setAttribute("aria-label", label);
    }
    divider.setAttribute("aria-label", current.resizeSplit);
    dropLabel.textContent = current.dropToSplit;
  }

  function render(): void {
    const present = SIDES.filter((side) =>
      side === "left" ? true : !!layout.panes.right,
    );
    // タブの要素は描くたびに作り直す (エージェントの状態が変わるたびに名前を
    // 当て直すので数秒おき)。キーボードでタブにいた人のフォーカスが本文へ
    // 落ちないよう、同じタブの新しい要素へ戻す。
    const focusedTabId =
      document.activeElement instanceof HTMLElement &&
      document.activeElement.classList.contains("main-tab") &&
      deps.mount.contains(document.activeElement)
        ? document.activeElement.dataset.tabId
        : undefined;
    // 面の箱は付けたままにし、面が増えた・減ったときだけ付け直す (毎回外すと、
    // 数秒おきの描き直しのたびに ＋・分割のボタンのフォーカスが消えていた)。
    const wanted = present.map((side) => sections[side].el);
    const children = [...deps.mount.children];
    if (
      children.length !== wanted.length ||
      children.some((child, index) => child !== wanted[index])
    )
      deps.mount.replaceChildren(...wanted);
    for (const side of present) {
      const pane = side === "left" ? layout.panes.left : layout.panes.right;
      if (!pane) continue;
      const strip = sections[side].strip;
      // 描き直しで列が一度空になると横の位置が 0 に戻り、下で前面のタブへ
      // 送り直すとスクロールが起きる (開いているメニューがそれで閉じる)。
      // 位置を戻しておけば、前面のタブが見えている限り何も動かない。
      const scrollLeft = strip.scrollLeft;
      sections[side].list.replaceChildren(
        ...pane.tabs.map((tab) =>
          renderTab(tab, tab.id === pane.activeId, side),
        ),
      );
      strip.scrollLeft = scrollLeft;
      // タブの最小幅は列の幅をこの数で割って決める (style.css の .main-tab)。
      strip.style.setProperty("--main-tab-count", String(pane.tabs.length));
      sections[side].el.classList.toggle(
        "main-tabs-pane-focused",
        layout.focused === side,
      );
      revealFront(strip);
    }
    renderActions();
    if (focusedTabId !== undefined)
      deps.mount
        .querySelector<HTMLElement>(
          `.main-tab[data-tab-id="${CSS.escape(focusedTabId)}"]`,
        )
        ?.focus({ preventScroll: true });
  }

  /**
   * 保存した共通のタブを読む。使えるなら並びを返し、書いてよいかを
   * commonSaveEnabled に置く。まだ無ければ null (この配置の共通のタブが次の
   * 保存で共通になる)。壊れていれば退避してから null、退避できなければ
   * 書かない。新しい版の値も書かない。理由は全部 console に出す。
   */
  async function readCommonTabs(raw: unknown): Promise<TabTarget[] | null> {
    let parsed: ReturnType<typeof parseCommonTabs>;
    try {
      parsed = parseCommonTabs(raw);
    } catch (error) {
      try {
        const backup = await deps.backupSaved();
        console.error(
          `[code-viewer] main tabs: the saved common tabs are broken; the file was backed up to ${backup} and the common tabs start from this page. saved value:`,
          JSON.stringify(raw),
          error,
        );
        commonSaveEnabled = true;
      } catch (backupError) {
        console.error(
          "[code-viewer] main tabs: the saved common tabs are broken and could not be backed up, so they are kept as they are and not saved on this page. saved value:",
          JSON.stringify(raw),
          error,
          backupError,
        );
        commonSaveEnabled = false;
      }
      return null;
    }
    if (parsed.kind === "newer") {
      console.error(
        `[code-viewer] main tabs: the saved common tabs were written by a newer version (common tabs version ${parsed.version}, this page reads up to ${COMMON_TABS_VERSION}); they are kept as they are and not saved on this page`,
      );
      commonSaveEnabled = false;
      return null;
    }
    commonSaveEnabled = true;
    if (parsed.kind === "none") return null;
    if (parsed.dropped.length > 0)
      console.error(
        `[code-viewer] main tabs: dropped ${parsed.dropped.length} saved common tab(s) of an unknown kind:`,
        JSON.stringify(parsed.dropped),
      );
    return parsed.targets;
  }

  async function restore(
    options: { rightRoute?: FileRoute; keepSavedFront?: boolean } = {},
  ): Promise<void> {
    if (restored) return;
    restored = true;
    // 保存した配置を使えないときも、URL が指す右の面のファイルは開く。
    const openUrlRight = () => {
      if (options.rightRoute) openRightRoute(options.rightRoute, "sync", true);
    };
    let saved: unknown;
    let savedCommon: unknown;
    try {
      ({ layout: saved, common: savedCommon } = await deps.loadSaved());
    } catch (error) {
      // 読めなかった配置を、この画面の配置で上書きしない。
      console.error(
        "[code-viewer] main tabs: the saved layout could not be loaded; tabs are not saved on this page",
        error,
      );
      openUrlRight();
      return;
    }
    const commonTargets = await readCommonTabs(savedCommon);
    // 配置を使えない道 (新しい版・保存が無い・壊れた) でも、共通のタブは出す。
    const openCommonHere = () => {
      if (commonTargets) commit(withCommonTabs(layout, commonTargets), "sync");
    };
    if (isNewerLayoutVersion(saved)) {
      // 新しい版のアプリが保存した配置: 読めないが、ここで上書きすると新しい
      // 版へ戻ったときに配置が消える。このページでは保存しない。
      console.error(
        `[code-viewer] main tabs: the saved layout was written by a newer version (layout version ${JSON.stringify((saved as { version: unknown }).version)}, this page reads up to ${LAYOUT_VERSION}); it is kept as it is and tabs are not saved on this page`,
      );
      commonSaveEnabled = false;
      openCommonHere();
      openUrlRight();
      return;
    }
    if (saved === null || saved === undefined) {
      saveEnabled = true;
      openCommonHere();
      scheduleSave();
      openUrlRight();
      return;
    }
    let parsed: ReturnType<typeof parseLayout>;
    try {
      parsed = parseLayout(saved);
    } catch (error) {
      // 壊れた保存値は、退避してから空で始める。退避できなければ上書きしない
      // (このページでは保存しない)。
      let backup: string;
      try {
        backup = await deps.backupSaved();
      } catch (backupError) {
        console.error(
          "[code-viewer] main tabs: the saved layout is broken and could not be backed up, so it is kept as it is and tabs are not saved on this page. saved value:",
          JSON.stringify(saved),
          error,
          backupError,
        );
        commonSaveEnabled = false;
        openCommonHere();
        openUrlRight();
        return;
      }
      console.error(
        `[code-viewer] main tabs: the saved layout is broken; it was backed up to ${backup} and this page starts from an empty layout. saved value:`,
        JSON.stringify(saved),
        error,
      );
      saveEnabled = true;
      openCommonHere();
      scheduleSave();
      openUrlRight();
      return;
    }
    saveEnabled = true;
    if (parsed.dropped.length > 0)
      console.error(
        `[code-viewer] main tabs: dropped ${parsed.dropped.length} saved tab(s) of an unknown kind:`,
        JSON.stringify(parsed.dropped),
      );
    // 廃止・移動は古い版の値を読んだ結果で、不具合ではない。件数と中身は残す。
    if (parsed.retired.length > 0)
      console.info(
        `[code-viewer] main tabs: dropped ${parsed.retired.length} saved Files tab(s); the folder view is now the default of the left side:`,
        JSON.stringify(parsed.retired),
      );
    if (parsed.relocated.length > 0)
      console.info(
        `[code-viewer] main tabs: moved ${parsed.relocated.length} saved page tab(s) from the right side to the left (pages can only be on the left):`,
        JSON.stringify(parsed.relocated),
      );
    // 今の画面 (URL) の route。保存した配置がその route を見せていた (本文の面の
    // 前面か、フォーカスのある面の前面がそのタブ) なら、保存した前面をそのまま
    // 使う。そうでなければ (別の URL を開いた) その route のタブを開いて前面に
    // 出す。前面がターミナルで URL が画面かファイルを指すなら URL を優先する
    // (ブックマークやリンクで開いた Data がターミナルの裏に隠れていた)。
    // ターミナルを前面にしたままの再読み込みは URL に ?terminal= が載るので
    // keepSavedFront で残す。
    const urlRoute = deps.currentRoute();
    const target = routeTarget(urlRoute);
    routes.clear();
    const restoredLayout = commonTargets
      ? withCommonTabs(parsed.layout, commonTargets)
      : parsed.layout;
    seedPageRoutes(restoredLayout, parsed.pageRoutes);
    if (options.rightRoute) {
      // URL は右の面のファイル: 左の面 (本文) は保存した前面のまま。
      layout = restoredLayout;
      fitToWidth();
      openRightRoute(options.rightRoute, "sync", true);
      deps.onTerminals(terminalsOf(fullLayout()), []);
      deps.onPanes(panesView(layout), "sync");
      return;
    }
    const shown = [routeSideOf(restoredLayout), restoredLayout.focused]
      .map((side) => (side ? frontTab(restoredLayout, side) : null))
      .filter((tab): tab is Tab => tab !== null);
    // 本文を出す面が無い (前面がどちらもターミナルか画像) なら、URL は下に
    // 残った route を指している。そのタブが配置にあれば一致とみなす。
    const home = urlRoute.screen === "repo";
    const agrees = home
      ? // フォルダ表示: 保存した左の面が何も選んでいないか、前面がターミナル・画像
        frontTab(restoredLayout, "left") === null ||
        routeSideOf(restoredLayout) === null
      : target !== null &&
        (shown.some((tab) => sameTarget(tab.target, target)) ||
          (options.keepSavedFront === true &&
            routeSideOf(restoredLayout) === null &&
            allTabs(restoredLayout).some((tab) =>
              sameTarget(tab.target, target),
            )));
    layout = restoredLayout;
    fitToWidth();
    if (home && agrees) {
      lastHome = urlRoute;
      commit(layout, "sync");
    } else if (agrees && target) {
      const tab = allTabs(restoredLayout).find((item) =>
        sameTarget(item.target, target),
      );
      if (tab && isRouteTab(tab)) routes.set(tab.id, urlRoute);
      commit(layout, "sync");
    } else syncRoute(urlRoute);
    // 読み戻した面をそのまま知らせる (前面のターミナルかどうかは URL が決める)。
    deps.onTerminals(terminalsOf(fullLayout()), []);
    deps.onPanes(panesView(layout), "sync");
  }

  function findTerminal(session: string): Tab | undefined {
    return allTabs(layout).find(
      (item) =>
        item.target.kind === "terminal" && item.target.session === session,
    );
  }

  applyGeometry();
  render();

  return {
    syncRoute,
    openTerminal(session, pane = "focused") {
      rememberRoute();
      let next = open(layout, { kind: "terminal", session }, { pane });
      const terminal = allTabs(next).find(
        (tab) =>
          tab.target.kind === "terminal" && tab.target.session === session,
      );
      if (terminal && (pane === "left" || pane === "right")) {
        const found = findTab(next, terminal.id);
        if (pane === "right" && !next.panes.right && splitAllowed()) {
          next = splitRight(next, terminal.id);
        } else if (next.panes.right && found?.side !== pane) {
          next = moveToOtherSide(next, terminal.id);
        }
      }
      commit(next);
    },
    closeTerminal(session) {
      const tab = findTerminal(session);
      if (tab) changeAndGo((l) => close(l, tab.id));
    },
    terminalSessions: () => [...terminalsOf(layout)],
    closeTerminals(sessions) {
      for (const session of sessions) {
        const tab = findTerminal(session);
        if (tab) changeAndGo((l) => close(l, tab.id));
      }
    },
    openImage(path, pane = "focused") {
      rememberRoute();
      commit(open(layout, { kind: "image", path }, { pane, ...keptOption() }));
    },
    showHome() {
      changeAndGo(showHome);
    },
    openNewTabMenu() {
      openNewTabMenuIn(layout.panes.right ? layout.focused : "left");
    },
    front: () => activeTab(layout),
    panes: () => panesView(layout),
    splitFitsWithPanelColumn: () =>
      mainWidth() >= COMFORTABLE_PANE_WIDTH * 2 + SPLIT_DIVIDER_WIDTH,
    hasTerminal: (session) => findTerminal(session) !== undefined,
    openingNewTab(run) {
      openingKept = true;
      try {
        run();
      } finally {
        openingKept = false;
      }
    },
    routeForPage(page) {
      const tab = allTabs(layout).find(
        (item) => item.target.kind === "page" && item.target.page === page,
      );
      return tab ? (routes.get(tab.id) ?? null) : null;
    },
    paneRoute(side) {
      if (side === "left") return null;
      const tab = frontTab(layout, side);
      return tab?.target.kind === "file" ? routeOf(tab) : null;
    },
    openRouteRight: (route, fromUrl = false) =>
      openRightRoute(route, fromUrl ? "sync" : "stay"),
    sideHolding(route) {
      const target = routeTarget(route);
      return target ? sideOfTarget(layout, target) : null;
    },
    sideForRoute(route) {
      const target = routeTarget(route);
      return target ? openSide(layout, target) : "left";
    },
    focusSide,
    sideAt(clientX) {
      if (!layout.panes.right) return null;
      const left = deps.mount.getBoundingClientRect().left;
      // 右の列 (木・一覧) と左のサイドバーは面の外: そこから開くときフォーカスを動かさない。
      if (clientX < left || clientX >= left + mainWidth()) return null;
      return clientX < left + leftWidthFor(layout.split ?? DEFAULT_SPLIT)
        ? "left"
        : "right";
    },
    focusOther() {
      focusSide(layout.focused === "left" ? "right" : "left");
    },
    openFrontMenu() {
      const tab = activeTab(layout);
      if (!tab) return false;
      const el = sections[layout.focused].strip.querySelector<HTMLElement>(
        `.main-tab[data-tab-id="${CSS.escape(tab.id)}"]`,
      );
      if (!el)
        throw new Error(
          `main tabs: the front tab ${tab.id} is not rendered in the ${layout.focused} strip`,
        );
      const rect = el.getBoundingClientRect();
      // Escape で戻す先は、キーを押したときにフォーカスのあった場所 (その面の
      // 本文)。タブの要素は裏の更新で描き直されて差し替わることがある。
      const back =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      showContextMenu(el, menuFor(tab), {
        at: { x: rect.left, y: rect.bottom + 4 },
        focusReturn: back,
      });
      return true;
    },
    next: () => changeAndGo(nextTab),
    previous: () => changeAndGo(prevTab),
    reopenClosed() {
      let reopened = false;
      changeAndGo((current) => {
        const result = reopenClosed(current, closedHistory);
        closedHistory = result.history;
        reopened = result.reopened !== null;
        return result.layout;
      });
      return reopened;
    },
    closeActive() {
      const tab = activeTab(layout);
      if (tab) closeByUser((l) => close(l, tab.id));
    },
    activateNth: (n) => changeAndGo((l) => activateIndex(l, n)),
    restore,
    flush,
    localize: render,
    refit: () => followGeometry(),
    layout: () => layout,
  };
}
