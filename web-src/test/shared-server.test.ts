// code-viewer が起こす codex に --no-daemon、opencode に --standalone を付けるか
// (server/accounts/shared-server.ts)。共有の裏のサーバの中で道具とフック (opencode
// はプラグイン) が走ると、2 つ目以降のフックが最初の端末のペインを指す (codex は
// 2026-11-12、opencode 2.2.7 は 2026-11-13 に確かめた)。知っている版のときだけ付ける。
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  AGENT_HELP_CACHE_MS,
  forgetAgentHelp,
  helpListsFlag,
  sharedServerArgs,
} from "../server/accounts/shared-server";

const HELP_WITH = `Options:
      --no-alt-screen
          Disable alternate screen mode
      --no-daemon
          Run without the shared background server, even if it is already running
`;
const HELP_WITHOUT = `Options:
      --no-alt-screen
          Disable alternate screen mode
`;
// opencode 2.2.7 の --help の FLAGS の形 (1.19.5 には --standalone が無い)。
const OPENCODE_2_HELP = `FLAGS
  --standalone            Run with a private server instead of the background service
  --prompt string         Prompt to use
`;
const OPENCODE_1_HELP = `Options:
      --prompt        prompt to use                                     [string]
`;

describe("helpListsFlag", () => {
  test.each([
    { name: "a version that lists it", help: HELP_WITH, expected: true },
    { name: "an older version", help: HELP_WITHOUT, expected: false },
    {
      name: "a longer flag of the same start",
      help: "  --no-daemon-ish\n",
      expected: false,
    },
  ])("$name", ({ help, expected }) => {
    expect(helpListsFlag(help, "--no-daemon")).toBe(expected);
  });
});

describe("sharedServerArgs", () => {
  afterEach(() => {
    forgetAgentHelp();
    vi.restoreAllMocks();
  });

  function deps(help: string, code = 0) {
    let now = 0;
    const runs: string[][] = [];
    return {
      runs,
      advance: (ms: number) => {
        now += ms;
      },
      deps: {
        run: async (argv: string[]) => {
          runs.push(argv);
          return { code, stdout: help, stderr: code ? "sample failure" : "" };
        },
        now: () => now,
      },
    };
  }

  test("adds --no-daemon when codex knows it, and asks --help again only after a while", async () => {
    const { runs, advance, deps: d } = deps(HELP_WITH);
    expect(await sharedServerArgs("codex", "codex", "/repo", d)).toEqual([
      "--no-daemon",
    ]);
    expect(await sharedServerArgs("codex", "codex", "/repo", d)).toEqual([
      "--no-daemon",
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.slice(-1)).toEqual(["--help"]);
    advance(AGENT_HELP_CACHE_MS);
    await sharedServerArgs("codex", "codex", "/repo", d);
    expect(runs).toHaveLength(2);
  });

  test("adds nothing for a codex that does not know it", async () => {
    const { deps: d } = deps(HELP_WITHOUT);
    expect(await sharedServerArgs("codex", "codex", "/repo", d)).toEqual([]);
  });

  test.each([
    { name: "opencode 2", help: OPENCODE_2_HELP, expected: ["--standalone"] },
    { name: "opencode 1", help: OPENCODE_1_HELP, expected: [] },
  ])(
    "$name: --standalone only when --help lists it",
    async ({ help, expected }) => {
      const { deps: d } = deps(help);
      expect(
        await sharedServerArgs("opencode", "opencode", "/repo", d),
      ).toEqual(expected);
    },
  );

  test("claude has no shared server, so --help is not asked", async () => {
    const { runs, deps: d } = deps(HELP_WITH);
    expect(await sharedServerArgs("claude", "claude", "/repo", d)).toEqual([]);
    expect(runs).toEqual([]);
  });

  test("the answer is remembered per kind, not only per command", async () => {
    const { runs, deps: d } = deps(`${HELP_WITH}${OPENCODE_2_HELP}`);
    await sharedServerArgs("codex", "/opt/sample/agent", "/repo", d);
    expect(
      await sharedServerArgs("opencode", "/opt/sample/agent", "/repo", d),
    ).toEqual(["--standalone"]);
    expect(runs).toHaveLength(2);
  });

  test("adds nothing when --help fails, and says why", async () => {
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { deps: d } = deps(HELP_WITH, 2);
    expect(await sharedServerArgs("codex", "codex", "/repo", d)).toEqual([]);
    expect(String(errors.mock.calls[0]?.[0])).toContain(
      "--help failed (exit 2)",
    );
  });

  test("a --help that never answers is not waited for again on the next launch", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { runs, deps: d } = deps(HELP_WITH, 1);
    await sharedServerArgs("codex", "codex", "/repo", d);
    expect(await sharedServerArgs("codex", "codex", "/repo", d)).toEqual([]);
    expect(runs).toHaveLength(1);
  });
});
