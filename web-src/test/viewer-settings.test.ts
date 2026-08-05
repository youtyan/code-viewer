import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import {
  createViewerSettings,
  type ViewerSettingsText,
  type ViewerSettingsValues,
} from "../views/viewer-settings";
import { q } from "./_test-helpers";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

const EN_TEXT: ViewerSettingsText = {
  display: "Display",
  language: "Language",
  fileListFontSize: "UI font size",
  fileListFontSizeHelp: "Applies to everything except code.",
  codeFontSize: "Code font size",
  sizeSmall: "Small",
  sizeRegular: "Regular",
  sizeLarge: "Large",
  sizeExtraLarge: "Extra Large",
  displaySource: "Applies to all projects in this browser.",
  excludedDirectories: "Excluded directories",
  omitDirs: "Skip these directory names",
  omitDirsHelp: "Contents are never read.",
  excludeNames: "Hide these names completely",
  excludeNamesHelp: "Removed from every list.",
  reset: "Restore defaults",
  autosaveNote: "Changes are saved automatically.",
  scopeSource: (project, source) => `${project} / ${source}`,
  browserOverride: "browser override",
  serverDefault: "server default",
  uploadsTitle: "Uploads",
  uploadEnabledLabel: "Allow uploads",
  uploadEnabledHelp: "Off means read-only.",
  datastoreTitle: "Datastores",
  datastoreInferFkLabel: "Infer FK",
  datastoreInferFkHelp: "Shows virtual links.",
  datastoreS3TooltipLabel: "S3 hover preview",
  datastoreS3TooltipHelp: "Shows the full key.",
  watchTitle: "File change watcher",
  watchLimit: "Maximum directories to watch",
  watchLimitHelp: (limit) => `Default is ${limit}.`,
};

const JA_TEXT: ViewerSettingsText = {
  ...EN_TEXT,
  display: "表示",
  language: "言語",
  sizeRegular: "標準",
  reset: "デフォルトに戻す",
};

function defaultValues(): ViewerSettingsValues {
  return {
    language: "en",
    sidebarFontSize: "regular",
    codeFontSize: "regular",
    omitDirs: "node_modules\ndist",
    excludeNames: ".DS_Store",
    watchLimit: 2048,
    watchLimitMin: 16,
    watchLimitMax: 65536,
    watchLimitDefault: 4096,
    uploadEnabled: true,
    inferFkRails: false,
    s3TooltipEnabled: true,
    scopeSource: "sample-project / server default",
  };
}

type Recorded = {
  language: string[];
  sidebarFontSize: string[];
  codeFontSize: string[];
  uploadEnabled: boolean[];
  omitDirs: string[];
  excludeNames: string[];
  watchLimit: string[];
  inferFk: boolean[];
  s3Tooltip: boolean[];
  reset: number;
  refresh: number;
  getValues: number;
};

function setup(
  options: { language?: "en" | "ja"; refresh?: () => Promise<void> } = {},
) {
  document.body.innerHTML = '<div id="host"></div>';
  const host = document.querySelector<HTMLElement>("#host");
  if (!host) throw new Error("missing host");

  let language: "en" | "ja" = options.language ?? "en";
  const values = defaultValues();
  const calls: Recorded = {
    language: [],
    sidebarFontSize: [],
    codeFontSize: [],
    uploadEnabled: [],
    omitDirs: [],
    excludeNames: [],
    watchLimit: [],
    inferFk: [],
    s3Tooltip: [],
    reset: 0,
    refresh: 0,
    getValues: 0,
  };

  const settings = createViewerSettings({
    getText: () => (language === "ja" ? JA_TEXT : EN_TEXT),
    getValues: () => {
      calls.getValues++;
      return { ...values };
    },
    refresh:
      options.refresh ??
      (async () => {
        calls.refresh++;
      }),
    onLanguageChange: (value) => calls.language.push(value),
    onSidebarFontSizeChange: (value) => calls.sidebarFontSize.push(value),
    onCodeFontSizeChange: (value) => calls.codeFontSize.push(value),
    onUploadEnabledChange: (checked) => calls.uploadEnabled.push(checked),
    onOmitDirsChange: (value) => calls.omitDirs.push(value),
    onExcludeNamesChange: (value) => calls.excludeNames.push(value),
    onWatchLimitChange: (value) => calls.watchLimit.push(value),
    onInferFkChange: (checked) => calls.inferFk.push(checked),
    onS3TooltipChange: (checked) => calls.s3Tooltip.push(checked),
    onReset: () => {
      calls.reset++;
    },
  });

  return {
    settings,
    host,
    calls,
    values,
    setLanguage(next: "en" | "ja") {
      language = next;
    },
  };
}

function fire(target: HTMLElement, type: "change" | "input"): void {
  target.dispatchEvent(new Event(type, { bubbles: true }));
}

describe("viewer settings form", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("shows the saved values when it is mounted", () => {
    const { settings, host } = setup();

    settings.mount(host);

    expect(q<HTMLSelectElement>(document, "#viewer-language").value).toBe("en");
    expect(q<HTMLTextAreaElement>(document, "#scope-omit-dirs").value).toBe(
      "node_modules\ndist",
    );
    expect(q<HTMLInputElement>(document, "#scope-watch-limit").value).toBe(
      "2048",
    );
    expect(q<HTMLInputElement>(document, "#upload-enabled").checked).toBe(true);
    expect(q<HTMLInputElement>(document, "#datastore-infer-fk").checked).toBe(
      false,
    );
    expect(q<HTMLElement>(document, "#scope-omit-source").textContent).toBe(
      "sample-project / server default",
    );
  });

  test.each([
    {
      name: "language",
      selector: "#viewer-language",
      value: "ja",
      read: (calls: Recorded) => calls.language,
      expected: ["ja"],
    },
    {
      name: "UI font size",
      selector: "#sidebar-font-size",
      value: "large",
      read: (calls: Recorded) => calls.sidebarFontSize,
      expected: ["large"],
    },
    {
      name: "code font size",
      selector: "#code-font-size",
      value: "compact",
      read: (calls: Recorded) => calls.codeFontSize,
      expected: ["compact"],
    },
    {
      name: "excluded directories",
      selector: "#scope-omit-dirs",
      value: "vendor",
      read: (calls: Recorded) => calls.omitDirs,
      expected: ["vendor"],
    },
    {
      name: "hidden names",
      selector: "#scope-exclude-names",
      value: "Thumbs.db",
      read: (calls: Recorded) => calls.excludeNames,
      expected: ["Thumbs.db"],
    },
  ])("changing $name reports the new value once", (testCase) => {
    const { settings, host, calls } = setup();
    settings.mount(host);

    const target = q<HTMLSelectElement | HTMLTextAreaElement>(
      document,
      testCase.selector,
    );
    target.value = testCase.value;
    fire(target, "change");

    expect(testCase.read(calls)).toEqual(testCase.expected);
  });

  test.each([
    {
      name: "uploads",
      selector: "#upload-enabled",
      checked: false,
      read: (calls: Recorded) => calls.uploadEnabled,
      expected: [false],
    },
    {
      name: "Rails FK inference",
      selector: "#datastore-infer-fk",
      checked: true,
      read: (calls: Recorded) => calls.inferFk,
      expected: [true],
    },
    {
      name: "the S3 hover preview",
      selector: "#datastore-s3-tooltip",
      checked: false,
      read: (calls: Recorded) => calls.s3Tooltip,
      expected: [false],
    },
  ])("toggling $name reports its state", (testCase) => {
    const { settings, host, calls } = setup();
    settings.mount(host);

    const toggle = q<HTMLInputElement>(document, testCase.selector);
    toggle.checked = testCase.checked;
    fire(toggle, "change");

    expect(testCase.read(calls)).toEqual(testCase.expected);
  });

  test("mounting again does not register the handlers twice", () => {
    const { settings, host, calls } = setup();
    settings.mount(host);
    settings.mount(host);

    const select = q<HTMLSelectElement>(document, "#viewer-language");
    select.value = "ja";
    fire(select, "change");

    expect(calls.language).toEqual(["ja"]);
    expect(document.querySelectorAll("#viewer-language")).toHaveLength(1);
  });

  test("keeps what is being typed when the form is mounted again", () => {
    const { settings, host } = setup();
    settings.mount(host);

    const omitDirs = q<HTMLTextAreaElement>(document, "#scope-omit-dirs");
    omitDirs.focus();
    omitDirs.value = "half-typed";

    settings.mount(host);

    expect(q<HTMLTextAreaElement>(document, "#scope-omit-dirs").value).toBe(
      "half-typed",
    );
  });

  test("surfaces a cursor restoration failure", () => {
    const { settings, host } = setup();
    settings.mount(host);

    const omitDirs = q<HTMLTextAreaElement>(document, "#scope-omit-dirs");
    omitDirs.focus();
    omitDirs.setSelectionRange = () => {
      throw new Error("selection restoration failed");
    };

    expect(() => settings.mount(host)).toThrow("selection restoration failed");
  });

  test("dragging the watch limit slider mirrors the number field without saving", () => {
    const { settings, host, calls } = setup();
    settings.mount(host);

    const range = q<HTMLInputElement>(document, "#scope-watch-limit-range");
    range.value = "8192";
    fire(range, "input");

    expect(q<HTMLInputElement>(document, "#scope-watch-limit").value).toBe(
      "8192",
    );
    expect(calls.watchLimit).toEqual([]);
  });

  test("releasing the watch limit slider saves it", () => {
    const { settings, host, calls } = setup();
    settings.mount(host);

    const range = q<HTMLInputElement>(document, "#scope-watch-limit-range");
    range.value = "8192";
    fire(range, "change");

    expect(calls.watchLimit).toEqual(["8192"]);
  });

  test("typing a watch limit saves it and moves the slider", () => {
    const { settings, host, calls } = setup();
    settings.mount(host);

    const number = q<HTMLInputElement>(document, "#scope-watch-limit");
    number.value = "512";
    fire(number, "change");

    expect(calls.watchLimit).toEqual(["512"]);
    expect(
      q<HTMLInputElement>(document, "#scope-watch-limit-range").value,
    ).toBe("512");
  });

  test("restore defaults asks the app to reset and then shows the new values", () => {
    const { settings, host, calls, values } = setup();
    settings.mount(host);

    q<HTMLTextAreaElement>(document, "#scope-omit-dirs").value = "stale";
    values.omitDirs = "node_modules";
    q<HTMLButtonElement>(document, "#scope-omit-reset").click();

    expect(calls.reset).toBe(1);
    expect(q<HTMLTextAreaElement>(document, "#scope-omit-dirs").value).toBe(
      "node_modules",
    );
  });

  // アプリ起動時の一括ローカライズはフォームを開く前にも走る。その時点では
  // 値を引く相手 (データストアの設定など) がまだ作られていないので、
  // ここで getValues に触ると初期化前アクセスで落ちる。
  test("stays quiet when localize runs before the form is mounted", () => {
    const harness = setup();

    harness.settings.localize();

    expect(harness.calls.getValues).toBe(0);
  });

  test("does not read values when sync runs before the form is mounted", () => {
    const harness = setup();

    harness.settings.sync();

    expect(harness.calls.getValues).toBe(0);
  });

  test("localize swaps the labels without touching the values", () => {
    const harness = setup();
    harness.settings.mount(harness.host);
    const before = q<HTMLSelectElement>(document, "#viewer-language").value;

    harness.setLanguage("ja");
    harness.settings.localize();

    expect(
      q<HTMLLabelElement>(document, 'label[for="viewer-language"]').textContent,
    ).toBe("言語");
    expect(
      q<HTMLButtonElement>(document, "#scope-omit-reset").textContent,
    ).toBe("デフォルトに戻す");
    expect(q<HTMLSelectElement>(document, "#viewer-language").value).toBe(
      before,
    );
  });

  test("pulls the latest settings from the server when it is shown", async () => {
    const { settings, host, calls } = setup();

    settings.mount(host);
    await Promise.resolve();

    expect(calls.refresh).toBe(1);
  });

  test("shows every refresh error detail instead of discarding the rejection", async () => {
    const cause = new TypeError("response body failed");
    const harness = setup({
      refresh: () =>
        Promise.reject(
          Object.assign(new Error("settings request failed"), { cause }),
        ),
    });

    harness.settings.mount(harness.host);
    await Promise.resolve();
    await Promise.resolve();

    const error = q<HTMLElement>(document, "#scope-settings-refresh-error");
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe(
      "Error: settings request failed\nCaused by: TypeError: response body failed",
    );
  });
});
