import { describe, expect, test } from "vitest";
import {
  DEFAULT_KEY_BINDINGS,
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
  test("moves focus between sidebar and main with Ctrl+H and Ctrl+L", () => {
    expect(action("h", "main", { ctrl: true })).toBe("focus-sidebar");
    expect(action("l", "sidebar", { ctrl: true })).toBe("focus-main");
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
          binding.ctrl,
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
