import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSkill, parseSkillArgs } from "../server/skill-cli";

function makeDirs() {
  const base = mkdtempSync(join(tmpdir(), "cv-skill-"));
  const sourceDir = join(base, "pkg", "skills", "code-viewer-annotate");
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(join(sourceDir, "SKILL.md"), "v1");
  const projectDir = join(base, "project");
  mkdirSync(projectDir, { recursive: true });
  const homeDir = join(base, "home");
  mkdirSync(homeDir, { recursive: true });
  return { sourceDir, projectDir, homeDir };
}

describe("parseSkillArgs", () => {
  test("no arguments or --help shows help", () => {
    expect(parseSkillArgs([])).toEqual({ ok: true, args: { kind: "help" } });
    expect(parseSkillArgs(["install", "--help"])).toEqual({
      ok: true,
      args: { kind: "help" },
    });
  });

  test("install defaults to the claude agent", () => {
    expect(parseSkillArgs(["install"])).toEqual({
      ok: true,
      args: {
        kind: "install",
        agents: ["claude"],
        global: false,
        cwd: undefined,
      },
    });
  });

  test("install parses --global, --cwd and --agent lists", () => {
    expect(parseSkillArgs(["install", "--global"])).toEqual({
      ok: true,
      args: {
        kind: "install",
        agents: ["claude"],
        global: true,
        cwd: undefined,
      },
    });
    expect(parseSkillArgs(["install", "--cwd", "/tmp/x"])).toEqual({
      ok: true,
      args: {
        kind: "install",
        agents: ["claude"],
        global: false,
        cwd: "/tmp/x",
      },
    });
    expect(parseSkillArgs(["install", "--agent", "codex,gemini"])).toEqual({
      ok: true,
      args: {
        kind: "install",
        agents: ["codex", "gemini"],
        global: false,
        cwd: undefined,
      },
    });
    const all = parseSkillArgs(["install", "--agent", "all"]);
    expect(
      all.ok &&
        all.args.kind === "install" &&
        all.args.agents.includes("claude") &&
        all.args.agents.includes("codex") &&
        all.args.agents.includes("gemini") &&
        all.args.agents.includes("cursor") &&
        all.args.agents.includes("agents"),
    ).toBe(true);
  });

  test("duplicate agents are deduplicated", () => {
    const parsed = parseSkillArgs(["install", "--agent", "codex,codex"]);
    expect(
      parsed.ok && parsed.args.kind === "install" && parsed.args.agents,
    ).toEqual(["codex"]);
  });

  test("unknown commands, options and agents fail", () => {
    expect(parseSkillArgs(["remove"]).ok).toBe(false);
    expect(parseSkillArgs(["install", "--wat"]).ok).toBe(false);
    expect(parseSkillArgs(["install", "--cwd"]).ok).toBe(false);
    expect(parseSkillArgs(["install", "--agent"]).ok).toBe(false);
    expect(parseSkillArgs(["install", "--agent", "copilot"]).ok).toBe(false);
  });
});

describe("installSkill", () => {
  test("installs into the project .claude/skills directory", () => {
    const dirs = makeDirs();
    const result = installSkill({ agents: ["claude"], global: false }, dirs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.results).toHaveLength(1);
    expect(result.results[0].action).toBe("installed");
    expect(result.results[0].target).toBe(
      join(dirs.projectDir, ".claude", "skills", "code-viewer-annotate"),
    );
    expect(
      readFileSync(join(result.results[0].target, "SKILL.md"), "utf8"),
    ).toBe("v1");
  });

  test("installs into multiple agent directories", () => {
    const dirs = makeDirs();
    const result = installSkill(
      {
        agents: ["claude", "codex", "gemini", "cursor", "agents"],
        global: false,
      },
      dirs,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.results.map((r) => r.target)).toEqual([
      join(dirs.projectDir, ".claude", "skills", "code-viewer-annotate"),
      join(dirs.projectDir, ".codex", "skills", "code-viewer-annotate"),
      join(dirs.projectDir, ".gemini", "skills", "code-viewer-annotate"),
      join(dirs.projectDir, ".cursor", "skills", "code-viewer-annotate"),
      join(dirs.projectDir, ".agents", "skills", "code-viewer-annotate"),
    ]);
    for (const entry of result.results) {
      expect(readFileSync(join(entry.target, "SKILL.md"), "utf8")).toBe("v1");
    }
  });

  test("re-running reports updated and overwrites content", () => {
    const dirs = makeDirs();
    const first = installSkill({ agents: ["claude"], global: false }, dirs);
    expect(first.ok && first.results[0].action === "installed").toBe(true);
    writeFileSync(join(dirs.sourceDir, "SKILL.md"), "v2");
    const second = installSkill({ agents: ["claude"], global: false }, dirs);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.results[0].action).toBe("updated");
    expect(
      readFileSync(join(second.results[0].target, "SKILL.md"), "utf8"),
    ).toBe("v2");
  });

  test("--global installs under the home directory", () => {
    const dirs = makeDirs();
    const result = installSkill({ agents: ["codex"], global: true }, dirs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.results[0].target).toBe(
      join(dirs.homeDir, ".codex", "skills", "code-viewer-annotate"),
    );
  });

  test("--cwd overrides the project directory", () => {
    const dirs = makeDirs();
    const other = join(dirs.projectDir, "..", "other");
    mkdirSync(other, { recursive: true });
    const result = installSkill(
      { agents: ["claude"], global: false, cwd: other },
      dirs,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.results[0].target).toBe(
      join(other, ".claude", "skills", "code-viewer-annotate"),
    );
  });

  test("missing bundled skill fails with an error", () => {
    const dirs = makeDirs();
    const result = installSkill(
      { agents: ["claude"], global: false },
      { ...dirs, sourceDir: join(dirs.sourceDir, "nope") },
    );
    expect(result.ok).toBe(false);
  });
});
