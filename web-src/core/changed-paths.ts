// Change notifications are not always file-precise. macOS FSEvents coalesces
// bursts into the containing directory, so a notification for "src" can mean
// "anything under src changed". libuv drops the MustScanSubDirs flag before the
// event reaches JS (src/unix/fsevents.c ignores kFSEventsSystem), so the only
// safe reading of a directory notification is "this path and everything below
// it". Matching with a plain Set lookup silently skipped those descendants.
//
// A bare startsWith() is wrong here: "src/a" must not cover "src/ab". The
// separator has to be part of the prefix.
export function changedPathCoversPath(changed: string, path: string): boolean {
  return path === changed || path.startsWith(`${changed}/`);
}

// `null` means "we do not know what changed" and every caller treats that as a
// full refresh, so it covers everything.
export function changedPathsCoverPath(
  changedPaths: Set<string> | null | undefined,
  path: string,
): boolean {
  if (!changedPaths) return true;
  if (changedPaths.has(path)) return true;
  for (const changed of changedPaths) {
    if (changedPathCoversPath(changed, path)) return true;
  }
  return false;
}
