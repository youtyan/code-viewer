// code-viewer から起動する claude に、プロジェクトの statusLine を包んだものを
// --settings で渡す (server/accounts/project-statusline.ts)。本物の一時的な git の
// リポジトリで、プロジェクトの設定ファイルの置き方ごとに起動の argv を見る。
// 利用者の ~/.claude やアカウントの設定は読まない (アカウントが記録しているかは
// 引数で渡す)。

import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { agentCommandArgv } from "../server/accounts/launch";
import {
  launchStatusLineArgs,
  projectSettingsFiles,
} from "../server/accounts/project-statusline";
import { wrappedCommand } from "../server/terminal/statusline";
import { runGit } from "./_git-fixture";

const WRAPPER =
  "/home/sample/.local/state/code-viewer/agent-usage/code-viewer-statusline";
const PROJECT_LINE = "sample-statusline --short";

let base = "";
let repo = "";

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "cv-project-statusline-")));
  repo = join(base, "sample-repo");
  mkdirSync(join(repo, "src"), { recursive: true });
  runGit(repo, ["init", "-q", "-b", "main"]);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function put(path: string, content: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    typeof content === "string"
      ? content
      : `${JSON.stringify(content, null, 2)}\n`,
  );
}

const line = (command: string, extra: Record<string, unknown> = {}) => ({
  statusLine: { type: "command", command, ...extra },
});

/** 起動の argv (起動コマンド "claude"、引き継ぎの引数は無し)。 */
function launchArgv(args: string[]): string[] {
  return agentCommandArgv("claude", args, { SHELL: "/bin/sh" });
}

function settingsArg(command: string, extra: Record<string, unknown> = {}) {
  return [
    "--settings",
    JSON.stringify({
      statusLine: {
        type: "command",
        command: wrappedCommand(WRAPPER, command),
        ...extra,
      },
    }),
  ];
}

describe("the --settings added when starting claude", () => {
  test.each([
    {
      name: "no statusLine in the project: nothing is added (the user's wrapper applies)",
      files: {},
      folder: "",
      recording: true,
      args: [],
      problem: false,
    },
    {
      name: "settings.json has one: it is wrapped, padding kept",
      files: { ".claude/settings.json": line(PROJECT_LINE, { padding: 1 }) },
      folder: "",
      recording: true,
      args: settingsArg(PROJECT_LINE, { padding: 1 }),
      problem: false,
    },
    {
      name: "settings.local.json wins over settings.json",
      files: {
        ".claude/settings.json": line("sample-shared-line"),
        ".claude/settings.local.json": line("sample-local-line"),
      },
      folder: "",
      recording: true,
      args: settingsArg("sample-local-line"),
      problem: false,
    },
    {
      name: "a local file without statusLine falls through to settings.json",
      files: {
        ".claude/settings.json": line("sample-shared-line"),
        ".claude/settings.local.json": { model: "sample" },
      },
      folder: "",
      recording: true,
      args: settingsArg("sample-shared-line"),
      problem: false,
    },
    {
      name: "already wrapped: nothing is added",
      files: {
        ".claude/settings.json": line(wrappedCommand(WRAPPER, PROJECT_LINE)),
      },
      folder: "",
      recording: true,
      args: [],
      problem: false,
    },
    {
      name: "broken JSON: nothing is added, and it says why",
      files: { ".claude/settings.json": "{ not json" },
      folder: "",
      recording: true,
      args: [],
      problem: true,
    },
    {
      name: "the account does not record usage: nothing is read or added",
      files: {
        ".claude/settings.json": "{ not json",
        ".claude/settings.local.json": line(PROJECT_LINE),
      },
      folder: "",
      recording: false,
      args: [],
      problem: false,
    },
    {
      name: "started in a subfolder: the local file at the git root counts",
      files: { ".claude/settings.local.json": line("sample-root-local") },
      folder: "src",
      recording: true,
      args: settingsArg("sample-root-local"),
      problem: false,
    },
    {
      name: "started in a subfolder: settings.json is read from that folder, not the root",
      files: {
        ".claude/settings.json": line("sample-root-shared"),
        "src/.claude/settings.json": line("sample-folder-shared"),
      },
      folder: "src",
      recording: true,
      args: settingsArg("sample-folder-shared"),
      problem: false,
    },
  ])("$name", async ({ files, folder, recording, args, problem }) => {
    const failed = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    for (const [path, content] of Object.entries(files)) {
      put(join(repo, path), content);
    }
    const out = await launchStatusLineArgs({
      recording,
      wrapper: WRAPPER,
      folder: join(repo, folder),
      home: join(base, "home"),
    });
    expect(launchArgv(out.args)).toEqual(launchArgv(args));
    if (!problem) {
      expect(out.problem).toBe("");
      expect(failed).not.toHaveBeenCalled();
      return;
    }
    // 起動は止めない。理由 (どのファイルか・JSON のエラー) を画面とログに出す。
    expect(out.problem).toContain(join(repo, ".claude", "settings.json"));
    expect(out.problem).toContain("does not record usage");
    expect(failed).toHaveBeenCalledTimes(1);
  });

  test("the argv passes the JSON as one argument, never through the shell text", () => {
    const argv = launchArgv(settingsArg(`it's "quoted" $HOME`));
    expect(argv.slice(0, 4)).toEqual(["/bin/sh", "-i", "-c", 'claude "$@"']);
    expect(JSON.parse(argv[6] ?? "")).toEqual({
      statusLine: {
        type: "command",
        command: wrappedCommand(WRAPPER, `it's "quoted" $HOME`),
      },
    });
  });
});

describe("which files are read, strongest first", () => {
  test.each([
    {
      name: "in a git repository",
      folder: "/work/repo/src",
      root: "/work/repo",
      files: [
        "/work/repo/.claude/settings.local.json",
        "/work/repo/src/.claude/settings.local.json",
        "/work/repo/src/.claude/settings.json",
      ],
    },
    {
      name: "at the repository root",
      folder: "/work/repo",
      root: "/work/repo",
      files: [
        "/work/repo/.claude/settings.local.json",
        "/work/repo/.claude/settings.json",
      ],
    },
    {
      name: "outside git",
      folder: "/work/notes",
      root: null,
      files: [
        "/work/notes/.claude/settings.local.json",
        "/work/notes/.claude/settings.json",
      ],
    },
    {
      name: "the repository root is the home directory",
      folder: "/home/sample/notes",
      root: "/home/sample",
      files: [
        "/home/sample/notes/.claude/settings.local.json",
        "/home/sample/notes/.claude/settings.json",
      ],
    },
  ])("$name", ({ folder, root, files }) => {
    expect(projectSettingsFiles(folder, root, "/home/sample")).toEqual(files);
  });
});
