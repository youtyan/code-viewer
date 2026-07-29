// 保存済みデータストア接続の資格情報を OS のキーチェーンに預ける。
//
// 接続先 (ホスト・エンドポイント・アカウント ID 等) は
// `.code-viewer/datastore-connections.json` に平文で置くが、資格情報は
// リポジトリ配下にも自前の暗号化ファイルにも書かない。自前で暗号化しても
// 復号鍵を同じディスクに置けば強度は平文と変わらないため、鍵の保護は OS に
// 委ねる。
//
// macOS: `security` (Keychain)。それ以外の OS は現状フォールバックせず、
// 従来どおりプロセス内メモリだけで保持する (再起動で消える)。
//
// 秘密を argv に出さないこと: `security add-generic-password -w <secret>` は
// 同一ユーザーの `ps` から見えてしまう。`security -i` はコマンド行を stdin から
// 読むので、秘密はプロセスの argv に一切現れない。

import { hasControlCharacter } from "../../core/control-chars";
import { spawnCollectAsync } from "./adapters/spawn-runner";

const SECURITY_COMMAND = "/usr/bin/security";
const KEYCHAIN_SERVICE = "code-viewer";
const KEYCHAIN_TIMEOUT_MS = 5000;
// キーチェーン項目が見つからないときの `security` の終了コード。
const ERR_SEC_ITEM_NOT_FOUND = 44;

export type ConnectionSecrets = Record<string, string>;

type KeychainSpawn = typeof spawnCollectAsync;

let keychainEnabledOverride: boolean | null = null;
let keychainSpawnOverride: KeychainSpawn | null = null;

export function __setKeychainEnabledForTest(enabled: boolean | null): void {
  keychainEnabledOverride = enabled;
}

export function __setKeychainSpawnForTest(spawn: KeychainSpawn | null): void {
  keychainSpawnOverride = spawn;
}

export function isKeychainAvailable(): boolean {
  if (keychainEnabledOverride !== null) return keychainEnabledOverride;
  // テストが実ユーザーのキーチェーンに項目を作らないように、既定では無効。
  // キーチェーン経路自体は __setKeychainSpawnForTest で spawn を差し替えて
  // 検証する。
  if (process.env.NODE_ENV === "test") return false;
  return process.platform === "darwin";
}

// 1 接続 = 1 キーチェーン項目。account は cwd ごとに分けて、別リポジトリで
// 同じ接続 id を使っても衝突しないようにする。
function accountFor(cwd: string, connectionId: string): string {
  return `${cwd}#${connectionId}`;
}

// `security -i` はコマンド行をシェル風に解釈する。改行が入ると次のコマンドに
// なってしまうため、制御文字を含む値は組み立てない (呼び出し側の値が壊れて
// いるので、黙って捨てるのではなく false を返して呼び出し元に判断させる)。
function quoteSecurityArg(value: string): string | null {
  if (hasControlCharacter(value)) return null;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function runSecurityAsync(opts: {
  args: string[];
  input?: string;
}): Promise<{ stdout: string; stderr: string; code: number }> {
  // テスト中に spawn の差し替えを忘れても、実ユーザーのキーチェーンには
  // 絶対に到達させない (以前に実項目を作ってしまったことがある)。
  if (!keychainSpawnOverride && process.env.NODE_ENV === "test") {
    throw new Error(
      "refusing to run the real security binary in tests; use __setKeychainSpawnForTest",
    );
  }
  const spawn = keychainSpawnOverride ?? spawnCollectAsync;
  const result = await spawn({
    command: SECURITY_COMMAND,
    args: opts.args,
    ...(opts.input === undefined ? {} : { input: opts.input }),
    timeoutMs: KEYCHAIN_TIMEOUT_MS,
    abortMessage: "keychain access aborted",
    timeoutMessage: `keychain access timed out after ${KEYCHAIN_TIMEOUT_MS}ms`,
    rejectOnError: false,
  });
  return {
    stdout: result.stdout.toString("utf8"),
    stderr: result.stderr.toString("utf8"),
    code: result.code,
  };
}

function warnKeychain(action: string, detail: string): void {
  console.warn(
    `[code-viewer] keychain ${action} failed: ${detail.replace(/\s+/g, " ").trim().slice(0, 200)}`,
  );
}

// 資格情報一式を JSON にして base64 で預ける。base64 なら引用符も改行も
// 含まないので、`security -i` のコマンド行に置いても解釈が壊れない。
export async function saveConnectionSecretsAsync(
  cwd: string,
  connectionId: string,
  secrets: ConnectionSecrets,
): Promise<boolean> {
  if (!isKeychainAvailable()) return false;
  if (Object.keys(secrets).length === 0) {
    return deleteConnectionSecretsAsync(cwd, connectionId);
  }
  const account = quoteSecurityArg(accountFor(cwd, connectionId));
  const label = quoteSecurityArg(`code-viewer: ${connectionId}`);
  if (!account || !label) {
    warnKeychain("save", "connection id or path contains control characters");
    return false;
  }
  const payload = Buffer.from(JSON.stringify(secrets), "utf8").toString(
    "base64",
  );
  try {
    // -U: 既存項目があれば更新する。
    const result = await runSecurityAsync({
      args: ["-i"],
      input: `add-generic-password -U -s "${KEYCHAIN_SERVICE}" -a ${account} -l ${label} -w "${payload}"\n`,
    });
    if (result.code !== 0) {
      warnKeychain("save", result.stderr || `exit ${result.code}`);
      return false;
    }
    return true;
  } catch (err) {
    warnKeychain("save", err instanceof Error ? err.message : String(err));
    return false;
  }
}

export async function loadConnectionSecretsAsync(
  cwd: string,
  connectionId: string,
): Promise<ConnectionSecrets | null> {
  if (!isKeychainAvailable()) return null;
  const account = accountFor(cwd, connectionId);
  if (hasControlCharacter(account)) return null;
  try {
    // 読み取りは秘密を argv に載せないので通常の引数で足りる (-w は
    // 「パスワードだけを stdout に出す」指定で、値を渡すものではない)。
    const result = await runSecurityAsync({
      args: [
        "find-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        account,
        "-w",
      ],
    });
    if (result.code === ERR_SEC_ITEM_NOT_FOUND) return null;
    if (result.code !== 0) {
      warnKeychain("read", result.stderr || `exit ${result.code}`);
      return null;
    }
    const decoded = Buffer.from(result.stdout.trim(), "base64").toString(
      "utf8",
    );
    const parsed = JSON.parse(decoded) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const secrets: ConnectionSecrets = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") secrets[key] = value;
    }
    return Object.keys(secrets).length > 0 ? secrets : null;
  } catch (err) {
    warnKeychain("read", err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function deleteConnectionSecretsAsync(
  cwd: string,
  connectionId: string,
): Promise<boolean> {
  if (!isKeychainAvailable()) return false;
  const account = accountFor(cwd, connectionId);
  if (hasControlCharacter(account)) return false;
  try {
    const result = await runSecurityAsync({
      args: ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account],
    });
    // 元から無い場合も「消えている」ので成功として扱う。
    if (result.code !== 0 && result.code !== ERR_SEC_ITEM_NOT_FOUND) {
      warnKeychain("delete", result.stderr || `exit ${result.code}`);
      return false;
    }
    return true;
  } catch (err) {
    warnKeychain("delete", err instanceof Error ? err.message : String(err));
    return false;
  }
}
