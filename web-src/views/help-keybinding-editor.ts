// Help ページのキー一覧に「変更」を足す層。表そのものは help-page.ts が
// 組み、ここは行にボタンを差し、記録ダイアログを出し、差分を保存する。
//
// ユーザーが編集できるのは押し方だけで、scope や「入力欄でも効くか」は
// デフォルト定義から引き継ぐ (core/keymap.ts の resolveKeyBindings)。

import { isImeComposing } from "../core/keyboard";
import {
  DEFAULT_KEY_BINDINGS,
  findKeymapConflicts,
  type KeyBinding,
  type KeyChord,
  keyChordId,
  keyChordOf,
  type KeymapAction,
  type KeymapOverrides,
  resolveKeyBindings,
  sanitizeKeymapOverrides,
} from "../core/keymap";
import {
  formatKeyBinding,
  type HelpKeybindingLanguage,
  type HelpKeybindingTableGroup,
} from "./help-keybindings";
import { showFormDialog } from "./ui-dialog";

export type HelpKeybindingEditorDeps = {
  getLanguage(): HelpKeybindingLanguage;
  getOverrides(): KeymapOverrides;
  saveOverrides(next: KeymapOverrides): void;
  /** 保存後に Help を描き直してもらう */
  onChanged(): void;
};

type EditorText = {
  change: string;
  changed: string;
  dialogTitle: string;
  addKey: string;
  pressKey: string;
  removeKey: string;
  gPrefix: string;
  disabled: string;
  defaultLabel: (keys: string) => string;
  restore: string;
  conflict: (keys: string, actions: string) => string;
  save: string;
  cancel: string;
  resetAll: string;
  editJson: string;
  jsonTitle: string;
  jsonHelp: string;
  jsonInvalid: string;
};

const EDITOR_TEXT: Record<HelpKeybindingLanguage, EditorText> = {
  en: {
    change: "Change",
    changed: "changed",
    dialogTitle: "Change keys",
    addKey: "Add a key",
    pressKey: "Press a key…",
    removeKey: "Remove",
    gPrefix: "Press g first",
    disabled: "No key assigned",
    defaultLabel: (keys) => `Default: ${keys}`,
    restore: "Restore default",
    conflict: (keys, actions) => `${keys} is also assigned to ${actions}`,
    save: "Save",
    cancel: "Cancel",
    resetAll: "Restore all default keys",
    editJson: "Edit as JSON",
    jsonTitle: "Changed keys",
    jsonHelp:
      "Only the actions you changed are listed. An empty list disables that action.",
    jsonInvalid: "That is not valid JSON.",
  },
  ja: {
    change: "変更",
    changed: "変更済み",
    dialogTitle: "キーを変更",
    addKey: "キーを追加",
    pressKey: "キーを押してください…",
    removeKey: "削除",
    gPrefix: "先に g を押す",
    disabled: "割り当てなし",
    defaultLabel: (keys) => `デフォルト: ${keys}`,
    restore: "デフォルトに戻す",
    conflict: (keys, actions) => `${keys} は ${actions} にも割り当て済みです`,
    save: "保存",
    cancel: "キャンセル",
    resetAll: "すべてのキーをデフォルトに戻す",
    editJson: "JSON で編集",
    jsonTitle: "変更したキー",
    jsonHelp:
      "変更したアクションだけが並びます。空のリストはそのアクションを無効にします。",
    jsonInvalid: "JSON として読めません。",
  },
};

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

function chordFromEvent(event: KeyboardEvent): KeyChord {
  const chord: KeyChord = { key: event.key.toLowerCase() };
  if (event.ctrlKey) chord.ctrl = true;
  if (event.metaKey) chord.meta = true;
  if (event.altKey) chord.alt = true;
  if (event.shiftKey) chord.shift = true;
  return chord;
}

function chordLabel(action: KeymapAction, chord: KeyChord): string {
  return formatKeyBinding({ action, ...chord });
}

function chordsForAction(
  bindings: KeyBinding[],
  action: KeymapAction,
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

function defaultLabelFor(action: KeymapAction): string {
  const chords = chordsForAction(DEFAULT_KEY_BINDINGS, action);
  return chords.map((chord) => chordLabel(action, chord)).join(" / ");
}

export function createHelpKeybindingEditor(deps: HelpKeybindingEditorDeps) {
  function text(): EditorText {
    return EDITOR_TEXT[deps.getLanguage()];
  }

  /** 編集中の値で衝突を数え直す。保存は止めず、注意だけ出す。 */
  function conflictsFor(
    draft: KeymapOverrides,
    actions: KeymapAction[],
  ): string[] {
    const bindings = resolveKeyBindings(draft);
    const messages: string[] = [];
    const seen = new Set<string>();
    for (const conflict of findKeymapConflicts(bindings)) {
      const mine = conflict.actions.filter((action) =>
        actions.includes(action),
      );
      if (!mine.length) continue;
      const others = conflict.actions.filter(
        (action) => !actions.includes(action),
      );
      if (!others.length) continue;
      const keys = chordLabel(mine[0], conflict.chord);
      const message = text().conflict(keys, others.join(", "));
      if (seen.has(message)) continue;
      seen.add(message);
      messages.push(message);
    }
    return messages;
  }

  function buildActionEditor(
    action: KeymapAction,
    draft: KeymapOverrides,
    onDraftChange: () => void,
  ): HTMLElement {
    const wrap = document.createElement("section");
    wrap.className = "gdp-kbe-action";

    const heading = document.createElement("div");
    heading.className = "gdp-kbe-action-head";
    const name = document.createElement("strong");
    name.textContent = action;
    const fallback = document.createElement("span");
    fallback.className = "gdp-kbe-default";
    fallback.textContent = text().defaultLabel(defaultLabelFor(action));
    heading.append(name, fallback);

    const chips = document.createElement("div");
    chips.className = "gdp-kbe-chips";

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "gdp-btn gdp-btn-sm";

    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "gdp-btn gdp-btn-sm";
    restore.textContent = text().restore;

    const gPrefix = document.createElement("label");
    gPrefix.className = "gdp-kbe-gprefix";
    const gInput = document.createElement("input");
    gInput.type = "checkbox";
    const gText = document.createElement("span");
    gText.textContent = text().gPrefix;
    gPrefix.append(gInput, gText);

    function currentChords(): KeyChord[] {
      const override = draft[action];
      if (override) return override;
      return chordsForAction(DEFAULT_KEY_BINDINGS, action);
    }

    function setChords(next: KeyChord[]): void {
      draft[action] = next;
      renderChips();
      onDraftChange();
    }

    function renderChips(): void {
      chips.replaceChildren();
      const chords = currentChords();
      if (!chords.length) {
        const empty = document.createElement("span");
        empty.className = "gdp-kbe-empty";
        empty.textContent = text().disabled;
        chips.appendChild(empty);
      }
      chords.forEach((chord, index) => {
        const chip = document.createElement("span");
        chip.className = "gdp-kbe-chip";
        const kbd = document.createElement("kbd");
        kbd.textContent = chordLabel(action, chord);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "gdp-kbe-chip-remove";
        remove.setAttribute("aria-label", text().removeKey);
        remove.textContent = "×";
        remove.addEventListener("click", () => {
          const next = currentChords().slice();
          next.splice(index, 1);
          setChords(next);
        });
        chip.append(kbd, remove);
        chips.appendChild(chip);
      });
      addButton.textContent = text().addKey;
    }

    let capturing = false;
    function capture(): void {
      if (capturing) return;
      capturing = true;
      addButton.textContent = text().pressKey;
      const onKeydown = (event: KeyboardEvent) => {
        if (isImeComposing(event)) return;
        // 記録中は 1 打鍵たりとも外へ出さない。捕捉フェーズで止めるので、
        // ダイアログの Escape / Enter 処理にも、アプリのキーマップにも
        // 届かない。Escape そのものを割り当てられるのはこのため。
        event.preventDefault();
        event.stopPropagation();
        if (MODIFIER_KEYS.has(event.key)) return;
        document.removeEventListener("keydown", onKeydown, true);
        capturing = false;
        const chord = chordFromEvent(event);
        if (gInput.checked) chord.pendingG = true;
        const next = currentChords().slice();
        if (!next.some((item) => keyChordId(item) === keyChordId(chord)))
          next.push(chord);
        setChords(next);
      };
      document.addEventListener("keydown", onKeydown, true);
    }

    addButton.addEventListener("click", capture);
    restore.addEventListener("click", () => {
      delete draft[action];
      renderChips();
      onDraftChange();
    });

    const actions = document.createElement("div");
    actions.className = "gdp-kbe-action-buttons";
    actions.append(addButton, restore);

    renderChips();
    wrap.append(heading, chips, gPrefix, actions);
    return wrap;
  }

  async function openDialog(
    title: string,
    actions: KeymapAction[],
  ): Promise<void> {
    const draft: KeymapOverrides = { ...deps.getOverrides() };
    const body = document.createElement("div");
    body.className = "gdp-kbe-dialog";
    const warnings = document.createElement("div");
    warnings.className = "gdp-kbe-warnings";
    warnings.setAttribute("role", "status");

    function refreshWarnings(): void {
      const messages = conflictsFor(draft, actions);
      warnings.replaceChildren();
      for (const message of messages) {
        const line = document.createElement("p");
        line.textContent = message;
        warnings.appendChild(line);
      }
    }

    for (const action of actions)
      body.appendChild(buildActionEditor(action, draft, refreshWarnings));
    body.appendChild(warnings);
    refreshWarnings();

    const saved = await showFormDialog<KeymapOverrides>({
      title,
      body,
      submitLabel: text().save,
      cancelLabel: text().cancel,
      submit: () => draft,
    });
    if (!saved) return;
    deps.saveOverrides(sanitizeKeymapOverrides(saved));
    deps.onChanged();
  }

  function buildToolbar(): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "gdp-kbe-toolbar";

    const resetAll = document.createElement("button");
    resetAll.type = "button";
    resetAll.className = "gdp-btn gdp-btn-sm";
    resetAll.textContent = text().resetAll;
    resetAll.addEventListener("click", () => {
      deps.saveOverrides({});
      deps.onChanged();
    });

    const json = document.createElement("button");
    json.type = "button";
    json.className = "gdp-btn gdp-btn-sm";
    json.textContent = text().editJson;
    json.addEventListener("click", () => void openJsonDialog());

    bar.append(resetAll, json);
    return bar;
  }

  async function openJsonDialog(): Promise<void> {
    const body = document.createElement("div");
    body.className = "gdp-kbe-json";
    const help = document.createElement("p");
    help.className = "scope-settings-help";
    help.textContent = text().jsonHelp;
    const area = document.createElement("textarea");
    area.rows = 14;
    area.spellcheck = false;
    area.value = JSON.stringify(deps.getOverrides(), null, 2);
    body.append(help, area);

    const saved = await showFormDialog<KeymapOverrides>({
      title: text().jsonTitle,
      body,
      submitLabel: text().save,
      cancelLabel: text().cancel,
      focusTarget: area,
      validate: () => {
        try {
          JSON.parse(area.value || "{}");
          return null;
        } catch {
          return text().jsonInvalid;
        }
      },
      submit: () => sanitizeKeymapOverrides(JSON.parse(area.value || "{}")),
    });
    if (!saved) return;
    deps.saveOverrides(saved);
    deps.onChanged();
  }

  /**
   * 表の各行に変更ボタンを足し、末尾にツールバーを置く。行とアクションの
   * 対応は help-page.ts から渡ってくる groups の並びで引く。
   */
  function decorate(
    article: HTMLElement,
    groups: HelpKeybindingTableGroup[],
  ): void {
    const overrides = deps.getOverrides();
    const sections = Array.from(
      article.querySelectorAll<HTMLElement>(".gdp-help-keybinding-group"),
    );
    sections.forEach((section, groupIndex) => {
      const group = groups[groupIndex];
      if (!group) return;
      const rows = Array.from(
        section.querySelectorAll<HTMLTableRowElement>("table tr"),
      );
      rows.forEach((row, rowIndex) => {
        const actions = group.rowActions[rowIndex];
        if (!actions?.length) return;
        const cell = document.createElement("td");
        cell.className = "gdp-help-keybinding-actions";
        if (actions.some((action) => overrides[action] !== undefined)) {
          const mark = document.createElement("span");
          mark.className = "gdp-kbe-changed";
          mark.textContent = text().changed;
          cell.appendChild(mark);
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = "gdp-btn gdp-btn-sm";
        button.textContent = text().change;
        const title = row.cells[1]?.textContent || text().dialogTitle;
        button.addEventListener("click", () => void openDialog(title, actions));
        cell.appendChild(button);
        row.appendChild(cell);
      });
    });
    article.appendChild(buildToolbar());
  }

  return { decorate };
}
