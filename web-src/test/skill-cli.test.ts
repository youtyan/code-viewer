import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSkill, parseSkillArgs } from "../server/skill-cli";

const BUNDLED_SKILLS = [
  "code-viewer-annotate",
  "code-viewer-query",
  "code-viewer-snapshot",
] as const;

function makeDirs() {
  const base = mkdtempSync(join(tmpdir(), "cv-skill-"));
  const skillsRoot = join(base, "pkg", "skills");
  mkdirSync(skillsRoot, { recursive: true });
  for (const skill of BUNDLED_SKILLS) {
    const skillDir = join(skillsRoot, skill);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), `v1:${skill}`);
  }
  const projectDir = join(base, "project");
  mkdirSync(projectDir, { recursive: true });
  const homeDir = join(base, "home");
  mkdirSync(homeDir, { recursive: true });
  return { skillsRoot, projectDir, homeDir };
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
  test("installs every bundled skill into the project .claude/skills directory", () => {
    const dirs = makeDirs();
    const result = installSkill({ agents: ["claude"], global: false }, dirs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.results).toHaveLength(BUNDLED_SKILLS.length);
    for (const entry of result.results) expect(entry.action).toBe("installed");
    expect(
      result.results.map((r) => ({ skill: r.skill, target: r.target })),
    ).toEqual(
      BUNDLED_SKILLS.map((skill) => ({
        skill,
        target: join(dirs.projectDir, ".claude", "skills", skill),
      })),
    );
    for (const entry of result.results) {
      expect(readFileSync(join(entry.target, "SKILL.md"), "utf8")).toBe(
        `v1:${entry.skill}`,
      );
    }
  });

  test("installs into every selected agent directory", () => {
    const dirs = makeDirs();
    const agents = ["claude", "codex", "gemini", "cursor", "agents"] as const;
    const result = installSkill({ agents: [...agents], global: false }, dirs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expected = agents.flatMap((agent) =>
      BUNDLED_SKILLS.map((skill) => ({
        agent,
        skill,
        target: join(
          dirs.projectDir,
          `.${agent === "agents" ? "agents" : agent}`,
          "skills",
          skill,
        ),
      })),
    );
    expect(
      result.results.map((r) => ({
        agent: r.agent,
        skill: r.skill,
        target: r.target,
      })),
    ).toEqual(expected);
    for (const entry of result.results) {
      expect(readFileSync(join(entry.target, "SKILL.md"), "utf8")).toBe(
        `v1:${entry.skill}`,
      );
    }
  });

  test("re-running reports updated and overwrites content", () => {
    const dirs = makeDirs();
    const first = installSkill({ agents: ["claude"], global: false }, dirs);
    expect(
      first.ok && first.results.every((r) => r.action === "installed"),
    ).toBe(true);
    writeFileSync(
      join(dirs.skillsRoot, "code-viewer-annotate", "SKILL.md"),
      "v2",
    );
    const second = installSkill({ agents: ["claude"], global: false }, dirs);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.results.every((r) => r.action === "updated")).toBe(true);
    const annotate = second.results.find(
      (r) => r.skill === "code-viewer-annotate",
    );
    expect(annotate).toBeTruthy();
    expect(readFileSync(join(annotate?.target ?? "", "SKILL.md"), "utf8")).toBe(
      "v2",
    );
  });

  test("--global installs under the home directory", () => {
    const dirs = makeDirs();
    const result = installSkill({ agents: ["codex"], global: true }, dirs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.results.map((r) => r.target)).toEqual(
      BUNDLED_SKILLS.map((skill) =>
        join(dirs.homeDir, ".codex", "skills", skill),
      ),
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
    expect(result.results.map((r) => r.target)).toEqual(
      BUNDLED_SKILLS.map((skill) => join(other, ".claude", "skills", skill)),
    );
  });

  test("missing bundled skills directory fails with an error", () => {
    const dirs = makeDirs();
    const result = installSkill(
      { agents: ["claude"], global: false },
      { ...dirs, skillsRoot: join(dirs.skillsRoot, "nope") },
    );
    expect(result.ok).toBe(false);
  });
});
