import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AGENT_GUIDES,
  buildAgentHelpIndex,
  parseAgentHelpArgs,
} from "../server/agent-help";
import { ANNOTATE_AGENT_HELP } from "../server/annotate-cli";
import { DOCTOR_AGENT_HELP } from "../server/doctor-agent-help";
import { FILE_AGENT_HELP } from "../server/file-cli";
import { QUERY_AGENT_HELP } from "../server/query-cli";
import { SEARCH_AGENT_HELP } from "../server/search-cli";
import { SKILL_AGENT_HELP } from "../server/skill-cli";
import { STATUS_AGENT_HELP } from "../server/status-cli";

const SUBCOMMANDS = [
  "status",
  "query",
  "annotate",
  "search",
  "file",
  "skill",
  "doctor",
] as const;
const REPO_ROOT = join(import.meta.dir, "..", "..");

function runCli(args: string[]): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["run", "web-src/server/cli.ts", ...args],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("buildAgentHelpIndex", () => {
  test("lists every AI-facing subcommand and its agent-help rerun command", () => {
    const text = buildAgentHelpIndex();
    for (const name of SUBCOMMANDS) {
      expect(text.includes(`- ${name}`)).toBe(true);
      expect(text.includes(`code-viewer ${name} agent-help`)).toBe(true);
    }
  });

  test("includes each subcommand AGENT_HELP signature line by reference", () => {
    const text = buildAgentHelpIndex();
    const signatureOf = (helpText: string) => helpText.split("\n")[0];
    expect(text.includes(signatureOf(STATUS_AGENT_HELP))).toBe(true);
    expect(text.includes(signatureOf(QUERY_AGENT_HELP))).toBe(true);
    expect(text.includes(signatureOf(ANNOTATE_AGENT_HELP))).toBe(true);
    expect(text.includes(signatureOf(SEARCH_AGENT_HELP))).toBe(true);
    expect(text.includes(signatureOf(FILE_AGENT_HELP))).toBe(true);
    expect(text.includes(signatureOf(SKILL_AGENT_HELP))).toBe(true);
    expect(text.includes(signatureOf(DOCTOR_AGENT_HELP))).toBe(true);
  });

  test("ends with a trailing newline so shell pipes stay clean", () => {
    expect(buildAgentHelpIndex().endsWith("\n")).toBe(true);
  });

  test("re-run hint points back at the top-level entry point", () => {
    expect(buildAgentHelpIndex().includes("code-viewer agent-help")).toBe(true);
  });
});

describe("AGENT_GUIDES order is stable", () => {
  test("matches the documented status / query / annotate / search / file / skill / doctor sequence", () => {
    expect(AGENT_GUIDES.map((g) => g.name)).toEqual([...SUBCOMMANDS]);
  });
});

describe("parseAgentHelpArgs", () => {
  test("accepts only the bare top-level entry point", () => {
    expect(parseAgentHelpArgs([])).toEqual({ ok: true });
    expect(parseAgentHelpArgs(["query"])).toEqual({
      ok: false,
      error: "agent-help does not accept arguments",
    });
  });
});

describe("agent-help import boundary", () => {
  const source = readFileSync("web-src/server/agent-help.ts", "utf8");

  test("uses the lightweight doctor guide module instead of doctor-cli", () => {
    expect(source.includes("./doctor-agent-help")).toBe(true);
    expect(source.includes("./doctor-cli")).toBe(false);
  });
});

describe("CLI integration", () => {
  test("prints the top-level agent-help index without starting preview", async () => {
    const result = await runCli(["agent-help"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.includes("code-viewer — agent-help index")).toBe(true);
    for (const name of SUBCOMMANDS) {
      expect(result.stdout.includes(`code-viewer ${name} agent-help`)).toBe(
        true,
      );
    }
  });

  test("rejects extra top-level agent-help arguments", async () => {
    const result = await runCli(["agent-help", "query"]);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr.includes("agent-help does not accept arguments")).toBe(
      true,
    );
  });

  test("advertises agent-help in top-level --help", async () => {
    const result = await runCli(["--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout.includes("code-viewer agent-help")).toBe(true);
    expect(result.stdout.includes("AI-agent index")).toBe(true);
  });
});
