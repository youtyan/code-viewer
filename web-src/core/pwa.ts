// インストールした窓 (PWA、display-mode: standalone) でのブラウザのタブ操作のキー。
//
// 通常のタブでは ⌘W・⌘T・Ctrl+Tab などはブラウザが先に取り、ページには届かない
// (だから keymap.ts のタブ操作は g から始まる)。インストールした窓ではこれらが
// ページに届き、横取りしないとブラウザが窓そのものを閉じる・新しい窓を開く。
// そこで standalone のときだけ、メインの面のタブ操作に振り向ける。

import type { KeyEventLike, KeymapAction } from "./keymap";
import type { Layout } from "./main-tabs";

export const STANDALONE_MEDIA_QUERY = "(display-mode: standalone)";

/**
 * キーを受けた場所。
 * - page: 本文・サイドバーなど (入力欄を含む。ここに挙げたキーは文字の編集に使わない)
 * - terminal: xterm の中。Cmd の付かないキーは端末のもの (focus-scope.ts と同じ決まり)
 * - blocked: ダイアログ・検索のパレットの中。何も動かさないが、窓は閉じさせない
 */
export type PwaKeyTarget = "page" | "terminal" | "blocked";

type PwaKeyContext = {
  standalone: boolean;
  /** macOS か。ブラウザのタブ操作の修飾キーが Cmd (mac) か Ctrl (それ以外) かを決める */
  mac: boolean;
  target: PwaKeyTarget;
  composing: boolean;
};

/**
 * keymap.ts の既存のタブ操作と、キー割り当てに名前の無い 3 つ (最後のタブ・
 * 最後に閉じたタブを開き直す・「＋」のメニュー)。
 */
type PwaTabAction =
  | Extract<
      KeymapAction,
      | "main-tab-close"
      | "main-tab-next"
      | "main-tab-previous"
      | "main-tab-1"
      | "main-tab-2"
      | "main-tab-3"
      | "main-tab-4"
      | "main-tab-5"
      | "main-tab-6"
      | "main-tab-7"
      | "main-tab-8"
    >
  | "main-tab-last"
  | "main-tab-reopen"
  | "main-tab-new-menu";

/**
 * run: そのタブ操作をして既定の動作を止める。
 * swallow: 何もしないが既定の動作 (窓を閉じる・窓を増やす) は止める。
 * null: 関与しない (通常のタブ・表に無いキー・端末のキー)。
 */
export type PwaKeyOutcome =
  | { kind: "run"; action: PwaTabAction }
  | { kind: "swallow" }
  | null;

type PwaChord = {
  /** event.key を小文字にしたもの。候補が複数あるのは Shift で文字が変わるキー */
  keys: readonly string[];
  /** primary = その OS のブラウザのタブ操作の修飾キー (mac は Cmd、それ以外は Ctrl) */
  modifier: "primary" | "ctrl" | "mac-meta";
  shift?: boolean;
  action: PwaTabAction | "none";
};

// Cmd+N は窓を増やさない (握るだけ)。
// ⌘⇧W / Ctrl+Shift+W (窓を閉じる) は表に入れない: 窓を閉じる手段を 1 つは残す
// (⌘W はタブを閉じるので、全部閉じても窓は残る)。
export const PWA_TAB_KEYS: readonly PwaChord[] = [
  { keys: ["w"], modifier: "primary", action: "main-tab-close" },
  { keys: ["t"], modifier: "primary", shift: true, action: "main-tab-reopen" },
  { keys: ["t"], modifier: "primary", action: "main-tab-new-menu" },
  { keys: ["n"], modifier: "primary", action: "none" },
  { keys: ["1"], modifier: "primary", action: "main-tab-1" },
  { keys: ["2"], modifier: "primary", action: "main-tab-2" },
  { keys: ["3"], modifier: "primary", action: "main-tab-3" },
  { keys: ["4"], modifier: "primary", action: "main-tab-4" },
  { keys: ["5"], modifier: "primary", action: "main-tab-5" },
  { keys: ["6"], modifier: "primary", action: "main-tab-6" },
  { keys: ["7"], modifier: "primary", action: "main-tab-7" },
  { keys: ["8"], modifier: "primary", action: "main-tab-8" },
  { keys: ["9"], modifier: "primary", action: "main-tab-last" },
  { keys: ["tab"], modifier: "ctrl", action: "main-tab-next" },
  { keys: ["tab"], modifier: "ctrl", shift: true, action: "main-tab-previous" },
  {
    keys: ["]", "}"],
    modifier: "mac-meta",
    shift: true,
    action: "main-tab-next",
  },
  {
    keys: ["[", "{"],
    modifier: "mac-meta",
    shift: true,
    action: "main-tab-previous",
  },
];

function modifierMatches(
  chord: PwaChord,
  event: KeyEventLike,
  mac: boolean,
): boolean {
  if (event.altKey) return false;
  const ctrl = !!event.ctrlKey;
  const meta = !!event.metaKey;
  switch (chord.modifier) {
    case "primary":
      return mac ? meta && !ctrl : ctrl && !meta;
    case "ctrl":
      return ctrl && !meta;
    case "mac-meta":
      return mac && meta && !ctrl;
  }
}

export function resolvePwaKey(
  event: KeyEventLike,
  context: PwaKeyContext,
): PwaKeyOutcome {
  if (!context.standalone || context.composing) return null;
  const key = event.key.toLowerCase();
  const chord = PWA_TAB_KEYS.find(
    (item) =>
      item.keys.includes(key) &&
      !!item.shift === !!event.shiftKey &&
      modifierMatches(item, event, context.mac),
  );
  if (!chord) return null;
  // 端末は Cmd の付かないキーを全部受け取る (Ctrl+W は単語の削除)。
  if (context.target === "terminal" && !event.metaKey) return null;
  if (context.target === "blocked" || chord.action === "none")
    return { kind: "swallow" };
  return { kind: "run", action: chord.action };
}

/** ⌘9 の行き先: フォーカスのある面の最後のタブの番号 (1 始まり。空の面は 0)。 */
export function lastTabNumber(layout: Layout): number {
  const pane = layout.panes[layout.focused];
  if (!pane)
    throw new Error(
      `pwa: the focused pane ${layout.focused} is missing from the layout`,
    );
  return pane.tabs.length;
}

/**
 * 窓の枠の色 (インストールした窓のタイトルバー) を、いまのテーマの窓の地
 * (--color-ground) に合わせる。head の theme-color は OS の明暗で選ぶ 2 本だが、
 * アプリのテーマは OS と別に選べるので、どちらも今の地にする。
 */
export function syncThemeColor(doc: Document): void {
  const ground = getComputedStyle(doc.documentElement)
    .getPropertyValue("--color-ground")
    .trim();
  if (!ground)
    throw new Error(
      `pwa: --color-ground is empty on <html data-theme="${doc.documentElement.dataset.theme}" data-palette="${doc.documentElement.dataset.palette ?? ""}">`,
    );
  for (const meta of doc.querySelectorAll<HTMLMetaElement>(
    'meta[name="theme-color"]',
  ))
    meta.content = ground;
}

/** navigator.userAgentData の brands (Chromium だけが持つ。標準の型に無い)。 */
export type UserAgentBrand = { brand: string; version: string };

/**
 * インストールの案内を出すブラウザか。案内の手順は Chrome の画面のものなので、
 * 同じ Chromium でも Edge などには出さない。
 */
export function isChromeBrowser(
  brands: readonly UserAgentBrand[] | undefined,
): boolean {
  return !!brands?.some((item) => item.brand === "Google Chrome");
}

/** beforeinstallprompt の event (標準の型に無いので使う分だけ)。 */
type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * hidden: 案内を出さない (Chrome 以外・インストールした窓の中)。
 * prompt: ブラウザがインストールの画面を出せる (ボタンを出す)。
 * manual: 出せない (インストール済み・条件を満たさない)。手順の文だけ。
 */
export type InstallOfferState = "hidden" | "prompt" | "manual";

export type InstallOffer = {
  state(): InstallOfferState;
  /** ブラウザのインストールの画面を出し、利用者の選んだ結果を返す。 */
  install(): Promise<"accepted" | "dismissed">;
  /** state() が変わったら呼ぶ。1 つだけ持つ (描き直すたびに置き換える)。 */
  onChange(listener: (() => void) | null): void;
};

type InstallOfferWindow = Pick<
  Window,
  "addEventListener" | "matchMedia" | "navigator"
>;

/**
 * beforeinstallprompt は読み込みの直後に 1 度だけ来るので、ヘルプを開く前から
 * 受けておく。event の prompt() は 1 回しか使えない。
 */
export function createInstallOffer(win: InstallOfferWindow): InstallOffer {
  const chrome = isChromeBrowser(
    (win.navigator as { userAgentData?: { brands?: UserAgentBrand[] } })
      .userAgentData?.brands,
  );
  let pending: InstallPromptEvent | null = null;
  let listener: (() => void) | null = null;
  win.addEventListener("beforeinstallprompt", (event) => {
    pending = event as InstallPromptEvent;
    listener?.();
  });
  win.addEventListener("appinstalled", () => {
    pending = null;
    listener?.();
  });
  return {
    state() {
      if (!chrome || win.matchMedia(STANDALONE_MEDIA_QUERY).matches)
        return "hidden";
      return pending ? "prompt" : "manual";
    },
    async install() {
      const event = pending;
      if (!event)
        throw new Error("pwa: the browser has not offered an install prompt");
      pending = null;
      listener?.();
      await event.prompt();
      return (await event.userChoice).outcome;
    },
    onChange(next) {
      listener = next;
    },
  };
}
