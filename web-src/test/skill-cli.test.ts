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

  test("install parses --global and --cwd", () => {
    expect(parseSkillArgs(["install"])).toEqual({
      ok: true,
      args: { kind: "install", global: false, cwd: undefined },
    });
    expect(parseSkillArgs(["install", "--global"])).toEqual({
      ok: true,
      args: { kind: "install", global: true, cwd: undefined },
    });
    expect(parseSkillArgs(["install", "--cwd", "/tmp/x"])).toEqual({
      ok: true,
      args: { kind: "install", global: false, cwd: "/tmp/x" },
    });
  });

  test("unknown commands and options fail", () => {
    expect(parseSkillArgs(["remove"]).ok).toBe(false);
    expect(parseSkillArgs(["install", "--wat"]).ok).toBe(false);
    expect(parseSkillArgs(["install", "--cwd"]).ok).toBe(false);
  });
});

describe("installSkill", () => {
  test("installs into the project .claude/skills directory", () => {
    const dirs = makeDirs();
    const result = installSkill({ global: false }, dirs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action).toBe("installed");
    expect(result.target).toBe(
      join(dirs.projectDir, ".claude", "skills", "code-viewer-annotate"),
    );
    expect(readFileSync(join(result.target, "SKILL.md"), "utf8")).toBe("v1");
  });

  test("re-running reports updated and overwrites content", () => {
    const dirs = makeDirs();
    const first = installSkill({ global: false }, dirs);
    expect(first.ok && first.action === "installed").toBe(true);
    writeFileSync(join(dirs.sourceDir, "SKILL.md"), "v2");
    const second = installSkill({ global: false }, dirs);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.action).toBe("updated");
    expect(readFileSync(join(second.target, "SKILL.md"), "utf8")).toBe("v2");
  });

  test("--global installs under the home directory", () => {
    const dirs = makeDirs();
    const result = installSkill({ global: true }, dirs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.target).toBe(
      join(dirs.homeDir, ".claude", "skills", "code-viewer-annotate"),
    );
  });

  test("--cwd overrides the project directory", () => {
    const dirs = makeDirs();
    const other = join(dirs.projectDir, "..", "other");
    mkdirSync(other, { recursive: true });
    const result = installSkill({ global: false, cwd: other }, dirs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.target).toBe(
      join(other, ".claude", "skills", "code-viewer-annotate"),
    );
  });

  test("missing bundled skill fails with an error", () => {
    const dirs = makeDirs();
    const result = installSkill(
      { global: false },
      { ...dirs, sourceDir: join(dirs.sourceDir, "nope") },
    );
    expect(result.ok).toBe(false);
  });
});
