// code-viewer が起こす codex に --no-daemon を付けるか (server/accounts/codex-daemon.ts)。
// 共有の裏のサーバの中で道具とフックが走ると、2 つ目以降の codex のフックが最初の
// 端末のペインを指す (2026-11-12 に確かめた)。知っている版のときだけ付ける。
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  CODEX_HELP_CACHE_MS,
  codexDaemonArgs,
  codexKnowsNoDaemon,
  forgetCodexHelp,
} from "../server/accounts/codex-daemon";

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

describe("codexKnowsNoDaemon", () => {
  test.each([
    { name: "a version that lists it", help: HELP_WITH, expected: true },
    { name: "an older version", help: HELP_WITHOUT, expected: false },
    {
      name: "a longer flag of the same start",
      help: "  --no-daemon-ish\n",
      expected: false,
    },
  ])("$name", ({ help, expected }) => {
    expect(codexKnowsNoDaemon(help)).toBe(expected);
  });
});

describe("codexDaemonArgs", () => {
  afterEach(() => {
    forgetCodexHelp();
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
    expect(await codexDaemonArgs("codex", "/repo", d)).toEqual(["--no-daemon"]);
    expect(await codexDaemonArgs("codex", "/repo", d)).toEqual(["--no-daemon"]);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.slice(-1)).toEqual(["--help"]);
    advance(CODEX_HELP_CACHE_MS);
    await codexDaemonArgs("codex", "/repo", d);
    expect(runs).toHaveLength(2);
  });

  test("adds nothing for a codex that does not know it", async () => {
    const { deps: d } = deps(HELP_WITHOUT);
    expect(await codexDaemonArgs("codex", "/repo", d)).toEqual([]);
  });

  test("adds nothing when --help fails, and says why", async () => {
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { deps: d } = deps(HELP_WITH, 2);
    expect(await codexDaemonArgs("codex", "/repo", d)).toEqual([]);
    expect(String(errors.mock.calls[0]?.[0])).toContain(
      "--help failed (exit 2)",
    );
  });

  test("a --help that never answers is not waited for again on the next launch", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { runs, deps: d } = deps(HELP_WITH, 1);
    await codexDaemonArgs("codex", "/repo", d);
    expect(await codexDaemonArgs("codex", "/repo", d)).toEqual([]);
    expect(runs).toHaveLength(1);
  });
});
