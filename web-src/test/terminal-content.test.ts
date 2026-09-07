import { describe, expect, test } from "vitest";
import {
  findTerminalLinks,
  readTerminalLogicalLine,
  searchTerminalBuffer,
} from "../core/terminal-content";
import type { XtermBuffer } from "../core/xterm-loader";

function bufferOf(
  rows: Array<{ text: string; wrapped?: boolean }>,
  cols = 80,
): XtermBuffer {
  return {
    length: rows.length,
    viewportY: 0,
    baseY: 0,
    cursorY: 0,
    getLine(row) {
      const value = rows[row];
      if (!value) return undefined;
      const cells: Array<{ text: string; width: number }> = [];
      for (const char of Array.from(value.text)) {
        const width = char === "日" || char === "本" || char === "😀" ? 2 : 1;
        cells.push({ text: char, width });
        if (width === 2) cells.push({ text: "", width: 0 });
      }
      return {
        isWrapped: value.wrapped ?? false,
        translateToString: (trim) =>
          trim
            ? value.text.trimEnd()
            : value.text.padEnd(value.text.length + cols - cells.length),
        getCell(x) {
          const cell = cells[x] ?? { text: "", width: 1 };
          return { getChars: () => cell.text, getWidth: () => cell.width };
        },
      };
    },
  };
}

describe("terminal links", () => {
  test.each([
    {
      name: "absolute file and line/column",
      text: "at /repo/sample.ts:12:3",
      value: "/repo/sample.ts",
      line: 12,
      kind: "path",
      span: "/repo/sample.ts:12:3",
    },
    {
      name: "absolute directory",
      text: "cwd /repo/sample/",
      value: "/repo/sample/",
      line: undefined,
      kind: "path",
      span: "/repo/sample/",
    },
    {
      name: "quoted spaces",
      text: 'saved "/repo/sample folder/file.txt"',
      value: "/repo/sample folder/file.txt",
      line: undefined,
      kind: "path",
      span: "/repo/sample folder/file.txt",
    },
    {
      name: "quoted file then line",
      text: '"/repo/sample folder/file.txt":42',
      value: "/repo/sample folder/file.txt",
      line: 42,
      kind: "path",
      span: '/repo/sample folder/file.txt":42',
    },
    {
      name: "home path",
      text: "~/sample/file.txt",
      value: "~/sample/file.txt",
      line: undefined,
      kind: "path",
      span: "~/sample/file.txt",
    },
    {
      name: "markdown line",
      text: "(`/repo/file.ts#L8`)",
      value: "/repo/file.ts",
      line: 8,
      kind: "path",
      span: "/repo/file.ts#L8",
    },
    {
      name: "stack parentheses",
      text: "fn (/repo/file.ts:8:2)",
      value: "/repo/file.ts",
      line: 8,
      kind: "path",
      span: "/repo/file.ts:8:2",
    },
    {
      name: "parentheses in filename",
      text: "/repo/a(b).ts:7",
      value: "/repo/a(b).ts",
      line: 7,
      kind: "path",
      span: "/repo/a(b).ts:7",
    },
    {
      name: "windows drive",
      text: "C:\\sample\\file.ts:5",
      value: "C:\\sample\\file.ts",
      line: 5,
      kind: "path",
      span: "C:\\sample\\file.ts:5",
    },
    {
      name: "file URI encoding",
      text: "file:///repo/sample%20file.txt",
      value: "file:///repo/sample%20file.txt",
      line: undefined,
      kind: "path",
      span: "file:///repo/sample%20file.txt",
    },
    {
      name: "Japanese path",
      text: "日本 /repo/日本.txt:2",
      value: "/repo/日本.txt",
      line: 2,
      kind: "path",
      span: "/repo/日本.txt:2",
    },
    {
      name: "URL port is not a line number",
      text: "http://localhost:3000",
      value: "http://localhost:3000",
      line: undefined,
      kind: "url",
      span: "http://localhost:3000",
    },
    {
      name: "URL query and fragment",
      text: "https://example.com/a?q=1#L8",
      value: "https://example.com/a?q=1#L8",
      line: undefined,
      kind: "url",
      span: "https://example.com/a?q=1#L8",
    },
    {
      name: "sentence punctuation",
      text: "See https://example.com/a.",
      value: "https://example.com/a",
      line: undefined,
      kind: "url",
      span: "https://example.com/a",
    },
    {
      name: "nonpositive line",
      text: "/repo/file:0",
      value: "/repo/file",
      line: undefined,
      kind: "path",
      span: "/repo/file:0",
    },
  ])("$name", ({ text, value, kind, line, span }) => {
    const links = findTerminalLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ value, kind });
    expect(links[0].line).toBe(line);
    expect(text.slice(links[0].start, links[0].end)).toBe(span);
  });

  test.each([
    { name: "ordinary prose", text: "no files here" },
    {
      name: "relative path with unknown working directory",
      text: "src/sample.ts",
    },
    { name: "shell switch", text: "--flag=value" },
    { name: "unsupported URI", text: "javascript:alert(1)" },
    { name: "root alone", text: "/" },
  ])("does not link $name", ({ text }) => {
    expect(findTerminalLinks(text)).toEqual([]);
  });

  test("path construction oracle covers wrappers, prefixes and location boundaries", () => {
    let cases = 0;
    for (const prefix of ["", "at ", "日本 ", "😀 "]) {
      for (const quote of ["", '"', "'", "`"]) {
        for (const path of [
          "/repo/file.ts",
          "/repo/日本.txt",
          "~/sample/file",
        ]) {
          for (const suffix of ["", ":1", ":42:3", ":9007199254740992"]) {
            const text = prefix + quote + path + suffix + quote;
            const [link] = findTerminalLinks(text);
            expect(link.value, text).toBe(path);
            expect(text.slice(link.start, link.end), text).toBe(path + suffix);
            cases += 1;
          }
        }
      }
    }
    expect(cases).toBe(192);
  });
});

describe("terminal text coordinates", () => {
  test("wide characters and emoji keep cell coordinates rather than text offsets", () => {
    const buffer = bufferOf([{ text: "日本😀 /repo/a" }]);
    expect(searchTerminalBuffer(buffer, 80, "/repo/a")).toEqual([
      { row: 0, col: 7, length: 7 },
    ]);
    expect(searchTerminalBuffer(buffer, 80, "日本😀")).toEqual([
      { row: 0, col: 0, length: 6 },
    ]);
  });

  test("wrapped paths are reconstructed from any row in the path", () => {
    const buffer = bufferOf(
      [{ text: "/repo/sa" }, { text: "mple.ts", wrapped: true }],
      8,
    );
    const line = readTerminalLogicalLine(buffer, 1, 8);
    expect(line.text).toBe("/repo/sample.ts");
    expect(line.starts[0]).toBe(0);
    expect(line.ends[line.ends.length - 1]).toBe(15);
    expect(searchTerminalBuffer(buffer, 8, "sample.ts")).toEqual([
      { row: 0, col: 6, length: 9 },
    ]);
  });

  test.each([
    {
      name: "case insensitive",
      query: "SAMPLE",
      expected: [
        { row: 0, col: 0, length: 6 },
        { row: 1, col: 4, length: 6 },
      ],
    },
    {
      name: "literal regex characters",
      query: "[a].*",
      expected: [{ row: 2, col: 0, length: 5 }],
    },
    { name: "empty", query: "", expected: [] },
    { name: "missing", query: "absent", expected: [] },
    { name: "hard line boundaries", query: "sample\\nend", expected: [] },
  ])("search is $name", ({ query, expected }) => {
    const buffer = bufferOf([
      { text: "sample" },
      { text: "end sample" },
      { text: "[a].*" },
    ]);
    expect(searchTerminalBuffer(buffer, 80, query)).toEqual(expected);
  });

  test("wrapping oracle preserves matches across every column boundary", () => {
    const text = "prefix /repo/sample/file.ts:42:3 suffix";
    for (let cols = 2; cols <= text.length + 1; cols += 1) {
      const rows = Array.from(
        { length: Math.ceil(text.length / cols) },
        (_, i) => ({
          text: text.slice(i * cols, (i + 1) * cols),
          wrapped: i > 0,
        }),
      );
      const matches = searchTerminalBuffer(
        bufferOf(rows, cols),
        cols,
        "/repo/sample/file.ts:42:3",
      );
      expect(matches).toHaveLength(1);
      expect(matches[0].row * cols + matches[0].col).toBe(7);
      expect(matches[0].length).toBe(25);
    }
  });
});
