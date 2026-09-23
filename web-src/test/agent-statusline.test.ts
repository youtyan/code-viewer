// claude の statusLine を包む・戻す。本物のファイルシステムで、一時
// ディレクトリを設定ディレクトリとして使う (利用者の ~/.claude には触らない)。
// 包むスクリプトは本物の /bin/sh で動かし、元のコマンドの出力と終了コードが
// そのまま返ること・保存に失敗しても返ることを見る。

import { spawnSync } from "node:child_process";
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
import { claudeUsageFile } from "../server/accounts/usage";
import {
  applyStatusLine,
  parseWrappedCommand,
  planStatusLine,
  StatusLineError,
  statusLineStatus,
  statusLineWrapperPath,
  wrappedCommand,
} from "../server/terminal/statusline";

let root: string;
let configDir: string;
let usageDir: string;
const NOW = new Date(2026, 0, 2, 3, 4, 5);
const ORIGINAL = `printf 'sample %s' "$(cat | wc -c | tr -d ' ')"`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cv-statusline-"));
  configDir = join(root, "config");
  mkdirSync(configDir);
  usageDir = join(root, "state", "agent-usage");
});

afterEach(() => {
  for (const dir of [configDir, join(root, "linked"), usageDir]) {
    if (existsSync(dir)) chmodSync(dir, 0o755);
  }
  rmSync(root, { recursive: true, force: true });
});

function settingsPath(): string {
  return join(configDir, "settings.json");
}

function write(value: unknown, indent = 2): string {
  const text = `${JSON.stringify(value, null, indent)}\n`;
  writeFileSync(settingsPath(), text);
  return text;
}

async function roundTrip(action: "install" | "uninstall") {
  const plan = planStatusLine(configDir, action, usageDir, NOW);
  return applyStatusLine(configDir, action, usageDir, plan, NOW);
}

describe("the wrapped command", () => {
  test.each([
    { original: null },
    { original: ORIGINAL },
    { original: `echo "it's $HOME" | sed 's/a/b/'` },
    { original: "a  b\\c 'd'" },
  ])("decodes back to the original: $original", ({ original }) => {
    const wrapper = "/state dir/agent-usage/code-viewer-statusline";
    expect(parseWrappedCommand(wrappedCommand(wrapper, original))).toEqual({
      kind: "wrapped",
      original,
    });
  });

  test.each([
    { command: ORIGINAL, expected: { kind: "plain" } },
    {
      command: "/x/code-viewer-statusline $(evil)",
      expected: { kind: "unknown" },
    },
    { command: "echo code-viewer-statusline", expected: { kind: "unknown" } },
    {
      command: "/x/code-viewer-statusline 'a' 'b'",
      expected: { kind: "unknown" },
    },
  ])("$command → $expected.kind", ({ command, expected }) => {
    expect(parseWrappedCommand(command)).toEqual(expected);
  });
});

describe("install and uninstall", () => {
  test.each([
    {
      name: "an existing statusLine with other fields",
      initial: {
        model: "sample",
        statusLine: { type: "command", command: ORIGINAL, padding: 1 },
      },
    },
    { name: "no statusLine", initial: { model: "sample" } },
    { name: "an empty object", initial: {} },
    {
      name: "tab indentation",
      initial: { statusLine: { type: "command", command: ORIGINAL } },
      indent: "\t",
    },
  ])("round trip with $name: install twice adds nothing, uninstall restores the bytes", async ({
    initial,
    indent,
  }) => {
    const original = write(initial, indent as unknown as number);
    const first = await roundTrip("install");
    expect(first.changed).toBe(true);
    const installed = readFileSync(settingsPath(), "utf8");
    const again = await roundTrip("install");
    expect(again.changed).toBe(false);
    expect(readFileSync(settingsPath(), "utf8")).toBe(installed);
    const parsed = JSON.parse(installed) as { statusLine: { command: string } };
    expect(parseWrappedCommand(parsed.statusLine.command)).toEqual({
      kind: "wrapped",
      original: "statusLine" in initial ? ORIGINAL : null,
    });
    await roundTrip("uninstall");
    expect(readFileSync(settingsPath(), "utf8")).toBe(original);
  });

  test("a missing file is created with a minimal statusLine and removed again", async () => {
    await roundTrip("install");
    const created = JSON.parse(readFileSync(settingsPath(), "utf8"));
    expect(created.statusLine.type).toBe("command");
    await roundTrip("uninstall");
    expect(JSON.parse(readFileSync(settingsPath(), "utf8"))).toEqual({});
  });

  test("only statusLine.command changes; everything else is kept", async () => {
    write({
      a: 1,
      statusLine: {
        type: "command",
        command: ORIGINAL,
        padding: 2,
        refreshInterval: 5,
      },
      z: [1],
    });
    await roundTrip("install");
    const after = JSON.parse(readFileSync(settingsPath(), "utf8"));
    expect(after.a).toBe(1);
    expect(after.z).toEqual([1]);
    expect(after.statusLine.padding).toBe(2);
    expect(after.statusLine.refreshInterval).toBe(5);
  });

  test("writes a backup of the previous content, and the wrapper", async () => {
    const original = write({
      statusLine: { type: "command", command: ORIGINAL },
    });
    const result = await roundTrip("install");
    expect(result.backupPath).toBe(
      `${settingsPath()}.code-viewer-backup-20260102-030405`,
    );
    expect(readFileSync(result.backupPath ?? "", "utf8")).toBe(original);
    expect(result.wrapperWritten).toBe(true);
    expect(statSync(statusLineWrapperPath(usageDir)).mode & 0o111).not.toBe(0);
  });

  test("status follows the file", async () => {
    expect(statusLineStatus(configDir, usageDir).state).toBe("none");
    write({ statusLine: { type: "command", command: ORIGINAL } });
    expect(statusLineStatus(configDir, usageDir)).toMatchObject({
      state: "plain",
      command: ORIGINAL,
    });
    await roundTrip("install");
    expect(statusLineStatus(configDir, usageDir)).toMatchObject({
      state: "wrapped",
      command: ORIGINAL,
      wrapperMissing: false,
    });
    rmSync(statusLineWrapperPath(usageDir));
    expect(statusLineStatus(configDir, usageDir).wrapperMissing).toBe(true);
  });
});

describe("refuses to write", () => {
  test.each([
    { name: "broken JSON", text: "{ broken" },
    { name: "a top-level array", text: "[]\n" },
    { name: "statusLine that is not an object", text: '{"statusLine":"x"}\n' },
    {
      name: "a command that is not a string",
      text: '{"statusLine":{"type":"command","command":1}}\n',
    },
    {
      name: "another statusLine type",
      text: '{"statusLine":{"type":"other","command":"x"}}\n',
    },
    {
      name: "a hand-edited wrapped command",
      text: '{"statusLine":{"type":"command","command":"/x/code-viewer-statusline $(x)"}}\n',
    },
  ])("$name: nothing is written, no backup, no wrapper", ({ text }) => {
    writeFileSync(settingsPath(), text);
    expect(() => planStatusLine(configDir, "install", usageDir, NOW)).toThrow(
      expect.objectContaining({ code: "unreadable" }),
    );
    expect(readFileSync(settingsPath(), "utf8")).toBe(text);
    expect(readdirSync(configDir)).toEqual(["settings.json"]);
    expect(existsSync(usageDir)).toBe(false);
  });

  test("when the file changed after it was shown", async () => {
    write({ statusLine: { type: "command", command: ORIGINAL } });
    const plan = planStatusLine(configDir, "install", usageDir, NOW);
    const changed = write({
      statusLine: { type: "command", command: "echo other" },
    });
    await expect(
      applyStatusLine(configDir, "install", usageDir, plan, NOW),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(readFileSync(settingsPath(), "utf8")).toBe(changed);
  });

  test("when the backup cannot be written", async () => {
    const original = write({
      statusLine: { type: "command", command: ORIGINAL },
    });
    const plan = planStatusLine(configDir, "install", usageDir, NOW);
    let caught: unknown;
    try {
      await applyStatusLine(configDir, "install", usageDir, plan, NOW, {
        writeBackup() {
          throw Object.assign(new Error("sample disk full"), {
            code: "ENOSPC",
          });
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(StatusLineError);
    expect((caught as StatusLineError).code).toBe("failed");
    expect(((caught as { cause?: Error }).cause as Error).message).toBe(
      "sample disk full",
    );
    expect(readFileSync(settingsPath(), "utf8")).toBe(original);
  });

  test("when the settings directory is not writable", async () => {
    const original = write({
      statusLine: { type: "command", command: ORIGINAL },
    });
    chmodSync(configDir, 0o555);
    const plan = planStatusLine(configDir, "install", usageDir, NOW);
    expect(plan.writeBlocked).not.toBe("");
    await expect(
      applyStatusLine(configDir, "install", usageDir, plan, NOW),
    ).rejects.toMatchObject({ code: "blocked" });
    expect(readFileSync(settingsPath(), "utf8")).toBe(original);
  });
});

describe("file properties", () => {
  test.each([0o600, 0o640, 0o644])("keeps the mode %s", async (mode) => {
    write({ statusLine: { type: "command", command: ORIGINAL } });
    chmodSync(settingsPath(), mode);
    await roundTrip("install");
    expect(statSync(settingsPath()).mode & 0o777).toBe(mode);
  });

  test("updates a symlink's target and keeps the link; the backup sits by the link", async () => {
    const linked = join(root, "linked");
    mkdirSync(linked);
    const target = join(linked, "settings.json");
    const original = `${JSON.stringify({ statusLine: { type: "command", command: ORIGINAL } }, null, 2)}\n`;
    writeFileSync(target, original);
    symlinkSync(target, settingsPath());
    const result = await roundTrip("install");
    expect(lstatSync(settingsPath()).isSymbolicLink()).toBe(true);
    expect(readlinkSync(settingsPath())).toBe(target);
    expect(readFileSync(target, "utf8")).toContain("code-viewer-statusline");
    expect(result.backupPath?.startsWith(configDir)).toBe(true);
    await roundTrip("uninstall");
    expect(readFileSync(target, "utf8")).toBe(original);
  });

  test("a link whose target is read-only is reported, not written", () => {
    const linked = join(root, "linked");
    mkdirSync(linked);
    const target = join(linked, "settings.json");
    writeFileSync(
      target,
      '{"statusLine":{"type":"command","command":"echo x"}}\n',
    );
    symlinkSync(target, settingsPath());
    chmodSync(target, 0o444);
    chmodSync(linked, 0o555);
    const status = statusLineStatus(configDir, usageDir);
    expect(status.symlink).toBe(true);
    expect(status.realPath).toBe(realpathSync(target));
    expect(status.writeBlocked).toContain("not writable");
  });
});

describe("the wrapper script", () => {
  const INPUT = JSON.stringify({
    session_id: "sample",
    rate_limits: {
      five_hour: { used_percentage: 42.4, resets_at: 1790000000 },
      seven_day: { used_percentage: 81.6, resets_at: 1790500000 },
    },
  });

  async function install(initial: unknown): Promise<string> {
    write(initial);
    await roundTrip("install");
    return JSON.parse(readFileSync(settingsPath(), "utf8")).statusLine.command;
  }

  function run(
    command: string,
    env: Record<string, string> = {},
    input = INPUT,
  ) {
    const clean = { ...process.env };
    delete clean.CLAUDE_CONFIG_DIR;
    return spawnSync("/bin/sh", ["-c", command], {
      input,
      env: { ...clean, ...env },
      encoding: "utf8",
    });
  }

  test.each([
    { name: "default account", env: {}, key: "" },
    {
      name: "another account",
      env: { CLAUDE_CONFIG_DIR: "/home/sample/w" },
      key: "/home/sample/w",
    },
  ])("returns the original output and exit code, and saves the input ($name)", async ({
    env,
    key,
  }) => {
    const wrapped = await install({
      statusLine: { type: "command", command: `${ORIGINAL}; exit 3` },
    });
    const plain = run(`${ORIGINAL}; exit 3`, env);
    const out = run(wrapped, env);
    expect(out.stdout).toBe(plain.stdout);
    expect(out.status).toBe(3);
    expect(out.stderr).toBe("");
    expect(readFileSync(claudeUsageFile(usageDir, key), "utf8")).toBe(INPUT);
  });

  test("the original sees exactly the same bytes (no newline added or lost)", async () => {
    const wrapped = await install({
      statusLine: { type: "command", command: "od -c | head -1" },
    });
    for (const input of ["{}", "{}\n", "{}\n\n"]) {
      expect(run(wrapped, {}, input).stdout).toBe(
        run("od -c | head -1", {}, input).stdout,
      );
    }
  });

  test.each([
    {
      name: "the target is a directory",
      prepare: () =>
        mkdirSync(claudeUsageFile(usageDir, ""), { recursive: true }),
      input: INPUT,
    },
    { name: "the input is empty", prepare: () => undefined, input: "" },
  ])("a failed save ($name) still returns the original output and is recorded", async ({
    prepare,
    input,
  }) => {
    const wrapped = await install({
      statusLine: { type: "command", command: ORIGINAL },
    });
    prepare();
    const out = run(wrapped, {}, input);
    expect(out.stdout).toBe(run(ORIGINAL, {}, input).stdout);
    expect(out.status).toBe(0);
    expect(readFileSync(join(usageDir, "failures.log"), "utf8")).toContain(
      "could not save the statusline input",
    );
    expect(
      readdirSync(usageDir).filter((name) => name.startsWith(".claude-")),
    ).toEqual([]);
  });

  test("an unwritable usage directory still returns the original output", async () => {
    const wrapped = await install({
      statusLine: { type: "command", command: ORIGINAL },
    });
    chmodSync(usageDir, 0o555);
    const out = run(wrapped);
    expect(out.stdout).toBe(run(ORIGINAL).stdout);
    expect(out.stderr).toContain("usage was not saved");
  });

  test.each([
    { name: "both windows", input: INPUT, expected: "5h 42% · 7d 82%\n" },
    {
      name: "pretty-printed input",
      input: JSON.stringify(JSON.parse(INPUT), null, 2),
      expected: "5h 42% · 7d 82%\n",
    },
    {
      name: "no rate limits",
      input: '{"session_id":"x"}',
      expected: "usage: n/a\n",
    },
  ])("without an original status line it prints usage in one line: $name", async ({
    input,
    expected,
  }) => {
    const wrapped = await install({});
    expect(run(wrapped, {}, input).stdout).toBe(expected);
  });
});
