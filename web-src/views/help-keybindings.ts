// キー割り当てのある操作の名前と分類の表 (英日)。ヘルプのキーの一覧・クイック
// ヘルプ・設定の「ショートカット」が、この 1 つの表と、利用者の割り当てを重ねた
// バインド (core/keymap.ts の resolveKeyBindings) を読む。操作ごとの名前を
// 画面ごとに書き分けない。

import {
  DEFAULT_KEY_BINDINGS,
  type KeyBinding,
  type KeymapAction,
} from "../core/keymap";

export type HelpKeybindingLanguage = "en" | "ja";

export type HelpKeybindingTableGroup = {
  title: string;
  rows: Array<[string, string]>;
  /**
   * rows と同じ並びで、その行が説明している操作 (キーの決まった行は空)。
   */
  rowActions: KeymapAction[][];
};

type HelpText = Record<HelpKeybindingLanguage, string>;

/** 操作の分類。並びはヘルプと設定の画面の並び。 */
export const KEYMAP_GROUPS = [
  "global",
  "panels",
  "screens",
  "tabs",
  "sidebar",
  "main",
] as const;
export type KeymapGroup = (typeof KEYMAP_GROUPS)[number];

const GROUP_TITLES: Record<KeymapGroup | "focused", HelpText> = {
  global: { en: "Global", ja: "グローバル" },
  panels: { en: "Panels", ja: "パネル" },
  screens: { en: "Screens", ja: "画面" },
  tabs: { en: "Tabs", ja: "タブ" },
  sidebar: { en: "File list", ja: "ファイル一覧" },
  main: { en: "Main Panel", ja: "メインパネル" },
  focused: { en: "Focused Controls", ja: "フォーカス中の操作" },
};

export function keymapGroupTitle(
  group: KeymapGroup,
  language: HelpKeybindingLanguage,
): string {
  return GROUP_TITLES[group][language];
}

export type KeymapActionInfo = { group: KeymapGroup; label: HelpText };

/**
 * 全部の操作の分類と名前。Record なので、操作を足して名前を書き忘れると型で
 * 落ちる。分類の中の並びは、この表に書いた順。
 */
export const KEYMAP_ACTION_INFO: Record<KeymapAction, KeymapActionInfo> = {
  "open-file-palette": {
    group: "global",
    label: { en: "Open file palette", ja: "ファイルパレットを開く" },
  },
  "open-grep-palette": {
    group: "global",
    label: { en: "Open grep palette", ja: "grep パレットを開く" },
  },
  "focus-file-filter": {
    group: "global",
    label: { en: "Focus file filter", ja: "ファイルフィルターへフォーカス" },
  },
  "open-help": {
    group: "global",
    label: { en: "Open quick help", ja: "クイックヘルプを開く" },
  },
  "open-settings": {
    group: "global",
    label: { en: "Open settings", ja: "設定を開く" },
  },
  "toggle-theme": {
    group: "global",
    label: { en: "Toggle theme", ja: "テーマ切り替え" },
  },
  "copy-ai-context": {
    group: "global",
    label: { en: "Copy AI context", ja: "AI 用コンテキストをコピー" },
  },
  "copy-ai-context-with-code": {
    group: "global",
    label: {
      en: "Copy AI context with the selected code",
      ja: "AI 用コンテキストを選択行のコード付きでコピー",
    },
  },
  "annotation-previous": {
    group: "global",
    label: { en: "Previous annotation", ja: "前の注釈へ移動" },
  },
  "annotation-next": {
    group: "global",
    label: { en: "Next annotation", ja: "次の注釈へ移動" },
  },
  "previous-unviewed-file": {
    group: "global",
    label: {
      en: "Jump to the previous unviewed file",
      ja: "前の未確認ファイルへ移動",
    },
  },
  "next-unviewed-file": {
    group: "global",
    label: {
      en: "Jump to the next unviewed file",
      ja: "次の未確認ファイルへ移動",
    },
  },
  "toggle-viewed": {
    group: "global",
    label: {
      en: "Mark the current file viewed or not viewed",
      ja: "現在のファイルの確認済みを切り替え",
    },
  },
  "reload-diff": {
    group: "global",
    label: { en: "Reload the diff", ja: "差分を読み込み直す" },
  },
  "undo-last-action": {
    group: "global",
    label: { en: "Undo the last action", ja: "直前の操作を取り消す" },
  },
  "find-in-source": {
    group: "global",
    label: {
      en: "Find within the open file",
      ja: "開いているファイル内を検索",
    },
  },
  "copy-file-path": {
    group: "global",
    label: {
      en: "Copy the current file path",
      ja: "現在のファイルパスをコピー",
    },
  },
  "toggle-ignore-whitespace": {
    group: "global",
    label: {
      en: "Toggle ignore whitespace changes",
      ja: "空白の差分を無視するかを切り替え",
    },
  },
  "toggle-hide-tests": {
    group: "global",
    label: {
      en: "Toggle hiding test files",
      ja: "テストファイルの表示を切り替え",
    },
  },
  "code-font-size-decrease": {
    group: "global",
    label: { en: "Shrink the code font size", ja: "コードの文字を小さく" },
  },
  "code-font-size-increase": {
    group: "global",
    label: { en: "Grow the code font size", ja: "コードの文字を大きく" },
  },
  "code-font-size-reset": {
    group: "global",
    label: {
      en: "Reset the code font size",
      ja: "コードの文字の大きさを既定に戻す",
    },
  },
  "layout-unified": {
    group: "global",
    label: { en: "Unified diff layout", ja: "統合レイアウトへ切り替え" },
  },
  "layout-split": {
    group: "global",
    label: { en: "Split diff layout", ja: "分割レイアウトへ切り替え" },
  },
  "cancel-source-load": {
    group: "global",
    label: {
      en: "Cancel active source load",
      ja: "進行中のソース読み込みを中断",
    },
  },
  "new-agent": {
    group: "global",
    label: { en: "Start a new agent", ja: "新しいエージェントを起動" },
  },
  "start-g-sequence": {
    group: "global",
    label: {
      en: "Start a g key (g d, g t …)",
      ja: "g で始まるキーの 1 打目 (g d・g t など)",
    },
  },
  "focus-sidebar": {
    group: "panels",
    label: {
      en: "Focus the file list (or the list of the screen)",
      ja: "ファイル一覧 (一覧のある画面ではその一覧) へフォーカス",
    },
  },
  "focus-main": {
    group: "panels",
    label: { en: "Focus main panel", ja: "メインパネルへフォーカス" },
  },
  "toggle-sidebar": {
    group: "panels",
    label: {
      en: "Show or hide the file list",
      ja: "ファイル一覧の表示を切り替え",
    },
  },
  "toggle-terminal-panel": {
    group: "panels",
    label: {
      en: "Open a terminal: the ＋ menu of the focused side (new shell or session)",
      ja: "ターミナルを開く: フォーカスのある面の「＋」のメニュー (新しいシェル・セッション)",
    },
  },
  "toggle-annotations-panel": {
    group: "panels",
    label: {
      en: "Open or close the annotations panel",
      ja: "注釈パネルを開閉",
    },
  },
  "goto-diff": {
    group: "screens",
    label: { en: "Go to the diff screen", ja: "差分画面へ移動" },
  },
  "goto-definition": {
    group: "screens",
    label: {
      en: "Jump to definition of the symbol at the caret / selection",
      ja: "カーソル位置・選択中のシンボルの定義へジャンプ",
    },
  },
  "goto-history": {
    group: "screens",
    label: {
      en: "Go to the history screen (keeps the ref you are viewing)",
      ja: "履歴画面へ移動（見ている ref を引き継ぐ）",
    },
  },
  "history-next-commit": {
    group: "screens",
    label: {
      en: "Select the next commit in the history list",
      ja: "履歴一覧で次のコミットを選ぶ",
    },
  },
  "history-previous-commit": {
    group: "screens",
    label: {
      en: "Select the previous commit in the history list",
      ja: "履歴一覧で前のコミットを選ぶ",
    },
  },
  "goto-repo": {
    group: "screens",
    label: { en: "Go to the repository screen", ja: "リポジトリ画面へ移動" },
  },
  "goto-journal": {
    group: "screens",
    label: { en: "Go to the journal screen", ja: "ジャーナル画面へ移動" },
  },
  "goto-database": {
    group: "screens",
    label: { en: "Go to the datastore screen", ja: "データストア画面へ移動" },
  },
  "goto-agents": {
    group: "screens",
    label: { en: "Go to the agents screen", ja: "エージェント画面へ移動" },
  },
  "goto-worktrees": {
    group: "screens",
    label: { en: "Go to the worktrees screen", ja: "作業ツリー画面へ移動" },
  },
  "goto-tools": {
    group: "screens",
    label: { en: "Open Tools", ja: "Tools を開く" },
  },
  "goto-search": {
    group: "screens",
    label: { en: "Open Search", ja: "Search を開く" },
  },
  "switch-project": {
    group: "screens",
    label: {
      en: "Switch to another registered project (the repository name in the header)",
      ja: "登録したプロジェクトへ切り替える (ヘッダのリポジトリ名)",
    },
  },
  "nav-back": {
    group: "screens",
    label: { en: "Go back through visited screens", ja: "表示履歴を戻る" },
  },
  "nav-forward": {
    group: "screens",
    label: { en: "Go forward through visited screens", ja: "表示履歴を進む" },
  },
  "main-tab-next": {
    group: "tabs",
    label: { en: "Next tab of the main area", ja: "メインの面の次のタブ" },
  },
  "main-tab-previous": {
    group: "tabs",
    label: { en: "Previous tab of the main area", ja: "メインの面の前のタブ" },
  },
  "main-tab-close": {
    group: "tabs",
    label: {
      en: "Close the tab of the main area",
      ja: "メインの面のタブを閉じる",
    },
  },
  "main-tab-reopen": {
    group: "tabs",
    label: {
      en: "Reopen the last tab you closed",
      ja: "最後に閉じたタブを開き直す",
    },
  },
  "main-tab-menu": {
    group: "tabs",
    label: {
      en: "Open the menu of the front tab (the same as right-clicking it)",
      ja: "前面のタブのメニューを開く (右クリックと同じ)",
    },
  },
  "main-tab-1": {
    group: "tabs",
    label: { en: "Go to the 1st tab", ja: "1 番目のタブへ" },
  },
  "main-tab-2": {
    group: "tabs",
    label: { en: "Go to the 2nd tab", ja: "2 番目のタブへ" },
  },
  "main-tab-3": {
    group: "tabs",
    label: { en: "Go to the 3rd tab", ja: "3 番目のタブへ" },
  },
  "main-tab-4": {
    group: "tabs",
    label: { en: "Go to the 4th tab", ja: "4 番目のタブへ" },
  },
  "main-tab-5": {
    group: "tabs",
    label: { en: "Go to the 5th tab", ja: "5 番目のタブへ" },
  },
  "main-tab-6": {
    group: "tabs",
    label: { en: "Go to the 6th tab", ja: "6 番目のタブへ" },
  },
  "main-tab-7": {
    group: "tabs",
    label: { en: "Go to the 7th tab", ja: "7 番目のタブへ" },
  },
  "main-tab-8": {
    group: "tabs",
    label: { en: "Go to the 8th tab", ja: "8 番目のタブへ" },
  },
  "main-tab-9": {
    group: "tabs",
    label: { en: "Go to the 9th tab", ja: "9 番目のタブへ" },
  },
  "main-tab-last": {
    group: "tabs",
    label: { en: "Go to the last tab", ja: "最後のタブへ" },
  },
  "main-pane-other": {
    group: "tabs",
    label: {
      en: "Move focus to the other side of a split main area",
      ja: "左右に分けたメインの面で、もう一方の面へ",
    },
  },
  // 左の一覧の並びで前・次のプロジェクトへ。前面はそのプロジェクトのタブの
  // グループで最後に前面だったタブ (views/main-tabs の prepareProjectSwitch)。
  "project-previous": {
    group: "tabs",
    label: {
      en: "Switch to the previous project in the sidebar list",
      ja: "左の一覧の前のプロジェクトへ切り替える",
    },
  },
  "project-next": {
    group: "tabs",
    label: {
      en: "Switch to the next project in the sidebar list",
      ja: "左の一覧の次のプロジェクトへ切り替える",
    },
  },
  "sidebar-next": {
    group: "sidebar",
    label: { en: "Move selection down", ja: "選択を下へ移動" },
  },
  "sidebar-previous": {
    group: "sidebar",
    label: { en: "Move selection up", ja: "選択を上へ移動" },
  },
  "sidebar-page-down": {
    group: "sidebar",
    label: {
      en: "Move selection down by half a page",
      ja: "選択を半ページ下へ",
    },
  },
  "sidebar-page-up": {
    group: "sidebar",
    label: { en: "Move selection up by half a page", ja: "選択を半ページ上へ" },
  },
  "open-sidebar-item": {
    group: "sidebar",
    label: { en: "Open selected item", ja: "選択項目を開く" },
  },
  "sidebar-collapse": {
    group: "sidebar",
    label: {
      en: "Collapse directory or move to its parent",
      ja: "ディレクトリを閉じる、または親へ移動",
    },
  },
  "sidebar-expand": {
    group: "sidebar",
    label: { en: "Expand directory", ja: "ディレクトリを開く" },
  },
  "goto-top": {
    group: "main",
    label: {
      en: "Move to the top (list or code)",
      ja: "先頭へ移動 (一覧・コード)",
    },
  },
  "goto-bottom": {
    group: "main",
    label: {
      en: "Move to the bottom (list or code)",
      ja: "末尾へ移動 (一覧・コード)",
    },
  },
  "scroll-main-down": {
    group: "main",
    label: { en: "Move code cursor down", ja: "コードカーソルを下へ移動" },
  },
  "scroll-main-up": {
    group: "main",
    label: { en: "Move code cursor up", ja: "コードカーソルを上へ移動" },
  },
  "scroll-main-page-down": {
    group: "main",
    label: {
      en: "Move code cursor down by a page",
      ja: "コードカーソルを 1 ページ下へ",
    },
  },
  "scroll-main-page-up": {
    group: "main",
    label: {
      en: "Move code cursor up by a page",
      ja: "コードカーソルを 1 ページ上へ",
    },
  },
  "previous-hunk": {
    group: "main",
    label: { en: "Move to the previous hunk", ja: "前のハンクへ移動" },
  },
  "next-hunk": {
    group: "main",
    label: { en: "Move to the next hunk", ja: "次のハンクへ移動" },
  },
  "tab-preview": {
    group: "main",
    label: { en: "Switch to the Preview tab", ja: "Preview タブへ切り替え" },
  },
  "tab-code": {
    group: "main",
    label: { en: "Switch to the Code tab", ja: "Code タブへ切り替え" },
  },
};

/** ヘルプの一覧に出さない操作 (設定の「ショートカット」には出す)。 */
export const HIDDEN_HELP_KEYBINDING_ACTIONS = new Set<KeymapAction>([
  "start-g-sequence",
]);

/** 分類ごとの、キー割り当てで変えられないキー (部品が自分で受けるもの)。 */
type FixedRow = { keys: HelpText; description: HelpText };

const FIXED_ROWS: Partial<Record<KeymapGroup | "focused", FixedRow[]>> = {
  panels: [
    {
      keys: {
        en: "ArrowLeft / ArrowRight / Shift+ArrowLeft / Shift+ArrowRight",
        ja: "ArrowLeft / ArrowRight / Shift+ArrowLeft / Shift+ArrowRight",
      },
      description: {
        en: "Resize the split while its divider has focus (Shift moves farther)",
        ja: "分割線にフォーカスがあるとき幅を変更（Shift 併用で大きく移動）",
      },
    },
  ],
  screens: [
    {
      keys: {
        en: "ArrowDown / Ctrl+N / ArrowUp / Ctrl+P",
        ja: "ArrowDown / Ctrl+N / ArrowUp / Ctrl+P",
      },
      description: {
        en: "Move through search palette results",
        ja: "検索パレットの候補を移動",
      },
    },
    {
      keys: { en: "Enter / Escape", ja: "Enter / Escape" },
      description: {
        en: "Open the search palette selection / close the palette",
        ja: "検索パレットの選択項目を開く / パレットを閉じる",
      },
    },
    {
      keys: { en: "Alt+R / Alt+C / Alt+W", ja: "Alt+R / Alt+C / Alt+W" },
      description: {
        en: "Toggle grep regular expression / case / whole-word matching",
        ja: "grep の正規表現 / 大文字小文字 / 単語一致を切り替え",
      },
    },
  ],
  sidebar: [
    {
      keys: {
        en: "Enter / ArrowDown / ArrowUp / Escape",
        ja: "Enter / ArrowDown / ArrowUp / Escape",
      },
      description: {
        en: "Open the filtered item / move through matches / clear the file filter",
        ja: "絞り込み結果を開く / 候補を移動 / ファイルフィルターを消去",
      },
    },
  ],
  focused: [
    {
      keys: {
        en: "Escape / Enter / Tab / Shift+Tab",
        ja: "Escape / Enter / Tab / Shift+Tab",
      },
      description: {
        en: "Cancel or submit a dialog / move within its focus trap",
        ja: "ダイアログを取り消す・確定する / ダイアログ内でフォーカスを移動",
      },
    },
    {
      keys: {
        en: "ArrowDown / ArrowUp / Home / End / Enter",
        ja: "ArrowDown / ArrowUp / Home / End / Enter",
      },
      description: {
        en: "Move through agent rows / open the focused row",
        ja: "エージェント行を移動 / フォーカス中の行を開く",
      },
    },
    {
      keys: {
        en: "ArrowLeft / ArrowRight / ArrowUp / ArrowDown / Enter / Tab / Shift+Tab",
        ja: "ArrowLeft / ArrowRight / ArrowUp / ArrowDown / Enter / Tab / Shift+Tab",
      },
      description: {
        en: "Move through data cells / open a cell / move between related grids",
        ja: "データセルを移動 / セルを開く / 関連グリッド間を移動",
      },
    },
    {
      keys: { en: "Ctrl+Enter / Meta+Enter", ja: "Ctrl+Enter / Meta+Enter" },
      description: {
        en: "Run the data query in the query editor",
        ja: "クエリエディターのデータクエリを実行",
      },
    },
    {
      keys: { en: "Shift+Enter", ja: "Shift+Enter" },
      description: {
        en: "Insert a terminal newline without submitting",
        ja: "ターミナルで送信せずに改行",
      },
    },
  ],
};

export function actionLabel(
  action: KeymapAction,
  language: HelpKeybindingLanguage,
): string {
  return KEYMAP_ACTION_INFO[action].label[language];
}

/** 分類の中の操作 (表に書いた順)。 */
export function actionsInGroup(group: KeymapGroup): KeymapAction[] {
  return (Object.keys(KEYMAP_ACTION_INFO) as KeymapAction[]).filter(
    (action) => KEYMAP_ACTION_INFO[action].group === group,
  );
}

const KEY_NAMES: Record<string, string> = {
  escape: "Escape",
  enter: "Enter",
  tab: "Tab",
  space: "Space",
  backspace: "Backspace",
  delete: "Delete",
  home: "Home",
  end: "End",
  pagedown: "PageDown",
  pageup: "PageUp",
  arrowdown: "ArrowDown",
  arrowup: "ArrowUp",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
};

function formatKeyName(key: string, shifted: boolean): string {
  const lower = key.toLowerCase();
  const named = KEY_NAMES[lower];
  if (named) return named;
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

/** 一覧に出す 1 つのキーの文字。PWA の窓だけで効くキーには (PWA) を添える。 */
export function formatBindingLabel(binding: KeyBinding): string {
  const label = formatKeyBinding(binding);
  return binding.pwa ? `${label} (PWA)` : label;
}

export type HelpKeybindingCoverage = {
  action: KeymapAction;
  binding: KeyBinding;
  label: string;
};

/** その操作のキーの文字 (重複を除き、並びのまま)。 */
function actionCoverage(
  action: KeymapAction,
  bindings: KeyBinding[],
): HelpKeybindingCoverage[] {
  const coverage: HelpKeybindingCoverage[] = [];
  const seen = new Set<string>();
  for (const binding of bindings) {
    if (binding.action !== action) continue;
    const label = formatBindingLabel(binding);
    if (seen.has(label)) continue;
    seen.add(label);
    coverage.push({ action, binding, label });
  }
  return coverage;
}

function helpActions(group: KeymapGroup): KeymapAction[] {
  return actionsInGroup(group).filter(
    (action) => !HIDDEN_HELP_KEYBINDING_ACTIONS.has(action),
  );
}

/**
 * ヘルプの一覧。bindings は利用者の割り当てを重ねたもの (app の activeKeyBindings)。
 * キーの無い操作 (割り当てを外した・既定で無い) は行にしない。
 */
export function buildHelpKeybindingGroups(
  language: HelpKeybindingLanguage,
  bindings: KeyBinding[] = DEFAULT_KEY_BINDINGS,
  // English group title allowlist (language-neutral key) for callers that
  // only want a subset, e.g. a compact quick-help panel.
  onlyTitlesEn?: string[],
): HelpKeybindingTableGroup[] {
  const groups = [...KEYMAP_GROUPS, "focused" as const].filter(
    (group) => !onlyTitlesEn || onlyTitlesEn.includes(GROUP_TITLES[group].en),
  );
  return groups.map((group) => {
    const rows: Array<[string, string]> = [];
    const rowActions: KeymapAction[][] = [];
    if (group !== "focused")
      for (const action of helpActions(group)) {
        const labels = actionCoverage(action, bindings).map(
          (item) => item.label,
        );
        if (!labels.length) continue;
        rows.push([labels.join(" / "), actionLabel(action, language)]);
        rowActions.push([action]);
      }
    for (const row of FIXED_ROWS[group] ?? []) {
      rows.push([row.keys[language], row.description[language]]);
      rowActions.push([]);
    }
    return { title: GROUP_TITLES[group][language], rows, rowActions };
  });
}

export function collectHelpKeybindingCoverage(
  bindings: KeyBinding[] = DEFAULT_KEY_BINDINGS,
): HelpKeybindingCoverage[] {
  return KEYMAP_GROUPS.flatMap((group) =>
    helpActions(group).flatMap((action) => actionCoverage(action, bindings)),
  );
}

export function documentedHelpKeybindingActions(): Set<KeymapAction> {
  return new Set(KEYMAP_GROUPS.flatMap(helpActions));
}
