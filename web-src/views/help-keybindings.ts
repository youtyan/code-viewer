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
  /**
   * rows と同じ並びで、その行が説明しているアクション。1 行が 2 つ以上の
   * アクションをまとめて説明することがある (前へ / 次へ など) ので配列。
   * キーの変更 UI は、この対応を使って行から編集対象を引く。
   */
  rowActions: KeymapAction[][];
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
          en: "Open quick help",
          ja: "クイックヘルプを開く",
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
        selectors: [
          { action: "previous-unviewed-file" },
          { action: "next-unviewed-file" },
        ],
        description: {
          en: "Jump to the previous / next unviewed file",
          ja: "前 / 次の未確認ファイルへ移動",
        },
      },
      {
        selectors: [{ action: "toggle-viewed" }],
        description: {
          en: "Mark the current file viewed or not viewed",
          ja: "現在のファイルの確認済みを切り替え",
        },
      },
      {
        selectors: [{ action: "reload-diff" }],
        description: { en: "Reload the diff", ja: "差分を読み込み直す" },
      },
      {
        selectors: [{ action: "undo-last-action" }],
        description: {
          en: "Undo the last action",
          ja: "直前の操作を取り消す",
        },
      },
      {
        selectors: [{ action: "find-in-source" }],
        description: {
          en: "Find within the open file",
          ja: "開いているファイル内を検索",
        },
      },
      {
        selectors: [{ action: "copy-file-path" }],
        description: {
          en: "Copy the current file path",
          ja: "現在のファイルパスをコピー",
        },
      },
      {
        selectors: [{ action: "toggle-ignore-whitespace" }],
        description: {
          en: "Toggle ignore whitespace changes",
          ja: "空白の差分を無視するかを切り替え",
        },
      },
      {
        selectors: [{ action: "toggle-hide-tests" }],
        description: {
          en: "Toggle hiding test files",
          ja: "テストファイルの表示を切り替え",
        },
      },
      {
        selectors: [{ action: "open-settings" }],
        description: { en: "Open settings", ja: "設定を開く" },
      },
      {
        selectors: [
          { action: "code-font-size-decrease" },
          { action: "code-font-size-increase" },
          { action: "code-font-size-reset" },
        ],
        description: {
          en: "Shrink / grow / reset the code font size",
          ja: "コードの文字サイズを縮小 / 拡大 / 既定に戻す",
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
      {
        selectors: [{ action: "toggle-sidebar" }],
        description: {
          en: "Show or hide the sidebar",
          ja: "サイドバーの表示を切り替え",
        },
      },
      {
        selectors: [{ action: "toggle-terminal-panel" }],
        description: {
          en: "Open or close the terminal panel",
          ja: "ターミナルパネルを開閉",
        },
      },
      {
        selectors: [{ action: "toggle-annotations-panel" }],
        description: {
          en: "Open or close the annotations panel",
          ja: "注釈パネルを開閉",
        },
      },
    ],
  },
  {
    title: { en: "Screens", ja: "画面" },
    rows: [
      {
        selectors: [{ action: "goto-diff" }],
        description: { en: "Go to the diff screen", ja: "差分画面へ移動" },
      },
      {
        selectors: [{ action: "goto-definition" }],
        description: {
          en: "Jump to definition of the symbol at the caret / selection",
          ja: "カーソル位置・選択中のシンボルの定義へジャンプ",
        },
      },
      {
        selectors: [{ action: "goto-history" }],
        description: {
          en: "Go to the history screen (keeps the ref you are viewing)",
          ja: "履歴画面へ移動（見ている ref を引き継ぐ）",
        },
      },
      {
        selectors: [
          { action: "history-next-commit", key: "arrowdown" },
          { action: "history-previous-commit", key: "arrowup" },
        ],
        description: {
          en: "Select the next / previous commit in the history list",
          ja: "履歴一覧で次 / 前のコミットを選ぶ",
        },
      },
      {
        selectors: [
          { action: "history-next-commit", scope: "history" },
          { action: "history-previous-commit", scope: "history" },
        ],
        description: {
          en: "Same, while the commit list has focus",
          ja: "同上（コミット一覧にフォーカスがあるとき）",
        },
      },
      {
        selectors: [{ action: "goto-repo" }],
        description: {
          en: "Go to the repository screen",
          ja: "リポジトリ画面へ移動",
        },
      },
      {
        selectors: [{ action: "goto-journal" }],
        description: {
          en: "Go to the journal screen",
          ja: "ジャーナル画面へ移動",
        },
      },
      {
        selectors: [{ action: "goto-database" }],
        description: {
          en: "Go to the datastore screen",
          ja: "データストア画面へ移動",
        },
      },
      {
        selectors: [{ action: "nav-back" }, { action: "nav-forward" }],
        description: {
          en: "Go back / forward through visited screens",
          ja: "表示履歴を戻る / 進む",
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
        selectors: [{ action: "previous-hunk" }, { action: "next-hunk" }],
        description: {
          en: "Move to the previous / next hunk",
          ja: "前 / 次のハンクへ移動",
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

export function formatKeyBinding(binding: KeyBinding): string {
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

function rowActionList(row: HelpKeybindingDisplayRow): KeymapAction[] {
  // バインドではなくセレクタから引く。ユーザーが無効にしたアクションも
  // 編集対象として残さないと、戻す手段がなくなる。
  const actions: KeymapAction[] = [];
  for (const selector of row.selectors)
    if (!actions.includes(selector.action)) actions.push(selector.action);
  return actions;
}

export function buildHelpKeybindingGroups(
  language: HelpKeybindingLanguage,
  bindings: KeyBinding[] = DEFAULT_KEY_BINDINGS,
  // English group title allowlist (language-neutral key) for callers that
  // only want a subset, e.g. a compact quick-help panel.
  onlyTitlesEn?: string[],
): HelpKeybindingTableGroup[] {
  const groups = onlyTitlesEn
    ? HELP_KEYBINDING_GROUPS.filter((group) =>
        onlyTitlesEn.includes(group.title.en),
      )
    : HELP_KEYBINDING_GROUPS;
  return groups.map((group) => ({
    title: group.title[language],
    rows: group.rows.map((row) => buildRow(row, language, bindings)),
    rowActions: group.rows.map(rowActionList),
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
