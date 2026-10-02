// code-viewer が動く Node.js の最低の版。package.json の engines と揃える
// (node-cli-package.test.ts が見る)。起動時の確認 (cli.ts) と doctor が使う。
//
// 22.14 は Node-API 10 が入った版。better-sqlite3 13 の同梱のバイナリは
// Node-API 10 で作られていて、22.0〜22.13 では SQLite を開いた時点で
// プロセスごと落ちる (engines は ">=22" としか書いていない)。
export const REQUIRED_NODE_VERSION = "22.14.0";

function majorMinor(version: string): [number, number] {
  const [major, minor] = version
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  return [major ?? Number.NaN, minor ?? Number.NaN];
}

/** `process.versions.node` の形の版が REQUIRED_NODE_VERSION 以上か。 */
export function nodeVersionSupported(version: string): boolean {
  const [major, minor] = majorMinor(version);
  const [requiredMajor, requiredMinor] = majorMinor(REQUIRED_NODE_VERSION);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  return (
    major > requiredMajor || (major === requiredMajor && minor >= requiredMinor)
  );
}
