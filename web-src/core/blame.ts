// Pure helpers for the file-blame view: server DTO types, line grouping,
// time-bin colouring, and short labels. Kept free of DOM access so it can be
// unit-tested without a browser.

export const BLAME_ZERO_SHA = "0000000000000000000000000000000000000000";
export const BLAME_TIME_BIN_COUNT = 5;

// ai-dup-check: allow -- client-side blame DTO mirroring server/git.ts to avoid a core→server dependency.
export type BlameLine = {
  lineNo: number;
  sha: string;
  isUncommitted: boolean;
};

// ai-dup-check: allow -- client-side blame commit DTO mirroring server/git.ts to avoid a core→server dependency.
export type BlameCommit = {
  sha: string;
  author: string;
  authorMail: string;
  authorTime: number;
  summary: string;
  isUncommitted: boolean;
};

export type BlameResponse = {
  lines: BlameLine[];
  commits: Record<string, BlameCommit>;
  generation?: number;
  isUntracked?: boolean;
  isSynthetic?: boolean;
  error?: string;
  base?: "worktree" | "HEAD";
  ref?: string;
};

export type BlameGroup = {
  sha: string;
  startLine: number;
  endLine: number;
  commit: BlameCommit;
};

export function groupBlameLines(
  lines: BlameLine[],
  commits: Record<string, BlameCommit>,
): BlameGroup[] {
  const sorted = [...lines].sort((a, b) => a.lineNo - b.lineNo);
  const groups: BlameGroup[] = [];
  for (const line of sorted) {
    const commit = commits[line.sha];
    if (!commit) continue;
    const last = groups[groups.length - 1];
    if (last && last.sha === line.sha && last.endLine + 1 === line.lineNo) {
      last.endLine = line.lineNo;
      continue;
    }
    groups.push({
      sha: line.sha,
      startLine: line.lineNo,
      endLine: line.lineNo,
      commit,
    });
  }
  return groups;
}

// Map each committed sha to a time bin index in [0, binCount-1]. Older commits
// get lower bins (more transparent), newer commits get higher bins (darker).
// Uncommitted shas are pinned to the newest bin.
export function blameTimeBins(
  commits: Record<string, BlameCommit>,
  binCount: number = BLAME_TIME_BIN_COUNT,
): Record<string, number> {
  const result: Record<string, number> = {};
  const committed = Object.values(commits).filter(
    (c) => !c.isUncommitted && c.authorTime > 0,
  );
  if (committed.length === 0) {
    for (const sha of Object.keys(commits)) result[sha] = binCount - 1;
    return result;
  }
  let min = Infinity;
  let max = -Infinity;
  for (const c of committed) {
    if (c.authorTime < min) min = c.authorTime;
    if (c.authorTime > max) max = c.authorTime;
  }
  const span = max - min;
  for (const sha of Object.keys(commits)) {
    const c = commits[sha];
    if (c.isUncommitted || c.authorTime <= 0) {
      result[sha] = binCount - 1;
      continue;
    }
    if (span <= 0) {
      result[sha] = binCount - 1;
      continue;
    }
    const ratio = (c.authorTime - min) / span;
    const bin = Math.min(
      binCount - 1,
      Math.max(0, Math.floor(ratio * binCount)),
    );
    result[sha] = bin;
  }
  return result;
}

/**
 * 相対の時刻 ("5m ago" / "5分前")。`language` は画面の設定の言語 (ブラウザの
 * 言語ではない。画面では views/page-language.ts の `pageLanguage()`)。blame・作業ツリー・
 * History・比較対象の選択が共有する。
 */
export function relativeTimeText(
  authorTimeSec: number,
  language: string,
  nowMs: number = Date.now(),
): string {
  if (!authorTimeSec || authorTimeSec <= 0) return "";
  const format = new Intl.RelativeTimeFormat(language, {
    style: "narrow",
    numeric: "auto",
  });
  const sec = Math.max(0, Math.round(nowMs / 1000 - authorTimeSec));
  if (sec < 60) return format.format(0, "second");
  const min = Math.round(sec / 60);
  if (min < 60) return format.format(-min, "minute");
  const hour = Math.round(min / 60);
  if (hour < 24) return format.format(-hour, "hour");
  const day = Math.round(hour / 24);
  if (day < 7) return format.format(-day, "day");
  if (day < 30) return format.format(-Math.round(day / 7), "week");
  const month = Math.round(day / 30);
  if (month < 12) return format.format(-month, "month");
  return format.format(-Math.round(month / 12), "year");
}

// ai-dup-check: allow -- 7-char short SHA helper, intentionally a thin string utility.
export function blameShortSha(sha: string): string {
  if (!sha || sha === BLAME_ZERO_SHA) return "0000000";
  return sha.slice(0, 7);
}
