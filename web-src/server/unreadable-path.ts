import { errno } from "./terminal/settings-file";

// 走査の途中で消えた場所 (ENOENT・ENOTDIR) は黙って飛ばす。権限の無い場所
// (root の docker volume など) も飛ばすが、どこを飛ばしたかは 1 度だけ記録する。
// ほかの失敗は走査の失敗として投げる。
const reportedUnreadablePaths = new Set<string>();

export function skipUnreadablePath(
  path: string,
  error: unknown,
  walk: string,
): void {
  const code = errno(error);
  if (code === "ENOENT" || code === "ENOTDIR") return;
  if (code !== "EACCES" && code !== "EPERM") throw error;
  if (reportedUnreadablePaths.has(path)) return;
  reportedUnreadablePaths.add(path);
  console.warn(
    `[code-viewer] ${walk} skipped a path it cannot read: ${path}`,
    error,
  );
}
