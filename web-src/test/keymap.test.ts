import { describe, expect, test } from "vitest";
import {
  chordUsers,
  chordWhere,
  DEFAULT_KEY_BINDINGS,
  defaultKeyBindings,
  findKeymapConflicts,
  type KeyBinding,
  type KeyChord,
  type KeymapAction,
  type KeymapConflict,
  type KeymapOverrides,
  type KeymapScope,
  resolveKeyBindings,
  resolveKeymapAction,
  sanitizeKeymapOverrides,
  withChordWhere,
} from "../core/keymap";

function key(
  key: string,
  options: {
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
    alt?: boolean;
  } = {},
) {
  return {
    key,
    ctrlKey: !!options.ctrl,
    metaKey: !!options.meta,
    shiftKey: !!options.shift,
    altKey: !!options.alt,
  };
}

function action(
  keyValue: string,
  scope: KeymapScope,
  options: Parameters<typeof key>[1] = {},
) {
  return resolveKeymapAction(key(keyValue, options), {
    scope,
    editable: false,
  });
}

describe("keymap action resolution", () => {
  test.each([
    ["Cmd+W", "w", { meta: true }],
    ["Cmd+T", "t", { meta: true }],
    ["Cmd+L", "l", { meta: true }],
    ["Cmd+N", "n", { meta: true }],
    ["Ctrl+H", "h", { ctrl: true }],
    ["Ctrl+L", "l", { ctrl: true }],
    ["Ctrl+W", "w", { ctrl: true }],
    ["Ctrl+T", "t", { ctrl: true }],
    ["Ctrl+N", "n", { ctrl: true }],
    ["Ctrl+Tab", "Tab", { ctrl: true }],
    ["Ctrl+Shift+Tab", "Tab", { ctrl: true, shift: true }],
    ["terminal interrupt Ctrl+C", "c", { ctrl: true }],
  ] as const)("does not claim reserved key %s", (_name, keyValue, options) => {
    for (const scope of [
      "global",
      "sidebar",
      "main",
      "panel",
      "history",
    ] as const)
      expect(action(keyValue, scope, options)).toBeNull();
  });

  test.each([
    ["plain page key", "j", {}],
    ["editable-allowed palette key", "k", { ctrl: true }],
    ["panel menu key", "`", { ctrl: true }],
    ["terminal interrupt", "c", { ctrl: true }],
  ] as const)("blocks %s on a protected surface", (_name, keyValue, options) => {
    expect(
      resolveKeymapAction(key(keyValue, options), {
        scope: "panel",
        editable: true,
        pageKeymapBlocked: true,
      }),
    ).toBeNull();
  });

  test("moves focus between sidebar and main with Shift+H and Shift+L", () => {
    expect(action("H", "main", { shift: true })).toBe("focus-sidebar");
    expect(action("L", "sidebar", { shift: true })).toBe("focus-main");
  });

  test("steps annotations with bracket keys in every scope", () => {
    expect(action("]", "main")).toBe("annotation-next");
    expect(action("[", "main")).toBe("annotation-previous");
    expect(action("]", "sidebar")).toBe("annotation-next");
    expect(action("[", "global")).toBe("annotation-previous");
  });

  test("keeps Ctrl+K as file palette in every scope", () => {
    expect(action("k", "sidebar", { ctrl: true })).toBe("open-file-palette");
    expect(action("k", "global", { ctrl: true })).toBe("open-file-palette");
    expect(action("k", "main", { ctrl: true })).toBe("open-file-palette");
  });

  test("scrolls the main panel with vim-style keys only in main scope", () => {
    expect(action("j", "main")).toBe("scroll-main-down");
    expect(action("k", "main")).toBe("scroll-main-up");
    expect(action("d", "main", { ctrl: true })).toBe("scroll-main-page-down");
    expect(action("u", "main", { ctrl: true })).toBe("scroll-main-page-up");
    expect(action("j", "sidebar")).toBe("sidebar-next");
    expect(action("k", "sidebar")).toBe("sidebar-previous");
    expect(action("d", "sidebar", { ctrl: true })).toBe("sidebar-page-down");
    expect(action("u", "sidebar", { ctrl: true })).toBe("sidebar-page-up");
  });

  test.each([
    {
      name: "ArrowDown in global",
      keyValue: "arrowdown",
      scope: "global" as const,
      expected: "history-next-commit",
    },
    {
      name: "ArrowUp in main",
      keyValue: "arrowup",
      scope: "main" as const,
      expected: "history-previous-commit",
    },
    {
      name: "ArrowDown in sidebar",
      keyValue: "arrowdown",
      scope: "sidebar" as const,
      expected: "history-next-commit",
    },
    {
      name: "j in history scope",
      keyValue: "j",
      scope: "history" as const,
      expected: "history-next-commit",
    },
    {
      name: "k in history scope",
      keyValue: "k",
      scope: "history" as const,
      expected: "history-previous-commit",
    },
    {
      name: "j in global stays sidebar",
      keyValue: "j",
      scope: "global" as const,
      expected: "sidebar-next",
    },
    {
      name: "j in main stays scroll",
      keyValue: "j",
      scope: "main" as const,
      expected: "scroll-main-down",
    },
  ])("steps commits: $name", ({ keyValue, scope, expected }) => {
    expect(action(keyValue, scope)).toBe(expected);
  });

  test("commit stepping keys stay out of editable fields", () => {
    expect(
      resolveKeymapAction(key("arrowdown"), {
        scope: "global",
        editable: true,
      }),
    ).toBeNull();
    expect(
      resolveKeymapAction(key("j"), { scope: "history", editable: true }),
    ).toBeNull();
  });

  test("scrolls the main panel with paging keys in main scope", () => {
    expect(action("PageDown", "main")).toBe("scroll-main-page-down");
    expect(action("PageUp", "main")).toBe("scroll-main-page-up");
    expect(action("PageDown", "global")).toBe("scroll-main-page-down");
    expect(action("PageUp", "global")).toBe("scroll-main-page-up");
    expect(action("PageDown", "sidebar")).toBe("scroll-main-page-down");
    expect(action("PageUp", "sidebar")).toBe("scroll-main-page-up");
    expect(action("ArrowDown", "main", { ctrl: true })).toBe(
      "scroll-main-page-down",
    );
    expect(action("ArrowUp", "main", { ctrl: true })).toBe(
      "scroll-main-page-up",
    );
    expect(action("ArrowDown", "global", { ctrl: true })).toBe(
      "scroll-main-page-down",
    );
    expect(action("ArrowUp", "global", { ctrl: true })).toBe(
      "scroll-main-page-up",
    );
    expect(action("ArrowDown", "sidebar", { ctrl: true })).toBe(
      "scroll-main-page-down",
    );
    expect(action("ArrowUp", "sidebar", { ctrl: true })).toBe(
      "scroll-main-page-up",
    );
  });

  test("does not handle vim navigation inside editable fields", () => {
    expect(
      resolveKeymapAction(key("j"), { scope: "main", editable: true }),
    ).toBe(null);
    expect(
      resolveKeymapAction(key("k", { ctrl: true }), {
        scope: "main",
        editable: true,
      }),
    ).toBe("open-file-palette");
    expect(
      resolveKeymapAction(key("g", { ctrl: true }), {
        scope: "main",
        editable: true,
      }),
    ).toBe("open-grep-palette");
  });

  test("suppresses vim navigation while composing text or using the palette", () => {
    expect(
      resolveKeymapAction(key("j"), {
        scope: "main",
        editable: false,
        composing: true,
      }),
    ).toBe(null);
    expect(
      resolveKeymapAction(key("j"), {
        scope: "main",
        editable: false,
        paletteOpen: true,
      }),
    ).toBe(null);
    expect(
      resolveKeymapAction(key("g", { ctrl: true }), {
        scope: "main",
        editable: true,
        paletteOpen: true,
      }),
    ).toBe("open-grep-palette");
  });

  test("opens help with Shift+? in every scope, blocked while editable", () => {
    expect(action("?", "main", { shift: true })).toBe("open-help");
    expect(action("?", "sidebar", { shift: true })).toBe("open-help");
    expect(action("?", "global", { shift: true })).toBe("open-help");
    expect(
      resolveKeymapAction(key("?", { shift: true }), {
        scope: "main",
        editable: true,
      }),
    ).toBe(null);
  });

  test("keeps default bindings as data for future customization", () => {
    expect(
      DEFAULT_KEY_BINDINGS.some(
        (binding) =>
          binding.action === "focus-main" &&
          binding.key === "l" &&
          binding.shift,
      ),
    ).toBe(true);
    expect(
      DEFAULT_KEY_BINDINGS.some(
        (binding) =>
          binding.action === "scroll-main-page-up" &&
          binding.key === "u" &&
          binding.scope === "main" &&
          binding.ctrl,
      ),
    ).toBe(true);
    expect(
      DEFAULT_KEY_BINDINGS.some(
        (binding) =>
          binding.action === "cancel-source-load" &&
          binding.requires?.lightboxClosed,
      ),
    ).toBe(true);
  });

  test("supports Vim top and bottom navigation with gg and Shift+G", () => {
    expect(
      resolveKeymapAction(key("g"), { scope: "main", editable: false }),
    ).toBe("start-g-sequence");
    // 画面の行き先も g から始めるので、global でも g を受ける。
    expect(
      resolveKeymapAction(key("g"), { scope: "global", editable: false }),
    ).toBe("start-g-sequence");
    expect(
      resolveKeymapAction(key("g"), {
        scope: "main",
        editable: false,
        pendingG: true,
      }),
    ).toBe("goto-top");
    expect(
      resolveKeymapAction(key("G", { shift: true }), {
        scope: "main",
        editable: false,
      }),
    ).toBe("goto-bottom");
    expect(
      resolveKeymapAction(key("G", { shift: true }), {
        scope: "main",
        editable: false,
        pendingG: true,
      }),
    ).toBe("goto-bottom");
    expect(
      resolveKeymapAction(key("."), {
        scope: "main",
        editable: false,
        pendingG: true,
      }),
    ).toBe("goto-definition");
  });

  test("does not capture Escape for source load cancellation while a lightbox is open", () => {
    expect(
      resolveKeymapAction(key("Escape"), { scope: "main", editable: false }),
    ).toBe("cancel-source-load");
    expect(
      resolveKeymapAction(key("Escape"), {
        scope: "main",
        editable: false,
        lightboxOpen: true,
      }),
    ).toBe(null);
  });

  test("copies AI context with y, and with code via Shift+Y, in every scope", () => {
    expect(action("y", "main")).toBe("copy-ai-context");
    expect(action("y", "sidebar")).toBe("copy-ai-context");
    expect(action("y", "global")).toBe("copy-ai-context");
    expect(action("y", "main", { shift: true })).toBe(
      "copy-ai-context-with-code",
    );
    expect(action("y", "sidebar", { shift: true })).toBe(
      "copy-ai-context-with-code",
    );
    expect(action("y", "global", { shift: true })).toBe(
      "copy-ai-context-with-code",
    );
  });

  test("blocks the copy-AI-context shortcut while editable, composing, or the palette is open", () => {
    expect(
      resolveKeymapAction(key("y"), { scope: "main", editable: true }),
    ).toBe(null);
    expect(
      resolveKeymapAction(key("y", { shift: true }), {
        scope: "main",
        editable: true,
      }),
    ).toBe(null);
    expect(
      resolveKeymapAction(key("y"), {
        scope: "main",
        editable: false,
        composing: true,
      }),
    ).toBe(null);
    expect(
      resolveKeymapAction(key("y"), {
        scope: "main",
        editable: false,
        paletteOpen: true,
      }),
    ).toBe(null);
  });

  test("switches source tabs with gp and gc in the main scope", () => {
    expect(
      resolveKeymapAction(key("p"), {
        scope: "main",
        editable: false,
        pendingG: true,
      }),
    ).toBe("tab-preview");
    expect(
      resolveKeymapAction(key("c"), {
        scope: "main",
        editable: false,
        pendingG: true,
      }),
    ).toBe("tab-code");
    expect(
      resolveKeymapAction(key("p"), {
        scope: "sidebar",
        editable: false,
        pendingG: true,
      }),
    ).toBe(null);
    expect(
      resolveKeymapAction(key("c"), {
        scope: "sidebar",
        editable: false,
        pendingG: true,
      }),
    ).toBe(null);
  });

  test("jumps to the next unviewed file with n in every scope, blocked while editable or the palette is open", () => {
    expect(action("n", "main")).toBe("next-unviewed-file");
    expect(action("n", "sidebar")).toBe("next-unviewed-file");
    expect(action("n", "global")).toBe("next-unviewed-file");
    expect(
      resolveKeymapAction(key("n"), { scope: "main", editable: true }),
    ).toBe(null);
    expect(
      resolveKeymapAction(key("n"), {
        scope: "main",
        editable: false,
        paletteOpen: true,
      }),
    ).toBe(null);
    expect(
      resolveKeymapAction(key("n"), {
        scope: "main",
        editable: false,
        composing: true,
      }),
    ).toBe(null);
  });
});

type ExpansionCase = {
  name: string;
  action: KeymapAction;
  chords: KeyChord[];
  expected: KeyBinding[];
};

describe("resolveKeyBindings", () => {
  test("hands back the defaults when nothing was overridden", () => {
    expect(resolveKeyBindings(undefined)).toBe(DEFAULT_KEY_BINDINGS);
  });

  test.each<ExpansionCase>([
    {
      name: "an action bound in two scopes gets the new key in both",
      action: "sidebar-next",
      chords: [{ key: "e" }],
      expected: [
        { action: "sidebar-next", key: "e", scope: "sidebar" },
        { action: "sidebar-next", key: "e", scope: "global" },
      ],
    },
    {
      name: "an action bound in three scopes gets the new key in all three",
      action: "scroll-main-page-down",
      chords: [{ key: "e" }],
      expected: [
        { action: "scroll-main-page-down", key: "e", scope: "main" },
        { action: "scroll-main-page-down", key: "e", scope: "global" },
        { action: "scroll-main-page-down", key: "e", scope: "sidebar" },
      ],
    },
    {
      name: "Ctrl and Meta rows share one condition, so one chord yields one row",
      action: "open-file-palette",
      chords: [{ key: "e", alt: true }],
      expected: [
        {
          action: "open-file-palette",
          key: "e",
          alt: true,
          allowEditable: true,
          allowPaletteOpen: true,
        },
      ],
    },
    {
      name: "two chords on a single-condition action yield two rows",
      action: "open-file-palette",
      chords: [
        { key: "e", ctrl: true },
        { key: "e", meta: true },
      ],
      expected: [
        {
          action: "open-file-palette",
          key: "e",
          ctrl: true,
          allowEditable: true,
          allowPaletteOpen: true,
        },
        {
          action: "open-file-palette",
          key: "e",
          meta: true,
          allowEditable: true,
          allowPaletteOpen: true,
        },
      ],
    },
    {
      name: "the lightbox guard is carried over from the default row",
      action: "cancel-source-load",
      chords: [{ key: "q" }],
      expected: [
        {
          action: "cancel-source-load",
          key: "q",
          requires: { lightboxClosed: true },
        },
      ],
    },
    {
      name: "the g prefix comes from the chord, not from the default row",
      action: "tab-preview",
      chords: [{ key: "e" }],
      expected: [{ action: "tab-preview", key: "e", scope: "main" }],
    },
    {
      name: "a chord can add the g prefix back",
      action: "tab-preview",
      chords: [{ key: "e", pendingG: true }],
      expected: [
        { action: "tab-preview", key: "e", scope: "main", pendingG: true },
      ],
    },
    {
      name: "keys are lowercased so they match event.key",
      action: "toggle-theme",
      chords: [{ key: "E" }],
      expected: [{ action: "toggle-theme", key: "e" }],
    },
    {
      name: "an empty list disables the action entirely",
      action: "toggle-theme",
      chords: [],
      expected: [],
    },
  ])("$name", ({ action, chords, expected }) => {
    const bindings = resolveKeyBindings({ [action]: chords });

    expect(bindings.filter((binding) => binding.action === action)).toEqual(
      expected,
    );
  });

  test("leaves every other action exactly where it was", () => {
    const bindings = resolveKeyBindings({ "toggle-theme": [{ key: "x" }] });

    expect(
      bindings.filter((binding) => binding.action !== "toggle-theme"),
    ).toEqual(
      DEFAULT_KEY_BINDINGS.filter(
        (binding) => binding.action !== "toggle-theme",
      ),
    );
  });

  test("keeps the overridden action at its original position", () => {
    const bindings = resolveKeyBindings({
      "focus-file-filter": [{ key: "x" }],
    });
    const actions = bindings.map((binding) => binding.action);

    expect(actions.indexOf("focus-file-filter")).toBe(
      DEFAULT_KEY_BINDINGS.map((binding) => binding.action).indexOf(
        "focus-file-filter",
      ),
    );
  });

  test("resolves a custom chord through resolveKeymapAction", () => {
    const bindings = resolveKeyBindings({ "toggle-theme": [{ key: "x" }] });

    expect(
      resolveKeymapAction(
        key("x"),
        { scope: "main", editable: false },
        bindings,
      ),
    ).toBe("toggle-theme");
    expect(
      resolveKeymapAction(
        key("t"),
        { scope: "main", editable: false },
        bindings,
      ),
    ).toBe(null);
  });

  test("a disabled action stops resolving", () => {
    const bindings = resolveKeyBindings({ "toggle-theme": [] });

    expect(
      resolveKeymapAction(
        key("t"),
        { scope: "main", editable: false },
        bindings,
      ),
    ).toBe(null);
  });
});

type ConflictCase = {
  name: string;
  bindings: KeyBinding[];
  expected: KeymapConflict[];
};

describe("findKeymapConflicts", () => {
  test("finds nothing wrong with the shipped defaults", () => {
    expect(findKeymapConflicts()).toEqual([]);
  });

  test.each<ConflictCase>([
    {
      name: "two actions on the same chord in the same scope collide",
      bindings: [
        { action: "toggle-theme", key: "x", scope: "main" },
        { action: "layout-split", key: "x", scope: "main" },
      ],
      expected: [
        {
          scope: "main",
          chord: { key: "x" },
          actions: ["toggle-theme", "layout-split"],
        },
      ],
    },
    {
      name: "a scoped binding collides with an unscoped one in that scope only",
      bindings: [
        { action: "toggle-theme", key: "x" },
        { action: "layout-split", key: "x", scope: "main" },
      ],
      expected: [
        {
          scope: "main",
          chord: { key: "x" },
          actions: ["toggle-theme", "layout-split"],
        },
      ],
    },
    {
      name: "two unscoped bindings collide in every scope",
      bindings: [
        { action: "toggle-theme", key: "x" },
        { action: "layout-split", key: "x" },
      ],
      expected: [
        {
          scope: "global",
          chord: { key: "x" },
          actions: ["toggle-theme", "layout-split"],
        },
        {
          scope: "sidebar",
          chord: { key: "x" },
          actions: ["toggle-theme", "layout-split"],
        },
        {
          scope: "main",
          chord: { key: "x" },
          actions: ["toggle-theme", "layout-split"],
        },
        {
          scope: "panel",
          chord: { key: "x" },
          actions: ["toggle-theme", "layout-split"],
        },
        {
          scope: "history",
          chord: { key: "x" },
          actions: ["toggle-theme", "layout-split"],
        },
      ],
    },
    {
      name: "different scopes never collide",
      bindings: [
        { action: "toggle-theme", key: "x", scope: "main" },
        { action: "layout-split", key: "x", scope: "sidebar" },
      ],
      expected: [],
    },
    {
      name: "a differing modifier is a different chord",
      bindings: [
        { action: "toggle-theme", key: "x", scope: "main" },
        { action: "layout-split", key: "x", scope: "main", ctrl: true },
      ],
      expected: [],
    },
    {
      name: "a differing g prefix is a different chord",
      bindings: [
        { action: "toggle-theme", key: "x", scope: "main" },
        { action: "layout-split", key: "x", scope: "main", pendingG: true },
      ],
      expected: [],
    },
    {
      name: "the same action listed twice is not a conflict",
      bindings: [
        { action: "toggle-theme", key: "x", scope: "main" },
        { action: "toggle-theme", key: "x", scope: "main" },
      ],
      expected: [],
    },
    {
      name: "differing guards still count as a conflict",
      bindings: [
        { action: "toggle-theme", key: "x", scope: "main" },
        {
          action: "layout-split",
          key: "x",
          scope: "main",
          allowEditable: true,
        },
      ],
      expected: [
        {
          scope: "main",
          chord: { key: "x" },
          actions: ["toggle-theme", "layout-split"],
        },
      ],
    },
  ])("$name", ({ bindings, expected }) => {
    expect(findKeymapConflicts(bindings)).toEqual(expected);
  });
});

type SanitizeCase = {
  name: string;
  raw: unknown;
  expected: KeymapOverrides;
};

describe("sanitizeKeymapOverrides", () => {
  test.each<SanitizeCase>([
    { name: "null becomes an empty set", raw: null, expected: {} },
    {
      name: "a string becomes an empty set",
      raw: "toggle-theme",
      expected: {},
    },
    {
      name: "an array becomes an empty set",
      raw: [{ key: "x" }],
      expected: {},
    },
    {
      name: "an unknown action is dropped",
      raw: { "not-an-action": [{ key: "x" }] },
      expected: {},
    },
    {
      name: "a non-array value is dropped",
      raw: { "toggle-theme": { key: "x" } },
      expected: {},
    },
    {
      name: "an empty list survives because it means disabled",
      raw: { "toggle-theme": [] },
      expected: { "toggle-theme": [] },
    },
    {
      name: "keys are lowercased and trimmed",
      raw: { "toggle-theme": [{ key: "  X  " }] },
      expected: { "toggle-theme": [{ key: "x" }] },
    },
    {
      name: "modifiers are kept only when they are exactly true",
      raw: {
        "toggle-theme": [
          { key: "x", ctrl: true, meta: "yes", alt: 1, shift: null },
        ],
      },
      expected: { "toggle-theme": [{ key: "x", ctrl: true }] },
    },
    {
      name: "the g prefix survives",
      raw: { "toggle-theme": [{ key: "x", pendingG: true }] },
      expected: { "toggle-theme": [{ key: "x", pendingG: true }] },
    },
    {
      name: "a missing key drops that chord but keeps the others",
      raw: { "toggle-theme": [{ ctrl: true }, { key: "x" }] },
      expected: { "toggle-theme": [{ key: "x" }] },
    },
    {
      name: "an empty key drops that chord",
      raw: { "toggle-theme": [{ key: "   " }] },
      expected: { "toggle-theme": [] },
    },
    {
      name: "a 64 character key is accepted",
      raw: { "toggle-theme": [{ key: "a".repeat(64) }] },
      expected: { "toggle-theme": [{ key: "a".repeat(64) }] },
    },
    {
      name: "a 65 character key is rejected",
      raw: { "toggle-theme": [{ key: "a".repeat(65) }] },
      expected: { "toggle-theme": [] },
    },
    {
      name: "eight chords are kept",
      raw: {
        "toggle-theme": ["a", "b", "c", "d", "e", "f", "g", "h"].map((key) => ({
          key,
        })),
      },
      expected: {
        "toggle-theme": ["a", "b", "c", "d", "e", "f", "g", "h"].map((key) => ({
          key,
        })),
      },
    },
    {
      name: "a ninth chord is cut",
      raw: {
        "toggle-theme": ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map(
          (key) => ({ key }),
        ),
      },
      expected: {
        "toggle-theme": ["a", "b", "c", "d", "e", "f", "g", "h"].map((key) => ({
          key,
        })),
      },
    },
  ])("$name", ({ raw, expected }) => {
    expect(sanitizeKeymapOverrides(raw)).toEqual(expected);
  });

  test("survives a round trip through JSON", () => {
    const overrides: KeymapOverrides = {
      "toggle-theme": [{ key: "x", ctrl: true }],
      "layout-split": [],
    };

    expect(
      sanitizeKeymapOverrides(JSON.parse(JSON.stringify(overrides))),
    ).toEqual(overrides);
  });
});

describe("where a key works (inputs, terminals, the installed window)", () => {
  const MAC = defaultKeyBindings(true);
  const OTHER = defaultKeyBindings(false);

  test.each([
    { name: "on a Mac", bindings: MAC },
    { name: "off a Mac", bindings: OTHER },
  ])("the defaults with the window keys have no clashes $name", ({
    bindings,
  }) => {
    expect(findKeymapConflicts(bindings)).toEqual([]);
  });

  // [名前, キー, 修飾, 場所, 窓, 期待]。場所: page (入力欄の外) / input / terminal。
  test.each<
    [
      string,
      string,
      Parameters<typeof key>[1],
      "page" | "input" | "terminal",
      boolean,
      KeymapAction | null,
    ]
  >([
    [
      "Cmd+K in a terminal (Meta, allowed in inputs)",
      "k",
      { meta: true },
      "terminal",
      false,
      "open-file-palette",
    ],
    [
      "Ctrl+K in a terminal stays in the terminal",
      "k",
      { ctrl: true },
      "terminal",
      false,
      null,
    ],
    [
      "Cmd+Z in a terminal (Meta, not allowed in inputs)",
      "z",
      { meta: true },
      "terminal",
      false,
      null,
    ],
    [
      "Ctrl+K in a text field",
      "k",
      { ctrl: true },
      "input",
      false,
      "open-file-palette",
    ],
    ["plain t in a text field", "t", {}, "input", false, null],
    [
      "Cmd+Left in a browser tab",
      "ArrowLeft",
      { meta: true },
      "page",
      false,
      null,
    ],
    [
      "Cmd+Left in the installed window",
      "ArrowLeft",
      { meta: true },
      "page",
      true,
      "main-tab-previous",
    ],
    [
      "Cmd+Left in a text field of the installed window",
      "ArrowLeft",
      { meta: true },
      "input",
      true,
      null,
    ],
    [
      "Cmd+Left in a terminal of the installed window",
      "ArrowLeft",
      { meta: true },
      "terminal",
      true,
      "main-tab-previous",
    ],
    [
      "Cmd+W in a text field of the installed window",
      "w",
      { meta: true },
      "input",
      true,
      "main-tab-close",
    ],
    ["Cmd+W in a browser tab", "w", { meta: true }, "page", false, null],
  ])("%s", (_name, value, modifiers, target, standalone, expected) => {
    expect(
      resolveKeymapAction(
        key(value, modifiers),
        {
          scope: "global",
          editable: target !== "page",
          terminal: target === "terminal",
          standalone,
        },
        MAC,
      ),
    ).toBe(expected);
  });

  test("a space is named space in both the binding and the event", () => {
    const bindings = resolveKeyBindings({ "toggle-theme": [{ key: " " }] });

    expect(
      resolveKeymapAction(
        key(" "),
        { scope: "main", editable: false },
        bindings,
      ),
    ).toBe("toggle-theme");
  });

  test.each<{
    name: string;
    action: KeymapAction;
    chord: KeyChord;
    expected: { inputs: boolean; terminal: boolean; pwa: boolean };
  }>([
    {
      name: "a plain default key",
      action: "toggle-theme",
      chord: { key: "t" },
      expected: { inputs: false, terminal: false, pwa: false },
    },
    {
      name: "Cmd+K (Meta and inputs mean terminals too)",
      action: "open-file-palette",
      chord: { key: "k", meta: true },
      expected: { inputs: true, terminal: true, pwa: false },
    },
    {
      name: "Ctrl+K",
      action: "open-file-palette",
      chord: { key: "k", ctrl: true },
      expected: { inputs: true, terminal: false, pwa: false },
    },
    {
      name: "Cmd+Left",
      action: "main-tab-previous",
      chord: { key: "arrowleft", meta: true },
      expected: { inputs: false, terminal: true, pwa: true },
    },
    {
      name: "a new key takes the action's conditions",
      action: "open-file-palette",
      chord: { key: "p", meta: true },
      expected: { inputs: true, terminal: true, pwa: false },
    },
    {
      name: "a written flag wins",
      action: "toggle-theme",
      chord: { key: "t", pwa: true, terminal: true },
      expected: { inputs: false, terminal: true, pwa: true },
    },
    {
      name: "turning inputs off keeps the terminal as it was",
      action: "open-file-palette",
      chord: { key: "k", meta: true, inputs: false },
      expected: { inputs: false, terminal: true, pwa: false },
    },
  ])("chordWhere: $name", ({ action, chord, expected }) => {
    expect(chordWhere(action, chord, MAC)).toEqual(expected);
  });

  test.each<{
    name: string;
    action: KeymapAction;
    chord: KeyChord;
    where: { inputs: boolean; terminal: boolean; pwa: boolean };
    expected: KeyChord;
  }>([
    {
      name: "the default place writes nothing",
      action: "toggle-theme",
      chord: { key: "t" },
      where: { inputs: false, terminal: false, pwa: false },
      expected: { key: "t" },
    },
    {
      name: "only the changed place is written",
      action: "main-tab-previous",
      chord: { key: "arrowleft", meta: true },
      where: { inputs: false, terminal: true, pwa: false },
      expected: { key: "arrowleft", meta: true, pwa: false },
    },
    {
      name: "old flags that match the default are dropped",
      action: "toggle-theme",
      chord: { key: "t", inputs: true },
      where: { inputs: false, terminal: false, pwa: false },
      expected: { key: "t" },
    },
    {
      name: "every place changed",
      action: "toggle-theme",
      chord: { key: "t" },
      where: { inputs: true, terminal: true, pwa: true },
      expected: { key: "t", inputs: true, terminal: true, pwa: true },
    },
  ])("withChordWhere: $name", ({ action, chord, where, expected }) => {
    expect(withChordWhere(action, chord, where, MAC)).toEqual(expected);
  });

  test("an override keeps the default rows of the keys it keeps", () => {
    const bindings = resolveKeyBindings(
      {
        "main-tab-close": [
          { key: "x", pendingG: true },
          { key: "w", meta: true },
          { key: "q" },
        ],
      },
      MAC,
    );

    expect(
      bindings.filter((binding) => binding.action === "main-tab-close"),
    ).toEqual([
      { action: "main-tab-close", key: "x", pendingG: true },
      {
        action: "main-tab-close",
        key: "w",
        meta: true,
        allowEditable: true,
        pwa: true,
        terminal: true,
      },
      { action: "main-tab-close", key: "q" },
    ]);
  });

  test("an action with no default key gets its keys after the defaults", () => {
    const bindings = resolveKeyBindings({ "new-agent": [{ key: "f8" }] }, MAC);

    expect([
      bindings[bindings.length - 1],
      resolveKeymapAction(
        key("F8"),
        { scope: "sidebar", editable: false },
        bindings,
      ),
    ]).toEqual([{ action: "new-agent", key: "f8" }, "new-agent"]);
  });

  test.each<{
    name: string;
    action: KeymapAction;
    chord: KeyChord;
    expected: KeymapAction[];
  }>([
    {
      name: "a free key",
      action: "toggle-theme",
      chord: { key: "f8" },
      expected: [],
    },
    {
      name: "a key of an unscoped action",
      action: "toggle-theme",
      chord: { key: "s" },
      expected: ["layout-split"],
    },
    {
      name: "a key used in several scopes",
      action: "toggle-theme",
      chord: { key: "j" },
      expected: ["sidebar-next", "scroll-main-down", "history-next-commit"],
    },
    {
      name: "the action's own key",
      action: "toggle-theme",
      chord: { key: "t" },
      expected: [],
    },
    {
      name: "a window key",
      action: "toggle-theme",
      chord: { key: "w", meta: true },
      expected: ["main-tab-close"],
    },
    {
      name: "a different g prefix",
      action: "toggle-theme",
      chord: { key: "s", pendingG: true },
      expected: [],
    },
  ])("chordUsers: $name", ({ action, chord, expected }) => {
    expect(chordUsers(action, chord, MAC, MAC)).toEqual(expected);
  });

  test.each<{ name: string; raw: unknown; expected: KeymapOverrides }>([
    {
      name: "where flags keep true and false",
      raw: {
        "toggle-theme": [
          { key: "t", inputs: false, terminal: true, pwa: false },
        ],
      },
      expected: {
        "toggle-theme": [
          { key: "t", inputs: false, terminal: true, pwa: false },
        ],
      },
    },
    {
      name: "where flags that are not booleans are dropped",
      raw: { "toggle-theme": [{ key: "t", inputs: "yes", pwa: 1 }] },
      expected: { "toggle-theme": [{ key: "t" }] },
    },
    {
      name: "the new actions are kept",
      raw: { "new-agent": [{ key: "f8" }], "main-tab-reopen": [] },
      expected: { "new-agent": [{ key: "f8" }], "main-tab-reopen": [] },
    },
  ])("sanitizeKeymapOverrides: $name", ({ raw, expected }) => {
    expect(sanitizeKeymapOverrides(raw)).toEqual(expected);
  });
});

// 左の一覧の並びで前・次のプロジェクトへ (⌘⇧↑↓、Windows / Linux は Ctrl+Shift)。
// 設定の画面から変えられるよう、キーの定義の 1 つの操作として持つ。
describe("switching projects with the arrow keys", () => {
  test.each([
    ["⌘⇧↑", "ArrowUp", { meta: true, shift: true }, "project-previous"],
    ["⌘⇧↓", "ArrowDown", { meta: true, shift: true }, "project-next"],
    [
      "Ctrl+Shift+↑",
      "ArrowUp",
      { ctrl: true, shift: true },
      "project-previous",
    ],
    ["Ctrl+Shift+↓", "ArrowDown", { ctrl: true, shift: true }, "project-next"],
    [
      "Ctrl+↓ は今までどおり 1 画面下へ",
      "ArrowDown",
      { ctrl: true },
      "scroll-main-page-down",
    ],
    ["⌘↓ は取らない", "ArrowDown", { meta: true }, null],
  ] as const)("%s", (_name, keyValue, options, expected) => {
    expect(
      (["global", "sidebar", "main"] as const).map((scope) =>
        action(keyValue, scope, options),
      ),
    ).toEqual([expected, expected, expected]);
  });

  test("入力欄の中では効かない (行の先頭・末尾まで選ぶ働きのまま)", () => {
    expect(
      resolveKeymapAction(key("ArrowUp", { meta: true, shift: true }), {
        scope: "global",
        editable: true,
      }),
    ).toBeNull();
  });

  test("ほかの操作とぶつからない", () => {
    expect(
      findKeymapConflicts().filter((conflict) =>
        conflict.actions.some((item) => item.startsWith("project-")),
      ),
    ).toEqual([]);
  });
});
