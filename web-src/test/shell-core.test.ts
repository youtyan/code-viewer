import { describe, expect, test } from "vitest";
import {
  clampShellSize,
  isShellSessionId,
  isShellTarget,
  MAX_SHELL_COLS,
  MAX_SHELL_ROWS,
  MIN_SHELL_COLS,
  MIN_SHELL_ROWS,
} from "../core/shell";

describe("isShellSessionId", () => {
  test.each([
    {
      name: "accepts a generated id",
      value: "shell-ms9lr0pwp67ppz",
      expected: true,
    },
    {
      name: "accepts the minimum length",
      value: "shell-abc123",
      expected: true,
    },
    { name: "rejects a too short suffix", value: "shell-ab", expected: false },
    { name: "rejects a tmux pane id", value: "%12", expected: false },
    {
      name: "rejects a missing prefix",
      value: "ms9lr0pwp67ppz",
      expected: false,
    },
    { name: "rejects uppercase", value: "shell-ABCDEF", expected: false },
    {
      name: "rejects a shell metacharacter",
      value: "shell-abc;id",
      expected: false,
    },
    {
      name: "rejects a path traversal attempt",
      value: "shell-../etc",
      expected: false,
    },
    { name: "rejects an empty string", value: "", expected: false },
    { name: "rejects null", value: null, expected: false },
    { name: "rejects a number", value: 1, expected: false },
  ])("$name", ({ value, expected }) => {
    expect(isShellSessionId(value)).toBe(expected);
  });
});

// ドロワーは 1 つの値で「tmux ペイン」と「シェル」を持ち回るので、どちら側
// かを取り違えると別の API を叩いてしまう。
describe("isShellTarget", () => {
  test.each([
    {
      name: "treats a shell id as a shell",
      value: "shell-abc123",
      expected: true,
    },
    {
      name: "treats a tmux pane as not a shell",
      value: "%12",
      expected: false,
    },
    {
      name: "treats the open marker as not a shell",
      value: "open",
      expected: false,
    },
    { name: "treats null as not a shell", value: null, expected: false },
  ])("$name", ({ value, expected }) => {
    expect(isShellTarget(value)).toBe(expected);
  });
});

describe("clampShellSize", () => {
  test.each([
    {
      name: "keeps a normal size",
      cols: 120,
      rows: 40,
      expected: { cols: 120, rows: 40 },
    },
    {
      name: "rounds fractional measurements",
      cols: 100.6,
      rows: 30.2,
      expected: { cols: 101, rows: 30 },
    },
    {
      name: "raises a too small size to the minimum",
      cols: 1,
      rows: 1,
      expected: { cols: MIN_SHELL_COLS, rows: MIN_SHELL_ROWS },
    },
    {
      name: "caps a too large size at the maximum",
      cols: 99_999,
      rows: 99_999,
      expected: { cols: MAX_SHELL_COLS, rows: MAX_SHELL_ROWS },
    },
    {
      name: "falls back to the minimum for NaN",
      cols: Number.NaN,
      rows: Number.NaN,
      expected: { cols: MIN_SHELL_COLS, rows: MIN_SHELL_ROWS },
    },
    {
      name: "falls back to the minimum for Infinity",
      cols: Number.POSITIVE_INFINITY,
      rows: Number.POSITIVE_INFINITY,
      expected: { cols: MIN_SHELL_COLS, rows: MIN_SHELL_ROWS },
    },
    {
      name: "falls back to the minimum for a negative size",
      cols: -10,
      rows: -10,
      expected: { cols: MIN_SHELL_COLS, rows: MIN_SHELL_ROWS },
    },
  ])("$name", ({ cols, rows, expected }) => {
    expect(clampShellSize(cols, rows)).toEqual(expected);
  });
});
