// 電話の幅 (SP) のときの骨格の決まり。DOM に触らない。
//
// code-viewer はデスクトップの道具で、電話で使う場面は 3 つに絞っている:
// エージェントの状態を見て入力待ちに返事する・Diff とファイルを読む・
// プロジェクトを切り替える。その 3 つのために、狭い画面では左のサイドバーを
// 引き出し (drawer)、右の列を下から出す面 (sheet) にし、本文を全幅にする。
// 配置は style.css 末尾の「Phone (SP)」の節、開け閉めは views/mobile-shell.ts。

/** これ以下の幅は電話の段 (縦向き)。 */
export const PHONE_MAX_WIDTH = 640;

/**
 * 指で触る画面で、高さがこれ以下なら横向きの電話として電話の段に入れる。
 * 横向きの電話は幅が 640 を超える (844 など) が、左右の列を並べると本文が
 * 残らない。マウスの画面 (pointer: fine) は高さが低くても入れない。
 */
export const PHONE_LANDSCAPE_MAX_HEIGHT = 500;

/** 横向きの電話 (指の画面で高さが低い)。面の出し方をこのときだけ変える。 */
export const PHONE_LANDSCAPE_MEDIA_QUERY = `(pointer: coarse) and (max-height: ${PHONE_LANDSCAPE_MAX_HEIGHT}px)`;

/**
 * 電話の段の media query。style.css の SP の節の条件はこれと同じ文字列
 * (media query は CSS 変数を読めないので、テストで一致を見る)。
 */
export const PHONE_MEDIA_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px), ${PHONE_LANDSCAPE_MEDIA_QUERY}`;

/** 指で触る画面 (押せる大きさを 44px にし、端末の操作札を出す)。 */
export const TOUCH_MEDIA_QUERY = "(pointer: coarse)";

/**
 * 端末の操作札を出す画面: 電話の段か指の画面 (電話の段の横向きの条件は指の
 * 画面に含まれる)。style.css の操作札の節の条件と同じ文字列。エージェントの
 * 行の覗き窓 (views/agents/pane-preview.ts) とプロジェクトの見出しのドラッグも、
 * この画面では出さない・使わない (長押しのメニューに任せる)。
 */
export const SOFT_KEYS_MEDIA_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px), ${TOUCH_MEDIA_QUERY}`;

export type ViewportTier = "phone" | "desktop";

export type ViewportFacts = {
  /** 表示領域の幅 (CSS px)。 */
  width: number;
  /** 表示領域の高さ (CSS px)。 */
  height: number;
  /** 主な入力が指か (pointer: coarse)。 */
  coarsePointer: boolean;
};

/** 幅の段。PHONE_MEDIA_QUERY と同じ条件。 */
export function viewportTier(facts: ViewportFacts): ViewportTier {
  if (facts.width <= PHONE_MAX_WIDTH) return "phone";
  if (facts.coarsePointer && facts.height <= PHONE_LANDSCAPE_MAX_HEIGHT)
    return "phone";
  return "desktop";
}

export type DiffLayout = "side-by-side" | "line-by-line";

/**
 * 差分の並べ方。電話の段では 2 列が幅に入らないので 1 列 (line-by-line) を既定に
 * し、電話で切り替えたものがあればそれを見せる (電話での切替は保存しない。
 * デスクトップの既定を変えないため)。デスクトップは保存した並べ方。
 */
export function diffLayoutFor(
  tier: ViewportTier,
  saved: DiffLayout,
  chosenOnPhone: DiffLayout | null,
): DiffLayout {
  if (tier === "desktop") return saved;
  return chosenOnPhone ?? "line-by-line";
}

/** 左端から引き出しを開く指の動きを受け付ける、左端からの幅 (px)。 */
export const EDGE_SWIPE_START_MAX_X = 24;

/** 開け閉めと見なす横の移動量 (px)。これ未満はタップかスクロール。 */
export const SWIPE_MIN_DISTANCE = 56;

export type SwipeFacts = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  /** 指を置いたときに引き出しが開いていたか。 */
  drawerOpen: boolean;
};

/**
 * 1 回の指の動きが引き出しを開ける / 閉じるか。横の移動が縦より大きく、
 * SWIPE_MIN_DISTANCE 以上のときだけ。開けるのは閉じている間に左端
 * (EDGE_SWIPE_START_MAX_X 以内) から右へ動かしたとき、閉じるのは開いている
 * 間に左へ動かしたとき。それ以外 (縦のスクロール・本文の上の横の送り) は
 * null で、何もしない。
 */
export function edgeSwipeAction(facts: SwipeFacts): "open" | "close" | null {
  const dx = facts.endX - facts.startX;
  const dy = facts.endY - facts.startY;
  if (Math.abs(dx) < SWIPE_MIN_DISTANCE || Math.abs(dx) <= Math.abs(dy))
    return null;
  if (!facts.drawerOpen && dx > 0 && facts.startX <= EDGE_SWIPE_START_MAX_X)
    return "open";
  if (facts.drawerOpen && dx < 0) return "close";
  return null;
}

/** 指に付いて引き出しを動かし始める横の移動量 (px)。これ未満はタップとして待つ。 */
export const DRAWER_DRAG_START = 8;

export type DrawerDragFacts = {
  startX: number;
  startY: number;
  /** 今の指の位置。 */
  x: number;
  y: number;
  /** 指を置いたときに引き出しが開いていたか。 */
  drawerOpen: boolean;
  /** 引き出しの幅 (px)。 */
  width: number;
};

/**
 * 指を動かしている間の引き出しの位置 (translateX の px。-width が閉じた位置、
 * 0 が開いた位置)。引き出しを動かす指の動きでなければ null (縦のスクロール・
 * 左端以外からの横の送り・開いているときの右への動き)。離したときに開くか
 * 閉じるかは edgeSwipeAction が決める。
 */
export function drawerDragOffset(facts: DrawerDragFacts): number | null {
  const dx = facts.x - facts.startX;
  const dy = facts.y - facts.startY;
  if (Math.abs(dx) < DRAWER_DRAG_START || Math.abs(dx) <= Math.abs(dy))
    return null;
  if (!facts.drawerOpen) {
    if (facts.startX > EDGE_SWIPE_START_MAX_X || dx <= 0) return null;
    return Math.min(0, dx - facts.width);
  }
  if (dx >= 0) return null;
  return Math.max(-facts.width, dx);
}

/** 下端の帯のうち、画面へ移る入口。 */
export type MobileBarView = "files" | "diff" | "agents";

/**
 * 下端の帯で「いま見ている画面」の印を付ける入口。body の画面の印 (app.ts の
 * setPageMode) から決める。左の面の前面がタブ (端末・画像など) で画面が
 * 隠れているときは印を付けない。
 */
export function mobileBarCurrent(
  hasPageClass: (name: string) => boolean,
  coveredByTab: boolean,
): MobileBarView | null {
  if (coveredByTab) return null;
  if (hasPageClass("gdp-agents-page")) return "agents";
  if (hasPageClass("gdp-diff-page")) return "diff";
  if (hasPageClass("gdp-repo-page") || hasPageClass("gdp-repo-blob-page"))
    return "files";
  return null;
}

/**
 * ソフトキーボードと見なす最小の高さ (px)。これより小さい差は、ブラウザの
 * 上下の帯が出入りしただけとして扱う。
 */
export const SOFT_KEYBOARD_MIN_HEIGHT = 120;

export type VisualViewportFacts = {
  /** window.innerHeight (レイアウトの表示領域の高さ)。 */
  innerHeight: number;
  /** visualViewport.height (いま見えている高さ)。 */
  viewportHeight: number;
  /** visualViewport.offsetTop (見えている部分の上端のずれ)。 */
  viewportOffsetTop: number;
  /** visualViewport.scale (ピンチの拡大率)。 */
  scale: number;
};

/**
 * ソフトキーボードが画面の下を隠している高さ (px)。隠していなければ 0。
 * キーボードで表示領域を縮めるブラウザ (innerHeight も縮む) では差が出ないので
 * 0 になり、縮めないブラウザ (innerHeight はそのまま) では見えている部分の下端
 * から下が隠れた高さになる。ピンチで拡大している間は測れないので 0。
 */
export function softKeyboardInset(facts: VisualViewportFacts): number {
  if (Math.abs(facts.scale - 1) > 0.01) return 0;
  const covered = Math.round(
    facts.innerHeight - facts.viewportHeight - facts.viewportOffsetTop,
  );
  return covered >= SOFT_KEYBOARD_MIN_HEIGHT ? covered : 0;
}

/**
 * 端末の操作札 (電話・指の画面で、端末の下に出す押せる札) の並び。Tab と
 * Shift+Tab はエージェントの補完とモードの切替 (ソフトキーボードに無い)。
 */
export const TERMINAL_SOFT_KEYS = [
  "escape",
  "tab",
  "shiftTab",
  "ctrlC",
  "up",
  "down",
  "enter",
] as const;

export type TerminalSoftKey = (typeof TERMINAL_SOFT_KEYS)[number];

/**
 * 札を押したときに端末へ送るバイト列。xterm が同じキーで送るものと同じにする。
 * 矢印は端末のカーソルキーのモード (DECCKM。tmux や全画面のアプリが切り替える)
 * で変わる: 通常は CSI (ESC [ A)、アプリのモードでは SS3 (ESC O A)。
 */
export function softKeySequence(
  key: TerminalSoftKey,
  applicationCursorKeys: boolean,
): string {
  switch (key) {
    case "escape":
      return "\x1b";
    case "tab":
      return "\t";
    case "shiftTab":
      // xterm が Shift+Tab で送る逆向きのタブ (CSI Z)。
      return "\x1b[Z";
    case "ctrlC":
      return "\x03";
    case "enter":
      return "\r";
    case "up":
      return applicationCursorKeys ? "\x1bOA" : "\x1b[A";
    case "down":
      return applicationCursorKeys ? "\x1bOB" : "\x1b[B";
  }
}

/** 長押しと見なす指の置き時間 (ms)。右クリックのメニューを出す。 */
export const LONG_PRESS_MS = 500;

/** 長押しの間に指が動いてよい距離 (px)。これを超えたらスクロールとして諦める。 */
export const LONG_PRESS_MOVE_TOLERANCE = 10;

/**
 * 長押しで右クリックのメニューを出す行 (エージェントの行・プロジェクトの見出し
 * (上へ・下へを含む)・タブ・ファイルの行・フォルダ表示の行)。ここに無い所
 * (本文・端末) の長押しはブラウザに任せる (文字の選択)。
 */
export const LONG_PRESS_TARGETS =
  ".nav-agent, .nav-project-head, .main-tab, #filelist li, .gdp-repo-row";

/** 指を置いた位置から、長押しを諦めるほど動いたか。 */
export function longPressMoved(
  start: { x: number; y: number },
  now: { x: number; y: number },
): boolean {
  return (
    Math.hypot(now.x - start.x, now.y - start.y) > LONG_PRESS_MOVE_TOLERANCE
  );
}

export type BottomSwipeFacts = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  /** 下端の帯の上端 (px。画面の上からの距離)。ここから下で始めた動きだけ開く。 */
  barTop: number;
  /** 面が開いているなら、面の頭の行の上端と下端 (px)。閉じていれば null。 */
  sheetHead: { top: number; bottom: number } | null;
};

/**
 * 1 回の指の動きが下からの面を開ける / 閉じるか。縦の移動が横より大きく、
 * SWIPE_MIN_DISTANCE 以上のときだけ。開けるのは閉じている間に下端の帯から
 * 上へ動かしたとき (画面の最下端の OS のホームの動きとは、帯の高さの分だけ
 * 離れる)。閉じるのは開いている間に面の頭の行から下へ動かしたとき (面の中の
 * 一覧のスクロールでは閉じない)。
 */
export function bottomSwipeAction(
  facts: BottomSwipeFacts,
): "open" | "close" | null {
  const dx = facts.endX - facts.startX;
  const dy = facts.endY - facts.startY;
  if (Math.abs(dy) < SWIPE_MIN_DISTANCE || Math.abs(dy) <= Math.abs(dx))
    return null;
  if (!facts.sheetHead)
    return dy < 0 && facts.startY >= facts.barTop ? "open" : null;
  const { top, bottom } = facts.sheetHead;
  return dy > 0 && facts.startY >= top && facts.startY <= bottom
    ? "close"
    : null;
}

/**
 * 電話の段の端末の既定の文字の大きさ (px)。デスクトップの既定 (13) では 390px
 * の幅に 45 桁前後しか入らない。この端末 (ブラウザ) だけの値で、保存した
 * デスクトップの値は変えない。
 */
export const PHONE_TERMINAL_FONT_SIZE = 12;

export type PinchFacts = {
  /** 2 本の指を置いたときの文字の大きさ。 */
  startSize: number;
  /** 2 本の指を置いたときの指の間の距離 (px)。 */
  startDistance: number;
  /** 今の指の間の距離 (px)。 */
  distance: number;
  min: number;
  max: number;
};

/**
 * ピンチの間の端末の文字の大きさ。指の間の距離の比で大きさを掛け、整数に
 * 丸めて範囲に収める。置いた直後の距離が 0 (同じ点) なら変えない。
 */
export function pinchFontSize(facts: PinchFacts): number {
  const scaled =
    facts.startDistance > 0
      ? facts.startSize * (facts.distance / facts.startDistance)
      : facts.startSize;
  return Math.min(facts.max, Math.max(facts.min, Math.round(scaled)));
}
