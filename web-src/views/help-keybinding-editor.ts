// 設定のページの「ショートカット」の節。アプリの操作を全部並べ、
// 操作ごとにキーを足す・外す・効く所 (入力欄・端末・PWA の窓) を選ぶ・既定に
// 戻す。JSON の書き出し・読み込み・直接編集もここ。保存はページの「変更を保存」
// 1 つ (SettingsDraft。節の中に「保存」を置かない。ui-surface.md の設定の節)。
//
// 操作の名前と分類は help-keybindings.ts の表 (ヘルプの一覧と同じもの)、
// キーの決まり (既定・効く所・取り合い) は core/keymap.ts、窓のキーは core/pwa.ts。

import { ifDefined } from "lit/directives/if-defined.js";
import { live } from "lit/directives/live.js";
import { repeat } from "lit/directives/repeat.js";
import { html, nothing, type TemplateResult } from "lit/html.js";
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
import { renderOwned, templateElement } from "./ui/renderer";
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

export type ShortcutText = {
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
  /** 1 つが 1 段落。 */
  jsonHelp: readonly string[];
  jsonIssue: (issue: KeymapJsonIssue, message: string) => string;
  issue: Record<KeymapJsonIssueCode, (detail: string) => string>;
  importFailed: (detail: string) => string;
  problem: string;
  changed: string;
  noKey: string;
  /** 分類ごとの見出しの行の、キーの列の名前。 */
  keysColumn: string;
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

export const SHORTCUT_SETTINGS_TEXT: Record<
  HelpKeybindingLanguage,
  ShortcutText
> = {
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
    jsonHelp: [
      'Only the actions you changed are listed, each with its keys, for example "toggle-theme": [{ "key": "t", "ctrl": true }]. An empty list turns the action off.',
      '"inputs", "terminal" and "pwa" (true or false) set where a key works. Nothing is saved while the JSON has a mistake.',
    ],
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
    keysColumn: "Keys",
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
    jsonHelp: [
      '変えた操作だけが、キーのリストと一緒に並びます (例: "toggle-theme": [{ "key": "t", "ctrl": true }])。空のリストはその操作を止めます。',
      '"inputs"・"terminal"・"pwa" (true か false) でキーの効く所を決めます。JSON に誤りがある間は保存しません。',
    ],
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
    keysColumn: "キー",
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

type Pending = {
  action: KeymapAction;
  chord: KeyChord;
  users: KeymapAction[];
};

type KeyLabel = { label: string; pwa: boolean };

type Toggle = {
  /** 描き直しの後にフォーカスを戻す先の名前。 */
  focusKey: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange(checked: boolean): void;
};

type Button = { focusKey: string; label: string; onClick(): void };

/** 開いた行の中身 (キーごとの効く所・足す・既定に戻す・取り合いの確認)。 */
export type ShortcutDetailProps = {
  action: KeymapAction;
  chords: {
    id: string;
    label: string;
    wheres: Toggle[];
    remove: Button & { title: string };
  }[];
  browserNote: string | null;
  add: Button & {
    pressed: boolean;
    /** フォーカスが離れた (記録をやめるか、presenter が決める)。 */
    onBlur(button: HTMLElement): void;
  };
  gFirst: Toggle;
  restore: Button & { disabled: boolean };
  conflict: { message: string; replace: Button; cancel: Button } | null;
  notice: string | null;
};

export type ShortcutRowProps = {
  action: KeymapAction;
  label: string;
  changed: string | null;
  keys: KeyLabel[];
  noKey: string;
  pwaTitle: string;
  expanded: boolean;
  onToggle(): void;
  detail: ShortcutDetailProps | null;
};

export type ShortcutSettingsProps = {
  title: string;
  shared: { text: string; title: string };
  intro: string;
  filter: { placeholder: string; value: string; onInput(value: string): void };
  exportJson: Button;
  /** 押すとファイルを選ぶ欄を開く (選んだファイルは onImportFile)。 */
  importJson: { focusKey: string; label: string };
  editJson: Button & { pressed: boolean };
  resetAll: Button;
  onImportFile(input: HTMLInputElement): void;
  json: {
    open: boolean;
    label: string;
    help: readonly string[];
    text: string;
    issues: string[];
    onInput(value: string): void;
  };
  /** 絞り込みで何も残らないときの文 (残れば null)。 */
  empty: string | null;
  groups: {
    key: string;
    title: string;
    keysColumn: string;
    rows: ShortcutRowProps[];
  }[];
};

export type ShortcutSettingsView = (props: ShortcutSettingsProps) => unknown;

function toggleTemplate(toggle: Toggle, className = ""): TemplateResult {
  return html`<label
    class=${className ? `shortcut-where ${className}` : "shortcut-where"}
    ><input
      type="checkbox"
      data-focus-key=${toggle.focusKey}
      ?disabled=${toggle.disabled === true}
      .checked=${live(toggle.checked)}
      @change=${(event: Event) =>
        toggle.onChange((event.currentTarget as HTMLInputElement).checked)}
    /><span>${toggle.label}</span></label
  >`;
}

function buttonTemplate(button: Button, className: string): TemplateResult {
  return html`<button
    type="button"
    class=${className}
    data-focus-key=${button.focusKey}
    @click=${button.onClick}
  >${button.label}</button>`;
}

function detailTemplate(detail: ShortcutDetailProps): TemplateResult {
  return html`<div class="shortcut-row-detail" id=${`shortcut-detail-${detail.action}`}>${
    detail.chords.length
      ? html`<ul class="shortcut-chords">${repeat(
          detail.chords,
          (chord) => chord.id,
          (
            chord,
          ) => html`<li class="shortcut-chord"><kbd>${chord.label}</kbd><span
              class="shortcut-wheres"
              >${chord.wheres.map((where) => toggleTemplate(where))}</span
            ><button
              type="button"
              class="shortcut-chord-remove"
              data-focus-key=${chord.remove.focusKey}
              aria-label=${chord.remove.title}
              title=${chord.remove.title}
              @click=${chord.remove.onClick}
            >×</button></li>`,
        )}</ul>${
          detail.browserNote
            ? html`<p class="scope-settings-help shortcut-chord-note">${detail.browserNote}</p>`
            : nothing
        }`
      : nothing
  }<div class="shortcut-row-actions"><button
      type="button"
      class="gdp-btn gdp-btn-sm shortcut-add"
      data-focus-key=${detail.add.focusKey}
      aria-pressed=${String(detail.add.pressed)}
      @click=${detail.add.onClick}
      @blur=${(event: FocusEvent) =>
        detail.add.onBlur(event.currentTarget as HTMLElement)}
    >${detail.add.label}</button>${toggleTemplate(detail.gFirst, "shortcut-gfirst")}<button
      type="button"
      class="gdp-btn gdp-btn-sm"
      data-focus-key=${detail.restore.focusKey}
      ?disabled=${detail.restore.disabled}
      @click=${detail.restore.onClick}
    >${detail.restore.label}</button></div>${
      detail.conflict
        ? html`<div class="shortcut-conflict" role="alert"><p>${detail.conflict.message}</p>${buttonTemplate(
            detail.conflict.replace,
            "gdp-btn gdp-btn-sm shortcut-conflict-replace",
          )}${buttonTemplate(
            detail.conflict.cancel,
            "gdp-btn gdp-btn-sm shortcut-conflict-cancel",
          )}</div>`
        : nothing
    }${
      detail.notice
        ? html`<p class="scope-settings-help shortcut-notice" role="status">${detail.notice}</p>`
        : nothing
    }</div>`;
}

function rowTemplate(row: ShortcutRowProps): TemplateResult {
  // キーは幅をそろえた升に 1 つずつ入れる (折り返しても列がそろう)。
  return html`<div
    class="shortcut-row ui-table-row"
    data-action=${row.action}
    data-changed=${ifDefined(row.changed !== null ? "true" : undefined)}
  ><button
    type="button"
    class="shortcut-row-head"
    data-focus-key=${`${row.action}:head`}
    aria-expanded=${String(row.expanded)}
    aria-controls=${`shortcut-detail-${row.action}`}
    @click=${row.onToggle}
  ><span class="shortcut-name">${row.label}</span><span class="shortcut-changed"
      >${row.changed ?? ""}</span
    ><span class="shortcut-keys">${
      row.keys.length
        ? nothing
        : html`<span class="shortcut-none">${row.noKey}</span>`
    }${row.keys.map(
      (key) =>
        html`<span class="shortcut-key"><kbd>${key.label}</kbd>${
          key.pwa
            ? html`<span class="shortcut-key-pwa" title=${row.pwaTitle}>PWA</span>`
            : nothing
        }</span>`,
    )}</span></button>${row.detail ? detailTemplate(row.detail) : nothing}</div>`;
}

export const DEFAULT_VIEW: ShortcutSettingsView = (props) => html`<div
    class="scope-settings-title-row"
  ><strong class="scope-settings-section-title" id="shortcut-settings-title"
      >${props.title}</strong
    ><span class="scope-settings-shared" title=${props.shared.title}
      >${props.shared.text}</span
    ></div
  ><p class="scope-settings-help">${props.intro}</p><div class="shortcut-toolbar"><input
      type="search"
      class="shortcut-filter"
      autocomplete="off"
      spellcheck="false"
      placeholder=${props.filter.placeholder}
      aria-label=${props.filter.placeholder}
      .value=${live(props.filter.value)}
      @input=${(event: Event) =>
        props.filter.onInput((event.currentTarget as HTMLInputElement).value)}
    />${buttonTemplate(props.exportJson, "gdp-btn gdp-btn-sm")}<button
      type="button"
      class="gdp-btn gdp-btn-sm"
      data-focus-key=${props.importJson.focusKey}
      @click=${(event: MouseEvent) =>
        (event.currentTarget as HTMLElement).parentElement
          ?.querySelector<HTMLInputElement>("input[type=file]")
          ?.click()}
    >${props.importJson.label}</button><button
      type="button"
      class="gdp-btn gdp-btn-sm"
      data-focus-key=${props.editJson.focusKey}
      aria-pressed=${String(props.editJson.pressed)}
      @click=${props.editJson.onClick}
    >${props.editJson.label}</button>${buttonTemplate(props.resetAll, "gdp-btn gdp-btn-sm")}<input
      type="file"
      accept=".json,application/json"
      hidden
      @change=${(event: Event) =>
        props.onImportFile(event.currentTarget as HTMLInputElement)}
    /></div
  ><div class="shortcut-json" ?hidden=${!props.json.open}><label for="shortcut-json"
      >${props.json.label}</label
    ><div>${props.json.help.map(
      (paragraph) => html`<p class="scope-settings-help">${paragraph}</p>`,
    )}</div><textarea
      id="shortcut-json"
      rows="12"
      spellcheck="false"
      aria-invalid=${String(props.json.issues.length > 0)}
      .value=${live(props.json.text)}
      @input=${(event: Event) =>
        props.json.onInput((event.currentTarget as HTMLTextAreaElement).value)}
    ></textarea><ul
      class="shortcut-json-issues"
      role="alert"
      ?hidden=${props.json.issues.length === 0}
    >${props.json.issues.map((line) => html`<li>${line}</li>`)}</ul></div
  ><p class="scope-settings-help shortcut-filter-empty" ?hidden=${props.empty === null}
    >${props.empty ?? ""}</p
  ><div class="shortcut-list">${repeat(
    props.groups,
    (group) => group.key,
    // 見出しの行: 分類の名前と、キーの列の名前 (行と同じ列の組み)。
    (group) => html`<section class="shortcut-group"><div
        class="shortcut-group-head ui-table-head"
      ><h4 class="shortcut-group-title">${group.title}</h4><span></span><span
          class="shortcut-group-keys"
          >${group.keysColumn}</span
        ></div
      >${repeat(
        group.rows,
        (row) => row.action,
        (row) => rowTemplate(row),
      )}</section>`,
  )}</div>`;

export function createShortcutSettings(
  deps: ShortcutSettingsDeps,
  view: ShortcutSettingsView = DEFAULT_VIEW,
) {
  const defaults = defaultKeyBindings(deps.mac);
  let draft: KeymapOverrides = tidyOverrides(deps.getSaved(), defaults);
  let expanded: KeymapAction | null = null;
  let recording: KeymapAction | null = null;
  let gFirst = false;
  let pending: Pending | null = null;
  let notice: { action: KeymapAction; text: string } | null = null;
  let jsonOpen = false;
  let jsonText = "";
  let jsonIssues: KeymapJsonIssue[] = [];
  let jsonReadError = "";
  let query = "";
  const listeners = new Set<() => void>();

  // 節の箱。設定のページが置き、中はここが描く。
  const element = templateElement(
    html`<div
      class="scope-settings-section shortcut-settings"
      id="shortcut-settings"
    ></div>`,
  );

  function text(): ShortcutText {
    return SHORTCUT_SETTINGS_TEXT[deps.getLanguage()];
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

  function jsonArea(): HTMLTextAreaElement | null {
    return element.querySelector<HTMLTextAreaElement>("#shortcut-json");
  }

  /** 差分が変わった (画面のどこから変えても)。一覧と JSON の欄を描き直す。 */
  function changed(): void {
    if (jsonOpen && document.activeElement !== jsonArea()) {
      jsonText = draftJson(true);
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
  function chordProps(
    action: KeymapAction,
    chord: KeyChord,
    index: number,
  ): ShortcutDetailProps["chords"][number] {
    const t = text();
    const label = chordLabel(action, chord);
    const where = chordWhere(action, chord, defaults);
    const taken = browserTabTakes(chord, deps.mac);
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
    return {
      id: keyChordId(chord),
      label,
      wheres: [
        {
          focusKey: `${key}:inputs`,
          label: t.whereInputs,
          checked: where.inputs,
          onChange: (inputs) => set({ inputs }),
        },
        {
          focusKey: `${key}:terminal`,
          label: t.whereTerminal,
          checked: where.terminal,
          onChange: (terminal) => set({ terminal }),
        },
        {
          focusKey: `${key}:pwa`,
          label: t.wherePwa,
          checked: where.pwa || taken,
          disabled: taken,
          onChange: (pwa) => set({ pwa }),
        },
      ],
      remove: {
        focusKey: `${key}:remove`,
        label: "×",
        title: t.removeKey(label),
        onClick: () => {
          setChords(
            action,
            chordsOf(action).filter((_, at) => at !== index),
          );
          changed();
        },
      },
    };
  }

  function detailProps(action: KeymapAction): ShortcutDetailProps {
    const t = text();
    const chords = chordsOf(action);
    // ブラウザが先に取るキーの説明は行に 1 回 (キーごとに繰り返さない)。
    const taken = chords
      .filter((chord) => browserTabTakes(chord, deps.mac))
      .map((chord) => chordLabel(action, chord));
    const ja = deps.getLanguage() === "ja";
    return {
      action,
      chords: chords.map((chord, index) => chordProps(action, chord, index)),
      browserNote: taken.length
        ? t.browserTakes(taken.join(ja ? "・" : ", "))
        : null,
      add: {
        focusKey: `${action}:add`,
        label: recording === action ? t.pressKey : t.addKey,
        pressed: recording === action,
        onClick: () => {
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
        },
        onBlur: (add) => {
          // フォーカスが記録のボタンから離れたら記録をやめる (押し損ねたキーが後で
          // 割り当たらないように)。描き直しでボタンが外れたときの blur (Chrome は
          // 外す途中の、まだ付いている要素に出す) では止めない。
          queueMicrotask(() => {
            if (recording !== action || !add.isConnected) return;
            stopRecording();
            render();
          });
        },
      },
      gFirst: {
        focusKey: `${action}:g`,
        label: t.gFirst,
        checked: gFirst,
        onChange: (checked) => {
          gFirst = checked;
        },
      },
      restore: {
        focusKey: `${action}:restore`,
        label: t.restore,
        disabled: draft[action] === undefined,
        onClick: () => {
          const next = { ...draft };
          delete next[action];
          draft = next;
          pending = null;
          notice = null;
          changed();
        },
      },
      conflict:
        pending?.action === action
          ? {
              message: t.conflict(
                chordLabel(action, pending.chord),
                pending.users
                  .map((user) => actionLabel(user, deps.getLanguage()))
                  .join(ja ? "」「" : ", "),
              ),
              replace: {
                focusKey: `${action}:replace`,
                label: t.replace,
                onClick: replacePending,
              },
              cancel: {
                focusKey: `${action}:cancel`,
                label: t.cancel,
                onClick: () => {
                  pending = null;
                  render();
                },
              },
            }
          : null,
      notice: notice?.action === action ? notice.text : null,
    };
  }

  function rowProps(action: KeymapAction, keys: KeyLabel[]): ShortcutRowProps {
    const t = text();
    const changedAction = draft[action] !== undefined;
    return {
      action,
      label: actionLabel(action, deps.getLanguage()),
      changed: changedAction ? t.changed : null,
      keys,
      noKey: t.noKey,
      pwaTitle: t.wherePwa,
      expanded: expanded === action,
      onToggle: () => {
        stopRecording();
        pending = null;
        notice = null;
        expanded = expanded === action ? null : action;
        render();
      },
      detail: expanded === action ? detailProps(action) : null,
    };
  }

  /** 行に出すキー。PWA の窓だけで効くキーは印を付ける (文字の後ろに足さない)。 */
  function keyLabels(action: KeymapAction): KeyLabel[] {
    return chordsOf(action).map((chord) => ({
      label: chordLabel(action, chord),
      pwa:
        chordWhere(action, chord, defaults).pwa ||
        browserTabTakes(chord, deps.mac),
    }));
  }

  function viewProps(): ShortcutSettingsProps {
    const t = text();
    const tag = deps.getSharedTag();
    const needle = query.trim().toLocaleLowerCase();
    let shown = 0;
    const groups: ShortcutSettingsProps["groups"] = [];
    for (const group of KEYMAP_GROUPS) {
      const rows: ShortcutRowProps[] = [];
      for (const action of actionsInGroup(group)) {
        const keys = keyLabels(action);
        const haystack = [
          actionLabel(action, deps.getLanguage()),
          action,
          ...keys.map((key) => (key.pwa ? `${key.label} (PWA)` : key.label)),
        ]
          .join("\n")
          .toLocaleLowerCase();
        if (needle && !haystack.includes(needle)) continue;
        rows.push(rowProps(action, keys));
      }
      if (!rows.length) continue;
      shown += rows.length;
      groups.push({
        key: group,
        title: keymapGroupTitle(group, deps.getLanguage()),
        keysColumn: t.keysColumn,
        rows,
      });
    }
    return {
      title: t.title,
      shared: { text: tag.text, title: tag.title },
      intro: t.intro,
      filter: {
        placeholder: t.filterPlaceholder,
        value: query,
        onInput: (value) => {
          query = value;
          render();
        },
      },
      exportJson: {
        focusKey: "export",
        label: t.exportJson,
        onClick: () => {
          deps.download("code-viewer-shortcuts.json", `${draftJson(true)}\n`);
        },
      },
      importJson: { focusKey: "import", label: t.importJson },
      editJson: {
        focusKey: "json",
        label: t.editJson,
        pressed: jsonOpen,
        onClick: toggleJson,
      },
      resetAll: { focusKey: "reset-all", label: t.resetAll, onClick: resetAll },
      onImportFile: importFile,
      json: {
        open: jsonOpen,
        label: t.jsonLabel,
        help: t.jsonHelp,
        text: jsonText,
        issues: jsonReadError
          ? [jsonReadError]
          : jsonIssues.map((issue) =>
              t.jsonIssue(issue, t.issue[issue.code](issue.detail ?? "")),
            ),
        onInput: (value) => {
          jsonText = value;
          readJson();
        },
      },
      empty: shown > 0 ? null : t.filterEmpty(query.trim()),
      groups,
    };
  }

  function render(): void {
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset
      ?.focusKey;
    const focusInside = element.contains(document.activeElement);
    renderOwned(element, view(viewProps()));
    // 押したボタンが描き直しで外れた (行を畳んだなど) ときは、同じ役のボタンへ戻す。
    if (focusInside && focusKey && !element.contains(document.activeElement)) {
      element
        .querySelector<HTMLElement>(
          `[data-focus-key="${CSS.escape(focusKey)}"]`,
        )
        ?.focus({ preventScroll: true });
    }
  }

  // ---------- JSON ----------
  function openJson(value: string): void {
    jsonOpen = true;
    jsonText = value;
  }

  /** JSON の欄の文字を読む。正しければ差分にする。誤りがあれば出して差分は変えない。 */
  function readJson(): void {
    jsonReadError = "";
    const result = parseKeymapJson(jsonText, deps.mac);
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

  function importFile(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    void file.text().then(
      (content) => {
        openJson(content);
        readJson();
      },
      (error: unknown) => {
        console.error("[code-viewer] shortcut import failed", error);
        openJson(jsonText || draftJson(true));
        jsonReadError = text().importFailed(formatErrorDetail(error));
        render();
      },
    );
  }

  function toggleJson(): void {
    if (jsonOpen) {
      // 誤りのある間は閉じても直す所を失わないよう、開いたままにする。
      if (jsonIssues.length) return;
      jsonOpen = false;
      jsonReadError = "";
      render();
      return;
    }
    openJson(draftJson(true));
    render();
    jsonArea()?.focus();
  }

  function resetAll(): void {
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
  }

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
      if (jsonOpen && document.activeElement !== jsonArea())
        jsonText = draftJson(true);
    }
    render();
  }

  render();
  return { element, draft: draftHandle, refresh, localize: render };
}
