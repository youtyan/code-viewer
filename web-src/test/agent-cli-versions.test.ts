import { describe, expect, test } from "vitest";
import {
  agentCliVersionIn,
  CHECKED_AGENT_CLI_VERSIONS,
} from "../core/agent-cli-versions";
import { checkAgentClis } from "../server/doctor";
import type { RunResult } from "../server/runtime";

describe("agentCliVersionIn", () => {
  test.each<{ name: string; output: string; version: string | null }>([
    {
      name: "claude",
      output: "2.1.286 (Claude Code)\n",
      version: "2.1.286",
    },
    { name: "codex", output: "codex-cli 0.159.3\n", version: "0.159.3" },
    {
      name: "a pre-release",
      output: "2.2.0-beta.1 (Claude Code)\n",
      version: "2.2.0-beta.1",
    },
    {
      name: "the interactive shell printed a terminal title first",
      output: "\u001b]7;file://host/tmp\u0007codex-cli 0.159.3\n",
      version: "0.159.3",
    },
    { name: "nothing printed", output: "", version: null },
    { name: "two numbers only", output: "codex-cli 0.159\n", version: null },
  ])("$name", ({ output, version }) => {
    expect(agentCliVersionIn(output)).toBe(version);
  });

  // doctor は記録と手元の版を文字列で比べるので、記録は出力から読む形のまま書く。
  test.each(
    Object.entries(CHECKED_AGENT_CLI_VERSIONS),
  )("the checked %s version is written the way --version prints it", (_agent, checked) => {
    expect([
      agentCliVersionIn(checked.version),
      /^\d{4}-\d{2}-\d{2}$/.test(checked.checkedOn),
      new Date(`${checked.checkedOn}T00:00:00Z`)
        .toISOString()
        .startsWith(checked.checkedOn),
    ]).toEqual([checked.version, true, true]);
  });
});

describe("doctor: agent CLIs", () => {
  const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: "" });
  // 記録は版上げのたびに変わるので、doctor の行は固定の記録で見る。
  const CHECKED = {
    claude: { version: "9.8.7", checkedOn: "2026-01-02" },
    codex: { version: "0.1.0", checkedOn: "2026-01-02" },
  };

  test("asks the configured launch command through the interactive shell", async () => {
    const asked: string[][] = [];
    await checkAgentClis(
      async (argv) => {
        asked.push(argv.slice(2));
        return ok("1.0.0\n");
      },
      { claude: "my-claude", codex: "codex --profile work" },
    );
    expect(asked).toEqual([
      ["-c", 'my-claude "$@"', expect.any(String), "--version"],
      ["-c", 'codex --profile work "$@"', expect.any(String), "--version"],
    ]);
  });

  test.each<{
    name: string;
    result: RunResult;
    row: { status: string; detail: string; hint?: string };
  }>([
    {
      name: "the version code-viewer was checked with",
      result: ok("9.8.7 (Claude Code)\n"),
      row: {
        status: "ok",
        detail: "9.8.7 (code-viewer was checked with 9.8.7 on 2026-01-02)",
      },
    },
    {
      name: "another version is still ok, with a hint",
      result: ok("9.9.0 (Claude Code)\n"),
      row: {
        status: "ok",
        detail: "9.9.0 (code-viewer was checked with 9.8.7 on 2026-01-02)",
        hint: "Not checked with 9.9.0 yet. Hooks, agent states, sign-in and usage rely on how claude behaves; if one of them looks wrong, suspect this version first.",
      },
    },
    {
      name: "not installed",
      result: {
        code: 127,
        stdout: "",
        stderr: "zsh: command not found: claude\n",
      },
      row: {
        status: "warn",
        detail:
          "claude --version exited with 127\nstderr: zsh: command not found: claude",
        hint: "Needed only to run claude from code-viewer. Install it, or set its launch command in Settings > Accounts; code-viewer was checked with 9.8.7 on 2026-01-02.",
      },
    },
    {
      name: "no version in the output",
      result: ok("usage: claude [options]\n"),
      row: {
        status: "warn",
        detail:
          "claude --version printed no version\nstdout: usage: claude [options]",
        hint: "Needed only to run claude from code-viewer. Install it, or set its launch command in Settings > Accounts; code-viewer was checked with 9.8.7 on 2026-01-02.",
      },
    },
    {
      name: "timed out",
      result: {
        code: 124,
        stdout: "",
        stderr: "",
        failure: {
          kind: "timed-out",
          message: "/bin/zsh -i -c timed out after 8000ms",
          timeoutMs: 8000,
          elapsedMs: 8001,
        },
      },
      row: {
        status: "warn",
        detail: "/bin/zsh -i -c timed out after 8000ms",
        hint: "Needed only to run claude from code-viewer. Install it, or set its launch command in Settings > Accounts; code-viewer was checked with 9.8.7 on 2026-01-02.",
      },
    },
  ])("$name", async ({ result, row }) => {
    const group = await checkAgentClis(
      async () => result,
      { claude: "claude", codex: "codex" },
      CHECKED,
    );
    const claude = group.rows.find(
      (candidate) => candidate.id === "agent-cli.claude",
    );
    expect(claude).toEqual({
      id: "agent-cli.claude",
      title: "claude CLI",
      ...row,
    });
  });
});
