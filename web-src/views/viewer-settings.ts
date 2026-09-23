// ビューア設定のフォーム。Help ページは描画のたびに中身を作り直すため、
// ここで作った root を使い回して入力中の下書きを保持する。値の保存や、
// フォント適用などの副作用は deps 経由で app.ts に任せる。

import { formatErrorDetail } from "../core/error-detail";
import { iconSvg, SEARCH_16_PATH } from "../core/icons";
import {
  highlightToInnerHtml,
  loadShikiHighlighter,
  type ShikiHighlighter,
} from "../core/shiki-loader";

export type ViewerSettingsText = {
  display: string;
  theme: string;
  themeHelp: string;
  themeNames: Record<ThemeChoice, string>;
  language: string;
  fileListFontSize: string;
  fileListFontSizeHelp: string;
  codeFontSize: string;
  sizeSmall: string;
  sizeRegular: string;
  sizeLarge: string;
  sizeExtraLarge: string;
  displaySource: string;
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
  saveNote: string;
  watchLimitInvalid: (min: number, max: number) => string;
  scopeSource: (project: string, source: string) => string;
  browserOverride: string;
  serverDefault: string;
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
  agentRulesLabel: string;
  agentRulesHelp: string;
  agentRulesGuideTitle: string;
  agentRulesGuideIntro: string;
  agentRulesGuideFields: string;
  agentRulesGuideMatchers: string;
  agentRulesGuideRegions: string;
  agentRulesGuideExample: string;
  agentRulesSave: string;
  agentRulesReset: string;
  agentRulesSaving: string;
  agentRulesSourceDefault: string;
  agentRulesSourceSaved: string;
  /** 左の分類の名前と、分類を切り替えたときの見出しの下の 1 文。 */
  categories: Record<SettingsCategory, { label: string; description: string }>;
  searchPlaceholder: string;
  searchNoMatch: (query: string) => string;
};

export type ViewerSettingsDraft = {
  language: string;
  sidebarFontSize: string;
  codeFontSize: string;
  omitDirs: string;
  excludeNames: string;
  watchLimit: number;
  uploadEnabled: boolean;
  agentNotifyWaiting: boolean;
  agentNotifyDone: boolean;
  inferFkRails: boolean;
  s3TooltipEnabled: boolean;
};

export type ViewerSettingsValues = ViewerSettingsDraft & {
  /** 全プロジェクト共通の設定を読めなかった理由。空なら読めた。 */
  userSettingsError: string;
  watchLimitMin: number;
  watchLimitMax: number;
  watchLimitDefault: number;
  scopeSource: string;
  agentRulesJson: string;
  agentRulesSource: "default" | "saved";
  agentRulesErrors: string;
};

/**
 * 設定の分類。Help ページの左の列に並べ、選んだ分類の節だけを出す。
 * フォームは 1 つのまま (下書きと「変更を保存」は分類をまたいで効く)。
 */
export const SETTINGS_CATEGORIES = [
  "general",
  "appearance",
  "shortcuts",
  "agents",
  "accounts",
  "advanced",
] as const;
export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number];

/** 設定の「テーマ」の選択肢 (ライト 1 つとダークの色違い 3 つ)。 */
export const THEME_CHOICES = ["dark", "graphite", "warm", "light"] as const;
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
   * テーマ。ほかの項目と違い、選んだ時点で当てて保存する (見比べて選ぶもの
   * なので、保存ボタンを待たせない)。
   */
  getTheme(): ThemeChoice;
  setTheme(choice: ThemeChoice): void;
  getValues(): ViewerSettingsValues;
  getDefaultValues(): ViewerSettingsDraft;
  refresh(): Promise<void>;
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
  /** ページの「変更を保存」で一緒に保存する節の下書き。 */
  drafts: readonly SettingsDraft[];
};

const FONT_SIZE_VALUES = ["compact", "regular", "large", "xlarge"] as const;
const LANGUAGE_VALUES = [
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
] as const;
const GENERAL_SETTING_FIELDS: readonly (keyof ViewerSettingsDraft)[] = [
  "language",
  "sidebarFontSize",
  "codeFontSize",
  "omitDirs",
  "excludeNames",
  "watchLimit",
  "uploadEnabled",
  "agentNotifyWaiting",
  "agentNotifyDone",
  "inferFkRails",
  "s3TooltipEnabled",
];

function section(): HTMLDivElement {
  const div = document.createElement("div");
  div.className = "scope-settings-section";
  return div;
}

function sectionTitle(): HTMLElement {
  const strong = document.createElement("strong");
  strong.className = "scope-settings-section-title";
  return strong;
}

/** 見出しの横の「全プロジェクト共通」。見出しの文字を書き換えても残るよう別の要素。 */
function sharedTag(): HTMLSpanElement {
  const tag = document.createElement("span");
  tag.className = "scope-settings-shared";
  return tag;
}

function titleRow(title: HTMLElement, tag: HTMLElement): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "scope-settings-title-row";
  row.append(title, tag);
  return row;
}

function fieldLabel(htmlFor: string): HTMLLabelElement {
  const label = document.createElement("label");
  label.htmlFor = htmlFor;
  return label;
}

function helpText(id?: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = "scope-settings-help";
  if (id) p.id = id;
  return p;
}

function fontSizeSelect(id: string): HTMLSelectElement {
  const select = document.createElement("select");
  select.id = id;
  for (const value of FONT_SIZE_VALUES) {
    const option = document.createElement("option");
    option.value = value;
    select.appendChild(option);
  }
  return select;
}

function toggleRow(id: string): {
  wrap: HTMLLabelElement;
  input: HTMLInputElement;
  text: HTMLSpanElement;
} {
  const wrap = document.createElement("label");
  wrap.className = "scope-settings-toggle";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = id;
  const text = document.createElement("span");
  wrap.append(input, text);
  return { wrap, input, text };
}

function setFieldValue(
  field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
  force = false,
): void {
  if (!force && field === document.activeElement) return;
  if (field.value !== value) field.value = value;
}

export function createViewerSettings(deps: ViewerSettingsDeps) {
  let root: HTMLElement | null = null;
  let category: SettingsCategory = "general";
  /** 節と、その節が属する分類。build() が埋める。 */
  const categorized: Array<[HTMLElement, SettingsCategory]> = [];
  /**
   * 「デフォルトに戻す」が戻す項目を持つ節。どれも出ていない分類 (アカウント)
   * では、ページの下の「デフォルトに戻す」を出さない (戻すものが無い)。
   */
  const generalSections: HTMLElement[] = [];
  const search = document.createElement("input");
  search.type = "search";
  search.id = "scope-settings-search";
  search.className = "scope-settings-search";
  search.autocomplete = "off";
  search.spellcheck = false;
  const searchWrap = document.createElement("div");
  searchWrap.className = "scope-settings-search-wrap";
  searchWrap.innerHTML = iconSvg("scope-settings-search-icon", SEARCH_16_PATH);
  searchWrap.append(search);
  const searchEmpty = helpText("scope-settings-search-empty");
  searchEmpty.hidden = true;

  const theme = document.createElement("select");
  const themeHelp = helpText("viewer-theme-help");
  const language = document.createElement("select");
  const sidebarFontSize = fontSizeSelect("sidebar-font-size");
  const codeFontSize = fontSizeSelect("code-font-size");
  const uiFontSizeHelp = helpText("ui-font-size-help");
  const displaySource = document.createElement("p");
  const userSettingsError = helpText("user-settings-error");
  userSettingsError.classList.add("scope-settings-refresh-error");
  userSettingsError.hidden = true;
  const displayShared = sharedTag();
  const agentNotifyShared = sharedTag();
  const upload = toggleRow("upload-enabled");
  const uploadHelp = helpText("upload-help");
  const agentNotifyWaiting = toggleRow("agent-notify-waiting");
  const agentNotifyDone = toggleRow("agent-notify-done");
  const agentNotifyHelp = helpText("agent-notify-help");
  const omitDirs = document.createElement("textarea");
  const omitDirsHelp = helpText("scope-omit-dirs-help");
  const excludeNames = document.createElement("textarea");
  const excludeNamesHelp = helpText("scope-exclude-names-help");
  const scopeSource = document.createElement("p");
  const inferFk = toggleRow("datastore-infer-fk");
  const inferFkHelp = helpText("datastore-infer-fk-help");
  const s3Tooltip = toggleRow("datastore-s3-tooltip");
  const s3TooltipHelp = helpText("datastore-s3-tooltip-help");
  const watchLimitNumber = document.createElement("input");
  const watchLimitRange = document.createElement("input");
  const watchLimitHelp = helpText("scope-watch-limit-help");

  const agentRules = document.createElement("textarea");
  const agentRulesHelp = helpText("agent-screen-rules-help");
  const agentRulesSource = helpText("agent-screen-rules-source");
  const agentRulesError = helpText("agent-screen-rules-error");
  agentRulesError.classList.add("scope-settings-refresh-error");
  agentRulesError.hidden = true;
  const agentRulesHighlightError = helpText(
    "agent-screen-rules-highlight-error",
  );
  agentRulesHighlightError.classList.add("scope-settings-refresh-error");
  agentRulesHighlightError.hidden = true;
  const agentRulesHighlight = document.createElement("pre");
  agentRulesHighlight.className = "agent-screen-rules-highlight";
  agentRulesHighlight.setAttribute("aria-hidden", "true");
  const agentRulesGuide = document.createElement("details");
  agentRulesGuide.id = "agent-screen-rules-guide";
  agentRulesGuide.className = "agent-screen-rules-guide";
  agentRulesGuide.open = true;
  const agentRulesGuideTitle = document.createElement("summary");
  const agentRulesGuideIntro = helpText();
  const agentRulesGuideFields = helpText();
  const agentRulesGuideMatchers = helpText();
  const agentRulesGuideRegions = helpText();
  const agentRulesGuideExample = document.createElement("pre");
  agentRulesGuideExample.className = "agent-screen-rules-guide-example";
  const agentRulesSave = document.createElement("button");
  const agentRulesReset = document.createElement("button");

  const saveNote = helpText("scope-settings-save-note");
  const saveStatus = helpText("scope-settings-save-status");
  saveStatus.setAttribute("aria-live", "polite");
  const saveError = helpText("scope-settings-save-error");
  saveError.classList.add("scope-settings-refresh-error");
  saveError.hidden = true;
  const refreshError = helpText("scope-settings-refresh-error");
  refreshError.classList.add("scope-settings-refresh-error");
  refreshError.hidden = true;
  const resetButton = document.createElement("button");
  const saveButton = document.createElement("button");

  const displayTitle = sectionTitle();
  const uploadsTitle = sectionTitle();
  const agentNotifyTitle = sectionTitle();
  const excludedTitle = sectionTitle();
  const datastoreTitle = sectionTitle();
  const watchTitle = sectionTitle();
  const agentRulesTitle = sectionTitle();
  const themeLabel = fieldLabel("viewer-theme");
  const languageLabel = fieldLabel("viewer-language");
  const sidebarFontSizeLabel = fieldLabel("sidebar-font-size");
  const codeFontSizeLabel = fieldLabel("code-font-size");
  const omitDirsLabel = fieldLabel("scope-omit-dirs");
  const excludeNamesLabel = fieldLabel("scope-exclude-names");
  const watchLimitLabel = fieldLabel("scope-watch-limit");
  const agentRulesLabel = fieldLabel("agent-screen-rules");

  let generalDirty = false;
  let generalSavePending = false;
  let restoreDefaults = false;
  const changedGeneralFields = new Set<keyof ViewerSettingsDraft>();
  let generalStatus: "idle" | "dirty" | "saving" | "saved" = "idle";
  let agentRulesPending = false;
  let agentRulesDirty = false;
  let jsonHighlighter: ShikiHighlighter | null = null;
  let refreshGeneration = 0;

  function build(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "scope-settings";

    theme.id = "viewer-theme";
    for (const value of THEME_CHOICES) {
      const option = document.createElement("option");
      option.value = value;
      theme.appendChild(option);
    }
    theme.addEventListener("change", () => {
      const choice = THEME_CHOICES.find((value) => value === theme.value);
      if (choice) deps.setTheme(choice);
    });
    language.id = "viewer-language";
    for (const item of LANGUAGE_VALUES) {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.label;
      language.appendChild(option);
    }
    displaySource.id = "display-settings-source";
    const display = section();
    display.append(
      titleRow(displayTitle, displayShared),
      themeLabel,
      theme,
      themeHelp,
      languageLabel,
      language,
      sidebarFontSizeLabel,
      sidebarFontSize,
      uiFontSizeHelp,
      codeFontSizeLabel,
      codeFontSize,
      displaySource,
      userSettingsError,
    );

    uploadsTitle.id = "upload-section-title";
    const uploads = section();
    uploads.append(uploadsTitle, upload.wrap, uploadHelp);

    // エージェント一覧の「通知は有効です」から、この見出しへ飛んでくる。
    agentNotifyTitle.id = "agent-notify-section-title";
    const agentNotify = section();
    agentNotify.append(
      titleRow(agentNotifyTitle, agentNotifyShared),
      agentNotifyWaiting.wrap,
      agentNotifyDone.wrap,
      agentNotifyHelp,
    );

    omitDirs.id = "scope-omit-dirs";
    omitDirs.rows = 6;
    omitDirs.spellcheck = false;
    excludeNames.id = "scope-exclude-names";
    excludeNames.rows = 4;
    excludeNames.spellcheck = false;
    scopeSource.id = "scope-omit-source";
    const excluded = section();
    excluded.append(
      excludedTitle,
      omitDirsLabel,
      omitDirs,
      omitDirsHelp,
      excludeNamesLabel,
      excludeNames,
      excludeNamesHelp,
      scopeSource,
    );

    datastoreTitle.id = "datastore-section-title";
    const datastores = section();
    datastores.append(
      datastoreTitle,
      inferFk.wrap,
      inferFkHelp,
      s3Tooltip.wrap,
      s3TooltipHelp,
    );

    watchTitle.id = "watch-section-title";
    watchLimitRange.id = "scope-watch-limit-range";
    watchLimitRange.type = "range";
    watchLimitRange.step = "16";
    watchLimitNumber.id = "scope-watch-limit";
    watchLimitNumber.type = "number";
    watchLimitNumber.step = "1";
    const watchRow = document.createElement("div");
    watchRow.className = "scope-watch-limit-row";
    watchRow.append(watchLimitRange, watchLimitNumber);
    const watch = section();
    watch.id = "watch-settings-section";
    watch.append(watchTitle, watchLimitLabel, watchRow, watchLimitHelp);

    agentRulesTitle.id = "agent-screen-rules-title";
    agentRules.id = "agent-screen-rules";
    agentRules.rows = 24;
    agentRules.spellcheck = false;
    agentRules.setAttribute(
      "aria-describedby",
      [
        "agent-screen-rules-help",
        "agent-screen-rules-source",
        "agent-screen-rules-error",
        "agent-screen-rules-highlight-error",
      ].join(" "),
    );
    const agentRulesEditor = document.createElement("div");
    agentRulesEditor.className = "agent-screen-rules-editor";
    agentRulesEditor.append(agentRulesHighlight, agentRules);
    agentRulesGuide.append(
      agentRulesGuideTitle,
      agentRulesGuideIntro,
      agentRulesGuideFields,
      agentRulesGuideMatchers,
      agentRulesGuideRegions,
      agentRulesGuideExample,
    );
    agentRulesSave.type = "button";
    agentRulesSave.id = "agent-screen-rules-save";
    agentRulesReset.type = "button";
    agentRulesReset.id = "agent-screen-rules-reset";
    const agentRuleActions = document.createElement("div");
    agentRuleActions.className = "scope-settings-actions";
    agentRuleActions.append(agentRulesReset, agentRulesSave);
    const ruleSettings = section();
    ruleSettings.classList.add("agent-screen-rules-section");
    ruleSettings.append(
      agentRulesTitle,
      agentRulesLabel,
      agentRulesHelp,
      agentRulesGuide,
      agentRulesEditor,
      agentRulesSource,
      agentRulesError,
      agentRulesHighlightError,
      agentRuleActions,
    );

    resetButton.id = "scope-omit-reset";
    resetButton.type = "button";
    saveButton.id = "scope-settings-save";
    saveButton.type = "button";
    saveButton.className = "scope-settings-primary-action";
    const generalActions = document.createElement("div");
    generalActions.className = "scope-settings-actions";
    generalActions.append(resetButton, saveButton);
    const footer = document.createElement("div");
    footer.className = "scope-settings-footer";
    footer.append(
      saveNote,
      saveStatus,
      saveError,
      refreshError,
      generalActions,
    );

    generalSections.push(
      display,
      uploads,
      agentNotify,
      excluded,
      datastores,
      watch,
    );
    categorized.push(
      [display, "appearance"],
      [deps.shortcutsSection, "shortcuts"],
      [uploads, "general"],
      [agentNotify, "agents"],
      [deps.agentAccountsSection, "accounts"],
      [deps.agentHooksSection, "agents"],
      [excluded, "general"],
      [datastores, "advanced"],
      [watch, "advanced"],
      [ruleSettings, "advanced"],
    );
    wrap.append(
      searchEmpty,
      display,
      deps.shortcutsSection,
      uploads,
      agentNotify,
      deps.agentAccountsSection,
      deps.agentHooksSection,
      excluded,
      datastores,
      watch,
      ruleSettings,
      footer,
    );
    search.addEventListener("input", applyCategory);
    wire();
    applyCategory();
    void initializeJsonHighlighting();
    return wrap;
  }

  function wire(): void {
    language.addEventListener("change", () => markGeneralDirty("language"));
    sidebarFontSize.addEventListener("change", () =>
      markGeneralDirty("sidebarFontSize"),
    );
    codeFontSize.addEventListener("change", () =>
      markGeneralDirty("codeFontSize"),
    );
    upload.input.addEventListener("change", () =>
      markGeneralDirty("uploadEnabled"),
    );
    agentNotifyWaiting.input.addEventListener("change", () =>
      markGeneralDirty("agentNotifyWaiting"),
    );
    agentNotifyDone.input.addEventListener("change", () =>
      markGeneralDirty("agentNotifyDone"),
    );
    inferFk.input.addEventListener("change", () =>
      markGeneralDirty("inferFkRails"),
    );
    s3Tooltip.input.addEventListener("change", () =>
      markGeneralDirty("s3TooltipEnabled"),
    );
    omitDirs.addEventListener("input", () => markGeneralDirty("omitDirs"));
    excludeNames.addEventListener("input", () =>
      markGeneralDirty("excludeNames"),
    );
    watchLimitNumber.addEventListener("input", () => {
      watchLimitRange.value = watchLimitNumber.value;
      markGeneralDirty("watchLimit");
    });
    watchLimitNumber.addEventListener("change", () => {
      watchLimitRange.value = watchLimitNumber.value;
      markGeneralDirty("watchLimit");
    });
    watchLimitRange.addEventListener("input", () => {
      watchLimitNumber.value = watchLimitRange.value;
      markGeneralDirty("watchLimit");
    });
    watchLimitRange.addEventListener("change", () =>
      markGeneralDirty("watchLimit"),
    );
    agentRules.addEventListener("input", () => {
      agentRulesDirty = true;
      syncAgentRulesHighlight();
    });
    agentRules.addEventListener("scroll", syncAgentRulesScroll);
    agentRulesSave.addEventListener("click", () => {
      void updateAgentRules(() => deps.onAgentRulesSave(agentRules.value));
    });
    agentRulesReset.addEventListener("click", () => {
      void updateAgentRules(() => deps.onAgentRulesReset());
    });
    resetButton.addEventListener("click", () => {
      applyGeneralFields(deps.getDefaultValues(), true);
      restoreDefaults = true;
      changedGeneralFields.clear();
      for (const field of GENERAL_SETTING_FIELDS) {
        changedGeneralFields.add(field);
      }
      generalDirty = true;
      generalStatus = "dirty";
      clearGeneralSaveError();
      renderGeneralSaveState();
    });
    saveButton.addEventListener("click", () => {
      void saveChanges();
    });
    for (const draft of deps.drafts) {
      draft.subscribe(() => {
        if (draft.dirty()) {
          generalStatus = "dirty";
          clearGeneralSaveError();
        } else if (!anyDirty() && generalStatus === "dirty") {
          generalStatus = "idle";
        }
        renderGeneralSaveState();
      });
    }
  }

  function anyDirty(): boolean {
    return generalDirty || deps.drafts.some((draft) => draft.dirty());
  }

  function markGeneralDirty(field: keyof ViewerSettingsDraft): void {
    if (generalSavePending) return;
    changedGeneralFields.add(field);
    generalDirty = true;
    restoreDefaults = false;
    generalStatus = "dirty";
    watchLimitNumber.setCustomValidity("");
    clearGeneralSaveError();
    renderGeneralSaveState();
  }

  function clearGeneralSaveError(): void {
    saveError.textContent = "";
    saveError.hidden = true;
  }

  function renderGeneralSaveState(): void {
    const text = deps.getText();
    saveButton.textContent =
      generalStatus === "saving" ? text.saving : text.save;
    const dirty = anyDirty();
    saveButton.disabled = generalSavePending || !dirty;
    resetButton.disabled = generalSavePending;
    const state =
      generalStatus === "saving"
        ? "saving"
        : dirty
          ? "unsaved"
          : generalStatus === "saved"
            ? "saved"
            : "";
    saveStatus.dataset.state = state;
    saveStatus.textContent =
      state === "saving"
        ? text.saving
        : state === "unsaved"
          ? text.unsaved
          : state === "saved"
            ? text.saved
            : "";
  }

  function setGeneralControlsDisabled(disabled: boolean): void {
    for (const field of [
      language,
      sidebarFontSize,
      codeFontSize,
      upload.input,
      agentNotifyWaiting.input,
      agentNotifyDone.input,
      omitDirs,
      excludeNames,
      inferFk.input,
      s3Tooltip.input,
      watchLimitNumber,
      watchLimitRange,
    ]) {
      field.disabled = disabled;
    }
  }

  function applyGeneralFields(
    values: ViewerSettingsDraft,
    force = false,
  ): void {
    setFieldValue(language, values.language, force);
    setFieldValue(sidebarFontSize, values.sidebarFontSize, force);
    setFieldValue(codeFontSize, values.codeFontSize, force);
    setFieldValue(omitDirs, values.omitDirs, force);
    setFieldValue(excludeNames, values.excludeNames, force);
    setFieldValue(watchLimitNumber, String(values.watchLimit), force);
    setFieldValue(watchLimitRange, String(values.watchLimit), force);
    upload.input.checked = values.uploadEnabled;
    agentNotifyWaiting.input.checked = values.agentNotifyWaiting;
    agentNotifyDone.input.checked = values.agentNotifyDone;
    inferFk.input.checked = values.inferFkRails;
    s3Tooltip.input.checked = values.s3TooltipEnabled;
  }

  function readGeneralDraft(): ViewerSettingsDraft | null {
    const values = deps.getValues();
    const watchLimit = Number(watchLimitNumber.value);
    if (
      !Number.isInteger(watchLimit) ||
      watchLimit < values.watchLimitMin ||
      watchLimit > values.watchLimitMax
    ) {
      const message = deps
        .getText()
        .watchLimitInvalid(values.watchLimitMin, values.watchLimitMax);
      watchLimitNumber.setCustomValidity(message);
      saveError.textContent = message;
      saveError.hidden = false;
      generalStatus = "dirty";
      renderGeneralSaveState();
      return null;
    }
    watchLimitNumber.setCustomValidity("");
    return {
      language: language.value,
      sidebarFontSize: sidebarFontSize.value,
      codeFontSize: codeFontSize.value,
      omitDirs: omitDirs.value,
      excludeNames: excludeNames.value,
      watchLimit,
      uploadEnabled: upload.input.checked,
      agentNotifyWaiting: agentNotifyWaiting.input.checked,
      agentNotifyDone: agentNotifyDone.input.checked,
      inferFkRails: inferFk.input.checked,
      s3TooltipEnabled: s3Tooltip.input.checked,
    };
  }

  async function saveChanges(): Promise<void> {
    if (generalSavePending || !anyDirty()) return;
    // 1 つでも保存できない節があれば、ほかの節も保存しない (半分だけ保存しない)。
    const problems = deps.drafts
      .map((section) => section.problem?.() ?? null)
      .filter((problem): problem is string => !!problem);
    if (problems.length) {
      saveError.textContent = problems.join("\n");
      saveError.hidden = false;
      return;
    }
    const draft = generalDirty ? readGeneralDraft() : null;
    if (generalDirty && !draft) return;
    refreshGeneration += 1;
    generalSavePending = true;
    generalStatus = "saving";
    clearGeneralSaveError();
    setGeneralControlsDisabled(true);
    renderGeneralSaveState();
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
      for (const section of deps.drafts) {
        if (section.dirty()) await section.save();
      }
      generalStatus = "saved";
      completed = true;
    } catch (error) {
      console.error("[code-viewer] viewer settings save failed", error);
      saveError.textContent = formatErrorDetail(error);
      saveError.hidden = false;
      generalStatus = "dirty";
    } finally {
      generalSavePending = false;
      setGeneralControlsDisabled(false);
      if (completed) sync();
      else renderGeneralSaveState();
    }
  }

  async function initializeJsonHighlighting(): Promise<void> {
    try {
      jsonHighlighter = await loadShikiHighlighter({
        themes: ["github-light", "github-dark"],
        langs: ["json"],
        failureMode: "throw",
      });
      if (!jsonHighlighter) {
        throw new Error("JSON syntax highlighting could not be loaded");
      }
      syncAgentRulesHighlight();
    } catch (error) {
      console.error("[code-viewer] JSON syntax highlighting failed", error);
      agentRulesHighlightError.textContent = formatErrorDetail(error);
      agentRulesHighlightError.hidden = false;
    }
  }

  function syncAgentRulesHighlight(): void {
    const highlighted = highlightToInnerHtml(
      agentRules.value,
      "json",
      jsonHighlighter,
    );
    if (highlighted) agentRulesHighlight.innerHTML = highlighted;
    else agentRulesHighlight.textContent = agentRules.value;
    syncAgentRulesScroll();
  }

  function syncAgentRulesScroll(): void {
    agentRulesHighlight.scrollTop = agentRules.scrollTop;
    agentRulesHighlight.scrollLeft = agentRules.scrollLeft;
  }

  async function updateAgentRules(
    operation: () => Promise<void>,
  ): Promise<void> {
    if (agentRulesPending) return;
    refreshGeneration += 1;
    agentRulesPending = true;
    agentRules.disabled = true;
    agentRulesSave.disabled = true;
    agentRulesReset.disabled = true;
    agentRulesSource.textContent = deps.getText().agentRulesSaving;
    agentRulesError.hidden = true;
    agentRulesError.textContent = "";
    let completed = false;
    try {
      await operation();
      agentRulesDirty = false;
      completed = true;
    } catch (error) {
      console.error("[code-viewer] terminal rule update failed", error);
      agentRulesError.textContent = formatErrorDetail(error);
      agentRulesError.hidden = false;
    } finally {
      agentRulesPending = false;
      agentRules.disabled = false;
      agentRulesSave.disabled = false;
      agentRulesReset.disabled = false;
      if (completed) {
        sync();
      } else {
        agentRulesSource.textContent =
          deps.getValues().agentRulesSource === "saved"
            ? deps.getText().agentRulesSourceSaved
            : deps.getText().agentRulesSourceDefault;
      }
    }
  }

  function applyText(): void {
    const text = deps.getText();
    const values = deps.getValues();
    displayTitle.textContent = text.display;
    uploadsTitle.textContent = text.uploadsTitle;
    agentNotifyTitle.textContent = text.agentNotifyTitle;
    excludedTitle.textContent = text.excludedDirectories;
    datastoreTitle.textContent = text.datastoreTitle;
    watchTitle.textContent = text.watchTitle;
    agentRulesTitle.textContent = text.agentRulesTitle;
    themeLabel.textContent = text.theme;
    themeHelp.textContent = text.themeHelp;
    for (const option of Array.from(theme.options)) {
      option.textContent =
        text.themeNames[option.value as ThemeChoice] ?? option.value;
    }
    languageLabel.textContent = text.language;
    sidebarFontSizeLabel.textContent = text.fileListFontSize;
    codeFontSizeLabel.textContent = text.codeFontSize;
    omitDirsLabel.textContent = text.omitDirs;
    excludeNamesLabel.textContent = text.excludeNames;
    watchLimitLabel.textContent = text.watchLimit;
    // スライダーと数の欄は同じ値を持つので、同じ名前で読み上げる。
    watchLimitRange.setAttribute("aria-label", text.watchLimit);
    agentRulesLabel.textContent = text.agentRulesLabel;
    uiFontSizeHelp.textContent = text.fileListFontSizeHelp;
    displaySource.textContent = text.displaySource;
    for (const tag of [displayShared, agentNotifyShared]) {
      tag.textContent = text.sharedTag;
      tag.title = text.sharedTagTitle;
    }
    userSettingsError.hidden = !values.userSettingsError;
    userSettingsError.textContent = values.userSettingsError
      ? text.userSettingsError(values.userSettingsError)
      : "";
    upload.text.textContent = text.uploadEnabledLabel;
    uploadHelp.textContent = text.uploadEnabledHelp;
    agentNotifyWaiting.text.textContent = text.agentNotifyWaitingLabel;
    agentNotifyDone.text.textContent = text.agentNotifyDoneLabel;
    agentNotifyHelp.textContent = text.agentNotifyHelp;
    omitDirsHelp.textContent = text.omitDirsHelp;
    excludeNamesHelp.textContent = text.excludeNamesHelp;
    inferFk.text.textContent = text.datastoreInferFkLabel;
    inferFkHelp.textContent = text.datastoreInferFkHelp;
    s3Tooltip.text.textContent = text.datastoreS3TooltipLabel;
    s3TooltipHelp.textContent = text.datastoreS3TooltipHelp;
    watchLimitHelp.textContent = text.watchLimitHelp(values.watchLimitDefault);
    agentRulesHelp.textContent = text.agentRulesHelp;
    agentRulesGuideTitle.textContent = text.agentRulesGuideTitle;
    agentRulesGuideIntro.textContent = text.agentRulesGuideIntro;
    agentRulesGuideFields.textContent = text.agentRulesGuideFields;
    agentRulesGuideMatchers.textContent = text.agentRulesGuideMatchers;
    agentRulesGuideRegions.textContent = text.agentRulesGuideRegions;
    agentRulesGuideExample.textContent = text.agentRulesGuideExample;
    agentRulesSave.textContent = text.agentRulesSave;
    agentRulesReset.textContent = text.agentRulesReset;
    saveNote.textContent = text.saveNote;
    applySearchText();
    resetButton.textContent = text.reset;
    renderGeneralSaveState();

    const sizeLabels: Record<(typeof FONT_SIZE_VALUES)[number], string> = {
      compact: text.sizeSmall,
      regular: text.sizeRegular,
      large: text.sizeLarge,
      xlarge: text.sizeExtraLarge,
    };
    for (const select of [sidebarFontSize, codeFontSize]) {
      for (const option of Array.from(select.options)) {
        option.textContent =
          sizeLabels[option.value as (typeof FONT_SIZE_VALUES)[number]] ||
          option.value;
      }
    }
  }

  function sync(): void {
    if (!root) return;
    applyText();
    const values = deps.getValues();
    watchLimitNumber.min = String(values.watchLimitMin);
    watchLimitNumber.max = String(values.watchLimitMax);
    watchLimitRange.min = String(values.watchLimitMin);
    watchLimitRange.max = String(values.watchLimitMax);
    if (!generalDirty && !generalSavePending) applyGeneralFields(values);
    setFieldValue(theme, deps.getTheme());
    scopeSource.textContent = values.scopeSource;
    if (!agentRulesDirty && !agentRulesPending) {
      setFieldValue(agentRules, values.agentRulesJson);
      syncAgentRulesHighlight();
    }
    if (!agentRulesPending) {
      agentRulesSource.textContent =
        values.agentRulesSource === "saved"
          ? deps.getText().agentRulesSourceSaved
          : deps.getText().agentRulesSourceDefault;
      agentRulesError.textContent = values.agentRulesErrors;
      agentRulesError.hidden = !values.agentRulesErrors;
    }
  }

  function mount(host: HTMLElement): void {
    if (!root) root = build();
    const active = document.activeElement;
    const focused =
      active instanceof HTMLElement && root.contains(active) ? active : null;
    const caret =
      focused instanceof HTMLTextAreaElement ||
      focused instanceof HTMLInputElement
        ? { start: focused.selectionStart, end: focused.selectionEnd }
        : null;

    host.appendChild(root);

    if (focused) {
      focused.focus();
      if (caret && caret.start !== null && caret.end !== null) {
        (focused as HTMLTextAreaElement).setSelectionRange(
          caret.start,
          caret.end,
        );
      }
    }
    sync();
    refreshError.hidden = true;
    refreshError.textContent = "";
    const generation = ++refreshGeneration;
    void deps.refresh().then(
      () => {
        if (generation !== refreshGeneration) return;
        sync();
      },
      (error: unknown) => {
        if (generation !== refreshGeneration) return;
        console.error("[code-viewer] viewer settings refresh failed", error);
        refreshError.textContent = formatErrorDetail(error);
        refreshError.hidden = false;
      },
    );
  }

  /**
   * 選んだ分類の節だけを出す。検索欄に文字があれば分類を無視し、見出し・
   * ラベル・説明に文字を含む節をすべて出す。
   */
  function applyCategory(): void {
    const query = search.value.trim().toLocaleLowerCase();
    let shown = 0;
    for (const [element, owner] of categorized) {
      const visible = query
        ? (element.textContent ?? "").toLocaleLowerCase().includes(query)
        : owner === category;
      element.hidden = !visible;
      if (visible) shown += 1;
    }
    searchEmpty.hidden = !query || shown > 0;
    resetButton.hidden = !generalSections.some((section) => !section.hidden);
    searchEmpty.textContent = query
      ? deps.getText().searchNoMatch(search.value.trim())
      : "";
  }

  function getCategory(): SettingsCategory {
    return category;
  }

  function setCategory(next: SettingsCategory): void {
    category = next;
    search.value = "";
    applyCategory();
  }

  /**
   * ほかの画面から設定の見出しへ送るとき、その見出しを含む分類に切り替える。
   * 見つからない (まだ組み立てていない) ときは分類を変えない。
   */
  function revealHeading(headingId: string): void {
    if (!root) root = build();
    const owner = categorized.find(
      ([element]) =>
        element.id === headingId || element.querySelector(`#${headingId}`),
    );
    if (owner) setCategory(owner[1]);
  }

  /** 設定の検索欄。Help ページが見出しの下に置く。 */
  /**
   * 検索欄の文言。検索欄は設定の節を組む前 (ヘルプの節から開いたとき) にも
   * 出すので、設定の節の文言 (applyText) とは別に当てる。以前は設定の節を一度
   * 開くまで placeholder が空だった。
   */
  function applySearchText(): void {
    const text = deps.getText();
    search.placeholder = text.searchPlaceholder;
    search.setAttribute("aria-label", text.searchPlaceholder);
    if (search.value.trim())
      searchEmpty.textContent = text.searchNoMatch(search.value.trim());
  }

  function mountSearch(host: HTMLElement): void {
    applySearchText();
    host.appendChild(searchWrap);
  }

  function localize(): void {
    applySearchText();
    if (!root) return;
    applyText();
  }

  return {
    mount,
    mountSearch,
    sync,
    localize,
    getCategory,
    setCategory,
    revealHeading,
  };
}
