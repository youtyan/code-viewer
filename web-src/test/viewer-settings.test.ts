import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  createViewerSettings,
  type SettingsDraft,
  type ThemeChoice,
  type ViewerSettingsDraft,
  type ViewerSettingsText,
  type ViewerSettingsValues,
} from "../views/viewer-settings";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
} from "./_css-fixture";
import { deferred, q } from "./_test-helpers";

const shikiMock = vi.hoisted(() => ({ load: vi.fn() }));
const styleRules = baseRules(loadStyleSheet());

vi.mock("../core/shiki-loader", () => ({
  loadShikiHighlighter: shikiMock.load,
  highlightToInnerHtml: (code: string) =>
    `<code><span class="tok">${code}</span></code>`,
}));

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

const EN_TEXT: ViewerSettingsText = {
  display: "Display",
  theme: "Theme",
  themeHelp: "Applies right away.",
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
  sharedTagTitle: "Shared by all projects",
  userSettingsError: (detail) => `Shared settings cannot be used: ${detail}`,
  displaySource: "Applies to all projects in this browser.",
  excludedDirectories: "Excluded directories",
  omitDirs: "Skip these directory names",
  omitDirsHelp: "Contents are never read.",
  excludeNames: "Hide these names completely",
  excludeNamesHelp: "Removed from every list.",
  reset: "Restore defaults",
  save: "Save changes",
  saving: "Saving…",
  saved: "Saved.",
  unsaved: "Unsaved changes.",
  saveNote: "Edits are not applied until you save.",
  watchLimitInvalid: (min, max) => `Use an integer from ${min} to ${max}.`,
  scopeSource: (project, source) => `${project} / ${source}`,
  browserOverride: "browser override",
  serverDefault: "server default",
  uploadsTitle: "Uploads",
  uploadEnabledLabel: "Allow uploads",
  uploadEnabledHelp: "Off means read-only.",
  agentNotifyTitle: "Agent notifications",
  agentNotifyWaitingLabel: "Notify when waiting",
  agentNotifyDoneLabel: "Notify when finished",
  agentNotifyHelp: "Needs browser permission.",
  datastoreTitle: "Datastores",
  datastoreInferFkLabel: "Infer FK",
  datastoreInferFkHelp: "Shows virtual links.",
  datastoreS3TooltipLabel: "S3 hover preview",
  datastoreS3TooltipHelp: "Shows the full key.",
  watchTitle: "File change watcher",
  watchLimit: "Maximum directories to watch",
  watchLimitHelp: (limit) => `Default is ${limit}.`,
  agentRulesTitle: "Terminal state detection",
  agentRulesLabel: "Rules",
  agentRulesHelp: "Edit JSON rules.",
  agentRulesGuideTitle: "JSON format and example",
  agentRulesGuideIntro: "Use version 1 and a rules array.",
  agentRulesGuideFields: "Rule fields: id, state, priority, region, lines.",
  agentRulesGuideMatchers:
    "Matchers: contains, regex, lineRegex, all, any, not.",
  agentRulesGuideRegions:
    "Regions: osc_title, whole_recent, bottom_non_empty, last_non_empty.",
  agentRulesGuideExample: '{"version":1,"rules":[]}',
  agentRulesSave: "Save rules",
  agentRulesReset: "Use defaults",
  agentRulesSaving: "Saving rules…",
  agentRulesSourceDefault: "Built-in rules",
  agentRulesSourceSaved: "Saved rules",
  categories: {
    general: { label: "General", description: "General settings." },
    appearance: { label: "Appearance", description: "Look." },
    agents: { label: "Agents", description: "Agent settings." },
    accounts: { label: "Accounts", description: "Sign-in." },
    advanced: { label: "Advanced", description: "Rarely changed." },
  },
  searchPlaceholder: "Search settings",
  searchNoMatch: (query) => `No settings match "${query}".`,
};

const JA_TEXT: ViewerSettingsText = {
  ...EN_TEXT,
  display: "表示",
  language: "言語",
  sizeRegular: "標準",
  reset: "デフォルトに戻す",
  save: "変更を保存",
};

function defaultValues(): ViewerSettingsValues {
  return {
    userSettingsError: "",
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
    agentNotifyWaiting: true,
    agentNotifyDone: true,
    inferFkRails: false,
    s3TooltipEnabled: true,
    scopeSource: "sample-project / server default",
    agentRulesJson: '{\n  "version": 1,\n  "rules": []\n}\n',
    agentRulesSource: "saved",
    agentRulesErrors: "",
  };
}

type Recorded = {
  save: Array<{ draft: ViewerSettingsDraft; restoreDefaults: boolean }>;
  agentRulesSave: string[];
  agentRulesReset: number;
  refresh: number;
  getValues: number;
  theme: ThemeChoice[];
};

function setup(
  options: {
    language?: "en" | "ja";
    refresh?: () => Promise<void>;
    save?: (
      draft: ViewerSettingsDraft,
      options: {
        restoreDefaults: boolean;
        changedFields: readonly (keyof ViewerSettingsDraft)[];
      },
    ) => Promise<void>;
    saveRules?: (value: string) => Promise<void>;
    resetRules?: () => Promise<void>;
    draft?: SettingsDraft;
  } = {},
) {
  document.body.innerHTML = '<div id="host"></div>';
  const host = document.querySelector<HTMLElement>("#host");
  if (!host) throw new Error("missing host");

  let language: "en" | "ja" = options.language ?? "en";
  const values = defaultValues();
  const defaults: ViewerSettingsDraft = {
    language: "en",
    sidebarFontSize: "regular",
    codeFontSize: "regular",
    omitDirs: "node_modules",
    excludeNames: ".DS_Store",
    watchLimit: 4096,
    uploadEnabled: true,
    agentNotifyWaiting: true,
    agentNotifyDone: true,
    inferFkRails: false,
    s3TooltipEnabled: true,
  };
  const calls: Recorded = {
    save: [],
    agentRulesSave: [],
    agentRulesReset: 0,
    refresh: 0,
    getValues: 0,
    theme: [],
  };
  let theme: ThemeChoice = "dark";

  const settings = createViewerSettings({
    getText: () => (language === "ja" ? JA_TEXT : EN_TEXT),
    getTheme: () => theme,
    setTheme: (choice) => {
      calls.theme.push(choice);
      theme = choice;
    },
    getValues: () => {
      calls.getValues++;
      return { ...values };
    },
    getDefaultValues: () => ({ ...defaults }),
    refresh:
      options.refresh ??
      (async () => {
        calls.refresh++;
      }),
    onSave:
      options.save ??
      (async (draft, saveOptions) => {
        calls.save.push({
          draft: { ...draft },
          restoreDefaults: saveOptions.restoreDefaults,
        });
        Object.assign(values, draft);
      }),
    onAgentRulesSave:
      options.saveRules ??
      (async (value) => {
        calls.agentRulesSave.push(value);
      }),
    onAgentRulesReset:
      options.resetRules ??
      (async () => {
        calls.agentRulesReset++;
        values.agentRulesJson =
          '{\n  "version": 1,\n  "rules": ["default"]\n}\n';
        values.agentRulesSource = "default";
      }),
    agentHooksSection: sectionWithHeading("sample-hooks-heading", "Hooks"),
    agentAccountsSection: sectionWithHeading(
      "sample-accounts-heading",
      "Accounts list",
    ),
    drafts: options.draft ? [options.draft] : [],
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

function sectionWithHeading(id: string, title: string): HTMLElement {
  const section = document.createElement("div");
  const heading = document.createElement("strong");
  heading.id = id;
  heading.textContent = title;
  section.append(heading);
  return section;
}

/** 表示されている節の見出し (分類の切り替えと検索の結果)。 */
function visibleSectionTitles(host: HTMLElement): string[] {
  return Array.from(
    host.querySelectorAll<HTMLElement>(".scope-settings > *"),
    (element) => element,
  )
    .filter(
      (element) =>
        !element.hidden &&
        !element.classList.contains("scope-settings-footer") &&
        element.id !== "scope-settings-search-empty",
    )
    .map(
      (element) =>
        element.querySelector("strong")?.textContent?.trim() ?? element.tagName,
    );
}

function fire(target: HTMLElement, type: "change" | "input"): void {
  target.dispatchEvent(new Event(type, { bubbles: true }));
}

describe("viewer settings form", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    shikiMock.load.mockReset();
    shikiMock.load.mockResolvedValue({ codeToHtml: () => "" });
  });

  test.each([
    ["general", ["Uploads", "Excluded directories"]],
    ["appearance", ["Display"]],
    ["agents", ["Agent notifications", "Hooks"]],
    ["accounts", ["Accounts list"]],
    [
      "advanced",
      ["Datastores", "File change watcher", "Terminal state detection"],
    ],
  ] as const)("the %s category shows only its sections", (category, titles) => {
    const { settings, host } = setup();
    settings.mount(host);
    settings.setCategory(category);
    expect(settings.getCategory()).toBe(category);
    expect(visibleSectionTitles(host)).toEqual(titles);
  });

  test("searching ignores the category and lists every matching section", () => {
    const { settings, host } = setup();
    settings.mount(host);
    const search = document.createElement("div");
    settings.mountSearch(search);
    const input = search.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("missing search input");
    expect(input.placeholder).toBe("Search settings");
    input.value = "notify";
    fire(input, "input");
    expect(visibleSectionTitles(host)).toEqual(["Agent notifications"]);
    input.value = "no such setting";
    fire(input, "input");
    expect(visibleSectionTitles(host)).toEqual([]);
    expect(
      host.querySelector("#scope-settings-search-empty")?.textContent,
    ).toBe('No settings match "no such setting".');
    settings.setCategory("general");
    expect(input.value).toBe("");
    expect(visibleSectionTitles(host)).toEqual([
      "Uploads",
      "Excluded directories",
    ]);
  });

  // ヘルプの節 (設定以外) から開くと、設定の節を組む前に検索欄だけを出す。
  // そのときも placeholder を出す (以前は設定の節を開くまで空だった)。
  test("the search field has its placeholder before the settings are built", () => {
    const { settings, setLanguage } = setup();
    const search = document.createElement("div");
    settings.mountSearch(search);
    const input = search.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("missing search input");
    const before = [input.placeholder, input.getAttribute("aria-label")];
    setLanguage("ja");
    settings.localize();
    expect([...before, input.placeholder]).toEqual([
      "Search settings",
      "Search settings",
      JA_TEXT.searchPlaceholder,
    ]);
  });

  test("revealing a heading switches to the category that holds it", () => {
    const { settings, host } = setup();
    settings.revealHeading("sample-accounts-heading");
    expect(settings.getCategory()).toBe("accounts");
    settings.revealHeading("agent-notify-section-title");
    expect(settings.getCategory()).toBe("agents");
    settings.revealHeading("missing-heading");
    expect(settings.getCategory()).toBe("agents");
    settings.mount(host);
    expect(visibleSectionTitles(host)).toEqual([
      "Agent notifications",
      "Hooks",
    ]);
  });

  test("shows the saved values when it is mounted", () => {
    const { settings, host, values } = setup();

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
    expect(q<HTMLTextAreaElement>(document, "#agent-screen-rules").value).toBe(
      values.agentRulesJson,
    );
    expect(
      q<HTMLElement>(document, "#agent-screen-rules-source").textContent,
    ).toBe("Saved rules");
  });

  test("判定ルールをボタンで保存する", async () => {
    const { settings, host, calls } = setup();
    settings.mount(host);
    const editor = q<HTMLTextAreaElement>(document, "#agent-screen-rules");
    editor.value = '{"version":1,"rules":[]}';
    q<HTMLButtonElement>(document, "#agent-screen-rules-save").click();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls.agentRulesSave).toEqual(['{"version":1,"rules":[]}']);
    expect(editor.disabled).toBe(false);
  });

  test("判定ルールを既定へ戻して表示を同期する", async () => {
    const { settings, host, calls } = setup();
    settings.mount(host);
    q<HTMLButtonElement>(document, "#agent-screen-rules-reset").click();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls.agentRulesReset).toBe(1);
    expect(
      q<HTMLTextAreaElement>(document, "#agent-screen-rules").value,
    ).toContain('"default"');
    expect(
      q<HTMLElement>(document, "#agent-screen-rules-source").textContent,
    ).toBe("Built-in rules");
  });

  test("判定ルールの保存失敗を原因まで表示する", async () => {
    const harness = setup({
      saveRules: () =>
        Promise.reject(
          Object.assign(new Error("rule validation failed"), {
            errors: [
              { path: "rules[0].regex[0]", code: "invalid_regex" },
              { path: "rules[1].state", code: "invalid_state" },
            ],
          }),
        ),
    });
    harness.settings.mount(harness.host);
    q<HTMLButtonElement>(document, "#agent-screen-rules-save").click();
    await Promise.resolve();
    await Promise.resolve();
    const error = q<HTMLElement>(document, "#agent-screen-rules-error");
    expect(error.hidden).toBe(false);
    expect(error.textContent).toContain("rules[0].regex[0]");
    expect(error.textContent).toContain("rules[1].state");
  });

  test.each([
    {
      name: "language",
      selector: "#viewer-language",
      value: "ja",
      event: "change" as const,
    },
    {
      name: "UI font size",
      selector: "#sidebar-font-size",
      value: "large",
      event: "change" as const,
    },
    {
      name: "code font size",
      selector: "#code-font-size",
      value: "compact",
      event: "change" as const,
    },
    {
      name: "excluded directories",
      selector: "#scope-omit-dirs",
      value: "vendor",
      event: "input" as const,
    },
    {
      name: "hidden names",
      selector: "#scope-exclude-names",
      value: "Thumbs.db",
      event: "input" as const,
    },
  ])("editing $name does not save it", (testCase) => {
    const { settings, host, calls } = setup();
    settings.mount(host);

    const target = q<HTMLSelectElement | HTMLTextAreaElement>(
      document,
      testCase.selector,
    );
    target.value = testCase.value;
    fire(target, testCase.event);

    expect(calls.save).toEqual([]);
    expect(
      q<HTMLButtonElement>(document, "#scope-settings-save").disabled,
    ).toBe(false);
  });

  test.each([
    {
      name: "uploads",
      selector: "#upload-enabled",
      checked: false,
    },
    {
      name: "Rails FK inference",
      selector: "#datastore-infer-fk",
      checked: true,
    },
    {
      name: "the S3 hover preview",
      selector: "#datastore-s3-tooltip",
      checked: false,
    },
  ])("toggling $name does not save it", (testCase) => {
    const { settings, host, calls } = setup();
    settings.mount(host);

    const toggle = q<HTMLInputElement>(document, testCase.selector);
    toggle.checked = testCase.checked;
    fire(toggle, "change");

    expect(calls.save).toEqual([]);
  });

  test("the theme applies as soon as it is picked, without the save button", () => {
    const { settings, host, calls } = setup();
    settings.mount(host);
    const theme = q<HTMLSelectElement>(document, "#viewer-theme");
    expect(theme.value).toBe("dark");
    expect([...theme.options].map((option) => option.textContent)).toEqual([
      "Dark (violet)",
      "Dark (graphite)",
      "Dark (warm gray)",
      "Light",
    ]);

    theme.value = "warm";
    fire(theme, "change");

    expect(calls.theme).toEqual(["warm"]);
    expect(calls.save).toEqual([]);
    expect(
      q<HTMLButtonElement>(document, "#scope-settings-save").disabled,
    ).toBe(true);
  });

  test("the save button submits all edited settings once", async () => {
    const { settings, host, calls } = setup();
    settings.mount(host);

    const language = q<HTMLSelectElement>(document, "#viewer-language");
    language.value = "ja";
    fire(language, "change");
    const omitDirs = q<HTMLTextAreaElement>(document, "#scope-omit-dirs");
    omitDirs.value = "vendor";
    fire(omitDirs, "input");
    const upload = q<HTMLInputElement>(document, "#upload-enabled");
    upload.checked = false;
    fire(upload, "change");
    const notifyWaiting = q<HTMLInputElement>(
      document,
      "#agent-notify-waiting",
    );
    notifyWaiting.checked = false;
    fire(notifyWaiting, "change");
    q<HTMLButtonElement>(document, "#scope-settings-save").click();
    await Promise.resolve();
    await Promise.resolve();

    expect(calls.save).toEqual([
      {
        draft: {
          language: "ja",
          sidebarFontSize: "regular",
          codeFontSize: "regular",
          omitDirs: "vendor",
          excludeNames: ".DS_Store",
          watchLimit: 2048,
          uploadEnabled: false,
          agentNotifyWaiting: false,
          agentNotifyDone: true,
          inferFkRails: false,
          s3TooltipEnabled: true,
        },
        restoreDefaults: false,
      },
    ]);
    expect(
      q<HTMLButtonElement>(document, "#scope-settings-save").disabled,
    ).toBe(true);
  });

  test("the save operation identifies only fields edited by the user", async () => {
    let changedFields: readonly (keyof ViewerSettingsDraft)[] = [];
    const { settings, host } = setup({
      save: async (_draft, options) => {
        changedFields = options.changedFields;
      },
    });
    settings.mount(host);
    const fontSize = q<HTMLSelectElement>(document, "#sidebar-font-size");
    fontSize.value = "large";
    fire(fontSize, "change");
    const upload = q<HTMLInputElement>(document, "#upload-enabled");
    upload.checked = false;
    fire(upload, "change");

    q<HTMLButtonElement>(document, "#scope-settings-save").click();
    await Promise.resolve();
    await Promise.resolve();

    expect(changedFields).toEqual(["sidebarFontSize", "uploadEnabled"]);
  });

  test("mounting again does not register the save handler twice", async () => {
    const { settings, host, calls } = setup();
    settings.mount(host);
    settings.mount(host);

    const select = q<HTMLSelectElement>(document, "#viewer-language");
    select.value = "ja";
    fire(select, "change");
    q<HTMLButtonElement>(document, "#scope-settings-save").click();
    await Promise.resolve();
    await Promise.resolve();

    expect(calls.save).toHaveLength(1);
    expect(document.querySelectorAll("#viewer-language")).toHaveLength(1);
  });

  test("keeps an unsaved draft when the form is mounted again", () => {
    const { settings, host } = setup();
    settings.mount(host);

    const omitDirs = q<HTMLTextAreaElement>(document, "#scope-omit-dirs");
    omitDirs.value = "half-typed";
    fire(omitDirs, "input");

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
    expect(calls.save).toEqual([]);
  });

  test("releasing the watch limit slider only marks the draft unsaved", () => {
    const { settings, host, calls } = setup();
    settings.mount(host);

    const range = q<HTMLInputElement>(document, "#scope-watch-limit-range");
    range.value = "8192";
    fire(range, "change");

    expect(calls.save).toEqual([]);
    expect(
      q<HTMLButtonElement>(document, "#scope-settings-save").disabled,
    ).toBe(false);
  });

  test("typing a watch limit moves the slider without saving", () => {
    const { settings, host, calls } = setup();
    settings.mount(host);

    const number = q<HTMLInputElement>(document, "#scope-watch-limit");
    number.value = "512";
    fire(number, "change");

    expect(calls.save).toEqual([]);
    expect(
      q<HTMLInputElement>(document, "#scope-watch-limit-range").value,
    ).toBe("512");
  });

  describe("one save for the whole page (section drafts)", () => {
    function fakeDraft(save: () => Promise<void> = () => Promise.resolve()) {
      let dirty = false;
      const listeners: Array<() => void> = [];
      const saves: number[] = [];
      const draft: SettingsDraft = {
        dirty: () => dirty,
        async save() {
          saves.push(1);
          await save();
          dirty = false;
        },
        subscribe(listener) {
          listeners.push(listener);
        },
      };
      return {
        draft,
        saves,
        edit(next = true) {
          dirty = next;
          for (const listener of listeners) listener();
        },
      };
    }
    const status = () =>
      q<HTMLElement>(document, "#scope-settings-save-status");
    const saveButton = () =>
      q<HTMLButtonElement>(document, "#scope-settings-save");

    test("an edited section alone marks the page unsaved and is saved by Save changes", async () => {
      const section = fakeDraft();
      const { settings, host, calls } = setup({ draft: section.draft });
      settings.mount(host);
      expect(saveButton().disabled).toBe(true);
      expect(status().dataset.state).toBe("");

      section.edit();
      expect(saveButton().disabled).toBe(false);
      expect(status().dataset.state).toBe("unsaved");
      expect(status().textContent).toBe("Unsaved changes.");

      saveButton().click();
      await vi.waitFor(() => expect(status().dataset.state).toBe("saved"));
      expect(section.saves).toEqual([1]);
      expect(calls.save).toEqual([]);
      expect(saveButton().disabled).toBe(true);
    });

    test("undoing the section edit clears the unsaved mark", () => {
      const section = fakeDraft();
      const { settings, host } = setup({ draft: section.draft });
      settings.mount(host);
      section.edit();
      section.edit(false);
      expect(status().dataset.state).toBe("");
      expect(saveButton().disabled).toBe(true);
    });

    test("general fields and a section are saved together, once each", async () => {
      const section = fakeDraft();
      const { settings, host, calls } = setup({ draft: section.draft });
      settings.mount(host);
      const upload = q<HTMLInputElement>(document, "#upload-enabled");
      upload.checked = !upload.checked;
      fire(upload, "change");
      section.edit();
      saveButton().click();
      await vi.waitFor(() => expect(status().dataset.state).toBe("saved"));
      expect(calls.save).toHaveLength(1);
      expect(section.saves).toEqual([1]);
    });

    test("a section that fails to save stays unsaved and shows the whole cause", async () => {
      const section = fakeDraft(async () => {
        throw Object.assign(
          new Error("save the launch commands (HTTP 400): sample reason"),
          { cause: new Error("sample cause") },
        );
      });
      const { settings, host } = setup({ draft: section.draft });
      settings.mount(host);
      section.edit();
      saveButton().click();
      const error = q<HTMLElement>(document, "#scope-settings-save-error");
      await vi.waitFor(() => expect(error.hidden).toBe(false));
      expect(error.textContent).toContain("sample reason");
      expect(error.textContent).toContain("sample cause");
      expect(status().dataset.state).toBe("unsaved");
      expect(saveButton().disabled).toBe(false);
    });

    test("restore defaults at the bottom is only offered where it has something to restore", () => {
      const { settings, host } = setup();
      settings.mount(host);
      const reset = () => q<HTMLButtonElement>(document, "#scope-omit-reset");
      expect(reset().hidden).toBe(false);
      settings.setCategory("accounts");
      expect(reset().hidden).toBe(true);
      settings.setCategory("advanced");
      expect(reset().hidden).toBe(false);
    });
  });

  test("restore defaults stages values until the save button is pressed", async () => {
    const { settings, host, calls } = setup();
    settings.mount(host);

    q<HTMLTextAreaElement>(document, "#scope-omit-dirs").value = "stale";
    q<HTMLButtonElement>(document, "#scope-omit-reset").click();

    expect(calls.save).toEqual([]);
    expect(q<HTMLTextAreaElement>(document, "#scope-omit-dirs").value).toBe(
      "node_modules",
    );
    q<HTMLButtonElement>(document, "#scope-settings-save").click();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls.save[0]?.restoreDefaults).toBe(true);
  });

  test("an invalid watch limit stays unsaved and shows its bounds", async () => {
    const { settings, host, calls } = setup();
    settings.mount(host);
    const number = q<HTMLInputElement>(document, "#scope-watch-limit");
    number.value = "15";
    fire(number, "input");

    q<HTMLButtonElement>(document, "#scope-settings-save").click();
    await Promise.resolve();

    expect(calls.save).toEqual([]);
    expect(
      q<HTMLElement>(document, "#scope-settings-save-error").textContent,
    ).toBe("Use an integer from 16 to 65536.");
  });

  test("a failed save keeps the draft and shows the complete cause", async () => {
    const harness = setup({
      save: () =>
        Promise.reject(
          Object.assign(new Error("settings save failed"), {
            cause: new TypeError("response body failed"),
          }),
        ),
    });
    harness.settings.mount(harness.host);
    const omitDirs = q<HTMLTextAreaElement>(document, "#scope-omit-dirs");
    omitDirs.value = "half-typed";
    fire(omitDirs, "input");

    q<HTMLButtonElement>(document, "#scope-settings-save").click();
    await Promise.resolve();
    await Promise.resolve();

    expect(omitDirs.value).toBe("half-typed");
    expect(
      q<HTMLElement>(document, "#scope-settings-save-error").textContent,
    ).toBe(
      "Error: settings save failed\nCaused by: TypeError: response body failed",
    );
    expect(
      q<HTMLButtonElement>(document, "#scope-settings-save").disabled,
    ).toBe(false);
  });

  test("a server refresh cannot overwrite an unsaved draft", async () => {
    const refresh = deferred<void>();
    const harness = setup({ refresh: () => refresh.promise });
    harness.settings.mount(harness.host);
    const omitDirs = q<HTMLTextAreaElement>(document, "#scope-omit-dirs");
    omitDirs.value = "draft-value";
    fire(omitDirs, "input");
    harness.values.omitDirs = "server-value";

    refresh.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(omitDirs.value).toBe("draft-value");
  });

  test("the JSON editor shows a format guide and highlighted input", async () => {
    const { settings, host } = setup();
    settings.mount(host);
    const editor = q<HTMLTextAreaElement>(document, "#agent-screen-rules");
    editor.value = '{"state":"working"}';
    fire(editor, "input");
    await Promise.resolve();
    await Promise.resolve();

    expect(
      q<HTMLElement>(document, "#agent-screen-rules-guide").textContent,
    ).toContain("Rule fields: id, state, priority, region, lines.");
    expect(
      q<HTMLElement>(document, ".agent-screen-rules-highlight").innerHTML,
    ).toContain('<span class="tok">');
  });

  test("the JSON editor keeps the textarea and highlighted layer aligned", () => {
    const highlight = cascadedDeclarations(
      styleRules,
      (selector) => selector === ".agent-screen-rules-highlight",
    );
    const highlightedTrailingLine = cascadedDeclarations(
      styleRules,
      (selector) => selector === ".agent-screen-rules-highlight code::after",
    );
    const textarea = cascadedDeclarations(
      styleRules,
      (selector) => selector === "#agent-screen-rules",
    );

    expect(textarea.get("display")).toBe("block");
    expect(highlight.get("overflow-y")).toBe("scroll");
    expect(textarea.get("overflow-y")).toBe("scroll");
    expect(highlight.get("scrollbar-gutter")).toBe("stable");
    expect(textarea.get("scrollbar-gutter")).toBe("stable");
    expect(highlightedTrailingLine.get("content")).toBe('"\\200b"');
    expect(highlightedTrailingLine.get("display")).toBe("inline-block");
    expect(highlightedTrailingLine.get("height")).toBe("19px");
  });

  test("the JSON editor keeps selected text readable", () => {
    const selection = cascadedDeclarations(
      styleRules,
      (selector) => selector === "#agent-screen-rules::selection",
    );

    expect(selection.get("background")).toBe("var(--accent)");
    expect(selection.get("color")).toBe("var(--fg-onemphasis)");
  });

  test("a JSON highlighter failure is visible without losing the input", async () => {
    shikiMock.load.mockRejectedValue(new Error("highlighter asset failed"));
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { settings, host, values } = setup();
    settings.mount(host);
    await Promise.resolve();
    await Promise.resolve();

    expect(
      q<HTMLElement>(document, "#agent-screen-rules-highlight-error")
        .textContent,
    ).toContain("highlighter asset failed");
    expect(q<HTMLTextAreaElement>(document, "#agent-screen-rules").value).toBe(
      values.agentRulesJson,
    );
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
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

  test("保存開始前の古い読込エラーを保存後の画面へ出さない", async () => {
    const refresh = deferred<void>();
    const harness = setup({ refresh: () => refresh.promise });
    harness.settings.mount(harness.host);

    const language = q<HTMLSelectElement>(document, "#viewer-language");
    language.value = "ja";
    fire(language, "change");
    q<HTMLButtonElement>(document, "#scope-settings-save").click();
    await Promise.resolve();
    await Promise.resolve();
    refresh.reject(new Error("stale refresh failed"));
    await Promise.resolve();
    await Promise.resolve();

    expect(
      q<HTMLElement>(document, "#scope-settings-refresh-error").hidden,
    ).toBe(true);
  });
});
