// ビューア設定のフォーム。設定のページは描画のたびに枠を作り直すため、
// ここで作った root を使い回して入力中の下書きを保持する。値の保存や、
// フォント適用などの副作用は deps 経由で app.ts に任せる。
//
// 中身は状態 (下書き・保存の進み・出す節) から 1 つのテンプレートで描く。
// ほかの持ち主の節 (アカウント・エージェント連携・ショートカット・外部接続) は
// 要素のまま受け取って並べ、出す / 隠すだけをここが決める。

import { live } from "lit/directives/live.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { html, nothing, type TemplateResult } from "lit/html.js";
import {
  COLOR_THEMES,
  type ColorTheme,
  DEFAULT_COLOR_THEME,
  TERMINAL_TONES,
  type TerminalTone,
} from "../core/color-themes";
import { errorWithCause, formatErrorDetail } from "../core/error-detail";
import { SEARCH_16_PATH } from "../core/icons";
import {
  highlightToInnerHtml,
  loadShikiHighlighter,
  type ShikiHighlighter,
} from "../core/shiki-loader";
import {
  TERMINAL_IMAGE_SHELF_PLACEMENTS,
  type TerminalImageShelfPlacement,
} from "../core/terminal-images";
import { iconTemplate } from "./ui/icon";
import { renderOwned, templateElement } from "./ui/renderer";

export type ViewerSettingsText = {
  display: string;
  theme: string;
  themeHelp: string;
  /** 明暗を切り替えるキー (指の画面では出さない)。 */
  themeKeyHelp: string;
  themeNames: Record<ThemeChoice, string>;
  colorTheme: string;
  colorThemeHelp: string;
  colorThemeNames: Record<ColorTheme, string>;
  /** ターミナルの中の明暗 (常にダーク / 画面に合わせる)。 */
  terminalTone: string;
  terminalToneHelp: string;
  terminalToneNames: Record<TerminalTone, string>;
  /** ターミナルの画像の棚の置き場所。 */
  imageShelfPlacement: string;
  imageShelfPlacementHelp: string;
  imageShelfPlacementNames: Record<TerminalImageShelfPlacement, string>;
  language: string;
  fileListFontSize: string;
  fileListFontSizeHelp: string;
  codeFontSize: string;
  sizeSmall: string;
  sizeRegular: string;
  sizeLarge: string;
  sizeExtraLarge: string;
  /** 全プロジェクト共通の項目を持つ節の見出しに添える札。 */
  sharedTag: string;
  sharedTagTitle: string;
  userSettingsError: (detail: string) => string;
  excludedDirectories: string;
  omitDirs: string;
  omitDirsHelp: string;
  excludeNames: string;
  excludeNamesHelp: string;
  reset: string;
  save: string;
  saving: string;
  saved: string;
  unsaved: string;
  /** 保存の帯に、保存の要る変更が無い間に出す文。 */
  noChanges: string;
  saveNote: string;
  watchLimitInvalid: (min: number, max: number) => string;
  scopeSource: (project: string, source: string) => string;
  /** scopeSource の source: このプロジェクトに保存した値か、既定の値か。 */
  scopeSaved: string;
  scopeDefault: string;
  uploadsTitle: string;
  uploadEnabledLabel: string;
  uploadEnabledHelp: string;
  agentNotifyTitle: string;
  agentNotifyWaitingLabel: string;
  agentNotifyDoneLabel: string;
  agentNotifyHelp: string;
  datastoreTitle: string;
  datastoreInferFkLabel: string;
  datastoreInferFkHelp: string;
  datastoreS3TooltipLabel: string;
  datastoreS3TooltipHelp: string;
  watchTitle: string;
  watchLimit: string;
  watchLimitHelp: (defaultLimit: number) => string;
  agentRulesTitle: string;
  /** 何のための設定か (節の見出しの下に畳まずに出す 1 文)。 */
  agentRulesPurpose: string;
  /** 編集の欄を畳んだ details の summary。 */
  agentRulesEdit: string;
  agentRulesLabel: string;
  /** 書き方の説明。1 つが 1 段落。 */
  agentRulesHelp: readonly string[];
  agentRulesGuideTitle: string;
  agentRulesGuideIntro: string;
  agentRulesGuideFields: string;
  agentRulesGuideMatchers: string;
  agentRulesGuideRegions: string;
  agentRulesGuideExample: string;
  agentRulesReset: string;
  agentRulesSourceDefault: string;
  agentRulesSourceSaved: string;
  /** 規則を書き換えて、まだ保存していないとき */
  agentRulesSourceEdited: string;
  /** 「組み込みルールに戻す」を押して、まだ保存していないとき */
  agentRulesSourceRestore: string;
  /** 左の分類の名前と、分類を切り替えたときの見出しの下の 1 文。 */
  categories: Record<SettingsCategory, { label: string; description: string }>;
  searchPlaceholder: string;
  searchNoMatch: (query: string) => string;
};

/**
 * 打ち込む欄 (途中の値がありうる)。ページの「変更を保存」で保存する。
 */
export type ViewerSettingsDraft = {
  omitDirs: string;
  excludeNames: string;
  watchLimit: number;
};

/**
 * 選ぶ欄 (選択の欄・トグル)。選んだ時点で当てて保存する (保存の帯を通らない)。
 */
export type ViewerSettingsChoices = {
  language: string;
  sidebarFontSize: string;
  codeFontSize: string;
  terminalTone: string;
  terminalImageShelfPlacement: string;
  uploadEnabled: boolean;
  agentNotifyWaiting: boolean;
  agentNotifyDone: boolean;
  inferFkRails: boolean;
  s3TooltipEnabled: boolean;
};

export type ViewerSettingsValues = ViewerSettingsDraft &
  ViewerSettingsChoices & {
    /** 全プロジェクト共通の設定を読めなかった理由。空なら読めた。 */
    userSettingsError: string;
    watchLimitMin: number;
    watchLimitMax: number;
    watchLimitDefault: number;
    /**
     * 監視するディレクトリ数の上限が効くか。木全体を OS のハンドル 1 つで見る
     * OS (macOS・Windows) では効かないので、節を出さない。
     */
    watchLimitApplies: boolean;
    scopeSource: string;
    agentRulesJson: string;
    /** 組み込みの規則を agentRulesJson と同じ形で書いたもの (戻すときに欄へ入れる) */
    agentRulesDefaultJson: string;
    agentRulesSource: "default" | "saved";
    agentRulesErrors: string;
  };

/**
 * 設定の分類。設定のページの左の列に並べ、選んだ分類の節だけを出す。
 * フォームは 1 つのまま (下書きと「変更を保存」は分類をまたいで効く。保存の帯は
 * 打ち込む欄のある分類と、未保存の変更がある間だけ出す)。
 * よく使うものを先に、めったに変えないものは advanced へ。最初のものが
 * ページを開いたときの分類。
 */
export const SETTINGS_CATEGORIES = [
  "appearance",
  "agents",
  "accounts",
  "shortcuts",
  "files",
  "remote",
  "advanced",
] as const;
export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number];

/** 設定の「テーマ」の選択肢 (ライト 1 つとダークの色違い 3 つ)。 */
/** 明暗。テーマ (配色) は別に選ぶ (colorTheme)。 */
export const THEME_CHOICES = ["dark", "light"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/**
 * ページの「変更を保存」で一緒に保存する、ほかの節の下書き (アカウントの
 * 起動コマンド)。保存の口はページに 1 つだけにする (節ごとの「保存」を
 * 置かない)。変わったら listener を呼ぶ。
 */
export type SettingsDraft = {
  dirty(): boolean;
  /**
   * 保存できない理由 (直すまで何も保存しない)。無ければ null。ショートカットの
   * JSON に誤りがある間など。
   */
  problem?(): string | null;
  save(): Promise<void>;
  subscribe(listener: () => void): void;
};

export type ViewerSettingsDeps = {
  getText(): ViewerSettingsText;
  /**
   * 明暗とテーマ。選ぶ欄 (onChoose) と同じく、選んだ時点で当てて保存する。
   */
  getTheme(): ThemeChoice;
  setTheme(choice: ThemeChoice): void;
  getColorTheme(): ColorTheme;
  setColorTheme(theme: ColorTheme): void;
  getValues(): ViewerSettingsValues;
  getDefaultValues(): ViewerSettingsDraft;
  refresh(): Promise<void>;
  /** 選ぶ欄を選んだ。その場で当てて保存する (失敗は持ち主が知らせる)。 */
  onChoose(choice: Partial<ViewerSettingsChoices>): void;
  onSave(
    draft: ViewerSettingsDraft,
    options: {
      restoreDefaults: boolean;
      changedFields: readonly (keyof ViewerSettingsDraft)[];
    },
  ): Promise<void>;
  onAgentRulesSave(value: string): Promise<void>;
  onAgentRulesReset(): Promise<void>;
  /**
   * 通知の節の次に置く節 (エージェント連携)。中身と取得・文言の切り替えは
   * 持ち主 (views/agents/agent-hooks-settings.ts) が行う。
   */
  agentHooksSection: HTMLElement;
  /** エージェント連携の前に置く節 (アカウント)。持ち主は accounts-settings.ts。 */
  agentAccountsSection: HTMLElement;
  /** ショートカットの節。持ち主は help-keybinding-editor.ts。 */
  shortcutsSection: HTMLElement;
  /** 外部接続の節。持ち主は remote-access-settings.ts。 */
  remoteAccessSection: HTMLElement;
  /**
   * ページの「変更を保存」で一緒に保存する節の下書き。下書きを持つ節は
   * accounts・shortcuts・remote (保存の帯をその分類に出す)。
   */
  drafts: readonly SettingsDraft[];
};

/**
 * テーマの見本の中身。コードの 1 行・削除と追加の行 (語の強調つき)・コメント。
 * 色は見本の箱が持つそのテーマの名前の層から読む (style.css の .theme-swatch)。
 */
const THEME_SWATCH = html`<span class="theme-swatch-line"><span class="theme-swatch-keyword">const</span> <span class="theme-swatch-function">total</span> = <span class="theme-swatch-string">"a"</span></span><span class="theme-swatch-line theme-swatch-del">− <span class="theme-swatch-type">1</span><span class="theme-swatch-word">0</span></span><span class="theme-swatch-line theme-swatch-add">+ <span class="theme-swatch-type">1</span><span class="theme-swatch-word">5</span></span><span class="theme-swatch-line theme-swatch-comment">// sum</span>`;

const FONT_SIZE_VALUES = ["compact", "regular", "large", "xlarge"] as const;
type FontSizeValue = (typeof FONT_SIZE_VALUES)[number];
const LANGUAGE_VALUES = [
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
] as const;
const GENERAL_SETTING_FIELDS: readonly (keyof ViewerSettingsDraft)[] = [
  "omitDirs",
  "excludeNames",
  "watchLimit",
];

/** 節。own はここが描く節、ほかは持ち主から受け取る要素。 */
type SectionKey =
  | "display"
  | "agentNotify"
  | "agentHooks"
  | "accounts"
  | "shortcuts"
  | "excluded"
  | "uploads"
  | "remote"
  | "datastores"
  | "watch"
  | "rules";

/** 並びは分類の並び (検索の結果もこの順に出る)。 */
const SECTION_ORDER: readonly (readonly [SectionKey, SettingsCategory])[] = [
  ["display", "appearance"],
  ["agentNotify", "agents"],
  ["agentHooks", "agents"],
  ["accounts", "accounts"],
  ["shortcuts", "shortcuts"],
  ["excluded", "files"],
  ["uploads", "files"],
  ["remote", "remote"],
  ["datastores", "advanced"],
  ["watch", "advanced"],
  ["rules", "advanced"],
];

/**
 * 「デフォルトに戻す」が戻す項目 (打ち込む欄) を持つ節。どれも出ていない分類
 * では、ページの下の「デフォルトに戻す」を出さない (戻すものが無い)。
 */
const GENERAL_SECTIONS: readonly SectionKey[] = ["excluded", "watch"];
/**
 * 「変更を保存」で保存する欄を持つ節。どれも出ていない分類 (表示・エージェント)
 * では保存の帯を出さない (選ぶ欄はすぐ効くので、押すものが無い)。
 */
const SAVED_SECTIONS: readonly SectionKey[] = [
  "excluded",
  "watch",
  "rules",
  "accounts",
  "shortcuts",
  "remote",
];

/** すぐ当てて保存するチェックボックス (欄の id と値の名前)。 */
const TOGGLES = {
  uploadEnabled: "upload-enabled",
  agentNotifyWaiting: "agent-notify-waiting",
  agentNotifyDone: "agent-notify-done",
  inferFkRails: "datastore-infer-fk",
  s3TooltipEnabled: "datastore-s3-tooltip",
} as const;
type ToggleField = keyof typeof TOGGLES;

/** 下書きの欄の id (焦点のある欄は取り直しで書き換えない)。 */
const DRAFT_FIELD_IDS = {
  omitDirs: "scope-omit-dirs",
  excludeNames: "scope-exclude-names",
  watchLimit: "scope-watch-limit",
} as const;

export function createViewerSettings(deps: ViewerSettingsDeps) {
  // 節の箱。設定のページが置き、中はここが描く (ページを描き直しても使い回す)。
  let root: HTMLElement | null = null;
  // 検索欄の箱。設定のページの見出しの下に置く。
  const searchWrap = templateElement(
    html`<div class="scope-settings-search-wrap"></div>`,
  );
  let category: SettingsCategory = SETTINGS_CATEGORIES[0];
  let query = "";
  /** 持ち主から受け取る節。 */
  const external: Partial<Record<SectionKey, HTMLElement>> = {
    agentHooks: deps.agentHooksSection,
    accounts: deps.agentAccountsSection,
    shortcuts: deps.shortcutsSection,
    remote: deps.remoteAccessSection,
  };
  /** 出す節と、分類に 1 つだけの節 (見出しを出さない)。applyCategory が決める。 */
  const visible = new Map<SectionKey, boolean>();
  let sole: SectionKey | null = null;

  /** 最後に読んだ値 (sync が取り直す)。 */
  let values: ViewerSettingsValues | null = null;
  /** 選ぶ欄の今の値 (選んだらすぐ持つ。sync が保存してある値に合わせる)。 */
  let choices: ViewerSettingsChoices | null = null;
  let themeChoice: ThemeChoice = "dark";
  let colorTheme: ColorTheme = DEFAULT_COLOR_THEME;
  /** 打ち込む欄の下書き。 */
  const general = { omitDirs: "", excludeNames: "", watchLimit: "" };
  let agentRulesValue = "";

  let generalDirty = false;
  let generalSavePending = false;
  let restoreDefaults = false;
  const changedGeneralFields = new Set<keyof ViewerSettingsDraft>();
  let generalStatus: "idle" | "dirty" | "saving" | "saved" = "idle";
  /**
   * 判定ルールの下書き。保存はページの「変更を保存」だけ (節の中に保存を置かない)。
   * restore は「組み込みルールに戻す」を押した後 (保存すると保存した規則を消す)。
   */
  let agentRulesDirty = false;
  let agentRulesRestore = false;
  let agentRulesError = "";
  let agentRulesHighlightError = "";
  let jsonHighlighter: ShikiHighlighter | null = null;
  /** 色付けした規則 (同じ文字なら色付けし直さない)。 */
  let highlighted: { source: string; html: string; by: unknown } | null = null;
  let saveError = "";
  let refreshError = "";
  let refreshGeneration = 0;

  function sectionElement(key: SectionKey): HTMLElement | null {
    return (
      external[key] ??
      root?.querySelector<HTMLElement>(`[data-settings-section="${key}"]`) ??
      null
    );
  }

  function byId<T extends HTMLElement>(id: string): T | null {
    return (root?.querySelector<T>(`#${id}`) ?? null) as T | null;
  }

  /** 焦点のある欄は、取り直しの値で書き換えない (force は「デフォルトに戻す」)。 */
  function focused(id: string): boolean {
    const element = byId(id);
    return element !== null && element === document.activeElement;
  }

  // ---- 描く ----------------------------------------------------------------

  function sectionClass(key: SectionKey, extra = ""): string {
    return [
      "scope-settings-section",
      extra,
      sole === key ? "scope-settings-section-sole" : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  function sharedTagTemplate(text: ViewerSettingsText): TemplateResult {
    return html`<span class="scope-settings-shared" title=${text.sharedTagTitle}
      >${text.sharedTag}</span
    >`;
  }

  function help(id: string, text: unknown): TemplateResult {
    return html`<p class="scope-settings-help" id=${id}>${text}</p>`;
  }

  function errorLine(id: string, text: string): TemplateResult {
    return html`<p
      class="scope-settings-help scope-settings-refresh-error"
      id=${id}
      ?hidden=${!text}
    >${text}</p>`;
  }

  function selectTemplate<T extends string>(
    id: string,
    current: string,
    options: readonly { value: T; label: string }[],
    onChange: (value: string) => void,
  ): TemplateResult {
    return html`<select
      id=${id}
      .value=${live(current)}
      @change=${(event: Event) =>
        onChange((event.currentTarget as HTMLSelectElement).value)}
    >${options.map(
      (option) =>
        html`<option value=${option.value} ?selected=${option.value === current}
          >${option.label}</option
        >`,
    )}</select>`;
  }

  function toggleTemplate(
    field: ToggleField,
    label: string,
    checked: boolean,
  ): TemplateResult {
    return html`<label class="scope-settings-toggle"><input
        type="checkbox"
        id=${TOGGLES[field]}
        .checked=${live(checked)}
        @change=${(event: Event) => {
          const next = (event.currentTarget as HTMLInputElement).checked;
          if (choices) choices = { ...choices, [field]: next };
          deps.onChoose({ [field]: next });
        }}
      /><span>${label}</span></label>`;
  }

  /** 選ぶ欄は選んだ時点で当てて保存する (下書きにしない)。 */
  function choose<K extends keyof ViewerSettingsChoices>(
    field: K,
    value: string,
  ): void {
    if (choices) choices = { ...choices, [field]: value };
    deps.onChoose({ [field]: value } as Partial<ViewerSettingsChoices>);
  }

  function colorThemePickerTemplate(text: ViewerSettingsText): TemplateResult {
    // 各見本はライトとダークの小さなコードと差分を並べ、そのテーマの名前の層の色
    // (html と同じ data-color-theme / data-theme) で描く。押すとすぐに当てる
    // (明暗はそのまま)。
    return html`<div
      id="viewer-color-theme"
      class="theme-picker"
      role="group"
      aria-labelledby="viewer-color-theme-label"
    >${COLOR_THEMES.map(
      (id) => html`<button
        type="button"
        class="theme-choice"
        data-color-theme-choice=${id}
        aria-pressed=${String(id === colorTheme)}
        @click=${() => deps.setColorTheme(id)}
      ><span class="theme-swatch" aria-hidden="true">${[...THEME_CHOICES]
        .reverse()
        .map(
          (mode) => html`<span
            class="theme-swatch-pane"
            data-theme=${mode}
            data-color-theme=${id === DEFAULT_COLOR_THEME ? nothing : id}
          >${THEME_SWATCH}</span>`,
        )}</span><span class="theme-choice-name">${text.colorThemeNames[id]}</span></button>`,
    )}</div>`;
  }

  function displayTemplate(
    text: ViewerSettingsText,
    v: ViewerSettingsValues,
    c: ViewerSettingsChoices,
  ): TemplateResult {
    const sizes = FONT_SIZE_VALUES.map((value) => ({
      value,
      label: (
        {
          compact: text.sizeSmall,
          regular: text.sizeRegular,
          large: text.sizeLarge,
          xlarge: text.sizeExtraLarge,
        } satisfies Record<FontSizeValue, string>
      )[value],
    }));
    return html`<div
      class=${sectionClass("display")}
      data-settings-section="display"
      ?hidden=${!visible.get("display")}
    ><div class="scope-settings-title-row"><strong
        class="scope-settings-section-title"
        id="display-section-title"
      >${text.display}</strong>${sharedTagTemplate(text)}</div><label
      id="viewer-color-theme-label"
    >${text.colorTheme}</label>${colorThemePickerTemplate(text)}${help(
      "viewer-color-theme-help",
      text.colorThemeHelp,
    )}<label for="viewer-theme">${text.theme}</label>${selectTemplate(
      "viewer-theme",
      themeChoice,
      THEME_CHOICES.map((value) => ({
        value,
        label: text.themeNames[value] ?? value,
      })),
      (value) => {
        const choice = THEME_CHOICES.find((item) => item === value);
        if (!choice) return;
        themeChoice = choice;
        deps.setTheme(choice);
      },
    )}${help(
      "viewer-theme-help",
      html`${text.themeHelp}<span class="gdp-key-hint">${text.themeKeyHelp}</span>`,
    )}<label for="viewer-terminal-tone">${text.terminalTone}</label>${selectTemplate(
      "viewer-terminal-tone",
      c.terminalTone,
      TERMINAL_TONES.map((value) => ({
        value,
        label: text.terminalToneNames[value] ?? value,
      })),
      (value) => choose("terminalTone", value),
    )}${help("viewer-terminal-tone-help", text.terminalToneHelp)}<label
      for="viewer-image-shelf-placement"
    >${text.imageShelfPlacement}</label>${selectTemplate(
      "viewer-image-shelf-placement",
      c.terminalImageShelfPlacement,
      TERMINAL_IMAGE_SHELF_PLACEMENTS.map((value) => ({
        value,
        label: text.imageShelfPlacementNames[value] ?? value,
      })),
      (value) => choose("terminalImageShelfPlacement", value),
    )}${help("viewer-image-shelf-placement-help", text.imageShelfPlacementHelp)}<label
      for="viewer-language"
    >${text.language}</label>${selectTemplate(
      "viewer-language",
      c.language,
      LANGUAGE_VALUES,
      (value) => choose("language", value),
    )}<label for="sidebar-font-size">${text.fileListFontSize}</label>${selectTemplate(
      "sidebar-font-size",
      c.sidebarFontSize,
      sizes,
      (value) => choose("sidebarFontSize", value),
    )}${help("ui-font-size-help", text.fileListFontSizeHelp)}<label
      for="code-font-size"
    >${text.codeFontSize}</label>${selectTemplate(
      "code-font-size",
      c.codeFontSize,
      sizes,
      (value) => choose("codeFontSize", value),
    )}${errorLine(
      "user-settings-error",
      v.userSettingsError ? text.userSettingsError(v.userSettingsError) : "",
    )}</div>`;
  }

  function textareaTemplate(
    field: "omitDirs" | "excludeNames",
    rows: number,
  ): TemplateResult {
    return html`<textarea
      id=${DRAFT_FIELD_IDS[field]}
      rows=${rows}
      spellcheck="false"
      ?disabled=${generalSavePending}
      .value=${live(general[field])}
      @input=${(event: Event) => {
        if (generalSavePending) return;
        general[field] = (event.currentTarget as HTMLTextAreaElement).value;
        markGeneralDirty(field);
      }}
    ></textarea>`;
  }

  function watchTemplate(
    text: ViewerSettingsText,
    v: ViewerSettingsValues,
  ): TemplateResult {
    // スライダーと数の欄は同じ値を持つ (どちらを動かしても、もう片方が付いてくる)。
    const onWatch = (event: Event) => {
      if (generalSavePending) return;
      general.watchLimit = (event.currentTarget as HTMLInputElement).value;
      markGeneralDirty("watchLimit");
    };
    return html`<div
      class=${sectionClass("watch")}
      id="watch-settings-section"
      data-settings-section="watch"
      ?hidden=${!visible.get("watch")}
    ><strong class="scope-settings-section-title" id="watch-section-title"
        >${text.watchTitle}</strong
      ><label for="scope-watch-limit">${text.watchLimit}</label><div
        class="scope-watch-limit-row"
      ><input
        id="scope-watch-limit-range"
        type="range"
        step="16"
        min=${v.watchLimitMin}
        max=${v.watchLimitMax}
        aria-label=${text.watchLimit}
        ?disabled=${generalSavePending}
        .value=${live(general.watchLimit)}
        @input=${onWatch}
        @change=${onWatch}
      /><input
        id="scope-watch-limit"
        type="number"
        step="1"
        min=${v.watchLimitMin}
        max=${v.watchLimitMax}
        ?disabled=${generalSavePending}
        .value=${live(general.watchLimit)}
        @input=${onWatch}
        @change=${onWatch}
      /></div>${help("scope-watch-limit-help", text.watchLimitHelp(v.watchLimitDefault))}</div>`;
  }

  function agentRulesHighlightHtml(): string {
    if (
      highlighted?.source !== agentRulesValue ||
      highlighted.by !== jsonHighlighter
    ) {
      highlighted = {
        source: agentRulesValue,
        html: highlightToInnerHtml(agentRulesValue, "json", jsonHighlighter),
        by: jsonHighlighter,
      };
    }
    return highlighted.html;
  }

  function agentRulesSourceText(
    text: ViewerSettingsText,
    v: ViewerSettingsValues,
  ): string {
    return agentRulesDirty
      ? agentRulesRestore
        ? text.agentRulesSourceRestore
        : text.agentRulesSourceEdited
      : v.agentRulesSource === "saved"
        ? text.agentRulesSourceSaved
        : text.agentRulesSourceDefault;
  }

  function rulesTemplate(
    text: ViewerSettingsText,
    v: ViewerSettingsValues,
  ): TemplateResult {
    const code = agentRulesHighlightHtml();
    // 誤りは畳んだ中に入れない (閉じたままでも読めるように)。編集の欄は既定で
    // 畳む。普段は触らないもので、開いたままだと長い JSON が分類の大半を占めていた。
    return html`<div
      class=${sectionClass("rules", "agent-screen-rules-section")}
      data-settings-section="rules"
      ?hidden=${!visible.get("rules")}
    ><strong class="scope-settings-section-title" id="agent-screen-rules-title"
        >${text.agentRulesTitle}</strong
      >${help("agent-screen-rules-purpose", text.agentRulesPurpose)}${help(
        "agent-screen-rules-source",
        agentRulesSourceText(text, v),
      )}${errorLine("agent-screen-rules-error", agentRulesError)}${errorLine(
        "agent-screen-rules-highlight-error",
        agentRulesHighlightError,
      )}<details id="agent-screen-rules-details" class="agent-screen-rules-details"
        ><summary>${text.agentRulesEdit}</summary><label for="agent-screen-rules"
          >${text.agentRulesLabel}</label
        ><div id="agent-screen-rules-help">${text.agentRulesHelp.map(
          (paragraph) => html`<p class="scope-settings-help">${paragraph}</p>`,
        )}</div><details id="agent-screen-rules-guide" class="agent-screen-rules-guide" open
          ><summary>${text.agentRulesGuideTitle}</summary><p class="scope-settings-help"
            >${text.agentRulesGuideIntro}</p
          ><p class="scope-settings-help">${text.agentRulesGuideFields}</p><p
            class="scope-settings-help"
          >${text.agentRulesGuideMatchers}</p><p class="scope-settings-help"
            >${text.agentRulesGuideRegions}</p
          ><pre class="agent-screen-rules-guide-example">${text.agentRulesGuideExample}</pre></details
        ><div class="agent-screen-rules-editor"><pre
          class="agent-screen-rules-highlight"
          aria-hidden="true"
        >${code ? unsafeHTML(code) : agentRulesValue}</pre><textarea
          id="agent-screen-rules"
          rows="24"
          spellcheck="false"
          aria-describedby="agent-screen-rules-help agent-screen-rules-source agent-screen-rules-error agent-screen-rules-highlight-error"
          ?disabled=${generalSavePending}
          .value=${live(agentRulesValue)}
          @input=${(event: Event) => {
            if (generalSavePending) return;
            agentRulesValue = (event.currentTarget as HTMLTextAreaElement)
              .value;
            markAgentRulesDirty(false);
          }}
          @scroll=${syncAgentRulesScroll}
        ></textarea></div><div class="scope-settings-actions"><button
          type="button"
          class="gdp-btn"
          id="agent-screen-rules-reset"
          ?disabled=${generalSavePending}
          @click=${() => {
            // 組み込みの規則を欄に入れるだけ。保存するまで今の規則のまま動く。
            agentRulesValue = deps.getValues().agentRulesDefaultJson;
            markAgentRulesDirty(true);
          }}
        >${text.agentRulesReset}</button></div></details
      ></div>`;
  }

  function footerTemplate(text: ViewerSettingsText): TemplateResult {
    const dirty = anyDirty();
    const state =
      generalStatus === "saving"
        ? "saving"
        : dirty
          ? "unsaved"
          : generalStatus === "saved"
            ? "saved"
            : "clean";
    // 保存の帯は、保存する欄のある節が出ている間と、ほかの分類に未保存の変更が
    // 残っている間 (保存の口をなくさない) だけ出す。
    const hidden =
      !SAVED_SECTIONS.some((key) => visible.get(key)) &&
      !dirty &&
      !generalSavePending;
    return html`<div class="scope-settings-footer" ?hidden=${hidden}>${help(
      "scope-settings-save-note",
      text.saveNote,
    )}<p
      class="scope-settings-help"
      id="scope-settings-save-status"
      aria-live="polite"
      data-state=${state}
    >${
      state === "saving"
        ? text.saving
        : state === "unsaved"
          ? text.unsaved
          : state === "saved"
            ? text.saved
            : text.noChanges
    }</p>${errorLine("scope-settings-save-error", saveError)}${errorLine(
      "scope-settings-refresh-error",
      refreshError,
    )}<div class="scope-settings-actions"><button
      id="scope-omit-reset"
      type="button"
      class="gdp-btn"
      ?hidden=${!GENERAL_SECTIONS.some((key) => visible.get(key))}
      ?disabled=${generalSavePending}
      @click=${() => {
        applyGeneralFields(deps.getDefaultValues(), true);
        restoreDefaults = true;
        changedGeneralFields.clear();
        for (const field of GENERAL_SETTING_FIELDS)
          changedGeneralFields.add(field);
        generalDirty = true;
        generalStatus = "dirty";
        saveError = "";
        draw();
      }}
    >${text.reset}</button><button
      id="scope-settings-save"
      type="button"
      class="scope-settings-primary-action"
      ?disabled=${generalSavePending || !dirty}
      @click=${() => {
        void saveChanges();
      }}
    >${generalStatus === "saving" ? text.saving : text.save}</button></div></div>`;
  }

  function formTemplate(): TemplateResult | typeof nothing {
    const v = values;
    const c = choices;
    if (!v || !c) return nothing;
    const text = deps.getText();
    const ownSection = (
      key: SectionKey,
      id: string,
      title: string,
      content: unknown,
      titleTag?: TemplateResult,
    ) => html`<div
      class=${sectionClass(key)}
      data-settings-section=${key}
      ?hidden=${!visible.get(key)}
    >${
      titleTag
        ? html`<div class="scope-settings-title-row"><strong
              class="scope-settings-section-title"
              id=${id}
            >${title}</strong>${titleTag}</div>`
        : html`<strong class="scope-settings-section-title" id=${id}>${title}</strong>`
    }${content}</div>`;
    const sections: Record<SectionKey, unknown> = {
      display: displayTemplate(text, v, c),
      uploads: ownSection(
        "uploads",
        "upload-section-title",
        text.uploadsTitle,
        html`${toggleTemplate("uploadEnabled", text.uploadEnabledLabel, c.uploadEnabled)}${help(
          "upload-help",
          text.uploadEnabledHelp,
        )}`,
      ),
      // エージェント一覧の「通知は有効です」から、この見出しへ飛んでくる。節は
      // 見出し → 何のための設定かの 1 文 → 操作 (説明は 2 つのチェックボックスの両方に掛かる)。
      agentNotify: ownSection(
        "agentNotify",
        "agent-notify-section-title",
        text.agentNotifyTitle,
        html`${help("agent-notify-help", text.agentNotifyHelp)}${toggleTemplate(
          "agentNotifyWaiting",
          text.agentNotifyWaitingLabel,
          c.agentNotifyWaiting,
        )}${toggleTemplate("agentNotifyDone", text.agentNotifyDoneLabel, c.agentNotifyDone)}`,
        sharedTagTemplate(text),
      ),
      excluded: ownSection(
        "excluded",
        "excluded-section-title",
        text.excludedDirectories,
        html`<label for="scope-omit-dirs">${text.omitDirs}</label>${textareaTemplate(
          "omitDirs",
          6,
        )}${help("scope-omit-dirs-help", text.omitDirsHelp)}<label
            for="scope-exclude-names"
          >${text.excludeNames}</label
          >${textareaTemplate("excludeNames", 4)}${help(
            "scope-exclude-names-help",
            text.excludeNamesHelp,
          )}<p id="scope-omit-source">${v.scopeSource}</p>`,
      ),
      datastores: ownSection(
        "datastores",
        "datastore-section-title",
        text.datastoreTitle,
        html`${toggleTemplate("inferFkRails", text.datastoreInferFkLabel, c.inferFkRails)}${help(
          "datastore-infer-fk-help",
          text.datastoreInferFkHelp,
        )}${toggleTemplate(
          "s3TooltipEnabled",
          text.datastoreS3TooltipLabel,
          c.s3TooltipEnabled,
        )}${help("datastore-s3-tooltip-help", text.datastoreS3TooltipHelp)}`,
      ),
      watch: watchTemplate(text, v),
      rules: rulesTemplate(text, v),
      agentHooks: deps.agentHooksSection,
      accounts: deps.agentAccountsSection,
      shortcuts: deps.shortcutsSection,
      remote: deps.remoteAccessSection,
    };
    const trimmed = query.trim();
    const shown = SECTION_ORDER.some(([key]) => visible.get(key));
    return html`<p
      class="scope-settings-help"
      id="scope-settings-search-empty"
      ?hidden=${!trimmed || shown}
    >${trimmed ? text.searchNoMatch(trimmed) : ""}</p>${SECTION_ORDER.map(
      ([key]) => sections[key],
    )}${footerTemplate(text)}`;
  }

  function searchTemplate(): TemplateResult {
    const text = deps.getText();
    return html`${iconTemplate(SEARCH_16_PATH, "scope-settings-search-icon")}<input
      type="search"
      id="scope-settings-search"
      class="scope-settings-search"
      autocomplete="off"
      spellcheck="false"
      placeholder=${text.searchPlaceholder}
      aria-label=${text.searchPlaceholder}
      .value=${live(query)}
      @input=${(event: Event) => {
        query = (event.currentTarget as HTMLInputElement).value;
        applyCategory();
      }}
    />`;
  }

  function drawSearch(): void {
    renderOwned(searchWrap, searchTemplate());
  }

  function draw(): void {
    drawSearch();
    if (!root) return;
    renderOwned(root, formTemplate());
    // 持ち主から受け取った節は、出す / 隠すと見出しの省き方だけをここが決める。
    for (const [key, element] of Object.entries(external) as [
      SectionKey,
      HTMLElement,
    ][]) {
      element.hidden = !visible.get(key);
      element.classList.toggle("scope-settings-section-sole", sole === key);
    }
    syncAgentRulesScroll();
  }

  // ---- 状態 ----------------------------------------------------------------

  function anyDirty(): boolean {
    return (
      generalDirty ||
      agentRulesDirty ||
      deps.drafts.some((draft) => draft.dirty())
    );
  }

  function markAgentRulesDirty(restore: boolean): void {
    agentRulesDirty = true;
    agentRulesRestore = restore;
    agentRulesError = "";
    generalStatus = "dirty";
    saveError = "";
    draw();
  }

  function markGeneralDirty(field: keyof ViewerSettingsDraft): void {
    changedGeneralFields.add(field);
    generalDirty = true;
    restoreDefaults = false;
    generalStatus = "dirty";
    byId<HTMLInputElement>("scope-watch-limit")?.setCustomValidity("");
    saveError = "";
    draw();
  }

  function applyGeneralFields(next: ViewerSettingsDraft, force = false): void {
    for (const field of GENERAL_SETTING_FIELDS) {
      if (!force && focused(DRAFT_FIELD_IDS[field])) continue;
      general[field] = String(next[field]);
    }
  }

  /** 選ぶ欄に保存してある値を映す (下書きが無いので、いつでも今の値)。 */
  function applyChoices(next: ViewerSettingsChoices): void {
    choices = {
      language: next.language,
      sidebarFontSize: next.sidebarFontSize,
      codeFontSize: next.codeFontSize,
      terminalTone: next.terminalTone,
      terminalImageShelfPlacement: next.terminalImageShelfPlacement,
      uploadEnabled: next.uploadEnabled,
      agentNotifyWaiting: next.agentNotifyWaiting,
      agentNotifyDone: next.agentNotifyDone,
      inferFkRails: next.inferFkRails,
      s3TooltipEnabled: next.s3TooltipEnabled,
    };
  }

  function readGeneralDraft(): ViewerSettingsDraft | null {
    const current = deps.getValues();
    const watchLimit = Number(general.watchLimit);
    const field = byId<HTMLInputElement>("scope-watch-limit");
    if (
      !Number.isInteger(watchLimit) ||
      watchLimit < current.watchLimitMin ||
      watchLimit > current.watchLimitMax
    ) {
      const message = deps
        .getText()
        .watchLimitInvalid(current.watchLimitMin, current.watchLimitMax);
      field?.setCustomValidity(message);
      saveError = message;
      generalStatus = "dirty";
      draw();
      return null;
    }
    field?.setCustomValidity("");
    return {
      omitDirs: general.omitDirs,
      excludeNames: general.excludeNames,
      watchLimit,
    };
  }

  async function saveChanges(): Promise<void> {
    if (generalSavePending || !anyDirty()) return;
    // 1 つでも保存できない節があれば、ほかの節も保存しない (半分だけ保存しない)。
    const problems = deps.drafts
      .map((section) => section.problem?.() ?? null)
      .filter((problem): problem is string => !!problem);
    if (problems.length) {
      saveError = problems.join("\n");
      draw();
      return;
    }
    const draft = generalDirty ? readGeneralDraft() : null;
    if (generalDirty && !draft) return;
    refreshGeneration += 1;
    generalSavePending = true;
    generalStatus = "saving";
    saveError = "";
    draw();
    let completed = false;
    try {
      if (draft) {
        await deps.onSave(draft, {
          restoreDefaults,
          changedFields: [...changedGeneralFields],
        });
        generalDirty = false;
        restoreDefaults = false;
        changedGeneralFields.clear();
      }
      if (agentRulesDirty) {
        await saveAgentRules();
        agentRulesDirty = false;
        agentRulesRestore = false;
      }
      for (const section of deps.drafts) {
        if (section.dirty()) await section.save();
      }
      generalStatus = "saved";
      completed = true;
    } catch (error) {
      console.error("[code-viewer] viewer settings save failed", error);
      saveError = formatErrorDetail(error);
      generalStatus = "dirty";
    } finally {
      generalSavePending = false;
      if (completed) sync();
      else draw();
    }
  }

  async function initializeJsonHighlighting(): Promise<void> {
    try {
      jsonHighlighter = await loadShikiHighlighter({
        langs: ["json"],
        failureMode: "throw",
      });
      if (!jsonHighlighter) {
        throw new Error("JSON syntax highlighting could not be loaded");
      }
      draw();
    } catch (error) {
      console.error("[code-viewer] JSON syntax highlighting failed", error);
      agentRulesHighlightError = formatErrorDetail(error);
      draw();
    }
  }

  function syncAgentRulesScroll(): void {
    const editor = byId<HTMLTextAreaElement>("agent-screen-rules");
    const highlight = root?.querySelector<HTMLElement>(
      ".agent-screen-rules-highlight",
    );
    if (!editor || !highlight) return;
    highlight.scrollTop = editor.scrollTop;
    highlight.scrollLeft = editor.scrollLeft;
  }

  /**
   * 判定ルールを保存する (ページの「変更を保存」から)。検証の誤りは欄の下にも
   * 出す (どの規則のどこが違うかを、書いている欄のそばで読めるように)。
   */
  async function saveAgentRules(): Promise<void> {
    try {
      if (agentRulesRestore) await deps.onAgentRulesReset();
      else await deps.onAgentRulesSave(agentRulesValue);
    } catch (error) {
      agentRulesError = formatErrorDetail(error);
      throw errorWithCause("save the terminal status rules", error);
    }
  }

  function build(): HTMLElement {
    const element = templateElement(html`<div class="scope-settings"></div>`);
    for (const draft of deps.drafts) {
      draft.subscribe(() => {
        if (draft.dirty()) {
          generalStatus = "dirty";
          saveError = "";
        } else if (!anyDirty() && generalStatus === "dirty") {
          generalStatus = "idle";
        }
        draw();
      });
    }
    void initializeJsonHighlighting();
    return element;
  }

  function sync(): void {
    if (!root) return;
    const next = deps.getValues();
    values = next;
    if (!generalDirty && !generalSavePending) applyGeneralFields(next);
    applyChoices(next);
    if (!focused("viewer-theme")) themeChoice = deps.getTheme();
    colorTheme = deps.getColorTheme();
    // 書きかけの規則 (と、保存に失敗した誤りの表示) は保存するまで残す。
    if (!agentRulesDirty && !generalSavePending) {
      if (!focused("agent-screen-rules")) agentRulesValue = next.agentRulesJson;
      agentRulesError = next.agentRulesErrors;
    }
    // 取り直しで監視の上限が効くかが分かる (watchLimitApplies)。
    applyCategory();
  }

  function mount(host: HTMLElement): void {
    const first = !root;
    if (!root) root = build();
    const active = document.activeElement;
    const focusedElement =
      active instanceof HTMLElement && root.contains(active) ? active : null;
    const caret =
      focusedElement instanceof HTMLTextAreaElement ||
      focusedElement instanceof HTMLInputElement
        ? {
            start: focusedElement.selectionStart,
            end: focusedElement.selectionEnd,
          }
        : null;

    host.appendChild(root);

    if (focusedElement) {
      focusedElement.focus();
      if (caret && caret.start !== null && caret.end !== null) {
        (focusedElement as HTMLTextAreaElement).setSelectionRange(
          caret.start,
          caret.end,
        );
      }
    }
    refreshError = "";
    sync();
    // 初めて描いた後に、節の文字で検索の当たりを決め直す (描く前は文字が無い)。
    if (first) applyCategory();
    const generation = ++refreshGeneration;
    void deps.refresh().then(
      () => {
        if (generation !== refreshGeneration) return;
        sync();
      },
      (error: unknown) => {
        if (generation !== refreshGeneration) return;
        console.error("[code-viewer] viewer settings refresh failed", error);
        refreshError = formatErrorDetail(error);
        draw();
      },
    );
  }

  /**
   * 選んだ分類の節だけを出す。検索欄に文字があれば分類を無視し、見出し・
   * ラベル・説明に文字を含む節をすべて出す。
   */
  function applyCategory(): void {
    const needle = query.trim().toLocaleLowerCase();
    const watchApplies = values?.watchLimitApplies ?? true;
    let shown = 0;
    for (const [key, owner] of SECTION_ORDER) {
      const show =
        (key !== "watch" || watchApplies) &&
        (needle
          ? (sectionElement(key)?.textContent ?? "")
              .toLocaleLowerCase()
              .includes(needle)
          : owner === category);
      visible.set(key, show);
      if (show) shown += 1;
    }
    // 分類に節が 1 つだけなら、その節の見出しはページの見出し (分類の名前) と役が
    // 重なる (「ショートカット」が 2 回続いた) ので出さない。検索中は分類をまたいで
    // 並ぶので出す。
    sole =
      !needle && shown === 1
        ? (SECTION_ORDER.find(([key]) => visible.get(key))?.[0] ?? null)
        : null;
    draw();
  }

  function getCategory(): SettingsCategory {
    return category;
  }

  function setCategory(next: SettingsCategory): void {
    category = next;
    query = "";
    applyCategory();
  }

  /** その id の見出しを含む節の分類 (無ければ null)。 */
  function categoryOfHeading(headingId: string): SettingsCategory | null {
    if (!root) {
      root = build();
      values = deps.getValues();
      applyChoices(values);
      draw();
    }
    // id は URL の # からも来るので、セレクタに組まずに比べる。
    const owner = SECTION_ORDER.find(([key]) => {
      const element = sectionElement(key);
      return (
        element !== null &&
        (element.id === headingId ||
          Array.from(element.querySelectorAll("[id]")).some(
            (child) => child.id === headingId,
          ))
      );
    });
    return owner ? owner[1] : null;
  }

  /** 設定の見出しの id か (URL の # を設定のページへ移すかの判断)。 */
  function hasHeading(headingId: string): boolean {
    return categoryOfHeading(headingId) !== null;
  }

  /**
   * ほかの画面から設定の見出しへ送るとき、その見出しを含む分類に切り替える。
   * 見つからないときは分類を変えない。
   */
  function revealHeading(headingId: string): void {
    const owner = categoryOfHeading(headingId);
    if (!owner) return;
    setCategory(owner);
    // 畳んだ中 (判定ルールの欄) へ送られたら開く。
    const target = Array.from(root?.querySelectorAll("[id]") ?? []).find(
      (element) => element.id === headingId,
    );
    let folded = target?.parentElement?.closest("details");
    while (folded) {
      folded.open = true;
      folded = folded.parentElement?.closest("details");
    }
  }

  /**
   * 検索欄。設定のページが見出しの下に置く。検索欄は節を組む前にも出しうるので、
   * 文言は節とは別に当てる (以前は設定の節を一度開くまで placeholder が空だった)。
   */
  function mountSearch(host: HTMLElement): void {
    drawSearch();
    host.appendChild(searchWrap);
  }

  function localize(): void {
    drawSearch();
    if (!root) return;
    draw();
  }

  /** 明暗とテーマの今の値を映す (別の窓や ⌘K・T のキーで変わったとき)。 */
  function syncTheme(): void {
    if (!focused("viewer-theme")) themeChoice = deps.getTheme();
    colorTheme = deps.getColorTheme();
    draw();
  }

  return {
    mount,
    mountSearch,
    sync,
    syncTheme,
    localize,
    getCategory,
    setCategory,
    revealHeading,
    hasHeading,
  };
}
