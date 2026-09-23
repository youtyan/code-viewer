// 設定の「ショートカット」で書いた JSON の検査。違う所を行・欄・場所 (path) と
// 理由の名前で全部返し、1 つでもあれば値を返さない。
import { describe, expect, test } from "vitest";
import { type KeymapJsonIssue, parseKeymapJson } from "../core/keymap-json";

describe("parseKeymapJson", () => {
  test.each([
    { name: "an empty text", text: "", value: {} },
    { name: "only spaces", text: "  \n ", value: {} },
    { name: "an empty object", text: "{}", value: {} },
    {
      name: "keys, modifiers and places",
      text: '{ "toggle-theme": [ { "key": "X", "ctrl": true, "shift": false, "pwa": false } ] }',
      value: { "toggle-theme": [{ key: "x", ctrl: true, pwa: false }] },
    },
    {
      name: "an empty list turns an action off",
      text: '{ "layout-split": [] }',
      value: { "layout-split": [] },
    },
    {
      name: "a space key",
      text: '{ "toggle-theme": [ { "key": " " } ] }',
      value: { "toggle-theme": [{ key: "space" }] },
    },
    {
      name: "escaped characters in a key",
      text: '{ "toggle-theme": [ { "key": "\\u0071" } ] }',
      value: { "toggle-theme": [{ key: "q" }] },
    },
  ])("reads $name", ({ text, value }) => {
    expect(parseKeymapJson(text, true)).toEqual({ ok: true, value });
  });

  test.each<{ name: string; text: string; issues: KeymapJsonIssue[] }>([
    {
      name: "a missing closing brace",
      text: '{\n  "toggle-theme": []',
      issues: [{ line: 2, column: 21, path: "$", code: "syntax" }],
    },
    {
      name: "a trailing comma",
      text: '{ "toggle-theme": [], }',
      issues: [{ line: 1, column: 23, path: "$", code: "syntax", detail: "}" }],
    },
    {
      name: "a bad escape in a string",
      text: '{ "toggle-theme": [ { "key": "\\x" } ] }',
      issues: [
        {
          line: 1,
          column: 30,
          path: "$",
          code: "syntax",
          detail: expect.any(String) as unknown as string,
        },
      ],
    },
    {
      name: "a list at the top",
      text: "[]",
      issues: [{ line: 1, column: 1, path: "$", code: "not-object" }],
    },
    {
      name: "an unknown action",
      text: '{\n  "toggle-thme": []\n}',
      issues: [
        { line: 2, column: 3, path: "toggle-thme", code: "unknown-action" },
      ],
    },
    {
      name: "the same action twice",
      text: '{ "layout-split": [], "layout-split": [] }',
      issues: [
        { line: 1, column: 23, path: "layout-split", code: "duplicate-action" },
      ],
    },
    {
      name: "keys that are not a list",
      text: '{ "layout-split": { "key": "s" } }',
      issues: [
        { line: 1, column: 19, path: "layout-split", code: "not-array" },
      ],
    },
    {
      name: "nine keys",
      text: `{ "layout-split": [${Array.from("abcdefghi", (k) => `{ "key": "${k}" }`).join(", ")}] }`,
      issues: [
        {
          line: 1,
          column: 19,
          path: "layout-split",
          code: "too-many-keys",
          detail: "8",
        },
      ],
    },
    {
      name: "a key that is a string",
      text: '{ "layout-split": [ "s" ] }',
      issues: [
        {
          line: 1,
          column: 21,
          path: "layout-split[0]",
          code: "chord-not-object",
        },
      ],
    },
    {
      name: "a key without its name",
      text: '{ "layout-split": [ { "ctrl": true } ] }',
      issues: [
        {
          line: 1,
          column: 21,
          path: "layout-split[0].key",
          code: "missing-key",
        },
      ],
    },
    {
      name: "an empty key name",
      text: '{ "layout-split": [ { "key": "" } ] }',
      issues: [
        { line: 1, column: 30, path: "layout-split[0].key", code: "empty-key" },
      ],
    },
    {
      name: "a 65 character key name",
      text: `{ "layout-split": [ { "key": "${"a".repeat(65)}" } ] }`,
      issues: [
        {
          line: 1,
          column: 30,
          path: "layout-split[0].key",
          code: "key-too-long",
        },
      ],
    },
    {
      name: "an unknown field and a field that is not true or false",
      text: '{ "layout-split": [ { "key": "s", "cmd": true, "alt": "yes" } ] }',
      issues: [
        {
          line: 1,
          column: 35,
          path: "layout-split[0].cmd",
          code: "unknown-field",
        },
        {
          line: 1,
          column: 55,
          path: "layout-split[0].alt",
          code: "not-boolean",
        },
      ],
    },
    {
      name: "a field written twice",
      text: '{ "layout-split": [ { "key": "s", "key": "d" } ] }',
      issues: [
        {
          line: 1,
          column: 35,
          path: "layout-split[0].key",
          code: "duplicate-field",
        },
      ],
    },
    {
      name: "the same key twice",
      text: '{ "layout-split": [ { "key": "s" }, { "key": "S" } ] }',
      issues: [
        {
          line: 1,
          column: 37,
          path: "layout-split[1]",
          code: "duplicate-chord",
        },
      ],
    },
    {
      name: "the close-window key",
      text: '{ "layout-split": [ { "key": "w", "meta": true, "shift": true } ] }',
      issues: [
        {
          line: 1,
          column: 21,
          path: "layout-split[0]",
          code: "reserved-chord",
          detail: "close-window",
        },
      ],
    },
  ])("reports $name", ({ text, issues }) => {
    expect(parseKeymapJson(text, true)).toEqual({ ok: false, issues });
  });

  test.each([
    {
      name: "Cmd+Q on a Mac",
      mac: true,
      chord: { key: "q", meta: true },
      ok: false,
    },
    {
      name: "Ctrl+Q off a Mac",
      mac: false,
      chord: { key: "q", ctrl: true },
      ok: true,
    },
    {
      name: "Ctrl+Shift+W off a Mac",
      mac: false,
      chord: { key: "w", ctrl: true, shift: true },
      ok: false,
    },
    {
      name: "Ctrl+Shift+W on a Mac",
      mac: true,
      chord: { key: "w", ctrl: true, shift: true },
      ok: true,
    },
  ])("the reserved keys follow the OS: $name", ({ mac, chord, ok }) => {
    expect(
      parseKeymapJson(JSON.stringify({ "layout-split": [chord] }), mac).ok,
    ).toBe(ok);
  });
});
