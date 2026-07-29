import { afterEach, describe, expect, test } from "bun:test";
import {
  __setKeychainEnabledForTest,
  __setKeychainSpawnForTest,
  deleteConnectionSecretsAsync,
  loadConnectionSecretsAsync,
  saveConnectionSecretsAsync,
} from "../server/database/credential-store";

type KeychainCall = {
  command: string;
  args: string[];
  input: string;
};

const CWD = "/workspace/example";
const ID = "connection:1111111111111111";
const SECRETS = { apiToken: "example-token", password: "example-password" };

// spawn を差し替えて、実ユーザーのキーチェーンに触れずに `security` への
// 渡し方を検証する。
function stubKeychain(
  reply: (call: KeychainCall) => {
    stdout?: string;
    stderr?: string;
    code: number;
  },
): KeychainCall[] {
  const calls: KeychainCall[] = [];
  __setKeychainEnabledForTest(true);
  __setKeychainSpawnForTest((async (opts) => {
    const call: KeychainCall = {
      command: opts.command,
      args: opts.args,
      input: opts.input === undefined ? "" : String(opts.input),
    };
    calls.push(call);
    const result = reply(call);
    return {
      stdout: Buffer.from(result.stdout ?? "", "utf8"),
      stderr: Buffer.from(result.stderr ?? "", "utf8"),
      code: result.code,
    };
  }) as Parameters<typeof __setKeychainSpawnForTest>[0]);
  return calls;
}

function payloadFromInput(input: string): unknown {
  const match = /-w "([A-Za-z0-9+/=]*)"/.exec(input);
  if (!match) throw new Error(`no -w payload in: ${input}`);
  return JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
}

afterEach(() => {
  __setKeychainEnabledForTest(null);
  __setKeychainSpawnForTest(null);
});

describe("keychain credential store", () => {
  // 最重要の性質: 秘密が argv に乗ると同一ユーザーの `ps` から読めてしまう。
  test("passes the secret through stdin and never through argv", async () => {
    const calls = stubKeychain(() => ({ code: 0 }));

    expect(await saveConnectionSecretsAsync(CWD, ID, SECRETS)).toBe(true);

    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(["-i"]);
    for (const arg of calls[0].args) {
      expect(arg.includes("example-token")).toBe(false);
      expect(arg.includes("example-password")).toBe(false);
    }
    expect(calls[0].input.includes("add-generic-password -U")).toBe(true);
    expect(payloadFromInput(calls[0].input)).toEqual(SECRETS);
  });

  test("scopes the keychain item to the working directory and connection", async () => {
    const calls = stubKeychain(() => ({ code: 0 }));

    await saveConnectionSecretsAsync(CWD, ID, SECRETS);

    expect(calls[0].input.includes(`-a "${CWD}#${ID}"`)).toBe(true);
    expect(calls[0].input.includes('-s "code-viewer"')).toBe(true);
  });

  test("reads the stored secrets back", async () => {
    const stored = Buffer.from(JSON.stringify(SECRETS), "utf8").toString(
      "base64",
    );
    const calls = stubKeychain(() => ({ stdout: `${stored}\n`, code: 0 }));

    expect(await loadConnectionSecretsAsync(CWD, ID)).toEqual(SECRETS);
    expect(calls[0].args).toEqual([
      "find-generic-password",
      "-s",
      "code-viewer",
      "-a",
      `${CWD}#${ID}`,
      "-w",
    ]);
  });

  test.each([
    { name: "a missing item", code: 44, stderr: "" },
    {
      name: "a locked keychain",
      code: 36,
      stderr: "User interaction is not allowed.",
    },
    { name: "unreadable output", code: 0, stderr: "" },
  ])("returns null for $name instead of throwing", async ({ code, stderr }) => {
    stubKeychain(() => ({
      code,
      stderr,
      stdout: code === 0 ? "not-json" : "",
    }));

    expect(await loadConnectionSecretsAsync(CWD, ID)).toBeNull();
  });

  test.each([
    { name: "removes the item", code: 0, expected: true },
    { name: "treats a missing item as removed", code: 44, expected: true },
    { name: "reports a real failure", code: 36, expected: false },
  ])("delete $name", async ({ code, expected }) => {
    const calls = stubKeychain(() => ({ code }));

    expect(await deleteConnectionSecretsAsync(CWD, ID)).toBe(expected);
    expect(calls[0].args[0]).toBe("delete-generic-password");
  });

  test("clearing every secret removes the item rather than storing an empty one", async () => {
    const calls = stubKeychain(() => ({ code: 0 }));

    await saveConnectionSecretsAsync(CWD, ID, {});

    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toBe("delete-generic-password");
  });

  // `security -i` はコマンド行をシェル風に解釈するので、改行を通すと
  // 次のコマンドとして実行されうる。組み立て前に弾く。
  test.each([
    {
      name: "connection id",
      cwd: CWD,
      id: 'connection:x"\nadd-generic-password',
    },
    { name: "working directory", cwd: "/workspace\nrm", id: ID },
  ])("refuses to build a command from a $name with control characters", async ({
    cwd,
    id,
  }) => {
    const calls = stubKeychain(() => ({ code: 0 }));

    expect(await saveConnectionSecretsAsync(cwd, id, SECRETS)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test("does nothing when the keychain is unavailable", async () => {
    const calls = stubKeychain(() => ({ code: 0 }));
    __setKeychainEnabledForTest(false);

    expect(await saveConnectionSecretsAsync(CWD, ID, SECRETS)).toBe(false);
    expect(await loadConnectionSecretsAsync(CWD, ID)).toBeNull();
    expect(await deleteConnectionSecretsAsync(CWD, ID)).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
