import { describe, expect, test } from "vitest";
import {
  takeGlobalCliOption,
  validateRefValue,
  validateRepoRelativePathValue,
} from "../server/cli-helpers";

describe("takeGlobalCliOption", () => {
  test.each([
    {
      name: "consumes --cwd",
      argv: ["--cwd", "/example/repository"],
      options: { allowedCommands: ["git"] as const },
      expected: { kind: "cwd", value: "/example/repository", next: 1 },
    },
    {
      name: "consumes --server when enabled",
      argv: ["--server", "http://127.0.0.1:64160"],
      options: { allowServer: true, allowedCommands: ["git"] as const },
      expected: {
        kind: "server",
        value: "http://127.0.0.1:64160",
        next: 1,
      },
    },
    {
      name: "leaves --server to callers that do not allow it",
      argv: ["--server", "http://127.0.0.1:64160"],
      options: { allowedCommands: ["git"] as const },
      expected: { kind: "unhandled" },
    },
    {
      name: "consumes an allowed --bin override",
      argv: ["--bin", "git=/opt/bin/git"],
      options: { allowedCommands: ["git"] as const },
      expected: {
        kind: "command-override",
        override: { name: "git", path: "/opt/bin/git" },
        next: 1,
      },
    },
  ])("$name", ({ argv, options, expected }) => {
    expect(takeGlobalCliOption(argv, 0, options)).toEqual(expected);
  });

  test.each([
    {
      name: "--cwd without a value",
      argv: ["--cwd"],
      options: { allowedCommands: ["git"] as const },
      expected: { kind: "error", error: "--cwd requires a value" },
    },
    {
      name: "--server without a value",
      argv: ["--server"],
      options: { allowServer: true, allowedCommands: ["git"] as const },
      expected: { kind: "error", error: "--server requires a value" },
    },
    {
      name: "--bin without a value",
      argv: ["--bin"],
      options: { allowedCommands: ["git"] as const },
      expected: { kind: "error", error: "--bin requires a value" },
    },
    {
      name: "--bin with a disallowed command",
      argv: ["--bin", "docker=/opt/bin/docker"],
      options: { allowedCommands: ["git"] as const },
      expected: {
        kind: "error",
        error: "--bin unsupported command: docker",
      },
    },
  ])("reports $name", ({ argv, options, expected }) => {
    expect(takeGlobalCliOption(argv, 0, options)).toEqual(expected);
  });

  test.each([
    {
      name: "accepts a safe value",
      value: "source/file.ts",
      expected: undefined,
    },
    {
      name: "rejects an empty value",
      value: "",
      expected: "--value requires a non-empty value",
    },
    {
      name: "rejects a value containing NUL",
      value: "source\0file.ts",
      expected: "--value must be single-line and must not contain NUL",
    },
    {
      name: "rejects a multi-line value",
      value: "source\nfile.ts",
      expected: "--value must be single-line and must not contain NUL",
    },
    {
      name: "rejects a leading-dash value",
      value: "--source",
      expected: "--value must not start with '-'",
    },
  ])("keeps shared validation behavior: $name", ({ value, expected }) => {
    expect(validateRefValue(value, "--value")).toBe(expected);
    expect(validateRepoRelativePathValue(value, "--value")).toBe(expected);
  });
});
