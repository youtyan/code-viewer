// フックの入れ外しのファイル操作。本物のファイルシステムで、一時
// ディレクトリを設定ディレクトリとして使う (利用者の ~/.claude には触らない)。

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  AGENT_HOOK_MARKER,
  HOOK_SPECS,
  type HookAgent,
  planHookChange,
  serializeHookFile,
} from "../core/agent-hooks";
import {
  AgentHookError,
  type AgentHookTarget,
  agentHookCommand,
  agentHookFile,
  agentHookStatus,
  applyAgentHooks,
  defaultAgentConfigDir,
  type HookLauncher,
  hookLauncherScript,
  launcherHealth,
  planAgentHooks,
} from "../server/terminal/hooks";

let root: string;
let configDir: string;
let launcher: HookLauncher;
const NOW = new Date(2026, 0, 2, 3, 4, 5);

const FOREIGN = {
  model: "sample-model",
  hooks: {
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [{ type: "command", command: "sample-tool guard" }],
      },
    ],
    Stop: [{ hooks: [{ type: "command", command: "sample-tool notify" }] }],
  },
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cv-agent-hooks-"));
  configDir = join(root, "config");
  mkdirSync(configDir);
  const state = join(root, "state");
  launcher = {
    path: join(state, AGENT_HOOK_MARKER),
    failureLog: join(state, "failures.jsonl"),
    node: process.execPath,
    // 在るファイルなら何でもよい。起動スクリプトは中身を実行しない。
    cli: join(root, "code-viewer.js"),
    registryDir: "",
  };
  writeFileSync(launcher.cli, "", "utf8");
});

afterEach(() => {
  // 書けなくしたディレクトリを戻してから消す。
  for (const dir of [configDir, join(root, "linked")]) {
    if (existsSync(dir)) chmodSync(dir, 0o755);
  }
  rmSync(root, { recursive: true, force: true });
});

function target(agent: HookAgent = "claude"): AgentHookTarget {
  return { agent, configDir };
}

function settingsPath(agent: HookAgent = "claude"): string {
  return agentHookFile(agent, configDir);
}

function apply(
  action: "install" | "uninstall",
  agent: HookAgent = "claude",
  ops?: Parameters<typeof applyAgentHooks>[5],
) {
  const plan = planAgentHooks(target(agent), action, launcher, NOW);
  return {
    plan,
    result: applyAgentHooks(
      target(agent),
      action,
      launcher,
      plan.baseHash,
      NOW,
      ops,
    ),
  };
}

function backups(): string[] {
  return readdirSync(configDir).filter((name) =>
    name.includes(".code-viewer-backup-"),
  );
}

describe("paths", () => {
  test.each([
    { agent: "claude", env: {}, expected: "/home/sample/.claude" },
    {
      agent: "claude",
      env: { CLAUDE_CONFIG_DIR: "/tmp/sample-claude" },
      expected: "/tmp/sample-claude",
    },
    { agent: "codex", env: {}, expected: "/home/sample/.codex" },
    {
      agent: "codex",
      env: { CODEX_HOME: "/tmp/sample-codex" },
      expected: "/tmp/sample-codex",
    },
  ] satisfies {
    agent: HookAgent;
    env: Record<string, string>;
    expected: string;
  }[])("default settings directory of $agent with $env", ({
    agent,
    env,
    expected,
  }) => {
    expect(defaultAgentConfigDir(agent, env, "/home/sample")).toBe(expected);
  });

  test.each([
    { agent: "claude", file: "settings.json" },
    { agent: "codex", file: "hooks.json" },
  ] satisfies { agent: HookAgent; file: string }[])("$agent writes $file", ({
    agent,
    file,
  }) => {
    expect(agentHookFile(agent, "/cfg")).toBe(join("/cfg", file));
  });

  test("the command names only the launcher and the agent", () => {
    expect(agentHookCommand({ ...launcher, path: "/s/x-hook" }, "codex")).toBe(
      "/s/x-hook codex",
    );
    expect(
      agentHookCommand({ ...launcher, path: "/s p/x'hook" }, "claude"),
    ).toBe("'/s p/x'\\''hook' claude");
  });
});

describe("install and uninstall", () => {
  test.each([
    { name: "no file", initial: null },
    { name: "empty object", initial: "{}\n" },
    { name: "no hooks key", initial: '{\n  "model": "sample-model"\n}\n' },
    {
      name: "other tools' hooks (4-space indent)",
      initial: `${JSON.stringify(FOREIGN, null, 4)}\n`,
    },
    {
      name: "other tools' hooks (no trailing newline)",
      initial: JSON.stringify(FOREIGN, null, 2),
    },
  ] satisfies {
    name: string;
    initial: string | null;
  }[])("install, reinstall, uninstall round-trips ($name)", ({ initial }) => {
    for (const agent of ["claude", "codex"] as const) {
      const path = settingsPath(agent);
      if (initial !== null) writeFileSync(path, initial, "utf8");

      const first = apply("install", agent);
      expect(first.result.changed).toBe(true);
      const afterInstall = readFileSync(path, "utf8");
      // 確認画面の計画と、実際に書いた中身が一致する。
      const expected = planHookChange(
        initial === null ? null : JSON.parse(initial),
        "install",
        HOOK_SPECS[agent],
        agentHookCommand(launcher, agent),
      ).next;
      expect(JSON.parse(afterInstall)).toEqual(expected);
      expect(
        first.plan.added.map((change: { entry: unknown }) => change.entry),
      ).toEqual(
        HOOK_SPECS[agent].map(
          (spec) =>
            (expected.hooks as Record<string, unknown[]>)[spec.event]?.slice(
              -1,
            )[0],
        ),
      );
      expect(agentHookStatus(target(agent), launcher).state).toBe("installed");

      const second = apply("install", agent);
      expect(second.result.changed).toBe(false);
      expect(second.result.backupPath).toBeNull();
      expect(readFileSync(path, "utf8")).toBe(afterInstall);

      const removed = apply("uninstall", agent);
      expect(removed.result.changed).toBe(true);
      // 無かったファイルは消さずに空のオブジェクトとして残す (作ったのが
      // 自分かどうかを外すときには見分けられず、ファイルは消さない)。
      expect(readFileSync(path, "utf8")).toBe(initial ?? "{}\n");
      expect(agentHookStatus(target(agent), launcher).state).toBe("none");
    }
  });

  test("keeps other tools' hooks and reports how many", () => {
    writeFileSync(settingsPath(), JSON.stringify(FOREIGN), "utf8");
    const plan = planAgentHooks(target(), "install", launcher, NOW);
    expect(plan.kept).toBe(2);
    apply("install");
    const written = JSON.parse(readFileSync(settingsPath(), "utf8"));
    expect(written.hooks.PreToolUse).toEqual(FOREIGN.hooks.PreToolUse);
    expect(written.hooks.Stop[0]).toEqual(FOREIGN.hooks.Stop[0]);
    expect(written.model).toBe("sample-model");
  });

  test("writes a backup of the previous content before writing", () => {
    const initial = `${JSON.stringify(FOREIGN, null, 2)}\n`;
    writeFileSync(settingsPath(), initial, "utf8");
    const { plan, result } = apply("install");
    const expectedBackup = join(
      configDir,
      "settings.json.code-viewer-backup-20260102-030405",
    );
    expect(plan.backupPath).toBe(expectedBackup);
    expect(result.backupPath).toBe(expectedBackup);
    expect(readFileSync(expectedBackup, "utf8")).toBe(initial);
  });

  test("a second backup in the same second gets its own name", () => {
    writeFileSync(settingsPath(), "{}\n", "utf8");
    apply("install");
    apply("uninstall");
    expect(backups().sort()).toEqual([
      "settings.json.code-viewer-backup-20260102-030405",
      "settings.json.code-viewer-backup-20260102-030405-2",
    ]);
  });

  test("no backup is written when the file did not exist", () => {
    const { result } = apply("install");
    expect(result.backupPath).toBeNull();
    expect(backups()).toEqual([]);
  });

  test("writes the launcher, which names node and code-viewer", () => {
    const { result } = apply("install");
    expect(result.launcherWritten).toBe(true);
    expect(readFileSync(launcher.path, "utf8")).toBe(
      hookLauncherScript(launcher),
    );
    expect(statSync(launcher.path).mode & 0o777).toBe(0o755);
    expect(launcherHealth(launcher).state).toBe("ok");
  });
});

describe("refuses to write", () => {
  test.each([
    { name: "broken JSON", text: '{"hooks": {', detail: "not valid JSON" },
    { name: "array root", text: "[]", detail: "$: " },
    { name: "hooks as array", text: '{"hooks": []}', detail: "$.hooks: " },
    {
      name: "event as object",
      text: '{"hooks": {"Stop": {}}}',
      detail: "$.hooks.Stop: ",
    },
  ])("$name", ({ text, detail }) => {
    writeFileSync(settingsPath(), text, "utf8");
    const status = agentHookStatus(target(), launcher);
    expect(status.state).toBe("unreadable");
    expect(status.detail).toContain(detail);
    for (const action of ["install", "uninstall"] as const) {
      expect(() => planAgentHooks(target(), action, launcher, NOW)).toThrow(
        AgentHookError,
      );
      expect(() =>
        applyAgentHooks(target(), action, launcher, "0".repeat(64), NOW),
      ).toThrow(AgentHookError);
    }
    expect(readFileSync(settingsPath(), "utf8")).toBe(text);
    expect(backups()).toEqual([]);
    expect(existsSync(launcher.path)).toBe(false);
  });

  test("when the file changed after it was shown", () => {
    writeFileSync(settingsPath(), "{}\n", "utf8");
    const plan = planAgentHooks(target(), "install", launcher, NOW);
    writeFileSync(settingsPath(), '{"model": "changed"}\n', "utf8");
    expect(() =>
      applyAgentHooks(target(), "install", launcher, plan.baseHash, NOW),
    ).toThrow(/changed after it was shown/);
    expect(readFileSync(settingsPath(), "utf8")).toBe('{"model": "changed"}\n');
    expect(backups()).toEqual([]);
  });

  test("when the backup cannot be written", () => {
    const initial = `${JSON.stringify(FOREIGN, null, 2)}\n`;
    writeFileSync(settingsPath(), initial, "utf8");
    const failure = Object.assign(new Error("disk full"), { code: "ENOSPC" });
    let caught: unknown;
    try {
      apply("install", "claude", {
        writeBackup() {
          throw failure;
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AgentHookError);
    expect((caught as AgentHookError).message).toContain("failed to back up");
    expect((caught as { cause?: unknown }).cause).toBe(failure);
    expect(readFileSync(settingsPath(), "utf8")).toBe(initial);
  });

  test("when the settings directory is not writable", () => {
    writeFileSync(settingsPath(), "{}\n", "utf8");
    chmodSync(configDir, 0o555);
    const plan = planAgentHooks(target(), "install", launcher, NOW);
    expect(plan.writeBlocked).toContain("is not writable");
    expect(agentHookStatus(target(), launcher).writeBlocked).toContain(
      "is not writable",
    );
    expect(() =>
      applyAgentHooks(target(), "install", launcher, plan.baseHash, NOW),
    ).toThrow(/cannot write/);
    chmodSync(configDir, 0o755);
    expect(readFileSync(settingsPath(), "utf8")).toBe("{}\n");
    expect(backups()).toEqual([]);
  });

  test("when the settings directory does not exist", () => {
    rmSync(configDir, { recursive: true });
    expect(agentHookStatus(target(), launcher).state).toBe("no-config-dir");
    expect(() => planAgentHooks(target(), "install", launcher, NOW)).toThrow(
      /does not exist/,
    );
    expect(existsSync(configDir)).toBe(false);
  });
});

describe("file properties", () => {
  test.each([0o600, 0o640, 0o644])("keeps the mode %s", (mode) => {
    writeFileSync(settingsPath(), "{}\n", { encoding: "utf8", mode });
    chmodSync(settingsPath(), mode);
    apply("install");
    expect(statSync(settingsPath()).mode & 0o777).toBe(mode);
    const [backup] = backups();
    expect(statSync(join(configDir, backup as string)).mode & 0o777).toBe(mode);
  });

  test("updates a symlink's target and keeps the link", () => {
    const linked = join(root, "linked");
    mkdirSync(linked);
    const real = join(linked, "settings.json");
    const initial = `${JSON.stringify(FOREIGN, null, 2)}\n`;
    writeFileSync(real, initial, "utf8");
    symlinkSync(real, settingsPath());

    const { plan, result } = apply("install");
    expect(plan.symlink).toBe(true);
    expect(plan.realPath).toBe(realpathSync(real));
    expect(lstatSync(settingsPath()).isSymbolicLink()).toBe(true);
    expect(readlinkSync(settingsPath())).toBe(real);
    expect(JSON.parse(readFileSync(real, "utf8")).hooks.Stop).toHaveLength(2);
    // バックアップはリンクの側に置く (リンク先は別の管理下にあることが多い)。
    expect(result.backupPath?.startsWith(configDir)).toBe(true);
    expect(readdirSync(linked)).toEqual(["settings.json"]);

    apply("uninstall");
    expect(lstatSync(settingsPath()).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, "utf8")).toBe(initial);
  });

  test("a link whose target is read-only is reported, not written", () => {
    const linked = join(root, "linked");
    mkdirSync(linked);
    const real = join(linked, "settings.json");
    writeFileSync(real, "{}\n", "utf8");
    symlinkSync(real, settingsPath());
    chmodSync(real, 0o444);
    chmodSync(linked, 0o555);
    const status = agentHookStatus(target(), launcher);
    expect(status.symlink).toBe(true);
    expect(status.state).toBe("none");
    expect(status.writeBlocked).toContain(linked);
    const plan = planAgentHooks(target(), "install", launcher, NOW);
    expect(() =>
      applyAgentHooks(target(), "install", launcher, plan.baseHash, NOW),
    ).toThrow(/cannot write/);
    chmodSync(linked, 0o755);
    chmodSync(real, 0o644);
    expect(readFileSync(real, "utf8")).toBe("{}\n");
    expect(backups()).toEqual([]);
  });

  test("a chain of links is judged at its end, not at the first hop", () => {
    // 設定ファイルが「読み取り専用の場所にあるリンク」を経て、書ける実ファイルに
    // 行き着く形。1 段目のリンク先だけを見て「書けない」と誤って伝えた経緯がある。
    const writable = join(root, "writable");
    mkdirSync(writable);
    const real = join(writable, "settings.json");
    writeFileSync(real, "{}\n", "utf8");
    const readOnlyHop = join(root, "linked");
    mkdirSync(readOnlyHop);
    symlinkSync(real, join(readOnlyHop, "settings.json"));
    chmodSync(readOnlyHop, 0o555);
    symlinkSync(join(readOnlyHop, "settings.json"), settingsPath());

    const status = agentHookStatus(target(), launcher);
    expect(status.realPath).toBe(realpathSync(real));
    expect(status.writeBlocked).toBe("");

    const { result } = apply("install");
    expect(lstatSync(settingsPath()).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(readOnlyHop, "settings.json")).isSymbolicLink()).toBe(
      true,
    );
    expect(JSON.parse(readFileSync(real, "utf8")).hooks.Stop).toHaveLength(1);
    expect(result.backupPath?.startsWith(configDir)).toBe(true);
  });

  test("a formatting difference is announced before writing", () => {
    writeFileSync(settingsPath(), '{"model":"sample-model"}\n', "utf8");
    expect(
      planAgentHooks(target(), "install", launcher, NOW).formattingChanged,
    ).toBe(true);
    writeFileSync(
      settingsPath(),
      serializeHookFile({ model: "sample-model" }, null),
      "utf8",
    );
    expect(
      planAgentHooks(target(), "install", launcher, NOW).formattingChanged,
    ).toBe(false);
  });
});

describe("status", () => {
  test.each([
    { name: "launcher missing", setup: "no-launcher", expected: "broken" },
    { name: "code-viewer gone", setup: "no-cli", expected: "broken" },
    { name: "one hook removed by hand", setup: "partial", expected: "partial" },
    { name: "healthy", setup: "none", expected: "installed" },
  ])("$name -> $expected", ({ setup, expected }) => {
    apply("install");
    if (setup === "no-launcher") rmSync(launcher.path);
    if (setup === "no-cli") rmSync(launcher.cli);
    if (setup === "partial") {
      const written = JSON.parse(readFileSync(settingsPath(), "utf8"));
      delete written.hooks.Stop;
      writeFileSync(settingsPath(), JSON.stringify(written), "utf8");
    }
    const status = agentHookStatus(target(), launcher);
    expect(status.state).toBe(expected);
    if (setup === "no-cli") expect(status.detail).toContain(launcher.cli);
  });

  test("a read-only settings file still lets the launcher be repaired", () => {
    apply("install");
    rmSync(launcher.path);
    chmodSync(configDir, 0o555);
    const plan = planAgentHooks(target(), "install", launcher, NOW);
    expect(plan.writeBlocked).toContain("is not writable");
    expect(plan.changed).toBe(false);
    const result = applyAgentHooks(
      target(),
      "install",
      launcher,
      plan.baseHash,
      NOW,
    );
    expect(result).toMatchObject({ changed: false, launcherWritten: true });
    chmodSync(configDir, 0o755);
    expect(agentHookStatus(target(), launcher).state).toBe("installed");
  });

  test("repairing a broken install rewrites the launcher only", () => {
    apply("install");
    const before = readFileSync(settingsPath(), "utf8");
    rmSync(launcher.path);
    const { plan, result } = apply("install");
    expect(plan.changed).toBe(false);
    expect(plan.launcher.write).toBe(true);
    expect(result.launcherWritten).toBe(true);
    expect(readFileSync(settingsPath(), "utf8")).toBe(before);
    expect(agentHookStatus(target(), launcher).state).toBe("installed");
  });
});
