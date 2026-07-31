import { describe, expect, test } from "bun:test";
import { parseDocument, stringify } from "yaml";
import type { YamlApi } from "../core/yaml-loader";
import {
  formatStructured,
  parseStructuredText,
} from "../views/tools/structured-text";

// 本物の yaml を注入する。fake に差し替えると「どこまでを YAML として受理
// するか」というこのモジュールの肝心な振る舞いを検証できなくなる。
const YAML = { parseDocument, stringify } as unknown as YamlApi;

describe("structured text parsing", () => {
  test.each([
    {
      name: "reads a JSON object as JSON",
      text: '{"a": 1}',
      expectedSource: "json",
      expectedValue: { a: 1 },
    },
    {
      name: "reads a JSON array as JSON",
      text: "[1, 2]",
      expectedSource: "json",
      expectedValue: [1, 2],
    },
    {
      name: "reads a bare number as JSON",
      text: "123",
      expectedSource: "json",
      expectedValue: 123,
    },
    {
      name: "prefers JSON for input both parsers accept",
      text: "true",
      expectedSource: "json",
      expectedValue: true,
    },
    {
      name: "falls back to YAML for a mapping",
      text: "name: sample\ncount: 2\n",
      expectedSource: "yaml",
      expectedValue: { name: "sample", count: 2 },
    },
    {
      name: "falls back to YAML for a sequence",
      text: "- one\n- two\n",
      expectedSource: "yaml",
      expectedValue: ["one", "two"],
    },
    {
      name: "keeps YAML comments out of the parsed value",
      text: "# leading comment\nenabled: true\n",
      expectedSource: "yaml",
      expectedValue: { enabled: true },
    },
    {
      name: "reads tab-indented JSON that YAML would reject",
      text: '{\n\t"a": 1\n}',
      expectedSource: "json",
      expectedValue: { a: 1 },
    },
  ])("$name", ({ text, expectedSource, expectedValue }) => {
    const result = parseStructuredText(text, YAML);
    expect(result).toEqual({
      status: "ok",
      source: expectedSource,
      value: expectedValue,
    });
  });

  test.each([
    { name: "rejects an empty string", text: "" },
    { name: "rejects whitespace only", text: "   \n\t " },
    { name: "rejects an unclosed flow sequence", text: "foo: [1, 2" },
    { name: "rejects a duplicated mapping key", text: "a: 1\na: 2\n" },
    { name: "rejects broken indentation", text: "a: 1\n b: 2\n  c: 3\n" },
  ])("$name", ({ text }) => {
    expect(parseStructuredText(text, YAML).status).toBe("error");
  });

  test("reports every YAML syntax error, not just the first", () => {
    const result = parseStructuredText("a: [\nb: [\n", YAML);
    if (result.status !== "error") throw new Error("expected a parse error");
    // 1 件だけ出すと、直した先にまだ残っていることが見えない。
    expect(result.message.includes("at line 2, column 1")).toBe(true);
    expect(result.message.includes("at line 3, column 1")).toBe(true);
  });

  test("keeps YAML warnings alongside a value it could still read", () => {
    const result = parseStructuredText("%YAML 1.3\n---\na: 1\n", YAML);
    if (result.status !== "ok") throw new Error("expected a parsed value");
    expect(result.value).toEqual({ a: 1 });
    expect(result.warnings?.length).toBe(1);
    expect(result.warnings?.[0].includes("Unsupported YAML version")).toBe(
      true,
    );
  });

  test("omits warnings when the document is clean", () => {
    const result = parseStructuredText("a: 1\n", YAML);
    if (result.status !== "ok") throw new Error("expected a parsed value");
    expect(result.warnings).toBeUndefined();
  });

  test("reports where the YAML parser gave up", () => {
    const result = parseStructuredText("a: 1\n b: 2\n  c: 3\n", YAML);
    if (result.status !== "error") throw new Error("expected a parse error");
    expect(result.message.includes("at line 1, column 4")).toBe(true);
  });

  test("without a YAML parser, only JSON is accepted", () => {
    expect(parseStructuredText('{"a": 1}', null)).toEqual({
      status: "ok",
      source: "json",
      value: { a: 1 },
    });
    expect(parseStructuredText("name: sample\n", null).status).toBe("error");
  });
});

describe("structured text formatting", () => {
  test.each([
    {
      name: "indents JSON by default",
      value: { a: 1, b: [2] },
      format: "json" as const,
      minify: false,
      expected: '{\n  "a": 1,\n  "b": [\n    2\n  ]\n}',
    },
    {
      name: "collapses JSON when minified",
      value: { a: 1, b: [2] },
      format: "json" as const,
      minify: true,
      expected: '{"a":1,"b":[2]}',
    },
    {
      name: "emits YAML for a mapping",
      value: { name: "sample", enabled: true },
      format: "yaml" as const,
      minify: false,
      expected: "name: sample\nenabled: true\n",
    },
    {
      name: "ignores minify for YAML output",
      value: { name: "sample", enabled: true },
      format: "yaml" as const,
      minify: true,
      expected: "name: sample\nenabled: true\n",
    },
    {
      name: "emits an empty string for undefined JSON input",
      value: undefined,
      format: "json" as const,
      minify: false,
      expected: "",
    },
  ])("$name", ({ value, format, minify, expected }) => {
    expect(formatStructured(value, format, minify, YAML)).toBe(expected);
  });

  test("returns null when YAML output is requested without a parser", () => {
    expect(formatStructured({ a: 1 }, "yaml", false, null)).toBeNull();
    expect(formatStructured({ a: 1 }, "json", false, null)).toBe(
      '{\n  "a": 1\n}',
    );
  });
});
