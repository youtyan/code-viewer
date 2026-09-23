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
 * 画面に含まれる)。style.css の操作札の節の条件と同じ文字列。
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

/** 端末の操作札 (電話・指の画面で、端末の下に出す押せる札) の並び。 */
export const TERMINAL_SOFT_KEYS = [
  "escape",
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
