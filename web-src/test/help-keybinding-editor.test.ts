// 設定の「ショートカット」の節を happy-dom 上で動かす。押した打鍵がそのまま差分に
// なること、記録中の打鍵がアプリのキー割り当てへ漏れないこと、取り合うキーは
// 置き換えるか聞くこと、効く所・既定に戻す・JSON の書き出し / 読み込み / 直接編集、
// 保存がページの「変更を保存」(SettingsDraft) だけで起きることを確かめる。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";
import {
  defaultKeyBindings,
  type KeymapOverrides,
  resolveKeyBindings,
  resolveKeyOutcome,
} from "../core/keymap";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
  resolveVar,
} from "./_css-fixture";
import {
  clickDialogCancel,
  clickDialogConfirm,
  closeOpenDialog,
} from "./_dialog-helpers";

GlobalRegistrator.register();

const { createShortcutSettings } = await import(
  "../views/help-keybinding-editor"
);

afterEach(() => {
  closeOpenDialog();
  document.body.innerHTML = "";
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

type Harness = ReturnType<typeof setup>;

function setup(saved: KeymapOverrides = {}, mac = true) {
  const state = {
    saved,
    saves: [] as KeymapOverrides[],
    downloads: [] as Array<{ fileName: string; text: string }>,
    notified: 0,
  };
  const settings = createShortcutSettings({
    getLanguage: () => "en",
    mac,
    getSaved: () => state.saved,
    save: async (next) => {
      state.saves.push(next);
      state.saved = next;
    },
    getSharedTag: () => ({ text: "All projects", title: "Shared" }),
    download: (fileName, text) => state.downloads.push({ fileName, text }),
  });
  settings.draft.subscribe(() => {
    state.notified += 1;
  });
  document.body.append(settings.element);
  return { settings, state, root: settings.element };
}

function row(root: HTMLElement, action: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(
    `.shortcut-row[data-action="${action}"]`,
  );
  if (!found) throw new Error(`no row for ${action}`);
  return found;
}

function open(root: HTMLElement, action: string): HTMLElement {
  row(root, action)
    .querySelector<HTMLButtonElement>(".shortcut-row-head")
    ?.click();
  return row(root, action);
}

/** 行のキー。PWA の窓だけの印が付いた升は「(PWA)」を添えて読む。 */
function keysOf(root: HTMLElement, action: string): string[] {
  return Array.from(
    row(root, action).querySelectorAll(".shortcut-keys .shortcut-key"),
    (cell) =>
      `${cell.querySelector("kbd")?.textContent ?? ""}${cell.querySelector(".shortcut-key-pwa") ? " (PWA)" : ""}`,
  );
}

function press(
  root: HTMLElement,
  action: string,
  init: KeyboardEventInit & { key: string },
): void {
  row(root, action).querySelector<HTMLButtonElement>(".shortcut-add")?.click();
  document.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
  );
}

function removeFirstKey(root: HTMLElement, action: string): void {
  row(root, action)
    .querySelector<HTMLButtonElement>(".shortcut-chord-remove")
    ?.click();
}

function toolbarButton(root: HTMLElement, key: string): HTMLButtonElement {
  const found = root.querySelector<HTMLButtonElement>(
    `.shortcut-toolbar [data-focus-key="${key}"]`,
  );
  if (!found) throw new Error(`no toolbar button ${key}`);
  return found;
}

function draftAfterSave(h: Harness): Promise<KeymapOverrides> {
  return h.settings.draft.save().then(() => h.state.saves[0]);
}

describe("the list of actions", () => {
  test("lists every action of the app, grouped, with its keys", () => {
    const { root } = setup();

    const groups = Array.from(
      root.querySelectorAll(".shortcut-group-title"),
      (el) => el.textContent,
    );

    expect([
      groups,
      root.querySelectorAll(".shortcut-row").length,
      keysOf(root, "toggle-theme"),
      keysOf(root, "main-tab-previous"),
      keysOf(root, "new-agent"),
      // 前・次のプロジェクトへ (タブのグループの作業で足した 2 つの操作)。
      keysOf(root, "project-next"),
      // ヘルプのページを開く (設定とヘルプを分けたときに足した。既定のキーは無い)。
      keysOf(root, "open-help-page"),
    ]).toEqual([
      ["Global", "Panels", "Screens", "Tabs", "File list", "Main Panel"],
      83,
      ["t"],
      [
        "g+Shift+T",
        "Ctrl+Shift+Tab (PWA)",
        "Meta+Shift+[ (PWA)",
        "Meta+Shift+{ (PWA)",
        "Meta+ArrowLeft (PWA)",
      ],
      [],
      ["Meta+Shift+ArrowDown", "Ctrl+Shift+ArrowDown"],
      [],
    ]);
  });

  test.each([
    { name: "by the action name", query: "theme", rows: ["toggle-theme"] },
    {
      name: "by a key label",
      query: "meta+arrowleft",
      rows: ["main-tab-previous"],
    },
    {
      name: "by the action id",
      query: "goto-worktrees",
      rows: ["goto-worktrees"],
    },
    { name: "with nothing matching", query: "zzz-none", rows: [] },
  ])("filters $name", ({ query, rows }) => {
    const { root } = setup();
    const filter = root.querySelector<HTMLInputElement>(".shortcut-filter");
    if (!filter) throw new Error("no filter");

    filter.value = query;
    filter.dispatchEvent(new Event("input"));

    expect([
      Array.from(
        root.querySelectorAll<HTMLElement>(".shortcut-row"),
        (el) => el.dataset.action,
      ),
      root.querySelector<HTMLElement>(".shortcut-filter-empty")?.hidden,
    ]).toEqual([rows, rows.length > 0]);
  });

  test("marks the actions the user already changed", () => {
    const { root } = setup({ "toggle-theme": [{ key: "x" }] });

    expect([
      row(root, "toggle-theme").dataset.changed,
      row(root, "layout-split").dataset.changed,
    ]).toEqual(["true", undefined]);
  });
});

describe("assigning keys", () => {
  test("saves the key that was pressed, only through the page's Save", async () => {
    const h = setup();
    open(h.root, "toggle-theme");

    removeFirstKey(h.root, "toggle-theme");
    press(h.root, "toggle-theme", { key: "X", ctrlKey: true });

    expect([h.state.saves, h.settings.draft.dirty()]).toEqual([[], true]);
    expect(await draftAfterSave(h)).toEqual({
      "toggle-theme": [{ key: "x", ctrl: true }],
    });
    expect(h.settings.draft.dirty()).toBe(false);
  });

  test("gives one action several keys", async () => {
    const h = setup();
    open(h.root, "toggle-theme");

    press(h.root, "toggle-theme", { key: "F7" });
    press(h.root, "toggle-theme", { key: "x", altKey: true });

    expect(keysOf(h.root, "toggle-theme")).toEqual(["t", "f7", "Alt+X"]);
    expect(await draftAfterSave(h)).toEqual({
      "toggle-theme": [{ key: "t" }, { key: "f7" }, { key: "x", alt: true }],
    });
  });

  test("a key assigned in the settings actually runs the action", async () => {
    const h = setup();
    open(h.root, "toggle-theme");
    press(h.root, "toggle-theme", { key: "F7" });
    const saved = await draftAfterSave(h);

    const bindings = resolveKeyBindings(saved, defaultKeyBindings(true));
    expect(
      resolveKeyOutcome(
        { key: "F7" },
        { scope: "main", editable: false, mac: true },
        bindings,
      ),
    ).toEqual({ kind: "run", action: "toggle-theme" });
  });

  test("keeps recording when drawing again replaces the Add key button (Chrome blurs it while still attached)", async () => {
    const h = setup();
    open(h.root, "toggle-theme");
    const add = row(h.root, "toggle-theme").querySelector<HTMLButtonElement>(
      ".shortcut-add",
    );
    const list = h.root.querySelector<HTMLElement>(".shortcut-list");
    if (!add || !list) throw new Error("no Add key button");
    // Chrome は描き直しで外す途中の (まだ付いている) ボタンに blur を出す。
    const replace = list.replaceChildren.bind(list);
    list.replaceChildren = (...nodes) => {
      if (add.isConnected) add.dispatchEvent(new FocusEvent("blur"));
      replace(...nodes);
    };

    add.click();
    await Promise.resolve();
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "F7",
      }),
    );

    expect(await draftAfterSave(h)).toEqual({
      "toggle-theme": [{ key: "t" }, { key: "f7" }],
    });
  });

  test("stops recording when the focus leaves the Add key button", async () => {
    const h = setup();
    open(h.root, "toggle-theme");
    row(h.root, "toggle-theme")
      .querySelector<HTMLButtonElement>(".shortcut-add")
      ?.click();
    const live = row(h.root, "toggle-theme").querySelector<HTMLButtonElement>(
      ".shortcut-add",
    );

    live?.dispatchEvent(new FocusEvent("blur"));
    await Promise.resolve();
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "F7",
      }),
    );

    expect([keysOf(h.root, "toggle-theme"), h.settings.draft.dirty()]).toEqual([
      ["t"],
      false,
    ]);
  });

  test("records the g prefix when asked", async () => {
    const h = setup();
    open(h.root, "toggle-theme");
    row(h.root, "toggle-theme")
      .querySelector<HTMLInputElement>(".shortcut-gfirst input")
      ?.click();

    press(h.root, "toggle-theme", { key: "q" });

    expect(await draftAfterSave(h)).toEqual({
      "toggle-theme": [{ key: "t" }, { key: "q", pendingG: true }],
    });
  });

  test("keeps the pressed key away from the rest of the app", () => {
    const h = setup();
    open(h.root, "toggle-theme");
    let leaked = 0;
    const listener = () => {
      leaked++;
    };
    document.addEventListener("keydown", listener);

    press(h.root, "toggle-theme", { key: "Escape" });
    document.removeEventListener("keydown", listener);

    expect(leaked).toBe(0);
  });

  test.each([
    { name: "Space", init: { key: " " }, expected: [{ key: "space" }] },
    { name: "Shift on its own", init: { key: "Shift" }, expected: [] },
    { name: "Control on its own", init: { key: "Control" }, expected: [] },
    { name: "Alt on its own", init: { key: "Alt" }, expected: [] },
    { name: "Meta on its own", init: { key: "Meta" }, expected: [] },
    {
      name: "a key typed while the IME is composing",
      init: { key: "a", isComposing: true },
      expected: [],
    },
  ])("records $name as $expected", async ({ init, expected }) => {
    const h = setup();
    open(h.root, "toggle-theme");
    removeFirstKey(h.root, "toggle-theme");

    press(h.root, "toggle-theme", init);

    expect(await draftAfterSave(h)).toEqual({ "toggle-theme": expected });
  });

  test("records Escape as an ordinary key (after asking, since another action uses it)", async () => {
    const h = setup();
    open(h.root, "toggle-theme");
    removeFirstKey(h.root, "toggle-theme");

    press(h.root, "toggle-theme", { key: "Escape" });
    row(h.root, "toggle-theme")
      .querySelector<HTMLButtonElement>(".shortcut-conflict-replace")
      ?.click();

    expect(await draftAfterSave(h)).toEqual({
      "toggle-theme": [{ key: "escape" }],
      "cancel-source-load": [],
    });
  });

  test("removing every key turns the action off", async () => {
    const h = setup();
    open(h.root, "toggle-theme");

    removeFirstKey(h.root, "toggle-theme");

    expect(keysOf(h.root, "toggle-theme")).toEqual([]);
    expect(await draftAfterSave(h)).toEqual({ "toggle-theme": [] });
  });

  test("restore default drops the action from the changes", async () => {
    const h = setup({ "toggle-theme": [{ key: "x" }] });
    open(h.root, "toggle-theme");

    row(h.root, "toggle-theme")
      .querySelector<HTMLButtonElement>(
        '[data-focus-key="toggle-theme:restore"]',
      )
      ?.click();

    expect(keysOf(h.root, "toggle-theme")).toEqual(["t"]);
    expect(await draftAfterSave(h)).toEqual({});
  });

  test.each([
    {
      name: "Cmd+Shift+W (left to close the window)",
      key: "W",
      shift: true,
      notice:
        "Meta+Shift+W is left to close the window, so it cannot be assigned.",
    },
    {
      name: "Cmd+Q (quits the browser)",
      key: "q",
      shift: false,
      notice: "Meta+Q quits the browser, so it cannot be assigned.",
    },
  ])("refuses $name and says why", ({ key, shift, notice }) => {
    const h = setup();
    open(h.root, "toggle-theme");

    press(h.root, "toggle-theme", { key, metaKey: true, shiftKey: shift });

    expect([
      keysOf(h.root, "toggle-theme"),
      row(h.root, "toggle-theme").querySelector(".shortcut-notice")
        ?.textContent,
      h.settings.draft.dirty(),
    ]).toEqual([["t"], notice, false]);
  });
});

describe("a key another action already uses", () => {
  function clash() {
    const h = setup();
    open(h.root, "toggle-theme");
    removeFirstKey(h.root, "toggle-theme");
    // s は split レイアウトが使っている。
    press(h.root, "toggle-theme", { key: "s" });
    return h;
  }

  test("names the action that uses it and asks before taking it", () => {
    const h = clash();

    expect([
      row(h.root, "toggle-theme").querySelector(".shortcut-conflict p")
        ?.textContent,
      keysOf(h.root, "toggle-theme"),
      keysOf(h.root, "layout-split"),
    ]).toEqual(["s is used by Split diff layout.", [], ["s"]]);
  });

  test("Replace moves the key from the other action", async () => {
    const h = clash();

    row(h.root, "toggle-theme")
      .querySelector<HTMLButtonElement>(".shortcut-conflict-replace")
      ?.click();

    expect(await draftAfterSave(h)).toEqual({
      "toggle-theme": [{ key: "s" }],
      "layout-split": [],
    });
  });

  test("Cancel leaves both actions as they were", async () => {
    const h = clash();

    row(h.root, "toggle-theme")
      .querySelector<HTMLButtonElement>(".shortcut-conflict-cancel")
      ?.click();

    expect([
      h.root.querySelector(".shortcut-conflict"),
      keysOf(h.root, "layout-split"),
      await draftAfterSave(h),
    ]).toEqual([null, ["s"], { "toggle-theme": [] }]);
  });
});

describe("where a key works", () => {
  function whereBoxes(root: HTMLElement, action: string, index = 0) {
    const chord = row(root, action).querySelectorAll(".shortcut-chord")[index];
    return Array.from(
      chord.querySelectorAll<HTMLInputElement>(".shortcut-where input"),
    );
  }

  test.each([
    {
      name: "a plain letter works outside text fields and terminals",
      action: "toggle-theme",
      index: 0,
      expected: [false, false, false, false, false, false],
    },
    {
      name: "Cmd+K works in text fields and terminals",
      action: "open-file-palette",
      index: 1,
      expected: [true, true, false, false, false, false],
    },
    {
      name: "Cmd+Left works in terminals, only in the app window",
      action: "main-tab-previous",
      index: 4,
      expected: [false, true, true, false, false, false],
    },
    {
      name: "Cmd+W is kept by browser tabs, so the app window box is fixed",
      action: "main-tab-close",
      index: 1,
      expected: [true, true, true, false, false, true],
    },
  ])("$name", ({ action, index, expected }) => {
    const { root } = setup();
    open(root, action);

    const boxes = whereBoxes(root, action, index);
    expect([
      ...boxes.map((box) => box.checked),
      ...boxes.map((box) => box.disabled),
    ]).toEqual(expected);
  });

  test.each([
    {
      name: "allowing text fields stores only that",
      action: "toggle-theme",
      index: 0,
      box: 0,
      expected: { "toggle-theme": [{ key: "t", inputs: true }] },
    },
    {
      name: "allowing terminals stores only that",
      action: "toggle-theme",
      index: 0,
      box: 1,
      expected: { "toggle-theme": [{ key: "t", terminal: true }] },
    },
    {
      name: "limiting to the app window stores only that",
      action: "toggle-theme",
      index: 0,
      box: 2,
      expected: { "toggle-theme": [{ key: "t", pwa: true }] },
    },
    {
      name: "letting Cmd+Left work in browser tabs too",
      action: "main-tab-previous",
      index: 4,
      box: 2,
      expected: {
        "main-tab-previous": [
          { key: "t", shift: true, pendingG: true },
          { key: "tab", ctrl: true, shift: true },
          { key: "[", meta: true, shift: true },
          { key: "{", meta: true, shift: true },
          { key: "arrowleft", meta: true, pwa: false },
        ],
      },
    },
  ])("$name", async ({ action, index, box, expected }) => {
    const h = setup();
    open(h.root, action);

    whereBoxes(h.root, action, index)[box].click();

    expect(await draftAfterSave(h)).toEqual(expected);
  });

  test("a key the browser keeps says it works only in the app window", () => {
    const { root } = setup();
    open(root, "toggle-theme");

    press(root, "toggle-theme", { key: "n", metaKey: true });

    expect([
      keysOf(root, "toggle-theme"),
      Array.from(
        row(root, "toggle-theme").querySelectorAll(".shortcut-chord-note"),
        (note) => note.textContent,
      ),
    ]).toEqual([
      ["t", "Meta+N (PWA)"],
      [
        "A browser tab keeps Meta+N for itself, so these keys work only in the installed app window (PWA).",
      ],
    ]);
  });

  test("the browser-keeps note is written once per action, naming its keys", () => {
    const { root } = setup();
    open(root, "main-tab-previous");

    expect(
      Array.from(
        row(root, "main-tab-previous").querySelectorAll(".shortcut-chord-note"),
        (note) => note.textContent,
      ),
    ).toEqual([
      "A browser tab keeps Ctrl+Shift+Tab, Meta+Shift+[, Meta+Shift+{ for itself, so these keys work only in the installed app window (PWA).",
    ]);
  });
});

describe("restore all defaults", () => {
  test.each([
    { name: "after confirming", confirm: true, expected: {} },
    {
      name: "not when cancelled",
      confirm: false,
      expected: { "toggle-theme": [{ key: "x" }] },
    },
  ])("clears every change $name", async ({ confirm, expected }) => {
    const h = setup({ "toggle-theme": [{ key: "x" }] });

    toolbarButton(h.root, "reset-all").click();
    await vi.waitFor(() =>
      expect(document.querySelector(".gdp-dialog-backdrop")).not.toBeNull(),
    );
    if (confirm) clickDialogConfirm();
    else clickDialogCancel();
    await vi.waitFor(() =>
      expect(document.querySelector(".gdp-dialog-backdrop")).toBeNull(),
    );

    expect([h.state.saves, h.settings.draft.dirty()]).toEqual([[], confirm]);
    if (confirm) await h.settings.draft.save();
    expect(h.state.saved).toEqual(expected);
  });
});

describe("JSON", () => {
  function jsonArea(root: HTMLElement): HTMLTextAreaElement {
    const area = root.querySelector<HTMLTextAreaElement>("#shortcut-json");
    if (!area) throw new Error("no JSON area");
    return area;
  }

  function issues(root: HTMLElement): string[] {
    return Array.from(
      root.querySelectorAll(".shortcut-json-issues li"),
      (item) => item.textContent ?? "",
    );
  }

  function typeJson(root: HTMLElement, text: string): void {
    const area = jsonArea(root);
    area.value = text;
    area.dispatchEvent(new Event("input"));
  }

  test("exports the changed actions as a file", () => {
    const h = setup({ "toggle-theme": [{ key: "x", ctrl: true }] });

    toolbarButton(h.root, "export").click();

    expect(h.state.downloads).toEqual([
      {
        fileName: "code-viewer-shortcuts.json",
        text: '{\n  "toggle-theme": [\n    {\n      "key": "x",\n      "ctrl": true\n    }\n  ]\n}\n',
      },
    ]);
  });

  test("editing shows the changes, and valid JSON updates the list", async () => {
    const h = setup({ "toggle-theme": [{ key: "x" }] });
    toolbarButton(h.root, "json").click();

    expect(jsonArea(h.root).value).toBe(
      '{\n  "toggle-theme": [\n    {\n      "key": "x"\n    }\n  ]\n}',
    );
    typeJson(h.root, '{ "layout-split": [{ "key": "k", "alt": true }] }');

    expect([
      keysOf(h.root, "toggle-theme"),
      keysOf(h.root, "layout-split"),
      issues(h.root),
      h.settings.draft.problem?.(),
    ]).toEqual([["t"], ["Alt+K"], [], null]);
    expect(await draftAfterSave(h)).toEqual({
      "layout-split": [{ key: "k", alt: true }],
    });
  });

  test.each([
    {
      name: "a syntax error",
      text: '{\n  "toggle-theme": [{ "key": "x" }\n}',
      expected: ["Line 3, column 1: not JSON here (found })"],
    },
    {
      name: "an unknown action and a field that is not true or false",
      text: '{\n  "no-such-action": [],\n  "toggle-theme": [{ "key": "x", "shift": "yes" }]\n}',
      expected: [
        "Line 2, column 3 (no-such-action): there is no action with this name",
        "Line 3, column 43 (toggle-theme[0].shift): must be true or false",
      ],
    },
  ])("$name is shown by line and column and nothing is saved", ({
    text,
    expected,
  }) => {
    const h = setup({ "toggle-theme": [{ key: "x" }] });
    toolbarButton(h.root, "json").click();

    typeJson(h.root, text);

    expect([
      issues(h.root),
      keysOf(h.root, "toggle-theme"),
      h.settings.draft.problem?.(),
    ]).toEqual([expected, ["x"], "Fix the shortcut JSON before saving."]);
  });

  test("imports a file into the editor, and a bad file changes nothing", async () => {
    const h = setup();
    const input = h.root.querySelector<HTMLInputElement>(
      '.shortcut-toolbar input[type="file"]',
    );
    if (!input) throw new Error("no file input");
    const load = async (content: string) => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [new File([content], "shortcuts.json")],
      });
      input.dispatchEvent(new Event("change"));
      await vi.waitFor(() => expect(jsonArea(h.root).value).toBe(content));
    };

    await load('{ "toggle-theme": [ { "key": "x", "color": 1 } ] }');
    const bad = [issues(h.root), keysOf(h.root, "toggle-theme")];
    await load('{ "toggle-theme": [ { "key": "x" } ] }');

    expect([...bad, issues(h.root), keysOf(h.root, "toggle-theme")]).toEqual([
      [
        "Line 1, column 35 (toggle-theme[0].color): unknown field (use key, ctrl, meta, alt, shift, pendingG, inputs, terminal, pwa)",
      ],
      ["t"],
      [],
      ["x"],
    ]);
  });
});

// キーの多い行で折り返しても列がそろうこと: キーの升は同じ幅の列 (auto-fit で空いた
// 列は詰める) に右寄せで入る。幅の値そのものは固定しない (変数を変えれば列の幅も
// 変わる形で見る)。
describe("the key cells of a row", () => {
  const rules = baseRules(loadStyleSheet());
  const keys = cascadedDeclarations(rules, (s) => s === ".shortcut-keys");
  const vars = new Map([
    ...cascadedDeclarations(rules, (s) => s === ":root"),
    // --space-unit (密度の段階) は html, body の規則にある。
    ...cascadedDeclarations(rules, (s) => s === "html" || s === "body"),
    ...keys,
  ]);

  test("are a grid of equal fixed-width columns, right-aligned", () => {
    const columns = keys.get("grid-template-columns") ?? "";
    const width = resolveVar(keys.get("--shortcut-key-w") ?? "", vars);

    expect([
      keys.get("display"),
      columns,
      resolveVar(columns, vars),
      keys.get("justify-content"),
      keys.get("justify-items"),
    ]).toEqual([
      "grid",
      "repeat(auto-fit, var(--shortcut-key-w))",
      `repeat(auto-fit, ${width})`,
      "end",
      "end",
    ]);
  });
});

// 表の決まり (ui-surface.md の「表」): 分類ごとに見出しの行があり、行は区切り線の行。
describe("the table look of the list", () => {
  test("each group starts with a head row naming the group and the key column", () => {
    const { root } = setup();
    const groups = Array.from(root.querySelectorAll(".shortcut-group"));
    const heads = groups.map((group) => group.firstElementChild);
    expect({
      someGroups: groups.length > 0,
      headsFirst: heads.every((head) =>
        head?.classList.contains("ui-table-head"),
      ),
      titled: heads.every(
        (head) =>
          (head?.querySelector(".shortcut-group-title")?.textContent ?? "") !==
          "",
      ),
      keyColumn: heads[0]?.querySelector(".shortcut-group-keys")?.textContent,
    }).toEqual({
      someGroups: true,
      headsFirst: true,
      titled: true,
      keyColumn: "Keys",
    });
  });

  test("every row is a table row", () => {
    const { root } = setup();
    const rows = root.querySelectorAll(".shortcut-row");
    expect(
      Array.from(rows).every((item) => item.classList.contains("ui-table-row")),
    ).toBe(true);
  });
});
