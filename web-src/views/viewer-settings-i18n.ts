// 設定のページ (views/viewer-settings.ts) の文言。形は viewer-settings.ts の
// ViewerSettingsText。切替時のライブ反映は viewer-settings の localize()。
//
// 読む人は使う人: 節ごとに「何のための設定か」を 1 文にし、仕組みの細部は
// 畳んだ中かヘルプへ回す。1 段落の長さは settings-text-length.test.ts が見る
// (日本語 120 文字・英語 240 文字まで)。

import type { ViewerSettingsText } from "./viewer-settings";

const RULES_EXAMPLE = `{
  "version": 1,
  "rules": [
    {
      "id": "waiting_for_confirmation",
      "state": "waiting",
      "priority": 900,
      "region": "bottom_non_empty",
      "lines": 12,
      "contains": ["enter to confirm"],
      "not": [{ "contains": ["finished"] }]
    }
  ]
}`;

export const VIEWER_SETTINGS_TEXT: Record<"en" | "ja", ViewerSettingsText> = {
  en: {
    display: "Display",
    theme: "Theme",
    themeHelp:
      "Applies right away. The T key switches between light and the dark theme you picked.",
    themeNames: {
      dark: "Dark (violet)",
      graphite: "Dark (graphite)",
      warm: "Dark (warm gray)",
      light: "Light",
    },
    language: "Language",
    fileListFontSize: "UI font size",
    fileListFontSizeHelp: "Applies to everything except code.",
    codeFontSize: "Code font size",
    sizeSmall: "Small",
    sizeRegular: "Regular",
    sizeLarge: "Large",
    sizeExtraLarge: "Extra Large",
    sharedTag: "All projects",
    sharedTagTitle:
      "Shared by all projects: changing it here changes it everywhere, and it stays the same when you switch projects.",
    userSettingsError: (detail) =>
      `The settings shared by all projects cannot be read, so this project's settings are shown. Changes here are not saved until this is fixed:\n${detail}`,
    excludedDirectories: "Excluded directories",
    omitDirs: "Directories not to read (one name per line)",
    omitDirsHelp:
      "code-viewer does not read inside directories with these names: the file list, file search, grep, Data and the change watcher all skip them. Wildcards work as in .gitignore (*, ?, [abc], [!abc]).",
    excludeNames: "Names to hide completely",
    excludeNamesHelp:
      "Files and directories with these names disappear from the file list, search and grep results; the name itself is not shown either. The wildcards are the same as above.",
    reset: "Restore defaults",
    save: "Save changes",
    saving: "Saving…",
    saved: "Saved.",
    unsaved: "Unsaved changes.",
    saveNote: "Edits are not applied until you select Save changes.",
    watchLimitInvalid: (min, max) =>
      `Enter a whole number from ${min} to ${max}.`,
    scopeSource: (project, source) =>
      `These two lists apply to the project "${project}" only (${source}).`,
    scopeSaved: "saved value",
    scopeDefault: "default",
    uploadsTitle: "Uploads",
    uploadEnabledLabel: "Allow file uploads into worktree folders",
    uploadEnabledHelp:
      "Turn off to stop everyone who opens this project from uploading files into it.",
    agentNotifyTitle: "Agent notifications",
    agentNotifyWaitingLabel: "Notify when an agent starts waiting for input",
    agentNotifyDoneLabel: "Notify when an agent finishes working",
    agentNotifyHelp:
      "Shows a desktop notification. The first time, allow it in the browser with Enable notifications on the Agents screen. A pane you are looking at is not notified.",
    datastoreTitle: "Datastores",
    datastoreInferFkLabel:
      "Infer FK from Rails-style naming (<name>_id → <names>.id)",
    datastoreInferFkHelp:
      "Show inferred foreign-key links in the related-data panel for SQL tables.",
    datastoreS3TooltipLabel: "Show S3 object preview tooltip on hover",
    datastoreS3TooltipHelp:
      "Hovering an S3 object row shows the full key path and a content preview.",
    watchTitle: "File change watcher",
    watchLimit: "Maximum directories to watch",
    watchLimitHelp: (defaultLimit) =>
      `Higher values miss fewer changes in deep trees but use more file handles. Heavy directories can be left out under Files → Excluded directories. Default: ${defaultLimit}.`,
    agentRulesTitle: "Agent states from screen text",
    agentRulesPurpose:
      "Fix these when the hooks are not set up, or when an agent's screen changed and its state is read wrong. You normally leave them alone.",
    agentRulesEdit: "Edit the rules (JSON)",
    agentRulesLabel: "Rules (JSON)",
    agentRulesHelp: [
      "Each rule names a state (working, waiting, idle, or skip to keep the current one) and what must be on the screen, and where.",
      "When several rules match, the highest priority wins; on a tie, the rule written first wins. Saving checks every rule first and keeps the current rules if one is wrong.",
      "contains ignores letter case; regex does too with a leading (?i). Write AND / OR with all / any.",
      "To keep checks fast, regex allows one variable-length repeat and no groups, alternation or backreferences.",
    ],
    agentRulesGuideTitle: "JSON format and example",
    agentRulesGuideIntro:
      "Enter one object with version 1 and a rules array. Each rule needs the required fields listed below plus at least one matcher.",
    agentRulesGuideFields:
      "Required fields: id (unique name), state (working, waiting, idle, or skip), priority (higher wins), and region. lines is also required when region is bottom_non_empty.",
    agentRulesGuideMatchers:
      "Matchers: contains and regex test the selected region; lineRegex tests each line. Combine matcher objects with all, any, and not.",
    agentRulesGuideRegions:
      "Regions: osc_title checks the terminal title, whole_recent checks the recent screen, bottom_non_empty checks the last non-empty lines, and last_non_empty checks only the final non-empty line.",
    agentRulesGuideExample: RULES_EXAMPLE,
    agentRulesReset: "Use built-in rules",
    agentRulesSourceDefault: "In use: built-in rules",
    agentRulesSourceSaved: "In use: saved rules",
    agentRulesSourceEdited:
      "Edited: Save changes checks these rules and uses them right away.",
    agentRulesSourceRestore:
      "Built-in rules: Save changes removes the saved rules and uses the built-in ones.",
    categories: {
      appearance: {
        label: "Appearance",
        description:
          "Theme, language and text size. The same in every project.",
      },
      agents: {
        label: "Agents",
        description:
          "Notifications, and how agents tell code-viewer what they are doing.",
      },
      accounts: {
        label: "Accounts",
        description:
          "claude and codex accounts: sign-in, usage and the command that starts them.",
      },
      shortcuts: {
        label: "Shortcuts",
        description: "The keys for each action. Add, remove or restore them.",
      },
      files: {
        label: "Files",
        description:
          "Directories to skip or hide, and uploads. These apply to this project only.",
      },
      advanced: {
        label: "Advanced",
        description:
          "Settings you rarely change, such as Datastores and the screen-text rules for agent states.",
      },
    },
    searchPlaceholder: "Search settings",
    searchNoMatch: (query) => `No settings match "${query}".`,
  },
  ja: {
    display: "表示",
    theme: "テーマ",
    themeHelp:
      "選ぶとすぐに変わります。T キーでライトと、選んだダークを切り替えます。",
    themeNames: {
      dark: "ダーク (紫)",
      graphite: "ダーク (無彩色)",
      warm: "ダーク (暖かい灰色)",
      light: "ライト",
    },
    language: "言語",
    fileListFontSize: "UIの文字サイズ",
    fileListFontSizeHelp: "コードの本文以外のすべてに効きます。",
    codeFontSize: "コード表示の文字サイズ",
    sizeSmall: "小",
    sizeRegular: "標準",
    sizeLarge: "大",
    sizeExtraLarge: "特大",
    sharedTag: "全プロジェクト共通",
    sharedTagTitle:
      "全プロジェクト共通: ここで変えるとどのプロジェクトでも変わり、プロジェクトを移っても同じです。",
    userSettingsError: (detail) =>
      `全プロジェクト共通の設定を読めないため、このプロジェクトの設定を出しています。直るまで、ここの変更は保存されません:\n${detail}`,
    excludedDirectories: "除外するディレクトリ",
    omitDirs: "中を読まないディレクトリ (1 行に 1 つ)",
    omitDirsHelp:
      "この名前のディレクトリは中を読みません。ファイル一覧・ファイル検索・grep・データストア・変更の監視のすべてで飛ばします。.gitignore と同じ * ? [abc] [!abc] が使えます。",
    excludeNames: "完全に隠す名前",
    excludeNamesHelp:
      "この名前のファイルとディレクトリを、ファイル一覧・検索・grep の結果から消します。名前も出ません。書き方は上と同じです。",
    reset: "デフォルトに戻す",
    save: "変更を保存",
    saving: "保存しています…",
    saved: "保存しました。",
    unsaved: "未保存の変更があります。",
    saveNote: "「変更を保存」を押すまで、編集内容は適用されません。",
    watchLimitInvalid: (min, max) => `${min}〜${max}の整数を入力してください。`,
    scopeSource: (project, source) =>
      `この 2 つは、プロジェクト「${project}」だけの設定です (${source})。`,
    scopeSaved: "保存した値",
    scopeDefault: "既定の値",
    uploadsTitle: "アップロード",
    uploadEnabledLabel: "ワークツリーへのファイルアップロードを許可する",
    uploadEnabledHelp:
      "オフにすると、このプロジェクトを開く全員が、ファイルをアップロードできなくなります。",
    agentNotifyTitle: "エージェントの通知",
    agentNotifyWaitingLabel: "エージェントが入力待ちになったら通知する",
    agentNotifyDoneLabel: "エージェントの作業が終わったら通知する",
    agentNotifyHelp:
      "デスクトップに通知を出します。初めは、エージェントの画面の「通知を有効にする」でブラウザに許可します。いま見ているペインは通知しません。",
    datastoreTitle: "データストア",
    datastoreInferFkLabel:
      "Rails 命名規約 (<name>_id → <names>.id) から FK を推測",
    datastoreInferFkHelp:
      "SQL テーブルの関連データパネルに Rails 命名規約由来の仮想 FK リンクを表示します。",
    datastoreS3TooltipLabel: "S3 オブジェクトの hover プレビューを表示",
    datastoreS3TooltipHelp:
      "S3 オブジェクト行にホバーすると、完全な key とコンテンツプレビューを表示します。",
    watchTitle: "ファイル変更の監視",
    watchLimit: "監視するディレクトリ数の上限",
    watchLimitHelp: (defaultLimit) =>
      `大きくすると深いディレクトリの変更を取りこぼしにくくなりますが、ファイルハンドルを多く使います。重いディレクトリは「ファイル」の除外で外せます。既定: ${defaultLimit}。`,
    agentRulesTitle: "画面の文言による状態の判定",
    agentRulesPurpose:
      "フックを入れていないとき、またはエージェントの画面の表示が変わって状態の判定が外れたときに直すものです。普段は触りません。",
    agentRulesEdit: "ルールを編集する (JSON)",
    agentRulesLabel: "ルール (JSON)",
    agentRulesHelp: [
      "ルールごとに、状態 (working 作業中・waiting 入力待ち・idle 待機中・skip 今のまま) と、画面のどこに何があれば当てはまるかを書きます。",
      "複数が当てはまれば priority の大きいもの、同じなら先に書いたものを使います。保存の前に全部のルールを確かめ、誤りがあれば今のルールのまま残します。",
      "contains は大文字と小文字を区別せず、regex も先頭の (?i) で区別しなくなります。AND・OR は all・any で書きます。",
      "regex は、判定を速く保つため、可変長の繰り返しを 1 つまでとし、グループ・選択・後方参照は使えません。",
    ],
    agentRulesGuideTitle: "JSONの書式と入力例",
    agentRulesGuideIntro:
      "version が 1、rules が配列のJSONオブジェクトを入力します。各ルールには下記の必須項目と、1個以上の一致条件が必要です。",
    agentRulesGuideFields:
      "必須の項目: id (重ならない名前)・state・priority (大きいほど優先)・region。region が bottom_non_empty なら lines も要ります。",
    agentRulesGuideMatchers:
      "一致条件: contains と regex は選択した領域全体、lineRegex は各行を調べます。一致条件のオブジェクトは all / any / not で組み合わせられます。",
    agentRulesGuideRegions:
      "region: osc_title はターミナルタイトル、whole_recent は直近の画面全体、bottom_non_empty は末尾の非空行、last_non_empty は最後の非空行だけを調べます。",
    agentRulesGuideExample: RULES_EXAMPLE,
    agentRulesReset: "組み込みルールに戻す",
    agentRulesSourceDefault: "適用中: 組み込みルール",
    agentRulesSourceSaved: "適用中: 保存したルール",
    agentRulesSourceEdited: "編集中: 「変更を保存」で検証し、すぐに使います。",
    agentRulesSourceRestore:
      "組み込みルール: 「変更を保存」で保存したルールを消し、組み込みのルールを使います。",
    categories: {
      appearance: {
        label: "表示",
        description:
          "テーマ・言語・文字の大きさ。どのプロジェクトでも同じです。",
      },
      agents: {
        label: "エージェント",
        description: "通知と、エージェントが状態を知らせる仕組み。",
      },
      accounts: {
        label: "アカウント",
        description:
          "claude と codex のアカウント。ログイン・使用量・起動のコマンド。",
      },
      shortcuts: {
        label: "ショートカット",
        description: "操作ごとのキー。足す・外す・既定に戻すはここで。",
      },
      files: {
        label: "ファイル",
        description:
          "読まないディレクトリ・隠す名前と、アップロード。このプロジェクトだけの設定です。",
      },
      advanced: {
        label: "詳細",
        description:
          "めったに変えない設定。データストアの表示や、画面の文言による状態の判定など。",
      },
    },
    searchPlaceholder: "設定を検索",
    searchNoMatch: (query) => `「${query}」に当てはまる設定はありません。`,
  },
};
