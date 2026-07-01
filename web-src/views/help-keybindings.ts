import {
  DEFAULT_KEY_BINDINGS,
  type KeyBinding,
  type KeymapAction,
  type KeymapScope,
} from "../core/keymap";

export type HelpKeybindingLanguage = "en" | "ja";

export type HelpKeybindingTableGroup = {
  title: string;
  rows: Array<[string, string]>;
};

type HelpText = Record<HelpKeybindingLanguage, string>;

type HelpKeybindingSelector = {
  action: KeymapAction;
  key?: string;
  scope?: KeymapScope;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
  pendingG?: boolean;
};

type HelpKeybindingDisplayRow = {
  selectors: HelpKeybindingSelector[];
  description: HelpText;
};

type HelpKeybindingDisplayGroup = {
  title: HelpText;
  rows: HelpKeybindingDisplayRow[];
};

export type HelpKeybindingCoverage = {
  action: KeymapAction;
  binding: KeyBinding;
  label: string;
};

export const HIDDEN_HELP_KEYBINDING_ACTIONS = new Set<KeymapAction>([
  "start-g-sequence",
]);

const HELP_KEYBINDING_GROUPS: HelpKeybindingDisplayGroup[] = [
  {
    title: { en: "Global", ja: "グローバル" },
    rows: [
      {
        selectors: [{ action: "open-file-palette" }],
        description: {
          en: "Open file palette",
          ja: "ファイルパレットを開く",
        },
      },
      {
        selectors: [{ action: "open-grep-palette" }],
        description: {
          en: "Open grep palette",
          ja: "grep パレットを開く",
        },
      },
      {
        selectors: [{ action: "focus-file-filter" }],
        description: {
          en: "Focus file filter",
          ja: "ファイルフィルターへフォーカス",
        },
      },
      {
        selectors: [{ action: "open-help" }],
        description: {
          en: "Open this help (keybindings)",
          ja: "このヘルプ（キーバインド）を開く",
        },
      },
      {
        selectors: [{ action: "toggle-theme" }],
        description: { en: "Toggle theme", ja: "テーマ切り替え" },
      },
      {
        selectors: [
          { action: "copy-ai-context" },
          { action: "copy-ai-context-with-code" },
        ],
        description: {
          en: "Copy AI context (with code if a selection is active)",
          ja: "AI 用コンテキストをコピー（選択行があればコード付き）",
        },
      },
      {
        selectors: [
          { action: "annotation-previous" },
          { action: "annotation-next" },
        ],
        description: {
          en: "Previous / next annotation",
          ja: "前 / 次の注釈へ移動",
        },
      },
      {
        selectors: [{ action: "next-unviewed-file" }],
        description: {
          en: "Jump to the next unviewed file",
          ja: "次の未確認ファイルへ移動",
        },
      },
      {
        selectors: [{ action: "layout-unified" }, { action: "layout-split" }],
        description: {
          en: "Switch unified / split layout",
          ja: "統合 / 分割レイアウトへ切り替え",
        },
      },
      {
        selectors: [{ action: "cancel-source-load" }],
        description: {
          en: "Cancel active source load",
          ja: "進行中のソース読み込みを中断",
        },
      },
    ],
  },
  {
    title: { en: "Panels", ja: "パネル" },
    rows: [
      {
        selectors: [{ action: "focus-sidebar" }],
        description: { en: "Focus sidebar", ja: "サイドバーへフォーカス" },
      },
      {
        selectors: [{ action: "focus-main" }],
        description: {
          en: "Focus main panel",
          ja: "メインパネルへフォーカス",
        },
      },
    ],
  },
  {
    title: { en: "Sidebar", ja: "サイドバー" },
    rows: [
      {
        selectors: [{ action: "sidebar-next" }, { action: "sidebar-previous" }],
        description: {
          en: "Move selection down / up",
          ja: "選択を下 / 上へ移動",
        },
      },
      {
        selectors: [
          { action: "sidebar-page-down" },
          { action: "sidebar-page-up" },
        ],
        description: {
          en: "Move selection by half a page",
          ja: "半ページ分選択を移動",
        },
      },
      {
        selectors: [
          { action: "goto-top", pendingG: true },
          { action: "goto-bottom", shift: true, pendingG: false },
        ],
        description: { en: "Move to top / bottom", ja: "先頭 / 末尾へ移動" },
      },
      {
        selectors: [{ action: "open-sidebar-item" }],
        description: { en: "Open selected item", ja: "選択項目を開く" },
      },
      {
        selectors: [
          { action: "sidebar-collapse" },
          { action: "sidebar-expand" },
        ],
        description: {
          en: "Collapse / expand directory",
          ja: "ディレクトリを閉じる / 開く",
        },
      },
    ],
  },
  {
    title: { en: "Main Panel", ja: "メインパネル" },
    rows: [
      {
        selectors: [
          { action: "scroll-main-down", scope: "main" },
          { action: "scroll-main-up", scope: "main" },
        ],
        description: {
          en: "Move code cursor down / up",
          ja: "コードカーソルを下 / 上へ移動",
        },
      },
      {
        selectors: [
          {
            action: "scroll-main-page-down",
            scope: "main",
            key: "d",
            ctrl: true,
          },
          {
            action: "scroll-main-page-up",
            scope: "main",
            key: "u",
            ctrl: true,
          },
        ],
        description: {
          en: "Move code cursor by half a page",
          ja: "コードカーソルを半ページ分移動",
        },
      },
      {
        selectors: [
          { action: "scroll-main-page-down", scope: "main", key: "pagedown" },
          { action: "scroll-main-page-up", scope: "main", key: "pageup" },
        ],
        description: {
          en: "Move code cursor by a page",
          ja: "コードカーソルを1ページ分移動",
        },
      },
      {
        selectors: [
          {
            action: "scroll-main-page-down",
            scope: "main",
            key: "arrowdown",
            ctrl: true,
          },
          {
            action: "scroll-main-page-up",
            scope: "main",
            key: "arrowup",
            ctrl: true,
          },
        ],
        description: {
          en: "Move code cursor by a page",
          ja: "コードカーソルを1ページ分移動",
        },
      },
      {
        selectors: [
          { action: "goto-top", pendingG: true },
          { action: "goto-bottom", shift: true, pendingG: false },
        ],
        description: {
          en: "Move code cursor to top / bottom",
          ja: "コードカーソルを先頭 / 末尾へ移動",
        },
      },
      {
        selectors: [
          { action: "tab-preview", scope: "main", pendingG: true },
          { action: "tab-code", scope: "main", pendingG: true },
        ],
        description: {
          en: "Switch to Preview / Code tab",
          ja: "Preview / Code タブへ切り替え",
        },
      },
    ],
  },
];

function matchesSelector(
  binding: KeyBinding,
  selector: HelpKeybindingSelector,
): boolean {
  if (binding.action !== selector.action) return false;
  if (selector.key !== undefined && binding.key !== selector.key) return false;
  if (selector.scope !== undefined && binding.scope !== selector.scope)
    return false;
  if (selector.ctrl !== undefined && !!binding.ctrl !== selector.ctrl)
    return false;
  if (selector.meta !== undefined && !!binding.meta !== selector.meta)
    return false;
  if (selector.alt !== undefined && !!binding.alt !== selector.alt)
    return false;
  if (selector.shift !== undefined && !!binding.shift !== selector.shift)
    return false;
  if (
    selector.pendingG !== undefined &&
    !!binding.pendingG !== selector.pendingG
  )
    return false;
  return true;
}

function formatKeyName(key: string, shifted: boolean): string {
  const lower = key.toLowerCase();
  if (lower === "escape") return "Escape";
  if (lower === "enter") return "Enter";
  if (lower === "pagedown") return "PageDown";
  if (lower === "pageup") return "PageUp";
  if (lower === "arrowdown") return "ArrowDown";
  if (lower === "arrowup") return "ArrowUp";
  if (key === "?") return "?";
  if (shifted && key.length === 1) return key.toUpperCase();
  return key;
}

function formatKeyBinding(binding: KeyBinding): string {
  const key = formatKeyName(
    binding.key,
    !!binding.shift || !!binding.ctrl || !!binding.meta || !!binding.alt,
  );
  if (
    binding.pendingG &&
    !binding.ctrl &&
    !binding.meta &&
    !binding.alt &&
    !binding.shift &&
    binding.key.length === 1
  )
    return `g${key}`;

  const parts: string[] = [];
  if (binding.pendingG) parts.push("g");
  if (binding.ctrl) parts.push("Ctrl");
  if (binding.meta) parts.push("Meta");
  if (binding.alt) parts.push("Alt");
  if (binding.shift && binding.key !== "?") parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

function addUnique(values: string[], next: string): void {
  if (!values.includes(next)) values.push(next);
}

function collectRowCoverage(
  row: HelpKeybindingDisplayRow,
  bindings: KeyBinding[],
): HelpKeybindingCoverage[] {
  const coverage: HelpKeybindingCoverage[] = [];
  const seen = new Set<string>();
  for (const selector of row.selectors) {
    for (const binding of bindings) {
      if (!matchesSelector(binding, selector)) continue;
      const label = formatKeyBinding(binding);
      const key = `${binding.action}\0${binding.scope || ""}\0${label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      coverage.push({ action: selector.action, binding, label });
    }
  }
  return coverage;
}

function buildRow(
  row: HelpKeybindingDisplayRow,
  language: HelpKeybindingLanguage,
  bindings: KeyBinding[],
): [string, string] {
  const labels: string[] = [];
  for (const item of collectRowCoverage(row, bindings))
    addUnique(labels, item.label);
  return [labels.join(" / "), row.description[language]];
}

export function buildHelpKeybindingGroups(
  language: HelpKeybindingLanguage,
  bindings: KeyBinding[] = DEFAULT_KEY_BINDINGS,
): HelpKeybindingTableGroup[] {
  return HELP_KEYBINDING_GROUPS.map((group) => ({
    title: group.title[language],
    rows: group.rows.map((row) => buildRow(row, language, bindings)),
  }));
}

export function collectHelpKeybindingCoverage(
  bindings: KeyBinding[] = DEFAULT_KEY_BINDINGS,
): HelpKeybindingCoverage[] {
  return HELP_KEYBINDING_GROUPS.flatMap((group) =>
    group.rows.flatMap((row) => collectRowCoverage(row, bindings)),
  );
}

export function documentedHelpKeybindingActions(): Set<KeymapAction> {
  return new Set(
    HELP_KEYBINDING_GROUPS.flatMap((group) =>
      group.rows.flatMap((row) =>
        row.selectors.map((selector) => selector.action),
      ),
    ),
  );
}
