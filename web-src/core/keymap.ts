import { isPwaWindowKey } from "./pwa";

// "history" is the commit list (history screen or the History tab of a file):
// j / k step commits there without stealing the j / k of the sidebar.
export const KEYMAP_SCOPES = [
  "global",
  "sidebar",
  "main",
  "panel",
  "history",
] as const;

export type KeymapScope = (typeof KEYMAP_SCOPES)[number];

// 型と値を二重管理しないよう、union はこの配列から導出する。ユーザー設定を
// 受け取るサーバー側は「実行時に action 名を検証できる値」を必要とする。
export const KEYMAP_ACTIONS = [
  "open-file-palette",
  "open-grep-palette",
  "focus-file-filter",
  "focus-sidebar",
  "focus-main",
  "open-sidebar-item",
  "sidebar-next",
  "sidebar-previous",
  "sidebar-page-down",
  "sidebar-page-up",
  "sidebar-expand",
  "sidebar-collapse",
  "scroll-main-down",
  "scroll-main-up",
  "scroll-main-page-down",
  "scroll-main-page-up",
  "tab-preview",
  "tab-code",
  "goto-top",
  "goto-bottom",
  "start-g-sequence",
  "cancel-source-load",
  "layout-unified",
  "layout-split",
  "toggle-theme",
  "annotation-next",
  "annotation-previous",
  // 名前はクイックヘルプの頃のまま (保存した割り当てを壊さない)。いまは
  // キーボードショートカットの小窓を開く。ヘルプのページは open-help-page。
  "open-help",
  "open-help-page",
  "copy-ai-context",
  "copy-ai-context-with-code",
  "next-unviewed-file",
  "previous-unviewed-file",
  "toggle-viewed",
  "reload-diff",
  "next-hunk",
  "previous-hunk",
  "goto-definition",
  "goto-diff",
  "goto-history",
  "history-next-commit",
  "history-previous-commit",
  "goto-repo",
  "toggle-terminal-panel",
  "toggle-sidebar",
  "undo-last-action",
  "find-in-source",
  "goto-journal",
  "goto-database",
  "goto-agents",
  "goto-worktrees",
  "goto-tools",
  "goto-search",
  "new-agent",
  "switch-project",
  "nav-back",
  "nav-forward",
  "copy-file-path",
  "toggle-annotations-panel",
  "toggle-ignore-whitespace",
  "toggle-hide-tests",
  "open-settings",
  "code-font-size-increase",
  "code-font-size-decrease",
  "code-font-size-reset",
  "main-tab-next",
  "main-tab-previous",
  "main-tab-close",
  "main-tab-menu",
  "main-tab-1",
  "main-tab-2",
  "main-tab-3",
  "main-tab-4",
  "main-tab-5",
  "main-tab-6",
  "main-tab-7",
  "main-tab-8",
  "main-tab-9",
  "main-tab-last",
  "main-tab-reopen",
  "main-pane-other",
  "project-previous",
  "project-next",
] as const;

export type KeymapAction = (typeof KEYMAP_ACTIONS)[number];

export type KeyEventLike = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
};

export type KeymapContext = {
  scope: KeymapScope;
  editable: boolean;
  pageKeymapBlocked?: boolean;
  composing?: boolean;
  paletteOpen?: boolean;
  pendingG?: boolean;
  lightboxOpen?: boolean;
  /** キーを受けたのが端末 (xterm) の中か。端末の中では terminalAllowed の行だけが効く */
  terminal?: boolean;
  /** インストールした窓 (PWA、display-mode: standalone) か。pwa の行はこのときだけ効く */
  standalone?: boolean;
};

export type KeyBinding = {
  action: KeymapAction;
  key: string;
  scope?: KeymapScope;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
  allowEditable?: boolean;
  allowPaletteOpen?: boolean;
  shift?: boolean;
  pendingG?: boolean;
  requires?: {
    lightboxClosed?: boolean;
  };
  /**
   * 端末 (xterm) の中でも効くか。書かなければ、Meta 付きで入力欄でも効く行だけ
   * (端末は Cmd の付かないキーを全部受け取る。terminalAllowed)。
   */
  terminal?: boolean;
  /** インストールした窓 (PWA) だけで効く。通常のタブでは効かない */
  pwa?: boolean;
};

/**
 * ユーザーが編集できるのは「押し方」と「効く所」(入力欄・端末・PWA の窓)。
 * scope や allowPaletteOpen などの発火条件はデフォルト定義から引き継ぐ
 * (resolveKeyBindings を参照)。
 */
export type KeyChord = {
  /** event.key を normalizeKeyName したもの。"k" / "escape" / "space" / "}" */
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
  /** 直前に g を押す必要があるか (g d のような 2 ストローク) */
  pendingG?: boolean;
  /** 効く所。書かなければその押し方の既定 (chordWhere) のまま */
  inputs?: boolean;
  terminal?: boolean;
  pwa?: boolean;
};

/** 押し方ごとの効く所 (設定の画面のチェック)。 */
export type KeyWhere = {
  /** 文字の入力欄 (input・textarea・contenteditable) の中でも効く */
  inputs: boolean;
  /** 端末 (xterm) の中でも効く */
  terminal: boolean;
  /** インストールした窓 (PWA) だけで効く */
  pwa: boolean;
};

/**
 * ユーザーが変更したアクションだけを持つ差分。値が空配列ならそのアクションを
 * 無効化する。ここに無いアクションはデフォルトのまま動く - つまり将来
 * デフォルトの割り当てを変えても、ユーザーが触っていないものは追従する。
 */
export type KeymapOverrides = Partial<Record<KeymapAction, KeyChord[]>>;

export const DEFAULT_KEY_BINDINGS: KeyBinding[] = [
  {
    action: "open-file-palette",
    key: "k",
    ctrl: true,
    allowEditable: true,
    allowPaletteOpen: true,
  },
  {
    action: "open-file-palette",
    key: "k",
    meta: true,
    allowEditable: true,
    allowPaletteOpen: true,
  },
  {
    action: "open-grep-palette",
    key: "g",
    ctrl: true,
    allowEditable: true,
    allowPaletteOpen: true,
  },
  {
    action: "open-grep-palette",
    key: "g",
    meta: true,
    allowEditable: true,
    allowPaletteOpen: true,
  },
  { action: "focus-file-filter", key: "/" },
  { action: "annotation-next", key: "]" },
  { action: "annotation-previous", key: "[" },
  { action: "focus-sidebar", key: "h", shift: true },
  { action: "focus-main", key: "l", shift: true },
  {
    action: "cancel-source-load",
    key: "escape",
    requires: { lightboxClosed: true },
  },
  { action: "open-sidebar-item", key: "enter", scope: "sidebar" },
  { action: "open-sidebar-item", key: "enter", scope: "global" },
  { action: "sidebar-next", key: "j", scope: "sidebar" },
  { action: "sidebar-next", key: "j", scope: "global" },
  { action: "sidebar-previous", key: "k", scope: "sidebar" },
  { action: "sidebar-previous", key: "k", scope: "global" },
  { action: "sidebar-page-down", key: "d", scope: "sidebar", ctrl: true },
  { action: "sidebar-page-down", key: "d", scope: "global", ctrl: true },
  { action: "sidebar-page-up", key: "u", scope: "sidebar", ctrl: true },
  { action: "sidebar-page-up", key: "u", scope: "global", ctrl: true },
  { action: "sidebar-expand", key: "l", scope: "sidebar" },
  { action: "sidebar-expand", key: "l", scope: "global" },
  { action: "sidebar-collapse", key: "h", scope: "sidebar" },
  { action: "sidebar-collapse", key: "h", scope: "global" },
  { action: "scroll-main-down", key: "j", scope: "main" },
  { action: "scroll-main-up", key: "k", scope: "main" },
  { action: "scroll-main-page-down", key: "d", scope: "main", ctrl: true },
  { action: "scroll-main-page-up", key: "u", scope: "main", ctrl: true },
  { action: "scroll-main-page-down", key: "pagedown", scope: "main" },
  { action: "scroll-main-page-up", key: "pageup", scope: "main" },
  { action: "scroll-main-page-down", key: "pagedown", scope: "global" },
  { action: "scroll-main-page-up", key: "pageup", scope: "global" },
  { action: "scroll-main-page-down", key: "pagedown", scope: "sidebar" },
  { action: "scroll-main-page-up", key: "pageup", scope: "sidebar" },
  {
    action: "scroll-main-page-down",
    key: "arrowdown",
    scope: "main",
    ctrl: true,
  },
  { action: "scroll-main-page-up", key: "arrowup", scope: "main", ctrl: true },
  {
    action: "scroll-main-page-down",
    key: "arrowdown",
    scope: "global",
    ctrl: true,
  },
  {
    action: "scroll-main-page-up",
    key: "arrowup",
    scope: "global",
    ctrl: true,
  },
  {
    action: "scroll-main-page-down",
    key: "arrowdown",
    scope: "sidebar",
    ctrl: true,
  },
  {
    action: "scroll-main-page-up",
    key: "arrowup",
    scope: "sidebar",
    ctrl: true,
  },
  { action: "tab-preview", key: "p", scope: "main", pendingG: true },
  { action: "tab-code", key: "c", scope: "main", pendingG: true },
  { action: "goto-top", key: "g", pendingG: true },
  { action: "goto-bottom", key: "g", shift: true, pendingG: true },
  { action: "goto-bottom", key: "g", shift: true },
  { action: "start-g-sequence", key: "g", scope: "sidebar" },
  { action: "start-g-sequence", key: "g", scope: "main" },
  // 画面の行き先も g から始めるので、どこにフォーカスがあっても g を
  // 受けられるようにしておく。
  { action: "start-g-sequence", key: "g", scope: "global" },
  { action: "layout-unified", key: "u" },
  { action: "layout-split", key: "s" },
  { action: "toggle-theme", key: "t" },
  { action: "open-help", key: "?", shift: true },
  { action: "copy-ai-context", key: "y" },
  { action: "copy-ai-context-with-code", key: "y", shift: true },
  { action: "next-unviewed-file", key: "n" },
  { action: "previous-unviewed-file", key: "n", shift: true },
  { action: "toggle-viewed", key: "v" },
  { action: "reload-diff", key: "r" },
  { action: "next-hunk", key: "}", shift: true },
  { action: "previous-hunk", key: "{", shift: true },
  { action: "goto-definition", key: ".", pendingG: true },
  { action: "goto-diff", key: "d", pendingG: true },
  { action: "goto-history", key: "h", pendingG: true },
  { action: "history-next-commit", key: "arrowdown" },
  { action: "history-previous-commit", key: "arrowup" },
  { action: "history-next-commit", key: "j", scope: "history" },
  { action: "history-previous-commit", key: "k", scope: "history" },
  { action: "goto-repo", key: "r", pendingG: true },
  { action: "toggle-sidebar", key: "b" },
  { action: "toggle-terminal-panel", key: "`", ctrl: true },
  // 名前は下パネルにターミナルがあった頃のまま (保存した割り当てを壊さない)。
  // いまは「＋」のメニュー (新しいシェル・セッション) を開く。Tools / Search の
  // タブの入力欄からも開けるよう、ここだけ入力欄でも通す。
  {
    action: "toggle-terminal-panel",
    key: "`",
    ctrl: true,
    scope: "panel",
    allowEditable: true,
  },
  { action: "undo-last-action", key: "z", ctrl: true },
  { action: "undo-last-action", key: "z", meta: true },
  { action: "find-in-source", key: "f", ctrl: true },
  { action: "find-in-source", key: "f", meta: true },
  { action: "goto-journal", key: "j", pendingG: true },
  { action: "goto-database", key: "b", pendingG: true },
  { action: "goto-agents", key: "a", pendingG: true },
  // ヘッダ左端のリポジトリ名 (プロジェクトの切替) を開く。
  { action: "switch-project", key: "p" },
  { action: "nav-back", key: "[", ctrl: true },
  { action: "nav-forward", key: "]", ctrl: true },
  { action: "copy-file-path", key: "y", pendingG: true },
  { action: "toggle-annotations-panel", key: "a", shift: true },
  { action: "toggle-ignore-whitespace", key: "w" },
  { action: "toggle-hide-tests", key: "t", shift: true },
  { action: "open-settings", key: "," },
  { action: "code-font-size-increase", key: "=", ctrl: true },
  { action: "code-font-size-decrease", key: "-", ctrl: true },
  { action: "code-font-size-reset", key: "0", ctrl: true },
  // メインの面のタブ。ブラウザのタブの操作 (⌘W・Ctrl+Tab・⌘1〜9) は取らず、
  // 画面の行き先と同じ g から始める。
  { action: "main-tab-next", key: "t", pendingG: true },
  { action: "main-tab-previous", key: "t", shift: true, pendingG: true },
  { action: "main-tab-close", key: "x", pendingG: true },
  { action: "main-tab-menu", key: "m", pendingG: true },
  { action: "main-tab-1", key: "1", pendingG: true },
  { action: "main-tab-2", key: "2", pendingG: true },
  { action: "main-tab-3", key: "3", pendingG: true },
  { action: "main-tab-4", key: "4", pendingG: true },
  { action: "main-tab-5", key: "5", pendingG: true },
  { action: "main-tab-6", key: "6", pendingG: true },
  { action: "main-tab-7", key: "7", pendingG: true },
  { action: "main-tab-8", key: "8", pendingG: true },
  { action: "main-tab-9", key: "9", pendingG: true },
  // 2 面のとき、もう一方の面へフォーカスを移す (other)。
  { action: "main-pane-other", key: "o", pendingG: true },
  // 左の一覧の並びで前・次のプロジェクトへ (⌘⇧↑↓。Windows / Linux は Ctrl+Shift)。
  // 移った先の前面は、そのプロジェクトのタブのグループで最後に前面だったタブ。
  { action: "project-previous", key: "arrowup", meta: true, shift: true },
  { action: "project-previous", key: "arrowup", ctrl: true, shift: true },
  { action: "project-next", key: "arrowdown", meta: true, shift: true },
  { action: "project-next", key: "arrowdown", ctrl: true, shift: true },
];

/**
 * インストールした窓 (PWA) の既定のキー。通常のタブではブラウザが先に取るか
 * (⌘W・⌘T・⌘1〜9・Ctrl+Tab)、ブラウザの戻る / 進む (⌘← →) と取り合うので、
 * pwa の行にする。mac は ⌘、ほかは Ctrl (その OS のブラウザのタブ操作の修飾キー)。
 */
export function pwaKeyBindings(mac: boolean): KeyBinding[] {
  const primary = mac ? { meta: true } : { ctrl: true };
  // 本文でも入力欄でも効く (文字の編集に使わないキー)。端末の中は ⌘ のときだけ
  // (Ctrl のキーは端末のもの。Ctrl+W は単語の削除)。
  const tab = { allowEditable: true, pwa: true, terminal: mac };
  const rows: KeyBinding[] = [
    { action: "main-tab-close", key: "w", ...primary, ...tab },
    { action: "main-tab-reopen", key: "t", shift: true, ...primary, ...tab },
    { action: "toggle-terminal-panel", key: "t", ...primary, ...tab },
  ];
  for (let n = 1; n <= 8; n += 1)
    rows.push({
      action: `main-tab-${n}` as KeymapAction,
      key: String(n),
      ...primary,
      ...tab,
    });
  rows.push(
    { action: "main-tab-last", key: "9", ...primary, ...tab },
    {
      action: "main-tab-next",
      key: "tab",
      ctrl: true,
      ...tab,
      terminal: false,
    },
    {
      action: "main-tab-previous",
      key: "tab",
      ctrl: true,
      shift: true,
      ...tab,
      terminal: false,
    },
  );
  // ⌘⇧] / ⌘⇧[ (mac のブラウザの次 / 前のタブ)。Shift で event.key が } / { になる配列もある。
  if (mac)
    for (const [action, keys] of [
      ["main-tab-next", ["]", "}"]],
      ["main-tab-previous", ["[", "{"]],
    ] as const)
      for (const key of keys)
        rows.push({ action, key, meta: true, shift: true, ...tab });
  // ⌘← / ⌘→ (mac 以外は Ctrl)。入力欄では行の先頭・末尾へ動く今の働きのまま
  // (入力欄では効かない)。端末の中ではタブを移る。
  rows.push(
    {
      action: "main-tab-previous",
      key: "arrowleft",
      ...primary,
      pwa: true,
      terminal: true,
    },
    {
      action: "main-tab-next",
      key: "arrowright",
      ...primary,
      pwa: true,
      terminal: true,
    },
  );
  return rows;
}

/** その OS の既定のバインド全部 (PWA の行を含む)。 */
export function defaultKeyBindings(mac: boolean): KeyBinding[] {
  return [...DEFAULT_KEY_BINDINGS, ...pwaKeyBindings(mac)];
}

/** event.key を割り当ての名前にする (小文字。空白のキーは "space")。 */
export function normalizeKeyName(key: string): string {
  return key === " " ? "space" : key.trim().toLowerCase();
}

/** その行が端末 (xterm) の中でも効くか。 */
export function terminalAllowed(binding: KeyBinding): boolean {
  return binding.terminal ?? (!!binding.meta && !!binding.allowEditable);
}

export function whereOf(binding: KeyBinding): KeyWhere {
  return {
    inputs: !!binding.allowEditable,
    terminal: terminalAllowed(binding),
    pwa: !!binding.pwa,
  };
}

export function resolveKeymapAction(
  event: KeyEventLike,
  context: KeymapContext,
  bindings: KeyBinding[] = DEFAULT_KEY_BINDINGS,
): KeymapAction | null {
  const key = normalizeKeyName(event.key);
  if (context.composing || context.pageKeymapBlocked) return null;
  for (const binding of bindings) {
    if (binding.key !== key) continue;
    if (binding.pwa && !context.standalone) continue;
    if (binding.requires?.lightboxClosed && context.lightboxOpen) continue;
    if (binding.scope && binding.scope !== context.scope) continue;
    // PWA の窓のキー (⌘W など) は、直前に押した g を待っていても効く (g の後で
    // 窓を閉じるキーが何もしなくなるのを避ける。作業前の窓のキーの受け方と同じ)。
    if (
      !!binding.pendingG !== !!context.pendingG &&
      !(binding.pwa && !binding.pendingG)
    )
      continue;
    if (context.paletteOpen && !binding.allowPaletteOpen) continue;
    // 端末の文字の欄 (xterm の textarea) は入力欄でもあるが、効く所は端末の
    // 決まりで決める。
    if (context.terminal) {
      if (!terminalAllowed(binding)) continue;
    } else if (context.editable && !binding.allowEditable) continue;
    if (!!binding.ctrl !== !!event.ctrlKey) continue;
    if (!!binding.meta !== !!event.metaKey) continue;
    if (!!binding.alt !== !!event.altKey) continue;
    if (!!binding.shift !== !!event.shiftKey) continue;
    if (
      !binding.ctrl &&
      !binding.meta &&
      !binding.alt &&
      !binding.shift &&
      (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
    )
      continue;
    return binding.action;
  }
  return null;
}

/**
 * run: その操作をする。swallow: 何もしないがブラウザの既定の動作 (インストール
 * した窓を閉じる・窓を増やす) は止める (core/pwa.ts の isPwaWindowKey)。
 */
export type KeyOutcome =
  | { kind: "run"; action: KeymapAction }
  | { kind: "swallow" }
  | null;

/** キーを 1 つ受けたときの行き先。app の keydown はこれだけを見る。 */
export function resolveKeyOutcome(
  event: KeyEventLike,
  context: KeymapContext & { mac: boolean },
  bindings: KeyBinding[],
): KeyOutcome {
  const action = resolveKeymapAction(event, context, bindings);
  if (action) return { kind: "run", action };
  return isPwaWindowKey(event, {
    standalone: !!context.standalone,
    mac: context.mac,
    // パレットやダイアログが開いている間は、端末のキーとして通さず止める。
    terminal:
      !!context.terminal && !context.paletteOpen && !context.pageKeymapBlocked,
    composing: !!context.composing,
  })
    ? { kind: "swallow" }
    : null;
}

/**
 * バインドのうち「押し方」以外の発火条件。1 アクションが複数行に分かれている
 * のは、たいていこの条件が違うから (sidebar と main で別々に効かせる等)。
 */
function conditionKey(binding: KeyBinding): string {
  return [
    binding.scope || "",
    binding.allowEditable ? "e" : "",
    binding.allowPaletteOpen ? "p" : "",
    binding.requires?.lightboxClosed ? "l" : "",
  ].join("|");
}

function applyChord(condition: KeyBinding, chord: KeyChord): KeyBinding {
  const binding: KeyBinding = {
    action: condition.action,
    key: normalizeKeyName(chord.key),
  };
  if (condition.scope) binding.scope = condition.scope;
  if (chord.ctrl) binding.ctrl = true;
  if (chord.meta) binding.meta = true;
  if (chord.alt) binding.alt = true;
  if (chord.shift) binding.shift = true;
  if (chord.pendingG) binding.pendingG = true;
  if (condition.allowEditable) binding.allowEditable = true;
  if (condition.allowPaletteOpen) binding.allowPaletteOpen = true;
  if (condition.requires) binding.requires = condition.requires;
  return binding;
}

/**
 * 新しい押し方が引き継ぐ発火条件 (その操作の既定の行から、PWA の行を除いて
 * 条件ごとに 1 行)。既定のキーが無い操作は、どこでも効く条件 1 つ。
 */
function conditionsOf(
  action: KeymapAction,
  defaults: KeyBinding[],
): KeyBinding[] {
  const list: KeyBinding[] = [];
  for (const binding of defaults) {
    if (binding.action !== action || binding.pwa) continue;
    const key = conditionKey(binding);
    if (!list.some((item) => conditionKey(item) === key)) list.push(binding);
  }
  return list.length ? list : [{ action, key: "" }];
}

/** 押し方に書いた効く所を行に当てる。書いていない所は行のまま。 */
function withWhere(row: KeyBinding, chord: KeyChord): KeyBinding {
  if (
    chord.inputs === undefined &&
    chord.terminal === undefined &&
    chord.pwa === undefined
  )
    return row;
  // 端末の既定は入力欄の値から決まる (terminalAllowed) ので、入力欄を変える前に
  // 今の値で固める。入力欄だけ変えたのに端末の効き方まで変わらないように。
  const out: KeyBinding = {
    ...row,
    terminal: chord.terminal ?? terminalAllowed(row),
  };
  if (chord.inputs === true) out.allowEditable = true;
  if (chord.inputs === false) delete out.allowEditable;
  if (chord.pwa === true) out.pwa = true;
  if (chord.pwa === false) delete out.pwa;
  return out;
}

/**
 * その操作に割り当てた 1 つの押し方の行。既定にある押し方は既定の行 (scope・
 * 入力欄・PWA などをそのまま)、新しい押し方はその操作の発火条件を引き継ぐ。
 */
export function chordBindings(
  action: KeymapAction,
  chord: KeyChord,
  defaults: KeyBinding[],
): KeyBinding[] {
  const id = keyChordId(chord);
  const own = defaults.filter(
    (binding) =>
      binding.action === action && keyChordId(keyChordOf(binding)) === id,
  );
  const rows = own.length
    ? own
    : conditionsOf(action, defaults).map((condition) =>
        applyChord(condition, chord),
      );
  return rows.map((row) => withWhere(row, chord));
}

/**
 * ユーザーの差分をデフォルト定義に重ねて、実際に使うバインド一覧を作る。
 *
 * 「行の置き換え」ではなく「条件への適用」にしているのが要点。たとえば
 * sidebar-next は sidebar と global の 2 行あるので、キーを 1 つ変えたら
 * 両方の行が新しいキーになる必要がある。出力順はデフォルトの並びを保つ -
 * resolveKeymapAction は先頭一致なので、並びがそのまま優先順位になる。
 * 既定のキーが無い操作 (新しいエージェントなど) は、既定の並びの後ろに足す。
 */
export function resolveKeyBindings(
  overrides?: KeymapOverrides,
  defaults: KeyBinding[] = DEFAULT_KEY_BINDINGS,
): KeyBinding[] {
  if (!overrides) return defaults;

  const out: KeyBinding[] = [];
  const expanded = new Set<KeymapAction>();
  const expand = (action: KeymapAction, chords: KeyChord[]) => {
    expanded.add(action);
    for (const chord of chords)
      out.push(...chordBindings(action, chord, defaults));
  };
  for (const binding of defaults) {
    const chords = overrides[binding.action];
    // 差分が無いアクションはデフォルトのまま。空配列は「無効化」なので、
    // 1 行も出さずに終わる (undefined と空配列を取り違えないこと)。
    if (!chords) {
      out.push(binding);
      continue;
    }
    if (!expanded.has(binding.action)) expand(binding.action, chords);
  }
  for (const action of KEYMAP_ACTIONS) {
    const chords = overrides[action];
    if (chords && !expanded.has(action)) expand(action, chords);
  }
  return out;
}

export type KeymapConflict = {
  scope: KeymapScope;
  chord: KeyChord;
  /** 同じ押し方に割り当たっているアクション。2 件以上 */
  actions: KeymapAction[];
};

/** バインドから「押し方」だけを取り出す。設定 UI の初期値にも使う。 */
export function keyChordOf(binding: KeyBinding | KeyChord): KeyChord {
  const chord: KeyChord = { key: normalizeKeyName(binding.key) };
  if (binding.ctrl) chord.ctrl = true;
  if (binding.meta) chord.meta = true;
  if (binding.alt) chord.alt = true;
  if (binding.shift) chord.shift = true;
  if (binding.pendingG) chord.pendingG = true;
  return chord;
}

/** 押し方の同一性を見るためのキー。衝突判定と重複除去の両方で使う。 */
export function keyChordId(chord: KeyChord): string {
  return [
    normalizeKeyName(chord.key),
    chord.ctrl ? "c" : "",
    chord.meta ? "m" : "",
    chord.alt ? "a" : "",
    chord.shift ? "s" : "",
    chord.pendingG ? "g" : "",
  ].join("|");
}

/**
 * 同じ押し方が複数のアクションに割り当たっている箇所を探す。
 *
 * 動作は壊れない (先頭一致で決まる) が、ユーザーから見れば「変えたはずの
 * キーが効かない」に見えるので、設定画面で知らせるために使う。scope を
 * 指定しないバインドは全スコープで効くため、スコープごとに突き合わせる。
 */
export function findKeymapConflicts(
  bindings: KeyBinding[] = DEFAULT_KEY_BINDINGS,
): KeymapConflict[] {
  const conflicts: KeymapConflict[] = [];
  for (const scope of KEYMAP_SCOPES) {
    const groups = new Map<
      string,
      { chord: KeyChord; actions: KeymapAction[] }
    >();
    for (const binding of bindings) {
      if (binding.scope && binding.scope !== scope) continue;
      const chord = keyChordOf(binding);
      const key = keyChordId(chord);
      let group = groups.get(key);
      if (!group) {
        group = { chord, actions: [] };
        groups.set(key, group);
      }
      if (!group.actions.includes(binding.action))
        group.actions.push(binding.action);
    }
    for (const group of groups.values()) {
      if (group.actions.length < 2) continue;
      conflicts.push({ scope, chord: group.chord, actions: group.actions });
    }
  }
  return conflicts;
}

export const MAX_CHORD_KEY_LENGTH = 64;
export const MAX_CHORDS_PER_ACTION = 8;

function sanitizeChord(raw: unknown): KeyChord | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const key = source.key;
  if (typeof key !== "string") return null;
  const trimmed = normalizeKeyName(key);
  if (!trimmed || trimmed.length > MAX_CHORD_KEY_LENGTH) return null;
  const chord: KeyChord = { key: trimmed };
  if (source.ctrl === true) chord.ctrl = true;
  if (source.meta === true) chord.meta = true;
  if (source.alt === true) chord.alt = true;
  if (source.shift === true) chord.shift = true;
  if (source.pendingG === true) chord.pendingG = true;
  // 効く所は false にも意味がある (既定では効く所を止める)。
  for (const field of ["inputs", "terminal", "pwa"] as const)
    if (typeof source[field] === "boolean")
      chord[field] = source[field] as boolean;
  return chord;
}

/**
 * 設定ファイル・API 本文から読んだ生の値を KeymapOverrides に落とす。
 * 未知のアクション名や壊れた chord は、全体を捨てずにその項目だけ落とす -
 * 設定ファイルを手で編集して 1 行間違えたときに、他の設定まで消えないため。
 */
export function sanitizeKeymapOverrides(raw: unknown): KeymapOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const out: KeymapOverrides = {};
  for (const action of KEYMAP_ACTIONS) {
    if (!(action in source)) continue;
    const value = source[action];
    if (!Array.isArray(value)) continue;
    const chords: KeyChord[] = [];
    for (const item of value) {
      if (chords.length >= MAX_CHORDS_PER_ACTION) break;
      const chord = sanitizeChord(item);
      if (chord) chords.push(chord);
    }
    out[action] = chords;
  }
  return out;
}

/** 押し方の形だけ (効く所を除く)。 */
function chordShape(chord: KeyChord): KeyChord {
  return keyChordOf(chord);
}

/** 操作の押し方 (重複を除き、並びのまま)。設定の画面の 1 行の中身。 */
export function actionChords(
  action: KeymapAction,
  bindings: KeyBinding[],
): KeyChord[] {
  const chords: KeyChord[] = [];
  const seen = new Set<string>();
  for (const binding of bindings) {
    if (binding.action !== action) continue;
    const chord = keyChordOf(binding);
    const id = keyChordId(chord);
    if (seen.has(id)) continue;
    seen.add(id);
    chords.push(chord);
  }
  return chords;
}

/** その操作のその押し方が効く所 (書いた効く所を当てた後)。 */
export function chordWhere(
  action: KeymapAction,
  chord: KeyChord,
  defaults: KeyBinding[],
): KeyWhere {
  return whereOf(chordBindings(action, chord, defaults)[0]);
}

/**
 * 効く所を where にした押し方。既定と同じ所は書かない (JSON に書くのは既定から
 * 変えた所だけ。既定を後で変えても、利用者が触っていない所は追従する)。
 */
export function withChordWhere(
  action: KeymapAction,
  chord: KeyChord,
  where: KeyWhere,
  defaults: KeyBinding[],
): KeyChord {
  const shape = chordShape(chord);
  const natural = chordWhere(action, shape, defaults);
  if (where.inputs !== natural.inputs) shape.inputs = where.inputs;
  // 入力欄だけ変えても端末の効き方は変わらない (withWhere が端末を先に固める)
  // ので、端末も既定と比べるだけでよい。
  if (where.terminal !== natural.terminal) shape.terminal = where.terminal;
  if (where.pwa !== natural.pwa) shape.pwa = where.pwa;
  return shape;
}

/**
 * その操作にその押し方を足すと取り合う、ほかの操作 (同じ押し方で、効く場所
 * (scope) が重なるもの)。設定の画面が「置き換えるか」を聞くのに使う。
 */
export function chordUsers(
  action: KeymapAction,
  chord: KeyChord,
  bindings: KeyBinding[],
  defaults: KeyBinding[],
): KeymapAction[] {
  const mine = chordBindings(action, chordShape(chord), defaults);
  const id = keyChordId(chord);
  const users: KeymapAction[] = [];
  for (const binding of bindings) {
    if (binding.action === action || users.includes(binding.action)) continue;
    if (keyChordId(keyChordOf(binding)) !== id) continue;
    if (
      mine.some(
        (row) => !row.scope || !binding.scope || row.scope === binding.scope,
      )
    )
      users.push(binding.action);
  }
  return users;
}
