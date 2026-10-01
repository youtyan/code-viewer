// Data の表の日時の列を、選んだタイムゾーンで出し直すための純ロジック。
// 書式・時差・タイムゾーンの選択窓の絞り込み。DOM には触らない
// (選択窓は views/database/time-zone-picker.ts)。

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    // 投げる (RangeError) のは知らないタイムゾーン。呼び出し側に返す。
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * 時刻 (UNIX ミリ秒) を、そのタイムゾーンの "YYYY-MM-DD HH:MM:SS" にする。
 * ミリ秒が 0 でなければ ".mmm" を足す。知らないタイムゾーンは RangeError。
 */
export function formatInZone(epochMs: number, timeZone: string): string {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(epochMs))
    parts[part.type] = part.value;
  const ms = ((epochMs % 1000) + 1000) % 1000;
  const fraction = ms === 0 ? "" : `.${String(ms).padStart(3, "0")}`;
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}${fraction}`;
}

/** そのタイムゾーンの短い名前 ("UTC"・"GMT+9" など)。見出しの札に使う。 */
export function timeZoneShortName(
  timeZone: string,
  at: number,
  language: string,
): string {
  const part = new Intl.DateTimeFormat(language, {
    timeZone,
    timeZoneName: "short",
  })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? timeZone;
}

/** そのタイムゾーンの、その時刻での UTC からの差 (分)。知らない名前は RangeError。 */
export function timeZoneOffsetMinutes(timeZone: string, at: number): number {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(at))
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  const wall = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((wall - (at - (((at % 1000) + 1000) % 1000))) / 60_000);
}

/** 分の差を "+09:00" / "-05:30" にする。 */
export function formatUtcOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

// 時差で探す書き方: "+9" "-05" "+5:30" "0930" "utc+9" "GMT-3"。
const OFFSET_QUERY =
  /^(?:utc|gmt)?\s*([+\-\u2212])?\s*(\d{1,2})(?::?(\d{2}))?$/;

/**
 * 選択窓の絞り込み。時差の形 ("+9" など) なら時差の頭で、ほかは名前の語
 * (空白・"/"・"_" で区切る) が全部含まれるかで見る。空の問いはすべて通す。
 */
export function timeZoneMatches(
  query: string,
  name: string,
  offset: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const m = OFFSET_QUERY.exec(q);
  if (m) {
    const signs = m[1] ? [m[1] === "+" ? "+" : "-"] : ["+", "-"];
    const head = `${m[2].padStart(2, "0")}${m[3] ? `:${m[3]}` : ""}`;
    return signs.some((sign) => offset.startsWith(`${sign}${head}`));
  }
  const haystack = name.toLowerCase().replace(/_/g, " ");
  return q
    .split(/[\s/_]+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}
