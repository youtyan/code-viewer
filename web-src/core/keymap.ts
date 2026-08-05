export const KEYMAP_SCOPES = ["global", "sidebar", "main", "panel"] as const;

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
  "open-help",
  "copy-ai-context",
  "copy-ai-context-with-code",
  "next-unviewed-file",
  "previous-unviewed-file",
  "toggle-viewed",
  "reload-diff",
  "next-hunk",
  "previous-hunk",
  "goto-diff",
  "goto-history",
  "goto-repo",
  "toggle-terminal-panel",
  "toggle-sidebar",
  "undo-last-action",
  "find-in-source",
  "goto-journal",
  "goto-database",
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
  composing?: boolean;
  paletteOpen?: boolean;
  pendingG?: boolean;
  lightboxOpen?: boolean;
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
};

/**
 * ユーザーが編集できるのは「押し方」だけ。scope / allowEditable などの
 * 発火条件はデフォルト定義から引き継ぐ (resolveKeyBindings を参照)。
 * 誤設定で入力欄にキーが漏れる事故を、型のレベルで防ぐための切り分け。
 */
export type KeyChord = {
  /** event.key を小文字にしたもの。"k" / "escape" / "pagedown" / "}" */
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
  /** 直前に g を押す必要があるか (g d のような 2 ストローク) */
  pendingG?: boolean;
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
  { action: "focus-sidebar", key: "h", ctrl: true },
  { action: "focus-main", key: "l", ctrl: true },
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
  { action: "goto-diff", key: "d", pendingG: true },
  { action: "goto-history", key: "h", pendingG: true },
  { action: "goto-repo", key: "r", pendingG: true },
  { action: "toggle-sidebar", key: "b" },
  { action: "toggle-terminal-panel", key: "`", ctrl: true },
  // ターミナルは打鍵を全部 PTY に渡すので、閉じる手段だけはパネル内でも
  // 効かせる。ここだけ入力欄でも通す。
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
];

export function resolveKeymapAction(
  event: KeyEventLike,
  context: KeymapContext,
  bindings: KeyBinding[] = DEFAULT_KEY_BINDINGS,
): KeymapAction | null {
  const key = event.key.toLowerCase();
  if (context.composing) return null;
  for (const binding of bindings) {
    if (binding.key !== key) continue;
    if (binding.requires?.lightboxClosed && context.lightboxOpen) continue;
    if (binding.scope && binding.scope !== context.scope) continue;
    if (!!binding.pendingG !== !!context.pendingG) continue;
    if (context.paletteOpen && !binding.allowPaletteOpen) continue;
    if (context.editable && !binding.allowEditable) continue;
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
    key: chord.key.toLowerCase(),
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
 * ユーザーの差分をデフォルト定義に重ねて、実際に使うバインド一覧を作る。
 *
 * 「行の置き換え」ではなく「条件への適用」にしているのが要点。たとえば
 * sidebar-next は sidebar と global の 2 行あるので、キーを 1 つ変えたら
 * 両方の行が新しいキーになる必要がある。出力順はデフォルトの並びを保つ -
 * resolveKeymapAction は先頭一致なので、並びがそのまま優先順位になる。
 */
export function resolveKeyBindings(
  overrides?: KeymapOverrides,
  defaults: KeyBinding[] = DEFAULT_KEY_BINDINGS,
): KeyBinding[] {
  if (!overrides) return defaults;

  const conditions = new Map<KeymapAction, KeyBinding[]>();
  for (const binding of defaults) {
    const list = conditions.get(binding.action);
    if (!list) {
      conditions.set(binding.action, [binding]);
      continue;
    }
    const key = conditionKey(binding);
    if (!list.some((item) => conditionKey(item) === key)) list.push(binding);
  }

  const out: KeyBinding[] = [];
  const expanded = new Set<KeymapAction>();
  for (const binding of defaults) {
    const chords = overrides[binding.action];
    // 差分が無いアクションはデフォルトのまま。空配列は「無効化」なので、
    // 1 行も出さずに終わる (undefined と空配列を取り違えないこと)。
    if (!chords) {
      out.push(binding);
      continue;
    }
    if (expanded.has(binding.action)) continue;
    expanded.add(binding.action);
    for (const chord of chords)
      for (const condition of conditions.get(binding.action) || [])
        out.push(applyChord(condition, chord));
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
export function keyChordOf(binding: KeyBinding): KeyChord {
  const chord: KeyChord = { key: binding.key.toLowerCase() };
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
    chord.key.toLowerCase(),
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

const MAX_CHORD_KEY_LENGTH = 64;
const MAX_CHORDS_PER_ACTION = 8;

function sanitizeChord(raw: unknown): KeyChord | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const key = source.key;
  if (typeof key !== "string") return null;
  const trimmed = key.trim().toLowerCase();
  if (!trimmed || trimmed.length > MAX_CHORD_KEY_LENGTH) return null;
  const chord: KeyChord = { key: trimmed };
  if (source.ctrl === true) chord.ctrl = true;
  if (source.meta === true) chord.meta = true;
  if (source.alt === true) chord.alt = true;
  if (source.shift === true) chord.shift = true;
  if (source.pendingG === true) chord.pendingG = true;
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
