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
// タブは全プロジェクト共通の 1 つの配置で、タブはプロジェクトの持ち物を持つ
// (core/main-tabs.ts の target の project)。タブ列はプロジェクトごとのグループに
// 分けて並べる: グループの頭に色の札 (頭文字・名前・▾)、グループのタブの下に色の線。
// グループの並びは左の一覧のプロジェクトの並び (deps.projectOrder)、どの
// プロジェクトのものでもないタブは右端。いま見ているプロジェクト (currentRoot) は
// ページの `/p/<鍵>` で、別のプロジェクトの Diff などの画面のタブを前面に出すと、
// そのプロジェクトへ移る (deps.switchProject。読み直し)。別のプロジェクトの
// ファイル・シェル・画像はその場で出す (面の箱。app.ts)。
//
// 保存は全プロジェクト共通の 1 つ (/_state/tabs)。読み戻しが済むまでは保存しない
// (起動直後の 1 枚だけの配置で、保存してあった配置を上書きしないため)。前に読んだ
// 版 (base と rev) を添えて書き、別の窓が先に書いていればサーバが重ねて返す。別の
// 窓の変更は SSE (tabs) で知り、refreshFromServer で取り直して重ねる
// (core/main-tabs-merge.ts)。

import type {
  AgentOverviewResponse,
  AgentPane,
} from "../../core/agent-overview";
import type { AgentState } from "../../core/agent-state";
import { attachDragResizer } from "../../core/drag-resizer";
import { CHEVRON_DOWN_12_PATH, iconSvg } from "../../core/icons";
import { isImeComposing } from "../../core/keyboard";
import {
  activate,
  activateIndex,
  activeTab,
  allTabs,
  type ClosedTab,
  canPlace,
  canSplit,
  close,
  closedTabs,
  closeGroup,
  closeOthers,
  closeParked,
  closeToRight,
  DEFAULT_SPLIT,
  emptyLayout,
  findTab,
  focusPane,
  frontTab,
  groupFront,
  isNewerLayoutVersion,
  keepOpen,
  LAYOUT_VERSION,
  type Layout,
  move,
  moveToOtherSide,
  nextTab,
  noteGroupFronts,
  type OpenOptions,
  open,
  openRight,
  openSide,
  PAGE_KINDS,
  type PageKind,
  type Pane,
  type PaneSide,
  type ParkedRight,
  parkRight,
  parseLayout,
  prevTab,
  pushClosed,
  regroup,
  reopenClosed,
  type SerializedLayout,
  type SerializedPageRoute,
  sameTarget,
  serializeLayout,
  setCollapsed,
  setSplit,
  showHome,
  sideOfTarget,
  splitBlocker,
  splitRight,
  type Tab,
  type TabGroup,
  type TabTarget,
  tabGroups,
  tabMenu,
  takeParked,
  targetProject,
  unparkRight,
  unsplit,
  WORKTREE_REF,
  withProject,
} from "../../core/main-tabs";
import { mergeLayouts } from "../../core/main-tabs-merge";
import { PHONE_MEDIA_QUERY } from "../../core/mobile-layout";
import { projectInitials } from "../../core/project-colors";
import type { AppRoute } from "../../core/routes";
import type { ShellSession } from "../../core/shell";
import { fitTabWidths, TAB_FLOOR_UNITS } from "../../core/tab-widths";
import { basenameOf } from "../../core/terminal-board";
import { terminalImageExtension } from "../../core/terminal-images";
import {
  projectRootOfPath,
  TAB_PROJECT_SEPARATOR,
  type TerminalTabName,
  type TerminalTabProject,
  terminalTabName,
} from "../../core/terminal-tab-name";
import { isToolId } from "../../core/tools";
import type { ContextMenuItem } from "../context-menu";
import { showContextMenu } from "../context-menu";
import {
  type ProjectLook,
  paintProjectColor,
  projectMark,
} from "../projects/project-looks";
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
 * 2 面がゆとりを持って並ぶ幅。これを下回るなら、一覧の列を詰める・畳む
 * (app.ts の syncListColumn。core/list-column.ts の順)。Data の全体検索と
 * クエリの欄が縦に積まれ始める幅 (560px) の少し下に置いてある: ここを 560 に
 * すると 1600px の窓でも畳むことになり、畳まないで済む幅まで畳んでしまう。
 */
export const COMFORTABLE_PANE_WIDTH = 480;
/**
 * 一覧の列を詰めて畳んでも (または利用者が手で開いて) ゆとりに足りないときに
 * 許す、面の幅の下限。ここまでは両面を
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
   * 左の面のタブ列の先頭に置く箱 (SP の引き出しを開くボタンの置き場所。
   * デスクトップでは空)。中身は呼び出し側が入れる。
   */
  lead?: HTMLElement;
  /**
   * 一覧の列の頭 (最上段の左端、左のサイドバーの右)。その左端から一覧の列
   * (listColumnWidth) を除いた右が本文。無ければタブ列の左端から数える。
   */
  columnHead?: HTMLElement;
  getLanguage(): MainTabsLang;
  /** page のタブの名前 (画面の入口と同じ文言)。 */
  pageLabel(page: PageKind): string;
  /** その route を開く (replace なら履歴を積まない)。 */
  navigate(route: AppRoute, replace?: boolean): void;
  /**
   * 前面 (ターミナル・画像) を変えずに、その下の本文の route だけを置き換える
   * (履歴は積まない。URL の ?terminal= などの重ね書きは残す)。本文の route の
   * タブが閉じられたときに使う (followClosedBody)。
   */
  replaceBody?(route: AppRoute): void;
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
   * 保存した配置 (全プロジェクト共通)。layout が無ければ null。rev は保存の版の
   * 番号、root はこのページのプロジェクトの根 (タブの持ち物)、newer はこの
   * アプリより新しい版のファイル (書かない)、migration は前の版の保存を移した報告。
   */
  loadSaved(): Promise<SavedTabs>;
  /**
   * 書く。base は前に読んだ・書いた保存 (まだ無ければ rev と layout が null)。
   * 返すのは書いた版の番号と値 (merged なら、別の窓の保存と重ねた値)。
   */
  save(
    layout: SerializedLayout,
    keepalive: boolean,
    base: SavedBase,
  ): Promise<SavedWrite | undefined>;
  /** 新しいタブの id。窓どうしでぶつからない値 (既定は乱数)。 */
  newTabId?(): string;
  /** プロジェクトの色・頭文字・名前 (知らなければ null。名前はパスの末尾で出す)。 */
  projectLook?(root: string): ProjectLook | null;
  /** グループの並び (左の一覧のプロジェクトの並び)。 */
  projectOrder?(): readonly string[];
  /**
   * そのシェルのグループ (shellGroupOf。どれでもなければ null、まだ・一時的に
   * 分からなければ undefined: 保存した控えを使う)。
   */
  terminalProject?(session: string): string | null | undefined;
  /**
   * そのプロジェクトへ移る (ページを読み直す)。path はそのプロジェクトの中の
   * 画面のパス (前置きなし)。移れなければ理由を出すのは呼ばれた側。
   */
  switchProject?(root: string, route: AppRoute | null, tab: Tab | null): void;
  /**
   * グループの ▾ の「新しいシェル」: そのプロジェクトの根をカレントにした
   * シェルを side の面に開く (＋ の新しいシェルと同じ作り方)。できたシェルは
   * openTerminal でその面の前面に置いてもらい、terminalProject でそのグループに
   * 入る。失敗を出すのは呼ばれた側。無ければ項目を押せない。
   */
  newShellIn?(root: string, side: PaneSide): void;
  /**
   * グループの ▾ の「新しいエージェント…」: そのプロジェクトを選んだ状態の
   * 起動の画面を開く。無ければ項目を押せない。
   */
  launchAgentIn?(root: string): void;
  /**
   * グループの ▾ の新しいシェル・エージェントを押せるかの材料 (決めるのは
   * groupMenuFor だけ)。shellUnavailable はシェルを開けない理由 (開ける・まだ
   * 分からないなら null)、git はそのプロジェクトが git のリポジトリか (分から
   * なければ null)。
   */
  groupFacts?(root: string): {
    shellUnavailable: string | null;
    git: boolean | null;
  };
  /**
   * 別のプロジェクトのファイルをその場で出せるか (入口のサーバの下だけ。1 つで
   * 完結するサーバでは、そのプロジェクトへ移って出す)。
   */
  foreignInPlace?(): boolean;
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
   * 一覧の列に今の画面の一覧 (Diff・History・作業ツリー) を出しているか。右の面を
   * 預けたときの説明をそれに合わせる (一覧を出すために預けた)。
   */
  listColumnHoldsList?(): boolean;
  /**
   * 一覧の列が本文の横に取っている幅 (core/panel-column-policy.ts の
   * listColumnBodyWidth。出していなければ 0)。本文の幅は一覧の列の頭の左端から
   * これを引いた幅。
   */
  listColumnWidth?(): number;
  /**
   * 2 面にしたときの一覧の列の幅 (幅が足りなければ詰めて畳んだ幅。
   * core/list-column.ts の listColumnLayout を 2 面の本文で当てる)。2 面を置けるかは
   * この幅で数える (1 面の今の幅で数えると、畳めば入る幅でも分割できない)。無ければ
   * listColumnWidth。
   */
  splitListColumnWidth?(): number;
  /**
   * 電話の段のタブ列の右端の「開いているタブ」を押した (一覧の面を開く。
   * views/mobile-shell.ts)。無ければボタンを出さない。
   */
  onTabList?(): void;
};

export type SavedTabs = {
  layout: unknown;
  rev?: number | null;
  root?: string | null;
  newer?: number;
  migration?: unknown;
};

export type SavedBase = { rev: number | null; layout: SerializedLayout | null };

export type SavedWrite = { rev: number; layout: unknown; merged: boolean };

/** 電話の段のタブの一覧の 1 行 (左の面のタブと、預けた右の面のタブ)。 */
export type TabListEntry = {
  id: string;
  /** タブの名前 (タブ列と同じ)。 */
  name: string;
  /** 補足 (ファイルのパスと版。タブの title と同じ)。 */
  title: string;
  /** タブ列と同じ絵 (エージェントを映す端末は状態の印)。 */
  iconHtml: string;
  /** 左の面の前面のタブ。 */
  front: boolean;
  preview: boolean;
  /** 右の面 (電話では預けていて見えない) のタブ。 */
  parked: boolean;
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
  /** 画面の x 座標がどちらの面か (2 面でないか、一覧の列の上なら null)。 */
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
  /** 電話の段のタブの一覧: 左の面のタブ、続けて預けた右の面のタブ。 */
  tabList(): TabListEntry[];
  /**
   * 一覧から前面に出す。預けた右の面のタブは左の面へ移して出す (電話では右の
   * 面を出さないので)。
   */
  bringToFront(id: string): void;
  /** 一覧から閉じる (×と同じく、閉じたタブの履歴に積む)。 */
  closeTab(id: string): void;
  /** タブ列を描き直したあとに呼ぶ (一覧の面を開いている間の描き直し)。外す関数を返す。 */
  onRender(listener: () => void): () => void;
  /**
   * 本文 (#content) に描くタブか: このページのプロジェクトのファイル・画面
   * (と、どのプロジェクトのものでもない画面)。別のプロジェクトのファイルは面の
   * 箱に、別のプロジェクトの画面は移ってから出す。
   */
  isRouteTab(tab: Tab | null): boolean;
  /** このページのプロジェクトの根 (読み戻す前・知らなければ null)。 */
  currentProject(): string | null;
  /** タブのグループ (プロジェクトの根。どれでもなければ null)。 */
  groupOf(tab: Tab): string | null;
  /** タブの今の route (ファイル・画面のタブ。ほかは null)。 */
  tabRoute(tab: Tab): AppRoute | null;
  /** 別のプロジェクトのファイルのタブの中の移動 (Code / Preview・行)。 */
  setTabRoute(id: string, route: AppRoute): void;
  /**
   * そのプロジェクトへ移る前に、そのグループで最後に前面だったタブを前面に
   * して保存し、そのタブを返す (無ければ null: 移った先はフォルダ表示)。
   */
  prepareProjectSwitch(root: string): Tab | null;
  /** 保存を取り直し、別の窓の変更をこの窓の配置に重ねる (SSE の tabs・取り直し)。 */
  refreshFromServer(): Promise<void>;
  /** テストと確認用。 */
  layout(): Layout;
};

type FileRoute = Extract<AppRoute, { screen: "file" }>;

/**
 * シェルのタブのグループ (プロジェクトの根)。映しているペインのプロジェクト、
 * 無ければシェルを起こしたフォルダを含むプロジェクト (roots の前方一致の
 * いちばん深いもの)。どれでもなければ null (タブ列の右端)。
 *
 * 分からない間は undefined (画面は前の値の控えで描く)。一覧がまだ無い、に加えて
 * 一時的に分からないとき: tmux の一覧が取れなかった応答 (ペインもプロジェクトも
 * 空で届く)・tmux のクライアントの一覧が取れなかった・ペインを映していたシェルの
 * 結び付きが外れている・シェルの端末名がまだ引けていない・シェルの一覧に無い
 * (サーバが起き直して終わったシェルのタブは、開き直すまで残る)。ここで null や
 * 起こしたフォルダに落とすと、タブが一瞬右端や別のグループへ飛び、並びが変わって
 * いた。
 */
export function shellGroupOf(input: {
  overview: Pick<AgentOverviewResponse, "tmux" | "errors"> | null;
  /** 映しているペイン (見つからなければ undefined)。 */
  pane: AgentPane | undefined;
  /** シェルの一覧のそのシェル (一覧に無い・一覧がまだ無ければ undefined か null)。 */
  shell: ShellSession | undefined | null;
  /** この画面で、そのシェルがペインを映していたことがあるか。 */
  showedPane: boolean;
  roots: readonly string[];
}): string | null | undefined {
  const { overview, pane, shell } = input;
  if (!overview) return undefined;
  if (pane) return pane.project || null;
  if (
    overview.tmux.error ||
    overview.errors.some((item) => item.operation === "list_clients") ||
    input.showedPane ||
    !shell ||
    shell.tty === ""
  )
    return undefined;
  return projectRootOfPath(shell.cwd, input.roots);
}

export function isPageKind(value: string | undefined): value is PageKind {
  return (PAGE_KINDS as readonly (string | undefined)[]).includes(value);
}

/** タブの名前に添える版の印。コミットの sha は 7 文字、ほか (ブランチ・HEAD) はそのまま。 */
function shortRef(ref: string): string {
  return /^[0-9a-f]{8,40}$/i.test(ref) ? ref.slice(0, 7) : ref;
}

/** ファイルと各画面 (route で中身が決まり、本文に描くタブ)。プロジェクトは見ない。 */
export function isRouteTab(tab: Tab | null): boolean {
  return tab?.target.kind === "file" || tab?.target.kind === "page";
}

/** 別のプロジェクトの持ち物のタブか (持ち物が無い・このプロジェクトなら false)。 */
function isForeign(tab: Tab | null, root: string | null): boolean {
  const project = tab ? targetProject(tab.target) : null;
  return project !== null && root !== null && project !== root;
}

/**
 * route をタブの中身に。画像のファイルを開く route (view が無いか blob) は
 * 画像のタブ。画像でも履歴・blame の route はファイルのタブ (ファイルの画面の
 * History / Blame を無くさない)。タブにならない route は null: フォルダ表示
 * (repo) は左の面の本文の既定で、タブにしない。
 */
export function routeTarget(
  route: AppRoute,
  project?: string | null,
): TabTarget | null {
  const target = routeTargetBody(route);
  return target && project ? withProject(target, project) : target;
}

function routeTargetBody(route: AppRoute): TabTarget | null {
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
    case "settings":
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
function routeSideOf(layout: Layout, root: string | null): PaneSide | null {
  const front = frontTab(layout, "left");
  return front === null || (isRouteTab(front) && !isForeign(front, root))
    ? "left"
    : null;
}

function panesView(layout: Layout, root: string | null): PanesView {
  return {
    split: !!layout.panes.right,
    focused: layout.focused,
    fronts: {
      left: frontTab(layout, "left"),
      right: frontTab(layout, "right"),
    },
    routeSide: routeSideOf(layout, root),
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
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** このページのプロジェクトの根 (読み戻しで知る。知らなければ null)。 */
  let currentRoot: string | null = null;
  /**
   * 前に読んだ・書いた保存 (版の番号と値)。書くときに添え、別の窓の変更を重ねる
   * ときの元にする (core/main-tabs-merge.ts)。
   */
  let base: { rev: number | null; layout: SerializedLayout | null } = {
    rev: null,
    layout: null,
  };
  /** 書いている最中か。書き終わるまで次の書き込みは待たせる (同じ base で 2 本送らない)。 */
  let saving = false;
  /** 書いている間に次の保存を頼まれた (書き終わったら書く)。 */
  let saveAgain = false;
  /** 書いている間に取り直しを頼まれた (書き終わったら取り直す)。 */
  let refreshAgain = false;
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
  /** 描き直しのたびに呼ぶもの (電話の段のタブの一覧の面)。 */
  const renderListeners = new Set<() => void>();

  /** 仮にするかの指定 (openingNewTab の間は固定)。 */
  function keptOption(): Pick<OpenOptions, "preview"> {
    return openingKept ? { preview: false } : {};
  }

  // ---- プロジェクトとグループ ----

  /** 窓どうしでぶつからないタブの id (保存を重ねるときの同一性)。 */
  function freshId(): string {
    if (deps.newTabId) return deps.newTabId();
    return `t-${crypto.randomUUID().slice(0, 8)}`;
  }

  /** 中身のグループ: シェルは動いているフォルダのプロジェクト、ほかは持ち物。 */
  function groupOfTarget(target: TabTarget): string | null {
    if (target.kind === "terminal") {
      const live = deps.terminalProject?.(target.session);
      if (live !== undefined) return live;
      return layout.terminalGroups?.[target.session] ?? null;
    }
    return targetProject(target);
  }

  /** 分かったシェルのグループを控えに写す (読み込み直後に同じ並びで描くため)。 */
  function withTerminalGroups(next: Layout): Layout {
    const groups: Record<string, string> = {};
    for (const tab of allTabs(next)) {
      if (tab.target.kind !== "terminal") continue;
      const live = deps.terminalProject?.(tab.target.session);
      const root =
        live === undefined ? next.terminalGroups?.[tab.target.session] : live;
      if (root) groups[tab.target.session] = root;
    }
    const same =
      JSON.stringify(groups) === JSON.stringify(next.terminalGroups ?? {});
    if (same) return next;
    const { terminalGroups: _old, ...rest } = next;
    return Object.keys(groups).length > 0
      ? { ...rest, terminalGroups: groups }
      : rest;
  }

  function keyOf(tab: Tab): string | null {
    return groupOfTarget(tab.target);
  }

  /**
   * グループの並びの位置: 左の一覧の並び、一覧に無いプロジェクトはその後ろ、
   * どのプロジェクトのものでもないタブは右端。
   */
  function rankOf(tab: Tab): number {
    return rankOfKey(keyOf(tab));
  }

  function rankOfKey(key: string | null): number {
    if (key === null) return Number.MAX_SAFE_INTEGER;
    const order = deps.projectOrder?.() ?? [];
    const index = order.indexOf(key);
    return index >= 0 ? index : order.length;
  }

  /**
   * 面のグループ。左の面 (本文の面) には、いま見ているプロジェクトのグループを
   * タブが 0 枚でも並びの位置に入れる: フォルダ表示はタブにしないので、タブの無い
   * プロジェクトを開くと札が出ず、どのプロジェクトを見ているか分からなかった。
   */
  function groupsOf(side: PaneSide, pane: Pane): TabGroup[] {
    const groups = tabGroups(pane.tabs, keyOf);
    const root = currentRoot;
    if (side !== "left" || root === null) return groups;
    if (groups.some((group) => group.key === root)) return groups;
    const rank = rankOfKey(root);
    const at = groups.findIndex((group) => rankOfKey(group.key) > rank);
    const empty = { key: root, tabs: [] };
    return at < 0
      ? [...groups, empty]
      : [...groups.slice(0, at), empty, ...groups.slice(at)];
  }

  /** 本文に描くタブか (このプロジェクトのファイル・画面)。 */
  function routeTab(tab: Tab | null): boolean {
    return isRouteTab(tab) && !isForeign(tab, currentRoot);
  }

  /** 別のプロジェクトの、移ってから出すタブか (画面。ファイルはその場で出せなければ)。 */
  function needsSwitch(tab: Tab | null): boolean {
    if (!tab || !isForeign(tab, currentRoot)) return false;
    if (tab.target.kind === "page") return true;
    return tab.target.kind === "file" && deps.foreignInPlace?.() !== true;
  }

  /** route のタブの中身 (このページのプロジェクトの持ち物として)。 */
  function targetOf(route: AppRoute): TabTarget | null {
    return routeTarget(route, currentRoot);
  }

  function openTab(
    current: Layout,
    target: TabTarget,
    opts: OpenOptions = {},
  ): Layout {
    return open(current, target, {
      newId: freshId,
      groupOf: groupOfTarget,
      ...opts,
    });
  }

  /**
   * 並べ直しでグループの外へ出たタブの元の場所 (タブの id → 元のグループ・
   * 左にあった同じグループのタブ (近い順)・グループの中の位置)。シェルのグループは一瞬
   * 外れて戻ることがある (cd で出て戻った・一時的に分からない間の控えが無かった)。
   * regroup は今の位置で並べ直すので、戻ったタブがグループの末尾に入っていた。
   */
  const homes = new Map<
    string,
    { key: string; left: string[]; index: number }
  >();
  /** 前に並べ直したときの各タブのグループ (外へ出た・戻ったを知る)。 */
  let lastKeys = new Map<string, string | null>();

  /** 外へ出たタブの元の場所を覚え、元のグループへ戻ったタブを元の場所へ入れる。 */
  function returnHome(next: Layout): Layout {
    let out = next;
    for (const side of SIDES) {
      const pane = side === "left" ? out.panes.left : out.panes.right;
      if (!pane) continue;
      // 並びは外へ出る前のまま (前に並べ直した並び) なので、元の左隣が引ける。
      pane.tabs.forEach((tab, at) => {
        const was = lastKeys.get(tab.id);
        if (was == null || keyOf(tab) === was || homes.has(tab.id)) return;
        const before = pane.tabs
          .slice(0, at)
          .filter((item) => lastKeys.get(item.id) === was);
        homes.set(tab.id, {
          key: was,
          left: before.map((item) => item.id).reverse(),
          index: before.length,
        });
      });
      const back = pane.tabs
        .flatMap((tab) => {
          const home = homes.get(tab.id);
          return home && home.key === keyOf(tab) ? [{ tab, home }] : [];
        })
        .sort((a, b) => a.home.index - b.home.index);
      if (back.length === 0) continue;
      const moving = new Set(back.map((item) => item.tab.id));
      let tabs = pane.tabs.filter((tab) => !moving.has(tab.id));
      // 元の左隣の右へ。左隣が閉じられていれば、残っているうちでいちばん近い
      // 左のタブの右 (どれも無ければグループの先頭)。一緒に出たタブは元の位置の
      // 順に戻すので、互いの左隣が先に戻っている。
      for (const { tab, home } of back) {
        homes.delete(tab.id);
        const inGroup = (item: Tab) => keyOf(item) === home.key;
        const left = home.left
          .map((id) =>
            tabs.findIndex((item) => item.id === id && inGroup(item)),
          )
          .find((at) => at >= 0);
        const first = tabs.findIndex(inGroup);
        const at =
          left !== undefined ? left + 1 : first >= 0 ? first : tabs.length;
        tabs = [...tabs.slice(0, at), tab, ...tabs.slice(at)];
      }
      out = { ...out, panes: { ...out.panes, [side]: { ...pane, tabs } } };
    }
    return out;
  }

  /** グループの順に並べ直し、前面をそのグループの前面として覚える。 */
  function normalize(next: Layout): Layout {
    // groupOfTarget は layout の控えを読むので、控えを先に今の値にする。
    layout = withTerminalGroups(next);
    const result = regroup(noteGroupFronts(returnHome(layout), keyOf), rankOf);
    const open = new Set(
      [...allTabs(result), ...(parked?.pane.tabs ?? [])].map((tab) => tab.id),
    );
    for (const id of homes.keys()) if (!open.has(id)) homes.delete(id);
    lastKeys = new Map(allTabs(result).map((tab) => [tab.id, keyOf(tab)]));
    return result;
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
    /** 電話の段だけ出す「開いているタブ」と枚数の枠 (左の面だけ)。 */
    listButton: { button: HTMLButtonElement; count: HTMLElement } | null;
  };
  const sections = {} as Record<PaneSide, Section>;
  const phoneQuery = window.matchMedia(PHONE_MEDIA_QUERY);
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
    // 電話の段では分割のボタンの代わりに、開いているタブの一覧の入口を置く
    // (88px のタブが 2 枚しか見えず、預けた右の面のタブには届かない)。
    let listButton: Section["listButton"] = null;
    if (side === "left" && deps.onTabList) {
      const onTabList = deps.onTabList;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "main-tabs-action main-tabs-list-open";
      button.setAttribute("aria-haspopup", "dialog");
      button.hidden = true;
      // 枚数を四角の枠に入れて出す (ブラウザのタブの数の印と同じ形)。
      const count = document.createElement("span");
      count.className = "main-tabs-list-count";
      button.append(count);
      button.addEventListener("click", () => onTabList());
      actions.append(button);
      listButton = { button, count };
    }
    actions.append(splitButton);
    strip.append(list, newButton);
    if (side === "left" && deps.lead) el.append(deps.lead);
    el.append(strip, actions);
    wireStrip(strip, side);
    return { el, strip, list, newButton, splitButton, listButton };
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

  /** 本文の左端 (一覧の列の右)。 */
  function bodyLeft(): number {
    const base = (deps.columnHead ?? deps.mount).getBoundingClientRect().left;
    return base + (deps.listColumnWidth?.() ?? 0);
  }

  /**
   * 本文の横幅 (一覧の列の右から窓の右端まで)。面の最小幅はこの幅で数える
   * (一覧の列を含めない)。
   */
  function mainWidth(): number {
    return document.documentElement.clientWidth - bodyLeft();
  }

  /**
   * 2 面を置ける幅か。下限は詰めたときの幅 (TIGHT_PANE_WIDTH)。ゆとりのある
   * 幅 (COMFORTABLE_PANE_WIDTH) を下回るときに一覧の列を詰める・畳むのは app.ts
   * (core/list-column.ts の listColumnLayout)。
   */
  function splitAllowed(): boolean {
    // 電話の段 (横向きの電話は幅が足りても) では 2 面を組まない。保存された
    // 2 面は右の面を預けて 1 面にし、デスクトップの幅に戻れば戻す (fitToWidth)。
    if (phoneQuery.matches) return false;
    const base = (deps.columnHead ?? deps.mount).getBoundingClientRect().left;
    const column =
      deps.splitListColumnWidth?.() ?? deps.listColumnWidth?.() ?? 0;
    const width = document.documentElement.clientWidth - base - column;
    return width >= TIGHT_PANE_WIDTH * 2 + SPLIT_DIVIDER_WIDTH;
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
  // 列が狭くなると (窓・面・一覧の列の幅) 前面のタブが列の外へ出ることがある。
  // 列の幅が変われば、タブを縮める割合も合わせ直す (fitTabs)。
  const stripObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (!(entry.target instanceof HTMLElement)) continue;
      const side = SIDES.find((item) => sections[item].strip === entry.target);
      const pane = side ? paneOfSide(side) : undefined;
      if (side && pane) fitTabs(side, pane);
      revealFront(entry.target);
    }
  });
  for (const side of SIDES) stripObserver.observe(sections[side].strip);
  // 電話の段に入る・出るとタブ列の組み方 (左端の枠の幅・右の面) が変わり、
  // 列の送り量が 0 のまま前面のタブが外に残ることがある。面を合わせ直してから
  // 前面のタブを見える所へ送る。
  phoneQuery.addEventListener("change", () => {
    followGeometry();
    for (const side of SIDES) revealFront(sections[side].strip);
  });

  /** 窓・本文・一覧の列の寸法が変わったあとに、面の幅と 2 面の可否を合わせる。 */
  function followGeometry(): void {
    const before = panesView(layout, currentRoot);
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
    const after = panesView(layout, currentRoot);
    if (!sameView(before, after)) deps.onPanes(after, "stay");
    followRouteSide("stay");
  }
  const geometryObserver = new ResizeObserver(followGeometry);
  geometryObserver.observe(deps.mount);
  // 一覧の列の頭の幅が変わる (左のサイドバーを畳むと頭の先頭に開くボタンが出る)。
  // 一覧の列の幅の変化は app.ts が refit() で知らせる。
  if (deps.columnHead) geometryObserver.observe(deps.columnHead);
  // ResizeObserver は描画の段で届くので、背面のタブ (document.hidden) では前面に
  // 戻るまで届かない。読み込み直後は面の幅を列が開いたまま (240px) で数え、
  // そのあと 2 面のために列を畳む (body の印) ので、--split-left-w が畳む前の
  // 幅 (1280 で 380px) のまま残り、面の中身だけが畳んだあとの幅で並んでいた。
  // 列の開閉・画面の切替は body の印で起きるので、それも見て合わせ直す
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
    // 書いている最中なら、書き終わってから今の配置を書く (同じ base で 2 本送ると、
    // 自分の 1 本目を別の窓の変更として重ねることになる)。ページを離れるときは
    // 待てないので送る (サーバが重ねる)。
    if (saving && !keepalive) {
      saveAgain = true;
      return;
    }
    void send(keepalive);
  }

  async function send(keepalive: boolean): Promise<void> {
    const sentLayout = fullLayout();
    const sent = serializeLayout(sentLayout, savedPageRoute);
    saving = true;
    try {
      const written = await deps.save(sent, keepalive, baseToSend());
      if (!written) return;
      const remote = parseLayout(written.layout);
      // 別の窓の保存と重ねて書いた: 重ねた値を、送った後のこの窓の変更と合わせる。
      if (written.merged) applyRemote(sentLayout, remote);
      base = { rev: written.rev, layout: written.layout as SerializedLayout };
    } catch (error) {
      console.error("[code-viewer] main tabs could not be saved", error);
    } finally {
      saving = false;
      if (saveAgain) {
        saveAgain = false;
        scheduleSave();
      }
      if (refreshAgain) {
        refreshAgain = false;
        void refreshFromServer();
      }
    }
  }

  /**
   * 前に読んだ保存を、この窓のグループの順に並べ直した配置。この窓はグループの順に
   * 並べ直して持つ (normalize) ので、並べ直す前の値と比べると、並べ直しただけの
   * タブを「この窓で動かした」と数え、別の窓が右へ移したタブを古い場所へ戻していた。
   */
  function baseLayout(): Layout | null {
    return base.layout
      ? regroup(parseLayout(base.layout).layout, rankOf)
      : null;
  }

  /** 書くときに添える base (並べ直した値。サーバはこれと比べて重ねる)。 */
  function baseToSend(): SavedBase {
    const from = baseLayout();
    return { rev: base.rev, layout: from ? serializeLayout(from) : null };
  }

  /** 窓の間で共有する中身 (タブの並び・仮か・畳んだグループ)。前面は窓ごと。 */
  function sharedSignature(target: Layout): string {
    const pane = (side: PaneSide) =>
      (side === "left" ? target.panes.left : target.panes.right)?.tabs.map(
        (tab) => [tab.id, tab.target, tab.preview],
      ) ?? null;
    return JSON.stringify([
      pane("left"),
      pane("right"),
      target.collapsed ?? [],
    ]);
  }

  /**
   * 別の窓の変更 (remote) を、この窓の配置に重ねる。from は remote の元になった
   * この窓の値 (前に読んだ保存か、送った配置)。この窓にしか無い変更が残れば書く。
   */
  function applyRemote(
    from: Layout | null,
    remote: ReturnType<typeof parseLayout>,
  ): void {
    const merged = mergeLayouts(from, fullLayout(), remote.layout);
    for (const [mine, theirs] of merged.renamed) {
      const route = routes.get(mine);
      routes.delete(mine);
      if (route && !routes.has(theirs)) routes.set(theirs, route);
    }
    const fresh: Record<string, SerializedPageRoute> = {};
    for (const [id, route] of Object.entries(remote.pageRoutes))
      if (!routes.has(id)) fresh[id] = route;
    seedPageRoutes(merged.layout, fresh);
    const differs =
      sharedSignature(merged.layout) !== sharedSignature(remote.layout);
    commit(merged.layout, "stay", null, { save: differs });
  }

  async function refreshFromServer(): Promise<void> {
    if (!saveEnabled) return;
    // 書いている最中は、書いた結果が base を進める。書き終わってから取り直す。
    if (saving) {
      refreshAgain = true;
      return;
    }
    let saved: SavedTabs;
    try {
      saved = await deps.loadSaved();
    } catch (error) {
      console.error(
        "[code-viewer] main tabs: the saved layout could not be reloaded after another window changed it",
        error,
      );
      return;
    }
    const rev = saved.rev ?? null;
    // 版の番号は書くたびに進む。この窓が知っている版より新しいときだけ重ねる: 取り
    // 直しの答えが、この窓の保存より前の版のまま後から届くことがある (それを重ねると、
    // この窓がした分割などを古い値で戻していた)。
    if (
      rev === null ||
      (base.rev !== null && rev <= base.rev) ||
      saved.layout === null
    )
      return;
    let remote: ReturnType<typeof parseLayout>;
    try {
      remote = parseLayout(saved.layout);
    } catch (error) {
      console.error(
        "[code-viewer] main tabs: the layout saved by another window is broken; this window keeps its tabs. saved value:",
        JSON.stringify(saved.layout),
        error,
      );
      return;
    }
    const from = baseLayout();
    base = { rev, layout: saved.layout as SerializedLayout };
    applyRemote(from, remote);
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

  /**
   * nextParked を渡すと預けた右の面も差し替える (電話の段のタブの一覧から
   * 預けたタブを前面に出す・閉じる)。閉じた端末を数えるため、差し替える前の
   * 全体を先に数える。
   */
  function commit(
    next: Layout,
    how: FrontChange = "stay",
    nextParked?: ParkedRight | null,
    options: { save?: boolean } = {},
  ): void {
    const before = panesView(layout, currentRoot);
    const terminalsBefore = terminalsOf(fullLayout());
    if (nextParked !== undefined) parked = nextParked;
    layout = normalize(next);
    fitToWidth();
    pruneRoutes();
    applyGeometry();
    render();
    if (options.save !== false) scheduleSave();
    const terminals = terminalsOf(fullLayout());
    const closed = [...terminalsBefore].filter((id) => !terminals.has(id));
    if (
      closed.length > 0 ||
      [...terminals].some((id) => !terminalsBefore.has(id))
    )
      deps.onTerminals(terminals, closed);
    const after = panesView(layout, currentRoot);
    if (!sameView(before, after)) deps.onPanes(after, how);
    followRouteSide(how);
    followClosedBody(how);
  }

  /**
   * 本文の route のタブが配置から消えた (前面がターミナル・画像の間に閉じた・
   * 別の窓で閉じたのが届いた) ら、本文を左の面に残った route のタブ (最近前面
   * だった順。無ければフォルダ表示) へ置き換える。前面が route のタブなら
   * followRouteSide が移すので、ここは前面が route のタブでないときだけ。
   * 残すと本文と URL が閉じたタブの route のままで、次の読み直しで restore が
   * そのタブを作り直していた (閉じたタブが戻る)。
   */
  function followClosedBody(how: FrontChange): void {
    if (how === "navigate" || routeSideOf(layout, currentRoot) !== null) return;
    const current = deps.currentRoute();
    if (current.screen === "repo") return;
    const target = targetOf(current);
    if (
      !target ||
      allTabs(fullLayout()).some((tab) => sameTarget(tab.target, target))
    )
      return;
    const pane = layout.panes.left;
    const recent = [...pane.recent]
      .reverse()
      .flatMap((id) => pane.tabs.filter((tab) => tab.id === id));
    const next = [...recent, ...pane.tabs].find((tab) => routeTab(tab));
    deps.replaceBody?.(next ? routeOf(next) : homeRoute());
  }

  /**
   * 本文の面の前面のタブと、いま描いている route が食い違ったら、その
   * タブの route へ移る (面を閉じた・フォーカスを移した後など)。フォーカスは
   * そのまま。URL から来たとき (sync) は履歴を積まない。
   */
  function followRouteSide(how: FrontChange): void {
    if (how === "navigate") return;
    const side = routeSideOf(layout, currentRoot);
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
  function changeAndGo(
    change: (current: Layout) => Layout,
    nextParked?: ParkedRight | null,
  ): void {
    rememberRoute();
    // 閉じた・移したあとの前面が別のプロジェクトの画面になるなら、移らずに外す
    // (移るのは、利用者がそのタブを前面に出したときだけ: activateTab)。
    const next = withoutSwitchFronts(change(layout));
    const after = activeTab(next);
    if (!after) {
      // 左の面で何も選んでいない: 本文の既定 (フォルダ表示) を出す。
      if (deps.currentRoute().screen === "repo") {
        commit(next, "stay", nextParked);
        return;
      }
      commit(next, "navigate", nextParked);
      deps.navigate(homeRoute());
      return;
    }
    // 右の面のファイルは本文ではなく右の面の箱に描く (app の showPanes)。
    if (!routeTab(after) || next.focused === "right") {
      commit(next, "stay", nextParked);
      return;
    }
    const route = routeOf(after);
    if (JSON.stringify(route) === JSON.stringify(deps.currentRoute())) {
      commit(next, "stay", nextParked);
      return;
    }
    commit(next, "navigate", nextParked);
    deps.navigate(route);
  }

  /**
   * タブを前面に出す (押す・Enter・次 / 前・n 番目)。別のプロジェクトの画面の
   * タブ (と、その場で出せないファイル) なら、そのプロジェクトへ移る。
   */
  function activateTab(id: string): void {
    const tab = findTab(layout, id)?.tab;
    if (!tab) return;
    if (needsSwitch(tab)) {
      switchToTab(tab);
      return;
    }
    if (activeTab(layout)?.id === id) return;
    changeAndGo((l) => activate(l, id));
  }

  /** 並びの中の前面の移り (次 / 前・n 番目) を、activateTab で行う。 */
  function activateBy(step: (current: Layout) => Layout): void {
    const tab = activeTab(step(layout));
    if (tab) activateTab(tab.id);
  }

  /**
   * そのタブのプロジェクトへ移る: 前面にして保存してから (移った先の読み戻しが
   * このタブを前面に出す) 移る。移るまでは面に「開いています」を出す (app.ts)。
   */
  function switchToTab(tab: Tab): void {
    const root = keyOf(tab);
    if (root === null) return;
    rememberRoute();
    commit(activate(layout, tab.id));
    flush(true);
    deps.switchProject?.(root, isRouteTab(tab) ? routeOf(tab) : null, tab);
  }

  /** グループの ▾ の「このプロジェクトに切り替える」。 */
  function switchToProject(root: string): void {
    const tab = prepareProjectSwitch(root);
    deps.switchProject?.(
      root,
      tab && isRouteTab(tab) ? routeOf(tab) : null,
      tab,
    );
  }

  function prepareProjectSwitch(root: string): Tab | null {
    const tab = groupFront(layout, root, keyOf);
    const side = tab ? findTab(layout, tab.id)?.side : undefined;
    if (tab && side && frontTab(layout, side)?.id !== tab.id) {
      rememberRoute();
      commit(activate(layout, tab.id));
    }
    flush(true);
    return tab;
  }

  /**
   * 利用者が閉じた (×・中ボタン・Delete・右クリック・g x)。閉じたタブを履歴に
   * 積む (reopenClosed で開き直せる)。シェルが消えて閉じたタブは積まない
   * (closeTerminal はこれを通らない)。
   */
  function closeByUser(change: (current: Layout) => Layout): void {
    const before = layout;
    changeAndGo(change);
    closedHistory = pushClosed(closedHistory, closedTabs(before, layout));
  }

  /** 本文に出ている route のタブ (か本文の既定) の、今の route を覚える。 */
  function rememberRoute(): void {
    const side = routeSideOf(layout, currentRoot);
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
      if (!activateTab && routeSideOf(layout, currentRoot) === null) return;
      let next = showHome(layout);
      if (keepFocus) {
        next = focusPane(next, keepFocus);
        keepFocus = null;
      }
      commit(next, "sync");
      return;
    }
    const target = targetOf(route);
    if (!target) return;
    if (!activateTab && routeSideOf(layout, currentRoot) === null) {
      // 前面はターミナルか画像のまま。下に残っている画面の route だけ覚え直す。
      const existing = layout.panes.left.tabs.find((tab) =>
        sameTarget(tab.target, target),
      );
      if (existing) routes.set(existing.id, route);
      return;
    }
    // 本文の route は左の面のタブ (右の面に同じファイルがあっても左で開く)。
    // 画像は面を選ばない (フォーカスのある面の箱に出す)。
    let next = openTab(layout, target, {
      ...(target.kind === "image" ? {} : { pane: "left" as const }),
      ...keptOption(),
    });
    const tab = activeTab(next);
    if (tab && routeTab(tab)) routes.set(tab.id, route);
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
    const target = targetOf(route);
    if (!target || target.kind === "page")
      throw new Error(
        `main tabs: ${JSON.stringify(route)} cannot be opened in the right pane`,
      );
    if (!layout.panes.right && !splitAllowed()) return false;
    if (!restoring) rememberRoute();
    const next = openRight(layout, target, {
      ...keptOption(),
      newId: freshId,
    });
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
    const state = tabMenu(layout, tab.id, keyOf);
    const current = text();
    const path =
      tab.target.kind === "file" || tab.target.kind === "image"
        ? tab.target.path
        : null;
    // 別のプロジェクトの画像の履歴は、このページ (このプロジェクト) では出せない。
    const repoImage =
      tab.target.kind === "image" &&
      !tab.target.path.startsWith("/") &&
      !isForeign(tab, currentRoot)
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

  /**
   * 落とす位置 (その面の並びの位置)。見えているタブの真ん中より左ならその前。
   * 畳んだグループのタブは描いていないので、見えているタブの id から並びの位置を引く。
   */
  function dropIndex(
    strip: HTMLElement,
    side: PaneSide,
    clientX: number,
  ): { index: number; before: HTMLElement | null } {
    const pane = paneOfSide(side);
    const indexOf = (el: HTMLElement) =>
      pane?.tabs.findIndex((tab) => tab.id === el.dataset.tabId) ?? -1;
    const tabs = [...strip.querySelectorAll<HTMLElement>(".main-tab")];
    for (const el of tabs) {
      const rect = el.getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2)
        return { index: indexOf(el), before: el };
    }
    const last = tabs[tabs.length - 1];
    return {
      index: last ? indexOf(last) + 1 : (pane?.tabs.length ?? 0),
      before: null,
    };
  }

  function paneOfSide(side: PaneSide): Pane | undefined {
    return side === "left" ? layout.panes.left : layout.panes.right;
  }

  /**
   * そのタブをその面のその位置へ落とせるか: 同じグループのタブの間だけ (別の
   * グループへは移せない。持ち物が違う)。その面にそのグループが無ければ (反対の
   * 面へ移す) どこでもよい (グループの位置へ並べ直す)。
   */
  function dropAllowed(id: string, side: PaneSide, index: number): boolean {
    const found = findTab(layout, id);
    const pane = paneOfSide(side);
    if (!found || !pane) return false;
    const key = keyOf(found.tab);
    const members = pane.tabs
      .map((tab, at) => (keyOf(tab) === key ? at : -1))
      .filter((at) => at >= 0);
    if (members.length === 0) return true;
    return index >= members[0] && index <= members[members.length - 1] + 1;
  }

  function clearDropMarks(): void {
    for (const el of document.querySelectorAll(
      ".main-tab-drop-before, .main-tab-drop-after",
    ))
      el.classList.remove("main-tab-drop-before", "main-tab-drop-after");
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
    // グループの端では止まる (別のグループへは移せない)。
    const menu = tabMenu(layout, id, keyOf);
    if ((delta < 0 && !menu.moveLeft) || (delta > 0 && !menu.moveRight)) return;
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
      activateTab(id);
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
      const drop = dropIndex(strip, side, event.clientX);
      // 別のグループの間は落とす先にしない (印も出さない)。
      if (!dropAllowed(dragId, side, drop.index)) {
        clearDropMarks();
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      clearDropMarks();
      if (drop.before) drop.before.classList.add("main-tab-drop-before");
      else {
        strip.classList.add("main-tabs-drop-end");
        const tabs = strip.querySelectorAll<HTMLElement>(".main-tab");
        tabs[tabs.length - 1]?.classList.add("main-tab-drop-after");
      }
    });
    strip.addEventListener("dragleave", (event) => {
      if (!strip.contains(event.relatedTarget as Node | null)) clearDropMarks();
    });
    strip.addEventListener("drop", (event) => {
      if (!dragId) return;
      event.preventDefault();
      const id = dragId;
      const found = findTab(layout, id);
      const index0 = dropIndex(strip, side, event.clientX).index;
      endDrag();
      if (!found || !dropAllowed(id, side, index0)) return;
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
  /**
   * タブの名前。グループに入っていない別のプロジェクトのペインだけプロジェクト名
   * つき (グループに入っていれば札がプロジェクトを示す)。
   */
  function nameOf(target: TabTarget, grouped = false): TerminalTabName {
    if (target.kind === "terminal") {
      const info = deps.terminalInfo(target.session);
      return terminalTabName(
        info.label,
        grouped ? null : (info.project ?? null),
      );
    }
    const title = labelOf(target);
    return { project: null, title, full: title };
  }

  /** タブの絵。エージェントを映しているターミナルは、絵の代わりに状態の印 (形で区別する)。 */
  function iconMarkup(target: TabTarget): string {
    const state =
      target.kind === "terminal"
        ? deps.terminalInfo(target.session).state
        : null;
    return state
      ? `<i class="terminal-mark terminal-mark-${state}" aria-hidden="true"></i>`
      : iconSvg("main-tab-svg", iconOf(target));
  }

  /** タブの title (ファイルはパスと版)。 */
  function titleOf(target: TabTarget, label: string): string {
    if (target.kind !== "file" && target.kind !== "image") return label;
    return target.kind === "file" && target.ref !== undefined
      ? `${target.path} @ ${target.ref}`
      : target.path;
  }

  function renderTab(
    tab: Tab,
    active: boolean,
    side: PaneSide,
    grouped: boolean,
  ): HTMLElement {
    const current = text();
    const tabName = nameOf(tab.target, grouped);
    const label = tabName.full;
    const el = document.createElement("div");
    el.className = "main-tab";
    el.classList.toggle("main-tab-active", active);
    // 選択タブの上端の線: フォーカスのある面は強調色 (.main-tab-focused)、
    // もう一方の面は灰色 (.main-tab-active)。
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
    el.title = titleOf(tab.target, label);
    if (tab.preview) el.title += `\n${current.previewHint}`;
    const icon = document.createElement("span");
    icon.className = "main-tab-icon";
    icon.innerHTML = iconMarkup(tab.target);
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

    el.addEventListener("click", () => activateTab(tab.id));
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
          ? deps.listColumnHoldsList?.()
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
    const listButton = sections.left.listButton;
    if (listButton) {
      const count = allTabs(fullLayout()).length;
      const label = current.openTabs(count);
      listButton.button.hidden = !phoneQuery.matches;
      listButton.count.textContent = String(count);
      listButton.button.title = label;
      listButton.button.setAttribute("aria-label", label);
    }
  }

  /** グループの札に出すもの。一覧に無いプロジェクトはパスの末尾の名前と色なし。 */
  function lookOf(root: string): ProjectLook {
    const known = deps.projectLook?.(root);
    if (known) return known;
    const name = basenameOf(root) || root;
    return { root, name, initials: projectInitials(name), color: null };
  }

  /**
   * 面のタブ列を、グループごとに描く: 札 (色の四角と頭文字・名前・枚数・▾) と、
   * そのグループのタブの並び (role=tablist を 1 つずつ)。どのプロジェクトのもの
   * でもないタブは最後の並び (sections[side].list)。＋ は最後のグループのタブの
   * すぐ右 (＋ で開くものはいまのプロジェクトのグループに入る) で、どのプロジェクトの
   * ものでもないタブは列の右端に寄せる (style.css の .main-tabs-grouped)。グループが
   * 無ければ今までどおり [タブ][＋]。畳んだグループは札と、前面のタブ (あれば) だけ。
   */
  function renderGroups(side: PaneSide, pane: Pane): void {
    const { strip, list, newButton } = sections[side];
    for (const old of strip.querySelectorAll(
      ":scope > .main-tab-group, :scope > .main-tabs-group-list",
    ))
      old.remove();
    const collapsed = new Set(layout.collapsed ?? []);
    const loose: HTMLElement[] = [];
    const grouped: HTMLElement[] = [];
    for (const group of groupsOf(side, pane)) {
      if (group.key === null) {
        for (const tab of group.tabs)
          loose.push(renderTab(tab, tab.id === pane.activeId, side, false));
        continue;
      }
      const key = group.key;
      // 空のグループは畳めない (畳んだ控えが残っていても開いて描く)。
      const isCollapsed = group.tabs.length > 0 && collapsed.has(key);
      const visible = isCollapsed
        ? group.tabs.filter((tab) => tab.id === pane.activeId)
        : group.tabs;
      const look = lookOf(key);
      const tabs = document.createElement("div");
      tabs.className = "main-tabs-list main-tabs-group-list";
      tabs.setAttribute("role", "tablist");
      tabs.setAttribute("aria-label", text().groupTabs(look.name));
      tabs.dataset.group = key;
      paintProjectColor(tabs, look.color);
      tabs.append(
        ...visible.map((tab) =>
          renderTab(tab, tab.id === pane.activeId, side, true),
        ),
      );
      grouped.push(
        renderGroupHead(side, key, look, isCollapsed, group.tabs.length),
        tabs,
      );
    }
    // 並びが変わるときだけ ＋ と並びを動かす (動かすと ＋ のフォーカスが外れる)。
    const hasGroups = grouped.length > 0;
    const [first, second] = hasGroups ? [newButton, list] : [list, newButton];
    if (first.nextElementSibling !== second) strip.insertBefore(first, second);
    for (const el of grouped) strip.insertBefore(el, first);
    strip.classList.toggle("main-tabs-grouped", hasGroups);
    list.replaceChildren(...loose);
  }

  /** タブの中身の幅 (上限で切った後) の控え。畳んで描いていないタブの幅に使う。 */
  const naturalWidths = new Map<string, number>();

  /**
   * 列に入りきらないときだけ、全部のタブを同じ割合で縮める (core/tab-widths.ts)。
   * 中身の幅を測ってから、縮めた幅を各タブの --main-tab-w に書く (style.css の
   * .main-tab)。畳んだグループのタブも、控えた中身の幅と隙間で数に入れる: 畳む・
   * 開くで割合が変わると、畳んだグループより左のタブの幅が変わって札が動く。札の
   * 枚数 (畳んだときだけ出る) も除いて数える。
   */
  function fitTabs(side: PaneSide, pane: Pane): void {
    const { strip, newButton } = sections[side];
    const els = [...strip.querySelectorAll<HTMLElement>(".main-tab")];
    for (const el of els) el.style.removeProperty("--main-tab-w");
    const style = getComputedStyle(strip);
    const unit = Number.parseFloat(style.getPropertyValue("--space-unit"));
    const gap = Number.parseFloat(style.columnGap) || 0;
    // 寸法の無い所 (測れない・列が描かれていない) では中身の幅のまま。
    if (!(unit > 0) || strip.clientWidth === 0) return;
    const shown = new Map<string, HTMLElement>();
    for (const el of els) {
      const id = el.dataset.tabId as string;
      shown.set(id, el);
      naturalWidths.set(id, el.getBoundingClientRect().width);
    }
    const known = [...shown.keys()].map((id) => naturalWidths.get(id) ?? 0);
    const average =
      known.length > 0
        ? known.reduce((sum, width) => sum + width, 0) / known.length
        : unit * TAB_FLOOR_UNITS;
    const ids = pane.tabs.map((tab) => tab.id);
    const natural = ids.map((id) => naturalWidths.get(id) ?? average);
    // タブ以外に列が使う幅: 札 (畳んだときの枚数を除く)・＋・隙間 (描いていない
    // タブの分も数える)。
    let fixed = 0;
    for (const head of strip.querySelectorAll<HTMLElement>(
      ":scope > .main-tab-group",
    )) {
      fixed += head.getBoundingClientRect().width;
      const badge = head.querySelector<HTMLElement>(".main-tab-group-count");
      if (badge && !badge.hidden) fixed -= badge.getBoundingClientRect().width;
    }
    const plus = getComputedStyle(newButton);
    fixed +=
      newButton.getBoundingClientRect().width +
      (Number.parseFloat(plus.marginLeft) || 0) +
      (Number.parseFloat(plus.marginRight) || 0);
    const heads = strip.querySelectorAll(":scope > .main-tab-group").length;
    fixed += gap * (ids.length + heads);
    const widths = fitTabWidths(
      natural,
      strip.clientWidth - fixed,
      unit * TAB_FLOOR_UNITS,
    );
    if (!widths) return;
    ids.forEach((id, index) => {
      shown.get(id)?.style.setProperty("--main-tab-w", `${widths[index]}px`);
    });
  }

  /** グループの札。札を押すと畳む・開く、▾ はグループのメニュー。 */
  function renderGroupHead(
    side: PaneSide,
    key: string,
    look: ProjectLook,
    isCollapsed: boolean,
    count: number,
  ): HTMLElement {
    const current = text();
    const head = document.createElement("div");
    head.className = "main-tab-group";
    head.dataset.group = key;
    head.classList.toggle("main-tab-group-collapsed", isCollapsed);
    head.classList.toggle("main-tab-group-current", key === currentRoot);
    paintProjectColor(head, look.color);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "main-tab-group-toggle";
    toggle.setAttribute("aria-expanded", String(!isCollapsed));
    const label =
      count === 0
        ? `${look.name}: ${current.groupEmpty}`
        : current.groupToggle(look.name, isCollapsed, count);
    toggle.title = `${label}\n${key}`;
    toggle.setAttribute("aria-label", label);
    // 札は色の四角と頭文字と ▾ だけ (名前は一覧の列の頭と同じものが並んで 2 回出て、
    // タブの幅を食っていた)。名前は title・aria-label と ▾ のメニューの頭に出す。
    // 畳んだときだけ頭文字の横に枚数 (札の右が伸びるだけ。左は動かない。タブの幅の
    // 割合は枚数を除いて数える: fitTabs)。
    const badge = document.createElement("span");
    badge.className = "main-tab-group-count";
    badge.textContent = String(count);
    badge.hidden = !isCollapsed;
    badge.setAttribute("aria-hidden", "true");
    toggle.append(projectMark(look, "main-tab-group-mark"), badge);
    toggle.addEventListener("click", () => {
      if (count > 0) commit(setCollapsed(layout, key, !isCollapsed));
    });
    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "main-tab-group-menu";
    menu.setAttribute("aria-haspopup", "menu");
    menu.title = current.groupMenu(look.name);
    menu.setAttribute("aria-label", current.groupMenu(look.name));
    menu.innerHTML = iconSvg("main-tab-group-menu-icon", CHEVRON_DOWN_12_PATH);
    const openMenu = (at?: { x: number; y: number }) => {
      const rect = menu.getBoundingClientRect();
      showContextMenu(menu, groupMenuFor(side, key, isCollapsed, count), {
        at: at ?? { x: rect.left, y: rect.bottom + 4 },
      });
    };
    menu.addEventListener("click", () => openMenu());
    head.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openMenu({ x: event.clientX, y: event.clientY });
    });
    head.append(toggle, menu);
    return head;
  }

  /**
   * グループの ▾ (と札の右クリック) のメニュー。項目の並びと押せるかは、ここ
   * だけで決める (タブの右クリックの tabMenu と同じ考え方)。新しいシェル・
   * エージェントは、その札の面とプロジェクトで作る。
   */
  function groupMenuFor(
    side: PaneSide,
    key: string,
    isCollapsed: boolean,
    count: number,
  ): ContextMenuItem[] {
    const current = text();
    const here = key === currentRoot;
    // タブが 0 枚のグループ (いま見ているプロジェクト) は、畳む・閉じるものが無い。
    const empty = count === 0;
    const look = lookOf(key);
    const facts = deps.groupFacts?.(key) ?? {
      shellUnavailable: null,
      git: null,
    };
    // 押せない理由 (押せるなら null)。無い口の理由は出さない ("")。
    const shellBlocker = !deps.newShellIn
      ? ""
      : (facts.shellUnavailable ??
        // 1 つで完結するサーバは、別のプロジェクトのシェルを作れない。
        (here || deps.foreignInPlace?.() ? null : current.shellNeedsSwitch));
    const agentBlocker = !deps.launchAgentIn
      ? ""
      : facts.git === false && !here
        ? current.notGitProject
        : null;
    return [
      // メニューの頭はプロジェクトの名前 (札には頭文字しか無い)。押せない行。
      {
        label: look.name,
        title: key,
        disabled: true,
        onSelect: () => undefined,
      },
      { kind: "separator" },
      {
        label: current.newShellHere,
        title: shellBlocker || current.newShellHereTitle(look.name),
        disabled: shellBlocker !== null,
        onSelect: () => deps.newShellIn?.(key, side),
      },
      {
        label: current.newAgentHere,
        title: agentBlocker || current.newAgentHereTitle(look.name),
        disabled: agentBlocker !== null,
        onSelect: () => deps.launchAgentIn?.(key),
      },
      { kind: "separator" },
      {
        label: current.switchToProject,
        disabled: here || !deps.switchProject,
        ...(here ? { title: current.currentProject } : {}),
        onSelect: () => switchToProject(key),
      },
      {
        label: isCollapsed ? current.expandGroup : current.collapseGroup,
        disabled: empty,
        ...(empty ? { title: current.groupEmpty } : {}),
        onSelect: () => commit(setCollapsed(layout, key, !isCollapsed)),
      },
      { kind: "separator" },
      {
        label: current.closeGroup,
        disabled: empty,
        ...(empty ? { title: current.groupEmpty } : {}),
        onSelect: () => closeByUser((l) => closeGroup(l, key, keyOf)),
      },
    ];
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
      renderGroups(side, pane);
      fitTabs(side, pane);
      strip.scrollLeft = scrollLeft;
      sections[side].el.classList.toggle(
        "main-tabs-pane-focused",
        layout.focused === side,
      );
      revealFront(strip);
    }
    renderActions();
    for (const listener of renderListeners) listener();
    if (focusedTabId !== undefined)
      deps.mount
        .querySelector<HTMLElement>(
          `.main-tab[data-tab-id="${CSS.escape(focusedTabId)}"]`,
        )
        ?.focus({ preventScroll: true });
  }

  /**
   * 読み戻す前に開いたタブ (URL の route。根を知る前なので持ち物が無い) に、
   * このページのプロジェクトを持たせる。
   */
  function adoptCurrentProject(): void {
    if (currentRoot === null) return;
    const root = currentRoot;
    const adopt = (pane: Layout["panes"]["left"]) => ({
      ...pane,
      tabs: pane.tabs.map((tab) => ({
        ...tab,
        target: withProject(tab.target, root),
      })),
    });
    layout = {
      ...layout,
      panes: {
        left: adopt(layout.panes.left),
        ...(layout.panes.right ? { right: adopt(layout.panes.right) } : {}),
      },
    };
  }

  /**
   * 前面が別のプロジェクトの、移ってから出すタブなら (別の窓で前面にしていた・
   * そのプロジェクトへ移る途中で読み直した)、読み戻しでは移らずに外す: 左の面は
   * 本文の既定、右の面はほかのタブ。
   */
  function withoutSwitchFronts(target: Layout): Layout {
    let next = target;
    if (needsSwitch(frontTab(next, "left"))) {
      // 左の面は、最近前面だったこのプロジェクトのタブへ。無ければ本文の既定。
      const left = next.panes.left;
      const back = [...left.recent]
        .reverse()
        .map((id) => left.tabs.find((tab) => tab.id === id))
        .find((tab): tab is Tab => !!tab && !needsSwitch(tab));
      next = back
        ? focusPane(activate(next, back.id), next.focused)
        : focusPane(showHome(next), next.focused);
    }
    const right = next.panes.right;
    if (right && needsSwitch(frontTab(next, "right"))) {
      const other = right.tabs.find((tab) => !needsSwitch(tab));
      if (other) next = focusPane(activate(next, other.id), next.focused);
    }
    return next;
  }

  /** 前の版の保存を移した報告を出す (移せなかったものは理由と元の値)。 */
  function reportMigration(migration: unknown): void {
    if (migration === undefined) return;
    const report = migration as {
      unmigrated?: unknown[];
      backup?: string;
    };
    if (Array.isArray(report.unmigrated) && report.unmigrated.length > 0)
      console.error(
        `[code-viewer] main tabs: the per-project tabs were moved into one set of tabs for all projects, but ${report.unmigrated.length} item(s) could not be moved; the old file is kept at ${report.backup}:`,
        JSON.stringify(report.unmigrated),
      );
    else
      console.info(
        `[code-viewer] main tabs: the per-project tabs were moved into one set of tabs for all projects (the old file is kept at ${report.backup}):`,
        JSON.stringify(migration),
      );
  }

  /** 持ち物を付けた・グループの並びが変わったあとに、並べ直して描き直す。 */
  function relayout(): void {
    layout = normalize(layout);
    render();
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
    let loaded: SavedTabs;
    try {
      loaded = await deps.loadSaved();
    } catch (error) {
      // 読めなかった配置を、この画面の配置で上書きしない。
      console.error(
        "[code-viewer] main tabs: the saved layout could not be loaded; tabs are not saved on this page",
        error,
      );
      openUrlRight();
      return;
    }
    currentRoot = loaded.root ?? null;
    adoptCurrentProject();
    reportMigration(loaded.migration);
    const saved = loaded.layout;
    if (loaded.newer !== undefined || isNewerLayoutVersion(saved)) {
      // 新しい版のアプリが保存した配置: 読めないが、ここで上書きすると新しい
      // 版へ戻ったときに配置が消える。このページでは保存しない。
      const version =
        loaded.newer !== undefined
          ? `file version ${loaded.newer}`
          : `layout version ${JSON.stringify((saved as { version: unknown }).version)}`;
      console.error(
        `[code-viewer] main tabs: the saved layout was written by a newer version (${version}, this page reads up to layout version ${LAYOUT_VERSION}); it is kept as it is and tabs are not saved on this page`,
      );
      relayout();
      openUrlRight();
      return;
    }
    base = {
      rev: loaded.rev ?? null,
      layout:
        saved === null || saved === undefined
          ? null
          : (saved as SerializedLayout),
    };
    if (saved === null || saved === undefined) {
      saveEnabled = true;
      relayout();
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
        openUrlRight();
        return;
      }
      console.error(
        `[code-viewer] main tabs: the saved layout is broken; it was backed up to ${backup} and this page starts from an empty layout. saved value:`,
        JSON.stringify(saved),
        error,
      );
      // 退避した値は重ねる元にしない (この窓の配置で書き直す)。
      base = { rev: base.rev, layout: null };
      saveEnabled = true;
      relayout();
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
    if (parsed.staleGroupFronts.length > 0)
      console.info(
        "[code-viewer] main tabs: dropped the remembered front tab of group(s) whose tab is gone:",
        JSON.stringify(parsed.staleGroupFronts),
      );
    // 今の画面 (URL) の route。保存した配置がその route を見せていた (本文の面の
    // 前面か、フォーカスのある面の前面がそのタブ) なら、保存した前面をそのまま
    // 使う。そうでなければ (別の URL を開いた) その route のタブを開いて前面に
    // 出す。前面がターミナルで URL が画面かファイルを指すなら URL を優先する
    // (ブックマークやリンクで開いた Data がターミナルの裏に隠れていた)。
    // ターミナルを前面にしたままの再読み込みは URL に ?terminal= が載るので
    // keepSavedFront で残す。
    const urlRoute = deps.currentRoute();
    const target = targetOf(urlRoute);
    routes.clear();
    const restoredLayout = withoutSwitchFronts(parsed.layout);
    seedPageRoutes(restoredLayout, parsed.pageRoutes);
    if (options.rightRoute) {
      // URL は右の面のファイル: 左の面 (本文) は保存した前面のまま。
      layout = restoredLayout;
      fitToWidth();
      openRightRoute(options.rightRoute, "sync", true);
      deps.onTerminals(terminalsOf(fullLayout()), []);
      deps.onPanes(panesView(layout, currentRoot), "sync");
      return;
    }
    const shown = [
      routeSideOf(restoredLayout, currentRoot),
      restoredLayout.focused,
    ]
      .map((side) => (side ? frontTab(restoredLayout, side) : null))
      .filter((tab): tab is Tab => tab !== null);
    // 本文を出す面が無い (前面がどちらもターミナルか画像) なら、URL は下に
    // 残った route を指している。そのタブが配置にあれば一致とみなす。
    const home = urlRoute.screen === "repo";
    const agrees = home
      ? // フォルダ表示: 保存した左の面が何も選んでいないか、前面がターミナル・画像
        frontTab(restoredLayout, "left") === null ||
        routeSideOf(restoredLayout, currentRoot) === null
      : target !== null &&
        (shown.some((tab) => sameTarget(tab.target, target)) ||
          (options.keepSavedFront === true &&
            routeSideOf(restoredLayout, currentRoot) === null &&
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
      if (tab && routeTab(tab)) routes.set(tab.id, urlRoute);
      commit(layout, "sync");
    } else syncRoute(urlRoute);
    // 読み戻した面をそのまま知らせる (前面のターミナルかどうかは URL が決める)。
    deps.onTerminals(terminalsOf(fullLayout()), []);
    deps.onPanes(panesView(layout, currentRoot), "sync");
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
      let next = openTab(layout, { kind: "terminal", session }, { pane });
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
    openImage(path, pane = "focused") {
      rememberRoute();
      commit(
        openTab(layout, { kind: "image", path }, { pane, ...keptOption() }),
      );
    },
    showHome() {
      changeAndGo(showHome);
    },
    openNewTabMenu() {
      openNewTabMenuIn(layout.panes.right ? layout.focused : "left");
    },
    front: () => activeTab(layout),
    panes: () => panesView(layout, currentRoot),
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
        (item) =>
          item.target.kind === "page" &&
          item.target.page === page &&
          !isForeign(item, currentRoot),
      );
      return tab ? (routes.get(tab.id) ?? null) : null;
    },
    paneRoute(side) {
      if (side === "left") return null;
      const tab = frontTab(layout, side);
      // 別のプロジェクトのファイルは URL に載せない (このページの route ではない)。
      return tab?.target.kind === "file" && !isForeign(tab, currentRoot)
        ? routeOf(tab)
        : null;
    },
    openRouteRight: (route, fromUrl = false) =>
      openRightRoute(route, fromUrl ? "sync" : "stay"),
    sideHolding(route) {
      const target = targetOf(route);
      return target ? sideOfTarget(layout, target) : null;
    },
    sideForRoute(route) {
      const target = targetOf(route);
      return target ? openSide(layout, target) : "left";
    },
    focusSide,
    sideAt(clientX) {
      if (!layout.panes.right) return null;
      const left = bodyLeft();
      // 一覧の列と左のサイドバーは面の外: そこから開くときフォーカスを動かさない。
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
    next: () => activateBy(nextTab),
    previous: () => activateBy(prevTab),
    reopenClosed() {
      let reopened = false;
      changeAndGo((current) => {
        const result = reopenClosed(current, closedHistory, {
          newId: freshId,
        });
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
    activateNth: (n) => activateBy((l) => activateIndex(l, n)),
    restore,
    flush,
    // 名前・シェルのプロジェクト・グループの並びが変わったときも呼ばれる (並べ直す)。
    localize: relayout,
    refit: () => followGeometry(),
    tabList() {
      const entry = (tab: Tab, front: boolean, isParked: boolean) => {
        const name = nameOf(tab.target).full;
        return {
          id: tab.id,
          name,
          title: titleOf(tab.target, name),
          iconHtml: iconMarkup(tab.target),
          front,
          preview: tab.preview,
          parked: isParked,
        };
      };
      const right = parked?.pane ?? layout.panes.right;
      return [
        ...layout.panes.left.tabs.map((tab) =>
          entry(tab, tab.id === layout.panes.left.activeId, false),
        ),
        ...(right?.tabs ?? []).map((tab) => entry(tab, false, true)),
      ];
    },
    bringToFront(id) {
      if (parked?.pane.tabs.some((tab) => tab.id === id)) {
        const taken = takeParked(layout, parked, id);
        changeAndGo(() => taken.layout, taken.parked);
        return;
      }
      if (!findTab(layout, id))
        throw new Error(`main tabs: tab ${JSON.stringify(id)} is not open`);
      if (activeTab(layout)?.id === id && layout.focused === "left") return;
      activateTab(id);
    },
    closeTab(id) {
      const index = parked?.pane.tabs.findIndex((tab) => tab.id === id) ?? -1;
      if (parked && index >= 0) {
        const tab = parked.pane.tabs[index];
        closedHistory = pushClosed(closedHistory, [
          { target: tab.target, side: "right", index },
        ]);
        commit(layout, "stay", closeParked(parked, id));
        return;
      }
      if (!findTab(layout, id))
        throw new Error(`main tabs: tab ${JSON.stringify(id)} is not open`);
      closeByUser((l) => close(l, id));
    },
    onRender(listener) {
      renderListeners.add(listener);
      return () => renderListeners.delete(listener);
    },
    isRouteTab: (tab) => routeTab(tab),
    currentProject: () => currentRoot,
    groupOf: keyOf,
    tabRoute: (tab) => (isRouteTab(tab) ? routeOf(tab) : null),
    setTabRoute(id, route) {
      if (!findTab(layout, id))
        throw new Error(`main tabs: tab ${JSON.stringify(id)} is not open`);
      routes.set(id, route);
      scheduleSave();
    },
    prepareProjectSwitch,
    refreshFromServer,
    layout: () => layout,
  };
}
