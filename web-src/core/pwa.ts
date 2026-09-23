// インストールした窓 (PWA、display-mode: standalone) の決まり。
//
// 通常のタブでは ⌘W・⌘T・Ctrl+Tab などはブラウザが先に取り、ページには届かない
// (だから keymap.ts のタブ操作は g から始まる)。インストールした窓ではこれらが
// ページに届き、止めないとブラウザが窓そのものを閉じる・新しい窓を開く。窓で
// そのキーに何をさせるかは keymap.ts の pwaKeyBindings (利用者が設定で変えられる)。
// ここは「どのキーがそうか」だけを持つ。

import type { KeyChord, KeyEventLike } from "./keymap";
import type { Layout } from "./main-tabs";

export const STANDALONE_MEDIA_QUERY = "(display-mode: standalone)";

type WindowKey = {
  /** event.key を小文字にしたもの。候補が複数あるのは Shift で文字が変わるキー */
  keys: readonly string[];
  /** primary = その OS のブラウザのタブ操作の修飾キー (mac は Cmd、それ以外は Ctrl) */
  modifier: "primary" | "ctrl" | "mac-meta";
  shift?: boolean;
};

/**
 * 通常のタブではブラウザが先に取るキー。インストールした窓では、割り当てが
 * 無くても (効かない場所でも) 既定の動作を止める。
 * ⌘⇧W / Ctrl+Shift+W (窓を閉じる) は入れない: 窓を閉じる手段を 1 つは残す
 * (⌘W はタブを閉じるので、全部閉じても窓は残る)。
 */
export const PWA_WINDOW_KEYS: readonly WindowKey[] = [
  { keys: ["w"], modifier: "primary" },
  { keys: ["t"], modifier: "primary", shift: true },
  { keys: ["t"], modifier: "primary" },
  { keys: ["n"], modifier: "primary" },
  ...["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(
    (key): WindowKey => ({ keys: [key], modifier: "primary" }),
  ),
  { keys: ["tab"], modifier: "ctrl" },
  { keys: ["tab"], modifier: "ctrl", shift: true },
  { keys: ["]", "}"], modifier: "mac-meta", shift: true },
  { keys: ["[", "{"], modifier: "mac-meta", shift: true },
];

type Modifiers = {
  key: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
};

function matchesWindowKey(
  item: WindowKey,
  press: Modifiers,
  mac: boolean,
): boolean {
  if (press.alt || !item.keys.includes(press.key)) return false;
  if (!!item.shift !== press.shift) return false;
  switch (item.modifier) {
    case "primary":
      return mac ? press.meta && !press.ctrl : press.ctrl && !press.meta;
    case "ctrl":
      return press.ctrl && !press.meta;
    case "mac-meta":
      return mac && press.meta && !press.ctrl;
  }
}

function eventModifiers(event: KeyEventLike): Modifiers {
  return {
    key: event.key === " " ? "space" : event.key.toLowerCase(),
    ctrl: !!event.ctrlKey,
    meta: !!event.metaKey,
    alt: !!event.altKey,
    shift: !!event.shiftKey,
  };
}

function chordModifiers(chord: KeyChord): Modifiers {
  return {
    key: chord.key,
    ctrl: !!chord.ctrl,
    meta: !!chord.meta,
    alt: !!chord.alt,
    shift: !!chord.shift,
  };
}

/**
 * 割り当てが無くても既定の動作を止めるキーか (インストールした窓の中だけ)。
 * 端末の中の Cmd の付かないキーは端末のもの (Ctrl+W は単語の削除)。
 */
export function isPwaWindowKey(
  event: KeyEventLike,
  context: {
    standalone: boolean;
    mac: boolean;
    terminal: boolean;
    composing: boolean;
  },
): boolean {
  if (!context.standalone || context.composing) return false;
  if (context.terminal && !event.metaKey) return false;
  const press = eventModifiers(event);
  return PWA_WINDOW_KEYS.some((item) =>
    matchesWindowKey(item, press, context.mac),
  );
}

/**
 * 通常のブラウザのタブではページに届かない押し方か。設定の画面は、この押し方を
 * 「PWA の窓だけ」と出す (g で始まる押し方は該当しない)。
 */
export function browserTabTakes(chord: KeyChord, mac: boolean): boolean {
  if (chord.pendingG) return false;
  const press = chordModifiers(chord);
  return PWA_WINDOW_KEYS.some((item) => matchesWindowKey(item, press, mac));
}

/**
 * 割り当てられない押し方。返すのは理由の名前 (画面の文言は呼び出し側)。
 * - close-window: ⌘⇧W / Ctrl+Shift+W。窓を閉じる手段として残す
 * - quit: ⌘Q。ブラウザを終えるキーで、ページに届かない
 */
export function unassignableChord(
  chord: KeyChord,
  mac: boolean,
): "close-window" | "quit" | null {
  if (chord.pendingG || chord.alt) return null;
  const primary = mac
    ? !!chord.meta && !chord.ctrl
    : !!chord.ctrl && !chord.meta;
  if (!primary) return null;
  if (chord.key === "w" && chord.shift) return "close-window";
  if (mac && chord.key === "q" && !chord.shift) return "quit";
  return null;
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
 * 窓の枠の色 (インストールした窓のタイトルバー) を、いまのテーマでの variable
 * の値に合わせる。既定は窓の地 (--color-ground)。app はいま見ているプロジェクトの
 * 色 (--project-<色>) を渡す。head の theme-color は OS の明暗で選ぶ 2 本だが、
 * アプリのテーマは OS と別に選べるので、どちらも今の値にする。
 */
export function syncThemeColor(
  doc: Document,
  variable = "--color-ground",
): void {
  const value = getComputedStyle(doc.documentElement)
    .getPropertyValue(variable)
    .trim();
  if (!value)
    throw new Error(
      `pwa: ${variable} is empty on <html data-theme="${doc.documentElement.dataset.theme}" data-palette="${doc.documentElement.dataset.palette ?? ""}">`,
    );
  for (const meta of doc.querySelectorAll<HTMLMetaElement>(
    'meta[name="theme-color"]',
  ))
    meta.content = value;
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
