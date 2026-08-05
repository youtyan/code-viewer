// ビューア設定のフォーム。以前はヘッダの歯車から出るポップオーバーだったが、
// Help ページの 1 セクションに移した。DOM の組み立てと配線だけを持ち、値の
// 保存や副作用 (フォントの適用、ツリーの貼り直し) は deps 経由で app.ts に
// 任せる。Help ページは描画のたびに中身を作り直すので、ここで作った root は
// 使い回して差し込む - そうしないと入力中の textarea が消える。

import { formatErrorDetail } from "../core/error-detail";

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
  autosaveNote: string;
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
};

export type ViewerSettingsValues = {
  language: string;
  sidebarFontSize: string;
  codeFontSize: string;
  omitDirs: string;
  excludeNames: string;
  watchLimit: number;
  watchLimitMin: number;
  watchLimitMax: number;
  watchLimitDefault: number;
  uploadEnabled: boolean;
  inferFkRails: boolean;
  s3TooltipEnabled: boolean;
  /** 「どのプロジェクトの、どこ由来の値か」を出す 1 行 */
  scopeSource: string;
};

export type ViewerSettingsDeps = {
  getText(): ViewerSettingsText;
  getValues(): ViewerSettingsValues;
  /** 表示のたびにサーバーの最新設定を取り込む */
  refresh(): Promise<void>;
  onLanguageChange(value: string): void;
  onSidebarFontSizeChange(value: string): void;
  onCodeFontSizeChange(value: string): void;
  onUploadEnabledChange(checked: boolean): void;
  onOmitDirsChange(value: string): void;
  onExcludeNamesChange(value: string): void;
  onWatchLimitChange(value: string): void;
  onInferFkChange(checked: boolean): void;
  onS3TooltipChange(checked: boolean): void;
  onReset(): void;
};

const FONT_SIZE_VALUES = ["compact", "regular", "large", "xlarge"] as const;
const LANGUAGE_VALUES = [
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
] as const;

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

/** 入力中の欄は触らない。開き直したときの同期で打ちかけが消えないように。 */
function setFieldValue(
  field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  if (field === document.activeElement) return;
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
  const autosaveNote = helpText("scope-settings-autosave-note");
  const refreshError = helpText("scope-settings-refresh-error");
  refreshError.classList.add("scope-settings-refresh-error");
  refreshError.hidden = true;
  const resetButton = document.createElement("button");

  const displayTitle = sectionTitle();
  const uploadsTitle = sectionTitle();
  const excludedTitle = sectionTitle();
  const datastoreTitle = sectionTitle();
  const watchTitle = sectionTitle();
  const languageLabel = fieldLabel("viewer-language");
  const sidebarFontSizeLabel = fieldLabel("sidebar-font-size");
  const codeFontSizeLabel = fieldLabel("code-font-size");
  const omitDirsLabel = fieldLabel("scope-omit-dirs");
  const excludeNamesLabel = fieldLabel("scope-exclude-names");
  const watchLimitLabel = fieldLabel("scope-watch-limit");

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

    resetButton.id = "scope-omit-reset";
    resetButton.type = "button";
    const footer = document.createElement("div");
    footer.className = "scope-settings-footer";
    footer.append(autosaveNote, refreshError, resetButton);

    wrap.append(display, uploads, excluded, datastores, watch, footer);
    wire();
    return wrap;
  }

  function wire(): void {
    language.addEventListener("change", () =>
      deps.onLanguageChange(language.value),
    );
    sidebarFontSize.addEventListener("change", () =>
      deps.onSidebarFontSizeChange(sidebarFontSize.value),
    );
    codeFontSize.addEventListener("change", () =>
      deps.onCodeFontSizeChange(codeFontSize.value),
    );
    upload.input.addEventListener("change", () =>
      deps.onUploadEnabledChange(upload.input.checked),
    );
    omitDirs.addEventListener("change", () =>
      deps.onOmitDirsChange(omitDirs.value),
    );
    excludeNames.addEventListener("change", () =>
      deps.onExcludeNamesChange(excludeNames.value),
    );
    inferFk.input.addEventListener("change", () =>
      deps.onInferFkChange(inferFk.input.checked),
    );
    s3Tooltip.input.addEventListener("change", () =>
      deps.onS3TooltipChange(s3Tooltip.input.checked),
    );
    watchLimitNumber.addEventListener("change", () => {
      watchLimitRange.value = watchLimitNumber.value;
      deps.onWatchLimitChange(watchLimitNumber.value);
    });
    // ドラッグ中は保存せず、数値欄だけ追従させる。離した時点で保存する。
    watchLimitRange.addEventListener("input", () => {
      watchLimitNumber.value = watchLimitRange.value;
    });
    watchLimitRange.addEventListener("change", () =>
      deps.onWatchLimitChange(watchLimitRange.value),
    );
    resetButton.addEventListener("click", () => {
      deps.onReset();
      sync();
    });
  }

  function applyText(): void {
    const text = deps.getText();
    const values = deps.getValues();
    displayTitle.textContent = text.display;
    uploadsTitle.textContent = text.uploadsTitle;
    excludedTitle.textContent = text.excludedDirectories;
    datastoreTitle.textContent = text.datastoreTitle;
    watchTitle.textContent = text.watchTitle;
    languageLabel.textContent = text.language;
    sidebarFontSizeLabel.textContent = text.fileListFontSize;
    codeFontSizeLabel.textContent = text.codeFontSize;
    omitDirsLabel.textContent = text.omitDirs;
    excludeNamesLabel.textContent = text.excludeNames;
    watchLimitLabel.textContent = text.watchLimit;
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
    autosaveNote.textContent = text.autosaveNote;
    resetButton.textContent = text.reset;

    const sizeLabels: Record<(typeof FONT_SIZE_VALUES)[number], string> = {
      compact: text.sizeSmall,
      regular: text.sizeRegular,
      large: text.sizeLarge,
      xlarge: text.sizeExtraLarge,
    };
    for (const select of [sidebarFontSize, codeFontSize])
      for (const option of Array.from(select.options))
        option.textContent =
          sizeLabels[option.value as (typeof FONT_SIZE_VALUES)[number]] ||
          option.value;
  }

  function sync(): void {
    if (!root) return;
    applyText();
    const values = deps.getValues();
    setFieldValue(language, values.language);
    setFieldValue(sidebarFontSize, values.sidebarFontSize);
    setFieldValue(codeFontSize, values.codeFontSize);
    setFieldValue(omitDirs, values.omitDirs);
    setFieldValue(excludeNames, values.excludeNames);
    watchLimitNumber.min = String(values.watchLimitMin);
    watchLimitNumber.max = String(values.watchLimitMax);
    watchLimitRange.min = String(values.watchLimitMin);
    watchLimitRange.max = String(values.watchLimitMax);
    setFieldValue(watchLimitNumber, String(values.watchLimit));
    setFieldValue(watchLimitRange, String(values.watchLimit));
    upload.input.checked = values.uploadEnabled;
    inferFk.input.checked = values.inferFkRails;
    s3Tooltip.input.checked = values.s3TooltipEnabled;
    scopeSource.textContent = values.scopeSource;
  }

  /**
   * host に差し込む。root は作り直さず使い回すので、Help ページ側が article を
   * 何度組み立て直しても、入力中の内容が残る。ただし DOM を付け替えると
   * フォーカスは必ず外れるので、打ちかけの欄とカーソル位置は自分で戻す。
   */
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
    void deps.refresh().then(sync, (error: unknown) => {
      console.error("[code-viewer] viewer settings refresh failed", error);
      refreshError.textContent = formatErrorDetail(error);
      refreshError.hidden = false;
    });
  }

  /**
   * 言語を切り替えたときの貼り直し。フォームをまだ組んでいなければ何もしない。
   * アプリ起動時の一括ローカライズはここも通るが、その時点では設定の値を
   * 引く相手 (データストアの設定など) がまだ作られていない。
   */
  function localize(): void {
    if (!root) return;
    applyText();
  }

  return { mount, sync, localize };
}
