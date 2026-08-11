// ビューア設定のフォーム。Help ページは描画のたびに中身を作り直すため、
// ここで作った root を使い回して入力中の下書きを保持する。値の保存や、
// フォント適用などの副作用は deps 経由で app.ts に任せる。

import { formatErrorDetail } from "../core/error-detail";
import {
  highlightToInnerHtml,
  loadShikiHighlighter,
  type ShikiHighlighter,
} from "../core/shiki-loader";

export type ViewerSettingsText = {
  display: string;
  language: string;
  fileListFontSize: string;
  fileListFontSizeHelp: string;
  codeFontSize: string;
  sizeSmall: string;
  sizeRegular: string;
  sizeLarge: string;
  sizeExtraLarge: string;
  displaySource: string;
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
};

export type ViewerSettingsDraft = {
  language: string;
  sidebarFontSize: string;
  codeFontSize: string;
  omitDirs: string;
  excludeNames: string;
  watchLimit: number;
  uploadEnabled: boolean;
  inferFkRails: boolean;
  s3TooltipEnabled: boolean;
};

export type ViewerSettingsValues = ViewerSettingsDraft & {
  watchLimitMin: number;
  watchLimitMax: number;
  watchLimitDefault: number;
  scopeSource: string;
  agentRulesJson: string;
  agentRulesSource: "default" | "saved";
  agentRulesErrors: string;
};

export type ViewerSettingsDeps = {
  getText(): ViewerSettingsText;
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

  const language = document.createElement("select");
  const sidebarFontSize = fontSizeSelect("sidebar-font-size");
  const codeFontSize = fontSizeSelect("code-font-size");
  const uiFontSizeHelp = helpText("ui-font-size-help");
  const displaySource = document.createElement("p");
  const upload = toggleRow("upload-enabled");
  const uploadHelp = helpText("upload-help");
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
  const excludedTitle = sectionTitle();
  const datastoreTitle = sectionTitle();
  const watchTitle = sectionTitle();
  const agentRulesTitle = sectionTitle();
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
      displayTitle,
      languageLabel,
      language,
      sidebarFontSizeLabel,
      sidebarFontSize,
      uiFontSizeHelp,
      codeFontSizeLabel,
      codeFontSize,
      displaySource,
    );

    uploadsTitle.id = "upload-section-title";
    const uploads = section();
    uploads.append(uploadsTitle, upload.wrap, uploadHelp);

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
    watchLimitRange.setAttribute("aria-label", "watch limit slider");
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

    wrap.append(
      display,
      uploads,
      excluded,
      datastores,
      watch,
      ruleSettings,
      footer,
    );
    wire();
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
      void saveGeneralSettings();
    });
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
    saveButton.disabled = generalSavePending || !generalDirty;
    resetButton.disabled = generalSavePending;
    saveStatus.textContent =
      generalStatus === "saving"
        ? text.saving
        : generalStatus === "saved"
          ? text.saved
          : generalDirty
            ? text.unsaved
            : "";
  }

  function setGeneralControlsDisabled(disabled: boolean): void {
    for (const field of [
      language,
      sidebarFontSize,
      codeFontSize,
      upload.input,
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
      inferFkRails: inferFk.input.checked,
      s3TooltipEnabled: s3Tooltip.input.checked,
    };
  }

  async function saveGeneralSettings(): Promise<void> {
    if (generalSavePending || !generalDirty) return;
    const draft = readGeneralDraft();
    if (!draft) return;
    refreshGeneration += 1;
    generalSavePending = true;
    generalStatus = "saving";
    clearGeneralSaveError();
    setGeneralControlsDisabled(true);
    renderGeneralSaveState();
    let completed = false;
    try {
      await deps.onSave(draft, {
        restoreDefaults,
        changedFields: [...changedGeneralFields],
      });
      generalDirty = false;
      restoreDefaults = false;
      changedGeneralFields.clear();
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
    excludedTitle.textContent = text.excludedDirectories;
    datastoreTitle.textContent = text.datastoreTitle;
    watchTitle.textContent = text.watchTitle;
    agentRulesTitle.textContent = text.agentRulesTitle;
    languageLabel.textContent = text.language;
    sidebarFontSizeLabel.textContent = text.fileListFontSize;
    codeFontSizeLabel.textContent = text.codeFontSize;
    omitDirsLabel.textContent = text.omitDirs;
    excludeNamesLabel.textContent = text.excludeNames;
    watchLimitLabel.textContent = text.watchLimit;
    agentRulesLabel.textContent = text.agentRulesLabel;
    uiFontSizeHelp.textContent = text.fileListFontSizeHelp;
    displaySource.textContent = text.displaySource;
    upload.text.textContent = text.uploadEnabledLabel;
    uploadHelp.textContent = text.uploadEnabledHelp;
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

  function localize(): void {
    if (!root) return;
    applyText();
  }

  return { mount, sync, localize };
}
