// 設定 (Help ページの設定) の「ショートカット」の節。アプリの操作を全部並べ、
// 操作ごとにキーを足す・外す・効く所 (入力欄・端末・PWA の窓) を選ぶ・既定に
// 戻す。JSON の書き出し・読み込み・直接編集もここ。保存はページの「変更を保存」
// 1 つ (SettingsDraft。節の中に「保存」を置かない。ui-surface.md の設定の節)。
//
// 操作の名前と分類は help-keybindings.ts の表 (ヘルプの一覧と同じもの)、
// キーの決まり (既定・効く所・取り合い) は core/keymap.ts、窓のキーは core/pwa.ts。

import { formatErrorDetail } from "../core/error-detail";
import { isImeComposing } from "../core/keyboard";
import {
  actionChords,
  chordUsers,
  chordWhere,
  defaultKeyBindings,
  KEYMAP_ACTIONS,
  type KeyChord,
  type KeymapAction,
  type KeymapOverrides,
  type KeyWhere,
  keyChordId,
  normalizeKeyName,
  resolveKeyBindings,
  withChordWhere,
} from "../core/keymap";
import {
  type KeymapJsonIssue,
  type KeymapJsonIssueCode,
  parseKeymapJson,
} from "../core/keymap-json";
import { browserTabTakes, unassignableChord } from "../core/pwa";
import {
  actionLabel,
  actionsInGroup,
  formatKeyBinding,
  type HelpKeybindingLanguage,
  KEYMAP_GROUPS,
  keymapGroupTitle,
} from "./help-keybindings";
import { showConfirmDialog } from "./ui-dialog";
import type { SettingsDraft } from "./viewer-settings";

export type ShortcutSettingsDeps = {
  getLanguage(): HelpKeybindingLanguage;
  /** macOS か (既定のキーの修飾キーが ⌘ か Ctrl か) */
  mac: boolean;
  /** 保存してある差分 (サーバの設定。ブラウザと PWA で共通) */
  getSaved(): KeymapOverrides;
  /** 差分を保存する。失敗は投げる (ページが保存の横に出す) */
  save(next: KeymapOverrides): Promise<void>;
  /** 見出しの横の「全プロジェクト共通」の文言 */
  getSharedTag(): { text: string; title: string };
  /** 文字をファイルとして書き出す (ブラウザのダウンロード) */
  download(fileName: string, text: string): void;
};

type ShortcutText = {
  title: string;
  intro: string;
  filterPlaceholder: string;
  filterEmpty: (query: string) => string;
  exportJson: string;
  importJson: string;
  editJson: string;
  resetAll: string;
  resetAllTitle: string;
  resetAllBody: string;
  resetAllConfirm: string;
  jsonLabel: string;
  jsonHelp: string;
  jsonIssue: (issue: KeymapJsonIssue, message: string) => string;
  issue: Record<KeymapJsonIssueCode, (detail: string) => string>;
  importFailed: (detail: string) => string;
  problem: string;
  changed: string;
  noKey: string;
  addKey: string;
  pressKey: string;
  gFirst: string;
  restore: string;
  removeKey: (key: string) => string;
  whereInputs: string;
  whereTerminal: string;
  wherePwa: string;
  /** 普通のタブではブラウザが先に取るキーの説明 (行に 1 回。keys はそのキーの並び) */
  browserTakes: (keys: string) => string;
  conflict: (key: string, actions: string) => string;
  replace: string;
  cancel: string;
  unassignable: Record<"close-window" | "quit", (key: string) => string>;
  alreadyAssigned: (key: string) => string;
};

const TEXT: Record<HelpKeybindingLanguage, ShortcutText> = {
  en: {
    title: "Shortcuts",
    intro:
      "Every action of the app. Open one, press Add key, then press the key. An action can have several keys, and each key can work in text fields, in terminals, or only in the installed app window (PWA).",
    filterPlaceholder: "Filter actions or keys",
    filterEmpty: (query) => `No actions match "${query}".`,
    exportJson: "Export JSON",
    importJson: "Import JSON",
    editJson: "Edit JSON",
    resetAll: "Restore all defaults",
    resetAllTitle: "Restore every shortcut to its default?",
    resetAllBody:
      "Every key you changed goes back to its default when you save the settings.",
    resetAllConfirm: "Restore all",
    jsonLabel: "Changed shortcuts (JSON)",
    jsonHelp:
      'Only the actions you changed are listed, each with its keys, for example "toggle-theme": [{ "key": "t", "ctrl": true }]. An empty list turns the action off. "inputs", "terminal" and "pwa" (true or false) set where a key works. Nothing is saved while the JSON has a mistake.',
    jsonIssue: (issue, message) =>
      `Line ${issue.line}, column ${issue.column}${issue.path === "$" ? "" : ` (${issue.path})`}: ${message}`,
    issue: {
      syntax: (found) =>
        found ? `not JSON here (found ${found})` : "the JSON ends too early",
      "not-object": () => "the whole value must be an object { … }",
      "unknown-action": () => "there is no action with this name",
      "duplicate-action": () => "this action is written twice",
      "not-array": () => "must be a list of keys [ … ]",
      "too-many-keys": (max) => `at most ${max} keys per action`,
      "chord-not-object": () =>
        'each key must be an object like { "key": "t" }',
      "missing-key": () => 'needs "key"',
      "empty-key": () => '"key" must be a key name such as "t" or "escape"',
      "key-too-long": () => '"key" is too long',
      "unknown-field": () =>
        "unknown field (use key, ctrl, meta, alt, shift, pendingG, inputs, terminal, pwa)",
      "duplicate-field": () => "this field is written twice",
      "not-boolean": () => "must be true or false",
      "duplicate-chord": () => "the same key is listed twice",
      "reserved-chord": (reason) =>
        reason === "quit"
          ? "this key quits the browser and cannot be assigned"
          : "this key is left to close the window and cannot be assigned",
    },
    importFailed: (detail) => `The file could not be read: ${detail}`,
    problem: "Fix the shortcut JSON before saving.",
    changed: "Changed",
    noKey: "No key",
    addKey: "Add key",
    pressKey: "Press a key…",
    gFirst: "Press g first",
    restore: "Restore default",
    removeKey: (key) => `Remove ${key}`,
    whereInputs: "In text fields",
    whereTerminal: "In terminals",
    wherePwa: "App window (PWA) only",
    browserTakes: (keys) =>
      `A browser tab keeps ${keys} for itself, so these keys work only in the installed app window (PWA).`,
    conflict: (key, actions) => `${key} is used by ${actions}.`,
    replace: "Replace",
    cancel: "Cancel",
    unassignable: {
      "close-window": (key) =>
        `${key} is left to close the window, so it cannot be assigned.`,
      quit: (key) => `${key} quits the browser, so it cannot be assigned.`,
    },
    alreadyAssigned: (key) => `${key} is already assigned to this action.`,
  },
  ja: {
    title: "ショートカット",
    intro:
      "アプリでできる操作の一覧です。操作を開いて「キーを追加」を押し、割り当てるキーを押します。1 つの操作に複数のキーを割り当てられ、キーごとに、入力欄の中・端末の中・PWA の窓だけのどこで効くかを選べます。",
    filterPlaceholder: "操作やキーで絞り込む",
    filterEmpty: (query) => `「${query}」に当てはまる操作はありません。`,
    exportJson: "JSON を書き出す",
    importJson: "JSON を読み込む",
    editJson: "JSON を直接編集",
    resetAll: "すべて既定に戻す",
    resetAllTitle: "すべてのショートカットを既定に戻しますか？",
    resetAllBody: "変えたキーは、設定を保存したときにすべて既定に戻ります。",
    resetAllConfirm: "すべて戻す",
    jsonLabel: "変えたショートカット (JSON)",
    jsonHelp:
      '変えた操作だけが、キーのリストと一緒に並びます (例: "toggle-theme": [{ "key": "t", "ctrl": true }])。空のリストはその操作を止めます。"inputs"・"terminal"・"pwa" (true か false) でキーの効く所を決めます。JSON に誤りがある間は保存しません。',
    jsonIssue: (issue, message) =>
      `${issue.line} 行 ${issue.column} 文字目${issue.path === "$" ? "" : ` (${issue.path})`}: ${message}`,
    issue: {
      syntax: (found) =>
        found
          ? `ここが JSON として読めません (${found})`
          : "JSON が途中で終わっています",
      "not-object": () => "全体は { … } のオブジェクトにしてください",
      "unknown-action": () => "この名前の操作はありません",
      "duplicate-action": () => "同じ操作が 2 回書かれています",
      "not-array": () => "キーのリスト [ … ] にしてください",
      "too-many-keys": (max) => `1 つの操作のキーは ${max} 個までです`,
      "chord-not-object": () =>
        'キーは { "key": "t" } の形のオブジェクトにしてください',
      "missing-key": () => '"key" がありません',
      "empty-key": () =>
        '"key" には "t" や "escape" のようなキーの名前を書いてください',
      "key-too-long": () => '"key" が長すぎます',
      "unknown-field": () =>
        "知らない欄です (key・ctrl・meta・alt・shift・pendingG・inputs・terminal・pwa が使えます)",
      "duplicate-field": () => "同じ欄が 2 回書かれています",
      "not-boolean": () => "true か false にしてください",
      "duplicate-chord": () => "同じキーが 2 回並んでいます",
      "reserved-chord": (reason) =>
        reason === "quit"
          ? "ブラウザを終えるキーなので割り当てられません"
          : "窓を閉じるために残してあるキーなので割り当てられません",
    },
    importFailed: (detail) => `ファイルを読めませんでした: ${detail}`,
    problem: "ショートカットの JSON を直してから保存してください。",
    changed: "変更済み",
    noKey: "キーなし",
    addKey: "キーを追加",
    pressKey: "キーを押してください…",
    gFirst: "先に g を押す",
    restore: "既定に戻す",
    removeKey: (key) => `${key} を外す`,
    whereInputs: "入力欄の中でも",
    whereTerminal: "端末の中でも",
    wherePwa: "PWA の窓だけ",
    browserTakes: (keys) =>
      `${keys} は、普通のブラウザのタブではブラウザが先に取るので、PWA の窓 (インストールしたアプリ) だけで効きます。`,
    conflict: (key, actions) => `${key} は「${actions}」が使っています。`,
    replace: "置き換える",
    cancel: "取りやめる",
    unassignable: {
      "close-window": (key) =>
        `${key} は窓を閉じるために残してあるので、割り当てられません。`,
      quit: (key) =>
        `${key} はブラウザを終えるキーなので、割り当てられません。`,
    },
    alreadyAssigned: (key) => `${key} はこの操作に割り当て済みです。`,
  },
};

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

function chordFromEvent(event: KeyboardEvent, gFirst: boolean): KeyChord {
  const chord: KeyChord = { key: normalizeKeyName(event.key) };
  if (event.ctrlKey) chord.ctrl = true;
  if (event.metaKey) chord.meta = true;
  if (event.altKey) chord.alt = true;
  if (event.shiftKey) chord.shift = true;
  if (gFirst) chord.pendingG = true;
  return chord;
}

function chordLabel(action: KeymapAction, chord: KeyChord): string {
  return formatKeyBinding({ action, ...chord });
}

/**
 * 差分を並べ直し、既定と同じになった操作を落とす。保存・書き出し・「変更済み」
 * の判定はこの形で比べる (並びや既定と同じ書き方で差が出ないように)。
 */
function tidyOverrides(
  overrides: KeymapOverrides,
  defaults: ReturnType<typeof defaultKeyBindings>,
): KeymapOverrides {
  const out: KeymapOverrides = {};
  for (const action of KEYMAP_ACTIONS) {
    const chords = overrides[action];
    if (!chords) continue;
    const natural = actionChords(action, defaults);
    const same =
      chords.length === natural.length &&
      chords.every(
        (chord, index) =>
          keyChordId(chord) === keyChordId(natural[index]) &&
          chord.inputs === undefined &&
          chord.terminal === undefined &&
          chord.pwa === undefined,
      );
    if (!same) out[action] = chords.map((chord) => ({ ...chord }));
  }
  return out;
}

function button(className: string, focusKey: string): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = className;
  el.dataset.focusKey = focusKey;
  return el;
}

type Pending = {
  action: KeymapAction;
  chord: KeyChord;
  users: KeymapAction[];
};

export function createShortcutSettings(deps: ShortcutSettingsDeps) {
  const defaults = defaultKeyBindings(deps.mac);
  let draft: KeymapOverrides = tidyOverrides(deps.getSaved(), defaults);
  let expanded: KeymapAction | null = null;
  let recording: KeymapAction | null = null;
  let gFirst = false;
  let pending: Pending | null = null;
  let notice: { action: KeymapAction; text: string } | null = null;
  let jsonOpen = false;
  let jsonIssues: KeymapJsonIssue[] = [];
  let jsonReadError = "";
  const listeners = new Set<() => void>();

  const element = document.createElement("div");
  element.className = "scope-settings-section shortcut-settings";
  element.id = "shortcut-settings";
  const title = document.createElement("strong");
  title.className = "scope-settings-section-title";
  title.id = "shortcut-settings-title";
  const shared = document.createElement("span");
  shared.className = "scope-settings-shared";
  const titleRow = document.createElement("div");
  titleRow.className = "scope-settings-title-row";
  titleRow.append(title, shared);
  const intro = document.createElement("p");
  intro.className = "scope-settings-help";

  const toolbar = document.createElement("div");
  toolbar.className = "shortcut-toolbar";
  const filter = document.createElement("input");
  filter.type = "search";
  filter.className = "shortcut-filter";
  filter.autocomplete = "off";
  filter.spellcheck = false;
  const exportButton = button("gdp-btn gdp-btn-sm", "export");
  const importButton = button("gdp-btn gdp-btn-sm", "import");
  const jsonButton = button("gdp-btn gdp-btn-sm", "json");
  const resetAllButton = button("gdp-btn gdp-btn-sm", "reset-all");
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".json,application/json";
  fileInput.hidden = true;
  toolbar.append(
    filter,
    exportButton,
    importButton,
    jsonButton,
    resetAllButton,
    fileInput,
  );

  const jsonBox = document.createElement("div");
  jsonBox.className = "shortcut-json";
  jsonBox.hidden = true;
  const jsonLabel = document.createElement("label");
  jsonLabel.htmlFor = "shortcut-json";
  const jsonHelp = document.createElement("p");
  jsonHelp.className = "scope-settings-help";
  const jsonArea = document.createElement("textarea");
  jsonArea.id = "shortcut-json";
  jsonArea.rows = 12;
  jsonArea.spellcheck = false;
  const jsonErrors = document.createElement("ul");
  jsonErrors.className = "shortcut-json-issues";
  jsonErrors.setAttribute("role", "alert");
  jsonBox.append(jsonLabel, jsonHelp, jsonArea, jsonErrors);

  const filterEmpty = document.createElement("p");
  filterEmpty.className = "scope-settings-help shortcut-filter-empty";
  filterEmpty.hidden = true;
  const list = document.createElement("div");
  list.className = "shortcut-list";

  element.append(titleRow, intro, toolbar, jsonBox, filterEmpty, list);

  function text(): ShortcutText {
    return TEXT[deps.getLanguage()];
  }

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function bindings() {
    return resolveKeyBindings(draft, defaults);
  }

  function chordsOf(action: KeymapAction): KeyChord[] {
    return (draft[action] ?? actionChords(action, defaults)).map((chord) => ({
      ...chord,
    }));
  }

  function setChords(action: KeymapAction, chords: KeyChord[]): void {
    draft = tidyOverrides({ ...draft, [action]: chords }, defaults);
  }

  function savedJson(): string {
    return JSON.stringify(tidyOverrides(deps.getSaved(), defaults));
  }

  function draftJson(pretty = false): string {
    return JSON.stringify(draft, null, pretty ? 2 : undefined);
  }

  /** 差分が変わった (画面のどこから変えても)。一覧と JSON の欄を描き直す。 */
  function changed(): void {
    if (jsonOpen && document.activeElement !== jsonArea) {
      jsonArea.value = draftJson(true);
      jsonIssues = [];
      jsonReadError = "";
    }
    render();
    notify();
  }

  // ---------- 記録 ----------
  function stopRecording(): void {
    if (!recording) return;
    recording = null;
    document.removeEventListener("keydown", onRecordKeydown, true);
  }

  function onRecordKeydown(event: KeyboardEvent): void {
    if (!recording || isImeComposing(event)) return;
    // 記録中は 1 打鍵たりとも外へ出さない。捕捉フェーズで止めるので、アプリの
    // キー割り当てにも、ページの Escape にも届かない (Escape も割り当てられる)。
    event.preventDefault();
    event.stopPropagation();
    if (MODIFIER_KEYS.has(event.key)) return;
    const action = recording;
    stopRecording();
    offer(action, chordFromEvent(event, gFirst));
  }

  /** 押したキーを割り当てる。割り当てられない・取り合うときは画面で聞く。 */
  function offer(action: KeymapAction, chord: KeyChord): void {
    const label = chordLabel(action, chord);
    notice = null;
    pending = null;
    const reason = unassignableChord(chord, deps.mac);
    if (reason) {
      notice = { action, text: text().unassignable[reason](label) };
    } else if (
      chordsOf(action).some((item) => keyChordId(item) === keyChordId(chord))
    ) {
      notice = { action, text: text().alreadyAssigned(label) };
    } else {
      const users = chordUsers(action, chord, bindings(), defaults);
      if (users.length) pending = { action, chord, users };
      else {
        setChords(action, [...chordsOf(action), chord]);
        changed();
        return;
      }
    }
    render();
  }

  function replacePending(): void {
    if (!pending) return;
    const { action, chord, users } = pending;
    const id = keyChordId(chord);
    for (const user of users)
      setChords(
        user,
        chordsOf(user).filter((item) => keyChordId(item) !== id),
      );
    setChords(action, [...chordsOf(action), chord]);
    pending = null;
    changed();
  }

  // ---------- 描画 ----------
  function whereToggle(
    label: string,
    checked: boolean,
    focusKey: string,
    onChange: (checked: boolean) => void,
    disabled = false,
  ): HTMLLabelElement {
    const wrap = document.createElement("label");
    wrap.className = "shortcut-where";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.disabled = disabled;
    input.dataset.focusKey = focusKey;
    input.addEventListener("change", () => onChange(input.checked));
    const span = document.createElement("span");
    span.textContent = label;
    wrap.append(input, span);
    return wrap;
  }

  function renderChord(
    action: KeymapAction,
    chord: KeyChord,
    index: number,
  ): HTMLElement {
    const t = text();
    const label = chordLabel(action, chord);
    const where = chordWhere(action, chord, defaults);
    const taken = browserTabTakes(chord, deps.mac);
    const item = document.createElement("li");
    item.className = "shortcut-chord";
    const kbd = document.createElement("kbd");
    kbd.textContent = label;
    const set = (patch: Partial<KeyWhere>) => {
      const chords = chordsOf(action);
      chords[index] = withChordWhere(
        action,
        chords[index],
        { ...where, ...patch },
        defaults,
      );
      setChords(action, chords);
      changed();
    };
    const key = `${action}:${keyChordId(chord)}`;
    const wheres = document.createElement("span");
    wheres.className = "shortcut-wheres";
    wheres.append(
      whereToggle(t.whereInputs, where.inputs, `${key}:inputs`, (inputs) =>
        set({ inputs }),
      ),
      whereToggle(
        t.whereTerminal,
        where.terminal,
        `${key}:terminal`,
        (terminal) => set({ terminal }),
      ),
      whereToggle(
        t.wherePwa,
        where.pwa || taken,
        `${key}:pwa`,
        (pwa) => set({ pwa }),
        taken,
      ),
    );
    const remove = button("shortcut-chord-remove", `${key}:remove`);
    remove.textContent = "×";
    remove.setAttribute("aria-label", t.removeKey(label));
    remove.title = t.removeKey(label);
    remove.addEventListener("click", () => {
      setChords(
        action,
        chordsOf(action).filter((_, at) => at !== index),
      );
      changed();
    });
    item.append(kbd, wheres, remove);
    return item;
  }

  function renderDetail(action: KeymapAction): HTMLElement {
    const t = text();
    const detail = document.createElement("div");
    detail.className = "shortcut-row-detail";
    detail.id = `shortcut-detail-${action}`;
    const chords = chordsOf(action);
    if (chords.length) {
      const items = document.createElement("ul");
      items.className = "shortcut-chords";
      items.append(
        ...chords.map((chord, index) => renderChord(action, chord, index)),
      );
      detail.append(items);
      // ブラウザが先に取るキーの説明は行に 1 回 (キーごとに繰り返さない)。
      const taken = chords
        .filter((chord) => browserTabTakes(chord, deps.mac))
        .map((chord) => chordLabel(action, chord));
      if (taken.length) {
        const note = document.createElement("p");
        note.className = "scope-settings-help shortcut-chord-note";
        note.textContent = t.browserTakes(
          taken.join(deps.getLanguage() === "ja" ? "・" : ", "),
        );
        detail.append(note);
      }
    }
    const actions = document.createElement("div");
    actions.className = "shortcut-row-actions";
    const add = button("gdp-btn gdp-btn-sm shortcut-add", `${action}:add`);
    add.textContent = recording === action ? t.pressKey : t.addKey;
    add.setAttribute("aria-pressed", String(recording === action));
    add.addEventListener("click", () => {
      if (recording === action) {
        stopRecording();
        render();
        return;
      }
      stopRecording();
      recording = action;
      pending = null;
      notice = null;
      document.addEventListener("keydown", onRecordKeydown, true);
      render();
    });
    // フォーカスが記録のボタンから離れたら記録をやめる (押し損ねたキーが後で
    // 割り当たらないように)。
    add.addEventListener("blur", () => {
      // 描き直しでボタンが差し替わったときの blur (Chrome は外す途中の、まだ
      // 付いている要素に出す) では止めない。外し終わった後に見て、差し替えなら
      // 何もしない (フォーカスは render が新しいボタンへ戻す)。
      queueMicrotask(() => {
        if (recording !== action || !add.isConnected) return;
        stopRecording();
        render();
      });
    });
    const g = whereToggle(t.gFirst, gFirst, `${action}:g`, (checked) => {
      gFirst = checked;
    });
    g.classList.add("shortcut-gfirst");
    const restore = button("gdp-btn gdp-btn-sm", `${action}:restore`);
    restore.textContent = t.restore;
    restore.disabled = draft[action] === undefined;
    restore.addEventListener("click", () => {
      const next = { ...draft };
      delete next[action];
      draft = next;
      pending = null;
      notice = null;
      changed();
    });
    actions.append(add, g, restore);
    detail.append(actions);
    if (pending?.action === action) {
      const prompt = document.createElement("div");
      prompt.className = "shortcut-conflict";
      prompt.setAttribute("role", "alert");
      const message = document.createElement("p");
      message.textContent = t.conflict(
        chordLabel(action, pending.chord),
        pending.users
          .map((user) => actionLabel(user, deps.getLanguage()))
          .join(deps.getLanguage() === "ja" ? "」「" : ", "),
      );
      const replace = button(
        "gdp-btn gdp-btn-sm shortcut-conflict-replace",
        `${action}:replace`,
      );
      replace.textContent = t.replace;
      replace.addEventListener("click", replacePending);
      const cancel = button(
        "gdp-btn gdp-btn-sm shortcut-conflict-cancel",
        `${action}:cancel`,
      );
      cancel.textContent = t.cancel;
      cancel.addEventListener("click", () => {
        pending = null;
        render();
      });
      prompt.append(message, replace, cancel);
      detail.append(prompt);
    }
    if (notice?.action === action) {
      const note = document.createElement("p");
      note.className = "scope-settings-help shortcut-notice";
      note.setAttribute("role", "status");
      note.textContent = notice.text;
      detail.append(note);
    }
    return detail;
  }

  function renderRow(action: KeymapAction, keys: KeyLabel[]): HTMLElement {
    const t = text();
    const row = document.createElement("div");
    row.className = "shortcut-row";
    row.dataset.action = action;
    if (draft[action] !== undefined) row.dataset.changed = "true";
    const head = button("shortcut-row-head", `${action}:head`);
    head.setAttribute("aria-expanded", String(expanded === action));
    head.setAttribute("aria-controls", `shortcut-detail-${action}`);
    const name = document.createElement("span");
    name.className = "shortcut-name";
    name.textContent = actionLabel(action, deps.getLanguage());
    const mark = document.createElement("span");
    mark.className = "shortcut-changed";
    mark.textContent = draft[action] !== undefined ? t.changed : "";
    const keyList = document.createElement("span");
    keyList.className = "shortcut-keys";
    if (!keys.length) {
      const none = document.createElement("span");
      none.className = "shortcut-none";
      none.textContent = t.noKey;
      keyList.append(none);
    }
    // キーは幅をそろえた升に 1 つずつ入れる (折り返しても列がそろう)。
    for (const key of keys) {
      const cell = document.createElement("span");
      cell.className = "shortcut-key";
      const kbd = document.createElement("kbd");
      kbd.textContent = key.label;
      cell.append(kbd);
      if (key.pwa) {
        const tag = document.createElement("span");
        tag.className = "shortcut-key-pwa";
        tag.textContent = "PWA";
        tag.title = t.wherePwa;
        cell.append(tag);
      }
      keyList.append(cell);
    }
    head.append(name, mark, keyList);
    head.addEventListener("click", () => {
      stopRecording();
      pending = null;
      notice = null;
      expanded = expanded === action ? null : action;
      render();
    });
    row.append(head);
    if (expanded === action) row.append(renderDetail(action));
    return row;
  }

  type KeyLabel = { label: string; pwa: boolean };

  /** 行に出すキー。PWA の窓だけで効くキーは印を付ける (文字の後ろに足さない)。 */
  function keyLabels(action: KeymapAction): KeyLabel[] {
    return chordsOf(action).map((chord) => ({
      label: chordLabel(action, chord),
      pwa:
        chordWhere(action, chord, defaults).pwa ||
        browserTabTakes(chord, deps.mac),
    }));
  }

  function render(): void {
    const t = text();
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset
      ?.focusKey;
    const focusInside = element.contains(document.activeElement);
    const query = filter.value.trim().toLocaleLowerCase();
    let shown = 0;
    const groups: HTMLElement[] = [];
    for (const group of KEYMAP_GROUPS) {
      const rows: HTMLElement[] = [];
      for (const action of actionsInGroup(group)) {
        const keys = keyLabels(action);
        const haystack = [
          actionLabel(action, deps.getLanguage()),
          action,
          ...keys.map((key) => (key.pwa ? `${key.label} (PWA)` : key.label)),
        ]
          .join("\n")
          .toLocaleLowerCase();
        if (query && !haystack.includes(query)) continue;
        rows.push(renderRow(action, keys));
      }
      if (!rows.length) continue;
      shown += rows.length;
      const section = document.createElement("section");
      section.className = "shortcut-group";
      const heading = document.createElement("h4");
      heading.className = "shortcut-group-title";
      heading.textContent = keymapGroupTitle(group, deps.getLanguage());
      section.append(heading, ...rows);
      groups.push(section);
    }
    list.replaceChildren(...groups);
    filterEmpty.hidden = shown > 0;
    filterEmpty.textContent =
      shown > 0 ? "" : t.filterEmpty(filter.value.trim());
    renderJsonIssues();
    if (focusInside && focusKey) {
      element
        .querySelector<HTMLElement>(
          `[data-focus-key="${CSS.escape(focusKey)}"]`,
        )
        ?.focus({ preventScroll: true });
    }
  }

  function renderJsonIssues(): void {
    const t = text();
    const lines = jsonReadError
      ? [jsonReadError]
      : jsonIssues.map((issue) =>
          t.jsonIssue(issue, t.issue[issue.code](issue.detail ?? "")),
        );
    jsonErrors.replaceChildren(
      ...lines.map((line) => {
        const item = document.createElement("li");
        item.textContent = line;
        return item;
      }),
    );
    jsonErrors.hidden = lines.length === 0;
    jsonArea.setAttribute("aria-invalid", String(lines.length > 0));
  }

  // ---------- JSON ----------
  function openJson(value: string): void {
    jsonOpen = true;
    jsonBox.hidden = false;
    jsonButton.setAttribute("aria-pressed", "true");
    jsonArea.value = value;
  }

  /** JSON の欄の文字を読む。正しければ差分にする。誤りがあれば出して差分は変えない。 */
  function readJson(): void {
    jsonReadError = "";
    const result = parseKeymapJson(jsonArea.value, deps.mac);
    if ("issues" in result) jsonIssues = result.issues;
    else {
      jsonIssues = [];
      draft = tidyOverrides(result.value, defaults);
      pending = null;
      notice = null;
    }
    render();
    notify();
  }

  function applyText(): void {
    const t = text();
    const tag = deps.getSharedTag();
    title.textContent = t.title;
    shared.textContent = tag.text;
    shared.title = tag.title;
    intro.textContent = t.intro;
    filter.placeholder = t.filterPlaceholder;
    filter.setAttribute("aria-label", t.filterPlaceholder);
    exportButton.textContent = t.exportJson;
    importButton.textContent = t.importJson;
    jsonButton.textContent = t.editJson;
    resetAllButton.textContent = t.resetAll;
    jsonLabel.textContent = t.jsonLabel;
    jsonHelp.textContent = t.jsonHelp;
  }

  filter.addEventListener("input", render);
  exportButton.addEventListener("click", () => {
    deps.download("code-viewer-shortcuts.json", `${draftJson(true)}\n`);
  });
  importButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    void file.text().then(
      (content) => {
        openJson(content);
        readJson();
      },
      (error: unknown) => {
        console.error("[code-viewer] shortcut import failed", error);
        openJson(jsonArea.value || draftJson(true));
        jsonReadError = text().importFailed(formatErrorDetail(error));
        render();
      },
    );
  });
  jsonButton.addEventListener("click", () => {
    if (jsonOpen) {
      // 誤りのある間は閉じても直す所を失わないよう、開いたままにする。
      if (jsonIssues.length) return;
      jsonOpen = false;
      jsonBox.hidden = true;
      jsonButton.setAttribute("aria-pressed", "false");
      jsonReadError = "";
      render();
      return;
    }
    openJson(draftJson(true));
    jsonArea.focus();
  });
  jsonArea.addEventListener("input", readJson);
  resetAllButton.addEventListener("click", () => {
    const t = text();
    void showConfirmDialog({
      title: t.resetAllTitle,
      body: t.resetAllBody,
      confirmLabel: t.resetAllConfirm,
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      draft = {};
      pending = null;
      notice = null;
      changed();
    });
  });
  jsonButton.setAttribute("aria-pressed", "false");

  const draftHandle: SettingsDraft = {
    dirty: () => draftJson() !== savedJson(),
    problem: () =>
      jsonOpen && (jsonIssues.length || jsonReadError) ? text().problem : null,
    async save() {
      const next = draft;
      await deps.save(next);
      draft = tidyOverrides(deps.getSaved(), defaults);
      render();
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
    },
  };

  /** 保存してある値へ合わせる (変えている途中なら変えない)。 */
  function refresh(): void {
    if (!draftHandle.dirty() && !(jsonOpen && jsonIssues.length)) {
      draft = tidyOverrides(deps.getSaved(), defaults);
      if (jsonOpen && document.activeElement !== jsonArea)
        jsonArea.value = draftJson(true);
    }
    render();
  }

  function localize(): void {
    applyText();
    render();
  }

  applyText();
  render();
  return { element, draft: draftHandle, refresh, localize };
}
