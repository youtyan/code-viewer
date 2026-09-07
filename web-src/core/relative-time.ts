// 「20 時間前」「yesterday」のような相対時刻。表示言語に追従する。
//
// 以前は blame.ts の blameRelativeTime と、history / ref-picker がそれぞれ持つ
// relativeWhen (同じ中身のコピー) が英語しか出せず、日本語の行に
// 「最終コミット 20h ago」と混ざっていた。単位の選び方だけをここで決め、言葉は
// Intl.RelativeTimeFormat に任せる (「昨日」「先週」のような言い方も
// numeric: "auto" が出す)。1 分未満だけは Intl の "now" / "今" が文の中で
// 読みにくいので、こちらで言葉を持つ。

export type RelativeTimeLang = "en" | "ja";

const JUST_NOW: Record<RelativeTimeLang, string> = {
  en: "just now",
  ja: "たった今",
};

/** 単位の境目。以前の blameRelativeTime と同じ丸め (round) で揃えてある。 */
export function relativeTimeUnit(
  elapsedMs: number,
): { value: number; unit: Intl.RelativeTimeFormatUnit } | null {
  const sec = Math.max(0, Math.round(elapsedMs / 1000));
  if (sec < 60) return null;
  const min = Math.round(sec / 60);
  if (min < 60) return { value: min, unit: "minute" };
  const hour = Math.round(min / 60);
  if (hour < 24) return { value: hour, unit: "hour" };
  const day = Math.round(hour / 24);
  if (day < 7) return { value: day, unit: "day" };
  if (day < 30) return { value: Math.round(day / 7), unit: "week" };
  const month = Math.round(day / 30);
  if (month < 12) return { value: month, unit: "month" };
  return { value: Math.round(month / 12), unit: "year" };
}

export function formatRelativeTime(
  thenMs: number,
  nowMs: number,
  lang: RelativeTimeLang,
): string {
  const parts = relativeTimeUnit(nowMs - thenMs);
  if (!parts) return JUST_NOW[lang];
  return new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(
    -parts.value,
    parts.unit,
  );
}

/** ローカル時刻の「2026-09-07 09:05」。相対時刻の横に添える正確な値。 */
export function absoluteWhen(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * コミット一覧の行に出す「yesterday (2026-09-06 09:05)」。相対で目安を、
 * 括弧で正確な時刻を。読めない文字列はそのまま返す (嘘の時刻を作らない)。
 */
export function describeWhen(
  iso: string,
  nowMs: number,
  lang: RelativeTimeLang,
): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  return `${formatRelativeTime(parsed, nowMs, lang)} (${absoluteWhen(parsed)})`;
}
